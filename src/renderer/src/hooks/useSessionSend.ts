import { useAtomValue, useSetAtom, useStore } from "jotai";
import { useRef } from "react";
import type { MutableRefObject } from "react";
import type {
  ImageContent,
  SendSessionPromptInput,
  SendSessionPromptResult,
} from "../../../shared/types";
import {
  bindSessionRuntimeAtom,
  currentSessionIdAtom,
  sessionAttachmentsByIdAtom,
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
  /** Stable public identity. A8 can remove the fallback after App mounts the leaf. */
  sessionId?: string;
  sendPrompt: SessionPromptApi;
  /** @deprecated Atom state is authoritative; this callback is intentionally ignored. */
  getComposerText?: () => string;
  templates: PromptTemplate[];
  prepareMessage?: (message: string) => Promise<string>;
  onDraftMutation?: (sessionId: string) => void;
  compact: (agentId: string, prompt?: string) => Promise<void>;
  resetComposerUi?: () => void;
  recordPromptHistory?: (sessionId: string, message: string) => void;
  refreshProject?: (projectId: string) => void;
  showError?: (message: string, duration?: number) => void;
  showUnknown?: () => void;
  showCompactUnavailable?: () => void;
  /**
   * Temporary A8 compatibility only. It mirrors contentEditable input but is never the
   * persistent draft source; all send snapshots and restoration are atom-backed.
   */
  liveDraftsRef?: MutableRefObject<Record<string, string>>;
  /** @deprecated Runtime identity is derived from the Session binding. */
  runtimeAgentId?: string;
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
  const selectedSessionId = useAtomValue(currentSessionIdAtom);
  const store = useStore();
  const setDraft = useSetAtom(setSessionDraftAtom);
  const setAttachments = useSetAtom(setSessionAttachmentsAtom);
  const setSendState = useSetAtom(setSessionSendStateAtom);
  const bindRuntime = useSetAtom(bindSessionRuntimeAtom);
  const upsertSession = useSetAtom(upsertSessionAtom);
  const sendingSessionIdsRef = useRef<Set<string>>(new Set());

  function clearSnapshot(targetSessionId: string) {
    if (options.liveDraftsRef) {
      delete options.liveDraftsRef.current[targetSessionId];
    }
    options.onDraftMutation?.(targetSessionId);
    setDraft({ sessionId: targetSessionId, value: "" });
    setAttachments({ sessionId: targetSessionId, value: [] });
  }

  function restoreRejectedSnapshot(
    targetSessionId: string,
    message: string,
    imageSnapshot?: ImageContent[],
  ) {
    if (options.liveDraftsRef) {
      const currentLiveDraft = options.liveDraftsRef.current[targetSessionId] ?? "";
      options.liveDraftsRef.current[targetSessionId] = mergeRejectedComposerDraft(
        message,
        currentLiveDraft,
      );
    }
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
    const sessionId = options.sessionId ?? selectedSessionId;
    if (!sessionId || sendingSessionIdsRef.current.has(sessionId)) return;

    const message = store.get(sessionDraftByIdAtom)[sessionId] ?? "";
    const attachmentSnapshot = store.get(sessionAttachmentsByIdAtom)[sessionId] ?? [];
    const imageSnapshot = attachmentSnapshot.length
      ? [...attachmentSnapshot]
      : undefined;
    if (!hasComposerSubmission(message, imageSnapshot)) return;

    const runtimeAgentId = store.get(sessionRuntimeByIdAtom)[sessionId]?.agentId;
    const trimmedMessage = message.trim();
    if (/^\/compact(?:\s|$)/.test(trimmedMessage)) {
      if (!runtimeAgentId) {
        options.showCompactUnavailable?.();
        return;
      }
      const compactPrompt = trimmedMessage.replace(/^\/compact\s*/, "").trim();
      clearSnapshot(sessionId);
      options.resetComposerUi?.();
      await options.compact(runtimeAgentId, compactPrompt || undefined);
      return;
    }

    sendingSessionIdsRef.current.add(sessionId);
    const requestId = crypto.randomUUID();
    setSendState({
      sessionId,
      state: {
        status: runtimeAgentId ? "sending" : "activating",
        requestId,
      },
    });
    clearSnapshot(sessionId);
    options.resetComposerUi?.();

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
      sendingSessionIdsRef.current.delete(sessionId);
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
      const deliveryError = "error" in result ? result.error : "Prompt was not accepted";
      if (outcome === "accepted") {
        options.recordPromptHistory?.(sessionId, message);
        setSendState({ sessionId, state: { status: "idle" } });
        if (record) options.refreshProject?.(record.projectId);
      } else if (outcome === "unknown") {
        setSendState({
          sessionId,
          state: { status: "unknown", requestId, error: deliveryError },
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
        },
      });
      options.showUnknown?.();
    } finally {
      sendingSessionIdsRef.current.delete(sessionId);
    }
  };
}
