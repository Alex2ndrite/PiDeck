import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChatMessage } from "../../../shared/types";

export type MessagePaginationState = {
  ownerKey: string;
  visibleCount: number;
  isLoading: boolean;
};

type MessagePaginationOptions = {
  messages: ChatMessage[];
  ownerKey?: string;
  initialPageSize?: number;
  pageSize?: number;
  maxVisibleMessages?: number;
  enabled?: boolean;
};

type MessagePaginationResult = {
  visibleMessages: ChatMessage[];
  hasMore: boolean;
  loadMore: () => void;
  loadUntilIncluded: (index: number) => void;
  isLoading: boolean;
  reset: () => void;
  totalCount: number;
  visibleCount: number;
};

const DEFAULT_INITIAL_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 100;
const DEFAULT_MAX_VISIBLE = Infinity;
const DEFAULT_OWNER_KEY = "legacy";

export function createMessagePaginationState(
  ownerKey: string,
  initialPageSize: number,
): MessagePaginationState {
  return { ownerKey, visibleCount: initialPageSize, isLoading: false };
}

// A mismatched state is never rendered. This makes an owner switch atomic from React's render.
export function currentMessagePaginationState(
  state: MessagePaginationState,
  ownerKey: string,
  initialPageSize: number,
): MessagePaginationState {
  return state.ownerKey === ownerKey
    ? state
    : createMessagePaginationState(ownerKey, initialPageSize);
}

export function completeMessagePaginationLoad(
  state: MessagePaginationState,
  ownerKey: string,
  messageCount: number,
  pageSize: number,
  maxVisibleMessages: number,
): MessagePaginationState {
  if (state.ownerKey !== ownerKey) return state;
  return {
    ownerKey,
    visibleCount: Math.min(
      state.visibleCount + pageSize,
      maxVisibleMessages,
      messageCount,
    ),
    isLoading: false,
  };
}

export function includeMessagePaginationIndex(
  state: MessagePaginationState,
  ownerKey: string,
  index: number,
  messageCount: number,
  maxVisibleMessages: number,
): MessagePaginationState {
  if (state.ownerKey !== ownerKey || index < 0 || index >= messageCount) return state;
  return {
    ...state,
    visibleCount: Math.min(
      Math.max(state.visibleCount, messageCount - index),
      messageCount,
      maxVisibleMessages,
    ),
  };
}

export function useMessagePagination({
  messages,
  ownerKey = DEFAULT_OWNER_KEY,
  initialPageSize = DEFAULT_INITIAL_PAGE_SIZE,
  pageSize = DEFAULT_PAGE_SIZE,
  maxVisibleMessages = DEFAULT_MAX_VISIBLE,
  enabled = true,
}: MessagePaginationOptions): MessagePaginationResult {
  const [storedState, setStoredState] = useState(() =>
    createMessagePaginationState(ownerKey, initialPageSize),
  );
  const state = currentMessagePaginationState(storedState, ownerKey, initialPageSize);
  const ownerKeyRef = useRef(ownerKey);
  const messageCountRef = useRef(messages.length);
  const frameRef = useRef<number | undefined>(undefined);
  const frameOwnerRef = useRef<string | undefined>(undefined);
  const previousRef = useRef({ ownerKey, count: messages.length });
  ownerKeyRef.current = ownerKey;
  messageCountRef.current = messages.length;

  const cancelPendingLoad = useCallback(() => {
    if (frameRef.current != null) cancelAnimationFrame(frameRef.current);
    frameRef.current = undefined;
    frameOwnerRef.current = undefined;
  }, []);

  useEffect(() => {
    cancelPendingLoad();
    previousRef.current = { ownerKey, count: messages.length };
    setStoredState(createMessagePaginationState(ownerKey, initialPageSize));
    return cancelPendingLoad;
  }, [cancelPendingLoad, initialPageSize, ownerKey]);

  useEffect(() => {
    if (!enabled) return;
    const previous = previousRef.current;
    if (previous.ownerKey !== ownerKey) {
      previousRef.current = { ownerKey, count: messages.length };
      return;
    }
    const delta = messages.length - previous.count;
    previousRef.current = { ownerKey, count: messages.length };
    if (delta <= 0 || delta >= 10) return;
    setStoredState((current) => {
      if (current.ownerKey !== ownerKey) return current;
      return {
        ...current,
        visibleCount: Math.min(
          current.visibleCount + delta,
          messages.length,
          maxVisibleMessages,
        ),
      };
    });
  }, [enabled, maxVisibleMessages, messages.length, ownerKey]);

  const reset = useCallback(() => {
    cancelPendingLoad();
    setStoredState(createMessagePaginationState(ownerKey, initialPageSize));
  }, [cancelPendingLoad, initialPageSize, ownerKey]);

  const loadMore = useCallback(() => {
    if (!enabled || state.isLoading) return;
    if (frameRef.current != null) {
      if (frameOwnerRef.current === ownerKey) return;
      cancelPendingLoad();
    }
    const requestOwnerKey = ownerKey;
    setStoredState((current) => {
      const active = currentMessagePaginationState(current, requestOwnerKey, initialPageSize);
      return active.isLoading ? active : { ...active, isLoading: true };
    });
    frameOwnerRef.current = requestOwnerKey;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = undefined;
      frameOwnerRef.current = undefined;
      if (ownerKeyRef.current !== requestOwnerKey) return;
      setStoredState((current) => completeMessagePaginationLoad(
        current,
        requestOwnerKey,
        messageCountRef.current,
        pageSize,
        maxVisibleMessages,
      ));
    });
  }, [cancelPendingLoad, enabled, initialPageSize, maxVisibleMessages, ownerKey, pageSize, state.isLoading]);

  const loadUntilIncluded = useCallback((index: number) => {
    if (!enabled) return;
    const requestOwnerKey = ownerKey;
    setStoredState((current) => includeMessagePaginationIndex(
      currentMessagePaginationState(current, requestOwnerKey, initialPageSize),
      requestOwnerKey,
      index,
      messageCountRef.current,
      maxVisibleMessages,
    ));
  }, [enabled, initialPageSize, maxVisibleMessages, ownerKey]);

  const visibleMessages = useMemo(() => {
    if (!enabled) return messages;
    return messages.slice(Math.max(0, messages.length - state.visibleCount));
  }, [enabled, messages, state.visibleCount]);
  const hasMore = enabled &&
    state.visibleCount < messages.length &&
    state.visibleCount < maxVisibleMessages;

  return {
    visibleMessages,
    hasMore,
    loadMore,
    loadUntilIncluded,
    isLoading: state.isLoading,
    reset,
    totalCount: messages.length,
    visibleCount: visibleMessages.length,
  };
}
