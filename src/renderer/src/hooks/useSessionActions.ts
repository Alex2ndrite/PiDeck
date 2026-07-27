import type { MutableRefObject } from "react";
import type {
  Project,
  SessionRecord,
  SessionSummary,
} from "../../../shared/types";
import { isSameSessionPath } from "../agentListDisplay";
import { t } from "../i18n";

export type RefreshProjectSessions = (
  projectId: string,
  silent?: boolean,
) => Promise<SessionSummary[] | SessionRecord[] | undefined>;

export interface UseSessionActionsOptions {
  // Refs
  openSessionRequestRef: MutableRefObject<number>;
  creatingSessionDraftRef: MutableRefObject<Set<string>>;
  // State values
  activeProjectId: string | undefined;
  sessionsProjectId: string | undefined;
  projects: Project[];

  // State setters
  setActiveProjectId: (value: React.SetStateAction<string | undefined>) => void;
  setCurrentSessionId: (value: React.SetStateAction<string | undefined>) => void;

  // Getters
  getSessionRecord: (sessionId: string) => SessionRecord | undefined;
  getProjectSessionRecords: (projectId: string) => SessionRecord[];

  // Atom setters
  upsertSession: (session: SessionRecord) => void;
  removeSessionState: (sessionId: string) => void;
  removeSessionComposerState: (sessionId: string) => void;

  // Refresh callback. Callers own menu closing and foreground loading state.
  refreshProjectSessions: RefreshProjectSessions;

  // API
  api: {
    sessions: {
      copyRecord: (sessionId: string) => Promise<{ cancelled?: boolean; targetSessionId?: string }>;
      exportRecordHtml: (sessionId: string) => Promise<{ path: string }>;
      deleteRecord: (sessionId: string) => Promise<boolean>;
      createDraft: (input: { projectId: string; title: string }) => Promise<SessionRecord>;
    };
  };

  // Other callbacks
  showToast: (message: string, duration?: number) => void;
}

export function useSessionActions(options: UseSessionActionsOptions) {
  const {
    openSessionRequestRef,
    creatingSessionDraftRef,
    activeProjectId,
    sessionsProjectId,
    projects,
    setActiveProjectId,
    setCurrentSessionId,
    getSessionRecord,
    getProjectSessionRecords,
    upsertSession,
    removeSessionState,
    removeSessionComposerState,
    refreshProjectSessions,
    api,
    showToast,
  } = options;

  function commitSessionSelection(
    projectId: string,
    sessionId: string | undefined,
    scrollToEnd: boolean,
  ) {
    setActiveProjectId(projectId);
    setCurrentSessionId(sessionId);
    // useSessionTimelineController owns scroll restoration when the Session identity changes.
    void scrollToEnd;
  }

  function selectProject(projectId: string) {
    ++openSessionRequestRef.current;
    commitSessionSelection(projectId, undefined, false);
  }

  function selectSession(
    projectId: string,
    sessionId: string,
    scrollToEnd = true,
  ) {
    ++openSessionRequestRef.current;
    commitSessionSelection(projectId, sessionId, scrollToEnd);
  }

  // ── Session copy/export/delete ──

  async function copySession(
    sessionId: string,
    projectId = sessionsProjectId ?? activeProjectId,
  ) {
    if (!projectId) return;
    const result = await api.sessions.copyRecord(sessionId);
    if (result.cancelled) {
      showToast(t("app.sessionCopyCancelled"));
      return;
    }
    showToast(t("app.sessionCopied"));
    await refreshProjectSessions(projectId);
  }

  async function exportHistorySession(session: SessionSummary) {
    const result = await api.sessions.exportRecordHtml(session.id);
    showToast(t("app.exportedPath", { path: result.path }), 3500);
  }

  async function deleteHistorySession(session: SessionSummary) {
    await api.sessions.deleteRecord(session.id);
    removeSessionState(session.id);
    removeSessionComposerState(session.id);
    showToast(t("app.sessionDeleted"), 2200);
    const projectId = sessionsProjectId ?? activeProjectId;
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
        await refreshProjectSessions(projectId, true);
        if (requestSequence !== openSessionRequestRef.current) return;
        record = getProjectSessionRecords(projectId).find(
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

    commitSessionSelection(projectId, record.id, true);
  }

  async function openSidebarSessionById(projectId: string, sessionId: string) {
    const requestSequence = ++openSessionRequestRef.current;
    let record: SessionRecord | undefined = getSessionRecord(sessionId);
    if (!record || record.projectId !== projectId) {
      try {
        await refreshProjectSessions(projectId, true);
        if (requestSequence !== openSessionRequestRef.current) return;
        record = getProjectSessionRecords(projectId).find(
          (candidate) => candidate.id === sessionId,
        );
      } catch (error) {
        if (requestSequence !== openSessionRequestRef.current) return;
        showToast(error instanceof Error ? error.message : String(error), 4000);
        return;
      }
    }
    if (!record || requestSequence !== openSessionRequestRef.current) return;
    commitSessionSelection(projectId, record.id, true);
  }

  async function copySidebarSession(projectId: string, session: SessionSummary) {
    await copySession(session.id, projectId);
  }

  async function exportSidebarSession(_projectId: string, session: SessionSummary) {
    const result = await api.sessions.exportRecordHtml(session.id);
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
      commitSessionSelection(projectId, session.id, true);
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error), 4000);
    } finally {
      creatingSessionDraftRef.current.delete(projectId);
    }
  }

  return {
    selectProject,
    selectSession,
    copySession,
    exportHistorySession,
    deleteHistorySession,
    openSidebarSession,
    openSidebarSessionById,
    copySidebarSession,
    exportSidebarSession,
    createSessionDraft,
  };
}
