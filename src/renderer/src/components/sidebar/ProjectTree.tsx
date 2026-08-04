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
  "group conversation relative flex min-h-10 w-full items-center gap-2 rounded-xl border border-border/70 bg-background/40 px-2 py-1.5 text-body text-foreground shadow-sm shadow-black/[0.02] transition-[background-color,border-color,box-shadow] duration-200 hover:border-accent/30 hover:bg-accent/5 hover:text-accent-foreground";

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
  // 搜索项目时把直属 worktree 视为同一工作区树，否则用户搜到 worktree 分支/会话
  // 后根项目会被过滤掉，导致结果实际存在却无法展开查看。
  const relatedProjects = controller.catalog.projects.filter(
    (candidate) => candidate.id === project.id || candidate.worktreeParentId === project.id,
  );
  return relatedProjects.some((related) => {
    if (`${related.name}${related.path}`.toLowerCase().includes(query)) return true;
    if (controller.catalog.agents.some((agent) => agent.projectId === related.id &&
      `${agent.title}${agent.cwd}${agent.sessionId ?? ""}`.toLowerCase().includes(query))) return true;
    return (controller.catalog.sessionsByProject[related.id] ?? []).some((session) =>
      `${session.title}${session.preview}${session.filePath ?? ""}`.toLowerCase().includes(query));
  });
}

export function ProjectTree(props: {
  controller: SidebarController;
  actions: SidebarActions;
  currentProjectId?: string;
  /** 实际选中的项目（可能是 worktree 子项目），用于高亮工作区行。 */
  selectedProjectId?: string;
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
      const rootProjectSessions = props.controller.catalog.sessionsByProject[project.id] ?? [];
      // 运行态属于具体会话，而不是项目容器；项目行只负责导航，避免多个 Agent 同时运行时
      // 项目头像出现无法指向目标会话的聚合动画。
      return <div key={project.id} className={cn("project-group mb-2", project.worktreeEnabled && "worktree-enabled")}>
        <div
          className={cn(
            treeRowClass,
            !chat && !props.controller.search.trim() && "project-draggable",
            dragging && "dragging opacity-60",
            dragOver && "drag-over ring-1 ring-border",
            isCurrent && "active border-accent/35 bg-accent/10 text-accent-foreground shadow-sm shadow-accent/10",
          )}
          data-active={isCurrent || undefined}
          onContextMenu={(event) => { event.preventDefault(); void props.controller.openMenu({ kind: "project", projectId: project.id, x: event.clientX, y: event.clientY }); }}
        >
          <button
            type="button"
            className={cn("project-fold grid size-8 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-background/70 hover:text-foreground", collapsed && "folded")}
            title={collapsed ? t("app.projectExpand") : t("app.projectCollapse")}
            aria-label={collapsed ? t("app.projectExpand") : t("app.projectCollapse")}
            onClick={() => props.controller.toggleProject(project.id)}
          >
            <Play size={12} className={cn("transition-transform", !collapsed && "rotate-90")} />
          </button>
          <button
            type="button"
            className="flex min-w-0 flex-1 items-center gap-2 py-1 pr-1 text-left"
            draggable={!chat && !props.controller.search.trim()}
            onDragStart={(event) => dragStart(event, project.id)}
            onDragOver={(event) => { if (props.controller.drag.sourceProjectId && props.controller.drag.sourceProjectId !== project.id) { event.preventDefault(); props.controller.setProjectDropTarget(project.id); } }}
            onDragLeave={() => props.controller.setProjectDropTarget(undefined)}
            onDrop={(event) => drop(event, project.id)}
            onDragEnd={props.controller.finishProjectDrag}
            onClick={() => {
              // 项目主行同时承担选择和手风琴切换，让项目卡片本身保持唯一且明确的导航入口。
              props.controller.toggleProject(project.id);
              props.actions.projects.select(project.id);
            }}
          >
            <ProjectAvatar name={projectDirectoryName} kind={chat ? "chat" : "project"} />
            <div className="conversation-body min-w-0 flex-1">
              <div className="conversation-title flex min-w-0 items-center">
                <strong className="min-w-0 flex-1 truncate font-medium" title={project.path}>{projectDirectoryName}</strong>
              </div>
              {/* 聊天项目与普通项目使用同一行高；说明文字不参与侧栏导航信息。 */}
            </div>
          </button>
          <div className="flex shrink-0 items-center gap-1 pr-1">
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
            <div className="flex items-center gap-1">
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
          <div className="ml-2 mt-2 mr-1 space-y-1 pb-1">
            {/* 展开内容不依赖当前选中项，项目切换只改变高亮，避免两棵会话树同时伸缩造成布局抖动。 */}
            {project.worktreeEnabled ? (
              <WorktreeTree
                project={project}
                controller={props.controller}
                actions={props.actions}
                currentProjectId={props.selectedProjectId}
                currentSessionId={props.currentSessionId}
                sessions={rootProjectSessions}
                agents={props.controller.catalog.agents}
                entries={props.worktreesByProject[project.id] ?? []}
                branch={props.branchByProject?.[project.id]}
              />
            ) : (
              <SessionTree
                project={project}
                sessions={rootProjectSessions}
                agents={props.controller.catalog.agents}
                currentSessionId={props.currentSessionId}
                controller={props.controller}
                actions={props.actions}
              />
            )}
          </div>
        )}
      </div>;
    })}
  </>;
}
