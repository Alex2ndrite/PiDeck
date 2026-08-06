import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import { useAtomValue, useSetAtom } from "jotai";
import { selectAtom } from "jotai/utils";
import { desktopApi } from "../desktopApi";
import type { AgentRuntimeState, ChatMessage } from "../../../shared/types";
import {
	cacheSessionMessagesAtom,
	prependSessionHistoryPageAtom,
	prependSessionMessagePageAtom,
  sessionMessageLoadStateAtom,
  sessionMessagesCacheAtom,
  setSessionMessageLoadStateAtom,
  touchSessionMessagesAtom,
} from "../atoms";
import { useMessagePagination } from "./useMessagePagination";

let nextLoadSequence = 0;
const latestLoadBySession = new Map<string, number>();

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
  autoScroll: boolean;
  showScrollToBottom: boolean;
  /** pin-to-top 动画期间冻结 MessageScroller 的流式跟随，避免高度变化打断动画。 */
  pinAnimating: boolean;
  /** 由 MessageScroller 汇报用户是否仍在实时尾部，避免两套滚动监听互相抢占。 */
  setAutoScrollFromScroller: (following: boolean) => void;
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

  // ── Load messages from disk when sessionId changes ──
	const cacheEntry = useAtomValue(sessionMessagesCacheAtom);
	const cachedEntry = options.sessionId ? cacheEntry[options.sessionId] : undefined;
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

    const entry = cacheEntry[sessionId];
    const sequence = ++nextLoadSequence;
    latestLoadBySession.set(sessionId, sequence);
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
	const [isLoadingMessagePage, setIsLoadingMessagePage] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const autoScrollRef = useRef(true);
  const programmaticScrollRef = useRef(false);
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
    const timeline = timelineRef.current;
    if (!timeline || ownerKeyRef.current !== requestOwnerKey) return;
    programmaticScrollRef.current = true;
    timeline.scrollTo({ top: timeline.scrollHeight, behavior: "smooth" });
    autoScrollRef.current = true;
    setAutoScroll(true);
    setShowScrollToBottom(false);
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
			latestLoadBySession.set(sessionId, sequence);
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
			const anchorMeta = !runtimeHistory ? messages[0]?.meta?.entryId : undefined;
			const anchorEntryId = typeof anchorMeta === "string" && anchorMeta ? anchorMeta : undefined;
			if (!runtimeHistory && !anchorEntryId) return; // 无 entryId 无法对齐，放弃补历史
			const sequence = ++nextLoadSequence;
			latestLoadBySession.set(sessionId, sequence);
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

  useEffect(() => {
    if (!controllerEnabled) return;
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
    autoScroll,
    showScrollToBottom,
    pinAnimating,
    setAutoScrollFromScroller,
    pinnedTurnId,
    pinSpacerHeight,
    pinTurnToTop,
  };
}
