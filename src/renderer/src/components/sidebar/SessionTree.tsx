import { Fragment, type ReactNode } from "react";
import { ChevronDown, Trash2 } from "lucide-react";
import type { AgentTab, Project, SessionRecord, SessionSummary } from "../../../../shared/types";
import { getAgentForSessionPath, getProjectAgentSessionDisplay, getSessionRowKey } from "../../agentListDisplay";
import { sessionRecordToSummary } from "../../atoms";
import { t } from "../../i18n";
import { filterSidebarSessions, type SidebarController } from "../../hooks/useSidebarController";
import type { SidebarActions } from "./SidebarContent";

function matchesSearch(value: string, search: string) {
  return !search || value.toLowerCase().includes(search.toLowerCase());
}

function formatCodexSubagentName(session: SessionSummary) {
  return [session.codexAgentNickname, session.codexAgentRole].filter(Boolean).join(" · ") ||
    session.name || t("app.codexSubagent");
}

function formatPiSubagentName(session: SessionSummary) {
  return session.name || t("app.piSubagent");
}

export function SessionTree(props: {
  project: Project;
  sessions: readonly SessionRecord[];
  agents: readonly AgentTab[];
  currentSessionId?: string;
  controller: SidebarController;
  actions: SidebarActions;
  nested?: boolean;
  visibleChildCount?: number;
  onShowMore?: () => void;
}) {
  const filter = props.controller.sourceFilterFor(props.project.id);
  const search = props.controller.search.trim();
  const draftSessions = props.sessions
    .filter((session) => session.status === "draft")
    .filter((session) => matchesSearch(session.title, search))
    .filter((session) => filter === null || filter.has(session.source))
    .sort((left, right) => right.updatedAt - left.updatedAt);
  const summaries = filterSidebarSessions(
    props.sessions.flatMap((session) => sessionRecordToSummary(session) ? [sessionRecordToSummary(session)!] : []),
    filter,
  ).filter((session) => matchesSearch(`${session.name ?? ""}${session.preview}${session.filePath}`, search));
  const projectAgents = props.agents.filter((agent) => agent.projectId === props.project.id);
  const display = getProjectAgentSessionDisplay({
    agents: projectAgents,
    sessions: summaries,
    visibleChildCount: props.visibleChildCount ?? (props.nested ? Number.MAX_SAFE_INTEGER : props.controller.visibleChildCountFor(props.project.id)),
  });
  const hasRows = draftSessions.length > 0 || display.visibleChildren.length > 0 || display.hiddenChildCount > 0;
  if (!hasRows) return null;

  const openContext = (event: React.MouseEvent, session: SessionSummary, runtime?: AgentTab) => {
    event.preventDefault();
    void props.controller.openMenu(runtime
      ? { kind: "agent", agentId: runtime.id, x: event.clientX, y: event.clientY }
      : { kind: "session", projectId: props.project.id, sessionId: session.id, x: event.clientX, y: event.clientY });
  };
  const renderSubagent = (session: SessionSummary, label: ReactNode) => {
    const runtime = getAgentForSessionPath(projectAgents, session.filePath, session.wsl ? "wsl" : "native");
    return (
      <button
        key={getSessionRowKey(session)}
        className={`conversation agent-row session-row codex-subagent-sidebar-row${session.id === props.currentSessionId ? " active" : ""}`}
        title={session.filePath}
        onContextMenu={(event) => openContext(event, session, runtime)}
        onClick={() => void props.actions.sessions.open(props.project.id, session.id)}
      >
        <div className="conversation-body"><div className="conversation-title">{label}</div></div>
      </button>
    );
  };
  const renderSubagents = (parentKey: string, codex: SessionSummary[], pi: SessionSummary[]) => {
    if (codex.length + pi.length === 0 || !props.controller.expandedSubagentGroups.has(parentKey)) return null;
    return (
      <div className="codex-subagent-sidebar-group">
        {codex.map((session) => renderSubagent(session, <><strong>{formatCodexSubagentName(session)}</strong><span className="session-source-badge codex subagent">{t("app.codexSubagent")}</span></>))}
        {pi.map((session) => renderSubagent(session, <strong>{formatPiSubagentName(session)}</strong>))}
      </div>
    );
  };
  const renderToggle = (key: string, count: number) => count > 0 ? (
    <span
      className="subagent-inline-toggle"
      title={t("app.piSubagentCount", { count })}
      onClick={(event) => { event.stopPropagation(); props.controller.toggleSubagentGroup(key); }}
    >
      <ChevronDown size={10} className={props.controller.expandedSubagentGroups.has(key) ? "expanded" : ""} />
      <span className="subagent-inline-count">{count}</span>
    </span>
  ) : null;

  return (
    <div className={props.nested ? "worktree-children" : "session-card"}>
      {draftSessions.map((session) => {
        const runtime = props.controller.catalog.runtimeBySessionId[session.id];
        return (
          <button
            key={`draft:${session.id}`}
            className={`conversation agent-row session-row${session.id === props.currentSessionId ? " active" : ""}`}
            title={session.title}
            onClick={() => void props.actions.sessions.open(props.project.id, session.id)}
          >
            <span className="session-node-marker" aria-hidden="true" />
            <div className="conversation-body"><div className="conversation-title">
              {runtime && runtime.status !== "detached" && <span className={`agent-status-indicator status-${runtime.status}`}>{runtime.status}</span>}
              <strong>{session.title}</strong>
            </div></div>
            <span className="project-action" role="button" tabIndex={0} title={t("common.delete")}
              onClick={(event) => { event.stopPropagation(); void props.actions.sessions.deleteDraft(session); }}
              onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); void props.actions.sessions.deleteDraft(session); } }}
            ><Trash2 size={12} /></span>
          </button>
        );
      })}
      {display.visibleChildren.map((child) => {
        const groupKey = `${props.project.id}:${child.key}`;
        const childCount = child.codexSubagents.length + child.piSubagents.length;
        if (child.type === "agent") {
          const agentSession = summaries.find((session) => session.filePath === child.agent.sessionPath);
          return <Fragment key={child.key}>
            <button className={`conversation agent-row${agentSession?.id === props.currentSessionId ? " active" : ""}`}
              onContextMenu={(event) => { event.preventDefault(); void props.controller.openMenu({ kind: "agent", agentId: child.agent.id, x: event.clientX, y: event.clientY }); }}
              onClick={() => { if (agentSession) void props.actions.sessions.open(props.project.id, agentSession.id); }}
            >
              <span className="agent-node-marker" aria-hidden="true" /><div className="conversation-body"><div className="conversation-title">
                <span className={`agent-status-indicator status-${child.agent.status}`}>{child.agent.status}</span><strong>{child.agent.title}</strong>{renderToggle(groupKey, childCount)}
              </div></div>
            </button>
            {renderSubagents(groupKey, child.codexSubagents, child.piSubagents)}
          </Fragment>;
        }
        const runtime = child.agent;
        return <Fragment key={getSessionRowKey(child.session)}>
          <button
            className={`conversation agent-row session-row${child.session.id === props.currentSessionId ? " active" : ""}`}
            title={child.session.filePath}
            onContextMenu={(event) => openContext(event, child.session, runtime)}
            onClick={() => void props.actions.sessions.open(props.project.id, child.session.id)}
          >
            <span className="session-node-marker" aria-hidden="true" /><div className="conversation-body"><div className="conversation-title">
              {runtime && <span className={`agent-status-indicator status-${runtime.status}`}>{runtime.status}</span>}
              <strong>{child.session.name || t("common.untitled")}</strong>
              {child.session.source && child.session.source !== "pi" && <span className={`session-source-badge ${child.session.source}`}>{t(`sessionSource.${child.session.source}` as never)}</span>}
              {renderToggle(groupKey, childCount)}
            </div></div>
          </button>
          {renderSubagents(groupKey, child.codexSubagents, child.piSubagents)}
        </Fragment>;
      })}
      {display.hiddenChildCount > 0 && (
        <button
          className={props.nested ? "worktree-sessions-more" : "session-more-row"}
          onClick={props.onShowMore ?? (() => props.controller.showMoreChildren(props.project.id))}
        >
          <span>{props.nested
            ? t("app.worktreeShowMoreSessions", { count: display.hiddenChildCount })
            : t("app.projectShowMoreChildren", { count: display.hiddenChildCount })}
          </span>
        </button>
      )}
    </div>
  );
}
