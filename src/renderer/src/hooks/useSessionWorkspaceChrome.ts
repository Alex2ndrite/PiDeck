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
  replaceSplitPaneFromDrop,
  replaceSplitPaneFromFocus,
  resolveSplitAfterClose,
  resolveSplitHostSessionId,
  type SessionSplitEdge,
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
      // 任一分屏栏的会话记录消失则整个退出分屏（存活栏会话由 closeTab 的
      // resolveSplitAfterClose 负责晋升单栏，这里只处理记录删除的场景）
      if (!layout) return layout;
      const firstOk = Boolean(sessionRecords[layout.firstSessionId]);
      const secondOk = Boolean(sessionRecords[layout.secondSessionId]);
      return firstOk && secondOk ? layout : null;
    });
  }, [sessionRecords, setSessionTabIds]);

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

  const dropSplit = useCallback((draggedSessionId: string, edge: SessionSplitEdge) => {
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

    if (snap.split) {
      const next = replaceSplitPaneFromDrop({
        layout: snap.split,
        draggedSessionId,
        edge,
      });
      if (next) setSplitLayout(next);
      return;
    }

    // 宿主不能等于被拖会话：拖当前 Tab 时改用 Tab 栏里的另一个会话
    const hostSessionId = resolveSplitHostSessionId({
      currentSessionId: snap.currentSessionId,
      draggedSessionId,
      tabIds: permanent.tabs,
    });
    if (!hostSessionId) return;

    const next = buildSplitLayoutFromDrop({
      hostSessionId,
      draggedSessionId,
      edge,
    });
    if (next) setSplitLayout(next);
  }, [setSessionTabIds]);

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
