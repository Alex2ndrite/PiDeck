import { Filter, FolderCog, HatGlasses, Play, Plus } from "lucide-react";
import type { DragEvent } from "react";
import type { Project, WorktreeEntry } from "../../../../shared/types";
import { ProjectAvatar } from "./SidebarParts";
import type { SidebarController } from "../../hooks/useSidebarController";
import { t } from "../../i18n";
import type { SidebarActions } from "./SidebarContent";
import { SessionTree } from "./SessionTree";
import { WorktreeTree } from "./WorktreeTree";

function isChatProject(project: Project) {
  return project.kind === "chat";
}

function displayProjectDirectoryName(project: Project) {
  if (isChatProject(project)) return "Chat";
  const normalizedPath = project.path.replace(/\\/g, "/").replace(/\/+$/, "");
  return normalizedPath.split("/").pop() || project.name || project.path;
}

function matchesProject(project: Project, search: string, controller: SidebarController) {
  if (!search) return true;
  const query = search.toLowerCase();
  if (`${project.name}${project.path}`.toLowerCase().includes(query)) return true;
  if (controller.catalog.agents.some((agent) => agent.projectId === project.id &&
    `${agent.title}${agent.cwd}${agent.sessionId ?? ""}`.toLowerCase().includes(query))) return true;
  return (controller.catalog.sessionsByProject[project.id] ?? []).some((session) =>
    `${session.title}${session.preview}${session.filePath ?? ""}`.toLowerCase().includes(query));
}

export function ProjectTree(props: {
  controller: SidebarController;
  actions: SidebarActions;
  currentProjectId?: string;
  currentSessionId?: string;
  worktreesByProject: Readonly<Record<string, readonly WorktreeEntry[]>>;
  branchByProject?: Readonly<Record<string, string | null | undefined>>;
}) {
  const rootProjects = props.controller.catalog.projects.filter((project) =>
    !project.worktreeParentId && matchesProject(project, props.controller.search.trim(), props.controller),
  );
  const dragStart = (event: DragEvent<HTMLButtonElement>, projectId: string) => {
    if (props.controller.search.trim()) return;
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", projectId);
    props.controller.startProjectDrag(projectId);
  };
  const drop = (event: DragEvent<HTMLButtonElement>, projectId: string) => {
    event.preventDefault();
    const source = event.dataTransfer.getData("text/plain") || props.controller.drag.sourceProjectId;
    props.controller.finishProjectDrag();
    if (props.controller.search.trim()) return;
    if (source && source !== projectId) void props.actions.projects.reorder(source, projectId);
  };
  return <>
    {rootProjects.map((project) => {
      const collapsed = props.controller.isProjectCollapsed(project.id);
      const chat = isChatProject(project);
      const projectDirectoryName = chat
        ? t("app.chatProject")
        : displayProjectDirectoryName(project);
      const sourceFilter = props.controller.sourceFilterFor(project.id);
      const dragging = props.controller.drag.sourceProjectId === project.id;
      const dragOver = props.controller.drag.overProjectId === project.id;
      return <div key={project.id} className={`project-group${chat ? " chat-project-group" : ""}${project.worktreeEnabled ? " worktree-enabled" : ""}`}>
        <button
          className={["conversation", !chat && !props.controller.search.trim() ? "project-draggable" : "", chat ? "chat-project" : "", dragging ? "dragging" : "", dragOver ? "drag-over" : ""].filter(Boolean).join(" ")}
          draggable={!chat && !props.controller.search.trim()}
          onDragStart={(event) => dragStart(event, project.id)}
          onDragOver={(event) => { if (props.controller.drag.sourceProjectId && props.controller.drag.sourceProjectId !== project.id) { event.preventDefault(); props.controller.setProjectDropTarget(project.id); } }}
          onDragLeave={() => props.controller.setProjectDropTarget(undefined)}
          onDrop={(event) => drop(event, project.id)}
          onDragEnd={props.controller.finishProjectDrag}
          onContextMenu={(event) => { event.preventDefault(); void props.controller.openMenu({ kind: "project", projectId: project.id, x: event.clientX, y: event.clientY }); }}
          onClick={() => { props.controller.toggleProject(project.id); props.actions.projects.select(project.id); }}
        >
          <span className={`project-fold${collapsed ? " folded" : ""}`} title={collapsed ? t("app.projectExpand") : t("app.projectCollapse")}><Play size={12} /></span>
          <ProjectAvatar name={projectDirectoryName} kind={chat ? "chat" : "project"} />
          <div className="conversation-body"><div className="conversation-title">
            <strong title={project.path}>{projectDirectoryName}</strong>
            {sourceFilter !== null && (
              <span
                className="filter-indicator"
                role="button"
                tabIndex={0}
                title={t("menu.filterSessions")}
                onClick={(event) => {
                  event.stopPropagation();
                  props.controller.openSourceFilter(project.id, event.clientX, event.clientY);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    const rect = event.currentTarget.getBoundingClientRect();
                    props.controller.openSourceFilter(project.id, rect.left, rect.bottom);
                  }
                }}
              ><Filter size={12} /></span>
            )}
          </div>{chat && <p className="chat-project-guide">{t("app.projectChatGuide")}</p>}</div>
          <span className="project-row-actions">
            {chat && props.actions.projects.changeChatPath && <span className="project-action" title={t("app.chatProjectSettings")} onClick={(event) => { event.stopPropagation(); void props.actions.projects.changeChatPath!(project); }}><FolderCog size={14} /></span>}
            <span className="project-action" title={t("app.projectNewAgent")} onClick={(event) => { event.stopPropagation(); void props.actions.sessions.createDraft(project.id); }}><Plus size={14} /></span>
            <span className="project-action" title={t("app.anonymousChat")} onClick={(event) => { event.stopPropagation(); void props.actions.sessions.createAnonymous(project.id); }}><HatGlasses size={14} /></span>
          </span>
        </button>
        {!collapsed && project.worktreeEnabled && <WorktreeTree
          project={project}
          controller={props.controller}
          actions={props.actions}
          currentSessionId={props.currentSessionId}
          entries={props.worktreesByProject[project.id] ?? []}
          branch={props.branchByProject?.[project.id]}
        />}
        {!collapsed && <SessionTree
          project={project}
          sessions={props.controller.catalog.sessionsByProject[project.id] ?? []}
          agents={props.controller.catalog.agents}
          currentSessionId={props.currentSessionId}
          controller={props.controller}
          actions={props.actions}
        />}
      </div>;
    })}
  </>;
}
