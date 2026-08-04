import { ChevronDown, ChevronRight, GitBranch, Plus, Trash2 } from "lucide-react";
import type { Project, WorktreeEntry } from "../../../../shared/types";
import type { SidebarController } from "../../hooks/useSidebarController";
import { t } from "../../i18n";
import type { SidebarActions } from "./SidebarContent";
import { SessionTree } from "./SessionTree";
import { Button } from "../ui-shadcn/button";

export function WorktreeTree(props: {
  project: Project;
  controller: SidebarController;
  actions: SidebarActions;
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
  return (
    <>
      <div className="worktree-children worktree-main-header-only">
        <Button variant="ghost" className="conversation worktree-workspace-header w-full justify-start" onClick={() => props.actions.projects.select(props.project.id)} title={t("app.worktreeMainWorkspace")}>
          <span className="worktree-main-branch-icon"><GitBranch size={12} /></span>
          <div className="conversation-body"><div className="conversation-title">
            <strong>{t("app.worktreeMainWorkspace")}</strong><span className="worktree-main-branch">{props.branch ?? t("app.worktreeBranchLoading")}</span>
          </div></div>
        </Button>
      </div>
      <div className="worktree-children worktree-sandbox-list">
        <div className="worktree-sandbox-toolbar">
          <span>{t("app.worktreeOtherWorkspaces")}</span>
          <Button variant="ghost" size="sm" className="worktree-create-btn h-6 gap-[3px] px-[5px] text-caption rounded-[6px]" title={t("app.worktreeNew")} onClick={() => props.controller.openWorktreeCreate(props.project.id)}>
            <GitBranch size={12} /><span>{t("app.worktreeNewShort")}</span>
          </Button>
        </div>
        {entries.map((entry) => {
          const childProject = childProjects.find((project) => project.path === entry.path);
          const displayBranch = entry.branch.replace(/^pideck\//, "");
          const directory = entry.path.split(/[/\\]/).filter(Boolean).pop() || entry.path;
          const expanded = props.controller.expandedWorktreePaths.has(entry.path);
          return <div key={entry.path}>
            <button
              className="conversation worktree-row"
              title={entry.path}
              onClick={() => childProject && props.actions.projects.select(childProject.id)}
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
              <span
                className="grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                role="button"
                tabIndex={0}
                aria-label={expanded ? t("app.projectCollapse") : t("app.projectExpand")}
                title={expanded ? t("app.projectCollapse") : t("app.projectExpand")}
                onClick={(event) => { event.stopPropagation(); props.controller.toggleWorktreeSessions(entry.path); }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    event.stopPropagation();
                    props.controller.toggleWorktreeSessions(entry.path);
                  }
                }}
              >
                {expanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
              </span>
              <span className="worktree-branch-icon"><GitBranch size={12} /></span><span className="worktree-branch-name">{displayBranch}</span>
              {directory !== displayBranch && <span className="worktree-dir-meta">{directory}</span>}
              {childProject && <span className="project-action worktree-new-agent" title={t("app.projectNewAgent")} onClick={(event) => { event.stopPropagation(); void props.actions.sessions.createDraft(childProject.id); }}><Plus size={12} /></span>}
              {childProject && <span className="project-action worktree-remove" title={t("menu.removeProject")} onClick={(event) => { event.stopPropagation(); void props.actions.worktrees.remove(props.project.id, entry, childProject); }}><Trash2 size={12} /></span>}
            </button>
            {childProject && <SessionTree
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
