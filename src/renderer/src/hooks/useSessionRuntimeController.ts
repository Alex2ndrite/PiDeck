import { useEffect, useMemo, useRef } from "react";
import { useAtomValue } from "jotai";
import { selectAtom } from "jotai/utils";
import type { AgentTab, SessionRecord, SessionRuntimeTarget } from "../../../shared/types";
import {
  currentSessionIdAtom,
  currentSessionRuntimeAtom,
  sessionRecordsAtom,
  sessionRuntimeUiByIdAtom,
} from "../atoms/session-atoms";
import {
  sessionRecordByIdAtomFamily,
  sessionRuntimeBySessionIdAtomFamily,
  sessionRuntimeUiBySessionIdAtomFamily,
} from "../atoms/session-selectors";
import { sessionSendStateByIdAtom } from "../atoms/composer-atoms";
import type { QueuedPrompt } from "./useQueuedPrompt";
import { t } from "../i18n";
import { dismissNotice, type NoticeId } from "../utils/notice";

// ── narrow selector（供 App 等「当前聚焦会话 agentId」消费者）──

export const activeAgentIdAtom = selectAtom(
  currentSessionRuntimeAtom,
  (rt) => rt?.agentId,
);

// ── types ──

interface RuntimeStateLike {
  isStreaming?: boolean;
  [key: string]: unknown;
}

export interface SessionRuntimeController {
  currentSessionId: string | undefined;
  currentSession: SessionRecord | undefined;
  activeAgentId: string | undefined;
  activeRuntimeState: RuntimeStateLike | undefined;
  runtimeTarget: SessionRuntimeTarget | undefined;
  activeConversationStatus: "starting" | "running" | "idle" | undefined;
  hasActiveConversation: boolean;
  isAgentStarting: boolean;
  isAgentBusy: boolean;
  currentSessionLiveAgentId: string | undefined;
  canMutateActiveMessages: boolean;
  canStopSession: boolean;
  canRestartSession: boolean;
  sessionDuration: number | undefined;
  isRestartingThisAgent: boolean;
  sessionHasProject: boolean;
}

export interface UseSessionRuntimeControllerOptions {
  /** 绑定到指定会话；缺省则跟随 currentSessionIdAtom。 */
  sessionId?: string;
  agents: AgentTab[];
  queueFlushBySessionRef: React.MutableRefObject<Set<string>>;
  activeQueuedPrompts: QueuedPrompt[];
  restartingAgentId: string | null;
  sessionDurationByAgent: Record<string, number>;
  activeProjectId: string | undefined;
  showNotice: (message: string, duration?: number, kind?: "info" | "warning" | "error") => NoticeId | undefined;
}

const idleSendState = { status: "idle" as const };

/**
 * 会话 runtime 视图模型：始终按 sessionId 订阅 family，
 * 避免分屏时非聚焦栏被「另一栏的 current* 流式更新」牵连重渲染。
 */
export function useSessionRuntimeController(
  options: UseSessionRuntimeControllerOptions,
): SessionRuntimeController {
  const {
    sessionId: boundSessionIdOption,
    agents,
    queueFlushBySessionRef,
    activeQueuedPrompts,
    restartingAgentId,
    sessionDurationByAgent,
    activeProjectId,
    showNotice,
  } = options;

  const focusedSessionId = useAtomValue(currentSessionIdAtom);
  const currentSessionId = boundSessionIdOption ?? focusedSessionId;
  const isFocusedPane = currentSessionId === focusedSessionId;
  const sessionKey = currentSessionId ?? "";

  const recordAtom = useMemo(() => sessionRecordByIdAtomFamily(sessionKey), [sessionKey]);
  const runtimeAtom = useMemo(() => sessionRuntimeBySessionIdAtomFamily(sessionKey), [sessionKey]);
  const runtimeUiAtom = useMemo(() => sessionRuntimeUiBySessionIdAtomFamily(sessionKey), [sessionKey]);
  const sendAtom = useMemo(
    () =>
      selectAtom(
        sessionSendStateByIdAtom,
        (states) => (sessionKey ? (states[sessionKey] ?? idleSendState) : idleSendState),
        Object.is,
      ),
    [sessionKey],
  );

  const currentSession = useAtomValue(recordAtom);
  const currentSessionRuntime = useAtomValue(runtimeAtom);
  const currentSessionRuntimeUi = useAtomValue(runtimeUiAtom);
  const currentSessionSendState = useAtomValue(sendAtom);

  const sessionRuntimeUiById = useAtomValue(sessionRuntimeUiByIdAtom);
  const sessionRecords = useAtomValue(sessionRecordsAtom);

  const activeAgentId = currentSessionRuntime?.agentId;
  const runtimeTarget =
    currentSessionId && currentSessionRuntime?.agentId
      ? {
          sessionId: currentSessionId,
          agentId: currentSessionRuntime.agentId,
          runtimeGeneration: currentSessionRuntime.runtimeGeneration,
        }
      : undefined;
  const activeAgent = activeAgentId
    ? agents.find((a) => a.id === activeAgentId)
    : undefined;

  const hasActiveConversation = Boolean(currentSessionId);

  const activeRuntimeState: RuntimeStateLike | undefined = currentSessionId
    ? ((currentSessionRuntime?.state as RuntimeStateLike | undefined) ??
      (currentSession?.model || currentSession?.thinkingLevel
        ? {
            provider: currentSession.model?.provider,
            modelId: currentSession.model?.modelId,
            modelName: currentSession.model?.modelId,
            thinkingLevel: currentSession.thinkingLevel,
          }
        : undefined))
    : undefined;

  const activeConversationStatus: "starting" | "running" | "idle" | undefined =
    currentSessionId
      ? ((currentSessionRuntime?.status as "starting" | "running" | "idle" | undefined) ??
        (currentSessionSendState.status === "activating" ? "starting" : "idle"))
      : undefined;

  const isAgentStarting =
    activeConversationStatus === "starting" ||
    currentSessionSendState.status === "activating";

  const isAgentBusy = Boolean(
    hasActiveConversation &&
    (activeConversationStatus === "running" ||
      activeRuntimeState?.isStreaming),
  );

  const currentSessionLiveAgentId =
    currentSessionRuntime?.agentId === activeAgentId &&
    activeAgent &&
    activeAgent.status !== "closed" &&
    activeAgent.status !== "error"
      ? activeAgent.id
      : undefined;

  const canMutateActiveMessages = Boolean(currentSessionLiveAgentId);

  // ── SessionView shortcuts ──

  // 停止对已启动的 Agent 始终可用：running=执行中 / idle=空闲待命（进程仍在，
  // 停止可释放资源）；starting（启动中）、error、closed 不可停止；
  // pending（重启中）由 App.abortAgent 内部的 isPendingAgentId 防护忽略。
  const canStopSession =
    activeAgent?.status === "running" || activeAgent?.status === "idle";

  const canRestartSession = Boolean(
    currentSessionId &&
    activeAgentId &&
    activeAgent &&
    activeAgent.status !== "starting" &&
    restartingAgentId !== activeAgentId &&
    !queueFlushBySessionRef.current.has(currentSessionId) &&
    !activeQueuedPrompts.some(
      (qp: QueuedPrompt) => qp.status === "sending" || qp.status === "unknown",
    ),
  );

  const isRestartingThisAgent = restartingAgentId === activeAgentId;
  const sessionDuration = activeAgentId
    ? sessionDurationByAgent[activeAgentId]
    : undefined;
  const sessionHasProject = Boolean(activeProjectId);

  const lastNoticeRef = useRef("");
  const notifiedBackgroundAskRef = useRef<Set<string>>(new Set());
  const backgroundAskNoticeIdsRef = useRef<Map<string, NoticeId>>(new Map());

  useEffect(() => {
    const notification = currentSessionRuntimeUi?.notification;
    if (!currentSessionId || !notification) return;
    const key = `${currentSessionId}:${currentSessionRuntimeUi.runtimeGeneration}:${notification.revision}`;
    if (lastNoticeRef.current === key) return;
    lastNoticeRef.current = key;
    showNotice(
      notification.message,
      notification.notifyType === "error" || notification.notifyType === "warning" ? 3000 : 1500,
      notification.notifyType,
    );
  }, [currentSessionId, currentSessionRuntimeUi, showNotice]);

  useEffect(() => {
    if (!isFocusedPane) return;
    const activeBackgroundKeys = new Set<string>();
    for (const [sessionId, runtimeUi] of Object.entries(sessionRuntimeUiById)) {
      if (sessionId === focusedSessionId) continue;
      const pendingAsk = Object.values(runtimeUi.requests).find(({ request, status }) =>
        (status === "pending" || status === "responding") &&
        ["select", "confirm", "input", "editor", "batch_ask"].includes(request.method),
      );
      if (!pendingAsk) continue;

      const key = `${sessionId}:${runtimeUi.runtimeGeneration}:${pendingAsk.request.requestId}`;
      activeBackgroundKeys.add(key);
      if (notifiedBackgroundAskRef.current.has(key)) continue;
      notifiedBackgroundAskRef.current.add(key);
      const title = sessionRecords[sessionId]?.title?.trim() || pendingAsk.request.title || t("ask.defaultTitle");
      const noticeId = showNotice(t("ask.backgroundPending", { title }), Number.POSITIVE_INFINITY, "warning");
      if (noticeId !== undefined) backgroundAskNoticeIdsRef.current.set(key, noticeId);
    }

    for (const [key, noticeId] of backgroundAskNoticeIdsRef.current) {
      if (activeBackgroundKeys.has(key)) continue;
      dismissNotice(noticeId);
      backgroundAskNoticeIdsRef.current.delete(key);
      notifiedBackgroundAskRef.current.delete(key);
    }

    if (notifiedBackgroundAskRef.current.size > 200) {
      notifiedBackgroundAskRef.current = new Set(
        Array.from(notifiedBackgroundAskRef.current).slice(-100),
      );
    }
  }, [focusedSessionId, isFocusedPane, sessionRecords, sessionRuntimeUiById, showNotice]);

  return {
    currentSessionId,
    currentSession,
    activeAgentId,
    activeRuntimeState,
    runtimeTarget,
    activeConversationStatus,
    hasActiveConversation,
    isAgentStarting,
    isAgentBusy,
    currentSessionLiveAgentId,
    canMutateActiveMessages,
    canStopSession,
    canRestartSession,
    sessionDuration,
    isRestartingThisAgent,
    sessionHasProject,
  };
}
