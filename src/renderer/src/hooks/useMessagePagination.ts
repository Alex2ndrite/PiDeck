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
  /** 受控恢复窗口大小（会话切换恢复历史查看位置用）。
   *  与 loadMore 的差异：直接设为目标值（而非增量），并先 clamp 到当前消息数。 */
  setVisibleCount: (count: number) => void;
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

/**
 * 尾部追加消息时同步放大窗口。必须在「同一次渲染」内生效：
 * 若等 useEffect，会先用旧 visibleCount slice 掉顶部一条再补回 → 触底上跳。
 * 批量追加（含 ≥10）也要跟进，否则窗口永久少条、上方持续被吃掉。
 */
export function growVisibleCountForAppend(
  visibleCount: number,
  previousLength: number,
  nextLength: number,
  maxVisibleMessages: number,
): number {
  const delta = nextLength - previousLength;
  if (delta <= 0) return Math.min(visibleCount, nextLength, maxVisibleMessages);
  return Math.min(visibleCount + delta, nextLength, maxVisibleMessages);
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
  const fallbackTimerRef = useRef<number | undefined>(undefined);
  const frameOwnerRef = useRef<string | undefined>(undefined);
  const [trackedLength, setTrackedLength] = useState(messages.length);
  ownerKeyRef.current = ownerKey;
  messageCountRef.current = messages.length;

  const cancelPendingLoad = useCallback(() => {
    if (frameRef.current != null) cancelAnimationFrame(frameRef.current);
    if (fallbackTimerRef.current != null) window.clearTimeout(fallbackTimerRef.current);
    frameRef.current = undefined;
    fallbackTimerRef.current = undefined;
    frameOwnerRef.current = undefined;
  }, []);

  useEffect(() => {
    cancelPendingLoad();
    setTrackedLength(messages.length);
    setStoredState(createMessagePaginationState(ownerKey, initialPageSize));
    return cancelPendingLoad;
    // 仅会话切换时重置；messages.length 不进依赖，避免追加时整窗重置。
    // eslint-disable-next-line react-hooks/exhaustive-deps -- owner/pageSize only
  }, [cancelPendingLoad, initialPageSize, ownerKey]);

  // 渲染期同步窗口：丢弃「旧 visibleCount」那一帧，避免顶部消息闪删。
  if (enabled && storedState.ownerKey === ownerKey && messages.length !== trackedLength) {
    const nextVisible = growVisibleCountForAppend(
      state.visibleCount,
      trackedLength,
      messages.length,
      maxVisibleMessages,
    );
    setTrackedLength(messages.length);
    if (nextVisible !== state.visibleCount) {
      setStoredState({
        ...state,
        visibleCount: nextVisible,
      });
    }
  }

  const reset = useCallback(() => {
    cancelPendingLoad();
    setTrackedLength(messages.length);
    setStoredState(createMessagePaginationState(ownerKey, initialPageSize));
  }, [cancelPendingLoad, initialPageSize, messages.length, ownerKey]);

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
    // Electron can throttle rAF while a window is backgrounded. Keep rAF as the
    // normal paint-friendly path, but complete the owner-validated update once
    // through a short timer so the button cannot remain stuck in loading state.
    const completeLoad = () => {
      if (frameOwnerRef.current !== requestOwnerKey) return;
      frameRef.current = undefined;
      if (fallbackTimerRef.current != null) window.clearTimeout(fallbackTimerRef.current);
      fallbackTimerRef.current = undefined;
      frameOwnerRef.current = undefined;
      if (ownerKeyRef.current !== requestOwnerKey) return;
      setStoredState((current) => completeMessagePaginationLoad(
        current,
        requestOwnerKey,
        messageCountRef.current,
        pageSize,
        maxVisibleMessages,
      ));
    };
    frameRef.current = requestAnimationFrame(completeLoad);
    fallbackTimerRef.current = window.setTimeout(completeLoad, 250);
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

  /** 受控恢复窗口：会话切换回历史查看位置时，把窗口恢复到切走时的大小。 */
  const setVisibleCount = useCallback((count: number) => {
    if (!enabled) return;
    const requestOwnerKey = ownerKey;
    setStoredState((current) => {
      const active = currentMessagePaginationState(current, requestOwnerKey, initialPageSize);
      const next = Math.min(
        Math.max(1, Math.round(count)),
        messageCountRef.current,
        maxVisibleMessages,
      );
      if (next === active.visibleCount) return active;
      return { ...active, visibleCount: next, isLoading: false };
    });
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
    setVisibleCount,
    isLoading: state.isLoading,
    reset,
    totalCount: messages.length,
    visibleCount: visibleMessages.length,
  };
}
