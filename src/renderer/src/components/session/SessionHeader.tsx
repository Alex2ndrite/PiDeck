import { ChevronDown, Plus } from "lucide-react";
import { useAtomValue } from "jotai";
import { selectAtom } from "jotai/utils";
import { useMemo, type RefObject } from "react";
import type { AgentRuntimeState } from "../../../../shared/types";
import {
  sessionRecordByIdAtomFamily,
  sessionRuntimeBySessionIdAtomFamily,
  sessionSendStateByIdAtom,
} from "../../atoms";
import { t } from "../../i18n";
import { SessionStatus } from "./SurfaceParts";

type HeaderActions = {
  headerRef: RefObject<HTMLElement | null>;
  comboRef: RefObject<HTMLDivElement | null>;
  compactionCount?: number;
  duration?: number;
  hasProject: boolean;
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

type LegacySessionHeaderProps = HeaderActions & {
  mode?: "legacy";
  sessionId?: never;
  title: string;
  runtimeState?: AgentRuntimeState;
  isStarting: boolean;
  hasSession: boolean;
};

type ModernSessionHeaderProps = HeaderActions & {
  mode: "session";
  sessionId: string;
  title?: never;
  runtimeState?: never;
  isStarting?: never;
  hasSession?: never;
};

export type SessionHeaderProps = LegacySessionHeaderProps | ModernSessionHeaderProps;

export function SessionHeader(props: SessionHeaderProps) {
  const sessionMode = props.mode === "session";
  const sessionId = sessionMode ? props.sessionId : "";
  const legacyProps = props as LegacySessionHeaderProps;
  const session = useAtomValue(sessionRecordByIdAtomFamily(sessionId));
  const runtime = useAtomValue(sessionRuntimeBySessionIdAtomFamily(sessionId));
  const sendStateSelector = useMemo(
    () => selectAtom(
      sessionSendStateByIdAtom,
      (states) => states[sessionId],
      Object.is,
    ),
    [sessionId],
  );
  const sendState = useAtomValue(sendStateSelector);
  const title = sessionMode ? (session?.title ?? "PiDeck") : legacyProps.title;
  const runtimeState = sessionMode ? runtime?.state : legacyProps.runtimeState;
  const isStarting = sessionMode
    ? runtime?.status === "starting" || sendState?.status === "activating"
    : legacyProps.isStarting;
  const hasSession = sessionMode ? Boolean(session) : legacyProps.hasSession;

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
