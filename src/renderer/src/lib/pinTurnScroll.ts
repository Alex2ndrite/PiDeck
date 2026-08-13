/**
 * 发送置顶（清屏）滚动的时长与缓动。
 * 与 stick-to-bottom 弹簧分离：长距离整页上推若用弹簧会过冲，清屏需要一次性落到消息顶。
 */

/** 按滚动距离估算时长：短距离干脆，长会话封顶，避免整页滚太久。 */
export function pinScrollDurationMs(distancePx: number): number {
  const distance = Math.abs(distancePx);
  return Math.round(Math.min(780, Math.max(380, 280 + distance * 0.32)));
}

/** ease-out quart：快起慢收、无回弹，接近项目 EASE_OUT 的观感。 */
export function pinScrollEase(progress: number): number {
  const t = Math.min(1, Math.max(0, progress));
  return 1 - (1 - t) ** 4;
}

/** 用户消息相对视口上沿的安全边，避免文本贴住时间线顶。 */
export const PIN_TOP_INSET_PX = 20;

/**
 * 清屏垫片高度：滚到底时，用户消息顶停在视口上沿以下 topInset。
 * contentWithoutSpacer 必须先扣掉当前垫片，否则收敛时会把旧垫片算进内容。
 */
export function measurePinSpacerHeight(input: {
  rowTop: number;
  clientHeight: number;
  contentWithoutSpacer: number;
  topInset?: number;
}): number {
  const inset = input.topInset ?? PIN_TOP_INSET_PX;
  return Math.max(
    0,
    Math.round(input.rowTop + input.clientHeight - input.contentWithoutSpacer - inset),
  );
}

export type AnimateScrollTopOptions = {
  reduceMotion?: boolean;
  now?: () => number;
  raf?: (callback: FrameRequestCallback) => number;
  caf?: (id: number) => void;
  isCancelled?: () => boolean;
  onComplete?: () => void;
};

/**
 * 把 scrollTop 缓动到目标。返回取消函数。
 * 不用 CSS scroll-behavior:smooth——时长/曲线不可控，长距离还会被浏览器掐成突兀一截。
 */
export function animateScrollTop(
  element: HTMLElement,
  targetTop: number,
  options: AnimateScrollTopOptions = {},
): () => void {
  const reduceMotion = options.reduceMotion ?? false;
  const now = options.now ?? (() => performance.now());
  const raf = options.raf ?? ((callback) => window.requestAnimationFrame(callback));
  const caf = options.caf ?? ((id) => window.cancelAnimationFrame(id));
  const isCancelled = options.isCancelled ?? (() => false);

  const target = Math.max(0, targetTop);
  if (reduceMotion || Math.abs(element.scrollTop - target) < 2) {
    element.scrollTop = target;
    options.onComplete?.();
    return () => undefined;
  }

  const startTop = element.scrollTop;
  const distance = target - startTop;
  const duration = pinScrollDurationMs(distance);
  const startedAt = now();
  let frameId = 0;
  let stopped = false;

  const step = (timestamp: number) => {
    if (stopped || isCancelled()) return;
    const progress = pinScrollEase((timestamp - startedAt) / duration);
    element.scrollTop = startTop + distance * progress;
    if (progress >= 1) {
      options.onComplete?.();
      return;
    }
    frameId = raf(step);
  };

  // 用当前时间起步，避免首帧 timestamp 与 startedAt 不同钟导致跳变
  frameId = raf(() => step(now()));
  return () => {
    stopped = true;
    caf(frameId);
  };
}
