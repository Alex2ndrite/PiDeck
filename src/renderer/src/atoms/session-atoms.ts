import { atom } from "jotai";
import { selectAtom } from "jotai/utils";
import type {
  AgentRuntimeState,
	AgentStatus,
	AgentUiRequest,
	ChatMessage,
	SessionMessagePage,
  SessionRecord,
  SessionRuntimeEvent,
  SessionRuntimeInfo,
} from "../../../shared/types";
import { mergeAgentRuntimeState } from "../utils/agentRuntimeState";
import { sameProjectSessionList } from "../utils/sessionRecordIdentity";

export const SESSION_MESSAGE_CACHE_LIMIT = 20;

export type SessionRuntimeViewState = {
  agentId?: string;
  runtimeGeneration: number;
  status: AgentStatus | "detached";
  state?: AgentRuntimeState;
  thinking: string;
  updatedAt: number;
  projectId?: string;
  cwd?: string;
  title?: string;
  piSessionId?: string;
  sessionPath?: string;
  createdAt?: number;
  compactionCount?: number;
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
	/** Present only for paged historical reads; runtime owns an authoritative full snapshot. */
	page?: Pick<SessionMessagePage, "total" | "nextBefore">;
};

export type SessionRuntimeUiRequestState = {
  request: AgentUiRequest;
  status: "pending" | "responding" | "completed" | "cancelled";
};

export type SessionRuntimeUiState = {
  agentId: string;
  runtimeGeneration: number;
  requests: Record<string, SessionRuntimeUiRequestState>;
  widgets: Record<string, string[]>;
  notification?: {
    requestId: string;
    message: string;
    notifyType?: "info" | "warning" | "error";
    revision: number;
  };
  editorText?: {
    requestId: string;
    text: string;
    revision: number;
  };
  revision: number;
};

export const sessionRecordsAtom = atom<Record<string, SessionRecord>>({});
export const sessionIdsByProjectAtom = atom<Record<string, string[]>>({});
export const currentSessionIdAtom = atom<string | undefined>(undefined);
export const sessionRuntimeByIdAtom = atom<Record<string, SessionRuntimeViewState>>({});
export const sidebarRuntimeAtom = selectAtom(
  sessionRuntimeByIdAtom,
  (full) => {
    const slim: Record<string, { agentId?: string; status: string }> = {};
    for (const [id, rt] of Object.entries(full)) {
      slim[id] = { agentId: rt.agentId, status: rt.status ?? "detached" };
    }
    return slim;
  },
);
export const sessionRuntimeUiByIdAtom = atom<Record<string, SessionRuntimeUiState>>({});
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

export const currentSessionRuntimeUiAtom = atom((get) => {
  const sessionId = get(currentSessionIdAtom);
  return sessionId ? get(sessionRuntimeUiByIdAtom)[sessionId] : undefined;
});

export const currentSessionMessagesAtom = atom((get) => {
  const sessionId = get(currentSessionIdAtom);
  return sessionId
    ? (get(sessionMessagesCacheAtom)[sessionId]?.messages ?? [])
    : [];
});

export const replaceSessionRuntimesAtom = atom(
  null,
  (get, set, runtimes: SessionRuntimeInfo[]) => {
    const current = get(sessionRuntimeByIdAtom);
    const next = { ...current };
    for (const runtime of runtimes) {
      const existing = current[runtime.sessionId];
      if (existing && existing.runtimeGeneration > runtime.runtimeGeneration) continue;
      const bindingChanged = existing?.agentId !== runtime.agentId ||
        existing.runtimeGeneration !== runtime.runtimeGeneration;
      next[runtime.sessionId] = {
        ...(bindingChanged ? {} : existing),
        agentId: runtime.agentId,
        runtimeGeneration: runtime.runtimeGeneration,
        status: runtime.status,
        state: bindingChanged ? undefined : existing?.state,
        thinking: bindingChanged ? "" : (existing?.thinking ?? ""),
        updatedAt: Date.now(),
        projectId: runtime.projectId,
        cwd: runtime.cwd,
        sessionPath: runtime.sessionPath,
        createdAt: runtime.createdAt,
        compactionCount: runtime.compactionCount,
      };
    }
    set(sessionRuntimeByIdAtom, next);
  },
);

export const replaceProjectSessionsAtom = atom(
  null,
  (get, set, input: { projectId: string; sessions: SessionRecord[] }) => {
    const previousIds = get(sessionIdsByProjectAtom)[input.projectId] ?? [];
    // 轮询刷新绝大多数轮次内容未变；此时保持 atom 引用稳定，避免整棵侧栏重渲染。
    if (sameProjectSessionList(previousIds, get(sessionRecordsAtom), input.sessions)) return;
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
		page?: Pick<SessionMessagePage, "total" | "nextBefore">;
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
			...(input.source === "disk" && input.page ? { page: input.page } : {}),
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

export const prependSessionMessagePageAtom = atom(
	null,
	(get, set, input: {
		sessionId: string;
		before: number;
		expectedRevision: number;
		page: SessionMessagePage;
	}) => {
		const current = get(sessionMessagesCacheAtom)[input.sessionId];
		if (
			!current ||
			current.source !== "disk" ||
			current.revision !== input.expectedRevision ||
			current.page?.nextBefore !== input.before
		) {
			return false;
		}
		set(sessionMessagesCacheAtom, {
			...get(sessionMessagesCacheAtom),
			[input.sessionId]: {
				...current,
				messages: [...input.page.messages, ...current.messages],
				page: { total: input.page.total, nextBefore: input.page.nextBefore },
				updatedAt: Date.now(),
			},
		});
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

function toAgentUiRequest(
  payload: Record<string, unknown>,
  agentId: string,
): AgentUiRequest | undefined {
  const requestId = typeof payload.requestId === "string" ? payload.requestId : "";
  if (!requestId) return undefined;
  return {
    agentId,
    requestId,
    method: typeof payload.method === "string" ? payload.method : "",
    title: typeof payload.title === "string" ? payload.title : "",
    options: Array.isArray(payload.options)
      ? payload.options.filter((option): option is string => typeof option === "string")
      : undefined,
    placeholder: typeof payload.placeholder === "string" ? payload.placeholder : undefined,
    prefill: typeof payload.prefill === "string" ? payload.prefill : undefined,
    allowOther: payload.allowOther === true,
    completed: payload.completed === true,
    value: typeof payload.value === "string" || typeof payload.value === "boolean"
      ? payload.value
      : undefined,
    confirmed: typeof payload.confirmed === "boolean" ? payload.confirmed : undefined,
    cancelled: payload.cancelled === true,
    message: typeof payload.message === "string" ? payload.message : undefined,
    notifyType: payload.notifyType === "info" || payload.notifyType === "warning" || payload.notifyType === "error"
      ? payload.notifyType
      : undefined,
    text: typeof payload.text === "string" ? payload.text : undefined,
    widgetKey: typeof payload.widgetKey === "string" ? payload.widgetKey : undefined,
    widgetLines: Array.isArray(payload.widgetLines)
      ? payload.widgetLines.filter((line): line is string => typeof line === "string")
      : undefined,
    widgetPlacement: payload.widgetPlacement === "aboveEditor" || payload.widgetPlacement === "belowEditor"
      ? payload.widgetPlacement
      : undefined,
  };
}

function applySessionRuntimeUiEvent(
  current: SessionRuntimeUiState | undefined,
  event: SessionRuntimeEvent,
  payload: Record<string, unknown>,
  bindingChanged: boolean,
): SessionRuntimeUiState | undefined {
  const base = !current || bindingChanged || current.agentId !== event.agentId ||
    current.runtimeGeneration !== event.runtimeGeneration
    ? {
        agentId: event.agentId,
        runtimeGeneration: event.runtimeGeneration,
        requests: {},
        widgets: {},
        revision: 0,
      }
    : current;
  if (
    (event.sourceChannel === "agents:state" || event.sourceChannel === "sessions:runtime") &&
    (payload.status === "error" || payload.status === "closed")
  ) {
    return {
      agentId: event.agentId,
      runtimeGeneration: event.runtimeGeneration,
      requests: {},
      widgets: {},
      revision: base.revision + 1,
    };
  }
  if (event.sourceChannel !== "agents:ui-request") return bindingChanged ? base : current;
  const request = toAgentUiRequest(payload, event.agentId);
  if (!request) return base;
  const revision = base.revision + 1;

  if (request.completed) {
    const existing = base.requests[request.requestId];
    if (!existing) return { ...base, revision };
    return {
      ...base,
      revision,
      requests: {
        ...base.requests,
        [request.requestId]: {
          request: { ...existing.request, ...request },
          status: request.cancelled ? "cancelled" : "completed",
        },
      },
    };
  }
  if (request.method === "notify") {
    return request.message
      ? {
          ...base,
          revision,
          notification: {
            requestId: request.requestId,
            message: request.message,
            notifyType: request.notifyType,
            revision,
          },
        }
      : { ...base, revision };
  }
  if (request.method === "set_editor_text") {
    return {
      ...base,
      revision,
      editorText: {
        requestId: request.requestId,
        text: request.text ?? "",
        revision,
      },
    };
  }
  if (request.method === "setWidget") {
    const widgetKey = request.widgetKey || request.requestId;
    const widgets = { ...base.widgets };
    if (request.widgetLines?.length) widgets[widgetKey] = request.widgetLines;
    else delete widgets[widgetKey];
    return { ...base, revision, widgets };
  }
  if (!["select", "confirm", "input", "editor"].includes(request.method)) {
    return { ...base, revision };
  }
  return {
    ...base,
    revision,
    requests: {
      ...base.requests,
      [request.requestId]: { request, status: "pending" },
    },
  };
}

export const applySessionRuntimeEventAtom = atom(
  null,
  (get, set, event: SessionRuntimeEvent) => {
    const currentRuntime = get(sessionRuntimeByIdAtom)[event.sessionId] ?? {
      runtimeGeneration: 0,
      status: "detached" as const,
      thinking: "",
      updatedAt: 0,
    };
    if (event.kind === "detach") {
      if (
        event.runtimeGeneration < currentRuntime.runtimeGeneration ||
        (currentRuntime.agentId && currentRuntime.agentId !== event.agentId)
      ) {
        return;
      }
      const nextUiById = { ...get(sessionRuntimeUiByIdAtom) };
      delete nextUiById[event.sessionId];
      set(sessionRuntimeUiByIdAtom, nextUiById);
      set(sessionRuntimeByIdAtom, {
        ...get(sessionRuntimeByIdAtom),
        [event.sessionId]: {
          runtimeGeneration: event.runtimeGeneration,
          status: "detached",
          thinking: "",
          updatedAt: Date.now(),
        },
      });
      return;
    }
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

    if (
      (event.sourceChannel === "agents:state" || event.sourceChannel === "sessions:runtime") &&
      payload
    ) {
      const status = payload.status;
      if (
        status === "starting" ||
        status === "idle" ||
        status === "running" ||
        status === "error" ||
        status === "closed"
      ) {
        nextRuntime = {
          ...nextRuntime,
          status,
          projectId: typeof payload.projectId === "string" ? payload.projectId : nextRuntime.projectId,
          cwd: typeof payload.cwd === "string" ? payload.cwd : nextRuntime.cwd,
          title: typeof payload.title === "string" ? payload.title : nextRuntime.title,
          piSessionId: typeof payload.sessionId === "string" ? payload.sessionId : nextRuntime.piSessionId,
          sessionPath: typeof payload.sessionPath === "string" ? payload.sessionPath : nextRuntime.sessionPath,
          createdAt: typeof payload.createdAt === "number" ? payload.createdAt : nextRuntime.createdAt,
          compactionCount: typeof payload.compactionCount === "number"
            ? payload.compactionCount
            : nextRuntime.compactionCount,
        };
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
    } else if (
      (event.sourceChannel === "agents:message" || event.sourceChannel === "sessions:messages") &&
      payload
    ) {
      const messages = payload.messages;
      if (Array.isArray(messages)) {
        set(cacheSessionMessagesAtom, {
          sessionId: event.sessionId,
          messages: messages as ChatMessage[],
          source: "runtime",
        });
      }
    }

    const terminalEnvelope = !bindingChanged &&
      (currentRuntime.status === "error" || currentRuntime.status === "closed");
    const nextUi = payload && !(terminalEnvelope && event.sourceChannel === "agents:ui-request")
      ? applySessionRuntimeUiEvent(
          get(sessionRuntimeUiByIdAtom)[event.sessionId],
          event,
          payload,
          bindingChanged,
        )
      : undefined;
    if (nextUi) {
      set(sessionRuntimeUiByIdAtom, {
        ...get(sessionRuntimeUiByIdAtom),
        [event.sessionId]: nextUi,
      });
    }
    set(sessionRuntimeByIdAtom, {
      ...get(sessionRuntimeByIdAtom),
      [event.sessionId]: nextRuntime,
    });
  },
);

export const claimSessionRuntimeUiResponseAtom = atom(
  null,
  (get, set, input: {
    sessionId: string;
    requestId: string;
    agentId: string;
    runtimeGeneration: number;
    request?: AgentUiRequest;
  }) => {
    const current = get(sessionRuntimeUiByIdAtom)[input.sessionId];
    const request = current?.requests[input.requestId];
    if (
      !current ||
      current.agentId !== input.agentId ||
      current.runtimeGeneration !== input.runtimeGeneration ||
      request?.status !== "pending" ||
      (input.request !== undefined && request.request !== input.request)
    ) {
      return false;
    }
    set(sessionRuntimeUiByIdAtom, {
      ...get(sessionRuntimeUiByIdAtom),
      [input.sessionId]: {
        ...current,
        requests: {
          ...current.requests,
          [input.requestId]: { ...request, status: "responding" },
        },
      },
    });
    return true;
  },
);

export const rollbackSessionRuntimeUiResponseAtom = atom(
  null,
  (get, set, input: {
    sessionId: string;
    requestId: string;
    agentId: string;
    runtimeGeneration: number;
    request?: AgentUiRequest;
  }) => {
    const current = get(sessionRuntimeUiByIdAtom)[input.sessionId];
    const request = current?.requests[input.requestId];
    if (
      !current ||
      current.agentId !== input.agentId ||
      current.runtimeGeneration !== input.runtimeGeneration ||
      request?.status !== "responding" ||
      (input.request !== undefined && request.request !== input.request)
    ) {
      return false;
    }
    set(sessionRuntimeUiByIdAtom, {
      ...get(sessionRuntimeUiByIdAtom),
      [input.sessionId]: {
        ...current,
        requests: {
          ...current.requests,
          [input.requestId]: { ...request, status: "pending" },
        },
      },
    });
    return true;
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
    if (bindingChanged) {
      const ui = { ...get(sessionRuntimeUiByIdAtom) };
      delete ui[input.sessionId];
      set(sessionRuntimeUiByIdAtom, ui);
    }
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
  const runtimeUi = { ...get(sessionRuntimeUiByIdAtom) };
  delete runtimeUi[sessionId];
  set(sessionRuntimeUiByIdAtom, runtimeUi);
  const cache = { ...get(sessionMessagesCacheAtom) };
  delete cache[sessionId];
  set(sessionMessagesCacheAtom, cache);
  set(sessionMessageLruAtom, get(sessionMessageLruAtom).filter((id) => id !== sessionId));
  const loadState = { ...get(sessionMessageLoadStateAtom) };
  delete loadState[sessionId];
  set(sessionMessageLoadStateAtom, loadState);
  if (get(currentSessionIdAtom) === sessionId) set(currentSessionIdAtom, undefined);
});
