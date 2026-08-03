import { useSetAtom, useStore } from "jotai";
import { useRef } from "react";
import type {
  ImageContent,
  SendSessionPromptInput,
  SendSessionPromptResult,
  SessionRuntimeTarget,
} from "../../../shared/types";
import {
  bindSessionRuntimeAtom,
  cacheSessionMessagesAtom,
  sessionAttachmentsByIdAtom,
  sessionMessagesCacheAtom,
  sessionComposerModeByIdAtom,
  sessionDraftByIdAtom,
  sessionRecordsAtom,
  sessionRuntimeByIdAtom,
  setSessionAttachmentsAtom,
  setSessionDraftAtom,
  setSessionSendStateAtom,
  upsertSessionAtom,
} from "../atoms";
import {
  buildComposerPromptSubmission,
  expandPromptTemplates,
} from "../composerBehavior";
import { translateI18nDescriptor } from "../i18n";

export type EnqueuePromptSnapshot = {
  displayText: string;
  message: string;
  images?: ImageContent[];
  agentMode: string;
  /** 排队投递策略，决定在 agent busy/idle 哪个阶段排空。 */
  behavior?: "steer" | "followUp";
};

type PromptTemplate = {
  name: string;
  path: string;
  description: string;
  content: string;
  argumentHint?: string;
};

type SessionPromptApi = (
  input: SendSessionPromptInput,
) => Promise<SendSessionPromptResult>;

export type UseSessionSendOptions = {
  /** Stable public identity for every draft, request, queue entry, and runtime binding. */
  sessionId: string;
  sendPrompt: SessionPromptApi;
  /** Promotes a renderer-only pre-send surface to a persistent Session. */
  ensureSessionId?: (sessionId: string) => Promise<string>;
  templates: PromptTemplate[];
  prepareMessage?: (message: string) => Promise<string>;
  onDraftMutation?: (sessionId: string) => void;
  compact: (target: SessionRuntimeTarget, prompt?: string) => Promise<void>;
  resetComposerUi?: () => void;
  recordPromptHistory?: (sessionId: string, message: string) => void;
  refreshProject?: (projectId: string) => void;
  showError?: (message: string, duration?: number) => void;
  showUnknown?: () => void;
  /** Called when streamingBehavior is "steer" before sending. Returns true if enqueued. */
  enqueue?: (sessionId: string, snapshot: EnqueuePromptSnapshot) => boolean;
};

export function normalizeComposerDomText(value: string): string {
  return value.replace(/\u200B/g, "");
}

export function mergeRejectedComposerDraft(
  rejectedDraft: string,
  currentDraft: string,
): string {
  return [rejectedDraft, currentDraft]
    .filter((text) => text.trim())
    .join("\n\n");
}

export function mergeRejectedComposerImages(
  rejectedImages: ImageContent[] | undefined,
  currentImages: ImageContent[],
): ImageContent[] {
  return rejectedImages?.length
    ? [...rejectedImages, ...currentImages]
    : currentImages;
}

export function hasComposerSubmission(
  message: string,
  images: ImageContent[] | undefined,
): boolean {
  return Boolean(message.trim() || images?.length);
}

export function classifySessionPromptResult(
  result: SendSessionPromptResult,
): "accepted" | "rejected" | "unknown" {
  if (result.accepted) return "accepted";
  return result.delivery === "unknown" ? "unknown" : "rejected";
}

export function createSessionSendLock() {
  const sessionIds = new Set<string>();
  return {
    has: (sessionId: string) => sessionIds.has(sessionId),
    claim: (sessionId: string) => {
      if (sessionIds.has(sessionId)) return false;
      sessionIds.add(sessionId);
      return true;
    },
    release: (sessionId: string) => {
      sessionIds.delete(sessionId);
    },
  };
}

export function useSessionSend(options: UseSessionSendOptions) {
  const store = useStore();
  const setDraft = useSetAtom(setSessionDraftAtom);
  const setAttachments = useSetAtom(setSessionAttachmentsAtom);
  const setCacheMessages = useSetAtom(cacheSessionMessagesAtom);
  const setSendState = useSetAtom(setSessionSendStateAtom);
  const bindRuntime = useSetAtom(bindSessionRuntimeAtom);
  const upsertSession = useSetAtom(upsertSessionAtom);
  const sendingSessionIdsRef = useRef<Set<string>>(new Set());

  function clearSnapshot(targetSessionId: string) {
    options.onDraftMutation?.(targetSessionId);
    setDraft({ sessionId: targetSessionId, value: "" });
    setAttachments({ sessionId: targetSessionId, value: [] });
  }

  function restoreRejectedSnapshot(
    targetSessionId: string,
    message: string,
    imageSnapshot?: ImageContent[],
  ) {
    options.onDraftMutation?.(targetSessionId);
    setDraft({
      sessionId: targetSessionId,
      value: (current) => [message, current]
        .filter((text) => text.trim())
        .join("\n\n"),
    });
    if (imageSnapshot) {
      setAttachments({
        sessionId: targetSessionId,
        value: (current) => [...imageSnapshot, ...current],
      });
    }
  }

  return async function sendSessionPrompt(
    streamingBehavior?: "steer" | "followUp",
  ) {
    const sourceSessionId = options.sessionId;
    if (sendingSessionIdsRef.current.has(sourceSessionId)) return;

    const message = store.get(sessionDraftByIdAtom)[sourceSessionId] ?? "";
    const attachmentSnapshot = store.get(sessionAttachmentsByIdAtom)[sourceSessionId] ?? [];
    const imageSnapshot = attachmentSnapshot.length
      ? [...attachmentSnapshot]
      : undefined;
    if (!hasComposerSubmission(message, imageSnapshot)) return;

    sendingSessionIdsRef.current.add(sourceSessionId);
    const requestId = crypto.randomUUID();
    const trimmedMessage = message.trim();
    const isCompactCommand = /^\/compact(?:\s|$)/.test(trimmedMessage);
    const usesLocalQueue = Boolean(
      options.enqueue &&
      (streamingBehavior === "steer" || streamingBehavior === "followUp"),
    );

    // 首次发送的运行时启动可能包含 spawn/get_state/会话绑定；先发布用户可见状态，
    // 让输入反馈与后台准备解耦，避免用户把冷启动时间误判成点击无效。
    // 队列和 /compact 保留原路径，因为它们分别需要排队快照或运行时命令语义。
    const publishOptimisticSubmission = (targetSessionId: string) => {
      setSendState({
        sessionId: targetSessionId,
        state: { status: "activating", requestId },
      });
      clearSnapshot(targetSessionId);
      const cacheEntry = store.get(sessionMessagesCacheAtom)?.[targetSessionId];
      const previousMessages = cacheEntry?.messages ?? [];
      setCacheMessages({
        sessionId: targetSessionId,
        messages: [...previousMessages, {
          id: requestId,
          agentId: "",
          role: "user" as const,
          text: message,
          timestamp: Date.now(),
          images: imageSnapshot,
        }],
        source: "runtime" as const,
      });
      options.resetComposerUi?.();
    };

    const publishBeforeActivation = !usesLocalQueue && !isCompactCommand;
    if (publishBeforeActivation) publishOptimisticSubmission(sourceSessionId);

    let sessionId = sourceSessionId;
    try {
      sessionId = options.ensureSessionId
        ? await options.ensureSessionId(sourceSessionId)
        : sourceSessionId;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      setSendState({
        sessionId: sourceSessionId,
        state: { status: "error", error: errorMessage },
      });
      options.showError?.(errorMessage, 4000);
      sendingSessionIdsRef.current.delete(sourceSessionId);
      return;
    }

    const runtime = store.get(sessionRuntimeByIdAtom)[sessionId];
    const runtimeTarget = runtime?.agentId
      ? {
          sessionId,
          agentId: runtime.agentId,
          runtimeGeneration: runtime.runtimeGeneration,
        }
      : undefined;
    const runtimeAgentId = runtimeTarget?.agentId;
    if (publishBeforeActivation && runtimeAgentId) {
      setSendState({
        sessionId,
        state: { status: "sending", requestId },
      });
      setCacheMessages({
        sessionId,
        messages: (store.get(sessionMessagesCacheAtom)?.[sessionId]?.messages ?? []).map((item) =>
          item.id === requestId ? { ...item, agentId: runtimeAgentId } : item,
        ),
        source: "runtime",
      });
    }
    if (isCompactCommand) {
      if (!runtimeAgentId) {
        // No Agent yet — let normal send path start Agent first;
        // pi will handle /compact command once active.
      } else {
        const compactPrompt = trimmedMessage.replace(/^\/compact\s*/, "").trim();
        clearSnapshot(sessionId);
        options.resetComposerUi?.();
        await options.compact(runtimeTarget, compactPrompt || undefined);
        return;
      }
    }

    // Queue shortcut: when the agent is busy, enqueue locally instead of sending through
    // the session API. The queue panel shows the pending item and drain dispatches it
    // through the appropriate flush path based on behavior:
    //   steer    → flushQueuedSteerPrompts (while agent is busy)
    //   followUp → flushNextQueuedPrompt (when agent becomes idle)
    if (options.enqueue && (streamingBehavior === "steer" || streamingBehavior === "followUp")) {
      const { message: expandedMessage } = expandPromptTemplates(
        message,
        options.templates,
      );
      const enqueued = options.enqueue(sessionId, {
        displayText: message,
        message: expandedMessage,
        images: imageSnapshot,
        agentMode: store.get(sessionComposerModeByIdAtom)[sessionId] ?? "normal",
        behavior: streamingBehavior,
      });
      if (enqueued) {
        clearSnapshot(sessionId);
        options.resetComposerUi?.();
        sendingSessionIdsRef.current.delete(sourceSessionId);
        return;
      }
      // Queue full: fall through to direct send.
    }

    if (!publishBeforeActivation) {
      setSendState({
        sessionId,
        state: {
          status: runtimeAgentId ? "sending" : "activating",
          requestId,
        },
      });
      clearSnapshot(sessionId);

      // Special paths publish only after their runtime/session target is known.
      const cacheEntry = store.get(sessionMessagesCacheAtom)?.[sessionId];
      const previousMessages = cacheEntry?.messages ?? [];
      setCacheMessages({
        sessionId,
        messages: [...previousMessages, {
          id: requestId,
          agentId: runtimeAgentId ?? "",
          role: "user" as const,
          text: message,
          timestamp: Date.now(),
          images: imageSnapshot,
        }],
        source: "runtime" as const,
      });
      options.resetComposerUi?.();
    }

    let preparedMessage = message;
    try {
      preparedMessage = options.prepareMessage
        ? await options.prepareMessage(message)
        : message;
    } catch (error) {
      restoreRejectedSnapshot(sessionId, message, imageSnapshot);
      const errorMessage = error instanceof Error ? error.message : String(error);
      setSendState({
        sessionId,
        state: { status: "error", requestId, error: errorMessage },
      });
      options.showError?.(errorMessage, 4000);
      sendingSessionIdsRef.current.delete(sourceSessionId);
      return;
    }

    const { message: expandedMessage, description } = expandPromptTemplates(
      preparedMessage,
      options.templates,
    );
    const submission = buildComposerPromptSubmission(
      expandedMessage,
      store.get(sessionComposerModeByIdAtom)[sessionId] ?? "normal",
    );

    try {
      const result = await options.sendPrompt({
        sessionId,
        requestId,
        message: submission.message,
        ...(imageSnapshot ? { images: imageSnapshot } : {}),
        ...(submission.agentMessage ? { agentMessage: submission.agentMessage } : {}),
        ...(description ? { description } : {}),
        ...(streamingBehavior ? { streamingBehavior } : {}),
      });
      if (result.agentId) {
        bindRuntime({
          sessionId,
          agentId: result.agentId,
          runtimeGeneration: result.runtimeGeneration,
          status: result.accepted ? "running" : undefined,
        });
      }

      const record = store.get(sessionRecordsAtom)[sessionId];
      if (record && result.sessionPath) {
        upsertSession({
          ...record,
          filePath: result.sessionPath,
          status: "active",
          updatedAt: Date.now(),
        });
      }

      const outcome = classifySessionPromptResult(result);
      const deliveryError = "error" in result
        ? translateI18nDescriptor(result, result.error)
        : "Prompt was not accepted";
      if (outcome === "accepted") {
        options.recordPromptHistory?.(sessionId, message);
        setSendState({ sessionId, state: { status: "idle" } });
        if (record) options.refreshProject?.(record.projectId);
      } else if (outcome === "unknown") {
        setSendState({
          sessionId,
          state: {
            status: "unknown",
            requestId,
            error: deliveryError,
            unknownSnapshot: {
              message,
              ...(imageSnapshot ? { images: imageSnapshot } : {}),
            },
          },
        });
        options.showUnknown?.();
      } else {
        restoreRejectedSnapshot(sessionId, message, imageSnapshot);
        setSendState({
          sessionId,
          state: { status: "error", requestId, error: deliveryError },
        });
        options.showError?.(deliveryError, 4000);
      }
    } catch (error) {
      setSendState({
        sessionId,
        state: {
          status: "unknown",
          requestId,
          error: error instanceof Error ? error.message : String(error),
          unknownSnapshot: {
            message,
            ...(imageSnapshot ? { images: imageSnapshot } : {}),
          },
        },
      });
      options.showUnknown?.();
    } finally {
      sendingSessionIdsRef.current.delete(sourceSessionId);
    }
  };
}
