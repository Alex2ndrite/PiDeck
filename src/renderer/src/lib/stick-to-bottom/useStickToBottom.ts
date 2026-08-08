/*!---------------------------------------------------------------------------------------------
 *  Copyright (c) StackBlitz. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * use-stick-to-bottom（MIT，StackBlitz）移植版。
 *
 * 依赖：仅 React（无其他运行时依赖），与官方包逻辑一致，补全 TypeScript 类型。
 * 用于 AI 聊天场景"锁底跟随 + 弹簧物理 + 逃逸/锁底"的滚动引擎。
 *
 * 本地相对上游的关键改动：
 * 1. mergeAnimations 缓存 key 含 instant（上游同参污染导致 smooth/instant 串味）
 * 2. ResizeObserver 正增长且行为为 instant 时同步写 scrollTop（避免 rAF 晚一帧 paint 砰抖）
 * 3. scrollGeneration 打断在途 rAF，避免与同步校正打架
 * 4. instantResizeThreshold：大块离散增高强制 instant
 */
import { useCallback, useMemo, useRef, useState } from "react";
import {
  type Animation,
  type SpringAnimation,
  mergeAnimations,
} from "./mergeAnimations";

export type { Animation, SpringAnimation } from "./mergeAnimations";

const STICK_TO_BOTTOM_OFFSET_PX = 70;
const SIXTY_FPS_INTERVAL_MS = 1000 / 60;
const RETAIN_ANIMATION_DURATION_MS = 350;

export interface ScrollElements {
  scrollElement: HTMLElement;
  contentElement: HTMLElement;
}

export type GetTargetScrollTop = (
  targetScrollTop: number,
  context: ScrollElements,
) => number;

export interface StickToBottomOptions extends SpringAnimation {
  resize?: Animation;
  initial?: Animation | boolean;
  targetScrollTop?: GetTargetScrollTop;
  /**
   * 内容高度单次增长超过该像素时，resize 强制 instant。
   * 工具卡/折叠栏等离散跳变若仍走弹簧，会出现「先撑上去再弹回」的砰抖。
   * 小幅增长（正文逐字）仍用 resize 弹簧。
   * @default 28
   */
  instantResizeThreshold?: number;
}

export type ScrollToBottomOptions =
  | ScrollBehavior
  | {
      /**
       * Whether to wait for any existing scrolls to finish before
       * performing this one. Or if a millisecond is passed,
       * it will wait for that duration before performing the scroll.
       *
       * @default false
       */
      wait?: boolean | number;
      /**
       * Whether to prevent the user from escaping the scroll,
       * by scrolling up with their mouse.
       */
      ignoreEscapes?: boolean;
      /**
       * Only scroll to the bottom if we're already at the bottom.
       *
       * @default false
       */
      preserveScrollPosition?: boolean;
      /**
       * The extra duration in ms that this scroll event should persist for.
       * (in addition to the time that it takes to get to the bottom)
       *
       * Not to be confused with the duration of the animation -
       * for that you should adjust the animation option.
       *
       * @default 0
       */
      duration?: number | Promise<void>;
      /**
       * The animation to use for the scroll.
       */
      animation?: Animation;
    };

export type ScrollToBottom = (
  scrollOptions?: ScrollToBottomOptions,
) => Promise<boolean> | boolean;

export type StopScroll = () => void;

export interface StickToBottomState {
  scrollTop: number;
  lastScrollTop?: number;
  ignoreScrollToTop?: number;
  targetScrollTop: number;
  calculatedTargetScrollTop: number;
  scrollDifference: number;
  resizeDifference: number;
  /** 每次新开滚动会话递增；在途 rAF 发现代数过期则退出，避免与同步校正打架。 */
  scrollGeneration: number;
  animation?: {
    behavior: "instant" | Required<SpringAnimation>;
    ignoreEscapes: boolean;
    promise: Promise<boolean>;
  };
  lastTick?: number;
  velocity: number;
  accumulated: number;
  escapedFromLock: boolean;
  isAtBottom: boolean;
  isNearBottom: boolean;
  resizeObserver?: ResizeObserver;
}

export interface StickToBottomInstance {
  contentRef: React.MutableRefObject<HTMLElement | null> & React.RefCallback<HTMLElement>;
  scrollRef: React.MutableRefObject<HTMLElement | null> & React.RefCallback<HTMLElement>;
  scrollToBottom: ScrollToBottom;
  stopScroll: StopScroll;
  isAtBottom: boolean;
  isNearBottom: boolean;
  escapedFromLock: boolean;
  state: StickToBottomState;
}

let mouseDown = false;
if (typeof document !== "undefined") {
  document.addEventListener("mousedown", () => {
    mouseDown = true;
  });
  document.addEventListener("mouseup", () => {
    mouseDown = false;
  });
  document.addEventListener("click", () => {
    mouseDown = false;
  });
}

export const useStickToBottom = (options: StickToBottomOptions = {}): StickToBottomInstance => {
  const [escapedFromLock, updateEscapedFromLock] = useState(false);
  const [isAtBottom, updateIsAtBottom] = useState(options.initial !== false);
  const [isNearBottom, setIsNearBottom] = useState(false);
  const optionsRef = useRef<StickToBottomOptions | null>(null);
  optionsRef.current = options;

  const isSelecting = useCallback(() => {
    if (!mouseDown) {
      return false;
    }
    const selection = window.getSelection();
    if (!selection || !selection.rangeCount) {
      return false;
    }
    const range = selection.getRangeAt(0);
    return (
      range.commonAncestorContainer.contains(scrollRef.current as Node) ||
      (scrollRef.current as Node | null)?.contains(range.commonAncestorContainer)
    );
  }, []);

  const setIsAtBottom = useCallback(
    (isAtBottom: boolean) => {
      state.isAtBottom = isAtBottom;
      updateIsAtBottom(isAtBottom);
    },
    [],
  );

  const setEscapedFromLock = useCallback(
    (escapedFromLock: boolean) => {
      state.escapedFromLock = escapedFromLock;
      updateEscapedFromLock(escapedFromLock);
    },
    [],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: state intentionally created once
  const state = useMemo<StickToBottomState>(() => {
    let lastCalculation: { targetScrollTop: number; calculatedScrollTop: number } | undefined;
    return {
      escapedFromLock,
      isAtBottom,
      resizeDifference: 0,
      scrollGeneration: 0,
      accumulated: 0,
      velocity: 0,
      get scrollTop() {
        return scrollRef.current?.scrollTop ?? 0;
      },
      set scrollTop(scrollTop: number) {
        if (scrollRef.current) {
          scrollRef.current.scrollTop = scrollTop;
          state.ignoreScrollToTop = scrollRef.current.scrollTop;
        }
      },
      get targetScrollTop() {
        if (!scrollRef.current || !contentRef.current) {
          return 0;
        }
        return scrollRef.current.scrollHeight - 1 - scrollRef.current.clientHeight;
      },
      get calculatedTargetScrollTop() {
        if (!scrollRef.current || !contentRef.current) {
          return 0;
        }
        const { targetScrollTop } = this;
        if (!optionsRef.current?.targetScrollTop) {
          return targetScrollTop;
        }
        if (lastCalculation?.targetScrollTop === targetScrollTop) {
          return lastCalculation.calculatedScrollTop;
        }
        const calculatedScrollTop = Math.max(
          Math.min(
            optionsRef.current.targetScrollTop(targetScrollTop, {
              scrollElement: scrollRef.current,
              contentElement: contentRef.current,
            }),
            targetScrollTop,
          ),
          0,
        );
        lastCalculation = { targetScrollTop, calculatedScrollTop };
        requestAnimationFrame(() => {
          lastCalculation = undefined;
        });
        return calculatedScrollTop;
      },
      get scrollDifference() {
        return this.calculatedTargetScrollTop - this.scrollTop;
      },
      get isNearBottom() {
        return this.scrollDifference <= STICK_TO_BOTTOM_OFFSET_PX;
      },
    };
  }, []);

  const scrollToBottom = useCallback<ScrollToBottom>(
    (scrollOptions = {}) => {
      if (typeof scrollOptions === "string") {
        scrollOptions = { animation: scrollOptions };
      }
      if (!scrollOptions.preserveScrollPosition) {
        setIsAtBottom(true);
      }
      const waitElapsed = Date.now() + (Number(scrollOptions.wait) || 0);
      const behavior = mergeAnimations(optionsRef.current ?? {}, scrollOptions.animation);
      const { ignoreEscapes = false } = scrollOptions;
      let durationElapsed: number;
      let startTarget = state.calculatedTargetScrollTop;
      if (scrollOptions.duration instanceof Promise) {
        scrollOptions.duration.finally(() => {
          durationElapsed = Date.now();
        });
      } else {
        durationElapsed = waitElapsed + (scrollOptions.duration ?? 0);
      }
      // instant 不复用在途动画：旧闭包的 startTarget 会把连续增高拖成多帧阶梯。
      if (scrollOptions.wait !== true || behavior === "instant") {
        state.animation = undefined;
      }
      if (state.animation?.behavior === behavior) {
        return state.animation.promise;
      }
      const generation = ++state.scrollGeneration;
      const next = async (): Promise<boolean> => {
        const promise = new Promise(requestAnimationFrame).then(() => {
          if (generation !== state.scrollGeneration) {
            return false;
          }
          if (!state.isAtBottom) {
            state.animation = undefined;
            return false;
          }
          const { scrollTop } = state;
          const tick = performance.now();
          const tickDelta = (tick - (state.lastTick ?? tick)) / SIXTY_FPS_INTERVAL_MS;
          state.animation || (state.animation = { behavior, promise, ignoreEscapes });
          if (state.animation.behavior === behavior) {
            state.lastTick = tick;
          }
          if (isSelecting()) {
            return next();
          }
          if (waitElapsed > Date.now()) {
            return next();
          }
          if (scrollTop < Math.min(startTarget, state.calculatedTargetScrollTop)) {
            if (state.animation?.behavior === behavior) {
              if (behavior === "instant") {
                state.scrollTop = state.calculatedTargetScrollTop;
                return next();
              }
              state.velocity =
                (behavior.damping * state.velocity +
                  behavior.stiffness * state.scrollDifference) /
                behavior.mass;
              state.accumulated += state.velocity * tickDelta;
              state.scrollTop += state.accumulated;
              if (state.scrollTop !== scrollTop) {
                state.accumulated = 0;
              }
            }
            return next();
          }
          if (durationElapsed > Date.now()) {
            startTarget = state.calculatedTargetScrollTop;
            return next();
          }
          state.animation = undefined;
          /**
           * If we're still below the target, then queue
           * up another scroll to the bottom with the last
           * requested animation.
           */
          if (state.scrollTop < state.calculatedTargetScrollTop) {
            return scrollToBottom({
              animation: mergeAnimations(optionsRef.current ?? {}, optionsRef.current?.resize),
              ignoreEscapes,
              duration: Math.max(0, durationElapsed - Date.now()) || undefined,
            });
          }
          return state.isAtBottom;
        });
        return promise.then((isAtBottomResult: boolean) => {
          requestAnimationFrame(() => {
            if (!state.animation) {
              state.lastTick = undefined;
              state.velocity = 0;
            }
          });
          return isAtBottomResult;
        });
      };
      return next();
    },
    [setIsAtBottom, isSelecting, state],
  );

  const stopScroll = useCallback(() => {
    setEscapedFromLock(true);
    setIsAtBottom(false);
  }, [setEscapedFromLock, setIsAtBottom]);

  const handleScroll = useCallback(
    ({ target }: Event) => {
      if (target !== scrollRef.current) {
        return;
      }
      const { scrollTop, ignoreScrollToTop } = state;
      let { lastScrollTop = scrollTop } = state;
      state.lastScrollTop = scrollTop;
      state.ignoreScrollToTop = undefined;
      if (ignoreScrollToTop && ignoreScrollToTop > scrollTop) {
        /**
         * When the user scrolls up while the animation plays, the `scrollTop` may
         * not come in separate events; if this happens, to make sure `isScrollingUp`
         * is correct, set the lastScrollTop to the ignored event.
         */
        lastScrollTop = ignoreScrollToTop;
      }
      setIsNearBottom(state.isNearBottom);
      /**
       * Scroll events may come before a ResizeObserver event,
       * so in order to ignore resize events correctly we use a
       * timeout.
       *
       * @see https://github.com/WICG/resize-observer/issues/25#issuecomment-248757228
       */
      setTimeout(() => {
        /**
         * When theres a resize difference ignore the resize event.
         */
        if (state.resizeDifference || scrollTop === ignoreScrollToTop) {
          return;
        }
        if (isSelecting()) {
          setEscapedFromLock(true);
          setIsAtBottom(false);
          return;
        }
        const isScrollingDown = scrollTop > lastScrollTop;
        const isScrollingUp = scrollTop < lastScrollTop;
        if (state.animation?.ignoreEscapes) {
          state.scrollTop = lastScrollTop;
          return;
        }
        if (isScrollingUp) {
          setEscapedFromLock(true);
          setIsAtBottom(false);
        }
        if (isScrollingDown) {
          setEscapedFromLock(false);
        }
        if (!state.escapedFromLock && state.isNearBottom) {
          setIsAtBottom(true);
        }
      }, 1);
    },
    [setEscapedFromLock, setIsAtBottom, isSelecting, state],
  );

  const handleWheel = useCallback(
    ({ target, deltaY }: WheelEvent) => {
      let element = target as HTMLElement;
      while (!["scroll", "auto"].includes(getComputedStyle(element).overflow)) {
        if (!element.parentElement) {
          return;
        }
        element = element.parentElement;
      }
      /**
       * The browser may cancel the scrolling from the mouse wheel
       * if we update it from the animation in meantime.
       * To prevent this, always escape when the wheel is scrolled up.
       */
      if (
        element === scrollRef.current &&
        deltaY < 0 &&
        scrollRef.current.scrollHeight > scrollRef.current.clientHeight &&
        !state.animation?.ignoreEscapes
      ) {
        setEscapedFromLock(true);
        setIsAtBottom(false);
      }
    },
    [setEscapedFromLock, setIsAtBottom, state],
  );

  const scrollRef = useRefCallback((scroll) => {
    scrollRef.current?.removeEventListener("scroll", handleScroll);
    scrollRef.current?.removeEventListener("wheel", handleWheel);
    scroll?.addEventListener("scroll", handleScroll, { passive: true });
    scroll?.addEventListener("wheel", handleWheel, { passive: true });
  }, []);

  const contentRef = useRefCallback((content) => {
    state.resizeObserver?.disconnect();
    if (!content) {
      return;
    }
    let previousHeight: number | undefined;
    state.resizeObserver = new ResizeObserver(([entry]) => {
      const { height } = entry.contentRect;
      const difference = height - (previousHeight ?? height);
      state.resizeDifference = difference;
      /**
       * Sometimes the browser can overscroll past the target,
       * so check for this and adjust appropriately.
       */
      if (state.scrollTop > state.targetScrollTop) {
        state.scrollTop = state.targetScrollTop;
      }
      setIsNearBottom(state.isNearBottom);
      if (difference >= 0) {
        /**
         * If it's a positive resize, scroll to the bottom when
         * we're already at the bottom.
         * 大块离散增高（工具卡入场等）强制 instant，避免弹簧滞后造成砰抖；
         * 小幅增长保留配置的 resize 动画（逐字跟底）。
         *
         * instant 必须在本 RO 回调内同步写 scrollTop：
         * RO 在 paint 前触发，而 scrollToBottom 的 rAF 要等到下一帧——
         * 中间那一帧旧 scrollTop 就是工具卡「砰」一下的根因。
         */
        const requested = mergeAnimations(
          optionsRef.current ?? {},
          previousHeight ? optionsRef.current?.resize : optionsRef.current?.initial,
        );
        const threshold = optionsRef.current?.instantResizeThreshold ?? 28;
        const animation =
          previousHeight &&
          difference > threshold &&
          requested !== "instant"
            ? "instant"
            : requested;
        if (animation === "instant") {
          // preserveScrollPosition：仅已锁底时跟随，不把用户上滚强拽回来
          if (state.isAtBottom) {
            state.scrollGeneration += 1;
            state.animation = undefined;
            state.scrollTop = state.calculatedTargetScrollTop;
          }
        } else {
          scrollToBottom({
            animation,
            wait: true,
            preserveScrollPosition: true,
            duration: RETAIN_ANIMATION_DURATION_MS,
          });
        }
      } else {
        /**
         * Else if it's a negative resize, check if we're near the bottom
         * if we are want to un-escape from the lock, because the resize
         * could have caused the container to be at the bottom.
         */
        if (state.isNearBottom) {
          setEscapedFromLock(false);
          setIsAtBottom(true);
        }
      }
      previousHeight = height;
      /**
       * Reset the resize difference after the scroll event
       * has fired. Requires a rAF to wait for the scroll event,
       * and a setTimeout to wait for the other timeout we have in
       * resizeObserver in case the scroll event happens after the
       * resize event.
       */
      requestAnimationFrame(() => {
        setTimeout(() => {
          if (state.resizeDifference === difference) {
            state.resizeDifference = 0;
          }
        }, 1);
      });
    });
    state.resizeObserver?.observe(content);
  }, []);

  return {
    contentRef,
    scrollRef,
    scrollToBottom,
    stopScroll,
    /**
     * 对外「是否锁底跟随」只用严格 isAtBottom。
     * 旧实现 `isAtBottom || isNearBottom` 会在用户已上滚但距底 <70px 时仍报跟随，
     * ResizeObserver 继续拽底 → 触底附近周期性上跳/回弹。
     */
    isAtBottom,
    isNearBottom,
    escapedFromLock,
    state,
  };
};

type RefCallbackRef<T> = React.MutableRefObject<T | null> & React.RefCallback<T>;

function useRefCallback<T extends HTMLElement>(
  callback: (ref: T | null) => void,
  deps: React.DependencyList,
): RefCallbackRef<T> {
  // biome-ignore lint/correctness/useExhaustiveDependencies: ref identity must be stable
  const result = useCallback(
    (ref: T | null) => {
      (result as RefCallbackRef<T>).current = ref;
      return callback(ref);
    },
    deps,
  ) as unknown as RefCallbackRef<T>;
  return result;
}

