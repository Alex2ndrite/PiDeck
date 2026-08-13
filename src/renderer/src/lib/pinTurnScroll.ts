/**
 * 发送置顶（清屏）滚动的时长与缓动。
 * 与 stick-to-bottom 弹簧分离：主体接近匀速，尾部只留一点过冲，避免 quart 那种「先冲到底再停」。
 */

/** 按滚动距离估算时长：短距离干脆，长会话封顶；整体比旧 quart 略长，让线性段能看清。 */
export function pinScrollDurationMs(distancePx: number): number {
  const distance = Math.abs(distancePx);
  return Math.round(Math.min(860, Math.max(420, 300 + distance * 0.32)));
}

/**
 * 线性主体 + 尾部轻微回弹。
 * 前 65% 接近匀速（smoothstep 混一点），之后切到 easeOutBack，过冲约 4% 再落到目标。
 */
export function pinScrollEase(progress: number): number {
  const t = Math.min(1, Math.max(0, progress));
  if (t === 0 || t === 1) return t;
  const linear = t;
  const smooth = t * t * (3 - 2 * t);
  const body = linear * 0.7 + smooth * 0.3;
  const overshoot = 1.70158;
  const back = 1 + (overshoot + 1) * (t - 1) ** 3 + overshoot * (t - 1) ** 2;
  // 后段才把 back 混进来，避免中段就被弹到 1 附近。
  const mix = t < 0.65 ? (t * t) / 0.65 : 1;
  return body * (1 - mix) + back * mix;
}

export type PinTurnMessage = {
  id: string;
  role: string;
};

/**
 * 根据时间线尾部变化决定要置顶的用户消息。
 * 发送当下就要钉：空会话首条、乐观 id 被权威消息+回复一次性冲掉，都不能再等下一次 user。
 */
export function resolvePinTurnOnTailChange(input: {
  previousTail?: string;
  messages: readonly PinTurnMessage[];
  pendingRequestId?: string;
  /** 已经钉过的用户消息。同尾后到的 requestId 只在尚未钉过时补一次。 */
  alreadyPinnedId?: string;
}): string | undefined {
  const last = input.messages[input.messages.length - 1];
  if (!last) return undefined;

  const lastUser = findLastUser(input.messages);
  if (!lastUser) return undefined;

  // 首帧：历史回放不钉。只有尾部已经是「正在发送」的用户气泡才立刻清屏。
  // 不能仅凭 pendingRequestId 去钉 lastUser——切回进行中的会话时，乐观消息可能还没进列表。
  if (!input.previousTail) {
    // 首帧只钉「正在发送」且已经出现在列表里的那条用户消息。
    // 不能靠「只有一条用户消息」兜底：一段历史 + 新发送在结构上长得一样。
    if (input.pendingRequestId && lastUser.id === input.pendingRequestId) {
      return lastUser.id;
    }
    return undefined;
  }

  if (last.id === input.previousTail) {
    // 乐观气泡可能先于 sendState.requestId 进列表；尾没变，但发送态后到仍要立刻钉。
    if (
      input.pendingRequestId &&
      last.role === "user" &&
      lastUser.id === input.pendingRequestId &&
      input.alreadyPinnedId !== lastUser.id
    ) {
      return lastUser.id;
    }
    return undefined;
  }

  const baselineIndex = input.messages.findIndex((message) => message.id === input.previousTail);
  if (baselineIndex >= 0) {
    const fresh = input.messages.slice(baselineIndex + 1);
    return findLastUser(fresh)?.id;
  }

  // previousTail 已不在列表：乐观用户被 runtime 全量 flush 换了 id。
  // 即使尾部已经是 assistant，仍钉最新用户，避免等下一轮提问才清屏。
  return lastUser.id;
}

function findLastUser(messages: readonly PinTurnMessage[]): PinTurnMessage | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "user") return messages[index];
  }
  return undefined;
}

/** 尾部新增消息 id（入场动画用）。历史首帧不闪；只有发送当下才给当前尾一条入场。 */
export function resolveFreshTailIds(
  messages: readonly PinTurnMessage[],
  previousTail: string | undefined,
  nextTail: string,
  pendingRequestId?: string,
): string[] {
  if (!previousTail) return pendingRequestId ? [nextTail] : [];
  if (nextTail === previousTail) return [];
  const baselineIndex = messages.findIndex((message) => message.id === previousTail);
  return baselineIndex < 0
    ? [nextTail]
    : messages.slice(baselineIndex + 1).map((message) => message.id);
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
    // 完成判定必须用时间进度：弹性曲线中段会 >1，不能拿 eased 值当结束条件。
    const t = Math.min(1, Math.max(0, (timestamp - startedAt) / duration));
    element.scrollTop = startTop + distance * pinScrollEase(t);
    if (t >= 1) {
      element.scrollTop = target;
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
