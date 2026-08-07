import { HatGlasses, PanelRight } from "lucide-react";
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
  /** 右侧抽屉开关（main 布局：状态徽章右侧），不传则不渲染 */
  onToggleDrawer?: () => void;
  drawerOpen?: boolean;
  /** 将状态/操作区嵌入 Tab 栏，避免当前会话再单独占一行。 */
  embedded?: boolean;
  /** 头部左侧槽位（Todo/Plan 等扩展 widget chips）；会话标题迁走后左侧留空，widget 入口落在这里。 */
  widgetChips?: ReactNode;
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
 * 渲染会话状态徽章与抽屉入口。
 * 会话运行控制（停止/重启）已迁入 Tab 下拉（SessionTabsBar），此组件不再承载操作菜单；
 * embedded 模式供 Tab 栏复用；普通模式保留旧 header 外壳，便于兼容其他调用方。
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
      className={`chat-header-actions flex min-w-0 items-center justify-end gap-1.5${props.embedded ? " h-7 w-auto shrink-0" : " w-full"}${isStarting ? " loading" : ""}`}
    >
      {props.widgetChips}
      {isAnonymous && (
        <span className="anonymous-badge" title={t("app.anonymousChat")} aria-label={t("app.anonymousChat")}>
          <HatGlasses size={14} aria-hidden="true" />
        </span>
      )}
      <SessionStatus state={runtimeState} duration={props.duration} cacheHitHistory={cacheStats[sessionId]?.cacheHitHistory} />
      <div className="header-actions-right flex items-center gap-1.5">
        {props.onToggleDrawer && (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={props.drawerOpen ? t("app.collapseDrawer") : t("app.expandDrawer")}
            title={props.drawerOpen ? t("app.collapseDrawer") : t("app.expandDrawer")}
            className={`header-drawer-toggle size-7${props.drawerOpen ? " active" : ""}`}
            onClick={props.onToggleDrawer}
          >
            <PanelRight size={13} strokeWidth={2} aria-hidden="true" />
          </Button>
        )}
      </div>
    </div>
  );

  if (props.embedded) return actions;
  return (
    <div
      ref={props.headerRef}
      role="banner"
      /* 仅作为旧调用方兼容壳；当前 SessionView 使用 embedded 模式。 */
      className="chat-header grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 border-b border-border/40 bg-background px-3 py-1"
    >
      {actions}
    </div>
  );
}
