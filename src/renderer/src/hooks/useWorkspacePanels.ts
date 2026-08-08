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

export type WorkspaceExternalEditorAdapter = {
  list: () => Promise<ExternalEditor[]>;
  openProject: (editor: ExternalEditor, projectPath: string) => Promise<void>;
};

export type WorkspacePanelOptions = {
  projectId?: string | null;
  git?: WorkspaceGitResourceAdapter;
  editors?: WorkspaceExternalEditorAdapter;
};

export function useWorkspacePanels(options: WorkspacePanelOptions = {}) {
  const projectId = options.projectId ?? null;
  const projectIdRef = useRef(projectId);
  projectIdRef.current = projectId;
  const gitRef = useRef(options.git);
  const editorsRef = useRef(options.editors);
  gitRef.current = options.git;
  editorsRef.current = options.editors;

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
  const drawerRef = useRef<WorkspaceDrawerPanel | null>(null);
  drawerRef.current = drawer;

  // 项目上下文水合（null → 首个 projectId）不得视为「切换项目」：
  // 用户在水合完成前已手动打开的抽屉不要被重置误关。
  // 换项目时一律关闭右侧抽屉（默认关闭，仅用户主动打开）。
  const prevProjectIdRef = useRef<string | null>(null);
  useEffect(() => {
    const prevProjectId = prevProjectIdRef.current;
    prevProjectIdRef.current = projectId;
    const isInitialHydration = prevProjectId === null;
    if (!projectId) {
      if (!isInitialHydration) {
        setDrawer(null);
        setDrawerCollapsed(false);
      }
      return;
    }
    if (!isInitialHydration || !drawerRef.current) {
      setDrawer(null);
      setDrawerCollapsed(false);
    }
  }, [projectId]);

  const openDrawer = useCallback((panel: WorkspaceDrawerPanel) => {
    const next = drawerRef.current === panel ? null : panel;
    if (next !== "git") invalidateGitDiff();
    setDrawer(next);
    setDrawerCollapsed(false);
  }, [invalidateGitDiff]);

  /**
   * 强制打开面板（不 toggle）：外部入口（如消息链接“在浏览器打开”）需要确保
   * browser 面板打开；openDrawer 在已是同一面板且展开时会关闭抽屉，导致
   * 首次点击关抽屉、二次点击才打开且 tab 重复入栈。
   */
  const openDrawerForce = useCallback((panel: WorkspaceDrawerPanel) => {
    if (panel !== "git") invalidateGitDiff();
    setDrawer(panel);
    setDrawerCollapsed(false);
  }, [invalidateGitDiff]);

  const closeDrawer = useCallback(() => {
    invalidateGitDiff();
    setDrawer(null);
  }, [invalidateGitDiff]);

  const collapseDrawer = useCallback(() => {
    setDrawerCollapsed(true);
  }, []);

  const expandDrawer = useCallback(() => setDrawerCollapsed(false), []);

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
  /**
   * 关闭浏览器面板（全屏 X / 关闭最后一个 tab 统一入口）：
   * 退出全屏并收起浏览器抽屉。区别于 minimizeBrowser（仅退出全屏、保留抽屉）。
   * 此前只 setBrowserFullscreen(false)，抽屉模式下是空操作，导致关最后一个 tab 时侧边栏无法收起。
   */
  const closeBrowser = useCallback(() => {
    setBrowserFullscreen(false);
    closeDrawer();
  }, [closeDrawer]);
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
    openDrawer,
    openDrawerForce,
    closeDrawer,
    collapseDrawer,
    expandDrawer,
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
