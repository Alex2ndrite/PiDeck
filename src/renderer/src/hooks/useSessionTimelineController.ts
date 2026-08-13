import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import { atom, useAtomValue, useSetAtom, useStore } from "jotai";
import { selectAtom } from "jotai/utils";
import { desktopApi } from "../desktopApi";
import type { AgentRuntimeState, ChatMessage } from "../../../shared/types";
import {
	cacheSessionMessagesAtom,
	clearSessionHistoryAtom,
	prependSessionHistoryPageAtom,
	prependSessionMessagePageAtom,
  sessionMessageLoadStateAtom,
  sessionMessagesCacheAtom,
  sessionMessageCacheBySessionIdAtomFamily,
  saveSessionScrollAnchorAtom,
  sessionScrollAnchorByIdAtom,
  setSessionMessageLoadStateAtom,
  touchSessionMessagesAtom,
	type SessionScrollAnchor,
} from "../atoms";
import type { MessageScrollerScrollApi } from "../components/agents/message-scroller";
import {
  animateScrollTop,
  measurePinSpacerHeight,
  PIN_TOP_INSET_PX,
} from "../lib/pinTurnScroll";
import {
  TIMELINE_SCROLLED_TURN_LIMIT,
  TIMELINE_WINDOW_EXPAND_STEP,
} from "../components/session/timeline/turnRenderWindow";

/** 滚动接近顶部自动加载历史的阈值（px，2026-11 轮次模型）：
 *  贴顶（≤8px）才触发翻页——「滑到底才翻」，避免在顶部附近任何滚动都连翻历史页。 */
const HISTORY_AUTO_LOAD_THRESHOLD = 8;
/** 翻页冷却（ms）：加载完成后立即再滚到顶不连翻，需停顿后重新触发（防惯性滚动连翻多页）。 */
const HISTORY_AUTO_LOAD_COOLDOWN_MS = 300;

let nextLoadSequence = 0;
/** 会话加载请求序号（防迟到响应串台）。键按 sessionId 累积，LRU 裁剪防无界增长（2026-10）。 */
const latestLoadBySession = new Map<string, number>();
const LATEST_LOAD_LRU_LIMIT = 20;
function trackLatestLoad(sessionId: string, sequence: number) {
	latestLoadBySession.set(sessionId, sequence);
	if (latestLoadBySession.size <= LATEST_LOAD_LRU_LIMIT) return;
	// 超限：删最早 set 的键（Map 迭代序 = 插入序）
	const oldest = latestLoadBySession.keys().next().value;
	if (oldest !== undefined) latestLoadBySession.delete(oldest);
}
/** sessionId 为空时的占位 atom：恒 undefined（无会话不订缓存条目）。 */
const NO_CACHE_ENTRY_ATOM = atom(undefined);

// 用户主动向上滚超过此阈值后停止自动跟底。值设很小是为了让用户稍微滚一点就能挣脱自动滚动，
// 避免流式消息频繁触发 ResizeObserver/MutationObserver 把用户弹回底部造成"颤抖"。
const BOTTOM_THRESHOLD = 16;
const LEGACY_OWNER_KEY = "legacy";
/** runtime 窗口会话「加载更多对话」的单页轮数（与主进程 DEFAULT_TURN_PAGE_SIZE 对齐） */
const RUNTIME_HISTORY_TURN_PAGE_SIZE = 3;

type Tagged<T> = { ownerKey: string; value: T };
type TimelineAnchor = { height: number; top: number };

export function isTimelineAtBottom(
  scrollTop: number,
  scrollHeight: number,
  clientHeight: number,
): boolean {
  return scrollHeight - scrollTop - clientHeight < BOTTOM_THRESHOLD;
}

export function restoreTimelineAnchor(previousTop: number, heightDelta: number): number {
  return previousTop + heightDelta;
}

export function matchesTimelineOwner(
  taggedOwnerKey: string,
  currentOwnerKey: string,
): boolean {
  return taggedOwnerKey === currentOwnerKey;
}

export function isSessionRuntimeBusy(
  status: string | undefined,
  state: AgentRuntimeState | undefined,
): boolean {
  // idle/error/closed 是停止的权威边沿；旧 runtime-state 可能稍后到达，
  // 不能让滞后的 isStreaming/isExecutingTool 把页面继续显示为运行中。
  if (status === "idle" || status === "error" || status === "closed" || status === "detached") return false;
  return Boolean(status === "running" || state?.isStreaming || state?.isExecutingTool);
}

/** 用户主动发送才算「正在启动」。输入预热也会把 runtime 打成 starting，但不能锁输入框。 */
export function isUserFacingSessionStart(sendStatus: string | undefined): boolean {
  return sendStatus === "activating";
}

export function deriveSessionSurfaceRuntime(
  messageCount: number,
  messageLoadStatus: string | undefined,
  sendStatus: string | undefined,
  runtimeStatus: string | undefined,
  runtimeState: AgentRuntimeState | undefined,
  hasCachedEntry?: boolean,
) {
  const activating = isUserFacingSessionStart(sendStatus);
  const status = activating ? "starting" : runtimeStatus;
  return {
    status,
    isLoading: messageCount === 0 && (
      messageLoadStatus === "loading" ||
      // 挂载首帧 loadState 尚未写入（passive effect 在 paint 后才置 loading），
      // undefined 一律视为加载中——否则有历史的会话会被误判为「空会话」，
      // 闪出 SessionStartSurface 起始页（打开/切回大会话闪屏根因）。
      messageLoadStatus === undefined ||
      // ready 但缓存条目不存在（从未写入或被 LRU 淘汰）＝ disk 读取结果尚未到达
      // （cacheMessages 对 disk 读取无论空/非空都会创建条目）：必须钉在骨架屏。
      // 缓存条目已存在（即使 messages 为空）说明 disk 已返回——空会话显示起始页
      // 是合法终态，不会进入加载死循环。读取失败（error）不在此列。
      // 预热/发送 activating 不能再钉骨架：空会话应留在起始页，避免「输入一半整页闪骨架」。
      (messageLoadStatus === "ready" && !hasCachedEntry)
    ),
    isStarting: activating,
    isBusy: activating || sendStatus === "sending" || isSessionRuntimeBusy(status, runtimeState),
  };
}

export function canLoadSessionTimelineMore(isStarting: boolean, messageCount: number): boolean {
  // 只在初始加载（无消息）时隐藏按钮；runtime 创建期间已有消息则不隐藏
  return !(isStarting && messageCount === 0);
}

export function isLatestTimelineRunBusy(
  isAgentBusy: boolean,
  index: number,
  runCount: number,
): boolean {
  return isAgentBusy && index === runCount - 1;
}

export type SessionTimelineController = {
  timelineRef: RefObject<HTMLElement | null>;
  messages: ChatMessage[];
	visibleMessages: ChatMessage[];
	totalMessageCount: number;
	hasMoreMessages: boolean;
  /** 下一次「加载更多」触发 disk 轮次分页（渲染窗口已耗尽且窗口前还有历史） */
  nextLoadIsHistory: boolean;
  isLoadingMoreMessages: boolean;
  loadMoreMessages: () => void;
  /** 标记一次程序化滚动（turn 窗口展开补偿等组件内补偿用），抑制自动加载监听。 */
  markProgrammaticScroll: () => void;
  jumpToMessage: (messageId: string) => void;
  scrollToBottom: () => void;
  /** 滚动回调（MessageScroller viewport 接线）：维护会话切换的滚动锚点。 */
  handleTimelineScroll: () => void;
  autoScroll: boolean;
  showScrollToBottom: boolean;
  /** pin-to-top 动画期间冻结 MessageScroller 的流式跟随，避免高度变化打断动画。 */
  pinAnimating: boolean;
  /** 由 MessageScroller 汇报用户是否仍在实时尾部，避免两套滚动监听互相抢占。 */
  setAutoScrollFromScroller: (following: boolean) => void;
  /**
   * 挂到 MessageScroller 的 stick-to-bottom 引擎 API（回底弹簧）。
   * 未挂上时 scrollToBottom 退化为原生 scrollTo。
   */
  scrollerScrollApiRef: RefObject<MessageScrollerScrollApi | null>;
  /** 发送置顶动画：最新用户消息 id（垫片锚点），未激活为 undefined。 */
  pinnedTurnId?: string;
  /** 垫片高度（px），由 controller 按「用户消息顶到视口顶部」目标动态收敛。 */
  pinSpacerHeight?: number;
  /** 发送消息后调用：把指定用户消息平滑滚动到视口顶部（此前内容整体顶出屏幕）。 */
  pinTurnToTop?: (userMessageId: string, options?: { animate?: boolean }) => void;
  /** 上滚查看历史时的渲染窗口轮数（贴底时渲染层用 TIMELINE_MOUNTED_TURN_LIMIT，忽略此值）。
   *  2026-08 黑屏治理：历史不再全量放开挂载，窗口随「显示更早」逐步扩大。 */
  scrolledWindowTurns: number;
  /** 扩大上滚渲染窗口（+TIMELINE_WINDOW_EXPAND_STEP 轮）；数据翻页仍由滚动到顶自动加载负责。 */
  expandWindow: () => void;
};

export function useSessionTimelineController(options: {
  sessionId?: string;
  messages?: ChatMessage[];
  initialPageSize?: number;
  pageSize?: number;
}): SessionTimelineController {
  const ownerKey = options.sessionId ?? LEGACY_OWNER_KEY;
  const timelineRef = useRef<HTMLElement | null>(null);
  const ownerKeyRef = useRef(ownerKey);
  ownerKeyRef.current = ownerKey;
  // 切换恢复时读滚动锚点快照用（不订阅：恢复后滚动写 atom 不打扰已恢复的视口）
  const store = useStore();
  const cacheSliceAtom = useMemo(
    () => selectAtom(
      sessionMessagesCacheAtom,
      (cache) => options.sessionId ? cache[options.sessionId]?.messages : undefined,
      Object.is,
    ),
    [options.sessionId],
  );
  const cachedMessages = useAtomValue(cacheSliceAtom);
  const messages = options.messages ?? cachedMessages ?? [];
  const controllerEnabled = options.sessionId !== undefined && options.messages === undefined;

  // ── 会话切换滚动位置保持（状态即真相）──
  // 滚动节流直接写 per-session atom（内容不变跳过 → 引用稳定 → 零订阅重渲染）；
  // 恢复 = 切换时从 atom 读一次快照执行，不订阅（后续滚动写 atom 不打扰已恢复的视口）。
  const saveScrollAnchor = useSetAtom(saveSessionScrollAnchorAtom);
  // 最后已知锚点缓存：供 cleanup 兜底落盘（250ms 节流窗口内切走不丢）。
  // 不能用 cleanup 读 DOM——会话切换复用同一组件实例（无 key），cleanup 执行时
  // timeline 的 children 可能已替换为新会话消息，读 DOM 会串数据。
  const currentAnchorRef = useRef<SessionScrollAnchor | null>(null);
  const scrollAnchorFrameRef = useRef<number | undefined>(undefined);
  const scrollSaveTimerRef = useRef<number | undefined>(undefined);

  /**
   * 计算当前视口锚点（纯读取，不落盘）。
   * 规则：在底部跟流 → null（切回继续跟底）；查看历史 → 记录
   * 「视口顶部的第一条消息行 + 距视口顶偏移 + 分页窗口」。
   * 锚点行用 data-message-id（run 或消息行都带），恢复时无需关心具体类型。
   */
  const computeCurrentAnchor = useCallback((): SessionScrollAnchor | null => {
    const timeline = timelineRef.current;
    if (!timeline) return null;
    if (isTimelineAtBottom(timeline.scrollTop, timeline.scrollHeight, timeline.clientHeight)) {
      return null;
    }
    const viewportRect = timeline.getBoundingClientRect();
    const rows = timeline.querySelectorAll<HTMLElement>("[data-message-id]");
    for (const row of rows) {
      const rect = row.getBoundingClientRect();
      if (rect.bottom >= viewportRect.top + 1) {
        const messageId = row.dataset.messageId ?? "";
        if (!messageId) continue;
        return {
          messageId,
          // 保留负偏移：视口顶部常被上一行底部占据（行顶在视口上方），
          // 截断为 0 会导致恢复时把行顶对齐视口顶、整体位置偏下（高大行偏差明显）。
          // 恢复侧 scrollTop = max(0, elTop - offsetTop) 已兜底负值。
          offsetTop: rect.top - viewportRect.top,
          // 2026-11 轮次模型：不再有 100 条分页窗口，visibleCount 恒为 0（兼容字段）
          visibleCount: 0,
          savedAt: Date.now(),
        };
      }
    }
    // 无任何消息行（空会话/加载中）
    return null;
  }, []);

  /** 把当前锚点写入 atom（节流）。内容未变化由 atom 侧跳过，引用保持稳定。 */
  const persistCurrentAnchor = useCallback((sessionId: string) => {
    scrollSaveTimerRef.current = undefined;
    saveScrollAnchor({ sessionId, anchor: currentAnchorRef.current });
  }, [saveScrollAnchor]);

  /** 透传给 MessageScroller viewport 的滚动回调（SessionMessageTimeline 接线）。
   *  rAF 合并高频滚动计算锚点（不每帧 getBoundingClientRect），再节流 250ms 落盘 atom。 */
  const handleTimelineScroll = useCallback(() => {
    const sessionId = ownerKeyRef.current;
    if (!sessionId || sessionId === LEGACY_OWNER_KEY) return;
    if (scrollAnchorFrameRef.current != null) return;
    scrollAnchorFrameRef.current = requestAnimationFrame(() => {
      scrollAnchorFrameRef.current = undefined;
      // 回调执行时若已切走（ownerKeyRef 已更新），丢弃——旧会话状态由 cleanup 落盘。
      if (ownerKeyRef.current !== sessionId) return;
      currentAnchorRef.current = computeCurrentAnchor();
      // 节流写 atom：只排一个 timer，期间连续滚动不重复写；
      // 内容未变时 atom 侧跳过（引用稳定，订阅者零重渲染）。
      if (scrollSaveTimerRef.current != null) return;
      scrollSaveTimerRef.current = window.setTimeout(() => {
        persistCurrentAnchor(sessionId);
      }, 250);
    });
  }, [computeCurrentAnchor, persistCurrentAnchor]);

  // ── Load messages from disk when sessionId changes ──
	// 只订本会话缓存条目（family selectAtom 隔离）：其它会话的消息到达/分页不拖着重渲染本栏。
	const cachedEntry = useAtomValue(
		options.sessionId
			? sessionMessageCacheBySessionIdAtomFamily(options.sessionId)
			: NO_CACHE_ENTRY_ATOM,
	);
	const cacheMessages = useSetAtom(cacheSessionMessagesAtom);
	const prependMessagePage = useSetAtom(prependSessionMessagePageAtom);
	const prependHistoryPage = useSetAtom(prependSessionHistoryPageAtom);
  const setLoadState = useSetAtom(setSessionMessageLoadStateAtom);
  const touchMessages = useSetAtom(touchSessionMessagesAtom);
  const loadStates = useAtomValue(sessionMessageLoadStateAtom);
  const lastLoadedSessionRef = useRef<string | undefined>(undefined);

	// useLayoutEffect 而非 useEffect：loading 状态必须在首帧 paint 之前写入，
	// 否则被动 effect 先于 loading 绘制一帧「空会话」→ 有历史的会话会闪出起始页。
	useLayoutEffect(() => {
    const sessionId = options.sessionId;
    if (!sessionId) return;
    const previouslyLoaded = lastLoadedSessionRef.current === sessionId;
    // 已加载且缓存条目仍在 → 跳过（正常运行路径）。
    // 缓存条目被 8-LRU 淘汰（条目变 undefined）时重新走磁盘加载自愈——
    // 否则已挂载会话永久卡骨架屏（2026-12 回归修复）。
    if (previouslyLoaded && cachedEntry) return;
    if (!previouslyLoaded) lastLoadedSessionRef.current = sessionId;

    const entry = cachedEntry;
    const sequence = ++nextLoadSequence;
    trackLatestLoad(sessionId, sequence);
    const expectedRevision = entry?.revision ?? 0;
    if (entry) touchMessages(sessionId);
    setLoadState({ sessionId, state: { status: "loading" } });

		void desktopApi.sessions
			.readRecordMessagePage(sessionId, undefined, options.initialPageSize ?? 100)
			.then((page: { messages: ChatMessage[]; total: number; nextBefore: number | null }) => {
				if (latestLoadBySession.get(sessionId) !== sequence) return;
				cacheMessages({
					sessionId,
					messages: page.messages,
					source: "disk",
					expectedRevision,
					page: { total: page.total, nextBefore: page.nextBefore },
				});
        setLoadState({ sessionId, state: { status: "ready" } });
      })
      .catch((error: unknown) => {
        if (latestLoadBySession.get(sessionId) !== sequence) return;
        setLoadState({
          sessionId,
          state: {
            status: "error",
            error: error instanceof Error ? error.message : String(error),
          },
        });
      });
  }, [options.sessionId, cachedEntry]);

	const diskPage = controllerEnabled && cachedEntry?.source === "disk"
		? cachedEntry.page
		: undefined;
	// ── 激活显示窗口（2026-08 激活分页）──
	// runtime 窗口会话：显示数组 = disk 历史前缀（轮次页 prepend）+ 运行时窗口段。
	// 前缀与窗口段是两个下标空间，仅在渲染层按顺序拼接，合并/去重由 atoms 保证。
	const runtimeHistory = controllerEnabled && cachedEntry?.source === "runtime"
		? cachedEntry.history
		: undefined;
	const combinedMessages = useMemo(
		() => (runtimeHistory ? [...runtimeHistory.messages, ...messages] : messages),
		[runtimeHistory, messages],
	);
	// 窗口前还有历史可加载：已加载前缀看游标，未加载看窗口起点（>0 说明激活时被截断）
	const historyHasMore = controllerEnabled && cachedEntry?.source === "runtime"
		? (runtimeHistory ? runtimeHistory.nextBefore !== null : (cachedEntry.windowStart ?? 0) > 0)
		: false;
	// 2026-11 轮次模型：不再按 100 条分页器切片，显示数组 = 已加载全部（历史前缀 + 运行时窗口段）。
	// 内存预算由主进程 12 轮缓存 + 回底临时历史清理承担，渲染层不再有第二道条数窗口。
	const visibleMessages = combinedMessages;
	const [isLoadingMessagePage, setIsLoadingMessagePage] = useState(false);
  const [autoScroll, setAutoScroll] = useState(() => {
    // 会话切换滚动位置保持：切回有锚点的会话时，初始就不跟底（不在底部）。
    // 若初始 true，MessageScroller 的 followOutput layout effect 会在恢复前滚底，
    // 造成「先滚到底再纠正」的闪跳（引擎在途动画由 restoreAt 取消，但初始值仍应正确）。
    const sessionId = options.sessionId;
    if (!sessionId) return true;
    return !store.get(sessionScrollAnchorByIdAtom)[sessionId];
  });
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  // 与 autoScroll 初始值保持一致（有锚点的会话首帧即不跟底），避免首帧 ref/state 不一致
  const autoScrollRef = useRef(autoScroll);
  const programmaticScrollRef = useRef(false);
  const scrollerScrollApiRef = useRef<MessageScrollerScrollApi | null>(null);
  const loadMoreAnchorRef = useRef<Tagged<TimelineAnchor> | undefined>(undefined);
  const pendingJumpRef = useRef<Tagged<string> | undefined>(undefined);
  const highlightTimersRef = useRef(new Map<number, number>());
  // ── 发送置顶动画（pin-to-top）──
  // 发消息后在列表尾部补一块垫片，让最新用户消息可以平滑滚动到视口顶部，
  // 此前所有消息整体被顶出屏幕；回答流式增长时垫片同步收敛，内容超过一屏后归零。
  const [pinnedTurnId, setPinnedTurnId] = useState<string | undefined>(undefined);
  const [pinSpacerHeight, setPinSpacerHeight] = useState(0);
  const [pinAnimating, setPinAnimating] = useState(false);
  // 乐观气泡下一帧才进 DOM 时，用 tick 重跑置顶 layout，不能靠同值 setState。
  const [pinRetryTick, setPinRetryTick] = useState(0);
  // ── 上滚渲染窗口（2026-08 黑屏治理）──
  // 贴底时渲染层固定用 3 轮小窗口；上滚看历史用此窗口（初始 15 轮，
  // 「显示更早」按钮逐步扩大）。回底 = 新的浏览周期，窗口重置回基础大小。
  const [scrolledWindowTurns, setScrolledWindowTurns] = useState(TIMELINE_SCROLLED_TURN_LIMIT);
  const expandWindow = useCallback(() => {
    setScrolledWindowTurns((prev) => prev + TIMELINE_WINDOW_EXPAND_STEP);
  }, []);
  useEffect(() => {
    if (autoScroll) setScrolledWindowTurns(TIMELINE_SCROLLED_TURN_LIMIT);
  }, [autoScroll]);

  const pinnedTurnIdRef = useRef<string | undefined>(undefined);
  pinnedTurnIdRef.current = pinnedTurnId;
  // 动画进行中的标记：期间抑制 ResizeObserver/MutationObserver 的即时贴底，防止打断平滑滚动
  const pinAnimatingRef = useRef(false);
  // 本轮 pin 是否需要播动画（乐观消息被权威消息换绑时只重定向、不重播）
  const pinAnimateRequestRef = useRef(false);
  const pinCancelAnimRef = useRef<(() => void) | null>(null);

  const clearHighlightTimers = useCallback(() => {
    for (const timer of highlightTimersRef.current.values()) {
      window.clearTimeout(timer);
    }
    highlightTimersRef.current.clear();
  }, []);

  const highlightMessage = useCallback((element: HTMLElement, expectedOwnerKey: string) => {
    if (ownerKeyRef.current !== expectedOwnerKey) return;
    element.classList.remove("message-jump-highlight");
    void element.offsetWidth;
    element.classList.add("message-jump-highlight");
    const timer = window.setTimeout(() => {
      highlightTimersRef.current.delete(timer);
      if (ownerKeyRef.current === expectedOwnerKey) {
        element.classList.remove("message-jump-highlight");
      }
    }, 2000);
    highlightTimersRef.current.set(timer, timer);
  }, []);

  const scrollToBottom = useCallback(() => {
    const requestOwnerKey = ownerKey;
    if (ownerKeyRef.current !== requestOwnerKey) return;
    programmaticScrollRef.current = true;
    autoScrollRef.current = true;
    setAutoScroll(true);
    setShowScrollToBottom(false);
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const animation = reduceMotion ? "instant" : "smooth";
    const api = scrollerScrollApiRef.current;
    if (api) {
      // 走 stick-to-bottom 弹簧（mergeAnimations 修好后 "smooth" = 默认弹簧）
      void api.scrollToBottom({ animation });
      return;
    }
    // 引擎尚未挂上时的兜底（会话切换首帧等）
    const timeline = timelineRef.current;
    if (!timeline) return;
    timeline.scrollTo({
      top: timeline.scrollHeight,
      behavior: reduceMotion ? "instant" : "smooth",
    });
  }, [ownerKey]);

  const setAutoScrollFromScroller = useCallback((following: boolean) => {
    // 置顶清屏动画期间引擎会因 restoreAt 报「已离开底部」；忽略这次汇报，
    // 否则会点亮回底按钮，把刚发出的「终端清屏」打成「不在最新」。
    if (pinAnimatingRef.current) return;
    autoScrollRef.current = following;
    setAutoScroll(following);
    setShowScrollToBottom(!following);
    // 清屏结束后用户上翻看历史：卸掉垫片，避免底部留一块假空白。
    if (!following && pinnedTurnIdRef.current) {
      setPinnedTurnId(undefined);
      setPinSpacerHeight(0);
    }
  }, []);

  /** 计算垫片高度：让「用户消息顶 + 视口高 == 内容总高」，滚到底时用户消息正好钉在顶部。 */
  const measurePinSpacer = useCallback((): number => {
    const timeline = timelineRef.current;
    const pinnedId = pinnedTurnIdRef.current;
    if (!timeline || !pinnedId) return 0;
    const row = timeline.querySelector(
      `[data-message-id="${CSS.escape(pinnedId)}"]`,
    ) as HTMLElement | null;
    if (!row) return 0;
    const rowTop =
      row.getBoundingClientRect().top -
      timeline.getBoundingClientRect().top +
      timeline.scrollTop;
    const spacerEl = timeline.querySelector(".timeline-pin-spacer") as HTMLElement | null;
    const currentSpacer = spacerEl?.offsetHeight ?? 0;
    const contentWithoutSpacer = timeline.scrollHeight - currentSpacer;
    return measurePinSpacerHeight({
      rowTop,
      clientHeight: timeline.clientHeight,
      contentWithoutSpacer,
    });
  }, []);

  const refreshPinSpacer = useCallback(() => {
    const next = measurePinSpacer();
    // 1px 阈值防止 ResizeObserver → setState → ResizeObserver 的收敛抖动
    setPinSpacerHeight((current) => (Math.abs(current - next) > 1 ? next : current));
    // 回答已自己撑满视口：垫片归零后卸掉锚点，后续走普通跟底
    if (next <= 1 && pinnedTurnIdRef.current && !pinAnimatingRef.current) {
      setPinnedTurnId(undefined);
    }
  }, [measurePinSpacer]);

  const pinTurnToTop = useCallback((userMessageId: string, options?: { animate?: boolean }) => {
    const animate = options?.animate ?? true;
    // 换绑只改锚点：不能把进行中的清屏请求打成 false，否则垫片落地后不会开滚。
    if (animate) {
      pinAnimateRequestRef.current = true;
      setPinRetryTick(0);
      // 必须先于 restoreAt：引擎解锁会立刻 onFollowChange(false)，标记已立才不会点亮回底按钮。
      pinAnimatingRef.current = true;
      setPinAnimating(true);
      // 必须在垫片进 DOM 前解锁：否则引擎仍 isAtBottom，RO 看到增高会瞬间贴底。
      // restoreAt 同时掐掉在途弹簧；裸 stopScroll 只改标志，下一帧弹簧仍可能写 scrollTop。
      const timeline = timelineRef.current;
      if (timeline) {
        scrollerScrollApiRef.current?.restoreAt(timeline.scrollTop);
      } else {
        scrollerScrollApiRef.current?.stopScroll();
      }
    }
    setPinnedTurnId(userMessageId);
  }, []);

  // 垫片高度与锚点同步；单独 effect，避免量高 setState 重跑时拆掉在途滚动。
  useLayoutEffect(() => {
    if (!controllerEnabled) return;
    if (!pinnedTurnId) {
      setPinSpacerHeight(0);
      return;
    }
    refreshPinSpacer();
  }, [controllerEnabled, pinnedTurnId, refreshPinSpacer]);

  // 垫片落地后开平滑置顶（终端清屏感：旧内容整页上推）
  useLayoutEffect(() => {
    if (!controllerEnabled) return;
    if (!pinnedTurnId || !pinAnimateRequestRef.current) return;
    const timeline = timelineRef.current;
    if (!timeline) return;
    // 垫片高度要等本轮 setState 提交后才进 DOM；高度还没落地就开滚会瞄错位置。
    const neededSpacer = measurePinSpacer();
    if (neededSpacer > 1) {
      const spacerEl = timeline.querySelector(".timeline-pin-spacer") as HTMLElement | null;
      if (!spacerEl || Math.abs(spacerEl.offsetHeight - neededSpacer) > 2) return;
    }
    const requestOwnerKey = ownerKey;
    const row = timeline.querySelector(
      `[data-message-id="${CSS.escape(pinnedTurnId)}"]`,
    ) as HTMLElement | null;
    // 乐观用户气泡可能下一帧才挂 data-message-id。不能清请求、更不能停动画，
    // 否则发送当下钉不上，要等到回复重绘才像「置顶」。用 rAF 等到行出现再开滚。
    if (!row) {
      // 最多等十几帧：气泡始终没挂上就放弃，避免 rAF 空转。
      if (pinRetryTick > 12) {
        pinAnimateRequestRef.current = false;
        pinAnimatingRef.current = false;
        setPinAnimating(false);
        return;
      }
      const retry = window.requestAnimationFrame(() => {
        if (!pinAnimateRequestRef.current || pinnedTurnIdRef.current !== pinnedTurnId) return;
        setPinRetryTick((tick) => tick + 1);
      });
      return () => window.cancelAnimationFrame(retry);
    }
    pinAnimateRequestRef.current = false;
    const rowTop =
      row.getBoundingClientRect().top -
      timeline.getBoundingClientRect().top +
      timeline.scrollTop;
    programmaticScrollRef.current = true;
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const targetTop = Math.max(0, rowTop - PIN_TOP_INSET_PX);
    autoScrollRef.current = true;
    setAutoScroll(true);
    setShowScrollToBottom(false);
    let cancelled = false;
    const finishPin = () => {
      pinCancelAnimRef.current = null;
      if (ownerKeyRef.current !== requestOwnerKey) {
        pinAnimatingRef.current = false;
        setPinAnimating(false);
        return;
      }
      // 必须先 scrollToBottom（同步 setIsAtBottom(true)）再放下 pinAnimating。
      // 否则跟底汇报会在「已解锁、动画已结束」这一帧把垫片卸掉。
      if (autoScrollRef.current) {
        programmaticScrollRef.current = true;
        void scrollerScrollApiRef.current?.scrollToBottom({ animation: "instant" });
      }
      pinAnimatingRef.current = false;
      setPinAnimating(false);
    };
    const cancelAnim = animateScrollTop(timeline, targetTop, {
      reduceMotion,
      isCancelled: () => cancelled || ownerKeyRef.current !== requestOwnerKey,
      onComplete: finishPin,
    });
    pinCancelAnimRef.current = () => {
      cancelled = true;
      cancelAnim();
      pinCancelAnimRef.current = null;
    };
    return () => {
      // 垫片收敛 / 乐观 id 换绑会重跑本 effect；同一会话仍在置顶时不能掐掉在途清屏。
      if (ownerKeyRef.current !== requestOwnerKey || !pinnedTurnIdRef.current) {
        pinCancelAnimRef.current?.();
      }
    };
  }, [controllerEnabled, measurePinSpacer, ownerKey, pinRetryTick, pinSpacerHeight, pinnedTurnId]);

  // 用户滚轮/触摸/键盘 = 明确接管：取消清屏并卸垫片。与开启动画拆开，避免量高重跑拆掉监听。
  useEffect(() => {
    if (!controllerEnabled || !pinAnimating) return;
    const timeline = timelineRef.current;
    if (!timeline) return;
    const cancelPinByUser = () => {
      if (!pinAnimatingRef.current) return;
      pinCancelAnimRef.current?.();
      pinAnimatingRef.current = false;
      setPinAnimating(false);
      autoScrollRef.current = false;
      setAutoScroll(false);
      setShowScrollToBottom(true);
      setPinnedTurnId(undefined);
      setPinSpacerHeight(0);
    };
    const cancelPinByKey = (event: KeyboardEvent) => {
      if (
        event.key === "ArrowUp" || event.key === "ArrowDown" ||
        event.key === "PageUp" || event.key === "PageDown" ||
        event.key === "Home" || event.key === "End"
      ) {
        cancelPinByUser();
      }
    };
    timeline.addEventListener("wheel", cancelPinByUser, { passive: true });
    timeline.addEventListener("touchmove", cancelPinByUser, { passive: true });
    timeline.addEventListener("keydown", cancelPinByKey);
    return () => {
      timeline.removeEventListener("wheel", cancelPinByUser);
      timeline.removeEventListener("touchmove", cancelPinByUser);
      timeline.removeEventListener("keydown", cancelPinByKey);
    };
  }, [controllerEnabled, pinAnimating]);

  // 流式回答增高时垫片同步收敛，避免尾部空白越攒越大
  useEffect(() => {
    if (!controllerEnabled || !pinnedTurnId) return;
    const timeline = timelineRef.current;
    if (!timeline) return;
    const content = timeline.querySelector("[role=log]");
    const observer = new ResizeObserver(() => {
      refreshPinSpacer();
    });
    observer.observe(timeline);
    if (content) observer.observe(content);
    return () => observer.disconnect();
  }, [controllerEnabled, pinnedTurnId, refreshPinSpacer]);

	const loadMoreMessages = useCallback(() => {
		const requestOwnerKey = ownerKey;
		const timeline = timelineRef.current;
    if (timeline && ownerKeyRef.current === requestOwnerKey) {
      loadMoreAnchorRef.current = {
        ownerKey: requestOwnerKey,
        value: { height: timeline.scrollHeight, top: timeline.scrollTop },
      };
    }
		if (diskPage) {
			const sessionId = options.sessionId;
			const before = diskPage.nextBefore;
			if (!sessionId || before === null || isLoadingMessagePage) return;
			const sequence = ++nextLoadSequence;
			trackLatestLoad(sessionId, sequence);
			const expectedRevision = cachedEntry?.revision ?? 0;
			setIsLoadingMessagePage(true);
			void desktopApi.sessions
				.readRecordMessagePage(sessionId, before, options.pageSize ?? 100)
				.then((page: { messages: ChatMessage[]; total: number; nextBefore: number | null }) => {
					if (latestLoadBySession.get(sessionId) !== sequence) return;
					prependMessagePage({ sessionId, before, expectedRevision, page });
				})
				.finally(() => {
					if (latestLoadBySession.get(sessionId) === sequence) setIsLoadingMessagePage(false);
				});
			return;
		}
		// runtime 窗口会话：直接按轮次补历史（2026-11 轮次模型，不再有 100 条渲染窗口）。
		// 首次加载以运行时窗口段首条消息的 entryId 为锚点（两个下标空间唯一的对齐点），
		// 续页用上一页最旧条目的 entryId（nextBeforeEntryId）——主进程缓存命中路径依赖它。
		if (historyHasMore) {
			const sessionId = options.sessionId;
			if (!sessionId || isLoadingMessagePage) return;
			const before = runtimeHistory?.nextBefore;
			// 首次补历史锚点：窗口首条可能是无 entryId 的系统摘要卡片（compaction/branchSummary），
			// 必须取第一条有 entryId 的消息，否则锚点解析失败导致首次上翻静默放弃。
			const anchorMessage = !runtimeHistory
				? messages.find((m) => typeof m.meta?.entryId === "string")
				: undefined;
			const anchorEntryId =
				typeof anchorMessage?.meta?.entryId === "string" ? anchorMessage.meta.entryId : undefined;
			// 大历史窗口（skipEntries 路径）消息可能整体缺 entryId：退化为窗口首条消息的
			// 文件消息下标（windowStartFilePos）作为数值游标——主进程缓存路径先把它解析成
			// entryId 再查缓存，磁盘路径直接消费文件下标。两者都没有才放弃补历史。
			const anchorFilePos = !runtimeHistory && !anchorEntryId
				? (typeof cachedEntry?.windowStartFilePos === "number"
					? cachedEntry.windowStartFilePos
					: undefined)
				: undefined;
			if (!runtimeHistory && !anchorEntryId && anchorFilePos === undefined) return;
			const sequence = ++nextLoadSequence;
			trackLatestLoad(sessionId, sequence);
			const expectedRevision = cachedEntry?.revision ?? 0;
			setIsLoadingMessagePage(true);
			void desktopApi.sessions
				.readRecordMessagePage(sessionId, before ?? (anchorFilePos !== undefined ? anchorFilePos : undefined), RUNTIME_HISTORY_TURN_PAGE_SIZE, {
					unit: "turn",
					beforeEntryId: anchorEntryId ?? runtimeHistory?.nextBeforeEntryId ?? undefined,
				})
				.then((page) => {
					if (latestLoadBySession.get(sessionId) !== sequence) return;
					prependHistoryPage({ sessionId, expectedRevision, before, page });
				})
				.finally(() => {
					if (latestLoadBySession.get(sessionId) === sequence) setIsLoadingMessagePage(false);
				});
			return;
		}
	}, [cachedEntry?.revision, diskPage, historyHasMore, isLoadingMessagePage, messages, options.pageSize, options.sessionId, ownerKey, prependHistoryPage, prependMessagePage, runtimeHistory]);

	// ── 回底清理临时历史（2026-11 轮次模型）──
	// 贴底稳定 1.5s 后清掉翻过的历史前缀（atom 只留运行时窗口段），渲染层内存回到最小；
	// 再次上翻走「atom → 主进程缓存 → 文件」重新拉取（主进程 12 轮内命中，无感）。
	// 上滚/加载历史中会取消待执行的清理；清理后 history 置空，后续再翻再拉。
	const clearHistory = useSetAtom(clearSessionHistoryAtom);
	const historyClearTimerRef = useRef<number | undefined>(undefined);
	useEffect(() => {
		if (!controllerEnabled) return;
		const sessionId = options.sessionId;
		if (!sessionId) return;
		if (autoScroll && runtimeHistory) {
			if (historyClearTimerRef.current != null) return;
			historyClearTimerRef.current = window.setTimeout(() => {
				historyClearTimerRef.current = undefined;
				if (clearHistory(sessionId)) {
					// 清理后丢弃在途历史页响应：迟到页会把已释放的 history 复活并携带旧滚动锚点
					const sequence = ++nextLoadSequence;
					trackLatestLoad(sessionId, sequence);
					setIsLoadingMessagePage(false);
				}
			}, 1500);
			return () => {
				if (historyClearTimerRef.current != null) {
					window.clearTimeout(historyClearTimerRef.current);
					historyClearTimerRef.current = undefined;
				}
			};
		}
		// 上滚看历史 / 无历史可清：取消待执行清理
		if (historyClearTimerRef.current != null) {
			window.clearTimeout(historyClearTimerRef.current);
			historyClearTimerRef.current = undefined;
		}
	}, [autoScroll, clearHistory, controllerEnabled, options.sessionId, runtimeHistory]);

  /** 标记一次程序化滚动（turn 窗口展开补偿等组件内补偿用），抑制自动加载监听。 */
  const markProgrammaticScroll = useCallback(() => {
    programmaticScrollRef.current = true;
  }, []);

  const jumpToMessage = useCallback((messageId: string) => {
    const requestOwnerKey = ownerKey;
    const timeline = timelineRef.current;
    if (!timeline || ownerKeyRef.current !== requestOwnerKey) return;
    const existing = timeline.querySelector(
      `[data-message-id="${CSS.escape(messageId)}"]`,
    ) as HTMLElement | null;
    if (existing) {
      existing.scrollIntoView({ behavior: "smooth", block: "start" });
      highlightMessage(existing, requestOwnerKey);
      return;
    }
    const index = combinedMessages.findIndex((message) => message.id === messageId);
    if (index < 0) return;
    // 目标可能在贴底 turn 窗口外：先取消跟随以展开挂载，再等布局后滚动。
    // （2026-11 轮次模型：数据全量在 atom，无需再扩展渲染窗口。）
    autoScrollRef.current = false;
    setAutoScroll(false);
    setShowScrollToBottom(true);
    pendingJumpRef.current = { ownerKey: requestOwnerKey, value: messageId };
  }, [highlightMessage, combinedMessages, ownerKey]);

  useEffect(() => {
    loadMoreAnchorRef.current = undefined;
    pendingJumpRef.current = undefined;
    programmaticScrollRef.current = false;
    // 会话切换：清掉上一会话的置顶垫片与动画标记
    pinAnimatingRef.current = false;
    setPinAnimating(false);
    pinAnimateRequestRef.current = false;
    setPinnedTurnId(undefined);
    setPinSpacerHeight(0);
    clearHighlightTimers();
    return clearHighlightTimers;
  }, [clearHighlightTimers, ownerKey]);

  // 切走落盘：cleanup 把滚动时已算好的 ref 锚点写入 atom，不读 DOM
  // （会话切换复用同一组件实例，cleanup 时 timeline children 可能已是新会话）。
  // 在底部跟流时 ref 为 null → 清除锚点，切回继续跟底。
  useLayoutEffect(() => {
    const sessionId = ownerKey;
    return () => {
      if (scrollAnchorFrameRef.current != null) {
        cancelAnimationFrame(scrollAnchorFrameRef.current);
        scrollAnchorFrameRef.current = undefined;
      }
      if (scrollSaveTimerRef.current != null) {
        window.clearTimeout(scrollSaveTimerRef.current);
        scrollSaveTimerRef.current = undefined;
      }
      if (sessionId && sessionId !== LEGACY_OWNER_KEY) {
        saveScrollAnchor({ sessionId, anchor: currentAnchorRef.current });
      }
      currentAnchorRef.current = null;
    };
  }, [ownerKey, saveScrollAnchor]);

  useEffect(() => {
    if (!controllerEnabled) return;
    // 切换时从 atom 读一次快照（不订阅：恢复后滚动写 atom 不应打扰已恢复的视口）。
    const sessionId = options.sessionId;
    const anchor = sessionId
      ? store.get(sessionScrollAnchorByIdAtom)[sessionId]
      : undefined;
    if (anchor) {
      // 恢复历史查看位置：数据全量在 atom（2026-11 轮次模型无分页窗口），
      // 直接把视口对齐到锚点行；期间禁止自动跟底，新消息到达不拽走用户，
      // 只让「回到底部」按钮保持亮起（stay 语义）。
      autoScrollRef.current = false;
      setAutoScroll(false);
      setShowScrollToBottom(true);
      const requestOwnerKey = ownerKey;
      const frame = requestAnimationFrame(() => {
        const timeline = timelineRef.current;
        if (!timeline || ownerKeyRef.current !== requestOwnerKey) return;
        const el = timeline.querySelector(
          `[data-message-id="${CSS.escape(anchor.messageId)}"]`,
        ) as HTMLElement | null;
        if (el) {
          const elTop =
            el.getBoundingClientRect().top -
            timeline.getBoundingClientRect().top +
            timeline.scrollTop;
          programmaticScrollRef.current = true;
          // 原子恢复：定位 + 解锁锁底 + 取消在途动画一次完成。
          // busy 会话的 ResizeObserver（instant 贴底）看到 isAtBottom=false 不再拽回。
          const api = scrollerScrollApiRef.current;
          const targetTop = Math.max(0, elTop - anchor.offsetTop);
          if (api?.restoreAt) {
            api.restoreAt(targetTop);
          } else {
            // 引擎未挂上（会话切换首帧等）时回退原生定位
            timeline.scrollTop = targetTop;
          }
          // 恢复后的位置即当前锚点：即使恢复后用户未滚动就切走，
          // cleanup 落盘的也是这份锚点（而不是误判为底部/空）。
          currentAnchorRef.current = anchor;
          return;
        }
        // 锚点行不存在（期间被压缩清理 / 在渲染窗口之外——上滚窗口化裁剪）：
        // 对齐渲染窗口顶部（顶部有「显示更早」按钮可继续上溯），保持不跟流，
        // 避免把查看历史的用户拽回底部（2026-08 黑屏治理）。
        autoScrollRef.current = false;
        setAutoScroll(false);
        setShowScrollToBottom(true);
        programmaticScrollRef.current = true;
        timeline.scrollTop = 0;
      });
      return () => cancelAnimationFrame(frame);
    }
    // 无锚点（切走时在底部或从未保存）：默认滚到底、恢复跟底
    autoScrollRef.current = true;
    setAutoScroll(true);
    setShowScrollToBottom(false);
    const requestOwnerKey = ownerKey;
    const frame = requestAnimationFrame(() => {
      const timeline = timelineRef.current;
      if (!timeline || ownerKeyRef.current !== requestOwnerKey) return;
      programmaticScrollRef.current = true;
      timeline.scrollTo({ top: timeline.scrollHeight, behavior: "instant" });
    });
    return () => cancelAnimationFrame(frame);
  }, [controllerEnabled, ownerKey]);


  // ── 滚动接近顶部自动加载历史（2026-11 轮次模型）──
  // 监听器原挂在 SessionMessageTimeline，迁移到 controller（滚动策略单一 owner）：
  // 程序化滚动（prepend 补偿/贴底/恢复锚点/跳转）同样会派发 scroll 事件，
  // 若补偿后 scrollTop ≤ 阈值会连锁加载下一页；programmaticScrollRef 抑制此类事件，
  // 只响应用户真实滚动（滚到顶才翻一页，停在顶部不动不连翻）。
  const lastHistoryLoadAtRef = useRef(0);
  useEffect(() => {
    if (!controllerEnabled) return;
    const timeline = timelineRef.current;
    if (!timeline) return;
    const hasMore = diskPage ? diskPage.nextBefore !== null : historyHasMore;
    const onScroll = () => {
      if (programmaticScrollRef.current) {
        programmaticScrollRef.current = false;
        return;
      }
      if (!hasMore || isLoadingMessagePage) return;
      if (timeline.scrollTop > HISTORY_AUTO_LOAD_THRESHOLD) return;
      // 冷却：prepend 补偿会推高 scrollTop，但惯性滚动仍可能停在顶部连续触发——
      // 300ms 内只翻一页，保证「滑到顶 → 翻一页 → 看完再滑」的节奏。
      const now = Date.now();
      if (now - lastHistoryLoadAtRef.current < HISTORY_AUTO_LOAD_COOLDOWN_MS) return;
      lastHistoryLoadAtRef.current = now;
      loadMoreMessages();
    };
    timeline.addEventListener("scroll", onScroll, { passive: true });
    return () => timeline.removeEventListener("scroll", onScroll);
  }, [controllerEnabled, diskPage, historyHasMore, isLoadingMessagePage, loadMoreMessages, timelineRef]);

  useLayoutEffect(() => {
    if (!controllerEnabled) return;
    const anchor = loadMoreAnchorRef.current;
    const timeline = timelineRef.current;
    if (!anchor || !timeline || !matchesTimelineOwner(anchor.ownerKey, ownerKey)) return;
    // 跟底中（autoScrollRef=true）：贴底引擎负责生长补偿，这里恢复会把用户拽回旧位置
    if (autoScrollRef.current) {
      loadMoreAnchorRef.current = undefined;
      return;
    }
    // 标记程序化滚动：prepend 补偿的 scrollTop 赋值会触发 scroll 事件，
    // 不能让 ≤240px 自动加载监听把它当成用户上滚（否则连锁翻页）。
    // rAF 兜底：若补偿实际无位移（delta=0）不产生 scroll 事件，需清掉抑制标记，
    // 避免吞掉下一次用户滚动（scroll 事件任务先于 rAF 派发，顺序安全）。
    programmaticScrollRef.current = true;
    timeline.scrollTop = restoreTimelineAnchor(
      anchor.value.top,
      timeline.scrollHeight - anchor.value.height,
    );
    loadMoreAnchorRef.current = undefined;
    const frame = requestAnimationFrame(() => {
      programmaticScrollRef.current = false;
    });
    return () => cancelAnimationFrame(frame);
  }, [controllerEnabled, ownerKey, visibleMessages.length]);

  useEffect(() => {
    if (!controllerEnabled) return;
    const pendingJump = pendingJumpRef.current;
    const timeline = timelineRef.current;
    if (!pendingJump || !timeline || !matchesTimelineOwner(pendingJump.ownerKey, ownerKey)) return;
    const element = timeline.querySelector(
      `[data-message-id="${CSS.escape(pendingJump.value)}"]`,
    ) as HTMLElement | null;
    if (!element) {
      // 目标在渲染窗口之外（上滚窗口化）：逐步扩大窗口，本 effect 随窗口变化重跑
      // 直到目标挂载；目标已不在数据中（期间被压缩清理/删除）则放弃跳转，
      // 避免窗口无限放大（防呆，2026-08 黑屏治理）。
      const stillInData = combinedMessages.some((message) => message.id === pendingJump.value);
      if (!stillInData) {
        pendingJumpRef.current = undefined;
        return;
      }
      expandWindow();
      return;
    }
    pendingJumpRef.current = undefined;
    element.scrollIntoView({ behavior: "smooth", block: "start" });
    highlightMessage(element, ownerKey);
    // autoScroll：贴底 turn 窗口展开后 DOM 才出现目标行，需再跑一轮。
  }, [autoScroll, combinedMessages, controllerEnabled, expandWindow, highlightMessage, ownerKey, scrolledWindowTurns, visibleMessages.length]);

  return {
    timelineRef,
    messages,
    visibleMessages: diskPage ? messages : visibleMessages,
    totalMessageCount: diskPage ? diskPage.total : combinedMessages.length,
    hasMoreMessages: diskPage ? diskPage.nextBefore !== null : historyHasMore,
    // 下一次「加载更多」是否触发 disk 轮次分页（窗口前还有历史）：
    // 2026-11 轮次模型：runtime 会话一律按轮补页（无内存扩窗阶段），文案恒为「加载更多对话」
    nextLoadIsHistory: controllerEnabled && !diskPage && historyHasMore,
    isLoadingMoreMessages: diskPage || historyHasMore ? isLoadingMessagePage : false,
    loadMoreMessages,
    markProgrammaticScroll,
    jumpToMessage,
    scrollToBottom,
    /** 滚动回调：维护会话切换用的滚动锚点（rAF 合并，不触发渲染） */
    handleTimelineScroll,
    autoScroll,
    showScrollToBottom,
    pinAnimating,
    setAutoScrollFromScroller,
    scrollerScrollApiRef,
    pinnedTurnId,
    pinSpacerHeight,
    pinTurnToTop,
    scrolledWindowTurns,
    expandWindow,
  };
}
