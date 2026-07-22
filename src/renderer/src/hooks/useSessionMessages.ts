import { useCallback, useEffect, useRef, useState } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import {
  cacheSessionMessagesAtom,
  sessionMessageLoadStateAtom,
  sessionMessagesCacheAtom,
  setSessionMessageLoadStateAtom,
  touchSessionMessagesAtom,
} from "../atoms";

let nextLoadSequence = 0;
const latestLoadBySession = new Map<string, number>();

export function useSessionMessages(sessionId: string | undefined) {
  const cache = useAtomValue(sessionMessagesCacheAtom);
  const loadStates = useAtomValue(sessionMessageLoadStateAtom);
  const cacheMessages = useSetAtom(cacheSessionMessagesAtom);
  const setLoadState = useSetAtom(setSessionMessageLoadStateAtom);
  const touchMessages = useSetAtom(touchSessionMessagesAtom);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const lastLoadKeyRef = useRef<string | undefined>(undefined);
  const entry = sessionId ? cache[sessionId] : undefined;

  useEffect(() => {
    if (!sessionId) return;
    const loadKey = `${sessionId}:${refreshVersion}`;
    if (lastLoadKeyRef.current === loadKey) return;
    lastLoadKeyRef.current = loadKey;
    const sequence = ++nextLoadSequence;
    latestLoadBySession.set(sessionId, sequence);
    const expectedRevision = entry?.revision ?? 0;
    if (entry) touchMessages(sessionId);
    setLoadState({
      sessionId,
      state: { status: "loading" },
    });

    void window.piDesktop.sessions.readRecordMessages(sessionId)
      .then((messages) => {
        if (latestLoadBySession.get(sessionId) !== sequence) return;
        cacheMessages({
          sessionId,
          messages,
          source: "disk",
          expectedRevision,
        });
        setLoadState({
          sessionId,
          state: { status: "ready" },
        });
      })
      .catch((error) => {
        if (latestLoadBySession.get(sessionId) !== sequence) return;
        setLoadState({
          sessionId,
          state: {
            status: "error",
            error: error instanceof Error ? error.message : String(error),
          },
        });
      });
  // The cache entry is intentionally captured at the start of each session load.
  // Runtime events advance its revision and prevent a late disk response from replacing it.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, refreshVersion, cacheMessages, setLoadState, touchMessages]);

  const refresh = useCallback(() => {
    setRefreshVersion((current) => current + 1);
  }, []);

  return {
    messages: entry?.messages ?? [],
    isLoading: sessionId ? loadStates[sessionId]?.status === "loading" : false,
    error: sessionId && loadStates[sessionId]?.status === "error"
      ? loadStates[sessionId]?.error
      : undefined,
    refresh,
  };
}
