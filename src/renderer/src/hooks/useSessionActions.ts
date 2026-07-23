import { useRef, useCallback } from "react";
import type { MutableRefObject } from "react";
import type {
  Project,
  SessionRecord,
  SessionSummary,
} from "../../../shared/types";
import { isSameSessionPath } from "../agentListDisplay";
import { t } from "../i18n";
import type { desktopApi as DesktopApi } from "../desktopApi";

/** Mirrors the sessionRefSelections shape from App.tsx. */
export type SessionRefSelectionEntry = {
  messages: Array<{ role: string; content: string }>;
  fullContext: boolean;
  selectedIndices: number[];
};

export type RefreshSessions = (
  projectId?: string,
) => Promise<SessionSummary[]>;

export type RefreshProjectSessions = (
  projectId: string,
  silent?: boolean,
) => Promise<SessionSummary[] | SessionRecord[] | undefined>;

export interface UseSessionActionsOptions {
  // Refs
  openSessionRequestRef: MutableRefObject<number>;
  creatingSessionDraftRef: MutableRefObject<Set<string>>;
  autoScrollRef: MutableRefObject<boolean>;
  composerTextareaRef: MutableRefObject<HTMLDivElement | null>;

  // State values
  activeProjectId: string | undefined;
  sessionsProjectId: string | undefined;
  projects: Project[];
  activeProjectSessions: SessionSummary[];
  sessionRefSelections: Record<string, SessionRefSelectionEntry>;

  // State setters
  setActiveProjectId: (value: React.SetStateAction<string | undefined>) => void;
  setCurrentSessionId: (value: React.SetStateAction<string | undefined>) => void;
  setAutoScroll: (value: React.SetStateAction<boolean>) => void;
  setSessionRefSelections: (value: React.SetStateAction<Record<string, SessionRefSelectionEntry>>) => void;

  // Getters
  getSessionRecord: (sessionId: string) => SessionRecord | undefined;
  getProjectSessionRecords: (projectId: string) => SessionRecord[];

  // Atom setters
  replaceProjectSessions: (args: { projectId: string; sessions: SessionRecord[] }) => void;
  upsertSession: (session: SessionRecord) => void;
  removeSessionState: (sessionId: string) => void;
  removeSessionComposerState: (sessionId: string) => void;

  // Refresh callbacks. Callers own menu closing and foreground loading state.
  refreshSessions: RefreshSessions;
  refreshProjectSessions: RefreshProjectSessions;

  // API
  api: {
    sessions: {
      copy: (projectId: string, filePath: string) => Promise<{ cancelled?: boolean; targetSessionId?: string }>;
      exportHtml: (projectId: string, filePath: string) => Promise<{ path: string }>;
      deleteRecord: (sessionId: string) => Promise<boolean>;
      createDraft: (input: { projectId: string; title: string }) => Promise<SessionRecord>;
      listCatalog: (projectId: string) => Promise<SessionRecord[]>;
      readMessages: (filePath: string) => Promise<Array<{ role: string; content: string }>>;
    };
  };

  // Other callbacks
  showToast: (message: string, duration?: number) => void;
}

export function useSessionActions(options: UseSessionActionsOptions) {
  const {
    openSessionRequestRef,
    creatingSessionDraftRef,
    autoScrollRef,
    composerTextareaRef,
    activeProjectId,
    sessionsProjectId,
    projects,
    activeProjectSessions,
    sessionRefSelections,
    setActiveProjectId,
    setCurrentSessionId,
    setAutoScroll,
    setSessionRefSelections,
    getSessionRecord,
    getProjectSessionRecords,
    replaceProjectSessions,
    upsertSession,
    removeSessionState,
    removeSessionComposerState,
    refreshSessions,
    refreshProjectSessions,
    api,
    showToast,
  } = options;

  // ── Session copy/export/delete ──

  async function copySession(
    filePath: string,
    projectId = sessionsProjectId ?? activeProjectId,
  ) {
    if (!projectId) return;
    const result = await api.sessions.copy(projectId, filePath);
    if (result.cancelled) {
      showToast(t("app.sessionCopyCancelled"));
      return;
    }
    showToast(t("app.sessionCopied"));
    await refreshSessions(projectId);
    await refreshProjectSessions(projectId);
  }

  async function exportHistorySession(session: SessionSummary) {
    const projectId = sessionsProjectId ?? activeProjectId;
    if (!projectId) return;
    const result = await api.sessions.exportHtml(projectId, session.filePath);
    showToast(t("app.exportedPath", { path: result.path }), 3500);
  }

  async function deleteHistorySession(session: SessionSummary) {
    await api.sessions.deleteRecord(session.id);
    removeSessionState(session.id);
    removeSessionComposerState(session.id);
    showToast(t("app.sessionDeleted"), 2200);
    const projectId = sessionsProjectId ?? activeProjectId;
    await refreshSessions(projectId);
    if (projectId) await refreshProjectSessions(projectId);
  }

  // ── Sidebar session actions ──

  async function openSidebarSession(
    projectId: string,
    session: SessionSummary,
  ) {
    const requestSequence = ++openSessionRequestRef.current;
    const cachedRecord = getSessionRecord(session.id);
    let record: SessionRecord | undefined =
      cachedRecord?.projectId === projectId
        ? cachedRecord
        : getProjectSessionRecords(projectId).find(
            (candidate) =>
              candidate.filePath &&
              isSameSessionPath(
                candidate.filePath,
                session.filePath,
                candidate.environment,
              ),
          );
    if (!record) {
      try {
        const projectSessions = await api.sessions.listCatalog(projectId);
        if (requestSequence !== openSessionRequestRef.current) return;
        replaceProjectSessions({ projectId, sessions: projectSessions });
        record = projectSessions.find(
          (candidate) =>
            candidate.filePath &&
            isSameSessionPath(
              candidate.filePath,
              session.filePath,
              candidate.environment,
            ),
        );
      } catch (error) {
        if (requestSequence !== openSessionRequestRef.current) return;
        showToast(error instanceof Error ? error.message : String(error), 4000);
        return;
      }
    }
    if (!record || requestSequence !== openSessionRequestRef.current) return;

    setActiveProjectId(projectId);
    setCurrentSessionId(record.id);
    setAutoScroll(true);
    autoScrollRef.current = true;
  }

  async function openSidebarSessionById(projectId: string, sessionId: string) {
    const requestSequence = ++openSessionRequestRef.current;
    let record: SessionRecord | undefined = getSessionRecord(sessionId);
    if (!record || record.projectId !== projectId) {
      try {
        const projectSessions = await api.sessions.listCatalog(projectId);
        if (requestSequence !== openSessionRequestRef.current) return;
        replaceProjectSessions({ projectId, sessions: projectSessions });
        record = projectSessions.find((candidate) => candidate.id === sessionId);
      } catch (error) {
        if (requestSequence !== openSessionRequestRef.current) return;
        showToast(error instanceof Error ? error.message : String(error), 4000);
        return;
      }
    }
    if (!record || requestSequence !== openSessionRequestRef.current) return;
    setActiveProjectId(projectId);
    setCurrentSessionId(record.id);
    setAutoScroll(true);
    autoScrollRef.current = true;
  }

  async function copySidebarSession(projectId: string, session: SessionSummary) {
    await copySession(session.filePath, projectId);
  }

  async function exportSidebarSession(projectId: string, session: SessionSummary) {
    const result = await api.sessions.exportHtml(projectId, session.filePath);
    showToast(t("app.exportedPath", { path: result.path }), 3500);
  }

  // ── Session draft ──

  async function createSessionDraft(projectId = activeProjectId) {
    if (!projectId || creatingSessionDraftRef.current.has(projectId)) return;
    const project = projects.find((item) => item.id === projectId);
    if (!project) return;
    creatingSessionDraftRef.current.add(projectId);
    try {
      const session = await api.sessions.createDraft({
        projectId,
        title: `${project.name} agent`,
      });
      upsertSession(session);
      setActiveProjectId(projectId);
      setCurrentSessionId(session.id);
      setAutoScroll(true);
      autoScrollRef.current = true;
      requestAnimationFrame(() => composerTextareaRef.current?.focus());
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error), 4000);
    } finally {
      creatingSessionDraftRef.current.delete(projectId);
    }
  }

  // ── Session references ──

  async function resolveSessionRefs(message: string): Promise<string> {
    let resolved = message;
    const sorted = [...activeProjectSessions].sort(
      (a, b) => (b.name ?? b.filePath).length - (a.name ?? a.filePath).length,
    );
    for (const session of sorted) {
      const sessionName = session.name ?? session.filePath;
      const raw = `&${sessionName}`;
      const lowerResolved = resolved.toLowerCase();
      const lowerRaw = raw.toLowerCase();
      if (!lowerResolved.includes(lowerRaw)) continue;
      const pattern = new RegExp(raw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
      let msgs: Array<{ role: string; content: string }> | undefined;
      if (sessionRefSelections[raw]) {
        msgs = sessionRefSelections[raw].messages;
      } else {
        try {
          const all = await api.sessions.readMessages(session.filePath);
          const loaded = all.map((m) => ({ role: m.role, content: m.content }));
          msgs = loaded;
          setSessionRefSelections((prev) => ({ ...prev, [raw]: { messages: loaded, fullContext: true, selectedIndices: loaded.map((_, i) => i) } }));
        } catch {
          // 加载失败时 chip 会在下面 else 分支被移除
        }
      }

      if (msgs && msgs.length > 0) {
        const ctx = msgs.map((m) => `[${m.role === "user" ? "User" : "Assistant"}]: ${m.content}`).join("\n");
        const refBlock = `<referenced_session name="${sessionName}">\n${ctx}\n</referenced_session>`;
        resolved = resolved.replace(pattern, refBlock);
      } else {
        resolved = resolved.replace(pattern, "");
      }
    }
    return resolved;
  }

  return {
    copySession,
    exportHistorySession,
    deleteHistorySession,
    openSidebarSession,
    openSidebarSessionById,
    copySidebarSession,
    exportSidebarSession,
    createSessionDraft,
    resolveSessionRefs,
  };
}
