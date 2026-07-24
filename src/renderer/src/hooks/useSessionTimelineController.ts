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
import type { AgentRuntimeState, ChatMessage } from "../../../shared/types";
import {
  cacheSessionMessagesAtom,
  sessionMessageLoadStateAtom,
  sessionMessagesCacheAtom,
  setSessionMessageLoadStateAtom,
  touchSessionMessagesAtom,
} from "../atoms";
import { useMessagePagination } from "./useMessagePagination";

let nextLoadSequence = 0;
const latestLoadBySession = new Map<string, number>();

const BOTTOM_THRESHOLD = 100;
const LEGACY_OWNER_KEY = "legacy";

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

export function selectSessionModeValue<T>(
  sessionMode: boolean,
  sessionValue: T,
  legacyValue: T,
): T {
  return sessionMode ? sessionValue : legacyValue;
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
  hasMoreMessages: boolean;
  isLoadingMoreMessages: boolean;
  loadMoreMessages: () => void;
  jumpToMessage: (messageId: string) => void;
  scrollToBottom: () => void;
  autoScroll: boolean;
  showScrollToBottom: boolean;
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
  const cacheMessages = useSetAtom(cacheSessionMessagesAtom);
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

    void (window as any).piDesktop.sessions
      .readRecordMessages(sessionId)
      .then((diskMessages: ChatMessage[]) => {
        if (latestLoadBySession.get(sessionId) !== sequence) return;
        cacheMessages({
          sessionId,
          messages: diskMessages,
          source: "disk",
          expectedRevision,
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

  const pagination = useMessagePagination({
    messages,
    ownerKey,
    initialPageSize: options.initialPageSize ?? 100,
    pageSize: options.pageSize ?? 100,
    enabled: controllerEnabled && messages.length > 100,
  });
  const [autoScroll, setAutoScroll] = useState(true);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const autoScrollRef = useRef(true);
  const programmaticScrollRef = useRef(false);
  const loadMoreAnchorRef = useRef<Tagged<TimelineAnchor> | undefined>(undefined);
  const pendingJumpRef = useRef<Tagged<string> | undefined>(undefined);
  const highlightTimersRef = useRef(new Map<number, number>());

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

  const loadMoreMessages = useCallback(() => {
    const requestOwnerKey = ownerKey;
    const timeline = timelineRef.current;
    if (timeline && ownerKeyRef.current === requestOwnerKey) {
      loadMoreAnchorRef.current = {
        ownerKey: requestOwnerKey,
        value: { height: timeline.scrollHeight, top: timeline.scrollTop },
      };
    }
    pagination.loadMore();
  }, [ownerKey, pagination]);

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
    const index = messages.findIndex((message) => message.id === messageId);
    if (index < 0) return;
    pendingJumpRef.current = { ownerKey: requestOwnerKey, value: messageId };
    pagination.loadUntilIncluded(index);
  }, [highlightMessage, messages, ownerKey, pagination]);

  useEffect(() => {
    loadMoreAnchorRef.current = undefined;
    pendingJumpRef.current = undefined;
    programmaticScrollRef.current = false;
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

  useEffect(() => {
    if (!controllerEnabled) return;
    const timeline = timelineRef.current;
    if (!timeline) return;
    const onScroll = () => {
      const atBottom = isTimelineAtBottom(
        timeline.scrollTop,
        timeline.scrollHeight,
        timeline.clientHeight,
      );
      if (programmaticScrollRef.current) {
        programmaticScrollRef.current = false;
        if (atBottom) {
          autoScrollRef.current = true;
          setAutoScroll(true);
          setShowScrollToBottom(false);
        }
        return;
      }
      autoScrollRef.current = atBottom;
      setAutoScroll(atBottom);
      setShowScrollToBottom(!atBottom);
    };
    timeline.addEventListener("scroll", onScroll);
    onScroll();
    return () => timeline.removeEventListener("scroll", onScroll);
  }, [controllerEnabled, ownerKey]);

  useEffect(() => {
    if (!controllerEnabled) return;
    const timeline = timelineRef.current;
    const list = timeline?.querySelector(".message-list");
    if (!timeline || !list) return;
    const requestOwnerKey = ownerKey;
    const stickToBottom = () => {
      if (!autoScrollRef.current || ownerKeyRef.current !== requestOwnerKey) return;
      programmaticScrollRef.current = true;
      timeline.scrollTo({ top: timeline.scrollHeight, behavior: "instant" });
    };
    const resizeObserver = new ResizeObserver(stickToBottom);
    const mutationObserver = new MutationObserver(stickToBottom);
    resizeObserver.observe(list);
    mutationObserver.observe(list, { childList: true, subtree: true });
    stickToBottom();
    return () => {
      resizeObserver.disconnect();
      mutationObserver.disconnect();
    };
  }, [autoScroll, controllerEnabled, ownerKey, pagination.visibleMessages.length]);

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
    visibleMessages: pagination.visibleMessages,
    hasMoreMessages: pagination.hasMore,
    isLoadingMoreMessages: pagination.isLoading,
    loadMoreMessages,
    jumpToMessage,
    scrollToBottom,
    autoScroll,
    showScrollToBottom,
  };
}
