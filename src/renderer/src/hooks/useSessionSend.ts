import { useAtomValue, useSetAtom } from "jotai";
import { useRef } from "react";
import type { MutableRefObject } from "react";
import type {
  ImageContent,
  SendSessionPromptInput,
  SendSessionPromptResult,
} from "../../../shared/types";
import {
  bindSessionRuntimeAtom,
  currentSessionAttachmentsAtom,
  currentSessionComposerModeAtom,
  currentSessionDraftAtom,
  currentSessionIdAtom,
  sessionRecordsAtom,
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
  sendPrompt: SessionPromptApi;
  liveDraftsRef: MutableRefObject<Record<string, string>>;
  getComposerText: () => string;
  templates: PromptTemplate[];
  runtimeAgentId?: string;
  compact: (agentId: string, prompt?: string) => Promise<void>;
  resetComposerUi: () => void;
  recordPromptHistory: (sessionId: string, message: string) => void;
  refreshProject: (projectId: string) => void;
  showError: (message: string, duration?: number) => void;
  showUnknown: () => void;
  showCompactUnavailable: () => void;
};

export function useSessionSend(options: UseSessionSendOptions) {
  const sessionId = useAtomValue(currentSessionIdAtom);
  const draft = useAtomValue(currentSessionDraftAtom);
  const attachments = useAtomValue(currentSessionAttachmentsAtom);
  const composerMode = useAtomValue(currentSessionComposerModeAtom);
  const records = useAtomValue(sessionRecordsAtom);
  const setDraft = useSetAtom(setSessionDraftAtom);
  const setAttachments = useSetAtom(setSessionAttachmentsAtom);
  const setSendState = useSetAtom(setSessionSendStateAtom);
  const bindRuntime = useSetAtom(bindSessionRuntimeAtom);
  const upsertSession = useSetAtom(upsertSessionAtom);
  const sendingSessionIdsRef = useRef<Set<string>>(new Set());

  function clearSnapshot(targetSessionId: string) {
    delete options.liveDraftsRef.current[targetSessionId];
    setDraft({ sessionId: targetSessionId, value: "" });
    setAttachments({ sessionId: targetSessionId, value: [] });
  }

  function restoreRejectedSnapshot(
    targetSessionId: string,
    message: string,
    imageSnapshot?: ImageContent[],
  ) {
    const currentLiveDraft = options.liveDraftsRef.current[targetSessionId] ?? "";
    options.liveDraftsRef.current[targetSessionId] = [message, currentLiveDraft]
      .filter((text) => text.trim())
      .join("\n\n");
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
    if (!sessionId || sendingSessionIdsRef.current.has(sessionId)) return;

    const domText = options.getComposerText().replace(/\u200B/g, "");
    if (domText) options.liveDraftsRef.current[sessionId] = domText;
    const message = options.liveDraftsRef.current[sessionId] ?? draft;
    const imageSnapshot = attachments.length ? attachments : undefined;
    if (!message.trim() && !imageSnapshot?.length) return;

    const trimmedMessage = message.trim();
    if (/^\/compact(?:\s|$)/.test(trimmedMessage)) {
      if (!options.runtimeAgentId) {
        options.showCompactUnavailable();
        return;
      }
      const compactPrompt = trimmedMessage.replace(/^\/compact\s*/, "").trim();
      clearSnapshot(sessionId);
      await options.compact(options.runtimeAgentId, compactPrompt || undefined);
      return;
    }

    const requestId = crypto.randomUUID();
    sendingSessionIdsRef.current.add(sessionId);
    setSendState({
      sessionId,
      state: {
        status: options.runtimeAgentId ? "sending" : "activating",
        requestId,
      },
    });
    clearSnapshot(sessionId);
    options.resetComposerUi();

    const { message: expandedMessage, description } = expandPromptTemplates(
      message,
      options.templates,
    );
    const submission = buildComposerPromptSubmission(expandedMessage, composerMode);

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

      const record = records[sessionId];
      if (record && result.sessionPath) {
        upsertSession({
          ...record,
          filePath: result.sessionPath,
          status: "active",
          updatedAt: Date.now(),
        });
      }

      if (result.accepted) {
        options.recordPromptHistory(sessionId, message);
        setSendState({ sessionId, state: { status: "idle" } });
        if (record) options.refreshProject(record.projectId);
      } else if (result.delivery === "unknown") {
        setSendState({
          sessionId,
          state: { status: "unknown", requestId, error: result.error },
        });
        options.showUnknown();
      } else {
        restoreRejectedSnapshot(sessionId, message, imageSnapshot);
        setSendState({
          sessionId,
          state: { status: "error", requestId, error: result.error },
        });
        options.showError(result.error, 4000);
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
      options.showUnknown();
    } finally {
      sendingSessionIdsRef.current.delete(sessionId);
    }
  };
}
