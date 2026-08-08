import { HatGlasses, Maximize2 } from "lucide-react";
import { useAtomValue } from "jotai";
import { selectAtom } from "jotai/utils";
import { useMemo, type ReactNode, type RefObject } from "react";
import type { AgentRuntimeState } from "../../../../shared/types";
import {
  sessionCacheStatsAtom,
  sessionRecordByIdAtomFamily,
  sessionRuntimeBySessionIdAtomFamily,
  sessionSendStateByIdAtom,
} from "../../atoms";
import { t } from "../../i18n";
import { Button } from "../ui-shadcn/button";
import { SessionStatus } from "./SurfaceParts";

type HeaderActions = {
  headerRef: RefObject<HTMLDivElement | null>;
  compactionCount?: number;
  isAnonymous?: boolean;
  duration?: number;
  /** 将状态/操作区嵌入 Tab 栏，避免当前会话再单独占一行。 */
  embedded?: boolean;
  /** 头部左侧槽位（Todo/Plan 等扩展 widget chips）；会话标题迁走后左侧留空，widget 入口落在这里。 */
  widgetChips?: ReactNode;
  /**
   * 分屏栏内显示本栏会话标题，避免「共享顶栏 Tab ↔ 左右栏」对不上号。
   * 单栏时标题已在外置 Tab 上，通常不传。
   */
  paneTitle?: string;
  /** 退出会话分屏（扩大为单栏）；仅分屏时提供 */
  onExitSplit?: () => void;
};

type LegacySessionHeaderProps = HeaderActions & {
  mode?: "legacy";
  sessionId?: never;
  title: string;
  runtimeState?: AgentRuntimeState;
  isStarting: boolean;
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

/**
 * 渲染会话状态徽章（+ 分屏身份标题）。
 * 会话运行控制（停止/重启）已迁入 Tab 下拉（SessionTabsBar 的 canStopCurrent 链路），
 * 此组件不再承载操作菜单；embedded 模式供 Tab 栏 actions 复用；普通模式保留
 * 分屏 pane 外壳（paneTitle + 退出分屏）。
 */
export function SessionHeader(props: SessionHeaderProps) {
  const sessionMode = props.mode === "session";
  const sessionId = sessionMode ? props.sessionId : "";
  const legacyProps = props as LegacySessionHeaderProps;
  const session = useAtomValue(sessionRecordByIdAtomFamily(sessionId));
  const runtime = useAtomValue(sessionRuntimeBySessionIdAtomFamily(sessionId));
  // 会话级缓存命中率历史（统计快照由 runtime 事件写入 atom），供状态入口展示。
  const cacheStats = useAtomValue(sessionCacheStatsAtom);
  const sendStateSelector = useMemo(
    () => selectAtom(
      sessionSendStateByIdAtom,
      (states) => states[sessionId],
      Object.is,
    ),
    [sessionId],
  );
  const sendState = useAtomValue(sendStateSelector);
  const runtimeState = sessionMode ? runtime?.state : legacyProps.runtimeState;
  const isStarting = sessionMode
    ? runtime?.status === "starting" || sendState?.status === "activating"
    : legacyProps.isStarting;
  const isAnonymous = props.isAnonymous || (sessionMode && session?.noSession === true);

  const actions = (
    <div
      ref={props.embedded ? props.headerRef : undefined}
      className={`chat-header-actions flex min-w-0 items-center justify-end gap-1.5${props.embedded ? " h-7 w-auto shrink-0" : ""}${isStarting ? " loading" : ""}`}
    >
      {props.widgetChips}
      {isAnonymous && (
        <span className="anonymous-badge" title={t("app.anonymousChat")} aria-label={t("app.anonymousChat")}>
          <HatGlasses size={14} aria-hidden="true" />
        </span>
      )}
      <SessionStatus state={runtimeState} duration={props.duration} cacheHitHistory={cacheStats[sessionId]?.cacheHitHistory} />
    </div>
  );

  if (props.embedded) return actions;
  return (
    <div
      ref={props.headerRef}
      role="banner"
      /* 普通模式：分屏 pane 的会话身份行（Tab 已外置）。
         底部分隔线去掉：分屏身份标题下再叠一条线过于碎。 */
      className="chat-header grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 bg-background px-3 py-1"
    >
      <div className="flex min-w-0 items-center gap-1.5">
        {props.onExitSplit ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="size-7 shrink-0 text-muted-foreground hover:text-foreground"
            title={t("session.split.exit")}
            aria-label={t("session.split.exit")}
            onClick={(event) => {
              event.stopPropagation();
              props.onExitSplit?.();
            }}
          >
            <Maximize2 className="size-3.5" aria-hidden="true" />
          </Button>
        ) : null}
        {props.paneTitle ? (
          <span
            className="session-pane-title min-w-0 truncate text-caption font-medium text-foreground"
            title={props.paneTitle}
          >
            {props.paneTitle}
          </span>
        ) : (
          <span className="min-w-0" aria-hidden="true" />
        )}
      </div>
      {actions}
    </div>
  );
}
