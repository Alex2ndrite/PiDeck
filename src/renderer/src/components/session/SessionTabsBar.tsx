import { useAtomValue } from "jotai";
import {
  ChevronDown,
  CircleStop,
  CircleX,
  MousePointerClick,
  PanelRight,
  Pin,
  PinOff,
  RotateCw,
  SquareX,
  X,
} from "lucide-react";
import { useCallback, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  sessionRecordByIdAtomFamily,
  sessionRuntimeBySessionIdAtomFamily,
} from "../../atoms";
import { sessionStatusDotClass } from "../../agentListDisplay";
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
 * 交互约定：
 * - 点击 Tab 本体 = 切换会话（保持浏览器式直觉）；
 * - Tab 内的下拉按钮（或右键）打开操作菜单：切换到该会话（当前 Tab 禁用）、
 *   固定/停止（关闭会话）/重启/关闭/关闭其他/关闭全部；
 *   ——停止/重启入口原在右侧“会话操作”下拉，现已收进这里，右侧只留状态徽章。
 * - 关闭 Tab = 仅从列表移除，**不 kill Agent**——后台 Agent 保持运行，
 *   再次打开同一会话时复用已绑定运行时并重新加载最新历史；
 * - 全部 Agent 只在应用整体退出时统一停止（main 进程 before-quit 路径）。
 *
 * 固定（pin）与排序：
 * - 固定 Tab 前置、宽度更小、无关闭按钮，菜单可取消固定；
 * - 拖拽 Tab 可排序，固定/普通区间交叉拖动会自动转换固定状态。
 */

/** 拖拽中的源 Tab id；onDrop 时消费 */
const TAB_DRAG_DATA_KEY = "text/pideck-session-tab";

export type SessionTabsBarProps = {
  tabs: readonly string[];
  pinnedTabs: readonly string[];
  currentSessionId?: string;
  onSelect: (sessionId: string) => void;
  onClose: (sessionId: string) => void;
  onCloseOthers: (sessionId: string) => void;
  onCloseAll: () => void;
  onTogglePin: (sessionId: string) => void;
  onReorder: (sourceId: string, targetId: string, position: "before" | "after") => void;
  /** 无当前会话时仍显示右侧抽屉入口。 */
  onToggleDrawer?: () => void;
  drawerOpen?: boolean;
  /** 当前会话的状态/操作区；嵌入 Tab 栏后不再单独占用标题行。 */
  actions?: ReactNode;
  /** 当前会话的停止（关闭会话）能力（SessionView 按运行状态装配）：只对当前会话 Tab 生效。 */
  canStopCurrent?: boolean;
  onStopCurrent?: () => void;
  /** 当前会话的重启能力（SessionView 按运行状态装配）：只对当前会话 Tab 生效。 */
  canRestartCurrent?: boolean;
  isRestartingCurrent?: boolean;
  onRestartCurrent?: () => void;
};

export function SessionTabsBar(props: SessionTabsBarProps) {
  const { tabs, pinnedTabs, currentSessionId } = props;
  const tabItems = useMemo(() => tabs.map((sessionId) => ({ sessionId })), [tabs]);
  const dragSourceRef = useRef<string | null>(null);
  const dragTargetRef = useRef<{ targetId: string; position: "before" | "after" } | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  // 拖拽插入指示：当前悬停的目标 Tab 与插入侧（before=左缘 / after=右缘）
  const [dragIndicator, setDragIndicator] = useState<{ targetId: string; position: "before" | "after" } | null>(null);

  // —— 激活指示条（FLIP 风格滑动）——
  // 浏览器式 Tab 切换时，激活下划线从旧 Tab 滑到新 Tab：
  // 只测位置/宽度后用 transform 过渡（translateX + scaleX 模拟任意宽度，
  // 合成器属性，不触发布局；scaleX 拉伸 2px 高的圆角线视觉无感）。
  // 指示条是滚动容器的子元素，随内容横向滚动天然跟随，无需额外同步。
  const scrollRef = useRef<HTMLDivElement>(null);
  const [indicator, setIndicator] = useState<{ x: number; w: number } | null>(null);
  // 首次定位时不带 transition（瞬间就位），之后更新才有滑动过渡
  const hadPositionRef = useRef(false);
  // 固定宽度基准，scaleX = w/INDICATOR_BASE_WIDTH；需覆盖 max-w-32(128px)+padding 的最大 Tab 宽
  const INDICATOR_BASE_WIDTH = 200;

  const measureIndicator = useCallback(() => {
    const container = scrollRef.current;
    if (!container || !currentSessionId) {
      setIndicator(null);
      return;
    }
    const el = container.querySelector<HTMLElement>(`[data-session-id="${CSS.escape(currentSessionId)}"]`);
    if (!el) {
      setIndicator(null);
      return;
    }
    // 内容坐标系：视觉 x = 容器内偏移 + 已滚动距离（scrollLeft），
    // 指示条 absolute 定位在滚动容器内，滚动时跟随内容。
    const cRect = container.getBoundingClientRect();
    const rect = el.getBoundingClientRect();
    const x = rect.left - cRect.left + container.scrollLeft;
    const w = rect.width;
    setIndicator((prev) => (prev && prev.x === x && prev.w === w ? prev : { x, w }));
  }, [currentSessionId]);

  // Tab 列表/激活/固定变化时重测（固定与普通 Tab 宽度不同，pin 切换会改布局）
  useLayoutEffect(() => {
    measureIndicator();
    if (indicator !== null) hadPositionRef.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [measureIndicator, tabs, pinnedTabs]);

  // 标题长度变化等引起 Tab 宽度变化时，ResizeObserver 兜底重测（防抖：值不变不 set）
  useLayoutEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    const ro = new ResizeObserver(() => measureIndicator());
    ro.observe(container);
    return () => ro.disconnect();
  }, [measureIndicator]);

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

  // overflow-visible：历史遗留约定（曾容纳非 portal 的 combo 下拉）；Tab 下拉经
  // Radix Portal 渲染不受裁剪，保留该值以防其他兄弟节点依赖。
  return (
    <div className="session-tabs-bar flex h-9 shrink-0 items-center gap-1 overflow-visible border-b border-border/40 bg-background/80 px-2">
      <div
        ref={scrollRef}
        className="session-tabs-scroll relative flex min-w-0 flex-1 items-center gap-1 overflow-x-auto overflow-y-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {tabItems.map(({ sessionId }) => (
        <SessionTab
          key={sessionId}
          sessionId={sessionId}
          active={sessionId === currentSessionId}
          pinned={pinnedTabs.includes(sessionId)}
          dragging={draggingId === sessionId}
          // 指示线插在目标 Tab 的边缘：before=左缘，after=右缘
          indicator={dragIndicator && dragIndicator.targetId === sessionId ? dragIndicator.position : null}
          // 停止/重启只对当前会话有意义（作用于其绑定的 Agent 运行时），非当前 Tab 不显示
          canStop={sessionId === currentSessionId ? props.canStopCurrent : undefined}
          onStop={sessionId === currentSessionId ? props.onStopCurrent : undefined}
          canRestart={sessionId === currentSessionId ? props.canRestartCurrent : undefined}
          isRestarting={sessionId === currentSessionId ? props.isRestartingCurrent : undefined}
          onRestart={sessionId === currentSessionId ? props.onRestartCurrent : undefined}
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
        {/* 激活指示条：贴在激活 Tab 底部，切换会话时滑动（见上方 measureIndicator 说明） */}
        {indicator && currentSessionId && (
          <span
            aria-hidden="true"
            className={cn(
              "session-tabs-indicator pointer-events-none absolute bottom-[3px] left-0 h-0.5 rounded-full bg-primary",
              hadPositionRef.current
                ? "transition-transform duration-base ease-out-quint"
                : "transition-none",
            )}
            style={{
              width: INDICATOR_BASE_WIDTH,
              // scaleX 以元素中心为锚点，需用 translateX 补偿：左缘 = tx - (W-w)/2
              transform: `translateX(${indicator.x - (INDICATOR_BASE_WIDTH - indicator.w) / 2}px) scaleX(${indicator.w / INDICATOR_BASE_WIDTH})`,
            }}
          />
        )}
      </div>
      {/* null 表示当前会话由下方 SessionHeader 承载操作；undefined 才保留无会话空态的快捷入口。 */}
      {props.actions !== null && (
        <div className="session-tabs-actions flex shrink-0 items-center gap-1 border-l border-border/30 pl-1">
          {props.actions ?? (
            <>
              {props.onToggleDrawer && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className={`header-drawer-toggle size-7${props.drawerOpen ? " active" : ""}`}
                  title={props.drawerOpen ? t("app.collapseDrawer") : t("app.expandDrawer")}
                  aria-label={props.drawerOpen ? t("app.collapseDrawer") : t("app.expandDrawer")}
                  onClick={props.onToggleDrawer}
                >
                  <PanelRight className="size-3.5" aria-hidden="true" />
                </Button>
              )}
            </>
          )}
        </div>
      )}
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
  /** 停止（关闭会话）入口（仅当前会话 Tab 传入）：canStop=false 时禁用 */
  canStop?: boolean;
  onStop?: () => void;
  /** 重启入口（仅当前会话 Tab 传入）：canRestart=false 时禁用，isRestarting 时显示“重启中…” */
  canRestart?: boolean;
  isRestarting?: boolean;
  onRestart?: () => void;
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
  // 状态点颜色语义与侧栏 SessionTree 一致（idle=蓝、running/starting=黄、error=红）；
  // 未启动（无 runtime）不显示色点，避免把“未运行”误读成某种状态。
  const dotClass = sessionStatusDotClass(status);
  const title = record?.title || t("common.untitled");
  // 操作菜单（受控）：下拉按钮点击或右键 Tab 打开；Tab 本体点击仍是切换，
  // 拖拽排序与中键关闭与菜单互不干扰（drag/auxclick 不触发 click）。
  const [menuOpen, setMenuOpen] = useState(false);

  const select = () => props.onSelect(sessionId);
  const close = () => props.onClose(sessionId);

  return (
    <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
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
        onClick={select}
        className={cn(
          "session-tab group relative flex h-7 shrink-0 cursor-pointer select-none items-center gap-1.5 rounded-md border px-2 text-caption transition-colors",
          // 短标题按内容收缩，长标题限制在 128px 内；关闭按钮仍保留固定空间，避免 tab 在 hover 时跳动。
          pinned ? "w-20" : "w-fit max-w-32",
          dragging && "opacity-50",
          active
            ? "border-border bg-accent/10 font-medium text-foreground"
            : "border-transparent text-muted-foreground hover:bg-accent/50 hover:text-foreground",
        )}
        onAuxClick={(event) => {
          // 中键关闭（固定 Tab 忽略，需先取消固定），与浏览器 Tab 行为一致
          if (event.button === 1 && !pinned) close();
        }}
        onContextMenu={(event) => {
          // 右键打开操作菜单（与下拉按钮一致），不再需要独立右键菜单
          event.preventDefault();
          setMenuOpen(true);
        }}
      >
        {dotClass && (
          <span
            className={cn(
              "size-1.5 shrink-0 rounded-full",
              dotClass,
              status === "error" ? "" : "animate-pulse",
            )}
            aria-hidden="true"
          />
        )}
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
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            role="tab-menu"
            aria-label={t("tabs.moreActions")}
            title={t("tabs.moreActions")}
            className={cn(
              "inline-grid size-4 shrink-0 place-items-center rounded-sm text-muted-foreground/70 hover:bg-accent hover:text-foreground",
              // 与关闭按钮同规则：非激活 Tab 悬停才显示；菜单打开时保持可见
              active || menuOpen ? "opacity-60 hover:opacity-100" : "opacity-0 group-hover:opacity-60",
            )}
            onClick={(event) => {
              // 下拉按钮只打开菜单、不触发 Tab 切换：阻断冒泡（Radix 的 toggle 在同一元素上仍会执行）
              event.stopPropagation();
            }}
          >
            <ChevronDown className="size-3" aria-hidden="true" />
          </button>
        </DropdownMenuTrigger>
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
              // 关闭按钮不打开菜单也不切换：stopPropagation 阻断冒泡
              event.stopPropagation();
              close();
            }}
          >
            <X className="size-3" />
          </button>
        )}
      </div>
      <DropdownMenuContent align="start" side="bottom" className="min-w-40">
        <DropdownMenuItem disabled={active} onSelect={select}>
          <span className="inline-flex items-center gap-2">
            <MousePointerClick className="size-3.5" aria-hidden="true" />
            {t("tabs.switchTo")}
          </span>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => props.onTogglePin(sessionId)}>
          <span className="inline-flex items-center gap-2">
            {pinned ? <PinOff className="size-3.5" aria-hidden="true" /> : <Pin className="size-3.5" aria-hidden="true" />}
            {pinned ? t("tabs.unpin") : t("tabs.pin")}
          </span>
        </DropdownMenuItem>
        {active && props.onStop && (
          <DropdownMenuItem disabled={!props.canStop} onSelect={props.onStop}>
            <span className="inline-flex items-center gap-2">
              <CircleStop className="size-3.5" aria-hidden="true" />
              {t("tabs.closeSession")}
            </span>
          </DropdownMenuItem>
        )}
        {active && props.onRestart && (
          <DropdownMenuItem
            disabled={!props.canRestart}
            onSelect={props.onRestart}
          >
            <span className="inline-flex items-center gap-2">
              <RotateCw className={cn("size-3.5", props.isRestarting && "animate-spin")} aria-hidden="true" />
              {props.isRestarting ? t("app.restarting") : t("app.restart")}
            </span>
          </DropdownMenuItem>
        )}
        {!pinned && (
          <DropdownMenuItem onSelect={close}>
            <span className="inline-flex items-center gap-2">
              <X className="size-3.5" aria-hidden="true" />
              {t("tabs.close")}
            </span>
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => props.onCloseOthers(sessionId)}>
          <span className="inline-flex items-center gap-2">
            <CircleX className="size-3.5" aria-hidden="true" />
            {t("tabs.closeOthers")}
          </span>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={props.onCloseAll}>
          <span className="inline-flex items-center gap-2">
            <SquareX className="size-3.5" aria-hidden="true" />
            {t("tabs.closeAll")}
          </span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
