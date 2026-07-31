import { ChevronDown, HatGlasses, PanelRight, Plus } from "lucide-react";
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
import { Button } from "../ui-shadcn/button";
import { IconButton } from "../ui/IconButton";
import { SessionStatus } from "./SurfaceParts";

type HeaderActions = {
  headerRef: RefObject<HTMLElement | null>;
  comboRef: RefObject<HTMLDivElement | null>;
  compactionCount?: number;
  isAnonymous?: boolean;
  duration?: number;
  hasProject: boolean;
  menuOpen: boolean;
  canStop: boolean;
  canRestart: boolean;
  isRestarting: boolean;
  showRestart: boolean;
  onTrigger: () => void;
  onNewSession: () => void;
  onStop: () => void;
  onRestart: () => void;
  /** 右侧抽屉开关：与 main 会话标题栏行为对齐，保持现有 IconButton 风格 */
  onToggleDrawer?: () => void;
  drawerOpen?: boolean;
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
  const isAnonymous = props.isAnonymous || (sessionMode && session?.noSession === true);

  return (
    <header
      ref={props.headerRef}
      className="chat-header grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-border bg-background px-4 py-2.5"
    >
      <div className="chat-title-block flex min-w-0 flex-1 items-center">
        <div className="chat-title-row flex h-8 w-full min-w-0 items-center gap-2">
          <strong className="block min-w-0 flex-1 truncate text-base font-semibold tracking-tight text-foreground" title={title}>{title}</strong>
          {isAnonymous && (
            <span className="anonymous-badge" title={t("app.anonymousChat")} aria-label={t("app.anonymousChat")}>
              <HatGlasses size={14} aria-hidden="true" />
            </span>
          )}
          {props.compactionCount ? (
            <span
              className="compaction-count-badge inline-flex h-5 min-w-5 items-center justify-center rounded-full border border-border bg-muted px-1.5 text-[11px] font-medium text-muted-foreground"
              title={t("app.compactionTooltip", {
                count: props.compactionCount,
              })}
            >
              {props.compactionCount}
            </span>
          ) : null}
        </div>
      </div>
      <div className={`chat-header-actions flex min-w-0 items-center justify-end gap-2${isStarting ? " loading" : ""}`}>
        <SessionStatus state={runtimeState} duration={props.duration} />
        <div className="header-actions-right flex items-center gap-1.5">
          <div className="header-action-group session-group">
            <div className="session-combo relative" ref={props.comboRef}>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="session-combo-trigger h-8 gap-1 px-2.5"
                disabled={!props.hasProject || isStarting}
                title={t("app.newSession")}
                onClick={props.onTrigger}
              >
                <Plus className="size-3.5" strokeWidth={2} aria-hidden="true" />
                <span className="session-combo-label">{t("app.new")}</span>
                {hasSession && (
                  <span
                    className={`session-combo-chevron${props.menuOpen ? " open" : ""}`}
                  >
                    <ChevronDown className="size-3" />
                  </span>
                )}
              </Button>
              {props.menuOpen && hasSession && (
                <div className="session-combo-menu absolute top-[calc(100%+6px)] right-0 z-50 min-w-40 overflow-hidden rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md">
                  <button type="button" className="flex w-full items-center rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent" onClick={props.onNewSession}>
                    <span>{t("app.newSession")}</span>
                  </button>
                  <div className="session-combo-divider my-1 h-px bg-border" />
                  <button type="button" className="flex w-full items-center rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent disabled:opacity-50" disabled={!props.canStop} onClick={props.onStop}>
                    {t("app.stop")}
                  </button>
                  {props.showRestart && (
                    <button type="button" className="flex w-full items-center rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent disabled:opacity-50" disabled={!props.canRestart} onClick={props.onRestart}>
                      {props.isRestarting
                        ? t("app.restarting")
                        : t("app.restart")}
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
          {props.onToggleDrawer && (
            <IconButton
              label={props.drawerOpen ? t("app.collapseDrawer") : t("app.expandDrawer")}
              className={`header-drawer-toggle${props.drawerOpen ? " active" : ""}`}
              onClick={props.onToggleDrawer}
            >
              <PanelRight size={14} strokeWidth={2} aria-hidden="true" />
            </IconButton>
          )}
        </div>
      </div>
    </header>
  );
}
