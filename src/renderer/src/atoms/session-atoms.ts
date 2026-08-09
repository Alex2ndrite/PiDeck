import { atom } from "jotai";
import type { Getter, Setter } from "jotai";
import { atomFamily, selectAtom } from "jotai/utils";
import type {
  AgentRuntimeState,
	AgentStatus,
	AgentUiBatchQuestion,
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
  updatedAt: number;
  projectId?: string;
  cwd?: string;
  title?: string;
  piSessionId?: string;
  sessionPath?: string;
  createdAt?: number;
  compactionCount?: number;
  noSession?: boolean;
};

/** Live 思考段（按稳定 id 索引，与 History msg-thinking-* 同一身份）。 */
export type StreamingThinkingEntry = {
  sessionId: string;
  text: string;
  startedAt: number;
  endedAt: number;
  streaming: boolean;
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
	/** 激活显示窗口起点（runtime 数组下标空间，2026-08 激活分页）；>0 表示窗口前还有历史。 */
	windowStart?: number;
	/**
	 * disk 历史前缀（仅 runtime 窗口会话）：prepend-only 轮次页，
	 * 与运行时窗口段的接缝按 meta.entryId 去重；fileVersion 变化（压缩改写）即整段失效。
	 */
	history?: {
		messages: ChatMessage[];
		nextBefore: number | null;
		version?: string;
	};
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
/** IDs detached from an in-memory runtime; rejects late catalog refreshes for them. */
export const discardedTransientSessionIdsAtom = atom<Set<string>>(new Set<string>());
export const sessionIdsByProjectAtom = atom<Record<string, string[]>>({});
export const currentSessionIdAtom = atom<string | undefined>(undefined);
/** 会话 Tab 栏（浏览器式多 Tab）：按打开顺序排列的会话 id 列表。
 *  关闭 Tab 只从列表移除，不 kill Agent；再次打开同一会话时复用已绑定运行时。 */
export const sessionTabIdsAtom = atom<string[]>([]);
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
/**
 * 会话级缓存命中率快照历史（仅存数值，最多 50 条）：
 * 用于展示「当前会话平均缓存命中率」，弥补只显示最新一次 assistant 命中率的不足。
 */
export const sessionCacheStatsAtom = atom<Record<string, { cacheHitHistory: number[] }>>({});
export const SESSION_CACHE_STATS_LIMIT = 50;
export const sessionMessagesCacheAtom = atom<Record<string, SessionMessageCacheEntry>>({});

/**
 * 会话切换时的滚动位置锚点（per-session，切走保存、切回恢复）。
 * 只保存「非跟底」状态：用户正在查看历史时切走，回来时停留在原位置；
 * 在底部跟流切走的会话不存锚点，切回继续跟底。
 */
export type SessionScrollAnchor = {
	/** 锚点行 id（timeline 内 [data-message-id] 的值：可能是 run id 或消息 id） */
	messageId: string;
	/** 锚点行顶边相对视口顶部的偏移（px），恢复时按此对齐 */
	offsetTop: number;
	/** 切走时分页窗口大小（visibleCount），恢复历史窗口避免锚点被裁剪 */
	visibleCount: number;
	/** 保存时间戳，防止乱序事件用陈旧状态覆盖新状态 */
	savedAt: number;
};

export const sessionScrollAnchorByIdAtom = atom<Record<string, SessionScrollAnchor>>({});

/** 保存/清除某会话的滚动锚点。anchor 为 null 时清除（如回到底部或会话关闭）。 */
export const saveSessionScrollAnchorAtom = atom(
	null,
	(get, set, input: { sessionId: string; anchor: SessionScrollAnchor | null }) => {
		const { sessionId, anchor } = input;
		set(sessionScrollAnchorByIdAtom, (prevMap) => {
			if (anchor === null) {
				if (!(sessionId in prevMap)) return prevMap;
				const nextMap = { ...prevMap };
				delete nextMap[sessionId];
				return nextMap;
			}
			// 乱序写入保护：只有更新（时间戳更新）才覆盖，防止陈旧滚动事件覆盖新保存。
			const prev = prevMap[sessionId];
			if (prev && prev.savedAt > anchor.savedAt) return prevMap;
			return { ...prevMap, [sessionId]: anchor };
		});
	},
);
/**
 * 会话级独立流式正文（阶段1：学 Proma 独立存储）。
 * key: sessionId，value: { content, streaming }。
 * 流式期间 content 由 agents:text-stream 通道实时更新；
 * message_end 后由历史消息（sessionMessagesCacheAtom）接管，此处清空。
 */
export const streamingTextByIdAtom = atom<
	Record<string, { content: string; streaming: boolean }>
>({});
/**
 * Live 思考正文通道（镜像 text-stream）：key = msg-thinking-${assistantMessageId}。
 * ThinkingStep 叶子订阅；timeline 只订 liveThinkingIdBySessionAtom，避免 50ms 戳醒整树。
 */
export const streamingThinkingByIdAtom = atom<Record<string, StreamingThinkingEntry>>({});
/** 会话当前 live 思考段 id；仅 id 变化时通知 timeline 挂载点。 */
export const liveThinkingIdBySessionAtom = atom<Record<string, string>>({});

function sameStreamingThinkingEntry(
  a: StreamingThinkingEntry | undefined,
  b: StreamingThinkingEntry | undefined,
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.sessionId === b.sessionId &&
    a.text === b.text &&
    a.startedAt === b.startedAt &&
    a.endedAt === b.endedAt &&
    a.streaming === b.streaming
  );
}

/** ThinkingStep 叶子按稳定 id 订阅，避免整表 tick 戳醒所有思考卡。
 *  jotai atomFamily 无自动 GC：释放数据条目时必须同步 .remove(id)，否则长跑泄漏。 */
export const streamingThinkingEntryByIdAtomFamily = atomFamily((thinkingId: string) =>
  selectAtom(
    streamingThinkingByIdAtom,
    (map) => map[thinkingId],
    sameStreamingThinkingEntry,
  ),
);

/** Timeline 只订本会话 live id，不订思考正文。 */
export const liveThinkingIdBySessionIdAtomFamily = atomFamily((sessionId: string) =>
  selectAtom(
    liveThinkingIdBySessionAtom,
    (map) => map[sessionId],
    Object.is,
  ),
);

/** 与 streamingThinkingByIdAtom 条目成对释放，避免 atomFamily Map 无限增长。 */
function disposeStreamingThinkingFamily(thinkingId: string) {
  streamingThinkingEntryByIdAtomFamily.remove(thinkingId);
}

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
        updatedAt: Date.now(),
        projectId: runtime.projectId,
        cwd: runtime.cwd,
        sessionPath: runtime.sessionPath,
        createdAt: runtime.createdAt,
        compactionCount: runtime.compactionCount,
        noSession: runtime.noSession,
      };
    }
    set(sessionRuntimeByIdAtom, next);
  },
);

export const replaceProjectSessionsAtom = atom(
  null,
  (get, set, input: { projectId: string; sessions: SessionRecord[] }) => {
    const discardedTransientIds = get(discardedTransientSessionIdsAtom);
    // A close can race a catalog scan that started before the runtime detached.
    // Do not let that stale response resurrect a no-session row in the sidebar.
    const sessions = input.sessions.filter((session) => (
      !session.noSession || !discardedTransientIds.has(session.id)
    ));
    const previousIds = get(sessionIdsByProjectAtom)[input.projectId] ?? [];
    // 轮询刷新绝大多数轮次内容未变；此时保持 atom 引用稳定，避免整棵侧栏重渲染。
    if (sameProjectSessionList(previousIds, get(sessionRecordsAtom), sessions)) return;
    const nextIds = sessions.map((session) => session.id);
    const nextIdSet = new Set(nextIds);
    const nextRecords = { ...get(sessionRecordsAtom) };
    for (const previousId of previousIds) {
      if (!nextIdSet.has(previousId)) delete nextRecords[previousId];
    }
    for (const session of sessions) nextRecords[session.id] = session;
    set(sessionRecordsAtom, nextRecords);
    set(sessionIdsByProjectAtom, {
      ...get(sessionIdsByProjectAtom),
      [input.projectId]: nextIds,
    });
  },
);

export const upsertSessionAtom = atom(null, (get, set, session: SessionRecord) => {
  if (session.noSession && get(discardedTransientSessionIdsAtom).has(session.id)) {
    const nextDiscarded = new Set(get(discardedTransientSessionIdsAtom));
    nextDiscarded.delete(session.id);
    set(discardedTransientSessionIdsAtom, nextDiscarded);
  }
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
		/** runtime 窗口协议字段（2026-08 激活分页） */
		windowStart?: number;
		history?: SessionMessageCacheEntry["history"];
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
			// runtime 窗口语义（2026-08 激活分页）：entry 每次整体重建，
			// 调用方必须显式给出 windowStart/history（undefined = 清除，如版本失效丢前缀）；
			// disk 来源无窗口概念，两字段缺省即不存在
			...(input.source === "runtime" ? {
				windowStart: input.windowStart && input.windowStart > 0 ? input.windowStart : undefined,
				history: input.history,
			} : {}),
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

/** 历史前缀/窗口段的去重键：优先 pi entryId（跨下标空间稳定），缺省回退消息 id。 */
function messageEntryKey(message: ChatMessage): string {
  const entryId = message.meta?.entryId;
  return typeof entryId === "string" && entryId ? `e:${entryId}` : `m:${message.id}`;
}

/**
 * 运行时窗口段更新时调和 disk 历史前缀（2026-08 激活分页）：
 * - fileVersion 变化（压缩/外部改写 JSONL）→ 前缀绝对下标空间失效，整段丢弃；
 * - 窗口右移与前缀尾部重叠 → 按 entryId 去重（重叠部分以运行时窗口段为权威）。
 */
function reconcileHistoryPrefix(
  history: SessionMessageCacheEntry["history"],
  segment: ChatMessage[],
  fileVersion?: string,
): SessionMessageCacheEntry["history"] {
  if (!history) return undefined;
  if (fileVersion && history.version && fileVersion !== history.version) return undefined;
  const segmentKeys = new Set(segment.map(messageEntryKey));
  const messages = history.messages.filter((message) => !segmentKeys.has(messageEntryKey(message)));
  if (messages.length === history.messages.length) return history;
  if (messages.length === 0) return undefined;
  return { ...history, messages };
}

/**
 * disk 轮次页 prepend（runtime 窗口会话的「加载更多对话」）。
 * 守卫：来源/revision/游标连续；版本漂移（压缩）时旧前缀整段作废、以新页为最新前缀起点。
 */
export const prependSessionHistoryPageAtom = atom(
  null,
  (get, set, input: {
    sessionId: string;
    expectedRevision: number;
    /** 续页游标（首次加载为 undefined，调用方以 beforeEntryId 锚定） */
    before?: number | null;
    page: SessionMessagePage;
  }) => {
    const current = get(sessionMessagesCacheAtom)[input.sessionId];
    if (
      !current ||
      current.source !== "runtime" ||
      current.revision !== input.expectedRevision
    ) {
      return false;
    }
    // 续页必须游标连续；首次加载（无 history）不要求
    if (current.history && current.history.nextBefore !== input.before) return false;

    const segmentKeys = new Set(current.messages.map(messageEntryKey));
    const pageMessages = input.page.messages.filter((message) => !segmentKeys.has(messageEntryKey(message)));

    const stalePrefix = Boolean(
      current.history?.version &&
      input.page.indexVersion &&
      current.history.version !== input.page.indexVersion,
    );
    // 版本漂移：旧前缀下标空间失效，直接以新页重建前缀（仍然与窗口段去重）
    const baseMessages = stalePrefix ? [] : (current.history?.messages ?? []);
    const baseKeys = new Set(baseMessages.map(messageEntryKey));
    const freshMessages = pageMessages.filter((message) => !baseKeys.has(messageEntryKey(message)));

    const merged = [...freshMessages, ...baseMessages];
    set(sessionMessagesCacheAtom, {
      ...get(sessionMessagesCacheAtom),
      [input.sessionId]: {
        ...current,
        history: merged.length > 0 || input.page.nextBefore !== null
          ? {
              messages: merged,
              nextBefore: input.page.nextBefore,
              version: input.page.indexVersion ?? current.history?.version,
            }
          : undefined,
        updatedAt: Date.now(),
      },
    });
    return true;
  },
);

function toAgentUiRequest(
  payload: Record<string, unknown>,
  agentId: string,
): AgentUiRequest | undefined {
  const requestId = typeof payload.requestId === "string" ? payload.requestId : "";
  if (!requestId) return undefined;
  const batchQuestions: AgentUiBatchQuestion[] | undefined = Array.isArray(payload.batchQuestions)
    ? payload.batchQuestions.reduce<AgentUiBatchQuestion[]>((questions, question) => {
        if (!question || typeof question !== "object") return questions;
        const typed = question as Record<string, unknown>;
        if (
          typeof typed.id !== "string" ||
          typeof typed.question !== "string" ||
          !["select", "confirm", "input", "editor"].includes(String(typed.type))
        ) {
          return questions;
        }
        const options = Array.isArray(typed.options)
          ? typed.options.reduce<NonNullable<AgentUiBatchQuestion["options"]>>((items, option) => {
              if (typeof option === "string") {
                items.push(option);
                return items;
              }
              if (!option || typeof option !== "object") return items;
              const typedOption = option as Record<string, unknown>;
              if (typeof typedOption.label !== "string") return items;
              items.push({
                label: typedOption.label,
                ...(typeof typedOption.value === "string" ? { value: typedOption.value } : {}),
                ...(typeof typedOption.description === "string"
                  ? { description: typedOption.description }
                  : {}),
              });
              return items;
            }, [])
          : undefined;
        questions.push({
          id: typed.id,
          type: typed.type as AgentUiBatchQuestion["type"],
          question: typed.question,
          ...(options?.length ? { options } : {}),
          ...(typeof typed.allowOther === "boolean" ? { allowOther: typed.allowOther } : {}),
          ...(typeof typed.placeholder === "string" ? { placeholder: typed.placeholder } : {}),
          ...(typeof typed.prefill === "string" ? { prefill: typed.prefill } : {}),
        });
        return questions;
      }, [])
    : undefined;
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
    batchQuestions: batchQuestions?.length ? batchQuestions : undefined,
    batchReview: payload.batchReview === true,
  };
}

/** 清除某会话的 live 思考通道（换绑 / 卸载 / detach）。 */
function clearSessionLiveThinking(get: Getter, set: Setter, sessionId: string) {
  const liveId = get(liveThinkingIdBySessionAtom)[sessionId];
  const idsToDispose: string[] = [];
  if (liveId) {
    idsToDispose.push(liveId);
    set(streamingThinkingByIdAtom, (prevMap) => {
      if (!(liveId in prevMap)) return prevMap;
      const nextMap = { ...prevMap };
      delete nextMap[liveId];
      return nextMap;
    });
  } else {
    // 兜底：按 sessionId 扫一遍，防止 liveId 映射丢失后残留段。
    const map = get(streamingThinkingByIdAtom);
    const leftoverIds = Object.entries(map)
      .filter(([, entry]) => entry.sessionId === sessionId)
      .map(([id]) => id);
    if (leftoverIds.length > 0) {
      idsToDispose.push(...leftoverIds);
      set(streamingThinkingByIdAtom, (prevMap) => {
        const nextMap = { ...prevMap };
        for (const id of leftoverIds) delete nextMap[id];
        return nextMap;
      });
    }
  }
  set(liveThinkingIdBySessionAtom, (prevMap) => {
    if (!(sessionId in prevMap)) return prevMap;
    const nextMap = { ...prevMap };
    delete nextMap[sessionId];
    return nextMap;
  });
  for (const id of idsToDispose) disposeStreamingThinkingFamily(id);
}

/**
 * History 已写入同段 thinking 后才卸 live 身份。
 * done 与 agents:message 跨通道可能乱序；若 done 先清，会在 message.thinking 仍空时
 * 拆掉 ThinkingStep，等 History 到达再 remount → 整段糊屏。
 */
function tryReleaseLiveThinkingAfterHistory(get: Getter, set: Setter, sessionId: string) {
  const liveId = get(liveThinkingIdBySessionAtom)[sessionId];
  if (!liveId?.startsWith("msg-thinking-")) return;
  const messageId = liveId.slice("msg-thinking-".length);
  if (!messageId) return;
  const messages = get(sessionMessagesCacheAtom)[sessionId]?.messages ?? [];
  const ready = messages.some(
    (message) => message.id === messageId && Boolean(message.thinking?.trim()),
  );
  if (!ready) return;
  set(streamingThinkingByIdAtom, (prevMap) => {
    if (!(liveId in prevMap)) return prevMap;
    const nextMap = { ...prevMap };
    delete nextMap[liveId];
    return nextMap;
  });
  set(liveThinkingIdBySessionAtom, (prevMap) => {
    if (prevMap[sessionId] !== liveId) return prevMap;
    const nextMap = { ...prevMap };
    delete nextMap[sessionId];
    return nextMap;
  });
  // 数据条目与 family 实例成对释放（uuid 段 id 不复用，不 remove 会永久堆在 Map 里）。
  disposeStreamingThinkingFamily(liveId);
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
  if (!["select", "confirm", "input", "editor", "batch_ask"].includes(request.method)) {
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
      updatedAt: 0,
    };
    if (event.kind === "detach") {
      if (
        event.runtimeGeneration < currentRuntime.runtimeGeneration ||
        (currentRuntime.agentId && currentRuntime.agentId !== event.agentId)
      ) {
        return;
      }
      // Anonymous records only exist while their --no-session runtime exists.
      // Remove every renderer cache at detach so a future catalog refresh cannot
      // leave a closed anonymous row selectable in the sidebar.
      if (get(sessionRecordsAtom)[event.sessionId]?.noSession) {
        set(
          discardedTransientSessionIdsAtom,
          new Set(get(discardedTransientSessionIdsAtom)).add(event.sessionId),
        );
        set(removeSessionStateAtom, event.sessionId);
        return;
      }
      const nextUiById = { ...get(sessionRuntimeUiByIdAtom) };
      delete nextUiById[event.sessionId];
      set(sessionRuntimeUiByIdAtom, nextUiById);
      clearSessionLiveThinking(get, set, event.sessionId);
      set(sessionRuntimeByIdAtom, {
        ...get(sessionRuntimeByIdAtom),
        [event.sessionId]: {
          runtimeGeneration: event.runtimeGeneration,
          status: "detached",
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
            updatedAt: 0,
          }
        : currentRuntime),
      agentId: event.agentId,
      runtimeGeneration: event.runtimeGeneration,
      updatedAt: Date.now(),
    };
    if (bindingChanged) {
      clearSessionLiveThinking(get, set, event.sessionId);
    }
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
          noSession: payload.noSession === true || nextRuntime.noSession,
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
      // 缓存命中率快照入列：供「会话平均命中率」展示。
      // 只记有效百分比，避免把 undefined/瞬时抖动计入平均；
      // 连续相同的快照值跳过（流式期间 get_state 轮询会重复返回同一统计）。
      const hitPercent = (payload.state as AgentRuntimeState).cacheHitPercent;
      if (typeof hitPercent === "number" && Number.isFinite(hitPercent)) {
        const currentStats = get(sessionCacheStatsAtom)[event.sessionId] ?? { cacheHitHistory: [] };
        const history = currentStats.cacheHitHistory;
        if (history[history.length - 1] === hitPercent) {
          // 值未变化：不写 atom，避免 SessionHeader 无谓重渲染
        } else {
          const nextHistory = [...history, hitPercent].slice(-SESSION_CACHE_STATS_LIMIT);
          set(sessionCacheStatsAtom, {
            ...get(sessionCacheStatsAtom),
            [event.sessionId]: { cacheHitHistory: nextHistory },
          });
        }
      }
    } else if (event.sourceChannel === "agents:thinking" && payload) {
      // Live 思考：只更新 streamingThinkingByIdAtom / liveThinkingIdBySessionAtom。
      // 绑定未变时不写 sessionRuntimeByIdAtom，避免每帧戳醒 timeline。
      const id = typeof payload.id === "string" ? payload.id : "";
      const text =
        typeof payload.text === "string"
          ? payload.text
          : typeof payload.thinking === "string"
            ? payload.thinking
            : "";
      const done = payload.done === true;
      const startedAt = typeof payload.startedAt === "number" ? payload.startedAt : Date.now();
      const endedAt = typeof payload.endedAt === "number" ? payload.endedAt : 0;
      if (id) {
        if (done) {
          // 只标终态，保留 id/文本；等 History 同段 thinking 可见后再卸身份（防跨通道乱序 remount）。
          const prev = get(streamingThinkingByIdAtom)[id];
          const nextEntry: StreamingThinkingEntry = {
            sessionId: event.sessionId,
            text: text || prev?.text || "",
            startedAt: prev?.startedAt ?? startedAt,
            endedAt: endedAt > 0 ? endedAt : (prev?.endedAt && prev.endedAt > 0 ? prev.endedAt : Date.now()),
            streaming: false,
          };
          if (
            !prev ||
            prev.text !== nextEntry.text ||
            prev.startedAt !== nextEntry.startedAt ||
            prev.endedAt !== nextEntry.endedAt ||
            prev.streaming !== false ||
            prev.sessionId !== event.sessionId
          ) {
            set(streamingThinkingByIdAtom, {
              ...get(streamingThinkingByIdAtom),
              [id]: nextEntry,
            });
          }
          if (get(liveThinkingIdBySessionAtom)[event.sessionId] !== id) {
            set(liveThinkingIdBySessionAtom, {
              ...get(liveThinkingIdBySessionAtom),
              [event.sessionId]: id,
            });
          }
          tryReleaseLiveThinkingAfterHistory(get, set, event.sessionId);
        } else {
          const streaming = endedAt <= 0;
          const prev = get(streamingThinkingByIdAtom)[id];
          if (
            !prev ||
            prev.text !== text ||
            prev.startedAt !== startedAt ||
            prev.endedAt !== endedAt ||
            prev.streaming !== streaming ||
            prev.sessionId !== event.sessionId
          ) {
            set(streamingThinkingByIdAtom, {
              ...get(streamingThinkingByIdAtom),
              [id]: {
                sessionId: event.sessionId,
                text,
                startedAt,
                endedAt,
                streaming,
              },
            });
          }
          if (get(liveThinkingIdBySessionAtom)[event.sessionId] !== id) {
            set(liveThinkingIdBySessionAtom, {
              ...get(liveThinkingIdBySessionAtom),
              [event.sessionId]: id,
            });
          }
        }
      }
      if (bindingChanged) {
        set(sessionRuntimeByIdAtom, {
          ...get(sessionRuntimeByIdAtom),
          [event.sessionId]: nextRuntime,
        });
      }
      return;
    } else if (event.sourceChannel === "agents:text-stream" && payload) {
      // Live 正文：只更新 streamingTextByIdAtom。
      // 绑定未变时不写 sessionRuntimeByIdAtom，避免每帧戳醒 timeline/composer 订阅者。
      const text = typeof payload.text === "string" ? payload.text : "";
      const done = payload.done === true;
      const prev = get(streamingTextByIdAtom)[event.sessionId];
      const streaming = !done && text.length > 0;
      if (!prev || prev.content !== text || prev.streaming !== streaming) {
        set(streamingTextByIdAtom, {
          ...get(streamingTextByIdAtom),
          [event.sessionId]: { content: text, streaming },
        });
      }
      if (done) {
        set(streamingTextByIdAtom, (prevMap) => {
          if (!(event.sessionId in prevMap)) return prevMap;
          const nextMap = { ...prevMap };
          delete nextMap[event.sessionId];
          return nextMap;
        });
      }
      if (bindingChanged) {
        set(sessionRuntimeByIdAtom, {
          ...get(sessionRuntimeByIdAtom),
          [event.sessionId]: nextRuntime,
        });
      }
      return;
    } else if (
      (event.sourceChannel === "agents:message" || event.sourceChannel === "sessions:messages") &&
      payload
    ) {
      const messages = payload.messages;
      // 增量 flush 协议（2026-08 渲染卡顿优化）：主进程节流 flush 只发尾部增量
      // （upsertFrom + totalLength），终态 immediate flush 永远全量。
      // 激活显示窗口（2026-08 激活分页）：全量快照只含窗口段 [windowStart..]，
      // 窗口前历史由 disk 轮次分页 prepend（history 字段）；下标运算一律换算窗口偏移。
      const upsertFrom = typeof payload.upsertFrom === "number" ? payload.upsertFrom : undefined;
      const totalLength = typeof payload.totalLength === "number" ? payload.totalLength : undefined;
      const payloadWindowStart = typeof payload.windowStart === "number" ? payload.windowStart : undefined;
      const fileVersion = typeof payload.fileVersion === "string" ? payload.fileVersion : undefined;
      if (Array.isArray(messages)) {
        const current = get(sessionMessagesCacheAtom)[event.sessionId];
        if (upsertFrom !== undefined && totalLength !== undefined) {
          // 增量合并：upsertFrom 为 runtime 数组绝对下标，换算为本地窗口偏移；
          // 偏移无效（缓存缺失/磁盘来源/漏事件）则丢弃，等终态窗口化全量校准——
          // 中间态滞后至多为本轮回答内的显示延迟，终态到达后完全纠正。
          const W = current?.windowStart ?? 0;
          const offset = upsertFrom - W;
          if (current?.source === "runtime" && offset >= 0 && current.messages.length >= offset) {
            const merged = [
              ...current.messages.slice(0, offset),
              ...(messages as ChatMessage[]),
            ];
            if (W + merged.length === totalLength) {
              set(cacheSessionMessagesAtom, {
                sessionId: event.sessionId,
                messages: merged,
                source: "runtime",
                windowStart: W,
                history: current.history,
              });
            }
          }
        } else {
          // 窗口化全量 / 传统全量：替换运行时窗口段；
          // disk 前缀经版本守卫（压缩改写即失效）+ 接缝去重（窗口右移与前缀重叠）后保留
          const segment = messages as ChatMessage[];
          set(cacheSessionMessagesAtom, {
            sessionId: event.sessionId,
            messages: segment,
            source: "runtime",
            windowStart: payloadWindowStart,
            history: reconcileHistoryPrefix(current?.history, segment, fileVersion),
          });
        }
        // message 到达后若已含同段 thinking，安全卸 live（覆盖 done 先到的情况）。
        tryReleaseLiveThinkingAfterHistory(get, set, event.sessionId);
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
        updatedAt: Date.now(),
      },
    });
    if (bindingChanged) {
      clearSessionLiveThinking(get, set, input.sessionId);
    }
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
  const cacheStats = { ...get(sessionCacheStatsAtom) };
  delete cacheStats[sessionId];
  set(sessionCacheStatsAtom, cacheStats);
  const cache = { ...get(sessionMessagesCacheAtom) };
  delete cache[sessionId];
  set(sessionMessagesCacheAtom, cache);
  clearSessionLiveThinking(get, set, sessionId);
  set(streamingTextByIdAtom, (prevMap) => {
    if (!(sessionId in prevMap)) return prevMap;
    const nextMap = { ...prevMap };
    delete nextMap[sessionId];
    return nextMap;
  });
  set(sessionScrollAnchorByIdAtom, (prevMap) => {
    if (!(sessionId in prevMap)) return prevMap;
    const nextMap = { ...prevMap };
    delete nextMap[sessionId];
    return nextMap;
  });
  set(sessionMessageLruAtom, get(sessionMessageLruAtom).filter((id) => id !== sessionId));
  const loadState = { ...get(sessionMessageLoadStateAtom) };
  delete loadState[sessionId];
  set(sessionMessageLoadStateAtom, loadState);
  if (get(currentSessionIdAtom) === sessionId) set(currentSessionIdAtom, undefined);
});
