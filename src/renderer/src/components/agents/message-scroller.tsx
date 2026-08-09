"use client";
// 基于 beui.dev/components/agents/message-scroller
// 滚动引擎替换为 use-stick-to-bottom（MIT，StackBlitz，src/lib/stick-to-bottom 本地移植）

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
import {
  PreviewRail,
  type PreviewRailItem,
} from "@/components/motion/preview-rail";
import { cn } from "@/lib/utils";
import {
  useStickToBottom,
  type ScrollToBottom,
} from "@/lib/stick-to-bottom";

const PREVIEW_TITLE_LENGTH = 56;
const PREVIEW_DESCRIPTION_LENGTH = 88;

/** 供时间线 controller 调用的引擎滚动 API（回底弹簧 / 原子恢复位置）。 */
export type MessageScrollerScrollApi = {
  scrollToBottom: ScrollToBottom;
  /** 原子恢复历史位置：定位 + 解锁锁底 + 取消在途动画（见引擎 restoreAt）。 */
  restoreAt: (scrollTop: number) => void;
};

function truncateMessageText(text: string, limit: number) {
  if (text.length <= limit) return text;
  const excerpt = text.slice(0, limit);
  const boundary = excerpt.lastIndexOf(" ");
  return `${excerpt.slice(0, boundary > limit * 0.65 ? boundary : limit).trim()}…`;
}

function getMessageText(message: HTMLElement) {
  const surface =
    message.querySelector<HTMLElement>('[data-slot="message-bubble-content"]') ??
    message.querySelector<HTMLElement>('[data-slot="message-content"]') ??
    message;
  return (surface.textContent ?? "").replace(/\s+/g, " ").trim();
}

function getMessagePreview(
  message: HTMLElement,
  assistantResponse?: HTMLElement,
) {
  const text = getMessageText(message);
  if (!text) {
    return { label: "Message", description: undefined };
  }

  if (text.length <= PREVIEW_TITLE_LENGTH) {
    const responseText = assistantResponse
      ? getMessageText(assistantResponse)
      : "";
    return {
      label: text,
      description: responseText
        ? truncateMessageText(responseText, PREVIEW_DESCRIPTION_LENGTH)
        : undefined,
    };
  }

  const titleExcerpt = text.slice(0, PREVIEW_TITLE_LENGTH);
  const titleBoundary = titleExcerpt.lastIndexOf(" ");
  const titleEnd =
    titleBoundary > PREVIEW_TITLE_LENGTH * 0.65
      ? titleBoundary
      : PREVIEW_TITLE_LENGTH;
  const label = `${text.slice(0, titleEnd).trim()}…`;
  const responseText = assistantResponse
    ? getMessageText(assistantResponse)
    : text.slice(titleEnd).trim();
  return {
    label,
    description: responseText
      ? truncateMessageText(responseText, PREVIEW_DESCRIPTION_LENGTH)
      : undefined,
  };
}

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
  /** Adds a compact rail for navigating between rendered Message rows. */
  navigation?: "rail";
  /** Accessible label for the optional message navigation rail. */
  navigationLabel?: string;
  viewportClassName?: string;
  contentClassName?: string;
  railClassName?: string;
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
  navigation,
  navigationLabel = "Message navigation",
  viewportClassName,
  contentClassName,
  railClassName,
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
  const railFrameRef = useRef<number | undefined>(undefined);
  const railIdRef = useRef(new WeakMap<HTMLElement, string>());
  const railIdCounterRef = useRef(0);
  const railTargetsRef = useRef(new Map<string, HTMLElement>());
  const [railItems, setRailItems] = useState<PreviewRailItem[]>([]);
  const [activeRailId, setActiveRailId] = useState("");
  const [railOverflowing, setRailOverflowing] = useState(false);
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

  const updateActiveRailItem = useCallback(() => {
    if (navigation !== "rail") return;
    const viewport = viewportRef.current;
    const targets = [...railTargetsRef.current.entries()];
    if (!viewport || targets.length === 0) return;

    const viewportRect = viewport.getBoundingClientRect();
    if (viewport.scrollTop <= followThreshold) {
      const firstId = targets[0]?.[0] ?? "";
      setActiveRailId((current) => (current === firstId ? current : firstId));
      return;
    }

    const distanceFromEnd =
      viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
    if (distanceFromEnd <= followThreshold) {
      const lastId = targets.at(-1)?.[0] ?? "";
      setActiveRailId((current) => (current === lastId ? current : lastId));
      return;
    }

    const viewportCenter = viewportRect.top + viewportRect.height / 2;
    let nearestId = targets[0]?.[0] ?? "";
    let nearestDistance = Number.POSITIVE_INFINITY;

    for (const [id, element] of targets) {
      const rect = element.getBoundingClientRect();
      const messageCenter = rect.top + rect.height / 2;
      const distance = Math.abs(messageCenter - viewportCenter);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestId = id;
      }
    }

    setActiveRailId((current) =>
      current === nearestId ? current : nearestId,
    );
  }, [followThreshold, navigation]);

  const syncRailItems = useCallback(() => {
    if (navigation !== "rail") return;
    const content = contentRef.current;
    const viewport = viewportRef.current;
    if (!content || !viewport) return;

    const messages = Array.from(
      content.querySelectorAll<HTMLElement>('[data-slot="message"]'),
    );
    const targets = new Map<string, HTMLElement>();
    const nextItems = messages.map((message, index) => {
      let id = railIdRef.current.get(message);
      if (!id) {
        railIdCounterRef.current += 1;
        id = `message-rail-${railIdCounterRef.current}`;
        railIdRef.current.set(message, id);
      }
      targets.set(id, message);
      const sender = message.dataset.from ?? "conversation";
      const assistantResponse =
        sender === "user"
          ? messages
              .slice(index + 1)
              .find((candidate) => candidate.dataset.from === "assistant")
          : undefined;
      const preview = getMessagePreview(message, assistantResponse);

      return {
        id,
        label: preview.label,
        description: preview.description,
        ariaLabel: `Go to ${sender} message ${index + 1} of ${messages.length}`,
      };
    });

    railTargetsRef.current = targets;
    setRailItems((current) => {
      const unchanged =
        current.length === nextItems.length &&
        current.every(
          (item, index) =>
            item.id === nextItems[index]?.id &&
            item.label === nextItems[index]?.label &&
            item.description === nextItems[index]?.description &&
            item.ariaLabel === nextItems[index]?.ariaLabel,
        );
      return unchanged ? current : nextItems;
    });
    setRailOverflowing(
      viewport.scrollHeight > viewport.clientHeight + 1 && messages.length > 1,
    );
  }, [navigation]);

  const scheduleRailSync = useCallback(() => {
    if (navigation !== "rail") return;
    if (railFrameRef.current) cancelAnimationFrame(railFrameRef.current);
    railFrameRef.current = requestAnimationFrame(() => {
      syncRailItems();
      updateActiveRailItem();
    });
  }, [navigation, syncRailItems, updateActiveRailItem]);

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

  useEffect(() => {
    if (navigation !== "rail") {
      railTargetsRef.current.clear();
      setRailItems([]);
      setRailOverflowing(false);
      return;
    }

    const content = contentRef.current;
    const viewport = viewportRef.current;
    if (!content || !viewport) return;

    scheduleRailSync();
    const mutationObserver =
      typeof MutationObserver === "undefined"
        ? null
        : new MutationObserver(scheduleRailSync);
    mutationObserver?.observe(content, {
      childList: true,
      characterData: true,
      subtree: true,
    });

    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(scheduleRailSync);
    resizeObserver?.observe(content);
    resizeObserver?.observe(viewport);

    return () => {
      mutationObserver?.disconnect();
      resizeObserver?.disconnect();
    };
  }, [navigation, scheduleRailSync]);

  useEffect(
    () => () => {
      if (busyEndingTimerRef.current) window.clearTimeout(busyEndingTimerRef.current);
      if (railFrameRef.current) cancelAnimationFrame(railFrameRef.current);
    },
    [],
  );

  const scrollToRailItem = useCallback(
    (item: PreviewRailItem) => {
      const viewport = viewportRef.current;
      const target = railTargetsRef.current.get(item.id);
      if (!viewport || !target) return;

      const lastItem = railItems.at(-1)?.id === item.id;
      setActiveRailId(item.id);
      if (lastItem) {
        // 最后一条：交给引擎锁底（弹簧物理跟随），与旧 scrollToEnd 语义一致
        engineScrollToBottom({
          animation: reduce || !smooth ? "instant" : "smooth",
        });
        return;
      }

      // 非最后一条：直接定位到该消息（禁止引擎逃逸/锁底干扰）
      const viewportRect = viewport.getBoundingClientRect();
      const targetRect = target.getBoundingClientRect();
      const top =
        viewport.scrollTop +
        targetRect.top -
        viewportRect.top -
        (viewport.clientHeight - targetRect.height) / 2;
      const behavior = reduce || !smooth ? "auto" : "smooth";

      if (typeof viewport.scrollTo === "function") {
        viewport.scrollTo({ top, behavior });
      } else {
        viewport.scrollTop = top;
      }
    },
    [railItems, reduce, smooth, engineScrollToBottom],
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
        "h-full overflow-y-auto overscroll-contain outline-none [overflow-anchor:none] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
        navigation === "rail"
          ? "[-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          : "[scrollbar-gutter:stable]",
        viewportClassName,
        navigation === "rail" && railOverflowing && "pr-10",
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
      {navigation === "rail" ? (
        <PreviewRail
          items={railOverflowing ? railItems : []}
          label={navigationLabel}
          activeId={activeRailId}
          onItemSelect={scrollToRailItem}
          previewSide="before"
          highlightActive
          itemSize={14}
          className="h-full min-h-0 overflow-hidden"
          previewContainerClassName="right-8 left-3"
          previewClassName="mr-1 w-64 max-w-full [&_[data-slot=preview-rail-card]]:h-20 [&_[data-slot=preview-rail-card]]:overflow-hidden [&_[data-slot=preview-rail-card]]:p-3 [&_[data-slot=preview-rail-title]]:line-clamp-1 [&_[data-slot=preview-rail-title]]:text-xs [&_[data-slot=preview-rail-title]]:leading-4 [&_[data-slot=preview-rail-description]]:line-clamp-2 [&_[data-slot=preview-rail-description]]:text-xs [&_[data-slot=preview-rail-description]]:leading-4"
          railClassName={cn(
            "absolute inset-y-3 right-1 w-7 content-center py-1 [&_[data-slot=preview-rail-item]]:w-7 [&_[data-slot=preview-rail-item]]:justify-end [&_[data-slot=preview-rail-tick]]:h-px [&_[data-slot=preview-rail-tick]]:w-4 [&_[data-slot=preview-rail-tick]]:origin-right",
            railOverflowing
              ? "pointer-events-auto opacity-100"
              : "pointer-events-none opacity-0",
            railClassName,
          )}
        >
          {viewport}
        </PreviewRail>
      ) : (
        viewport
      )}
    </div>
  );
}
