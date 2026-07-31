import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  AgentTab,
  CommitEntry,
  GitChangedFile,
  GitResourceGroupType,
  Project,
} from "../../../shared/types";
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

function resolveFileLinkPath(path: string, basePath?: string) {
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
  showToast: (message: string, duration?: number) => void;
  /** 读取文件内容的 API */
  readFileContent: (path: string) => Promise<string>;
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
  editorMode: "modal" | "drawer";
  toggleEditorMode: () => void;
  editorTabs: EditorTab[];
  activeTabId: string | null;
  activeTab: EditorTab | null;
  editorTabAccessSequenceRef: React.MutableRefObject<number>;
  readEditorFileContent: (path: string) => Promise<string>;
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
  gitDiffDisplayMode: "modal" | "drawer";
  gitDrawerDiff: GitDrawerDiff | null;
  toggleGitDiffDisplayMode: () => void;
  gitDiffRequestSequenceRef: React.MutableRefObject<number>;
  prevDrawerPanelRef: React.MutableRefObject<DrawerPanel | null>;
  clearEditorBack: () => DrawerPanel | null;
  closeEditor: () => void;
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
    showToast,
    readFileContent,
    readGitOriginalContent,
    writeFileContent,
    openFile,
    workspaceFileDiff,
    commitFileDiff,
    t,
  } = input;

  // ---- editor mode ----
  const [editorMode, setEditorMode] = useState<"modal" | "drawer">("drawer");
  const toggleEditorMode = useCallback(() => {
    setEditorMode((prev) => {
      const next = prev === "modal" ? "drawer" : "modal";
      if (next === "drawer") {
        setDrawer("editor");
        setDrawerCollapsed(false);
      }
      return next;
    });
  }, [setDrawer, setDrawerCollapsed]);

  // ---- Git diff state ----
  const gitDiffRequestSequenceRef = useRef(0);
  const [gitDrawerDiff, setGitDrawerDiff] = useState<GitDrawerDiff | null>(null);
  const [gitDiffDisplayMode, setGitDiffDisplayMode] = useState<"modal" | "drawer">("drawer");

  const closeGitDiff = useCallback(() => {
    gitDiffRequestSequenceRef.current += 1;
    setGitDrawerDiff(null);
    setGitDiffDisplayMode("drawer");
  }, []);

  const toggleGitDiffDisplayMode = useCallback(() => {
    if (gitDiffDisplayMode === "drawer") {
      setEditorMode("drawer");
      setGitDiffDisplayMode("modal");
      return;
    }
    setDrawer("git");
    setDrawerCollapsed(false);
    setGitDiffDisplayMode("drawer");
  }, [gitDiffDisplayMode, setDrawer, setDrawerCollapsed]);

  useEffect(() => {
    gitDiffRequestSequenceRef.current += 1;
    setGitDrawerDiff(null);
    setGitDiffDisplayMode("drawer");
  }, [activeProjectId]);

  useEffect(() => {
    if (drawer !== "git" && gitDiffDisplayMode === "drawer") {
      gitDiffRequestSequenceRef.current += 1;
      if (gitDrawerDiff) setGitDrawerDiff(null);
    }
  }, [drawer, gitDiffDisplayMode, gitDrawerDiff]);

  // ---- editor tabs ----
  const editorTabAccessSequenceRef = useRef(0);
  const [editorTabs, setEditorTabs] = useState<EditorTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const activeTab = useMemo(
    () => editorTabs.find((t) => t.id === activeTabId) ?? null,
    [editorTabs, activeTabId],
  );

  // ---- IO callbacks ----
  const readEditorFileContent = useCallback(
    (path: string) => readFileContent(path),
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
      setEditorTabs((prev) => {
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
          setActiveTabId(existing.id);
          return trimEditorTabs(
            prev.map((tab) => (tab.id === existing.id ? updated : tab)),
            existing.id,
          );
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
        const next = trimEditorTabs([...prev, newTab], newTab.id);
        setActiveTabId(newTab.id);
        return next;
      });
    },
    [],
  );

  const closeEditorTab = useCallback(
    (tabId: string) => {
      setEditorTabs((prev) => {
        const idx = prev.findIndex((t) => t.id === tabId);
        if (idx < 0) return prev;
        const next = prev.filter((t) => t.id !== tabId);
        if (next.length === 0) {
          setActiveTabId(null);
        } else if (tabId === activeTabId) {
          const neighborIdx = Math.min(idx, next.length - 1);
          setActiveTabId(next[neighborIdx].id);
        }
        return next;
      });
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
  }, []);

  useEffect(() => {
    if (editorTabs.length === 0 && drawer === "editor") {
      setDrawer(null);
    }
  }, [editorTabs.length, drawer, setDrawer]);

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
      openEditorTab(path, "view");
      if (editorMode === "drawer") {
        prevDrawerPanelRef.current = drawer;
        setDrawer("editor");
        setDrawerCollapsed(false);
      }
    },
    [editorMode, drawer, setDrawer, setDrawerCollapsed, openEditorTab],
  );

  const diffFilePath = useCallback(
    (path: string, originalContent?: string, content?: string) => {
      const modified = modifiedFiles.find((f) => f.path === path);
      const resolvedOriginal =
        originalContent ?? modified?.originalContent ?? "";
      const resolvedModified = content ?? modified?.content ?? undefined;
      closeGitDiff();
      setEditorMode("modal");
      setDrawer(null);
      openEditorTab(path, "diff", resolvedOriginal, resolvedModified);
    },
    [modifiedFiles, closeGitDiff, setDrawer, openEditorTab],
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
        setEditorMode("drawer");
        setGitDiffDisplayMode("drawer");
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
        setEditorMode("drawer");
        setGitDiffDisplayMode("drawer");
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
