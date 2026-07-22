import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  BranchDiffResult,
  CommitDetail,
  CommitEntry,
  ExternalEditor,
  GitChangedFile,
  GitResourceGroupType,
  GitResourceGroups,
  GitWorkspaceFileDiff,
} from "../../../shared/types";

export const DRAWER_ANIMATION_MS = 120;
export const EDITOR_TAB_LIMIT = 5;
export const EDITOR_TAB_TEXT_BUDGET = 24 * 1024 * 1024;

export type WorkspaceDrawerPanel = "files" | "sessions" | "browser" | "editor" | "git";
export type WorkspaceEditorMode = "view" | "diff";

export type WorkspaceEditorTab = {
  id: string;
  filePath: string;
  mode: WorkspaceEditorMode;
  originalContent: string;
  modifiedContent?: string;
  allowSave: boolean;
  tabKey?: string;
  label?: string;
  preserveDrawer?: boolean;
  lastAccess: number;
};

export type WorkspaceGitDiffSnapshot = GitWorkspaceFileDiff & {
  projectId: string;
  label: string;
};

export type GitDiffLifecycleState = {
  request: number;
  snapshot: WorkspaceGitDiffSnapshot | null;
  displayMode: "modal" | "drawer";
};

/** Closing or leaving Git invalidates both the snapshot and every in-flight response. */
export function invalidateGitDiffState(state: GitDiffLifecycleState): GitDiffLifecycleState {
  return {
    request: state.request + 1,
    snapshot: null,
    displayMode: "drawer",
  };
}

export function isCurrentGitDiffResponse(input: {
  request: number;
  currentRequest: number;
  responseProjectId: string;
  activeProjectId: string | null;
}) {
  return input.request === input.currentRequest && input.responseProjectId === input.activeProjectId;
}

/** The adapter deliberately mirrors GitPanel's resource boundary, without exposing renderer state. */
export type WorkspaceGitResourceAdapter = {
  commitLog: (
    projectId: string,
    options?: { maxEntries?: number; ref?: string; allBranches?: boolean },
  ) => Promise<CommitEntry[]>;
  commitDetail: (projectId: string, ref: string) => Promise<CommitDetail | null>;
  branchCompare: (
    projectId: string,
    base: string,
    target: string,
  ) => Promise<BranchDiffResult>;
  getStatus: (projectId: string) => Promise<GitResourceGroups>;
  stageFiles: (projectId: string, paths: string[]) => Promise<void>;
  unstageFiles: (projectId: string, paths: string[]) => Promise<void>;
  discardFile: (
    projectId: string,
    group: "workingTree" | "untracked",
    path: string,
  ) => Promise<void>;
  commit: (projectId: string, message: string) => Promise<void>;
  workspaceFileDiff: (
    projectId: string,
    group: GitResourceGroupType,
    path: string,
  ) => Promise<GitWorkspaceFileDiff | null>;
  commitFileDiff: (
    projectId: string,
    hash: string,
    path: string,
    originalPath?: string,
  ) => Promise<(GitWorkspaceFileDiff & { originalPath?: string }) | null>;
};

export type WorkspaceFileAdapter = {
  readContent: (path: string) => Promise<string>;
  writeContent: (path: string, content: string) => Promise<void>;
};

export type WorkspaceExternalEditorAdapter = {
  list: () => Promise<ExternalEditor[]>;
  openProject: (editor: ExternalEditor, projectPath: string) => Promise<void>;
};

export type WorkspacePanelOptions = {
  projectId?: string | null;
  files?: WorkspaceFileAdapter;
  git?: WorkspaceGitResourceAdapter;
  editors?: WorkspaceExternalEditorAdapter;
  storage?: Pick<Storage, "getItem" | "setItem">;
  drawerStoragePrefix?: string;
  editorTabLimit?: number;
  editorTextBudget?: number;
};

export type OpenEditorTabOptions = {
  originalContent?: string;
  modifiedContent?: string;
  allowSave?: boolean;
  tabKey?: string;
  label?: string;
  preserveDrawer?: boolean;
};

export function editorTabTextBytes(tab: Pick<WorkspaceEditorTab, "originalContent" | "modifiedContent">) {
  return (tab.originalContent.length + (tab.modifiedContent?.length ?? 0)) * 2;
}

/** LRU eviction never removes the tab the caller just opened. */
export function trimEditorTabs(
  tabs: WorkspaceEditorTab[],
  protectedId: string,
  limit = EDITOR_TAB_LIMIT,
  textBudget = EDITOR_TAB_TEXT_BUDGET,
) {
  const next = [...tabs];
  let textBytes = next.reduce((sum, tab) => sum + editorTabTextBytes(tab), 0);
  while (next.length > 1 && (next.length > limit || textBytes > textBudget)) {
    const candidates = next.filter((tab) => tab.id !== protectedId);
    if (candidates.length === 0) break;
    const oldest = candidates.reduce((left, right) =>
      left.lastAccess <= right.lastAccess ? left : right,
    );
    const index = next.findIndex((tab) => tab.id === oldest.id);
    const removed = next.splice(index, 1)[0];
    if (removed) textBytes -= editorTabTextBytes(removed);
  }
  return next;
}

function makeId() {
  return globalThis.crypto?.randomUUID?.() ?? `workspace-tab-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function readDrawerState(storage: WorkspacePanelOptions["storage"], key: string) {
  if (!storage) return null;
  try {
    const parsed: unknown = JSON.parse(storage.getItem(key) ?? "null");
    if (!parsed || typeof parsed !== "object") return null;
    const value = parsed as { panel?: unknown; pinned?: unknown };
    const validPanel = value.panel === null || ["files", "sessions", "browser", "editor", "git"].includes(String(value.panel));
    return validPanel && typeof value.pinned === "boolean"
      ? { panel: value.panel as WorkspaceDrawerPanel | null, pinned: value.pinned }
      : null;
  } catch {
    return null;
  }
}

function writeDrawerState(
  storage: WorkspacePanelOptions["storage"],
  key: string,
  panel: WorkspaceDrawerPanel | null,
  pinned: boolean,
) {
  try {
    storage?.setItem(key, JSON.stringify({ panel, pinned }));
  } catch {
    // Storage is a convenience; panel commands must continue working when it is unavailable.
  }
}

export function useWorkspacePanels(options: WorkspacePanelOptions = {}) {
  const projectId = options.projectId ?? null;
  const projectIdRef = useRef(projectId);
  const filesRef = useRef(options.files);
  const gitRef = useRef(options.git);
  const editorsRef = useRef(options.editors);
  const storageRef = useRef(options.storage ?? (typeof window !== "undefined" ? window.localStorage : undefined));
  const drawerPrefixRef = useRef(options.drawerStoragePrefix ?? "pid:project-drawer:");
  const limitsRef = useRef({
    limit: options.editorTabLimit ?? EDITOR_TAB_LIMIT,
    budget: options.editorTextBudget ?? EDITOR_TAB_TEXT_BUDGET,
  });
  projectIdRef.current = projectId;
  filesRef.current = options.files;
  gitRef.current = options.git;
  editorsRef.current = options.editors;
  storageRef.current = options.storage ?? (typeof window !== "undefined" ? window.localStorage : undefined);
  limitsRef.current = {
    limit: options.editorTabLimit ?? EDITOR_TAB_LIMIT,
    budget: options.editorTextBudget ?? EDITOR_TAB_TEXT_BUDGET,
  };

  const [gitDiff, setGitDiff] = useState<WorkspaceGitDiffSnapshot | null>(null);
  const [gitDiffDisplayMode, setGitDiffDisplayMode] = useState<"modal" | "drawer">("drawer");
  const gitRequestRef = useRef(0);
  const invalidateGitDiff = useCallback(() => {
    const next = invalidateGitDiffState({
      request: gitRequestRef.current,
      snapshot: null,
      displayMode: "drawer",
    });
    gitRequestRef.current = next.request;
    setGitDiff(next.snapshot);
    setGitDiffDisplayMode(next.displayMode);
  }, []);

  const [drawer, setDrawer] = useState<WorkspaceDrawerPanel | null>(null);
  const [drawerCollapsed, setDrawerCollapsed] = useState(false);
  const [drawerPinnedByProject, setDrawerPinnedByProject] = useState<Record<string, WorkspaceDrawerPanel>>({});
  const drawerRef = useRef<WorkspaceDrawerPanel | null>(null);
  const drawerPinnedByProjectRef = useRef<Record<string, WorkspaceDrawerPanel>>({});
  const drawerPinnedPanel = projectId ? drawerPinnedByProject[projectId] : undefined;
  const drawerPinned = Boolean(drawerPinnedPanel && drawer === drawerPinnedPanel);
  const drawerPinnedRef = useRef(false);
  drawerRef.current = drawer;
  drawerPinnedByProjectRef.current = drawerPinnedByProject;
  drawerPinnedRef.current = drawerPinned;

  const loadDrawerState = useCallback((id: string) =>
    readDrawerState(storageRef.current, `${drawerPrefixRef.current}${id}`), []);
  const saveDrawerState = useCallback((id: string, panel: WorkspaceDrawerPanel | null, pinned: boolean) =>
    writeDrawerState(storageRef.current, `${drawerPrefixRef.current}${id}`, panel, pinned), []);

  useEffect(() => {
    if (!projectId) {
      setDrawer(null);
      setDrawerCollapsed(false);
      return;
    }
    const saved = loadDrawerState(projectId);
    setDrawer(saved?.panel ?? null);
    setDrawerCollapsed(false);
    setDrawerPinnedByProject((current) => {
      const next = { ...current };
      if (saved?.pinned && saved.panel) next[projectId] = saved.panel;
      else delete next[projectId];
      return next;
    });
  }, [loadDrawerState, projectId]);

  const openDrawer = useCallback((panel: WorkspaceDrawerPanel) => {
    const pinnedPanel = projectIdRef.current ? drawerPinnedByProjectRef.current[projectIdRef.current] : undefined;
    if (pinnedPanel && pinnedPanel !== panel) return;
    const next = drawerRef.current === panel && !drawerPinnedRef.current ? null : panel;
    if (next !== "git") invalidateGitDiff();
    if (projectIdRef.current) saveDrawerState(projectIdRef.current, next, Boolean(pinnedPanel && next === pinnedPanel));
    setDrawer(next);
    setDrawerCollapsed(false);
  }, [invalidateGitDiff, saveDrawerState]);

  const closeDrawer = useCallback(() => {
    if (drawerPinnedRef.current) return;
    invalidateGitDiff();
    if (projectIdRef.current) saveDrawerState(projectIdRef.current, null, false);
    setDrawer(null);
  }, [invalidateGitDiff, saveDrawerState]);

  const collapseDrawer = useCallback(() => {
    if (!drawerPinnedRef.current) setDrawerCollapsed(true);
  }, []);

  const expandDrawer = useCallback(() => setDrawerCollapsed(false), []);

  const toggleDrawerPinned = useCallback(() => {
    const id = projectIdRef.current;
    const currentDrawer = drawerRef.current;
    if (!id || !currentDrawer) return;
    const willPin = !drawerPinnedRef.current;
    setDrawerPinnedByProject((current) => {
      const next = { ...current };
      if (willPin) next[id] = currentDrawer;
      else delete next[id];
      return next;
    });
    saveDrawerState(id, currentDrawer, willPin);
  }, [saveDrawerState]);

  const [editorTabs, setEditorTabs] = useState<WorkspaceEditorTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const activeTabIdRef = useRef<string | null>(null);
  activeTabIdRef.current = activeTabId;
  const editorSequenceRef = useRef(0);
  const activeTab = useMemo(
    () => editorTabs.find((tab) => tab.id === activeTabId) ?? null,
    [activeTabId, editorTabs],
  );

  const openEditorTab = useCallback((path: string, mode: WorkspaceEditorMode, tabOptions: OpenEditorTabOptions = {}) => {
    setEditorTabs((current) => {
      const existing = current.find((tab) => tab.filePath === path && tab.tabKey === tabOptions.tabKey);
      const lastAccess = ++editorSequenceRef.current;
      if (existing) {
        const updated = {
          ...existing,
          mode,
          originalContent: tabOptions.originalContent ?? "",
          modifiedContent: tabOptions.modifiedContent,
          allowSave: tabOptions.allowSave ?? true,
          tabKey: tabOptions.tabKey,
          label: tabOptions.label,
          preserveDrawer: tabOptions.preserveDrawer ?? false,
          lastAccess,
        };
        setActiveTabId(existing.id);
        return trimEditorTabs(current.map((tab) => tab.id === existing.id ? updated : tab), existing.id, limitsRef.current.limit, limitsRef.current.budget);
      }
      const nextTab: WorkspaceEditorTab = {
        id: makeId(),
        filePath: path,
        mode,
        originalContent: tabOptions.originalContent ?? "",
        modifiedContent: tabOptions.modifiedContent,
        allowSave: tabOptions.allowSave ?? true,
        tabKey: tabOptions.tabKey,
        label: tabOptions.label,
        preserveDrawer: tabOptions.preserveDrawer ?? false,
        lastAccess,
      };
      setActiveTabId(nextTab.id);
      return trimEditorTabs([...current, nextTab], nextTab.id, limitsRef.current.limit, limitsRef.current.budget);
    });
  }, []);

  const closeEditorTab = useCallback((tabId: string) => {
    setEditorTabs((current) => {
      const index = current.findIndex((tab) => tab.id === tabId);
      if (index < 0) return current;
      const next = current.filter((tab) => tab.id !== tabId);
      if (activeTabIdRef.current === tabId) setActiveTabId(next[Math.min(index, next.length - 1)]?.id ?? null);
      return next;
    });
  }, []);

  const selectEditorTab = useCallback((tabId: string) => {
    editorSequenceRef.current += 1;
    setEditorTabs((current) => current.map((tab) => tab.id === tabId ? { ...tab, lastAccess: editorSequenceRef.current } : tab));
    setActiveTabId(tabId);
  }, []);

  const clearEditorTabs = useCallback(() => {
    setEditorTabs([]);
    setActiveTabId(null);
  }, []);

  useEffect(() => {
    if (!editorTabs.length && drawer === "editor") setDrawer(null);
  }, [drawer, editorTabs.length]);

  const readContent = useCallback((path: string) => {
    const read = filesRef.current?.readContent;
    return read ? read(path) : Promise.reject(new Error("File read service is unavailable"));
  }, []);
  const writeContent = useCallback((path: string, content: string) => {
    const write = filesRef.current?.writeContent;
    return write ? write(path, content) : Promise.reject(new Error("File write service is unavailable"));
  }, []);

  const closeGitDiff = useCallback(() => {
    invalidateGitDiff();
  }, [invalidateGitDiff]);

  const openWorkspaceFileDiff = useCallback(async (group: GitResourceGroupType, path: string) => {
    const id = projectIdRef.current;
    const request = ++gitRequestRef.current;
    const diff = id ? await gitRef.current?.workspaceFileDiff(id, group, path) : null;
    if (!id || !isCurrentGitDiffResponse({
      request,
      currentRequest: gitRequestRef.current,
      responseProjectId: id,
      activeProjectId: projectIdRef.current,
    })) return null;
    if (!diff) return null;
    setDrawer("git");
    setDrawerCollapsed(false);
    setGitDiffDisplayMode("drawer");
    setGitDiff({ ...diff, projectId: id, label: diff.path.split(/[\\/]/).pop() ?? diff.path });
    return diff;
  }, []);

  const openCommitFileDiff = useCallback(async (commit: CommitEntry, file: GitChangedFile) => {
    const id = projectIdRef.current;
    const request = ++gitRequestRef.current;
    const diff = id ? await gitRef.current?.commitFileDiff(id, commit.hash, file.path, file.originalPath) : null;
    if (!id || !isCurrentGitDiffResponse({
      request,
      currentRequest: gitRequestRef.current,
      responseProjectId: id,
      activeProjectId: projectIdRef.current,
    })) return null;
    if (!diff) return null;
    setDrawer("git");
    setDrawerCollapsed(false);
    setGitDiffDisplayMode("drawer");
    setGitDiff({ ...diff, projectId: id, label: `${diff.path.split(/[\\/]/).pop() ?? diff.path} (${commit.shortHash})` });
    return diff;
  }, []);

  const toggleGitDiffDisplayMode = useCallback(() => {
    setGitDiffDisplayMode((mode) => {
      if (mode === "drawer") return "modal";
      setDrawer("git");
      setDrawerCollapsed(false);
      return "drawer";
    });
  }, []);

  const gitPanelAdapter = useMemo<WorkspaceGitResourceAdapter>(() => ({
    commitLog: (...args) => gitRef.current?.commitLog(...args) ?? Promise.reject(new Error("Git service is unavailable")),
    commitDetail: (...args) => gitRef.current?.commitDetail(...args) ?? Promise.reject(new Error("Git service is unavailable")),
    branchCompare: (...args) => gitRef.current?.branchCompare(...args) ?? Promise.reject(new Error("Git service is unavailable")),
    getStatus: (...args) => gitRef.current?.getStatus(...args) ?? Promise.reject(new Error("Git service is unavailable")),
    stageFiles: (...args) => gitRef.current?.stageFiles(...args) ?? Promise.reject(new Error("Git service is unavailable")),
    unstageFiles: (...args) => gitRef.current?.unstageFiles(...args) ?? Promise.reject(new Error("Git service is unavailable")),
    discardFile: (...args) => gitRef.current?.discardFile(...args) ?? Promise.reject(new Error("Git service is unavailable")),
    commit: (...args) => gitRef.current?.commit(...args) ?? Promise.reject(new Error("Git service is unavailable")),
    workspaceFileDiff: (...args) => gitRef.current?.workspaceFileDiff(...args) ?? Promise.reject(new Error("Git service is unavailable")),
    commitFileDiff: (...args) => gitRef.current?.commitFileDiff(...args) ?? Promise.reject(new Error("Git service is unavailable")),
  }), []);

  const [browserFullscreen, setBrowserFullscreen] = useState(false);
  const openBrowser = useCallback(() => {
    invalidateGitDiff();
    setDrawer("browser");
    setDrawerCollapsed(false);
  }, [invalidateGitDiff]);
  const enterBrowserFullscreen = useCallback(() => setBrowserFullscreen(true), []);
  const closeBrowser = useCallback(() => setBrowserFullscreen(false), []);
  const minimizeBrowser = useCallback(() => {
    setBrowserFullscreen(false);
    openBrowser();
  }, [openBrowser]);

  const [externalEditors, setExternalEditors] = useState<ExternalEditor[]>([]);
  const [externalEditorsOpen, setExternalEditorsOpen] = useState(false);
  const [externalEditorsAnchor, setExternalEditorsAnchor] = useState<{ x: number; y: number } | null>(null);
  const [externalEditorsTargetPath, setExternalEditorsTargetPath] = useState<string | null>(null);
  const editorRequestRef = useRef(0);
  const loadExternalEditors = useCallback(async (forProjectId = projectIdRef.current) => {
    const request = ++editorRequestRef.current;
    const list = await editorsRef.current?.list();
    if (request !== editorRequestRef.current || projectIdRef.current !== forProjectId) return [];
    const next = list ?? [];
    setExternalEditors(next);
    return next;
  }, []);
  const openExternalEditorChooser = useCallback((projectPath: string, anchor?: { x: number; y: number }) => {
    setExternalEditorsTargetPath(projectPath);
    setExternalEditorsAnchor(anchor ?? null);
    setExternalEditorsOpen(true);
    void loadExternalEditors();
  }, [loadExternalEditors]);
  const closeExternalEditorChooser = useCallback(() => {
    editorRequestRef.current += 1;
    setExternalEditorsOpen(false);
    setExternalEditorsAnchor(null);
    setExternalEditorsTargetPath(null);
  }, []);
  const externalEditorsTargetPathRef = useRef<string | null>(null);
  externalEditorsTargetPathRef.current = externalEditorsTargetPath;
  const openProjectInExternalEditor = useCallback(async (editor: ExternalEditor) => {
    const id = projectIdRef.current;
    const path = externalEditorsTargetPathRef.current;
    const request = ++editorRequestRef.current;
    if (!path || !editorsRef.current) return;
    setExternalEditorsOpen(false);
    await editorsRef.current.openProject(editor, path);
    if (request !== editorRequestRef.current || projectIdRef.current !== id) return;
    setExternalEditorsAnchor(null);
    setExternalEditorsTargetPath(null);
  }, []);

  useEffect(() => {
    invalidateGitDiff();
    editorRequestRef.current += 1;
    setBrowserFullscreen(false);
    setExternalEditorsOpen(false);
    setExternalEditorsAnchor(null);
    setExternalEditorsTargetPath(null);
  }, [invalidateGitDiff, projectId]);

  return {
    drawer,
    drawerCollapsed,
    drawerPinned,
    drawerPinnedPanel,
    openDrawer,
    closeDrawer,
    collapseDrawer,
    expandDrawer,
    toggleDrawerPinned,
    editorTabs,
    activeTab,
    activeTabId,
    openEditorTab,
    closeEditorTab,
    selectEditorTab,
    clearEditorTabs,
    editorIo: { readContent, writeContent },
    gitDiff,
    gitDiffDisplayMode,
    closeGitDiff,
    openWorkspaceFileDiff,
    openCommitFileDiff,
    toggleGitDiffDisplayMode,
    gitPanelAdapter,
    browserFullscreen,
    openBrowser,
    enterBrowserFullscreen,
    closeBrowser,
    minimizeBrowser,
    externalEditors,
    externalEditorsOpen,
    externalEditorsAnchor,
    externalEditorsTargetPath,
    loadExternalEditors,
    openExternalEditorChooser,
    closeExternalEditorChooser,
    openProjectInExternalEditor,
  };
}
