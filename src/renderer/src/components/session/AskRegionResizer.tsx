import { useCallback, useRef, useState, type ReactNode } from "react";
import { GripHorizontal } from "lucide-react";
import { cn } from "../../lib/utils";
import { ASK_DEFAULT_MAX_HEIGHT, ASK_MAX_HEIGHT, ASK_MIN_HEIGHT, ASK_STEP_PX } from "../../rendererUtils";
import { t } from "../../i18n";

/**
 * Ask 区域的垂直 resize 手柄（受控、可访问，不依赖第三方拖拽库）。
 *
 * 背景：Ask 内容挂在 composer 面板内（composer-runtime-ui 附加区），composer 面板
 * 高度可由外层 react-resizable-panels 分隔条拖拽已被保留，但 Ask 内容在面板内部
 * 的高度固定由内容决定（max-h-[55vh]）。本组件在 Ask 区域底部提供一条可见、
 * 可键盘操作/可鼠标拖拽的把手，让用户把 Ask 内容区间独立拉高/收窄，而不用动整个
 * composer 面板，也不会把底部输入框推出面板。
 *
 * 约束：
 * - 高度是「上限」而非定值：Ask 折叠（Collapsible）后内容变矮只显示实际内容，
 *   不强迫留白；展开时可用到该上限，输入框一直在面板内可见。
 * - 支持指针拖动（pointer capture + 容差阈值）与键盘（↑/↓/PageUp/PageDown），
 *   阈值统一写回受控值并夹在 [ASK_MIN_HEIGHT, ASK_MAX_HEIGHT] 内。
 * - 拖拽事件直接绑到带 pointer capture 的 handle：onPointerDown 调用
 *   setPointerCapture 后，后续 pointermove/up/cancel 会全部路由回该 handle
 *   （即使指针越出 handle 边界），因此 JSX 级 onPointerMove/onPointerUp/
 *   onPointerCancel 即可完整工作、随卸载自动清理，无需 window 级监听。
 * - 不参与、不破坏 Ask 自带的折叠/取消/选项/输入交互，它们仍在内容区内。
 */
export function AskRegionResizer(props: { child: ReactNode }) {
  const [maxHeight, setMaxHeight] = useState(ASK_DEFAULT_MAX_HEIGHT);
  // 拖拽中关闭过渡动画，避免跟手卡顿；拖拽结束恢复平滑过渡。
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{ startY: number } | null>(null);

  // 拖拽起点 Y：pointermove 按相对位移增量钳制高度，指针捕获由 handle 自身接管。
  const applyDelta = useCallback((delta: number) => {
    setMaxHeight((current) => {
      // 夹在 min/max 之间并取整；delta 取 Infinity 时主动收敛到端点（Home/End 语义）。
      const next = Math.min(ASK_MAX_HEIGHT, Math.max(ASK_MIN_HEIGHT, current + delta));
      return Number.isFinite(next) ? Math.round(next) : delta > 0 ? ASK_MAX_HEIGHT : ASK_MIN_HEIGHT;
    });
  }, []);

  // 收尾拖拽态：指针抬起/取消（含 capture 被释放/丢失）统一把拖拽标记清掉，恢复平滑过渡。
  const stopDrag = useCallback(() => {
    dragRef.current = null;
    setDragging(false);
  }, []);

  return (
    <div
      className="composer-runtime-ui flex min-h-0 shrink flex-col gap-1"
      style={{
        maxHeight,
        transition: dragging ? "none" : "max-height 120ms ease-out",
      }}
    >
      {/* Ask 内容区独立滚动：面板变小时内容缩在自身区间内滚动，不挤输入框。 */}
      <div className="min-h-0 flex-1 overflow-y-auto">{props.child}</div>
      {/* 垂直拉伸把手：受控区间，端点收窄后仍可直接拖拽恢复，不破坏 Ask 折叠/取消/选项/输入。
          role=separator 的 aria-orientation=horizontal 表示这是一条水平分隔线，切分上/下内容，
          交互为上下拖动调整高度；min/max/current 用 aria-valuenow 暴露受控高度。 */}
      <div
        role="separator"
        aria-orientation="horizontal"
        aria-label={t("app.askResizeLabel")}
        aria-valuemin={ASK_MIN_HEIGHT}
        aria-valuemax={ASK_MAX_HEIGHT}
        aria-valuenow={maxHeight}
        aria-valuetext={`${maxHeight}px`}
        tabIndex={0}
        data-dragging={dragging || undefined}
        className={cn(
          "ask-resize-handle group/handle flex h-2.5 shrink-0 cursor-ns-resize touch-none items-center justify-center rounded-sm text-muted-foreground/60 outline-none",
          "hover:bg-accent/60 focus-visible:bg-accent/60 focus-visible:text-accent-foreground",
          dragging && "bg-accent/70 text-accent-foreground",
        )}
        onPointerDown={(event) => {
          // 只响应主键；按下即记录起点并捕获指针，后续 move/up/cancel 都回到本 handle。
          if (event.button !== 0) return;
          dragRef.current = { startY: event.clientY };
          setDragging(true);
          // pointer capture 让 out-of-bounds 拖动仍连续生效，且 capture 在 up/cancel 自动释放。
          event.currentTarget.setPointerCapture?.(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (!dragging) return;
          const drag = dragRef.current;
          if (!drag) return;
          // 向上的位移对应拉高（约束在上限），向下的位移收敛（下限），始终夹在 min/max 内。
          applyDelta(drag.startY - event.clientY);
        }}
        onPointerUp={stopDrag}
        onPointerCancel={stopDrag}
        onKeyDown={(event) => {
          switch (event.key) {
            case "ArrowUp":
              event.preventDefault();
              applyDelta(ASK_STEP_PX);
              break;
            case "ArrowDown":
              event.preventDefault();
              applyDelta(-ASK_STEP_PX);
              break;
            case "PageUp":
              event.preventDefault();
              applyDelta(ASK_STEP_PX * 4);
              break;
            case "PageDown":
              event.preventDefault();
              applyDelta(-ASK_STEP_PX * 4);
              break;
            case "Home":
              event.preventDefault();
              applyDelta(Number.NEGATIVE_INFINITY);
              break;
            case "End":
              event.preventDefault();
              applyDelta(Number.POSITIVE_INFINITY);
              break;
            default:
              break;
          }
        }}
      >
        <GripHorizontal size={14} aria-hidden="true" />
      </div>
    </div>
  );
}
