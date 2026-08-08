import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  AgentTab,
  CommitEntry,
  GitChangedFile,
  GitResourceGroupType,
  Project,
} from "../../../shared/types";
import type {
  WorkspaceContentOpenMode,
} from "../../../shared/types/settings";
import type { DrawerPanel, SessionModifiedFile } from "../components/app/AppParts";

function isAbsoluteFilePath(path: string) {
  return /^[A-Za-z]:[\\/]/.test(path) || path.startsWith("/");
}

const EDITOR_TAB_LIMIT = 5;
const EDITOR_TAB_TEXT_BUDGET = 24 * 1024 * 1024;

interface EditorTab {
  id: string;
  filePath: string;
  mode: "view" | "diff";
  originalContent: string;
  modifiedContent?: string;
  allowSave: boolean;
  tabKey?: string;
  label?: string;
  preserveDrawer?: boolean;
  lastAccess: number;
}

interface GitDrawerDiff {
  projectId: string;
  filePath: string;
  originalContent: string;
  modifiedContent: string;
  label: string;
}

export function resolveFileLinkPath(path: string, basePath?: string) {
  if (!path || isAbsoluteFilePath(path) || !basePath) return path;
  const separator = basePath.includes("\\") ? "\\" : "/";
  return `${basePath.replace(/[\\/]+$/, "")}${separator}${path.replace(/^[\\/]+/, "")}`;
}

export interface UseFileEditorInput {
  activeProjectId: string | undefined;
  activeProjectIdRef: React.MutableRefObject<string | undefined>;
  activeAgent: AgentTab | null;
  activeProject: Project | null;
  drawer: DrawerPanel | null;
  modifiedFiles: SessionModifiedFile[];
  setDrawer: (panel: DrawerPanel | null) => void;
  setDrawerCollapsed: (collapsed: boolean) => void;
  /** 设置中的默认打开方式；每次新打开文件/Diff 时采用 */
  contentOpenMode: WorkspaceContentOpenMode;
  showToast: (message: string, duration?: number) => void;
  /** 读取文件内容的 API；maxBytes 用于编辑器大文件前置拦截（主进程 stat 检查，不传输超限内容） */
  readFileContent: (path: string, maxBytes?: number) => Promise<string>;
  /** 读取 Git 原始内容的 API */
  readGitOriginalContent: (path: string) => Promise<string>;
  /** 保存文件内容的 API */
  writeFileContent: (path: string, content: string) => Promise<void>;
  /** 系统打开文件 */
  openFile: (path: string) => Promise<void>;
  /** 获取 Git 工作区差异 */
  workspaceFileDiff: (
    projectId: string,
    group: GitResourceGroupType,
    path: string,
  ) => Promise<{
    path: string;
    originalContent: string;
    modifiedContent: string;
  } | null>;
  /** 获取 Git 提交文件差异 */
  commitFileDiff: (
    projectId: string,
    hash: string,
    path: string,
    originalPath?: string,
  ) => Promise<{
    path: string;
    originalContent: string;
    modifiedContent: string;
  } | null>;
  /** 翻译函数 */
  t: (...args: any[]) => string;
}

export interface UseFileEditorOutput {
  /** 中间栏内容布局：分屏或占满中间栏（不再进侧栏抽屉） */
  editorMode: WorkspaceContentOpenMode;
  toggleEditorMode: () => void;
  editorTabs: EditorTab[];
  activeTabId: string | null;
  activeTab: EditorTab | null;
  editorTabAccessSequenceRef: React.MutableRefObject<number>;
  readEditorFileContent: (path: string, maxBytes?: number) => Promise<string>;
  readEditorOriginalContent: (path: string) => Promise<string>;
  saveEditorFileContent: (path: string, content: string) => Promise<void>;
  openEditorTab: (
    path: string,
    mode: "view" | "diff",
    originalContent?: string,
    modifiedContent?: string,
    allowSave?: boolean,
    tabKey?: string,
    label?: string,
    preserveDrawer?: boolean,
  ) => void;
  closeEditorTab: (tabId: string) => void;
  selectEditorTab: (tabId: string) => void;
  openFilePath: (path: string) => void;
  viewFilePath: (path: string) => void;
  diffFilePath: (path: string, originalContent?: string, content?: string) => void;
  openWorkspaceFileDiff: (group: GitResourceGroupType, path: string) => Promise<void>;
  openCommitFileDiff: (
    commit: CommitEntry,
    file: GitChangedFile,
  ) => Promise<void>;
  closeGitDiff: () => void;
  gitDiffDisplayMode: WorkspaceContentOpenMode;
  gitDrawerDiff: GitDrawerDiff | null;
  toggleGitDiffDisplayMode: () => void;
  closeEditor: () => void;
  prevDrawerPanelRef: React.MutableRefObject<DrawerPanel | null>;
  clearEditorBack: () => DrawerPanel | null;
  gitDiffRequestSequenceRef: React.MutableRefObject<number>;
}

export function useFileEditor(input: UseFileEditorInput): UseFileEditorOutput {
  const {
    activeProjectId,
    activeProjectIdRef,
    activeAgent,
    activeProject,
    drawer,
    modifiedFiles,
    setDrawer,
    setDrawerCollapsed,
    contentOpenMode,
    showToast,
    readFileContent,
    readGitOriginalContent,
    writeFileContent,
    openFile,
    workspaceFileDiff,
    commitFileDiff,
    t,
  } = input;

  const contentOpenModeRef = useRef(contentOpenMode);
  contentOpenModeRef.current = contentOpenMode;

  // ---- 中间栏内容布局（split | maximize）----
  const [editorMode, setEditorMode] = useState<WorkspaceContentOpenMode>(contentOpenMode);
  const editorModeRef = useRef<WorkspaceContentOpenMode>(contentOpenMode);
  const toggleEditorMode = useCallback(() => {
    const next: WorkspaceContentOpenMode =
      editorModeRef.current === "maximize" ? "split" : "maximize";
    editorModeRef.current = next;
    setEditorMode(next);
  }, []);

  // ---- Git diff state（展示在中间栏 ContentHost，不再叠在抽屉里）----
  const gitDiffRequestSequenceRef = useRef(0);
  const [gitDrawerDiff, setGitDrawerDiff] = useState<GitDrawerDiff | null>(null);
  const [gitDiffDisplayMode, setGitDiffDisplayMode] =
    useState<WorkspaceContentOpenMode>(contentOpenMode);

  const closeGitDiff = useCallback(() => {
    gitDiffRequestSequenceRef.current += 1;
    setGitDrawerDiff(null);
    setGitDiffDisplayMode(contentOpenModeRef.current);
  }, []);

  const toggleGitDiffDisplayMode = useCallback(() => {
    setGitDiffDisplayMode((mode) => (mode === "maximize" ? "split" : "maximize"));
  }, []);

  useEffect(() => {
    gitDiffRequestSequenceRef.current += 1;
    setGitDrawerDiff(null);
    setGitDiffDisplayMode(contentOpenModeRef.current);
  }, [activeProjectId]);

  // ---- editor tabs ----
  const editorTabAccessSequenceRef = useRef(0);
  const [editorTabs, setEditorTabs] = useState<EditorTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  // tabs 同步 ref：openEditorTab/closeEditorTab 需要在 updater 外计算 next——
  // StrictMode 双调用 updater 内的 crypto.randomUUID/setActiveTabId 会产生两个
  // 不同 id，导致 activeTabId 与 editorTabs 不一致 → 首次打开文件空白
  const editorTabsRef = useRef<EditorTab[]>([]);
  editorTabsRef.current = editorTabs;
  const activeTab = useMemo(
    () => editorTabs.find((t) => t.id === activeTabId) ?? null,
    [editorTabs, activeTabId],
  );

  // ---- IO callbacks ----
  const readEditorFileContent = useCallback(
    (path: string, maxBytes?: number) => readFileContent(path, maxBytes),
    [readFileContent],
  );
  const readEditorOriginalContent = useCallback(
    (path: string) => readGitOriginalContent(path),
    [readGitOriginalContent],
  );
  const saveEditorFileContent = useCallback(
    (path: string, content: string) => writeFileContent(path, content),
    [writeFileContent],
  );

  // ---- tab management helpers ----
  const editorTabTextBytes = (tab: EditorTab) =>
    (tab.originalContent.length + (tab.modifiedContent?.length ?? 0)) * 2;

  const trimEditorTabs = (tabs: EditorTab[], protectedId: string) => {
    const next = [...tabs];
    let textBytes = next.reduce(
      (sum, tab) => sum + editorTabTextBytes(tab),
      0,
    );
    while (
      next.length > 1 &&
      (next.length > EDITOR_TAB_LIMIT || textBytes > EDITOR_TAB_TEXT_BUDGET)
    ) {
      const candidates = next.filter((tab) => tab.id !== protectedId);
      if (candidates.length === 0) break;
      const oldest = candidates.reduce((left, right) =>
        left.lastAccess <= right.lastAccess ? left : right,
      );
      const index = next.findIndex((tab) => tab.id === oldest.id);
      const [removed] = next.splice(index, 1);
      if (removed) textBytes -= editorTabTextBytes(removed);
    }
    return next;
  };

  const openEditorTab = useCallback(
    (
      path: string,
      mode: "view" | "diff",
      originalContent?: string,
      modifiedContent?: string,
      allowSave = true,
      tabKey?: string,
      label?: string,
      preserveDrawer = false,
    ) => {
      // updater 纯化：StrictMode 双调用下，updater 内 crypto.randomUUID/嵌套
      // setState 会产生两个不同 id → activeTabId 与 editorTabs 不一致 → 首次空白。
      // 改为在闭包内读同步 ref 计算 next，setState 传值（幂等，双调用安全）
      const prev = editorTabsRef.current;
      const existing = prev.find(
        (t) => t.filePath === path && t.tabKey === tabKey,
      );
      if (existing) {
        const updated = {
          ...existing,
          mode,
          originalContent: originalContent ?? "",
          modifiedContent,
          allowSave,
          tabKey,
          label,
          preserveDrawer,
          lastAccess: ++editorTabAccessSequenceRef.current,
        };
        setEditorTabs(
          trimEditorTabs(
            prev.map((tab) => (tab.id === existing.id ? updated : tab)),
            existing.id,
          ),
        );
        setActiveTabId(existing.id);
        return;
      }
      const newTab: EditorTab = {
        id: crypto.randomUUID(),
        filePath: path,
        mode,
        originalContent: originalContent ?? "",
        modifiedContent,
        allowSave,
        tabKey,
        label,
        preserveDrawer,
        lastAccess: ++editorTabAccessSequenceRef.current,
      };
      setEditorTabs(trimEditorTabs([...prev, newTab], newTab.id));
      setActiveTabId(newTab.id);
    },
    [],
  );

  const closeEditorTab = useCallback(
    (tabId: string) => {
      // updater 纯化（同上）：副作用移出
      const prev = editorTabsRef.current;
      const idx = prev.findIndex((t) => t.id === tabId);
      if (idx < 0) return;
      const next = prev.filter((t) => t.id !== tabId);
      setEditorTabs(next);
      if (next.length === 0) {
        setActiveTabId(null);
        // 关闭最后一个 tab 后复位为设置默认布局，避免残留 maximize
        editorModeRef.current = contentOpenModeRef.current;
        setEditorMode(contentOpenModeRef.current);
      } else if (tabId === activeTabId) {
        const neighborIdx = Math.min(idx, next.length - 1);
        setActiveTabId(next[neighborIdx].id);
      }
    },
    [activeTabId],
  );

  const selectEditorTab = useCallback((tabId: string) => {
    setEditorTabs((current) =>
      current.map((tab) =>
        tab.id === tabId
          ? { ...tab, lastAccess: ++editorTabAccessSequenceRef.current }
          : tab,
      ),
    );
    setActiveTabId(tabId);
  }, []);

  // ---- drawer panel restore ref ----
  const prevDrawerPanelRef = useRef<DrawerPanel | null>(null);

  const clearEditorBack = useCallback(() => {
    const prev = prevDrawerPanelRef.current;
    prevDrawerPanelRef.current = null;
    setActiveTabId(null);
    setEditorTabs([]);
    return prev;
  }, []);

  const closeEditor = useCallback(() => {
    setActiveTabId(null);
    setEditorTabs([]);
    editorModeRef.current = contentOpenModeRef.current;
    setEditorMode(contentOpenModeRef.current);
  }, []);

  // 注意：不要在 tab 清空时自动 setDrawer(null)。编辑器 rail 仍是活动栏入口，
  // 空 tab 时由 DrawerSurface 渲染空状态引导；阅读面已迁到中间栏 ContentHost。

  // ---- file actions ----
  const openFilePath = useCallback(
    (path: string) => {
      const resolvedPath = resolveFileLinkPath(
        path,
        activeAgent?.cwd ?? activeProject?.path,
      );
      void openFile(resolvedPath).catch((error) => {
        showToast(
          t("app.openFileFailed", {
            error: error instanceof Error ? error.message : String(error),
          }),
        );
      });
    },
    [activeAgent?.cwd, activeProject?.path, openFile, showToast, t],
  );

  const viewFilePath = useCallback(
    (path: string) => {
      closeGitDiff();
      openEditorTab(path, "view");
      const mode = contentOpenModeRef.current;
      editorModeRef.current = mode;
      setEditorMode(mode);
      // 阅读面进中间栏；抽屉保持文件树导航，不再切到 editor 面板
      prevDrawerPanelRef.current = drawer;
    },
    [drawer, openEditorTab, closeGitDiff],
  );

  const diffFilePath = useCallback(
    (path: string, originalContent?: string, content?: string) => {
      const modified = modifiedFiles.find((f) => f.path === path);
      const resolvedOriginal =
        originalContent ?? modified?.originalContent ?? "";
      const resolvedModified = content ?? modified?.content ?? undefined;
      closeGitDiff();
      const mode = contentOpenModeRef.current;
      editorModeRef.current = mode;
      setEditorMode(mode);
      openEditorTab(path, "diff", resolvedOriginal, resolvedModified);
    },
    [modifiedFiles, closeGitDiff, openEditorTab],
  );

  const openWorkspaceFileDiffFn = useCallback(
    async (group: GitResourceGroupType, path: string) => {
      if (!activeProjectId) return;
      const projectId = activeProjectId;
      const request = ++gitDiffRequestSequenceRef.current;
      try {
        const diff = await workspaceFileDiff(projectId, group, path);
        if (
          activeProjectIdRef.current !== projectId ||
          request !== gitDiffRequestSequenceRef.current
        )
          return;
        if (!diff) {
          showToast(t("git.workspaceDiffUnavailable"));
          return;
        }
        const groupLabel =
          group === "index"
            ? t("git.stagedChanges")
            : group === "merge"
              ? t("git.mergeChanges")
              : t("git.changes");
        const mode = contentOpenModeRef.current;
        setGitDiffDisplayMode(mode);
        setGitDrawerDiff({
          projectId,
          filePath: diff.path,
          originalContent: diff.originalContent,
          modifiedContent: diff.modifiedContent,
          label: `${diff.path.split(/[/\\]/).pop() ?? diff.path} (${groupLabel})`,
        });
      } catch (error) {
        if (
          activeProjectIdRef.current === projectId &&
          request === gitDiffRequestSequenceRef.current
        ) {
          showToast(
            error instanceof Error ? error.message : String(error),
          );
        }
      }
    },
    [
      activeProjectId,
      activeProjectIdRef,
      workspaceFileDiff,
      showToast,
      t,
    ],
  );

  const openCommitFileDiffFn = useCallback(
    async (commit: CommitEntry, file: GitChangedFile) => {
      if (!activeProjectId) return;
      const projectId = activeProjectId;
      const request = ++gitDiffRequestSequenceRef.current;
      try {
        const diff = await commitFileDiff(
          projectId,
          commit.hash,
          file.path,
          file.originalPath,
        );
        if (
          activeProjectIdRef.current !== projectId ||
          request !== gitDiffRequestSequenceRef.current
        )
          return;
        if (!diff) {
          showToast(t("git.fileDiffUnavailable"));
          return;
        }
        const mode = contentOpenModeRef.current;
        setGitDiffDisplayMode(mode);
        setGitDrawerDiff({
          projectId,
          filePath: diff.path,
          originalContent: diff.originalContent,
          modifiedContent: diff.modifiedContent,
          label: `${diff.path.split(/[/\\]/).pop() ?? diff.path} (${commit.shortHash})`,
        });
      } catch (error) {
        if (
          activeProjectIdRef.current === projectId &&
          request === gitDiffRequestSequenceRef.current
        ) {
          showToast(
            error instanceof Error ? error.message : String(error),
          );
        }
      }
    },
    [
      activeProjectId,
      activeProjectIdRef,
      commitFileDiff,
      showToast,
      t,
    ],
  );

  return {
    editorMode,
    toggleEditorMode,
    editorTabs,
    activeTabId,
    activeTab,
    editorTabAccessSequenceRef,
    readEditorFileContent,
    readEditorOriginalContent,
    saveEditorFileContent,
    openEditorTab,
    closeEditorTab,
    selectEditorTab,
    openFilePath,
    viewFilePath,
    diffFilePath,
    openWorkspaceFileDiff: openWorkspaceFileDiffFn,
    openCommitFileDiff: openCommitFileDiffFn,
    closeGitDiff,
    gitDiffDisplayMode,
    gitDrawerDiff,
    toggleGitDiffDisplayMode,
    gitDiffRequestSequenceRef,
    prevDrawerPanelRef,
    clearEditorBack,
    closeEditor,
  };
}
