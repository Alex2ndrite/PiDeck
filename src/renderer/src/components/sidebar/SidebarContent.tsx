import { Search, Plus, Settings, Sliders, MessageSquare, Globe } from "lucide-react";
import type { AgentTab, Project, SessionRecord, SessionSummary, WorktreeEntry } from "../../../../shared/types";
import {
  AgentContextMenu,
  ProjectContextMenu,
  RpcLogModal,
  SessionContextMenu,
  SessionManagerModal,
  WorktreeCreateDialog,
} from "../app/AppParts";
import { sessionRecordToSummary } from "../../atoms";
import { t } from "../../i18n";
import { getBoundSidebarRuntimeAgent, type SidebarController, type SidebarRpcLog } from "../../hooks/useSidebarController";
import { ProjectTree } from "./ProjectTree";

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
  const menuSession = menuSessionRecord ? sessionRecordToSummary(menuSessionRecord) : undefined;
  const menuSessionRuntimeAgent = menuSessionRecord
    ? getBoundSidebarRuntimeAgent(controller.catalog, menuSessionRecord.id)
    : undefined;
  const managerProject = controller.sessionManagerProjectId
    ? controller.catalog.projects.find((project) => project.id === controller.sessionManagerProjectId)
    : undefined;

  return (
    <aside className="chat-list-pane v3-braun" aria-label={t("app.search")}>
      <div className="sidebar-body">
        <div className="search-row">
          <div className="search-box">
            <span className="search-icon"><Search size={14} /></span>
            <input
              value={controller.search}
              onChange={(event) => controller.setSearch(event.target.value)}
              placeholder={t("app.search")}
            />
          </div>
          <button className="round-add" onClick={() => void actions.projects.add()} title={t("app.addProject")}>
            <Plus size={18} />
          </button>
        </div>
        <div className="conversation-list">
          <ProjectTree
            controller={controller}
            actions={actions}
            currentProjectId={props.currentProjectId}
            currentSessionId={props.currentSessionId}
            worktreesByProject={props.worktreesByProject}
            branchByProject={props.branchByProject}
          />
        </div>
        {!props.isLanWeb && (
          <div className="toolbar-actions sidebar-bottom-actions">
            <div className="sidebar-bottom-primary-actions">
              <button className="icon-button settings-icon" title={t("settings.title")} onClick={props.onOpenSettings}><Settings size={17} /></button>
              <button className="icon-button config-icon" title={t("config.title")} onClick={props.onOpenConfig}><Sliders size={17} /></button>
              <button className="icon-button feedback-icon" title={t("feedback.title")} onClick={props.onOpenFeedback}><MessageSquare size={17} /></button>
              <button className="icon-button homepage-icon" title={t("app.homepage")} onClick={props.onOpenHomepage}><Globe size={17} /></button>
            </div>
          </div>
        )}
      </div>

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
          onFilterSessions={() => { controller.openSourceFilter(menuProject.id); controller.closeMenu(); }}
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
