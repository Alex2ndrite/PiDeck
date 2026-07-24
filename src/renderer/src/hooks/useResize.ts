import { useRef, useState, type PointerEvent } from "react";
import { COMPOSER_MIN_HEIGHT } from "../rendererUtils";

const DEFAULT_LIST_WIDTH = 260;

export interface UseResizeOptions {
  /** 当前 composer 的解析高度（clamped） */
  resolvedComposerHeight: number;
  /** composer 的最大允许高度 */
  maxComposerHeight: number;
  /** 设置手动拖拽的 composer 高度 */
  setComposerHeight: (value: number | ((prev: number) => number)) => void;
  /** 设置自动内容高度 */
  setComposerAutoHeight: (value: number | ((prev: number) => number)) => void;
}

export function useResize({
  resolvedComposerHeight,
  maxComposerHeight,
  setComposerHeight,
  setComposerAutoHeight,
}: UseResizeOptions) {
  const [listWidth, setListWidth] = useState(DEFAULT_LIST_WIDTH);
  const [listCollapsed, setListCollapsed] = useState(false);
  const [listHoverRevealSuppressed, setListHoverRevealSuppressed] =
    useState(false);

  // 使用 ref 避免 resize 事件处理器闭包捕获陈旧值
  const resolvedComposerHeightRef = useRef(resolvedComposerHeight);
  resolvedComposerHeightRef.current = resolvedComposerHeight;
  const maxComposerHeightRef = useRef(maxComposerHeight);
  maxComposerHeightRef.current = maxComposerHeight;

  function startComposerResize(event: PointerEvent) {
    const startY = event.clientY;
    const startHeight = resolvedComposerHeightRef.current;
    let frame = 0;

    function onMove(moveEvent: globalThis.PointerEvent) {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const maxHeight = maxComposerHeightRef.current;
        // 拖动的是输入区顶部边线,鼠标向上意味着输入区变高;限制最大高度避免挤压会话阅读区域。
        // 实际高度由手动高度和自动内容高度共同决定;拖到最大后自动高度也会变大,
        // 因此手动缩小时必须同步覆盖 autoHeight,否则 Math.max 会继续把输入框顶在最大高度。
        const next = Math.min(
          maxHeight,
          Math.max(
            COMPOSER_MIN_HEIGHT,
            startHeight + startY - moveEvent.clientY,
          ),
        );
        setComposerHeight(next);
        setComposerAutoHeight(next);
      });
    }

    function onUp() {
      cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      document.body.classList.remove("is-composer-resizing");
    }

    document.body.classList.add("is-composer-resizing");
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  function toggleListCollapsed() {
    const nextCollapsed = !listCollapsed;
    if (!nextCollapsed) setListWidth(DEFAULT_LIST_WIDTH);
    if (nextCollapsed) {
      // 点击折叠后鼠标和焦点仍在侧栏内;先释放焦点并抑制 hover,避免刚折叠就被 CSS 展开。
      (document.activeElement as HTMLElement | null)?.blur();
    }
    setListHoverRevealSuppressed(nextCollapsed);
    setListCollapsed(nextCollapsed);
  }

  function releaseListHoverSuppression(event: PointerEvent<HTMLDivElement>) {
    if (listCollapsed && listHoverRevealSuppressed && event.clientX > 24) {
      setListHoverRevealSuppressed(false);
    }
  }

  return {
    listWidth,
    setListWidth,
    listCollapsed,
    setListCollapsed,
    listHoverRevealSuppressed,
    setListHoverRevealSuppressed,
    DEFAULT_LIST_WIDTH,
    startComposerResize,
    toggleListCollapsed,
    releaseListHoverSuppression,
  };
}
