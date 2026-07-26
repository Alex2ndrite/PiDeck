import { ChevronDown, GitBranch, Plus, Trash2 } from "lucide-react";
import type { Project, WorktreeEntry } from "../../../../shared/types";
import type { SidebarController } from "../../hooks/useSidebarController";
import { t } from "../../i18n";
import type { SidebarActions } from "./SidebarContent";
import { SessionTree } from "./SessionTree";

/** 主工作区折叠 key；与 worktree 子工作区的 wt: 前缀区分 */
export function mainWorkspaceKey(projectId: string) {
  return `main:${projectId}`;
}

/** worktree 子工作区折叠 key */
export function worktreeWorkspaceKey(path: string) {
  return `wt:${path}`;
}

export function WorktreeTree(props: {
  project: Project;
  controller: SidebarController;
  actions: SidebarActions;
  currentProjectId?: string;
  currentSessionId?: string;
  entries: readonly WorktreeEntry[];
  branch?: string | null;
}) {
  const childProjects = props.controller.catalog.projects.filter(
    (project) => project.worktreeParentId === props.project.id,
  );
  const entries = [...props.entries];
  for (const childProject of childProjects) {
    if (!entries.some((entry) => entry.path === childProject.path)) {
      entries.push({ path: childProject.path, branch: childProject.name });
    }
  }
  const mainKey = mainWorkspaceKey(props.project.id);
  const mainSessionsOpen = !props.controller.isWorkspaceCollapsed(mainKey);
  // 没有会话/Agent 时不给折叠箭头，避免点开一个空壳
  const mainCanFold = (props.controller.catalog.sessionsByProject[props.project.id] ?? []).length > 0 ||
    props.controller.catalog.agents.some((agent) => agent.projectId === props.project.id);
  return (
    <>
      <div className="worktree-children worktree-main-header-only">
        <button
          className={`conversation worktree-workspace-header${props.currentProjectId === props.project.id ? " active" : ""}${mainCanFold ? " has-fold" : ""}${mainSessionsOpen ? "" : " is-folded"}`}
          // 首次点击：选中主工作区并展开会话；再次点击当前主工作区：折叠/展开会话
          onClick={() => {
            const wasActive = props.currentProjectId === props.project.id;
            props.actions.projects.select(props.project.id);
            if (mainCanFold) props.controller.selectWorkspace(mainKey, wasActive);
          }}
          title={mainCanFold
            ? mainSessionsOpen ? t("app.projectCollapse") : t("app.projectExpand")
            : t("app.worktreeMainWorkspace")}
        >
          {mainCanFold && <span className={`worktree-fold${mainSessionsOpen ? "" : " folded"}`} aria-hidden="true"><ChevronDown size={12} strokeWidth={1.8} /></span>}
          <span className="worktree-main-branch-icon"><GitBranch size={12} /></span>
          <div className="conversation-body"><div className="conversation-title">
            <strong>{t("app.worktreeMainWorkspace")}</strong><span className="worktree-main-branch">{props.branch ?? t("app.worktreeBranchLoading")}</span>
          </div></div>
        </button>
      </div>
      <div className="worktree-children worktree-sandbox-list">
        <div className="worktree-sandbox-toolbar">
          <span>{t("app.worktreeOtherWorkspaces")}</span>
          <button className="worktree-create-btn" title={t("app.worktreeNew")} onClick={() => props.controller.openWorktreeCreate(props.project.id)}>
            <GitBranch size={12} /><span>{t("app.worktreeNewShort")}</span>
          </button>
        </div>
        {entries.map((entry) => {
          const childProject = childProjects.find((project) => project.path === entry.path);
          // PiDeck 创建的 worktree 分支使用 pideck/{slug} 命名；侧栏只展示 slug。
          // 完整路径放 title，不再行内显示目录名——分支与目录名不一致时会参差不齐。
          const displayBranch = entry.branch.replace(/^pideck\//, "");
          const expanded = props.controller.expandedWorktreePaths.has(entry.path);
          const workspaceKey = worktreeWorkspaceKey(entry.path);
          const childSessions = childProject ? props.controller.catalog.sessionsByProject[childProject.id] ?? [] : [];
          const canFold = Boolean(childProject) && (childSessions.length > 0 ||
            props.controller.catalog.agents.some((agent) => agent.projectId === childProject!.id));
          const sessionsOpen = !props.controller.isWorkspaceCollapsed(workspaceKey);
          return <div key={entry.path}>
            <button
              className={`conversation worktree-row${childProject && props.currentProjectId === childProject.id ? " active" : ""}${sessionsOpen ? "" : " is-folded"}`}
              title={entry.path}
              // 首次点中：选中并展开；再次点击当前工作区：折叠/展开会话
              onClick={() => {
                if (!childProject) return;
                const wasActive = props.currentProjectId === childProject.id;
                props.actions.projects.select(childProject.id);
                if (canFold) props.controller.selectWorkspace(workspaceKey, wasActive);
              }}
              onContextMenu={(event) => {
                if (!childProject) return;
                event.preventDefault();
                void props.controller.openMenu({
                  kind: "project",
                  projectId: childProject.id,
                  x: event.clientX,
                  y: event.clientY,
                });
              }}
            >
              {canFold && <span className={`worktree-fold${sessionsOpen ? "" : " folded"}`} aria-hidden="true"><ChevronDown size={12} strokeWidth={1.8} /></span>}
              <span className="worktree-branch-icon"><GitBranch size={12} /></span><span className="worktree-branch-name">{displayBranch}</span>
              {childProject && <span className="project-action worktree-new-agent" title={t("app.projectNewAgent")} onClick={(event) => { event.stopPropagation(); void props.actions.sessions.createDraft(childProject.id); }}><Plus size={12} /></span>}
              {childProject && <span className="project-action worktree-remove" title={t("menu.removeProject")} onClick={(event) => { event.stopPropagation(); void props.actions.worktrees.remove(props.project.id, entry, childProject); }}><Trash2 size={12} /></span>}
            </button>
            {childProject && sessionsOpen && <SessionTree
              project={childProject}
              sessions={props.controller.catalog.sessionsByProject[childProject.id] ?? []}
              agents={props.controller.catalog.agents}
              currentSessionId={props.currentSessionId}
              controller={props.controller}
              actions={props.actions}
              nested
              visibleChildCount={expanded ? Number.MAX_SAFE_INTEGER : 3}
              onShowMore={() => props.controller.expandWorktreeSessions(entry.path)}
            />}
          </div>;
        })}
      </div>
    </>
  );
}
