import { useState, useRef } from "react";
import type { Project, FileTreeNode, GitBranchInfo, WorktreeEntry, SessionSummary, SessionRecord } from "../../../../shared/types";

const SESSION_REFRESH_TIMEOUT_MS = 20_000;
const SIDEBAR_PROJECT_CHILD_PAGE_SIZE = 5;

function sessionRecordToSummary(record: SessionRecord): SessionSummary | undefined {
  try {
    return {
      id: record.id,
      filePath: record.filePath,
      name: record.title || "Untitled",
      updatedAt: record.updatedAt ?? 0,
      createdAt: record.createdAt ?? 0,
      source: record.source,
      environment: record.environment,
    } as SessionSummary;
  } catch { return undefined; }
}

type UseProjectSyncInput = {
  projects: Project[];
  activeProjectId: string | undefined;
  setProjects: (projects: Project[]) => void;
  setActiveProjectId: (id: string) => void;
  replaceProjectSessions: (input: { projectId: string; sessions: SessionRecord[] }) => void;
  api: {
    projects: { list: () => Promise<Project[]> };
    git: { worktreeList: (projectId: string) => Promise<WorktreeEntry[]>; branches: (projectId: string) => Promise<{ current: string | null; branches: string[] }> };
    sessions: { listCatalog: (projectId: string) => Promise<SessionRecord[]> };
    files: { list: (projectId: string) => Promise<FileTreeNode[]> };
  };
  showToast: (message: string, duration?: number) => void;
  t: (key: string, params?: Record<string, unknown>) => string;
};

export function useProjectSync(input: UseProjectSyncInput) {
  const { projects, activeProjectId, setProjects, setActiveProjectId, replaceProjectSessions, api, showToast, t } = input;
  const [worktreesByProject, setWorktreesByProject] = useState<Record<string, WorktreeEntry[]>>({});
  const [branchByProject, setBranchByProject] = useState<Record<string, string | null>>({});
  const [files, setFiles] = useState<FileTreeNode[]>([]);
  const [gitInfo, setGitInfo] = useState<GitBranchInfo>({ current: null, branches: [] });
  const [sessionLoadingByProject, setSessionLoadingByProject] = useState<Record<string, boolean>>({});
  const [visibleProjectChildCountByProject, setVisibleProjectChildCountByProject] = useState<Record<string, number>>({});
  const sessionRequestByProjectRef = useRef<Record<string, number>>({});
  const sessionRefreshRunningRef = useRef<Set<string>>(new Set());
  const sessionRefreshPendingRef = useRef<Set<string>>(new Set());

  async function refreshProjects() {
    const next = await api.projects.list();
    setProjects(next);
    if (!activeProjectId && next.length > 0) setActiveProjectId(next[0].id);
    for (const p of next) { if (p.worktreeEnabled) void refreshWorktrees(p.id); }
  }

  async function refreshWorktrees(projectId: string) {
    try {
      const [entries, branchInfo] = await Promise.all([
        api.git.worktreeList(projectId),
        api.git.branches(projectId).catch(() => ({ current: null, branches: [] })),
      ]);
      setWorktreesByProject((prev) => ({ ...prev, [projectId]: entries }));
      setBranchByProject((prev) => ({ ...prev, [projectId]: branchInfo.current }));
      const next = await api.projects.list();
      setProjects(next);
    } catch { setWorktreesByProject((prev) => ({ ...prev, [projectId]: [] })); }
  }

  async function refreshSessions(projectId = activeProjectId) {
    if (!projectId) return [];
    const records = await api.sessions.listCatalog(projectId);
    replaceProjectSessions({ projectId, sessions: records });
    return records.map(sessionRecordToSummary).filter((s): s is SessionSummary => Boolean(s)).sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async function refreshProjectSessions(projectId: string, silent = false): Promise<SessionRecord[] | undefined> {
    if (sessionRefreshRunningRef.current.has(projectId)) { sessionRefreshPendingRef.current.add(projectId); return; }
    const request = (sessionRequestByProjectRef.current[projectId] ?? 0) + 1;
    sessionRequestByProjectRef.current[projectId] = request;
    sessionRefreshRunningRef.current.add(projectId);
    if (!silent) { setSessionLoadingByProject((c) => ({ ...c, [projectId]: true })); await new Promise<void>((r) => setTimeout(r, 0)); }
    try {
      const records = await Promise.race([
        api.sessions.listCatalog(projectId),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error(t("app.sessionRefreshTimeout", {}))), SESSION_REFRESH_TIMEOUT_MS)),
      ]);
      if (sessionRequestByProjectRef.current[projectId] !== request) return records;
      replaceProjectSessions({ projectId, sessions: records });
      setVisibleProjectChildCountByProject((c) => ({ ...c, [projectId]: c[projectId] ?? SIDEBAR_PROJECT_CHILD_PAGE_SIZE }));
      return records;
    } finally {
      if (sessionRequestByProjectRef.current[projectId] === request) {
        sessionRefreshRunningRef.current.delete(projectId);
        if (!silent) setSessionLoadingByProject((c) => ({ ...c, [projectId]: false }));
        if (sessionRefreshPendingRef.current.delete(projectId)) { void refreshProjectSessions(projectId, true).catch(() => undefined); }
      }
    }
  }

  async function refreshProjectTree(project: Project) {
    await refreshProjectSessions(project.id);
    if (project.worktreeEnabled) {
      await refreshWorktrees(project.id);
      const latestProjects = await api.projects.list();
      setProjects(latestProjects);
      const childProjects = latestProjects.filter((p) => p.worktreeParentId === project.id);
      await Promise.all(childProjects.map((child) => refreshProjectSessions(child.id).catch(() => undefined)));
    }
    showToast(t("app.projectRefreshed", {}), 1800);
  }

  async function refreshFiles(projectId = activeProjectId, silent = false) {
    if (!projectId) return;
    const next = await api.files.list(projectId);
    setFiles(next);
    if (!silent) showToast(t("app.filesRefreshed", {}), 1800);
  }

  return { worktreesByProject, branchByProject, files, gitInfo, setGitInfo, sessionLoadingByProject, visibleProjectChildCountByProject, refreshProjects, refreshWorktrees, refreshSessions, refreshProjectSessions, refreshFiles, refreshProjectTree };
}
