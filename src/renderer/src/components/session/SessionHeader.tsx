import { ChevronDown, Plus } from "lucide-react";
import { useAtomValue } from "jotai";
import type { RefObject } from "react";
import type { AgentRuntimeState } from "../../../../shared/types";
import {
  currentSessionIdAtom,
  sessionRecordByIdAtomFamily,
  sessionRuntimeBySessionIdAtomFamily,
} from "../../atoms";
import { t } from "../../i18n";
import { SessionStatus } from "../app/AppParts";

export type SessionHeaderProps = {
  /** A8 passes this explicitly; currentSessionId is the compatibility fallback. */
  sessionId?: string;
  headerRef: RefObject<HTMLElement | null>;
  comboRef: RefObject<HTMLDivElement | null>;
  title?: string;
  compactionCount?: number;
  runtimeState?: AgentRuntimeState;
  duration?: number;
  isStarting: boolean;
  hasProject: boolean;
  hasSession: boolean;
  menuOpen: boolean;
  notice?: string;
  canStop: boolean;
  canRestart: boolean;
  isRestarting: boolean;
  showRestart: boolean;
  onTrigger: () => void;
  onNewSession: () => void;
  onStop: () => void;
  onRestart: () => void;
};

export function SessionHeader(props: SessionHeaderProps) {
  const currentSessionId = useAtomValue(currentSessionIdAtom);
  const sessionId = props.sessionId ?? currentSessionId;
  const session = useAtomValue(sessionRecordByIdAtomFamily(sessionId ?? ""));
  const runtime = useAtomValue(sessionRuntimeBySessionIdAtomFamily(sessionId ?? ""));
  const title = props.title ?? session?.title ?? "PiDeck";
  const runtimeState = props.runtimeState ?? runtime?.state;
  const isStarting = props.isStarting || runtime?.status === "starting";
  const hasSession = props.hasSession || Boolean(sessionId);

  return (
    <header ref={props.headerRef} className="chat-header">
      <div className="chat-title-block">
        <div className="chat-title-row">
          <strong title={title}>{title}</strong>
          {props.compactionCount ? (
            <span
              className="compaction-count-badge"
              title={t("app.compactionTooltip", {
                count: props.compactionCount,
              })}
            >
              {props.compactionCount}
            </span>
          ) : null}
        </div>
      </div>
      <div className={`chat-header-actions${isStarting ? " loading" : ""}`}>
        <SessionStatus state={runtimeState} duration={props.duration} />
        <div className="header-actions-right">
          <div className="header-action-group session-group">
            <div className="session-combo" ref={props.comboRef}>
              <button
                className="session-combo-trigger"
                disabled={!props.hasProject || isStarting}
                title={t("app.newSession")}
                onClick={props.onTrigger}
              >
                <Plus size={14} strokeWidth={2} aria-hidden="true" />
                <span className="session-combo-label">{t("app.new")}</span>
                {hasSession && (
                  <span
                    className={`session-combo-chevron${props.menuOpen ? " open" : ""}`}
                  >
                    <ChevronDown size={12} />
                  </span>
                )}
              </button>
              {props.notice && (
                <div className="app-notice" role="status">
                  {props.notice}
                </div>
              )}
              {props.menuOpen && hasSession && (
                <div className="session-combo-menu">
                  <button onClick={props.onNewSession}>
                    <span>{t("app.newSession")}</span>
                  </button>
                  <div className="session-combo-divider" />
                  <button disabled={!props.canStop} onClick={props.onStop}>
                    {t("app.stop")}
                  </button>
                  {props.showRestart && (
                    <button disabled={!props.canRestart} onClick={props.onRestart}>
                      {props.isRestarting
                        ? t("app.restarting")
                        : t("app.restart")}
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
