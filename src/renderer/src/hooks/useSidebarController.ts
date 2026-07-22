import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAtomValue } from "jotai";
import type { AgentTab, Project, SessionRecord, SessionSource } from "../../../shared/types";
import {
  agentInventoryAtom,
  projectInventoryAtom,
  sessionCatalogLoadStateAtom,
  sessionIdsByProjectAtom,
  sessionRecordsAtom,
  sessionRuntimeByIdAtom,
} from "../atoms";

export const SIDEBAR_PROJECT_CHILD_PAGE_SIZE = 5;
export const SIDEBAR_SESSION_SOURCES = ["pi", "codex", "claude", "opencode"] as const;

export type SidebarSourceFilter = Set<SessionSource> | null;
export type SidebarSourceFilters = Record<string, SidebarSourceFilter | undefined>;
export type SidebarMenuTarget =
  | { kind: "project"; projectId: string; x: number; y: number }
  | { kind: "agent"; agentId: string; x: number; y: number }
  | { kind: "session"; projectId: string; sessionId: string; x: number; y: number };

export type SidebarRpcLog = {
  id: string;
  agentId: string;
  direction: string;
  summary: string;
  time: number;
  data?: unknown;
};

export type SidebarCatalog = {
  projects: readonly Project[];
  agents: readonly AgentTab[];
  sessionsByProject: Readonly<Record<string, readonly SessionRecord[]>>;
  runtimeBySessionId: Readonly<Record<string, { agentId?: string; status: string } | undefined>>;
  catalogLoadStateByProject: Readonly<Record<string, { status: string } | undefined>>;
};

export type SidebarController = {
  catalog: SidebarCatalog;
  search: string;
  setSearch: (search: string) => void;
  collapsedProjectIds: ReadonlySet<string>;
  isProjectCollapsed: (projectId: string) => boolean;
  toggleProject: (projectId: string) => void;
  sourceFilterFor: (projectId: string) => SidebarSourceFilter;
  setSourceEnabled: (projectId: string, source: SessionSource, enabled: boolean) => void;
  clearSourceFilter: (projectId: string) => void;
  sourceFilterOpenProjectId?: string;
  openSourceFilter: (projectId: string) => void;
  closeSourceFilter: () => void;
  visibleChildCountFor: (projectId: string) => number;
  showMoreChildren: (projectId: string) => void;
  expandedSubagentGroups: ReadonlySet<string>;
  toggleSubagentGroup: (groupId: string) => void;
  expandedWorktreePaths: ReadonlySet<string>;
  expandWorktreeSessions: (path: string) => void;
  drag: { sourceProjectId?: string; overProjectId?: string };
  startProjectDrag: (projectId: string) => void;
  setProjectDropTarget: (projectId?: string) => void;
  finishProjectDrag: () => void;
  menu: SidebarMenuTarget | null;
  openMenu: (target: SidebarMenuTarget) => Promise<void>;
  closeMenu: () => void;
  isAgentRpcLogging: (agentId: string) => boolean;
  setAgentRpcLogging: (agentId: string, enabled: boolean) => void;
  sessionManagerProjectId?: string;
  openSessionManager: (projectId: string) => void;
  closeSessionManager: () => void;
  worktreeCreateProjectId?: string;
  openWorktreeCreate: (projectId: string) => void;
  closeWorktreeCreate: () => void;
  rpcLogAgentId?: string;
  rpcLogs: readonly SidebarRpcLog[];
  openRpcLogs: (agentId: string, load: (agentId: string) => Promise<SidebarRpcLog[]>) => Promise<void>;
  closeRpcLogs: () => void;
};

type StorageLike = Pick<Storage, "getItem" | "setItem">;
const SOURCE_FILTER_STORAGE_KEY = "pideck-session-source-filter";

export function getBoundSidebarRuntimeAgent(
  catalog: Pick<SidebarCatalog, "agents" | "runtimeBySessionId">,
  sessionId: string,
): AgentTab | undefined {
  const runtime = catalog.runtimeBySessionId[sessionId];
  if (!runtime?.agentId || runtime.status === "detached" || runtime.status === "closed" || runtime.status === "error") {
    return undefined;
  }
  const agent = catalog.agents.find((candidate) => candidate.id === runtime.agentId);
  return agent && agent.status !== "closed" && agent.status !== "error" ? agent : undefined;
}

export function createSidebarRequestGate() {
  let menuRequest = 0;
  let rpcLogRequest = 0;
  return {
    beginMenu: () => ++menuRequest,
    isCurrentMenu: (request: number) => request === menuRequest,
    cancelMenu: () => { menuRequest += 1; },
    beginRpcLogs: () => ++rpcLogRequest,
    isCurrentRpcLogs: (request: number) => request === rpcLogRequest,
    cancelRpcLogs: () => { rpcLogRequest += 1; },
  };
}

export function readSidebarSourceFilters(storage?: StorageLike): SidebarSourceFilters {
  if (!storage) return {};
  try {
    const parsed: unknown = JSON.parse(storage.getItem(SOURCE_FILTER_STORAGE_KEY) ?? "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const filters: SidebarSourceFilters = {};
    for (const [projectId, value] of Object.entries(parsed)) {
      if (value === null) filters[projectId] = null;
      else if (Array.isArray(value)) {
        const sources = value.filter((source): source is SessionSource =>
          typeof source === "string" && SIDEBAR_SESSION_SOURCES.includes(source as SessionSource),
        );
        filters[projectId] = new Set(sources);
      }
    }
    return filters;
  } catch {
    return {};
  }
}

export function serializeSidebarSourceFilters(filters: SidebarSourceFilters) {
  return JSON.stringify(Object.fromEntries(Object.entries(filters).map(([projectId, filter]) => [
    projectId,
    filter === null ? null : [...(filter ?? [])],
  ])));
}

export function filterSidebarSessions<T extends { source?: SessionSource }>(
  sessions: readonly T[],
  filter: SidebarSourceFilter,
) {
  return filter === null || filter === undefined
    ? sessions
    : sessions.filter((session) => filter.has(session.source ?? "pi"));
}

export function useSidebarController(options: {
  storage?: StorageLike;
  getRpcLogging?: (agentId: string) => Promise<boolean>;
  pageSize?: number;
} = {}): SidebarController {
  const projects = useAtomValue(projectInventoryAtom);
  const agents = useAtomValue(agentInventoryAtom);
  const sessionRecords = useAtomValue(sessionRecordsAtom);
  const sessionIdsByProject = useAtomValue(sessionIdsByProjectAtom);
  const sessionRuntimeById = useAtomValue(sessionRuntimeByIdAtom);
  const sessionCatalogLoadStateByProject = useAtomValue(sessionCatalogLoadStateAtom);
  const pageSize = options.pageSize ?? SIDEBAR_PROJECT_CHILD_PAGE_SIZE;
  const [search, setSearch] = useState("");
  const [collapsedProjectIds, setCollapsedProjectIds] = useState<Set<string>>(() => new Set());
  const [sourceFilters, setSourceFilters] = useState<SidebarSourceFilters>(() =>
    readSidebarSourceFilters(options.storage ?? (typeof window === "undefined" ? undefined : window.localStorage)),
  );
  const [visibleChildCountByProject, setVisibleChildCountByProject] = useState<Record<string, number>>({});
  const [sourceFilterOpenProjectId, setSourceFilterOpenProjectId] = useState<string>();
  const [expandedSubagentGroups, setExpandedSubagentGroups] = useState<Set<string>>(() => new Set());
  const [expandedWorktreePaths, setExpandedWorktreePaths] = useState<Set<string>>(() => new Set());
  const [drag, setDrag] = useState<{ sourceProjectId?: string; overProjectId?: string }>({});
  const [menu, setMenu] = useState<SidebarMenuTarget | null>(null);
  const [agentRpcLogging, setAgentRpcLoggingById] = useState<Map<string, boolean>>(() => new Map());
  const [sessionManagerProjectId, setSessionManagerProjectId] = useState<string>();
  const [worktreeCreateProjectId, setWorktreeCreateProjectId] = useState<string>();
  const [rpcLogAgentId, setRpcLogAgentId] = useState<string>();
  const [rpcLogs, setRpcLogs] = useState<SidebarRpcLog[]>([]);
  const requestGateRef = useRef(createSidebarRequestGate());

  useEffect(() => {
    const storage = options.storage ?? (typeof window === "undefined" ? undefined : window.localStorage);
    if (!storage) return;
    try {
      storage.setItem(SOURCE_FILTER_STORAGE_KEY, serializeSidebarSourceFilters(sourceFilters));
    } catch {
      // Local preferences are optional and must not make the Sidebar unusable.
    }
  }, [options.storage, sourceFilters]);

  const sessionsByProject = useMemo(() => Object.fromEntries(
    Object.entries(sessionIdsByProject).map(([projectId, sessionIds]) => [
      projectId,
      sessionIds.map((id) => sessionRecords[id]).filter((session): session is SessionRecord => Boolean(session)),
    ]),
  ), [sessionIdsByProject, sessionRecords]);
  const catalog = useMemo<SidebarCatalog>(() => ({
    projects,
    agents,
    sessionsByProject,
    runtimeBySessionId: sessionRuntimeById,
    catalogLoadStateByProject: sessionCatalogLoadStateByProject,
  }), [agents, projects, sessionCatalogLoadStateByProject, sessionRuntimeById, sessionsByProject]);

  const toggleProject = useCallback((projectId: string) => {
    setCollapsedProjectIds((current) => {
      const next = new Set(current);
      if (next.has(projectId)) next.delete(projectId);
      else next.add(projectId);
      return next;
    });
  }, []);
  const setSourceEnabled = useCallback((projectId: string, source: SessionSource, enabled: boolean) => {
    setSourceFilters((current) => {
      const previous = current[projectId] ?? null;
      const next = new Set(previous ?? SIDEBAR_SESSION_SOURCES);
      if (enabled) next.add(source);
      else next.delete(source);
      return { ...current, [projectId]: next.size === SIDEBAR_SESSION_SOURCES.length ? null : next };
    });
  }, []);
  const clearSourceFilter = useCallback((projectId: string) => {
    setSourceFilters((current) => ({ ...current, [projectId]: null }));
  }, []);
  const showMoreChildren = useCallback((projectId: string) => {
    setVisibleChildCountByProject((current) => ({
      ...current,
      [projectId]: (current[projectId] ?? pageSize) + pageSize,
    }));
  }, [pageSize]);
  const toggleSubagentGroup = useCallback((groupId: string) => {
    setExpandedSubagentGroups((current) => {
      const next = new Set(current);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  }, []);
  const expandWorktreeSessions = useCallback((path: string) => {
    setExpandedWorktreePaths((current) => new Set(current).add(path));
  }, []);
  const openMenu = useCallback(async (target: SidebarMenuTarget) => {
    const request = requestGateRef.current.beginMenu();
    if (target.kind === "agent" && options.getRpcLogging) {
      const logging = await options.getRpcLogging(target.agentId);
      if (!requestGateRef.current.isCurrentMenu(request)) return;
      setAgentRpcLoggingById((current) => new Map(current).set(target.agentId, logging));
    }
    if (requestGateRef.current.isCurrentMenu(request)) setMenu(target);
  }, [options.getRpcLogging]);
  const openRpcLogs = useCallback(async (
    agentId: string,
    load: (agentId: string) => Promise<SidebarRpcLog[]>,
  ) => {
    const request = requestGateRef.current.beginRpcLogs();
    const logs = await load(agentId);
    if (!requestGateRef.current.isCurrentRpcLogs(request)) return;
    setRpcLogs(logs);
    setRpcLogAgentId(agentId);
  }, []);

  return {
    catalog,
    search,
    setSearch,
    collapsedProjectIds,
    isProjectCollapsed: (projectId) => collapsedProjectIds.has(projectId),
    toggleProject,
    sourceFilterFor: (projectId) => sourceFilters[projectId] ?? null,
    setSourceEnabled,
    clearSourceFilter,
    sourceFilterOpenProjectId,
    openSourceFilter: setSourceFilterOpenProjectId,
    closeSourceFilter: () => setSourceFilterOpenProjectId(undefined),
    visibleChildCountFor: (projectId) => visibleChildCountByProject[projectId] ?? pageSize,
    showMoreChildren,
    expandedSubagentGroups,
    toggleSubagentGroup,
    expandedWorktreePaths,
    expandWorktreeSessions,
    drag,
    startProjectDrag: (projectId) => setDrag({ sourceProjectId: projectId }),
    setProjectDropTarget: (projectId) => setDrag((current) => ({ ...current, overProjectId: projectId })),
    finishProjectDrag: () => setDrag({}),
    menu,
    openMenu,
    closeMenu: () => {
      requestGateRef.current.cancelMenu();
      setMenu(null);
    },
    isAgentRpcLogging: (agentId) => agentRpcLogging.get(agentId) ?? false,
    setAgentRpcLogging: (agentId, enabled) => setAgentRpcLoggingById((current) => new Map(current).set(agentId, enabled)),
    sessionManagerProjectId,
    openSessionManager: setSessionManagerProjectId,
    closeSessionManager: () => setSessionManagerProjectId(undefined),
    worktreeCreateProjectId,
    openWorktreeCreate: setWorktreeCreateProjectId,
    closeWorktreeCreate: () => setWorktreeCreateProjectId(undefined),
    rpcLogAgentId,
    rpcLogs,
    openRpcLogs,
    closeRpcLogs: () => {
      requestGateRef.current.cancelRpcLogs();
      setRpcLogAgentId(undefined);
      setRpcLogs([]);
    },
  };
}
