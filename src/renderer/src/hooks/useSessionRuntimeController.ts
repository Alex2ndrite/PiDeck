import { useCallback, useEffect, useRef } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import { selectAtom } from "jotai/utils";
import type { AgentTab, AgentUiResponse, SessionRecord } from "../../../shared/types";
import {
  claimSessionRuntimeUiResponseAtom,
  currentSessionAtom,
  currentSessionIdAtom,
  currentSessionRuntimeAtom,
  currentSessionRuntimeUiAtom,
  rollbackSessionRuntimeUiResponseAtom,
} from "../atoms/session-atoms";
import { currentSessionSendStateAtom } from "../atoms/composer-atoms";
import type { QueuedPrompt } from "./useQueuedPrompt";

// ── narrow selector (stable unless agentId changes; streaming state updates do NOT change this) ──

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
  sendSessionUiResponse: (requestId: string, response: AgentUiResponse) => void;
}

export interface UseSessionRuntimeControllerOptions {
  agents: AgentTab[];
  queueFlushByAgentRef: React.MutableRefObject<Set<string>>;
  queuedPrompts: Record<string, QueuedPrompt[]>;
  restartingAgentId: string | null;
  sessionDurationByAgent: Record<string, number>;
  activeProjectId: string | undefined;
  showNotice: (message: string, duration?: number) => void;
  showToast: (message: string, duration?: number) => void;
  api: {
    sessions: {
      sendUiResponse: (input: {
        sessionId: string;
        requestId: string;
        agentId: string;
        runtimeGeneration: number;
        response: AgentUiResponse;
      }) => Promise<void>;
    };
  };
}

export function useSessionRuntimeController(
  options: UseSessionRuntimeControllerOptions,
): SessionRuntimeController {
  const {
    agents,
    queueFlushByAgentRef,
    queuedPrompts,
    restartingAgentId,
    sessionDurationByAgent,
    activeProjectId,
    showNotice,
    showToast,
    api,
  } = options;

  const currentSessionId = useAtomValue(currentSessionIdAtom);
  const currentSession = useAtomValue(currentSessionAtom);
  const currentSessionRuntime = useAtomValue(currentSessionRuntimeAtom);
  const currentSessionRuntimeUi = useAtomValue(currentSessionRuntimeUiAtom);
  const currentSessionSendState = useAtomValue(currentSessionSendStateAtom);
  const activeAgentId = useAtomValue(activeAgentIdAtom);
  const claimSessionUiResponse = useSetAtom(claimSessionRuntimeUiResponseAtom);
  const rollbackSessionUiResponse = useSetAtom(rollbackSessionRuntimeUiResponseAtom);

  const currentSessionRuntimeRef = useRef(currentSessionRuntime);
  currentSessionRuntimeRef.current = currentSessionRuntime;

  const activeAgent = activeAgentId
    ? agents.find((a) => a.id === activeAgentId)
    : undefined;

  const hasActiveConversation = Boolean(currentSession);

  // ── runtime state (declared early, used by isAgentBusy) ──

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

  const canStopSession = activeAgent?.status === "running";

  const canRestartSession = Boolean(
    activeAgentId &&
    activeAgent &&
    activeAgent.status !== "starting" &&
    restartingAgentId !== activeAgentId &&
    !queueFlushByAgentRef.current.has(activeAgentId) &&
    !(queuedPrompts[activeAgentId] ?? []).some(
      (qp: QueuedPrompt) => qp.status === "sending" || qp.status === "unknown",
    ),
  );

  const isRestartingThisAgent = restartingAgentId === activeAgentId;

  const sessionDuration = activeAgentId
    ? sessionDurationByAgent[activeAgentId]
    : undefined;

  const sessionHasProject = Boolean(activeProjectId);

  // ── runtime UI bridge ──

  const sendSessionUiResponse = useCallback(
    (requestId: string, response: AgentUiResponse) => {
      const rt = currentSessionRuntimeRef.current;
      if (!currentSessionId || !rt) return;
      const input = {
        sessionId: currentSessionId,
        requestId,
        agentId: rt.agentId ?? "",
        runtimeGeneration: rt.runtimeGeneration,
      };
      const currentReq = currentSessionRuntimeUi?.requests[requestId];
      const request = currentReq?.request;
      if (!input.agentId || !request) return;
      if (
        currentReq?.status !== "responding" &&
        !claimSessionUiResponse({ ...input, request })
      )
        return;
      void api.sessions
        .sendUiResponse({ ...input, response })
        .catch((error: unknown) => {
          rollbackSessionUiResponse({ ...input, request });
          showToast(
            error instanceof Error ? error.message : String(error),
            4000,
          );
        });
    },
    [
      currentSessionId,
      currentSessionRuntimeUi,
      claimSessionUiResponse,
      rollbackSessionUiResponse,
      api.sessions,
      showToast,
    ],
  );

  // ── UI notification effect ──

  const lastNoticeRef = useRef("");
  useEffect(() => {
    const notification = currentSessionRuntimeUi?.notification;
    if (!currentSessionId || !notification) return;
    const key = `${currentSessionId}:${currentSessionRuntimeUi.runtimeGeneration}:${notification.revision}`;
    if (lastNoticeRef.current === key) return;
    lastNoticeRef.current = key;
    showNotice(
      notification.message,
      notification.notifyType === "error" ? 5000 : 3500,
    );
  }, [currentSessionId, currentSessionRuntimeUi, showNotice]);

  return {
    currentSessionId,
    currentSession,
    activeAgentId,
    activeRuntimeState,
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
    sendSessionUiResponse,
  };
}
