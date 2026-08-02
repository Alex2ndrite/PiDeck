import { useAtomValue } from "jotai";
import { Plus, X } from "lucide-react";
import { useMemo, useState } from "react";
import {
  sessionRecordByIdAtomFamily,
  sessionRuntimeBySessionIdAtomFamily,
} from "../../atoms";
import { t } from "../../i18n";
import { Button } from "../ui-shadcn/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui-shadcn/dropdown-menu";
import { cn } from "../../lib/utils";

/**
 * 会话 Tab 栏（浏览器式多 Tab）：标题栏下方展示当前打开的所有会话。
 *
 * 生命周期约定（省内存 + 复用 Agent 的最佳实践）：
 * - 点击 Tab = 切换会话（只改 currentSessionId，不启动/停止任何 Agent）；
 * - 关闭 Tab = 仅从列表移除，**不 kill Agent**——后台 Agent 保持运行，
 *   再次打开同一会话时复用已绑定运行时并重新加载最新历史；
 * - 全部 Agent 只在应用整体退出时统一停止（main 进程 before-quit 路径）。
 */
export function SessionTabsBar(props: {
  tabs: readonly string[];
  currentSessionId?: string;
  onSelect: (sessionId: string) => void;
  onClose: (sessionId: string) => void;
  onCloseOthers: (sessionId: string) => void;
  onCloseAll: () => void;
  onNewSession: () => void;
}) {
  const { tabs, currentSessionId } = props;
  const tabItems = useMemo(() => tabs.map((sessionId) => ({ sessionId })), [tabs]);

  return (
    <div className="session-tabs-bar flex h-9 shrink-0 items-center gap-1 overflow-x-auto border-b border-border bg-background/80 px-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {tabItems.map(({ sessionId }) => (
        <SessionTab
          key={sessionId}
          sessionId={sessionId}
          active={sessionId === currentSessionId}
          onSelect={props.onSelect}
          onClose={props.onClose}
          onCloseOthers={props.onCloseOthers}
          onCloseAll={props.onCloseAll}
        />
      ))}
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="session-tabs-new ml-0.5 inline-grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground"
        title={t("tabs.new")}
        aria-label={t("tabs.new")}
        onClick={props.onNewSession}
      >
        <Plus className="size-3.5" />
      </Button>
    </div>
  );
}

function SessionTab(props: {
  sessionId: string;
  active: boolean;
  onSelect: (sessionId: string) => void;
  onClose: (sessionId: string) => void;
  onCloseOthers: (sessionId: string) => void;
  onCloseAll: () => void;
}) {
  const { sessionId, active } = props;
  const record = useAtomValue(sessionRecordByIdAtomFamily(sessionId));
  const runtime = useAtomValue(sessionRuntimeBySessionIdAtomFamily(sessionId));
  const status = runtime?.status;
  // 运行/启动中的 Agent 在 Tab 上显示呼吸状态点，方便跨 Tab 感知后台活动
  const busy = status === "running" || status === "starting";
  const title = record?.title || t("common.untitled");
  // 右键菜单锚点（虚拟触发器模式，与 FileContextMenu 一致）：左键=切换，右键=菜单
  const [menuAnchor, setMenuAnchor] = useState<{ x: number; y: number } | null>(null);

  const select = () => props.onSelect(sessionId);
  const close = () => props.onClose(sessionId);

  return (
    <>
      <div
        role="tab"
        aria-selected={active}
        data-session-id={sessionId}
        title={title}
        className={cn(
          "session-tab group relative flex h-7 shrink-0 cursor-pointer select-none items-center gap-1.5 rounded-md border px-2.5 text-caption transition-colors",
          active
            ? "border-border bg-accent/10 font-medium text-foreground"
            : "border-transparent text-muted-foreground hover:bg-accent/50 hover:text-foreground",
        )}
        onClick={select}
        onAuxClick={(event) => {
          // 中键关闭，与浏览器 Tab 行为一致
          if (event.button === 1) close();
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          setMenuAnchor({ x: event.clientX, y: event.clientY });
        }}
      >
        <span
          className={cn(
            "size-1.5 shrink-0 rounded-full",
            busy
              ? "bg-primary animate-pulse"
              : status === "error"
                ? "bg-destructive"
                : "bg-muted-foreground/40",
          )}
          aria-hidden="true"
        />
        <span className="max-w-40 truncate">{title}</span>
        <button
          type="button"
          role="tab-close"
          aria-label={t("tabs.close")}
          title={t("tabs.close")}
          className={cn(
            "inline-grid size-4 shrink-0 place-items-center rounded-sm text-muted-foreground/70 hover:bg-accent hover:text-foreground",
            active ? "opacity-60 hover:opacity-100" : "opacity-0 group-hover:opacity-60",
          )}
          onClick={(event) => {
            event.stopPropagation();
            close();
          }}
        >
          <X className="size-3" />
        </button>
      </div>
      {menuAnchor && (
        <DropdownMenu open onOpenChange={(open) => { if (!open) setMenuAnchor(null); }}>
          <DropdownMenuTrigger
            aria-hidden
            tabIndex={-1}
            style={{
              position: "fixed",
              left: menuAnchor.x,
              top: menuAnchor.y,
              width: 0,
              height: 0,
              padding: 0,
              border: 0,
              background: "transparent",
              pointerEvents: "none",
            }}
          />
          <DropdownMenuContent align="start" side="bottom" className="min-w-36">
            <DropdownMenuItem onSelect={select}>{t("tabs.switchTo")}</DropdownMenuItem>
            <DropdownMenuItem onSelect={close}>{t("tabs.close")}</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => props.onCloseOthers(sessionId)}>
              {t("tabs.closeOthers")}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={props.onCloseAll}>{t("tabs.closeAll")}</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </>
  );
}
