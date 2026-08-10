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
import { useMessagePagination } from "./useMessagePagination";
import type { MessageScrollerScrollApi } from "../components/agents/message-scroller";

let nextLoadSequence = 0;
/** 会话加载请求序号（防迟到响应串台）。键按 sessionId 累积，LRU 裁剪防无界增长（2026-10）。 */
const latestLoadBySession = new Map<string, number>();
const LATEST_LOAD_LRU_LIMIT = 20;
function trackLatestLoad(sessionId: string, sequence: number) {
	trackLatestLoad(sessionId, sequence);
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

export function deriveSessionSurfaceRuntime(
  messageCount: number,
  messageLoadStatus: string | undefined,
  sendStatus: string | undefined,
  runtimeStatus: string | undefined,
  runtimeState: AgentRuntimeState | undefined,
) {
  const activating = sendStatus === "activating";
  const status = activating ? "starting" : runtimeStatus;
  return {
    status,
    isLoading: messageCount === 0 && (messageLoadStatus === "loading" || activating),
    isStarting: status === "starting",
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
  jumpToMessage: (messageId: string) => void;
  scrollToBottom: () => void;
  /**
   * 自动收起执行过程后：若用户仍在跟随，把视口对准该 run 最终回答开头。
   * 不打断已上滚阅读历史的用户。
   */
  scrollFinalAnswerIntoView: (runId: string) => void;
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
  const paginationVisibleCountRef = useRef(0);

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
          visibleCount: paginationVisibleCountRef.current,
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

  useEffect(() => {
    const sessionId = options.sessionId;
    if (!sessionId) return;
    // Already loaded this session.
    if (lastLoadedSessionRef.current === sessionId) return;
    lastLoadedSessionRef.current = sessionId;

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
  }, [options.sessionId]);

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
	const pagination = useMessagePagination({
    messages: combinedMessages,
    ownerKey,
    initialPageSize: options.initialPageSize ?? 100,
    pageSize: options.pageSize ?? 100,
		enabled: controllerEnabled && !diskPage && combinedMessages.length > 100,
	});
	// 同步分页窗口到 ref（computeCurrentAnchor 在滚动回调里读，避免依赖闭包重建）
	paginationVisibleCountRef.current = pagination.visibleCount;
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
  const pinnedTurnIdRef = useRef<string | undefined>(undefined);
  pinnedTurnIdRef.current = pinnedTurnId;
  // 动画进行中的标记：期间抑制 ResizeObserver/MutationObserver 的即时贴底，防止打断平滑滚动
  const pinAnimatingRef = useRef(false);
  // 本轮 pin 是否需要播动画（乐观消息被权威消息换绑时只重定向、不重播）
  const pinAnimateRequestRef = useRef(false);

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

  /**
   * 自动收起执行过程后，把最终回答开头放到视口中上部（约 35% 处），方便阅读。
   * 仅当用户仍在跟随时执行；已上滚看历史则不拽回。
   * 禁止贴顶（rowTop-20）：短会话里贴顶等于整页滚回最上，体感像「发送后又飞上天」。
   * 若已有更新一轮的最终回答，也不要拽回旧回答。
   * 注：引擎暂无任意 offset 弹簧 API，此处用浏览器 smooth；回底按钮仍走弹簧。
   */
  const scrollFinalAnswerIntoView = useCallback((runId: string) => {
    if (!autoScrollRef.current) return;
    const requestOwnerKey = ownerKey;
    const timeline = timelineRef.current;
    if (!timeline || ownerKeyRef.current !== requestOwnerKey) return;
    const finals = timeline.querySelectorAll<HTMLElement>("[data-final-answer]");
    const last = finals[finals.length - 1];
    // 只对准时间线上最后一条最终回答；旧轮定时器迟到时直接忽略
    if (!last || last.getAttribute("data-final-answer") !== runId) return;

    // 先解除跟随，避免 stick 在负增高后锁底，把视口钉在回答末尾
    autoScrollRef.current = false;
    setAutoScroll(false);
    setShowScrollToBottom(true);

    const rowTop =
      last.getBoundingClientRect().top -
      timeline.getBoundingClientRect().top +
      timeline.scrollTop;
    // 最终回答开头落在视口中上部（约 35%），不要贴顶也不要贴底
    const viewportAnchor = Math.round(timeline.clientHeight * 0.35);
    const targetTop = Math.max(0, rowTop - viewportAnchor);
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    programmaticScrollRef.current = true;
    timeline.scrollTo({
      top: targetTop,
      behavior: reduceMotion ? "instant" : "smooth",
    });
  }, [ownerKey]);

  const setAutoScrollFromScroller = useCallback((following: boolean) => {
    autoScrollRef.current = following;
    setAutoScroll(following);
    setShowScrollToBottom(!following);
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
    return Math.max(0, Math.round(rowTop + timeline.clientHeight - contentWithoutSpacer));
  }, []);

  const refreshPinSpacer = useCallback(() => {
    const next = measurePinSpacer();
    // 1px 阈值防止 ResizeObserver → setState → ResizeObserver 的收敛抖动
    setPinSpacerHeight((current) => (Math.abs(current - next) > 1 ? next : current));
  }, [measurePinSpacer]);

  const pinTurnToTop = useCallback((userMessageId: string, options?: { animate?: boolean }) => {
    const animate = options?.animate ?? true;
    pinAnimateRequestRef.current = animate;
    // 先立动画标记再渲染垫片：垫片插入触发的 MutationObserver 不会打断平滑滚动
    if (animate) {
      pinAnimatingRef.current = true;
      setPinAnimating(true);
    } else {
      pinAnimatingRef.current = false;
      setPinAnimating(false);
    }
    setPinnedTurnId(userMessageId);
  }, []);

  // 垫片渲染后量高并执行平滑置顶滚动
  useLayoutEffect(() => {
    if (!controllerEnabled) return;
    if (!pinnedTurnId) {
      setPinSpacerHeight(0);
      return;
    }
    const timeline = timelineRef.current;
    if (!timeline) return;
    refreshPinSpacer();
    if (!pinAnimateRequestRef.current) return;
    pinAnimateRequestRef.current = false;
    const requestOwnerKey = ownerKey;
    const row = timeline.querySelector(
      `[data-message-id="${CSS.escape(pinnedTurnId)}"]`,
    ) as HTMLElement | null;
    if (!row) {
      pinAnimatingRef.current = false;
      setPinAnimating(false);
      return;
    }
    const rowTop =
      row.getBoundingClientRect().top -
      timeline.getBoundingClientRect().top +
      timeline.scrollTop;
    programmaticScrollRef.current = true;
    // prefers-reduced-motion 用户退化为即时定位，不播长距离滚动动画
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    // 留出顶部安全内边距，避免消息文本贴住或越过时间线的可视上沿。
    const targetTop = Math.max(0, rowTop - 20);
    timeline.scrollTo({ top: targetTop, behavior: reduceMotion ? "instant" : "smooth" });
    autoScrollRef.current = true;
    setAutoScroll(true);
    setShowScrollToBottom(false);
    // 用户滚轮/触摸/键盘 = 明确接管滚动：取消动画保护与自动跟随。
    // 程序化 smooth 滚动不产生 wheel/touchmove/keydown 事件，该信号天然区分用户与程序。
    // 若缺少此中断：用户在 650ms 动画窗口内的上滚判定会被 pinAnimatingRef 吞掉
    // （onScroll 直接 return），随后 timer 到点按 autoScroll=true 贴底，把用户压回底部。
    const cancelPinByUser = () => {
      if (!pinAnimatingRef.current) return;
      pinAnimatingRef.current = false;
      setPinAnimating(false);
      autoScrollRef.current = false;
      setAutoScroll(false);
      setShowScrollToBottom(true);
    };
    const cancelPinByKey = (event: KeyboardEvent) => {
      // 仅滚动类按键视为接管；Tab/Enter 等焦点导航不打断动画
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
    const timer = window.setTimeout(() => {
      pinAnimatingRef.current = false;
      setPinAnimating(false);
      if (ownerKeyRef.current !== requestOwnerKey) return;
      // 动画期间流入的回答内容补一次即时贴底，恢复正常跟随；
      // 若用户已在动画窗口内接管滚动（cancelPinByUser），autoScrollRef=false，此处自动放弃贴底。
      if (autoScrollRef.current) {
        programmaticScrollRef.current = true;
        timeline.scrollTo({ top: timeline.scrollHeight, behavior: "instant" });
      }
      // spacer 只服务于发送后的顶屏过渡；动画完成后必须移除，否则回答结束后
      // 会在时间线尾部留下大片空白，并让滚动条继续延伸到无内容区域。
      setPinnedTurnId(undefined);
      setPinSpacerHeight(0);
    }, 650);
    return () => {
      window.clearTimeout(timer);
      timeline.removeEventListener("wheel", cancelPinByUser);
      timeline.removeEventListener("touchmove", cancelPinByUser);
      timeline.removeEventListener("keydown", cancelPinByKey);
    };
  }, [controllerEnabled, ownerKey, pinnedTurnId, refreshPinSpacer]);

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
		// runtime 窗口会话：先耗尽内存渲染窗口，再按轮次从 disk 补历史（2026-08 激活分页）。
		// 首次加载以运行时窗口段首条消息的 entryId 为锚点（两个下标空间唯一的对齐点），
		// 续页用 disk 绝对游标 nextBefore。
		if (pagination.hasMore) {
			pagination.loadMore();
			return;
		}
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
			if (!runtimeHistory && !anchorEntryId) return; // 无 entryId 无法对齐，放弃补历史
			const sequence = ++nextLoadSequence;
			trackLatestLoad(sessionId, sequence);
			const expectedRevision = cachedEntry?.revision ?? 0;
			setIsLoadingMessagePage(true);
			void desktopApi.sessions
				.readRecordMessagePage(sessionId, before ?? undefined, RUNTIME_HISTORY_TURN_PAGE_SIZE, {
					unit: "turn",
					beforeEntryId: anchorEntryId,
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
		pagination.loadMore();
	}, [cachedEntry?.revision, diskPage, historyHasMore, isLoadingMessagePage, messages, options.pageSize, options.sessionId, ownerKey, pagination, prependHistoryPage, prependMessagePage, runtimeHistory]);

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
    pendingJumpRef.current = { ownerKey: requestOwnerKey, value: messageId };
    pagination.loadUntilIncluded(index);
  }, [highlightMessage, combinedMessages, ownerKey, pagination]);

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
      // 恢复历史查看位置：先展开分页窗口（保证锚点行在窗口内），
      // 再把视口对齐到锚点行；期间禁止自动跟底，新消息到达不拽走用户，
      // 只让「回到底部」按钮保持亮起（stay 语义）。
      if (paginationVisibleCountRef.current < anchor.visibleCount) {
        pagination.setVisibleCount(anchor.visibleCount);
      }
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
        // 锚点行不存在（期间被压缩清理 / 窗口被新消息挤掉）：回到底部并恢复跟流
        autoScrollRef.current = true;
        setAutoScroll(true);
        setShowScrollToBottom(false);
        programmaticScrollRef.current = true;
        timeline.scrollTo({ top: timeline.scrollHeight, behavior: "instant" });
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
  }, [controllerEnabled, ownerKey, pagination.setVisibleCount]);


  useLayoutEffect(() => {
    if (!controllerEnabled) return;
    const anchor = loadMoreAnchorRef.current;
    const timeline = timelineRef.current;
    if (!anchor || !timeline || !matchesTimelineOwner(anchor.ownerKey, ownerKey)) return;
    timeline.scrollTop = restoreTimelineAnchor(
      anchor.value.top,
      timeline.scrollHeight - anchor.value.height,
    );
    loadMoreAnchorRef.current = undefined;
  }, [controllerEnabled, ownerKey, pagination.visibleMessages.length]);

  useEffect(() => {
    if (!controllerEnabled) return;
    const pendingJump = pendingJumpRef.current;
    const timeline = timelineRef.current;
    if (!pendingJump || !timeline || !matchesTimelineOwner(pendingJump.ownerKey, ownerKey)) return;
    const element = timeline.querySelector(
      `[data-message-id="${CSS.escape(pendingJump.value)}"]`,
    ) as HTMLElement | null;
    if (!element) return;
    pendingJumpRef.current = undefined;
    element.scrollIntoView({ behavior: "smooth", block: "start" });
    highlightMessage(element, ownerKey);
  }, [controllerEnabled, highlightMessage, ownerKey, pagination.visibleMessages.length]);

  return {
    timelineRef,
    messages,
    visibleMessages: diskPage ? messages : pagination.visibleMessages,
    totalMessageCount: diskPage ? diskPage.total : combinedMessages.length,
    hasMoreMessages: diskPage ? diskPage.nextBefore !== null : (pagination.hasMore || historyHasMore),
    // 下一次「加载更多」是否触发 disk 轮次分页（渲染窗口已耗尽且窗口前还有历史）：
    // 供 UI 切换文案——内存扩窗按消息数，disk 补页按对话轮次
    nextLoadIsHistory: controllerEnabled && !diskPage && !pagination.hasMore && historyHasMore,
    isLoadingMoreMessages: diskPage || historyHasMore ? isLoadingMessagePage : pagination.isLoading,
    loadMoreMessages,
    jumpToMessage,
    scrollToBottom,
    scrollFinalAnswerIntoView,
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
  };
}
