"use client";
// 基于 beui.dev/components/agents/message-scroller
// 滚动引擎替换为 use-stick-to-bottom（MIT，StackBlitz，src/lib/stick-to-bottom 本地移植）
// 注：beUI 原版的右侧消息导航 rail（PreviewRail）已移除——本项目从未挂载过
// navigation="rail"，属死代码；如未来需要导航轴，用 `npx shadcn add @beui/...` 重装。

import { useReducedMotion } from "motion/react";
import {
  type ComponentPropsWithRef,
  type Ref,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { cn } from "@/lib/utils";
import {
  useStickToBottom,
  type ScrollToBottom,
} from "@/lib/stick-to-bottom";

/** 供时间线 controller 调用的引擎滚动 API（回底弹簧 / 原子恢复位置）。 */
export type MessageScrollerScrollApi = {
  scrollToBottom: ScrollToBottom;
  /** 原子恢复历史位置：定位 + 解锁锁底 + 取消在途动画（见引擎 restoreAt）。 */
  restoreAt: (scrollTop: number) => void;
};

export interface MessageScrollerProps extends ComponentPropsWithRef<"div"> {
  /** Keep streamed output pinned while the reader remains near the end. */
  followOutput?: boolean;
  /** Distance from the end that still counts as following the output. */
  followThreshold?: number;
  /** Smoothly follow growing content. */
  smooth?: boolean;
  /** Reports when the reader leaves or returns to the live edge. */
  onFollowChange?: (following: boolean) => void;
  /** Accessible label for the scrollable transcript. */
  label?: string;
  /** Marks the transcript as waiting for more streamed content. */
  busy?: boolean;
  viewportClassName?: string;
  contentClassName?: string;
  viewportRef?: Ref<HTMLElement>;
  /**
   * 向时间线 controller 暴露 stick-to-bottom 引擎 API。
   * 回底按钮应走弹簧 smooth，而不是原生 timeline.scrollTo。
   */
  scrollApiRef?: Ref<MessageScrollerScrollApi | null>;
  viewportProps?: Omit<
    ComponentPropsWithRef<"section">,
    "children" | "className" | "ref"
  >;
  contentProps?: Omit<
    ComponentPropsWithRef<"div">,
    "children" | "className" | "ref"
  >;
}

export function MessageScroller({
  followOutput = true,
  followThreshold = 56,
  smooth = true,
  onFollowChange,
  label = "Conversation",
  busy,
  viewportClassName,
  contentClassName,
  viewportRef: externalViewportRef,
  scrollApiRef,
  viewportProps,
  contentProps,
  className,
  children,
  ...props
}: MessageScrollerProps) {
  const reduce = useReducedMotion() ?? false;
  const viewportRef = useRef<HTMLElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  // 流式结束过渡（needsInstant）：busy（等待流式输出）true→false 后的窗口期内，
  // 内容增长追底用 instant 而非 smooth，避免最终文本长高触发平滑滚动动画造成跳屏。
  // 注意：busyEnding 必须是 state（不能用 ref）——useStickToBottom 每次渲染读 options，
  // ref 变化不触发渲染，resize 不会随过渡窗口切换。
  const [busyEnding, setBusyEnding] = useState(false);
  const busyEndingTimerRef = useRef<number | undefined>(undefined);
  const {
    onScroll: onViewportScroll,
    onWheel: onViewportWheel,
    onTouchStart: onViewportTouchStart,
    onKeyDown: onViewportKeyDown,
    ...restViewportProps
  } = viewportProps ?? {};

  // ── 滚动引擎：use-stick-to-bottom（弹簧物理 + 锁底/逃逸 + 350ms 保留期）──
  // smooth=false 或 reduced-motion 时 resize 用 instant（与旧手写逻辑等价）。
  // busy / busyEnding 窗口内也强制 instant：工具卡与流式结构跳变期间避免弹簧滞后砰抖。
  // 另：引擎对单次增高 >28px 也会强制 instant（见 instantResizeThreshold）。
  const stick = useStickToBottom({
    initial: "instant",
    resize: busy || busyEnding || reduce || !smooth ? "instant" : "smooth",
    instantResizeThreshold: 28,
  });
  // 解构出稳定引用：stick 每次渲染是新对象，effect 依赖不能直接用它。
  const engineScrollRef = stick.scrollRef;
  const engineContentRef = stick.contentRef;
  const engineScrollToBottom = stick.scrollToBottom;
  const engineIsAtBottom = stick.isAtBottom;
  const engineRestoreAt = stick.restoreAt;

  // 把引擎能力挂到外部 ref，供 SessionTimelineController 的回底按钮/历史位置恢复使用。
  useEffect(() => {
    if (!scrollApiRef) return;
    const api: MessageScrollerScrollApi = {
      scrollToBottom: engineScrollToBottom,
      restoreAt: engineRestoreAt,
    };
    if (typeof scrollApiRef === "function") {
      scrollApiRef(api);
      return () => {
        scrollApiRef(null);
      };
    }
    scrollApiRef.current = api;
    return () => {
      scrollApiRef.current = null;
    };
  }, [scrollApiRef, engineScrollToBottom, engineRestoreAt]);

  const setViewportRef = useCallback(
    (node: HTMLElement | null) => {
      viewportRef.current = node;
      // 桥接给 stick-to-bottom 引擎（内部会挂 scroll/wheel 监听并同步 scrollRef.current）
      engineScrollRef(node);
      if (typeof externalViewportRef === "function") {
        externalViewportRef(node);
      } else if (externalViewportRef) {
        externalViewportRef.current = node;
      }
    },
    [engineScrollRef, externalViewportRef],
  );

  const setContentRef = useCallback(
    (node: HTMLDivElement | null) => {
      contentRef.current = node;
      engineContentRef(node);
    },
    [engineContentRef],
  );

  // ── followOutput / onFollowChange 桥接 ──
  // engineIsAtBottom 即「用户仍在实时尾部」；跟随开关（followOutput）变化时
  // 重新锁底或逃逸，向上兼容旧的 onFollowChange 语义。
  const isFollowing = engineIsAtBottom;

  useLayoutEffect(() => {
    if (!followOutput) return;
    // 回底按钮会先 setAutoScroll(true) 再发起弹簧；若这里无条件 instant，
    // layout 阶段会抢跑把弹簧掐死，观感变成「唰」一下。
    // 距底较远用弹簧滞空；已在近底则 instant 即可。
    const scroll = viewportRef.current;
    const distance = scroll
      ? scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight
      : 0;
    const animation =
      reduce || distance <= followThreshold ? "instant" : "smooth";
    engineScrollToBottom({ animation });
  }, [followOutput, followThreshold, reduce, engineScrollToBottom]);

  useEffect(() => {
    onFollowChange?.(isFollowing);
  }, [isFollowing, onFollowChange]);

  // 流式结束瞬间：busy true→false，开启 150ms 过渡窗口（期间追底用 instant）。
  useEffect(() => {
    if (busy) return;
    if (busyEndingTimerRef.current) window.clearTimeout(busyEndingTimerRef.current);
    setBusyEnding(true);
    busyEndingTimerRef.current = window.setTimeout(() => {
      setBusyEnding(false);
    }, 150);
    return () => {
      if (busyEndingTimerRef.current) window.clearTimeout(busyEndingTimerRef.current);
    };
  }, [busy]);

  useEffect(
    () => () => {
      if (busyEndingTimerRef.current) window.clearTimeout(busyEndingTimerRef.current);
    },
    [],
  );

  const viewport = (
    <section
      ref={setViewportRef}
      aria-label={label}
      {...restViewportProps}
      onScroll={(event) => {
        onViewportScroll?.(event);
      }}
      onWheel={(event) => {
        onViewportWheel?.(event);
      }}
      onTouchStart={(event) => {
        onViewportTouchStart?.(event);
      }}
      onKeyDown={(event) => {
        onViewportKeyDown?.(event);
      }}
      className={cn(
        "h-full overflow-y-auto overscroll-contain outline-none [overflow-anchor:none] [scrollbar-gutter:stable] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
        viewportClassName,
      )}
    >
      <div
        ref={setContentRef}
        role="log"
        aria-live="polite"
        aria-relevant="additions text"
        aria-busy={busy}
        className={contentClassName}
        {...contentProps}
      >
        {children}
      </div>
    </section>
  );

  return (
    <div
      data-slot="message-scroller"
      className={cn("min-h-0", className)}
      {...props}
    >
      {viewport}
    </div>
  );
}
