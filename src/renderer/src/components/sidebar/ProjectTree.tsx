import { Filter, FolderCog, HatGlasses, Play, Plus } from "lucide-react";
import type { DragEvent } from "react";
import type { Project, WorktreeEntry } from "../../../../shared/types";
import { ProjectAvatar } from "./SidebarParts";
import type { SidebarController } from "../../hooks/useSidebarController";
import { t } from "../../i18n";
import type { SidebarActions } from "./SidebarContent";
import { SessionTree } from "./SessionTree";
import { WorktreeTree } from "./WorktreeTree";
import { cn } from "../../lib/utils";

/** pure official：项目/会话树行共享的 shadcn 风格底（hover=accent 面，active 同系） */
const treeRowClass =
  "group conversation relative flex w-full items-center gap-0.5 rounded-md border-0 bg-transparent px-1 py-0.5 text-body text-foreground transition-colors hover:bg-accent hover:text-accent-foreground";

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
      const isCurrent = props.currentProjectId === project.id;
      const chat = isChatProject(project);
      const projectDirectoryName = chat
        ? t("app.chatProject")
        : displayProjectDirectoryName(project);
      const sourceFilter = props.controller.sourceFilterFor(project.id);
      const dragging = props.controller.drag.sourceProjectId === project.id;
      const dragOver = props.controller.drag.overProjectId === project.id;
      // 项目行统计徽标：会话总数（含子会话）与正在运行的 Agent 数，
      // 项目多时不用逐个展开即可知道哪里有事发生
      const projectSessions = props.controller.catalog.sessionsByProject[project.id] ?? [];
      const sessionCount = projectSessions.length;
      const projectAgents = props.controller.catalog.agents.filter((agent) => agent.projectId === project.id);
      const runningAgentCount = projectAgents.filter(
        (agent) => agent.status === "running" || agent.status === "starting",
      ).length;
      const projectStatus = projectAgents.some((agent) => agent.status === "error")
        ? "error"
        : projectAgents.some((agent) => agent.status === "running")
          ? "running"
          : projectAgents.some((agent) => agent.status === "starting")
            ? "starting"
            : "idle";
      return <div key={project.id} className={cn("project-group mb-0.5", project.worktreeEnabled && "worktree-enabled")}>
        <div
          className={cn(
            treeRowClass,
            !chat && !props.controller.search.trim() && "project-draggable",
            dragging && "dragging opacity-60",
            dragOver && "drag-over ring-1 ring-border",
            isCurrent && "active bg-accent text-accent-foreground",
          )}
          data-active={isCurrent || undefined}
          onContextMenu={(event) => { event.preventDefault(); void props.controller.openMenu({ kind: "project", projectId: project.id, x: event.clientX, y: event.clientY }); }}
        >
          <button
            type="button"
            className={cn("project-fold grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-background/70 hover:text-foreground", collapsed && "folded")}
            title={collapsed ? t("app.projectExpand") : t("app.projectCollapse")}
            aria-label={collapsed ? t("app.projectExpand") : t("app.projectCollapse")}
            onClick={() => props.controller.toggleProject(project.id)}
          >
            <Play size={12} className={cn("transition-transform", !collapsed && "rotate-90")} />
          </button>
          <button
            type="button"
            className="flex min-w-0 flex-1 items-center gap-1.5 py-0.5 pr-0.5 text-left"
            draggable={!chat && !props.controller.search.trim()}
            onDragStart={(event) => dragStart(event, project.id)}
            onDragOver={(event) => { if (props.controller.drag.sourceProjectId && props.controller.drag.sourceProjectId !== project.id) { event.preventDefault(); props.controller.setProjectDropTarget(project.id); } }}
            onDragLeave={() => props.controller.setProjectDropTarget(undefined)}
            onDrop={(event) => drop(event, project.id)}
            onDragEnd={props.controller.finishProjectDrag}
            onClick={() => {
              // 项目主行同时承担选择和手风琴切换，确保新项目即使只显示会话计数也能打开列表。
              props.controller.toggleProject(project.id);
              props.actions.projects.select(project.id);
            }}
          >
            <ProjectAvatar name={projectDirectoryName} kind={chat ? "chat" : "project"} status={projectStatus} />
            <div className="conversation-body min-w-0 flex-1">
              <div className="conversation-title flex min-w-0 items-center">
                <strong className="min-w-0 flex-1 truncate font-medium" title={project.path}>{projectDirectoryName}</strong>
              </div>
              {/* 聊天项目与普通项目使用同一行高；说明文字不参与侧栏导航信息。 */}
            </div>
          </button>
          <div className="flex shrink-0 items-center gap-0.5 pr-0.5">
            {runningAgentCount > 0 && (
              <span className="project-running-badge inline-flex h-4 items-center rounded-full bg-primary/10 px-1.5 text-micro font-medium tabular-nums text-primary" title={t("app.projectRunningAgents", { count: runningAgentCount })}>
                {runningAgentCount}
              </span>
            )}
            {sessionCount > 0 && (
              <span className="project-session-count inline-flex h-4 items-center rounded-full bg-muted px-1.5 text-micro tabular-nums text-muted-foreground" title={t("app.projectSessionCount", { count: sessionCount })}>
                {sessionCount}
              </span>
            )}
            {sourceFilter !== null && (
              <button
                type="button"
                className="grid size-6 place-items-center rounded-md text-muted-foreground hover:bg-background/80 hover:text-foreground"
                title={t("menu.filterSessions")}
                aria-label={t("menu.filterSessions")}
                onClick={(event) => props.controller.openSourceFilter(project.id, event.clientX, event.clientY)}
              >
                <Filter size={12} />
              </button>
            )}
            {isCurrent && (
              <button type="button" className="grid size-6 place-items-center rounded-md text-muted-foreground hover:bg-background/80 hover:text-foreground" title={t("app.projectNewAgent")} aria-label={t("app.projectNewAgent")} onClick={() => void props.actions.sessions.createDraft(project.id)}><Plus size={14} /></button>
            )}
            <div className="flex items-center gap-0.5">
              {chat && props.actions.projects.changeChatPath && (
                <button type="button" className="grid size-6 place-items-center rounded-md text-muted-foreground hover:bg-background/80 hover:text-foreground" title={t("app.chatProjectSettings")} aria-label={t("app.chatProjectSettings")} onClick={() => void props.actions.projects.changeChatPath!(project)}><FolderCog size={14} /></button>
              )}
              {!isCurrent && (
                <button type="button" className="grid size-6 place-items-center rounded-md text-muted-foreground hover:bg-background/80 hover:text-foreground" title={t("app.projectNewAgent")} aria-label={t("app.projectNewAgent")} onClick={() => void props.actions.sessions.createDraft(project.id)}><Plus size={14} /></button>
              )}
              <button type="button" className="grid size-6 place-items-center rounded-md text-muted-foreground hover:bg-background/80 hover:text-foreground" title={t("app.anonymousChat")} aria-label={t("app.anonymousChat")} onClick={() => void props.actions.sessions.createAnonymous(project.id)}><HatGlasses size={14} /></button>
            </div>
          </div>
        </div>
        {!collapsed && (
          <div className="ml-1 pb-0.5">
            {/* 展开内容不依赖当前选中项，项目切换只改变高亮，避免两棵会话树同时伸缩造成布局抖动。 */}
            {project.worktreeEnabled && (
              <WorktreeTree
                project={project}
                controller={props.controller}
                actions={props.actions}
                currentSessionId={props.currentSessionId}
                entries={props.worktreesByProject[project.id] ?? []}
                branch={props.branchByProject?.[project.id]}
              />
            )}
            <SessionTree
              project={project}
              sessions={projectSessions}
              agents={props.controller.catalog.agents}
              currentSessionId={props.currentSessionId}
              controller={props.controller}
              actions={props.actions}
            />
          </div>
        )}
      </div>;
    })}
  </>;
}
