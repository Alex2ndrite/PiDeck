import { Suspense } from "react";
import { Minus, X } from "lucide-react";
import { FileDiffViewer } from "../app/FileDiffViewer";
import { BrowserSurface } from "./BrowserSurface";
import { GitPanel } from "../app/GitPanel";
import { DrawerContent } from "../app/AppParts";
import { LazyWrapper } from "../../hooks/useLazyComponent";
import type { WorkspaceDrawerPanel } from "../../hooks/useWorkspacePanels";

export interface DrawerSurfaceProps {
  // ---- Editor ----
  editorMode: string;
  activeTab: any;
  activeTabId: string | null;
  editorTabs: any[];
  toggleEditorMode: () => void;
  selectEditorTab: (id: string) => void;
  closeEditorTab: (id: string) => void;
  closeEditor: () => void;
  readEditorFileContent: (path: string) => Promise<string>;
  readEditorOriginalContent: any;
  saveEditorFileContent: ((path: string, content: string) => Promise<void>) | undefined;
  prevDrawerPanelRef: React.MutableRefObject<WorkspaceDrawerPanel | null>;
  clearEditorBack: () => WorkspaceDrawerPanel | null;

  // ---- Browser ----
  browserFullscreen: boolean;

  // ---- Git ----
  enableGitManagement: boolean;
  activeProjectId: string | undefined;
  gitDrawerDiff: any;
  gitDiffDisplayMode: string;
  openCommitFileDiff: any;
  openWorkspaceFileDiff: any;
  toggleGitDiffDisplayMode: () => void;
  closeGitDiff: () => void;
  gitApi: any;
  gitInfo: any;
  switchBranch: any;
  createBranch: any;

  // ---- Drawer ----
  drawer: WorkspaceDrawerPanel | null;
  drawerCollapsed: boolean;
  drawerPinned: boolean;

  // ---- Workspace actions ----
  onOpenDrawer: (panel: WorkspaceDrawerPanel) => void;
  onCloseDrawer: () => void;
  onCollapseDrawer: () => void;
  onToggleDrawerPin: () => void;
  onCloseBrowser: () => void;
  onMinimizeBrowser: () => void;
  onEnterBrowserFullscreen: () => void;

  // ---- Generic panel ----
  sessionsProject: any;
  sessionsProjectId: string | undefined;
  files: any[];
  sessions: any[];
  sessionSourceFilter: Record<string, Set<string> | null>;
  sessionHistoryLoading: boolean;
  expandedDirs: Set<string>;
  onToggleDirectory: (dir: string) => void;
  onCollapseAllDirectories: () => void;
  setFileMenu: any;
  refreshFiles: any;
  projects: any[];
  refreshProjectSessions: any;
  runOpenSidebarSession: any;
  isSameSessionPath: any;
  runCopySession: any;
  runExportHistorySession: any;
  runDeleteHistorySession: any;
  viewFilePath: any;
  openFilePath: any;
  api: any;
  t: any;
  maxEditorFileSizeMB: number;
}

export function DrawerSurface(props: DrawerSurfaceProps) {
  const {
    editorMode, activeTab, activeTabId, editorTabs,
    toggleEditorMode, selectEditorTab, closeEditorTab, closeEditor,
    readEditorFileContent, readEditorOriginalContent, saveEditorFileContent,
    prevDrawerPanelRef, clearEditorBack,
    browserFullscreen,
    enableGitManagement, activeProjectId,
    gitDrawerDiff, gitDiffDisplayMode,
    openCommitFileDiff, openWorkspaceFileDiff,
    toggleGitDiffDisplayMode, closeGitDiff,
    gitApi, gitInfo, switchBranch, createBranch,
    drawer, drawerCollapsed, drawerPinned,
    onOpenDrawer, onCloseDrawer, onCollapseDrawer, onToggleDrawerPin,
    onCloseBrowser, onMinimizeBrowser, onEnterBrowserFullscreen,
    sessionsProject, sessionsProjectId,
    files, sessions, sessionSourceFilter, sessionHistoryLoading,
    expandedDirs, onToggleDirectory, onCollapseAllDirectories,
    setFileMenu, refreshFiles, projects, refreshProjectSessions,
    runOpenSidebarSession, isSameSessionPath,
    runCopySession, runExportHistorySession, runDeleteHistorySession,
    viewFilePath, openFilePath,
    api, t, maxEditorFileSizeMB,
  } = props;

  const theme: "dark" | "light" =
    typeof document !== "undefined" && document.documentElement.dataset.theme === "dark"
      ? "dark"
      : "light";

  return (
    <>
      {editorMode === "drawer" && drawer === "editor" && !drawerCollapsed && activeTab ? (
        <Suspense fallback={<div className="drawer-content-frame"><div className="file-diff-loading">Loading...</div></div>}>
          <FileDiffViewer
            displayMode="drawer"
            filePath={activeTab.filePath}
            mode={activeTab.mode}
            onToggleMode={activeTab.preserveDrawer ? undefined : toggleEditorMode}
            onBack={prevDrawerPanelRef.current && prevDrawerPanelRef.current !== "editor" ? () => {
              const prev = clearEditorBack();
              if (prev) onOpenDrawer(prev);
            } : undefined}
            originalContent={activeTab.mode === "diff" ? activeTab.originalContent : undefined}
            modifiedContent={activeTab.modifiedContent}
            tabs={editorTabs}
            activeTabId={activeTabId}
            onSelectTab={selectEditorTab}
            onCloseTab={closeEditorTab}
            onClose={() => { closeEditor(); onCloseDrawer(); }}
            readContent={readEditorFileContent}
            readOriginalContent={readEditorOriginalContent}
            saveContent={activeTab.allowSave ? saveEditorFileContent : undefined}
            theme={theme}
            maxFileSizeMB={maxEditorFileSizeMB}
          />
        </Suspense>
      ) : drawer === "browser" && !drawerCollapsed ? (
        <BrowserSurface
          fullscreen={browserFullscreen}
          onClose={onCloseBrowser}
          onMinimize={onMinimizeBrowser}
          onEnterFullscreen={onEnterBrowserFullscreen}
        />
      ) : enableGitManagement && drawer === "git" && !drawerCollapsed && activeProjectId ? (
        <div className="drawer-content-frame">
          <div className="drawer-header">
            <strong>{t("drawer.sourceControl")}</strong>
            <div className="drawer-header-actions">
              <button onClick={onCollapseDrawer} title={t("drawer.collapsePanel")}>
                <Minus size={15} />
              </button>
              <button onClick={onCloseDrawer} title={t("common.close")}>
                <X size={15} />
              </button>
            </div>
          </div>
          <div className="git-drawer-stack" data-detail-open={Boolean(gitDrawerDiff && gitDiffDisplayMode === "drawer")}>
            <div className="git-drawer-source" aria-hidden={Boolean(gitDrawerDiff && gitDiffDisplayMode === "drawer")}>
              <GitPanel
                projectId={activeProjectId}
                commitLog={gitApi.commitLog}
                commitDetail={gitApi.commitDetail}
                onOpenCommitFileDiff={openCommitFileDiff}
                onOpenWorkspaceFileDiff={openWorkspaceFileDiff}
                branchCompare={gitApi.branchCompare}
                getStatus={gitApi.status}
                stageFiles={gitApi.stage}
                unstageFiles={gitApi.unstage}
                discardFile={gitApi.discard}
                commit={gitApi.commit}
                branches={gitInfo.branches}
                currentBranch={gitInfo.current}
                onSwitchBranch={switchBranch}
                onCreateBranch={createBranch}
                cherryPick={gitApi.cherryPick}
                revert={gitApi.revert}
                reset={gitApi.reset}
                dropCommit={gitApi.dropCommit}
                generateCommitMessage={gitApi.generateCommitMessage}
                gitInit={gitApi.init}
              />
            </div>
            {gitDrawerDiff && gitDrawerDiff.projectId === activeProjectId && gitDiffDisplayMode === "drawer" && (
              <div className="git-drawer-detail">
                <Suspense fallback={<div className="file-diff-loading">Loading...</div>}>
                  <FileDiffViewer
                    displayMode="drawer"
                    filePath={gitDrawerDiff.filePath}
                    mode="diff"
                    onToggleMode={toggleGitDiffDisplayMode}
                    originalContent={gitDrawerDiff.originalContent}
                    modifiedContent={gitDrawerDiff.modifiedContent}
                    tabs={[{ id: gitDrawerDiff.filePath, filePath: gitDrawerDiff.filePath, label: gitDrawerDiff.label }]}
                    activeTabId={gitDrawerDiff.filePath}
                    onClose={closeGitDiff}
                    readContent={readEditorFileContent}
                    theme={theme}
                    maxFileSizeMB={maxEditorFileSizeMB}
                  />
                </Suspense>
              </div>
            )}
          </div>
        </div>
      ) : drawer && drawer !== "browser" && drawer !== "editor" && drawer !== "git" ? (
        <LazyWrapper
          className="drawer-content-frame"
          enabled={true}
          threshold={0}
          rootMargin="50px"
          placeholder={
            <div style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              height: "100%",
              color: "var(--text-secondary)",
              fontSize: "14px"
            }}>
              加载中...
            </div>
          }
        >
          <DrawerContent
            panel={drawer}
            project={drawer === "sessions" ? sessionsProject : undefined}
            files={files}
            sessions={(sessionsProjectId && sessionSourceFilter[sessionsProjectId]) ? sessions.filter(
              (s: any) => !s.parentSessionPath && (sessionSourceFilter[sessionsProjectId]!)!.has(s.source ?? "pi"),
            ).concat(sessions.filter((s: any) => s.parentSessionPath && (sessionSourceFilter[sessionsProjectId]!)!.has(s.source ?? "pi"))) : sessions}
            sessionsLoading={sessionHistoryLoading}
            expandedDirs={expandedDirs}
            onToggleDirectory={onToggleDirectory}
            onCollapseAllDirectories={onCollapseAllDirectories}
            pinned={drawerPinned}
            onTogglePin={onToggleDrawerPin}
            onCollapse={onCollapseDrawer}
            onClose={onCloseDrawer}
            onFileContextMenu={(node: any, x: number, y: number) => setFileMenu({ node, x, y })}
            onRefreshFiles={() => {
              refreshFiles(activeProjectId);
            }}
            onOpenFolder={() => {
              const p = projects.find((p: any) => p.id === activeProjectId);
              if (p) void api.files.open(p.path);
            }}
            onRefreshSessions={() => {
              const projectId = sessionsProjectId ?? activeProjectId;
              if (projectId) void refreshProjectSessions(projectId, true);
            }}
            onOpenSession={(session: any) =>
              void runOpenSidebarSession(
                sessionsProjectId ?? activeProjectId ?? "",
                session,
              )
            }
            onRenameSession={async (filePath: string, newName: string) => {
              const session = sessions.find((candidate: any) =>
                isSameSessionPath(
                  candidate.filePath,
                  filePath,
                  candidate.wsl ? "wsl" : "native",
                ),
              );
              if (!session) return;
              await api.sessions.updateRecord(session.id, { title: newName });
              const projectId = sessionsProjectId ?? activeProjectId;
              if (projectId) await refreshProjectSessions(projectId, true);
            }}
            onCopySession={(session: any) =>
              runCopySession(
                session.filePath,
                sessionsProjectId ?? activeProjectId,
              )
            }
            onExportSession={runExportHistorySession}
            onDeleteSession={runDeleteHistorySession}
            onViewFile={viewFilePath}
            onOpenFile={openFilePath}
          />
        </LazyWrapper>
      ) : null}
    </>
  );
}
