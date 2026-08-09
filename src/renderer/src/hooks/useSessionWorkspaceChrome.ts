import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useAtomValue, useSetAtom, useStore } from "jotai";
import {
  sessionRecordByIdAtomFamily,
  sessionRecordsAtom,
  sessionTabIdsAtom,
} from "../atoms";
import {
  openPermanentSessionTab,
  openPreviewSessionTab,
  reorderSessionTabs,
  togglePinSessionTab,
  type SessionTabOpenMode,
} from "../utils/sessionTabs";
import {
  buildSplitLayoutFromDrop,
  edgeToOrientation,
  insertRootPaneFromDrop,
  nestSplitPaneFromDrop,
  replaceSplitPaneFromDrop,
  replaceSplitPaneFromFocus,
  resolveSplitAfterClose,
  resolveSplitHostSessionId,
  splitLayoutSessionIds,
  type SessionSplitDropTarget,
  type SessionSplitLayout,
} from "../utils/sessionSplitEdge";

const PINNED_TABS_STORAGE_KEY = "pideck.pinnedSessionTabIds";

export type SessionWorkspaceFocusHandlers = {
  /** 切换当前会话焦点（不改 Tab 预览/常驻状态） */
  focusSession: (projectId: string, sessionId: string) => void;
  /** 无剩余 Tab 时回到项目空态 */
  focusProject: (projectId: string) => void;
};

/**
 * 会话工作区 chrome：Tab 列表 / 预览 / Pin / 分屏 / 拖拽落点。
 *
 * 与「选中哪个会话」正交——选中由 useSessionActions 负责；本 hook 只登记/维护
 * 顶栏与分屏布局。App 只做装配，不写 chrome 业务分支。
 */
export function useSessionWorkspaceChrome(options: {
  currentSessionId: string | undefined;
  activeProjectId: string | undefined;
}) {
  const { currentSessionId, activeProjectId } = options;
  const store = useStore();
  const sessionTabIds = useAtomValue(sessionTabIdsAtom);
  const setSessionTabIds = useSetAtom(sessionTabIdsAtom);
  const sessionRecords = useAtomValue(sessionRecordsAtom);

  const focusHandlersRef = useRef<SessionWorkspaceFocusHandlers>({
    focusSession: () => undefined,
    focusProject: () => undefined,
  });

  const [pinnedSessionTabIds, setPinnedSessionTabIds] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem(PINNED_TABS_STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed)
        ? parsed.filter((id): id is string => typeof id === "string")
        : [];
    } catch {
      return [];
    }
  });
  const [previewSessionTabId, setPreviewSessionTabId] = useState<string | null>(null);
  const [splitLayout, setSplitLayout] = useState<SessionSplitLayout | null>(null);
  const [draggingSessionId, setDraggingSessionId] = useState<string | null>(null);

  // 最新快照：供 drop/close 回调避免闭包陈旧
  const tabsSnapshotRef = useRef({
    tabs: sessionTabIds,
    pinned: pinnedSessionTabIds,
    previewId: previewSessionTabId,
    split: splitLayout,
    currentSessionId,
    activeProjectId,
  });
  tabsSnapshotRef.current = {
    tabs: sessionTabIds,
    pinned: pinnedSessionTabIds,
    previewId: previewSessionTabId,
    split: splitLayout,
    currentSessionId,
    activeProjectId,
  };

  useEffect(() => {
    try {
      localStorage.setItem(PINNED_TABS_STORAGE_KEY, JSON.stringify(pinnedSessionTabIds));
    } catch {
      // 持久化失败不影响功能
    }
  }, [pinnedSessionTabIds]);

  // 会话记录消失时清理 Tab / pin / preview
  useEffect(() => {
    setSessionTabIds((current) => {
      const next = current.filter((id) => Boolean(sessionRecords[id]));
      return next.length === current.length ? current : next;
    });
    setPinnedSessionTabIds((current) => {
      const next = current.filter((id) => Boolean(sessionRecords[id]));
      return next.length === current.length ? current : next;
    });
    setPreviewSessionTabId((current) =>
      current && !sessionRecords[current] ? null : current,
    );
    setSplitLayout((layout) => {
      // 任一栏会话记录消失则整个退出分屏（存活栏会话由 closeTab 的
      // resolveSplitAfterClose 负责晋升单栏，这里只处理记录删除的场景）
      if (!layout) return layout;
      const ids = splitLayoutSessionIds(layout);
      return ids.every((id) => Boolean(sessionRecords[id])) ? layout : null;
    });
  }, [sessionRecords, setSessionTabIds]);

  // 主进程「跳转到某会话」推送（系统通知点击 / 桌面宠物点击）：解析 record 后交给
  // App 注入的 focus handler 切换焦点。冷启动点击通知时 catalog 可能尚未加载完，
  // 小间隔重试（最长约 3 秒）直到能解析到会话记录，避免首帧竞态丢目标。
  useEffect(() => {
    let disposed = false;
    const unsubscribe = window.piDesktop.pet.onFocusTarget(({ sessionId }) => {
      const tryFocus = (attempt: number) => {
        if (disposed) return;
        const record = store.get(sessionRecordByIdAtomFamily(sessionId));
        if (record) {
          focusHandlersRef.current.focusSession(record.projectId, sessionId);
          return;
        }
        if (attempt < 6) window.setTimeout(() => tryFocus(attempt + 1), 500);
      };
      tryFocus(0);
    });
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [store]);

  /** 由 App 在 session actions 就绪后注入；写 ref 避免与 actions 形成 hook 环依赖 */
  const bindFocusHandlers = useCallback((handlers: SessionWorkspaceFocusHandlers) => {
    focusHandlersRef.current = handlers;
  }, []);

  /** 在 App / 侧栏边界登记 Tab（preview / permanent）；与 selectSession 解耦 */
  const registerOpenSession = useCallback((
    sessionId: string,
    mode: SessionTabOpenMode = "permanent",
  ) => {
    const { tabs, pinned, previewId } = tabsSnapshotRef.current;
    const result =
      mode === "preview"
        ? openPreviewSessionTab(tabs, pinned, previewId, sessionId)
        : openPermanentSessionTab(tabs, pinned, previewId, sessionId);
    setSessionTabIds(result.tabs);
    setPreviewSessionTabId(result.previewId);
  }, [setSessionTabIds]);

  const promotePreview = useCallback((sessionId: string) => {
    registerOpenSession(sessionId, "permanent");
  }, [registerOpenSession]);

  const closeTab = useCallback((sessionId: string) => {
    const snap = tabsSnapshotRef.current;
    const remaining = snap.tabs.filter((id) => id !== sessionId);
    setSessionTabIds(remaining);
    if (snap.previewId === sessionId) setPreviewSessionTabId(null);

    if (snap.split) {
      const resolved = resolveSplitAfterClose(snap.split, sessionId);
      if (!resolved) {
        setSplitLayout(null);
      } else if ("soloSessionId" in resolved) {
        setSplitLayout(null);
        if (snap.currentSessionId === sessionId) {
          const record = store.get(sessionRecordByIdAtomFamily(resolved.soloSessionId));
          if (record) focusHandlersRef.current.focusSession(record.projectId, resolved.soloSessionId);
        }
        if (remaining.length === 0 && snap.activeProjectId) {
          focusHandlersRef.current.focusProject(snap.activeProjectId);
        }
        return;
      } else {
        setSplitLayout(resolved.layout);
        // 分屏仍存在且关闭的是当前聚焦会话：焦点优先留在分屏内幸存会话，
        // 避免回退到 Tab 邻居后触发 replaceSplitPaneFromFocus 把另一栏也换掉
        if (snap.currentSessionId === sessionId && remaining.length > 0) {
          const splitSurvivors = splitLayoutSessionIds(resolved.layout).filter((id) =>
            remaining.includes(id),
          );
          if (splitSurvivors.length > 0) {
            const record = store.get(sessionRecordByIdAtomFamily(splitSurvivors[0]));
            if (record) {
              focusHandlersRef.current.focusSession(record.projectId, splitSurvivors[0]);
              return;
            }
          }
        }
      }
    }

    if (snap.currentSessionId !== sessionId) return;
    if (remaining.length > 0) {
      const index = snap.tabs.indexOf(sessionId);
      const next = remaining[Math.min(index, remaining.length - 1)];
      const record = store.get(sessionRecordByIdAtomFamily(next));
      if (record) focusHandlersRef.current.focusSession(record.projectId, next);
    } else if (snap.activeProjectId) {
      focusHandlersRef.current.focusProject(snap.activeProjectId);
    }
  }, [setSessionTabIds, store]);

  const closeOtherTabs = useCallback((sessionId: string) => {
    setSessionTabIds((current) => current.filter((id) => id === sessionId));
    setPreviewSessionTabId((current) => (current && current !== sessionId ? null : current));
    setSplitLayout(null);
  }, [setSessionTabIds]);

  const closeAllTabs = useCallback(() => {
    setSessionTabIds([]);
    setPreviewSessionTabId(null);
    setSplitLayout(null);
    const projectId = tabsSnapshotRef.current.activeProjectId;
    if (projectId) focusHandlersRef.current.focusProject(projectId);
  }, [setSessionTabIds]);

  const togglePin = useCallback((sessionId: string) => {
    const { tabs, pinned, previewId } = tabsSnapshotRef.current;
    const next = togglePinSessionTab(tabs, pinned, sessionId);
    setSessionTabIds(next.tabs);
    setPinnedSessionTabIds(next.pinned);
    // Pin 与预览互斥：钉住时升格为常驻视觉
    if (previewId === sessionId) setPreviewSessionTabId(null);
  }, [setSessionTabIds]);

  const reorderTab = useCallback((
    sourceId: string,
    targetId: string,
    position: "before" | "after",
  ) => {
    const { tabs, pinned } = tabsSnapshotRef.current;
    const next = reorderSessionTabs(tabs, pinned, sourceId, targetId, position);
    setSessionTabIds(next.tabs);
    setPinnedSessionTabIds(next.pinned);
  }, [setSessionTabIds]);

  // 上一次的焦点会话：分屏时「焦点切到分屏外会话」要用它定位替换哪个栏。
  // 注意必须在焦点变更发生后读取变更前的值 —— 此刻 currentSessionId 已是新会话，
  // 不能像旧 selectTab 那样用「当前焦点」找栏（新建 Agent 后点新 Tab 会找不到目标栏）。
  const lastFocusedSessionIdRef = useRef(currentSessionId);
  // 焦点会话变更为分屏外会话时（新建 Agent / 侧栏打开第三会话 / 点分屏外 Tab），
  // 把新会话替换进原聚焦栏；用 useLayoutEffect 在绘制前完成，避免一帧焦点丢失闪烁。
  useLayoutEffect(() => {
    const prevFocusedSessionId = lastFocusedSessionIdRef.current;
    lastFocusedSessionIdRef.current = currentSessionId;
    if (!currentSessionId) return;
    const layout = tabsSnapshotRef.current.split;
    if (!layout) return;
    const next = replaceSplitPaneFromFocus({
      layout,
      prevFocusedSessionId,
      nextFocusedSessionId: currentSessionId,
    });
    if (next) setSplitLayout(next);
  }, [currentSessionId, setSplitLayout]);

  /**
   * 顶栏 Tab 单击：只切焦点；若点的是分屏外的第三个会话，
   * 分屏栏替换由上面的「焦点变更」useLayoutEffect 统一处理（replaceSplitPaneFromFocus）。
   */
  const selectTab = useCallback((sessionId: string) => {
    const record = store.get(sessionRecordByIdAtomFamily(sessionId));
    if (!record) return;
    focusHandlersRef.current.focusSession(record.projectId, sessionId);
  }, [store]);

  const dropSplit = useCallback((draggedSessionId: string, target: SessionSplitDropTarget) => {
    setDraggingSessionId(null);
    const snap = tabsSnapshotRef.current;

    // 分屏拖入 → 常驻（用 snapshot，避免 stale tabs）；侧栏拖入尚未在 Tab 栏的会话也要先登记
    const permanent = openPermanentSessionTab(
      snap.tabs,
      snap.pinned,
      snap.previewId,
      draggedSessionId,
    );
    setSessionTabIds(permanent.tabs);
    setPreviewSessionTabId(permanent.previewId);

    const layout = snap.split;
    if (!layout) {
      // 单栏：拖到唯一会话面板边缘 → 根层双栏。
      // 宿主 = 被拖命中的面板；拖当前会话自己时退化为 Tab 栏另一会话（否则当前 Tab 无法分屏）
      if (target.kind !== "session-edge") return;
      const hostSessionId = resolveSplitHostSessionId({
        draggedSessionId,
        hitSessionId: target.sessionId,
        tabIds: permanent.tabs,
      });
      if (!hostSessionId) return;
      const next = buildSplitLayoutFromDrop({
        hostSessionId,
        draggedSessionId,
        edge: target.edge,
      });
      if (next) setSplitLayout(next);
      return;
    }

    // 已分屏：中心 → 替换命中会话；边缘按方向分派——
    // 与根层同向 → 根层插入（真三栏）；与根层垂直 → 切分该面板（终端式）
    const next =
      target.kind === "session-center"
        ? replaceSplitPaneFromDrop({
            layout,
            draggedSessionId,
            sessionId: target.sessionId,
          })
        : edgeToOrientation(target.edge) === layout.orientation
          ? insertRootPaneFromDrop({
              layout,
              draggedSessionId,
              sessionId: target.sessionId,
              edge: target.edge,
            })
          : nestSplitPaneFromDrop({
              layout,
              draggedSessionId,
              sessionId: target.sessionId,
              edge: target.edge,
            });
    if (next) {
      setSplitLayout(next);
      // 中心替换了当前聚焦会话：焦点迁到拖入会话，避免「替换聚焦面板后焦点悬空」——
      // 悬空会导致无栏聚焦、且下次新建会话时按 prev 游离退化为替换第一栏（顶掉刚拖入的会话）
      if (
        target.kind === "session-center" &&
        target.sessionId === snap.currentSessionId
      ) {
        const record = store.get(sessionRecordByIdAtomFamily(draggedSessionId));
        if (record) {
          focusHandlersRef.current.focusSession(record.projectId, draggedSessionId);
        }
      }
    }
  }, [setSessionTabIds, store]);

  const beginDrag = useCallback((sessionId: string) => {
    setDraggingSessionId(sessionId);
  }, []);

  const endDrag = useCallback(() => {
    setDraggingSessionId(null);
  }, []);

  /** 退出会话分屏：保留当前聚焦会话为单栏 */
  const exitSplit = useCallback(() => {
    setSplitLayout(null);
  }, []);

  return {
    // state
    sessionTabIds,
    pinnedSessionTabIds,
    previewSessionTabId,
    splitLayout,
    draggingSessionId,
    // wiring
    bindFocusHandlers,
    registerOpenSession,
    // commands
    promotePreview,
    closeTab,
    closeOtherTabs,
    closeAllTabs,
    togglePin,
    reorderTab,
    selectTab,
    dropSplit,
    beginDrag,
    endDrag,
    exitSplit,
  };
}

export type SessionWorkspaceChrome = ReturnType<typeof useSessionWorkspaceChrome>;
