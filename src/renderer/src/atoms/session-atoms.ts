import { atom } from "jotai";
import type {
  AgentRuntimeState,
  AgentStatus,
  ChatMessage,
  SessionRecord,
  SessionRuntimeEvent,
} from "../../../shared/types";
import { mergeAgentRuntimeState } from "../utils/agentRuntimeState";

export const SESSION_MESSAGE_CACHE_LIMIT = 20;

export type SessionRuntimeViewState = {
  agentId?: string;
  runtimeGeneration: number;
  status: AgentStatus | "detached";
  state?: AgentRuntimeState;
  thinking: string;
  updatedAt: number;
};

export type SessionLoadState = {
  status: "idle" | "loading" | "ready" | "error";
  error?: string;
};

export type SessionMessageCacheEntry = {
  messages: ChatMessage[];
  revision: number;
  source: "disk" | "runtime";
  updatedAt: number;
};

export const sessionRecordsAtom = atom<Record<string, SessionRecord>>({});
export const sessionIdsByProjectAtom = atom<Record<string, string[]>>({});
export const currentSessionIdAtom = atom<string | undefined>(undefined);
export const sessionRuntimeByIdAtom = atom<Record<string, SessionRuntimeViewState>>({});
export const sessionMessagesCacheAtom = atom<Record<string, SessionMessageCacheEntry>>({});
export const sessionMessageLruAtom = atom<string[]>([]);
export const sessionMessageLoadStateAtom = atom<Record<string, SessionLoadState>>({});
export const sessionCatalogLoadStateAtom = atom<Record<string, SessionLoadState>>({});

export const currentSessionAtom = atom((get) => {
  const sessionId = get(currentSessionIdAtom);
  return sessionId ? get(sessionRecordsAtom)[sessionId] : undefined;
});

export const currentSessionRuntimeAtom = atom((get) => {
  const sessionId = get(currentSessionIdAtom);
  return sessionId ? get(sessionRuntimeByIdAtom)[sessionId] : undefined;
});

export const currentSessionMessagesAtom = atom((get) => {
  const sessionId = get(currentSessionIdAtom);
  return sessionId
    ? (get(sessionMessagesCacheAtom)[sessionId]?.messages ?? [])
    : [];
});

export const replaceProjectSessionsAtom = atom(
  null,
  (get, set, input: { projectId: string; sessions: SessionRecord[] }) => {
    const previousIds = get(sessionIdsByProjectAtom)[input.projectId] ?? [];
    const nextIds = input.sessions.map((session) => session.id);
    const nextIdSet = new Set(nextIds);
    const nextRecords = { ...get(sessionRecordsAtom) };
    for (const previousId of previousIds) {
      if (!nextIdSet.has(previousId)) delete nextRecords[previousId];
    }
    for (const session of input.sessions) nextRecords[session.id] = session;
    set(sessionRecordsAtom, nextRecords);
    set(sessionIdsByProjectAtom, {
      ...get(sessionIdsByProjectAtom),
      [input.projectId]: nextIds,
    });
  },
);

export const upsertSessionAtom = atom(null, (get, set, session: SessionRecord) => {
  set(sessionRecordsAtom, {
    ...get(sessionRecordsAtom),
    [session.id]: session,
  });
  const projectIds = get(sessionIdsByProjectAtom)[session.projectId] ?? [];
  if (!projectIds.includes(session.id)) {
    set(sessionIdsByProjectAtom, {
      ...get(sessionIdsByProjectAtom),
      [session.projectId]: [session.id, ...projectIds],
    });
  }
});

export const setSessionCatalogLoadStateAtom = atom(
  null,
  (get, set, input: { projectId: string; state: SessionLoadState }) => {
    set(sessionCatalogLoadStateAtom, {
      ...get(sessionCatalogLoadStateAtom),
      [input.projectId]: input.state,
    });
  },
);

export const setSessionMessageLoadStateAtom = atom(
  null,
  (get, set, input: { sessionId: string; state: SessionLoadState }) => {
    set(sessionMessageLoadStateAtom, {
      ...get(sessionMessageLoadStateAtom),
      [input.sessionId]: input.state,
    });
  },
);

export const cacheSessionMessagesAtom = atom(
  null,
  (get, set, input: {
    sessionId: string;
    messages: ChatMessage[];
    source: "disk" | "runtime";
    expectedRevision?: number;
  }) => {
    const cache = get(sessionMessagesCacheAtom);
    const current = cache[input.sessionId];
    if (
      input.expectedRevision !== undefined &&
      (current?.revision ?? 0) !== input.expectedRevision
    ) {
      return false;
    }
    const revision = input.source === "runtime"
      ? (current?.revision ?? 0) + 1
      : (current?.revision ?? 0);
    const nextCache = {
      ...cache,
      [input.sessionId]: {
        messages: input.messages,
        revision,
        source: input.source,
        updatedAt: Date.now(),
      },
    };
    const lru = [
      input.sessionId,
      ...get(sessionMessageLruAtom).filter((id) => id !== input.sessionId),
    ];
    const retainedIds = lru.slice(0, SESSION_MESSAGE_CACHE_LIMIT);
    for (const cachedSessionId of Object.keys(nextCache)) {
      if (!retainedIds.includes(cachedSessionId)) delete nextCache[cachedSessionId];
    }
    set(sessionMessagesCacheAtom, nextCache);
    set(sessionMessageLruAtom, retainedIds);
    return true;
  },
);

export const touchSessionMessagesAtom = atom(null, (get, set, sessionId: string) => {
  if (!get(sessionMessagesCacheAtom)[sessionId]) return;
  set(sessionMessageLruAtom, [
    sessionId,
    ...get(sessionMessageLruAtom).filter((id) => id !== sessionId),
  ].slice(0, SESSION_MESSAGE_CACHE_LIMIT));
});

export const applySessionRuntimeEventAtom = atom(
  null,
  (get, set, event: SessionRuntimeEvent) => {
    const currentRuntime = get(sessionRuntimeByIdAtom)[event.sessionId] ?? {
      runtimeGeneration: 0,
      status: "detached" as const,
      thinking: "",
      updatedAt: 0,
    };
    if (event.runtimeGeneration < currentRuntime.runtimeGeneration) return;
    if (
      event.runtimeGeneration === currentRuntime.runtimeGeneration &&
      currentRuntime.agentId &&
      currentRuntime.agentId !== event.agentId
    ) {
      return;
    }
    const bindingChanged =
      event.runtimeGeneration > currentRuntime.runtimeGeneration ||
      currentRuntime.agentId !== event.agentId;
    let nextRuntime: SessionRuntimeViewState = {
      ...(bindingChanged
        ? {
            runtimeGeneration: event.runtimeGeneration,
            status: "detached" as const,
            thinking: "",
            updatedAt: 0,
          }
        : currentRuntime),
      agentId: event.agentId,
      runtimeGeneration: event.runtimeGeneration,
      updatedAt: Date.now(),
    };
    const payload = event.payload && typeof event.payload === "object"
      ? event.payload as Record<string, unknown>
      : undefined;

    if (event.sourceChannel === "agents:state" && payload) {
      const status = payload.status;
      if (
        status === "starting" ||
        status === "idle" ||
        status === "running" ||
        status === "error" ||
        status === "closed"
      ) {
        nextRuntime = { ...nextRuntime, status };
      }
    } else if (event.sourceChannel === "agents:runtime-state" && payload?.state) {
      nextRuntime = {
        ...nextRuntime,
        state: mergeAgentRuntimeState(
          nextRuntime.state,
          payload.state as AgentRuntimeState,
        ),
      };
    } else if (event.sourceChannel === "agents:thinking" && payload) {
      nextRuntime = {
        ...nextRuntime,
        thinking: typeof payload.thinking === "string" ? payload.thinking : "",
      };
    } else if (event.sourceChannel === "agents:message" && payload) {
      const messages = payload.messages;
      if (Array.isArray(messages)) {
        set(cacheSessionMessagesAtom, {
          sessionId: event.sessionId,
          messages: messages as ChatMessage[],
          source: "runtime",
        });
      }
    }

    set(sessionRuntimeByIdAtom, {
      ...get(sessionRuntimeByIdAtom),
      [event.sessionId]: nextRuntime,
    });
  },
);

export const bindSessionRuntimeAtom = atom(
  null,
  (get, set, input: {
    sessionId: string;
    agentId: string;
    runtimeGeneration?: number;
    status?: AgentStatus;
  }) => {
    const current = get(sessionRuntimeByIdAtom)[input.sessionId];
    const currentGeneration = current?.runtimeGeneration ?? 0;
    if (
      input.runtimeGeneration !== undefined &&
      input.runtimeGeneration < currentGeneration
    ) {
      return;
    }
    const bindingChanged = Boolean(current?.agentId && current.agentId !== input.agentId);
    set(sessionRuntimeByIdAtom, {
      ...get(sessionRuntimeByIdAtom),
      [input.sessionId]: {
        agentId: input.agentId,
        runtimeGeneration: input.runtimeGeneration ?? currentGeneration,
        status: input.status ?? (bindingChanged ? "idle" : current?.status) ?? "idle",
        state: bindingChanged ? undefined : current?.state,
        thinking: bindingChanged ? "" : (current?.thinking ?? ""),
        updatedAt: Date.now(),
      },
    });
  },
);

export const removeSessionStateAtom = atom(null, (get, set, sessionId: string) => {
  const records = { ...get(sessionRecordsAtom) };
  const session = records[sessionId];
  delete records[sessionId];
  set(sessionRecordsAtom, records);
  if (session) {
    set(sessionIdsByProjectAtom, {
      ...get(sessionIdsByProjectAtom),
      [session.projectId]: (get(sessionIdsByProjectAtom)[session.projectId] ?? [])
        .filter((id) => id !== sessionId),
    });
  }
  const runtime = { ...get(sessionRuntimeByIdAtom) };
  delete runtime[sessionId];
  set(sessionRuntimeByIdAtom, runtime);
  const cache = { ...get(sessionMessagesCacheAtom) };
  delete cache[sessionId];
  set(sessionMessagesCacheAtom, cache);
  set(sessionMessageLruAtom, get(sessionMessageLruAtom).filter((id) => id !== sessionId));
  const loadState = { ...get(sessionMessageLoadStateAtom) };
  delete loadState[sessionId];
  set(sessionMessageLoadStateAtom, loadState);
  if (get(currentSessionIdAtom) === sessionId) set(currentSessionIdAtom, undefined);
});
