import { useCallback, useEffect, useRef, useState } from "react";
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
  resolveSplitAfterClose,
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
      if (!layout) return layout;
      const firstOk = Boolean(sessionRecords[layout.firstSessionId]);
      const secondOk = Boolean(sessionRecords[layout.secondSessionId]);
      if (firstOk && secondOk) return layout;
      if (firstOk) return null;
      if (secondOk) return null;
      return null;
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

  /**
   * 顶栏 Tab 单击：只切焦点；若点的是分屏外的第三个会话，替换聚焦栏。
   */
  const selectTab = useCallback((sessionId: string) => {
    const record = store.get(sessionRecordByIdAtomFamily(sessionId));
    if (!record) return;
    const snap = tabsSnapshotRef.current;
    if (snap.split && snap.currentSessionId) {
      const inSplit =
        sessionId === snap.split.firstSessionId ||
        sessionId === snap.split.secondSessionId;
      if (!inSplit) {
        setSplitLayout((layout) => {
          if (!layout || !snap.currentSessionId) return layout;
          if (layout.firstSessionId === snap.currentSessionId) {
            return { ...layout, firstSessionId: sessionId };
          }
          if (layout.secondSessionId === snap.currentSessionId) {
            return { ...layout, secondSessionId: sessionId };
          }
          return layout;
        });
      }
    }
    focusHandlersRef.current.focusSession(record.projectId, sessionId);
  }, [store]);

  const dropSplit = useCallback((draggedSessionId: string, edge: SessionSplitEdge) => {
    setDraggingSessionId(null);
    const snap = tabsSnapshotRef.current;
    if (!snap.currentSessionId) return;

    // 分屏拖入 → 常驻（用 snapshot，避免 stale tabs）
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
    const next = buildSplitLayoutFromDrop({
      hostSessionId: snap.currentSessionId,
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
  };
}

export type SessionWorkspaceChrome = ReturnType<typeof useSessionWorkspaceChrome>;
