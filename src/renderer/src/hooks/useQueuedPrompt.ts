import { useState, useRef, useCallback } from "react";
import type { MutableRefObject } from "react";
import type { createStore } from "jotai";
import type {
  AgentTab,
  ComposerAgentMode,
  ImageContent,
} from "../../../shared/types";
import {
  acknowledgeUnknownPrompt,
  claimIdleHead,
  claimNextSteerPrompt,
  enqueuePrompt,
  QUEUED_PROMPT_LIMIT,
  replaceAgentQueue,
  resolveClaimedPrompt,
  retractPrompt,
  type QueuedPromptSnapshot,
} from "../utils/queuedPromptQueue";
import {
  sessionDraftByIdAtom,
  sessionAttachmentsByIdAtom,
  sessionComposerModeByIdAtom,
  setSessionDraftAtom,
  setSessionAttachmentsAtom,
  setSessionComposerModeAtom,
} from "../atoms/composer-atoms";
import { sessionIdByRuntimeAgentIdAtomFamily } from "../atoms/session-selectors";
import { runtimeCapabilityByAgentIdAtomFamily } from "../atoms/runtime-atoms";
import { PromptDeliveryUnknownError } from "./useComposerSend";

export type QueuedPrompt = QueuedPromptSnapshot;

export interface UseQueuedPromptOptions {
  displayAgentsRef: MutableRefObject<AgentTab[]>;
  activeAgentIdRef: MutableRefObject<string | undefined>;
  queueFlushByAgentRef: MutableRefObject<Set<string>>;
  composerTextareaRef: MutableRefObject<HTMLDivElement | null>;
  pendingComposerCaretRef: MutableRefObject<number | null>;
  livePromptByAgentRef: MutableRefObject<Record<string, string>>;

  /** Jotai store for resolving agent→Session binding in retract-to-edit. */
  store: ReturnType<typeof createStore>;

  promptByAgent: Record<string, string>;
  setPromptForAgent: (agentId: string, value: string | ((current: string) => string)) => void;
  setAttachedImagesForAgent: (agentId: string, value: ImageContent[] | ((current: ImageContent[]) => ImageContent[])) => void;
  setComposerAgentModeForAgent: (agentId: string, mode: ComposerAgentMode) => void;
  setComposerCursor: (value: React.SetStateAction<number>) => void;
  showToast: (message: string, duration?: number) => void;
  /** i18n-aware message shown when delivery result is unknown. */
  unknownDeliveryMessage?: string;

  dispatchPromptSnapshot: (
    agentId: string,
    message: string,
    images?: ImageContent[],
    streamingBehavior?: "steer" | "followUp",
    agentMode?: ComposerAgentMode,
    templateDescription?: string,
  ) => Promise<void>;
}

export function useQueuedPrompt(options: UseQueuedPromptOptions) {
  const {
    displayAgentsRef,
    activeAgentIdRef,
    queueFlushByAgentRef,
    composerTextareaRef,
    pendingComposerCaretRef,
    livePromptByAgentRef,
    store,
    promptByAgent,
    setPromptForAgent,
    setAttachedImagesForAgent,
    setComposerAgentModeForAgent,
    setComposerCursor,
    showToast,
    unknownDeliveryMessage = "消息可能未送达",
    dispatchPromptSnapshot,
  } = options;

  const [queuedPrompts, setQueuedPrompts] = useState<Record<string, QueuedPrompt[]>>({});
  const queuedPromptsRef = useRef<Record<string, QueuedPrompt[]>>({});

  function updateQueuedPrompts(
    updater: (current: Record<string, QueuedPrompt[]>) => Record<string, QueuedPrompt[]>,
  ) {
    const next = updater(queuedPromptsRef.current);
    queuedPromptsRef.current = next;
    setQueuedPrompts(next);
  }

  function setAgentQueuedPrompts(
    agentId: string,
    updater: (current: QueuedPrompt[]) => QueuedPrompt[],
  ) {
    updateQueuedPrompts((current) => replaceAgentQueue(current, agentId, updater));
  }

  /** 入队；满员时返回 false，调用方应保留输入框内容并 toast。 */
  function enqueueQueuedPrompt(agentId: string, queuedPrompt: QueuedPrompt): boolean {
    const before = queuedPromptsRef.current[agentId]?.length ?? 0;
    if (before >= QUEUED_PROMPT_LIMIT) return false;
    updateQueuedPrompts((current) => enqueuePrompt(current, agentId, queuedPrompt));
    return (queuedPromptsRef.current[agentId]?.length ?? 0) > before;
  }

  function appendUnknownQueuedPrompt(
    agentId: string,
    queuedPrompt: QueuedPrompt,
    error?: string,
  ) {
    setAgentQueuedPrompts(agentId, (current) => {
      if (current.length >= QUEUED_PROMPT_LIMIT) return current;
      return [
        ...current,
        { ...queuedPrompt, status: "unknown", error },
      ];
    });
  }

  function retractQueuedPrompt(agentId: string, promptId: string) {
    updateQueuedPrompts((current) => retractPrompt(current, agentId, promptId));
  }

  /** 丢弃：pending/failed 走 retract；unknown 仅移除提示（不重发）。sending 不可丢弃。 */
  function discardQueuedPrompt(agentId: string, promptId: string) {
    const live = queuedPromptsRef.current[agentId]?.find((item) => item.id === promptId);
    if (!live || live.status === "sending") return;
    if (live.status === "unknown") {
      updateQueuedPrompts((current) =>
        acknowledgeUnknownPrompt(current, agentId, promptId),
      );
      return;
    }
    retractQueuedPrompt(agentId, promptId);
  }

  function retractQueuedPromptForEdit(agentId: string, queuedPrompt: QueuedPrompt) {
    const livePrompt = queuedPromptsRef.current[agentId]?.find(
      (promptItem) => promptItem.id === queuedPrompt.id,
    );
    if (
      !livePrompt ||
      livePrompt.status === "sending" ||
      livePrompt.status === "unknown"
    ) return;
    retractQueuedPrompt(agentId, livePrompt.id);

    // Resolve Session binding; if found, restore through Session atoms so the modern
    // ComposerArea (which reads sessionDraftByIdAtom / sessionAttachmentsByIdAtom /
    // sessionComposerModeByIdAtom) sees the restored content immediately.
    const sessionId = store.get(sessionIdByRuntimeAgentIdAtomFamily(agentId));
    if (sessionId) {
      const currentDraft = store.get(sessionDraftByIdAtom)[sessionId] ?? "";
      const restoredPrompt = [livePrompt.displayText, currentDraft]
        .filter((text) => text.trim())
        .join("\n\n");
      store.set(setSessionDraftAtom, { sessionId, value: restoredPrompt });
      if (livePrompt.images?.length) {
        store.set(setSessionAttachmentsAtom, {
          sessionId,
          value: (current: ImageContent[]) => [...livePrompt.images!, ...current],
        });
      }
      store.set(setSessionComposerModeAtom, { sessionId, mode: livePrompt.agentMode });
      if (activeAgentIdRef.current === agentId) {
        setComposerCursor(restoredPrompt.length);
        pendingComposerCaretRef.current = restoredPrompt.length;
        requestAnimationFrame(() => {
          const editor = composerTextareaRef.current;
          editor?.focus();
          if (editor) editor.scrollTop = editor.scrollHeight;
        });
      }
      return;
    }

    // Legacy fallback: restore through agent-keyed maps (pre-Session agents).
    const currentDraft =
      livePromptByAgentRef.current[agentId] ?? promptByAgent[agentId] ?? "";
    const restoredPrompt = [livePrompt.displayText, currentDraft]
      .filter((text) => text.trim())
      .join("\n\n");
    setPromptForAgent(agentId, restoredPrompt);
    if (livePrompt.images?.length) {
      setAttachedImagesForAgent(agentId, (current) => [
        ...livePrompt.images!,
        ...current,
      ]);
    }
    setComposerAgentModeForAgent(agentId, livePrompt.agentMode);
    if (activeAgentIdRef.current === agentId) {
      setComposerCursor(restoredPrompt.length);
      pendingComposerCaretRef.current = restoredPrompt.length;
      requestAnimationFrame(() => {
        const editor = composerTextareaRef.current;
        editor?.focus();
        if (editor) editor.scrollTop = editor.scrollHeight;
      });
    }
  }

  function isAgentCurrentlyBusy(agentId: string) {
    const agent = displayAgentsRef.current.find((item) => item.id === agentId);
    const runtimeState = store.get(runtimeCapabilityByAgentIdAtomFamily(agentId));
    return Boolean(
      agent?.status === "starting" ||
      agent?.status === "running" ||
      runtimeState?.isStreaming ||
      runtimeState?.isExecutingTool,
    );
  }

  function canFlushQueuedPrompt(agentId: string) {
    const agent = displayAgentsRef.current.find((item) => item.id === agentId);
    return agent?.status === "idle" && !isAgentCurrentlyBusy(agentId);
  }

  async function flushQueuedSteerPrompts(agentId: string) {
    if (queueFlushByAgentRef.current.has(agentId) || !isAgentCurrentlyBusy(agentId)) return;
    queueFlushByAgentRef.current.add(agentId);
    try {
      while (isAgentCurrentlyBusy(agentId)) {
        const claimed = claimNextSteerPrompt(queuedPromptsRef.current, agentId);
        if (!claimed.prompt) break;
        const queuedPrompt = claimed.prompt;
        queuedPromptsRef.current = claimed.queues;
        setQueuedPrompts(claimed.queues);

        try {
          await dispatchPromptSnapshot(
            agentId,
            queuedPrompt.message,
            queuedPrompt.images,
            "steer",
            queuedPrompt.agentMode,
            queuedPrompt.templateDescription,
          );
          updateQueuedPrompts((current) =>
            resolveClaimedPrompt(current, agentId, queuedPrompt.id, {
              type: "accepted",
            }),
          );
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          const deliveryUnknown = error instanceof PromptDeliveryUnknownError;
          updateQueuedPrompts((current) =>
            resolveClaimedPrompt(current, agentId, queuedPrompt.id, {
              type: deliveryUnknown ? "unknown" : "failed",
              error: errorMessage,
            }),
          );
          showToast(
            deliveryUnknown ? unknownDeliveryMessage : errorMessage,
            deliveryUnknown ? 6000 : 4000,
          );
          break;
        }
      }
    } finally {
      queueFlushByAgentRef.current.delete(agentId);
      if (canFlushQueuedPrompt(agentId)) {
        void flushNextQueuedPrompt(agentId);
      }
    }
  }

  /** 串行策略：agent 每次空闲只发送队首，其余消息继续可撤回。 */
  async function flushNextQueuedPrompt(agentId: string) {
    if (queueFlushByAgentRef.current.has(agentId) || !canFlushQueuedPrompt(agentId)) return;
    const claimed = claimIdleHead(queuedPromptsRef.current, agentId);
    if (!claimed.prompt) return;
    const queuedPrompt = claimed.prompt;

    queuedPromptsRef.current = claimed.queues;
    setQueuedPrompts(claimed.queues);
    queueFlushByAgentRef.current.add(agentId);
    try {
      await dispatchPromptSnapshot(
        agentId,
        queuedPrompt.message,
        queuedPrompt.images,
        queuedPrompt.behavior === "direct" ? undefined : queuedPrompt.behavior,
        queuedPrompt.agentMode,
        queuedPrompt.templateDescription,
      );
      updateQueuedPrompts((current) =>
        resolveClaimedPrompt(current, agentId, queuedPrompt.id, {
          type: "accepted",
        }),
      );
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const deliveryUnknown = error instanceof PromptDeliveryUnknownError;
      updateQueuedPrompts((current) =>
        resolveClaimedPrompt(current, agentId, queuedPrompt.id, {
          type: deliveryUnknown ? "unknown" : "failed",
          error: errorMessage,
        }),
      );
      showToast(
        deliveryUnknown ? unknownDeliveryMessage : errorMessage,
        deliveryUnknown ? 6000 : 4000,
      );
    } finally {
      queueFlushByAgentRef.current.delete(agentId);
      window.setTimeout(() => {
        if (canFlushQueuedPrompt(agentId)) {
          void flushNextQueuedPrompt(agentId);
        }
      }, 150);
    }
  }

  return {
    queuedPrompts,
    setQueuedPrompts,
    queuedPromptsRef,
    updateQueuedPrompts,
    setAgentQueuedPrompts,
    enqueueQueuedPrompt,
    appendUnknownQueuedPrompt,
    retractQueuedPrompt,
    discardQueuedPrompt,
    retractQueuedPromptForEdit,
    isAgentCurrentlyBusy,
    canFlushQueuedPrompt,
    flushQueuedSteerPrompts,
    flushNextQueuedPrompt,
  };
}
