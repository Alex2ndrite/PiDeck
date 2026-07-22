import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import { useAtomValue } from "jotai";
import { selectAtom } from "jotai/utils";
import type { ChatMessage } from "../../../shared/types";
import { sessionMessagesCacheAtom } from "../atoms";
import { useMessagePagination } from "./useMessagePagination";

const BOTTOM_THRESHOLD = 100;

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

type TimelineAnchor = { height: number; top: number };

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
  const timelineRef = useRef<HTMLElement | null>(null);
  const cacheSliceAtom = useMemo(
    () => selectAtom(
      sessionMessagesCacheAtom,
      (cache) => options.sessionId ? cache[options.sessionId]?.messages : undefined,
      Object.is,
    ),
    [options.sessionId],
  );
  // selectAtom keeps unrelated Session runtime events from invalidating this timeline.
  const cachedMessages = useAtomValue(cacheSliceAtom);
  const messages = options.messages ?? cachedMessages ?? [];
  const controllerEnabled = options.sessionId !== undefined && options.messages === undefined;
  const pagination = useMessagePagination({
    messages,
    initialPageSize: options.initialPageSize ?? 100,
    pageSize: options.pageSize ?? 100,
    enabled: controllerEnabled && messages.length > 100,
  });
  const [autoScroll, setAutoScroll] = useState(true);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const autoScrollRef = useRef(true);
  const programmaticScrollRef = useRef(false);
  const loadMoreAnchorRef = useRef<TimelineAnchor | undefined>(undefined);
  const pendingJumpIdRef = useRef<string | undefined>(undefined);

  const scrollToBottom = useCallback(() => {
    const timeline = timelineRef.current;
    if (!timeline) return;
    programmaticScrollRef.current = true;
    timeline.scrollTo({ top: timeline.scrollHeight, behavior: "smooth" });
    autoScrollRef.current = true;
    setAutoScroll(true);
    setShowScrollToBottom(false);
  }, []);

  const loadMoreMessages = useCallback(() => {
    const timeline = timelineRef.current;
    if (timeline) {
      loadMoreAnchorRef.current = {
        height: timeline.scrollHeight,
        top: timeline.scrollTop,
      };
    }
    pagination.loadMore();
  }, [pagination]);

  const jumpToMessage = useCallback((messageId: string) => {
    const existing = document.querySelector(
      `[data-message-id="${CSS.escape(messageId)}"]`,
    ) as HTMLElement | null;
    if (existing) {
      existing.scrollIntoView({ behavior: "smooth", block: "start" });
      existing.classList.remove("message-jump-highlight");
      void existing.offsetWidth;
      existing.classList.add("message-jump-highlight");
      window.setTimeout(() => existing.classList.remove("message-jump-highlight"), 2000);
      return;
    }
    const index = messages.findIndex((message) => message.id === messageId);
    if (index < 0) return;
    pendingJumpIdRef.current = messageId;
    pagination.loadUntilIncluded(index);
  }, [messages, pagination]);

  useEffect(() => {
    if (!controllerEnabled) return;
    autoScrollRef.current = true;
    setAutoScroll(true);
    setShowScrollToBottom(false);
    const frame = requestAnimationFrame(() => {
      const timeline = timelineRef.current;
      if (!timeline) return;
      programmaticScrollRef.current = true;
      timeline.scrollTo({ top: timeline.scrollHeight, behavior: "instant" });
    });
    return () => cancelAnimationFrame(frame);
  }, [controllerEnabled, options.sessionId]);

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
  }, [controllerEnabled, options.sessionId]);

  useEffect(() => {
    if (!controllerEnabled) return;
    const timeline = timelineRef.current;
    const list = timeline?.querySelector(".message-list");
    if (!timeline || !list) return;
    const stickToBottom = () => {
      if (!autoScrollRef.current) return;
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
  }, [autoScroll, controllerEnabled, options.sessionId, pagination.visibleMessages.length]);

  useLayoutEffect(() => {
    if (!controllerEnabled) return;
    const anchor = loadMoreAnchorRef.current;
    const timeline = timelineRef.current;
    if (!anchor || !timeline) return;
    timeline.scrollTop = restoreTimelineAnchor(
      anchor.top,
      timeline.scrollHeight - anchor.height,
    );
    loadMoreAnchorRef.current = undefined;
  }, [controllerEnabled, pagination.visibleMessages.length]);

  useEffect(() => {
    if (!controllerEnabled) return;
    const messageId = pendingJumpIdRef.current;
    if (!messageId) return;
    const element = document.querySelector(
      `[data-message-id="${CSS.escape(messageId)}"]`,
    ) as HTMLElement | null;
    if (!element) return;
    pendingJumpIdRef.current = undefined;
    element.scrollIntoView({ behavior: "smooth", block: "start" });
    element.classList.remove("message-jump-highlight");
    void element.offsetWidth;
    element.classList.add("message-jump-highlight");
    window.setTimeout(() => element.classList.remove("message-jump-highlight"), 2000);
  }, [controllerEnabled, pagination.visibleMessages.length]);

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
