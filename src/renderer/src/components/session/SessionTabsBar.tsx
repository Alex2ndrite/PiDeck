import { useAtomValue } from "jotai";
import { Pin, PinOff, Plus, X } from "lucide-react";
import { useMemo, useRef, useState } from "react";
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
 *
 * 固定（pin）与排序：
 * - 固定 Tab 前置、宽度更小、无关闭按钮，右键菜单可取消固定；
 * - 拖拽 Tab 可排序，固定/普通区间交叉拖动会自动转换固定状态。
 */

/** 拖拽中的源 Tab id；onDrop 时消费 */
const TAB_DRAG_DATA_KEY = "text/pideck-session-tab";

export function SessionTabsBar(props: {
  tabs: readonly string[];
  pinnedTabs: readonly string[];
  currentSessionId?: string;
  onSelect: (sessionId: string) => void;
  onClose: (sessionId: string) => void;
  onCloseOthers: (sessionId: string) => void;
  onCloseAll: () => void;
  onNewSession: () => void;
  onTogglePin: (sessionId: string) => void;
  onReorder: (sourceId: string, targetId: string, position: "before" | "after") => void;
}) {
  const { tabs, pinnedTabs, currentSessionId } = props;
  const tabItems = useMemo(() => tabs.map((sessionId) => ({ sessionId })), [tabs]);
  const dragSourceRef = useRef<string | null>(null);
  const dragTargetRef = useRef<{ targetId: string; position: "before" | "after" } | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  // 拖拽插入指示：当前悬停的目标 Tab 与插入侧（before=左缘 / after=右缘）
  const [dragIndicator, setDragIndicator] = useState<{ targetId: string; position: "before" | "after" } | null>(null);

  /** onDragOver 期间按鼠标位置相对目标 Tab 中点决定插入前后 */
  const handleDragOver = (event: React.DragEvent, targetId: string) => {
    if (!dragSourceRef.current || dragSourceRef.current === targetId) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    const rect = event.currentTarget.getBoundingClientRect();
    const position = event.clientX < rect.left + rect.width / 2 ? "before" : "after";
    dragTargetRef.current = { targetId, position };
    // 指示线随悬停实时更新；仅位置变化时 setState，避免高频 re-render
    setDragIndicator((current) =>
      current?.targetId === targetId && current.position === position ? current : { targetId, position },
    );
  };

  const handleDrop = (event: React.DragEvent) => {
    event.preventDefault();
    const sourceId = dragSourceRef.current;
    const target = dragTargetRef.current;
    dragSourceRef.current = null;
    dragTargetRef.current = null;
    setDraggingId(null);
    setDragIndicator(null);
    if (sourceId && target) {
      props.onReorder(sourceId, target.targetId, target.position);
    }
  };

  const handleDragEnd = () => {
    dragSourceRef.current = null;
    dragTargetRef.current = null;
    setDraggingId(null);
    setDragIndicator(null);
  };

  return (
    <div className="session-tabs-bar flex h-9 shrink-0 items-center gap-1 overflow-x-auto overflow-y-hidden border-b border-border bg-background/80 px-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {tabItems.map(({ sessionId }) => (
        <SessionTab
          key={sessionId}
          sessionId={sessionId}
          active={sessionId === currentSessionId}
          pinned={pinnedTabs.includes(sessionId)}
          dragging={draggingId === sessionId}
          // 指示线插在目标 Tab 的边缘：before=左缘，after=右缘
          indicator={dragIndicator && dragIndicator.targetId === sessionId ? dragIndicator.position : null}
          onSelect={props.onSelect}
          onClose={props.onClose}
          onCloseOthers={props.onCloseOthers}
          onCloseAll={props.onCloseAll}
          onTogglePin={props.onTogglePin}
          onDragStart={(event) => {
            dragSourceRef.current = sessionId;
            dragTargetRef.current = null;
            setDraggingId(sessionId);
            event.dataTransfer.effectAllowed = "move";
            event.dataTransfer.setData(TAB_DRAG_DATA_KEY, sessionId);
          }}
          onDragOver={(event) => handleDragOver(event, sessionId)}
          onDrop={handleDrop}
          onDragEnd={handleDragEnd}
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
  /** 固定 Tab：前置、窄宽度、无关闭按钮 */
  pinned: boolean;
  dragging: boolean;
  /** 拖拽插入指示：before=左缘竖线，after=右缘竖线 */
  indicator?: "before" | "after" | null;
  onSelect: (sessionId: string) => void;
  onClose: (sessionId: string) => void;
  onCloseOthers: (sessionId: string) => void;
  onCloseAll: () => void;
  onTogglePin: (sessionId: string) => void;
  onDragStart: (event: React.DragEvent) => void;
  onDragOver: (event: React.DragEvent) => void;
  onDrop: (event: React.DragEvent) => void;
  onDragEnd: () => void;
}) {
  const { sessionId, active, pinned, dragging } = props;
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
        draggable
        onDragStart={props.onDragStart}
        onDragOver={props.onDragOver}
        onDrop={props.onDrop}
        onDragEnd={props.onDragEnd}
        className={cn(
          // 固定 Tab 窄宽度（w-20 仅图标+短标题），普通 Tab 固定 w-32
          "session-tab group relative flex h-7 shrink-0 cursor-pointer select-none items-center gap-1.5 rounded-md border px-2 text-caption transition-colors",
          pinned ? "w-20" : "w-32",
          dragging && "opacity-50",
          active
            ? "border-border bg-accent/10 font-medium text-foreground"
            : "border-transparent text-muted-foreground hover:bg-accent/50 hover:text-foreground",
        )}
        onClick={select}
        onAuxClick={(event) => {
          // 中键关闭（固定 Tab 忽略，需先取消固定），与浏览器 Tab 行为一致
          if (event.button === 1 && !pinned) close();
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
        {pinned && <Pin className="size-3 shrink-0 text-muted-foreground/70" aria-hidden="true" />}
        <span className="min-w-0 flex-1 truncate">{title}</span>
        {/* 拖拽插入指示线：2px 主题色竖线，贴在目标 Tab 左/右缘 */}
        {props.indicator && (
          <span
            aria-hidden="true"
            className={cn(
              "pointer-events-none absolute top-1 bottom-1 w-0.5 rounded-full bg-primary",
              props.indicator === "before" ? "-left-0.5" : "-right-0.5",
            )}
          />
        )}
        {!pinned && (
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
        )}
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
            <DropdownMenuItem onSelect={() => props.onTogglePin(sessionId)}>
              <span className="inline-flex items-center gap-2">
                {pinned ? <PinOff className="size-3.5" aria-hidden="true" /> : <Pin className="size-3.5" aria-hidden="true" />}
                {pinned ? t("tabs.unpin") : t("tabs.pin")}
              </span>
            </DropdownMenuItem>
            {!pinned && <DropdownMenuItem onSelect={close}>{t("tabs.close")}</DropdownMenuItem>}
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
