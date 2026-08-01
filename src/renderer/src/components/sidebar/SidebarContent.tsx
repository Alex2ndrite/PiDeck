import { Search, Plus, Settings, Sliders, MessageSquare, Globe } from "lucide-react";
import type { ReactNode } from "react";
import type { AgentTab, Project, SessionRecord, SessionSummary, WorktreeEntry } from "../../../../shared/types";
import {
  AgentContextMenu,
  DraftSessionContextMenu,
  ProjectContextMenu,
  RpcLogModal,
  SessionContextMenu,
  SessionManagerModal,
  SessionSourceFilterMenu,
  WorktreeCreateDialog,
} from "./SidebarParts";
import { sessionRecordToSummary } from "../../atoms";
import { t } from "../../i18n";
import { getBoundSidebarRuntimeAgent, hasLiveSidebarRuntime, type SidebarController, type SidebarRpcLog } from "../../hooks/useSidebarController";
import { ProjectTree } from "./ProjectTree";
import { Button } from "../ui-shadcn/button";
import { Input } from "../ui-shadcn/input";

export type SidebarActions = {
  projects: {
    add: () => Promise<void>;
    select: (projectId: string) => void;
    refresh: (projectId: string) => Promise<void>;
    reorder: (sourceProjectId: string, targetProjectId: string) => Promise<void>;
    reveal: (project: Project) => Promise<void>;
    openWithEditor: (project: Project) => void;
    importSessions: (project: Project, source: "codex" | "claude" | "opencode") => void;
    manageResources: (project: Project) => void;
    toggleWorktree: (project: Project) => Promise<void>;
    copyPath: (project: Project) => Promise<void>;
    remove: (project: Project) => Promise<void>;
    changeChatPath?: (project: Project) => Promise<void>;
  };
  sessions: {
    open: (projectId: string, sessionId: string) => Promise<void>;
    createDraft: (projectId: string) => Promise<void>;
    createAnonymous: (projectId: string) => Promise<void>;
    deleteDraft: (session: SessionRecord) => Promise<void>;
    rename: (projectId: string, session: SessionSummary) => void;
    export: (projectId: string, session: SessionSummary) => Promise<void>;
    copy: (projectId: string, session: SessionSummary) => Promise<void>;
    copyPath: (session: SessionSummary) => Promise<void>;
    openFile: (session: SessionSummary) => Promise<void>;
    delete: (projectId: string, session: SessionSummary) => Promise<void>;
  };
  agents: {
    rename: (agent: AgentTab) => void;
    export: (agent: AgentTab) => Promise<void>;
    copySession: (agent: AgentTab) => Promise<void>;
    copyPath: (agent: AgentTab) => Promise<void>;
    openSessionFile: (agent: AgentTab) => Promise<void>;
    close: (agent: AgentTab) => Promise<void>;
  };
  worktrees: {
    create: (projectId: string, branchName: string) => Promise<void>;
    remove: (parentProjectId: string, entry: WorktreeEntry, childProject?: Project) => Promise<void>;
  };
  rpc: {
    getLogging: (agentId: string) => Promise<boolean>;
    setLogging: (agentId: string, enabled: boolean) => Promise<boolean>;
    openLogFile: (agentId: string) => Promise<void>;
    listLogs: (agentId: string) => Promise<SidebarRpcLog[]>;
  };
};

export type SidebarContentProps = {
  controller: SidebarController;
  actions: SidebarActions;
  currentProjectId?: string;
  currentSessionId?: string;
  worktreesByProject: Readonly<Record<string, readonly WorktreeEntry[]>>;
  branchByProject?: Readonly<Record<string, string | null | undefined>>;
  creatingWorktree?: boolean;
  isLanWeb?: boolean;
  chrome?: ReactNode;
  onOpenSettings?: () => void;
  onOpenConfig?: () => void;
  onOpenFeedback?: () => void;
  onOpenHomepage?: () => void;
};

export function SidebarContent(props: SidebarContentProps) {
  const { controller, actions } = props;
  const menu = controller.menu;
  const menuProject = menu?.kind === "project"
    ? controller.catalog.projects.find((project) => project.id === menu.projectId)
    : undefined;
  const menuAgent = menu?.kind === "agent"
    ? controller.catalog.agents.find((agent) => agent.id === menu.agentId)
    : undefined;
  const menuSessionRecord = menu?.kind === "session"
    ? controller.catalog.sessionsByProject[menu.projectId]?.find((session) => session.id === menu.sessionId)
    : undefined;
  const menuDraft = menu?.kind === "draft"
    ? controller.catalog.sessionsByProject[menu.projectId]?.find((session) => session.id === menu.sessionId)
    : undefined;
  const menuDraftRuntime = menuDraft
    ? controller.catalog.runtimeBySessionId[menuDraft.id]
    : undefined;
  const menuSession = menuSessionRecord ? sessionRecordToSummary(menuSessionRecord) : undefined;
  const menuSessionRuntimeAgent = menuSessionRecord
    ? getBoundSidebarRuntimeAgent(controller.catalog, menuSessionRecord.id)
    : undefined;
  const managerProject = controller.sessionManagerProjectId
    ? controller.catalog.projects.find((project) => project.id === controller.sessionManagerProjectId)
    : undefined;

  return (
    <aside
      className="chat-list-pane v3-braun flex h-full min-w-0 flex-col overflow-hidden border-r border-border bg-sidebar text-sidebar-foreground"
      aria-label={t("app.search")}
    >
      <div className="sidebar-body flex min-h-0 flex-1 flex-col gap-2 p-2">
        {props.chrome}
        {/* pure official：搜索行用 shadcn Input + icon Button */}
        <div className="search-row grid shrink-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
          <div className="search-box relative min-w-0">
            <Search
              size={14}
              className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              value={controller.search}
              onChange={(event) => controller.setSearch(event.target.value)}
              placeholder={t("app.search")}
              className="h-9 pl-8"
            />
          </div>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="round-add size-9 shrink-0"
            onClick={() => void actions.projects.add()}
            title={t("app.addProject")}
            aria-label={t("app.addProject")}
          >
            <Plus className="size-4" />
          </Button>
        </div>
        <div className="conversation-list min-h-0 flex-1 overflow-y-auto">
          <ProjectTree
            controller={controller}
            actions={actions}
            currentProjectId={props.currentProjectId}
            currentSessionId={props.currentSessionId}
            worktreesByProject={props.worktreesByProject}
            branchByProject={props.branchByProject}
          />
        </div>
      </div>
      {/* 底栏在 sidebar-body 之外（aside 直接子）：body 的 p-2 / v3-braun space-4
          内边距不再把底栏从侧栏底边顶起，真正贴底 */}
      {!props.isLanWeb && (
        <div className="toolbar-actions sidebar-bottom-actions flex shrink-0 items-center gap-1 border-t border-border px-4 py-2">
          <div className="sidebar-bottom-primary-actions flex min-w-0 flex-1 items-center gap-1">
            <Button type="button" variant="ghost" size="icon" className="icon-button settings-icon size-8" title={t("settings.title")} aria-label={t("settings.title")} onClick={props.onOpenSettings}><Settings className="size-4" /></Button>
            <Button type="button" variant="ghost" size="icon" className="icon-button config-icon size-8" title={t("config.title")} aria-label={t("config.title")} onClick={props.onOpenConfig}><Sliders className="size-4" /></Button>
            <Button type="button" variant="ghost" size="icon" className="icon-button feedback-icon size-8" title={t("feedback.title")} aria-label={t("feedback.title")} onClick={props.onOpenFeedback}><MessageSquare className="size-4" /></Button>
            <Button type="button" variant="ghost" size="icon" className="icon-button homepage-icon size-8" title={t("app.homepage")} aria-label={t("app.homepage")} onClick={props.onOpenHomepage}><Globe className="size-4" /></Button>
          </div>
        </div>
      )}

      {controller.sourceFilterMenu && (
        <SessionSourceFilterMenu
          menu={controller.sourceFilterMenu}
          filter={controller.sourceFilterFor(controller.sourceFilterMenu.projectId)}
          onToggleSource={(source) =>
            controller.toggleSourceFilter(controller.sourceFilterMenu!.projectId, source)
          }
          onClear={() => controller.clearSourceFilter(controller.sourceFilterMenu!.projectId)}
          onClose={controller.closeSourceFilter}
        />
      )}
      {menuProject && menu?.kind === "project" && (
        <ProjectContextMenu
          menu={{ x: menu.x, y: menu.y, project: menuProject }}
          onClose={controller.closeMenu}
          onRevealProject={() => { void actions.projects.reveal(menuProject); controller.closeMenu(); }}
          onOpenWithEditor={() => { actions.projects.openWithEditor(menuProject); controller.closeMenu(); }}
          onImportCodexSessions={() => { actions.projects.importSessions(menuProject, "codex"); controller.closeMenu(); }}
          onImportClaudeSessions={() => { actions.projects.importSessions(menuProject, "claude"); controller.closeMenu(); }}
          onImportOpenCodeSessions={() => { actions.projects.importSessions(menuProject, "opencode"); controller.closeMenu(); }}
          onManageProjectResources={() => { actions.projects.manageResources(menuProject); controller.closeMenu(); }}
          onManageSessions={() => { controller.openSessionManager(menuProject.id); controller.closeMenu(); }}
          onFilterSessions={() => { controller.openSourceFilter(menuProject.id, menu.x, menu.y + 20); controller.closeMenu(); }}
          onToggleWorktree={() => { void actions.projects.toggleWorktree(menuProject); controller.closeMenu(); }}
          onRefreshProject={() => { void actions.projects.refresh(menuProject.id); controller.closeMenu(); }}
          onCopyProjectPath={() => { void actions.projects.copyPath(menuProject); controller.closeMenu(); }}
          onRemoveProject={() => { void actions.projects.remove(menuProject); controller.closeMenu(); }}
        />
      )}
      {menuAgent && menu?.kind === "agent" && (
        <AgentContextMenu
          menu={{ x: menu.x, y: menu.y, agent: menuAgent }}
          onClose={controller.closeMenu}
          onRename={() => { actions.agents.rename(menuAgent); controller.closeMenu(); }}
          onExport={() => { void actions.agents.export(menuAgent); controller.closeMenu(); }}
          onCopySession={() => { void actions.agents.copySession(menuAgent); controller.closeMenu(); }}
          onCopySessionFilePath={() => { void actions.agents.copyPath(menuAgent); controller.closeMenu(); }}
          onOpenSessionFile={() => { void actions.agents.openSessionFile(menuAgent); controller.closeMenu(); }}
          onToggleRpcLogging={() => void actions.rpc.setLogging(menuAgent.id, !controller.isAgentRpcLogging(menuAgent.id)).then((enabled) => {
            controller.setAgentRpcLogging(menuAgent.id, enabled);
            controller.closeMenu();
          })}
          isRpcLogging={controller.isAgentRpcLogging(menuAgent.id)}
          onOpenLogFile={() => { void actions.rpc.openLogFile(menuAgent.id); controller.closeMenu(); }}
          onCloseAgent={() => { void actions.agents.close(menuAgent); controller.closeMenu(); }}
        />
      )}
      {menuDraft && menu?.kind === "draft" && menuDraft.status === "draft" && !hasLiveSidebarRuntime(menuDraftRuntime) && (
        <DraftSessionContextMenu
          menu={{ x: menu.x, y: menu.y }}
          onClose={controller.closeMenu}
          onDelete={() => { void actions.sessions.deleteDraft(menuDraft); controller.closeMenu(); }}
        />
      )}
      {menuSession && menu?.kind === "session" && (
        <SessionContextMenu
          menu={{ x: menu.x, y: menu.y, session: menuSession }}
          onClose={controller.closeMenu}
          onRename={() => { actions.sessions.rename(menu.projectId, menuSession); controller.closeMenu(); }}
          onExport={() => { void actions.sessions.export(menu.projectId, menuSession); controller.closeMenu(); }}
          onCopySession={() => { void actions.sessions.copy(menu.projectId, menuSession); controller.closeMenu(); }}
          onCopySessionFilePath={() => { void actions.sessions.copyPath(menuSession); controller.closeMenu(); }}
          onOpenSessionFile={() => { void actions.sessions.openFile(menuSession); controller.closeMenu(); }}
          onShowLogs={() => {
            if (menuSessionRuntimeAgent) void controller.openRpcLogs(menuSessionRuntimeAgent.id, actions.rpc.listLogs);
          }}
          onDeleteSession={() => { void actions.sessions.delete(menu.projectId, menuSession); controller.closeMenu(); }}
        />
      )}
      {managerProject && (
        <SessionManagerModal
          sessions={(controller.catalog.sessionsByProject[managerProject.id] ?? []).flatMap((record) => record.filePath ? [{
            id: record.id, filePath: record.filePath, name: record.title, preview: record.preview,
            updatedAt: record.updatedAt, messageCount: record.messageCount, source: record.source,
          }] : [])}
          onClose={controller.closeSessionManager}
          onRename={(session) => actions.sessions.rename(managerProject.id, session)}
          onExport={(session) => void actions.sessions.export(managerProject.id, session)}
          onDelete={(sessions) => Promise.all(sessions.map((session) => actions.sessions.delete(managerProject.id, session))).then(controller.closeSessionManager)}
        />
      )}
      {controller.worktreeCreateProjectId && (
        <WorktreeCreateDialog
          projectId={controller.worktreeCreateProjectId}
          creating={Boolean(props.creatingWorktree)}
          onCreate={(branchName) => void actions.worktrees.create(controller.worktreeCreateProjectId!, branchName).then(controller.closeWorktreeCreate)}
          onClose={controller.closeWorktreeCreate}
        />
      )}
      {controller.rpcLogAgentId && <RpcLogModal logs={[...controller.rpcLogs]} onClose={controller.closeRpcLogs} />}
    </aside>
  );
}
