import { useEffect, useRef } from "react";
import { useAtomValue } from "jotai";
import { selectAtom } from "jotai/utils";
import type { AgentTab, SessionRecord, SessionRuntimeTarget } from "../../../shared/types";
import {
  currentSessionAtom,
  currentSessionIdAtom,
  currentSessionRuntimeAtom,
  currentSessionRuntimeUiAtom,
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
  agents: AgentTab[];
  queueFlushBySessionRef: React.MutableRefObject<Set<string>>;
  activeQueuedPrompts: QueuedPrompt[];
  restartingAgentId: string | null;
  sessionDurationByAgent: Record<string, number>;
  activeProjectId: string | undefined;
  showNotice: (message: string, duration?: number) => void;
}

export function useSessionRuntimeController(
  options: UseSessionRuntimeControllerOptions,
): SessionRuntimeController {
  const {
    agents,
    queueFlushBySessionRef,
    activeQueuedPrompts,
    restartingAgentId,
    sessionDurationByAgent,
    activeProjectId,
    showNotice,
  } = options;

  const currentSessionId = useAtomValue(currentSessionIdAtom);
  const currentSession = useAtomValue(currentSessionAtom);
  const currentSessionRuntime = useAtomValue(currentSessionRuntimeAtom);
  const currentSessionRuntimeUi = useAtomValue(currentSessionRuntimeUiAtom);
  const currentSessionSendState = useAtomValue(currentSessionSendStateAtom);
  const activeAgentId = useAtomValue(activeAgentIdAtom);
	const runtimeTarget = currentSessionId && currentSessionRuntime?.agentId
		? {
			sessionId: currentSessionId,
			agentId: currentSessionRuntime.agentId,
			runtimeGeneration: currentSessionRuntime.runtimeGeneration,
		}
		: undefined;
  const activeAgent = activeAgentId
    ? agents.find((a) => a.id === activeAgentId)
    : undefined;

  // The renderer-only Chat bootstrap ID has no Catalog record until first send,
  // yet it must render the empty surface and composer without an Agent.
  const hasActiveConversation = Boolean(currentSessionId);

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
