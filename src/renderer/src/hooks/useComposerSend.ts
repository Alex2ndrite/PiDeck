import type React from "react";
import type { MutableRefObject } from "react";
import type {
  AgentTab,
  AppSettings,
  ChatMessage,
  ComposerAgentMode,
  ImageContent,
} from "../../../shared/types";
import {
  buildComposerPromptSubmission,
  expandPromptTemplates,
  getComposerEnterIntent,
} from "../composerBehavior";
import {
  applySuggestion,
  clearSuggestionTrigger,
  detectTrigger,
  type SuggestionItem,
} from "../components/app/AppUtils";
import { getCaretOffset as getCaretOffsetOf } from "../components/app/RichInput";
import { t } from "../i18n";

/** 发送锁：按 messageId 防重复重发。 */
export function createResendLock() {
  const ids = new Set<string>();
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  return {
    has: (id: string) => ids.has(id),
    claim: (id: string) => {
      if (ids.has(id)) return false;
      ids.add(id);
      const timer = setTimeout(() => ids.delete(id), 30_000);
      timers.set(id, timer);
      return true;
    },
    clearAll: () => {
      ids.clear();
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    },
  };
}

class PromptDeliveryUnknownError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PromptDeliveryUnknownError";
  }
}

export { PromptDeliveryUnknownError };

export type QueuedPromptCallbacks = {
  enqueue: (agentId: string, snapshot: {
    id: string;
    message: string;
    displayText: string;
    images?: ImageContent[];
    behavior: string;
    agentMode: ComposerAgentMode;
    templateDescription?: string;
    timestamp: number;
  }) => boolean;
  appendUnknown: (agentId: string, snapshot: {
    id: string;
    message: string;
    displayText: string;
    images?: ImageContent[];
    behavior: string;
    agentMode: ComposerAgentMode;
    templateDescription?: string;
    timestamp: number;
  }, error?: string) => void;
};

export interface UseComposerSendOptions {
  // Refs
  chatPaneRef: MutableRefObject<HTMLElement | null>;
  chatHeaderRef: MutableRefObject<HTMLElement | null>;
  composerRef: MutableRefObject<HTMLElement | null>;
  composerBoxRef: MutableRefObject<HTMLDivElement | null>;
  composerTextareaRef: MutableRefObject<HTMLDivElement | null>;
  timelineRef: MutableRefObject<HTMLElement | null>;
  pendingComposerCaretRef: MutableRefObject<number | null>;
  autoScrollRef: MutableRefObject<boolean>;
  programmaticScrollRef: MutableRefObject<boolean>;
  activeAgentIdRef: MutableRefObject<string | undefined>;
  currentSessionIdRef: MutableRefObject<string | undefined>;
  livePromptByAgentRef: MutableRefObject<Record<string, string>>;
  promptHistoryRef: MutableRefObject<Record<string, string[]>>;
  resendLockRef: MutableRefObject<ReturnType<typeof createResendLock>>;

  // Layout constants
  composerMinHeight: number;
  composerMinTimelineHeight: number;
  terminalRowHeight: number;

  // State values
  isAgentStarting: boolean;
  isAgentBusy: boolean;
  prompt: string;
  attachedImages: ImageContent[];
  currentComposerAgentMode: ComposerAgentMode;
  composerHeight: number;
  composerAutoHeight: number;
  suggestionsOpen: boolean;
  suggestionItems: SuggestionItem[];
  selectedSuggestionIndex: number;
  historyNavigating: boolean;
  historyIndex: number;
  savedPrompt: string;

  // State setters
  setHasComposerText: (value: React.SetStateAction<boolean>) => void;
  setComposerBangMode: (value: React.SetStateAction<"none" | "bang" | "bang-bang">) => void;
  setPrompt: (value: string | ((current: string) => string)) => void;
  setPromptForAgent: (agentId: string, value: string | ((current: string) => string)) => void;
  setAttachedImagesForAgent: (agentId: string, value: ImageContent[] | ((current: ImageContent[]) => ImageContent[])) => void;
  setAttachedImages: (value: ImageContent[] | ((current: ImageContent[]) => ImageContent[])) => void;
  setHistoryIndex: (value: React.SetStateAction<number>) => void;
  setHistoryNavigating: (value: React.SetStateAction<boolean>) => void;
  setSavedPrompt: (value: React.SetStateAction<string>) => void;
  setBusyDraftByAgent: (value: React.SetStateAction<Record<string, boolean>>) => void;
  setSuggestionsOpen: (value: React.SetStateAction<boolean>) => void;
  setSendBehaviorMenuOpen: (value: React.SetStateAction<boolean>) => void;
  setComposerAutoHeight: (value: React.SetStateAction<number>) => void;
  setComposerHeight: (value: React.SetStateAction<number>) => void;
  setSelectedSuggestionIndex: (value: React.SetStateAction<number>) => void;
  setAutoScroll: (value: React.SetStateAction<boolean>) => void;
  setComposerCursor: (value: React.SetStateAction<number>) => void;

  // Getters
  getComposerTargetId: () => string | undefined;
  getLiveComposerPrompt: () => string;

  // Templates
  promptTemplateList: Array<{ name: string; path: string; description: string; content: string; argumentHint?: string }>;

  // API
  api: {
    agents: {
      prompt: (input: {
        agentId: string;
        message: string;
        images?: ImageContent[];
        agentMessage?: string;
        description?: string;
        streamingBehavior?: string;
      }) => Promise<{ accepted: boolean; delivery?: string; error?: string; agentId?: string; sessionPath?: string; runtimeGeneration?: number }>;
      editMessage: (agentId: string, messageId: string, newText: string) => Promise<void>;
      deleteMessage: (agentId: string, messageId: string) => Promise<void>;
    };
  };

  // Settings
  settings: AppSettings;

  // Queued prompt callbacks (from H8)
  queuedPrompt: QueuedPromptCallbacks | undefined;

  // Session send
  sendCurrentSessionPrompt: (streamingBehavior?: "steer" | "followUp") => Promise<void>;

  // Other callbacks
  showToast: (message: string, duration?: number) => void;
  compactAgent: (compactPrompt?: string, agentId?: string) => Promise<void>;
  isPendingAgentId: (agentId: string) => boolean;
}

export function useComposerSend(options: UseComposerSendOptions) {
  const {
    chatPaneRef, chatHeaderRef, composerRef, composerBoxRef, composerTextareaRef,
    timelineRef, pendingComposerCaretRef, autoScrollRef, programmaticScrollRef,
    activeAgentIdRef, currentSessionIdRef, livePromptByAgentRef, promptHistoryRef,
    resendLockRef,
    composerMinHeight, composerMinTimelineHeight, terminalRowHeight,
    isAgentStarting, isAgentBusy, prompt, attachedImages, currentComposerAgentMode,
    composerHeight, composerAutoHeight,
    suggestionsOpen, suggestionItems, selectedSuggestionIndex,
    historyNavigating, historyIndex, savedPrompt,
    setHasComposerText, setComposerBangMode,
    setPrompt, setPromptForAgent, setAttachedImagesForAgent, setAttachedImages,
    setHistoryIndex, setHistoryNavigating, setSavedPrompt,
    setBusyDraftByAgent, setSuggestionsOpen, setSendBehaviorMenuOpen,
    setComposerAutoHeight, setComposerHeight, setSelectedSuggestionIndex,
    setAutoScroll, setComposerCursor,
    getComposerTargetId, getLiveComposerPrompt,
    promptTemplateList, api, settings,
    queuedPrompt,
    sendCurrentSessionPrompt,
    showToast, compactAgent, isPendingAgentId,
  } = options;

  // ── Composer flags ──

  function syncComposerFlags(text: string) {
    const hasContent = text.trim().length > 0;
    setHasComposerText((prev) => (prev !== hasContent ? hasContent : prev));
    const bangMode: "none" | "bang" | "bang-bang" = text.startsWith("!!")
      ? "bang-bang"
      : text.startsWith("!")
        ? "bang"
        : "none";
    setComposerBangMode((prev) => (prev !== bangMode ? bangMode : prev));
  }

  // ── Layout helpers ──

  function getComposerMaxHeight() {
    const chatPane = chatPaneRef.current;
    const header = chatHeaderRef.current;
    const composer = composerRef.current;
    const box = composerBoxRef.current;
    if (!chatPane || !header || !composer || !box) {
      const reservedTerminalHeight = terminalRowHeight;
      return Math.max(
        180,
        window.innerHeight -
          78 -
          composerMinTimelineHeight -
          52 -
          reservedTerminalHeight,
      );
    }

    const reservedTerminalHeight = terminalRowHeight;
    const composerChrome = Math.max(
      0,
      composer.offsetHeight - box.offsetHeight,
    );
    return Math.max(
      180,
      chatPane.clientHeight -
        header.offsetHeight -
        composerMinTimelineHeight -
        reservedTerminalHeight -
        composerChrome,
    );
  }

  function clampComposerHeight(height: number) {
    const maxHeight = getComposerMaxHeight();
    return Math.min(maxHeight, Math.max(composerMinHeight, height));
  }

  function ensureComposerTailVisible() {
    const editor = composerTextareaRef.current;
    if (!editor || document.activeElement !== editor) return;
    const len = editor.textContent?.length ?? 0;
    const atEnd = getCaretOffsetOf(editor) >= len;
    if (!atEnd) return;
    requestAnimationFrame(() => {
      const current = composerTextareaRef.current;
      if (!current) return;
      current.scrollTop = current.scrollHeight;
    });
  }

  function syncComposerAutoHeight() {
    const box = composerBoxRef.current;
    const editor = composerTextareaRef.current;
    if (!box || !editor) return;

    const chromeHeight = box.offsetHeight - editor.clientHeight;
    const nextHeight = clampComposerHeight(
      editor.scrollHeight + chromeHeight,
    );
    setComposerAutoHeight((current) =>
      Math.abs(current - nextHeight) <= 1 ? current : nextHeight,
    );
    ensureComposerTailVisible();
  }

  // ── Error translation ──

  function translateAgentErrorMessage(msg: string): string {
    if (msg.startsWith("BUSY_STREAMING:")) return t("message.busyStreaming");
    if (msg.startsWith("BUSY_TOOL:")) return t("message.busyTool");
    if (msg.startsWith("BUSY_GENERIC:")) return t("message.busyGeneric");
    return msg;
  }

  // ── Prompt dispatch ──

  async function dispatchPromptSnapshot(
    agentId: string,
    message: string,
    images?: ImageContent[],
    streamingBehavior?: "steer" | "followUp",
    agentMode: ComposerAgentMode = "normal",
    templateDescription?: string,
  ) {
    const submission = buildComposerPromptSubmission(message, agentMode);
    let result: Awaited<ReturnType<typeof api.agents.prompt>>;
    try {
      result = await api.agents.prompt({
        agentId,
        message: submission.message,
        images,
        ...(submission.agentMessage ? { agentMessage: submission.agentMessage } : {}),
        ...(templateDescription ? { description: templateDescription } : {}),
        ...(streamingBehavior ? { streamingBehavior } : {}),
      });
    } catch (error) {
      throw new PromptDeliveryUnknownError(
        error instanceof Error ? error.message : String(error),
      );
    }
    if (!result.accepted) {
      if (result.delivery === "unknown") {
        throw new PromptDeliveryUnknownError(result.error ?? "Unknown delivery error");
      }
      throw new Error(result.error ?? "Prompt was not accepted");
    }
  }

  async function submitPromptSnapshot(
    agentId: string,
    message: string,
    images?: ImageContent[],
    streamingBehavior?: "steer" | "followUp",
    agentMode: ComposerAgentMode = "normal",
    templateDescription?: string,
  ): Promise<boolean | "unknown"> {
    const behavior =
      streamingBehavior ??
      (agentId === activeAgentIdRef.current && isAgentBusy ? "steer" : undefined);
    try {
      await dispatchPromptSnapshot(
        agentId,
        message,
        images,
        behavior,
        agentMode,
        templateDescription,
      );
      return true;
    } catch (error) {
      if (error instanceof PromptDeliveryUnknownError) {
        showToast(t("app.queuedUnknown"), 6000);
        return "unknown" as const;
      }
      showToast(error instanceof Error ? error.message : String(error), 4000);
      return false;
    }
  }

  // ── Send ──

  async function sendPrompt(override?: {
    agentId: string;
    message: string;
    images: ImageContent[];
    agentMode: ComposerAgentMode;
  }) {
    if (!override && currentSessionIdRef.current) {
      return sendCurrentSessionPrompt(isAgentBusy ? "steer" : undefined);
    }
    const targetAgentId = override?.agentId ?? activeAgentIdRef.current;
    if (!override && targetAgentId) {
      const domText = (composerTextareaRef.current?.textContent ?? "").replace(/\u200B/g, "");
      if (domText) livePromptByAgentRef.current[targetAgentId] = domText;
    }
    const livePrompt = override?.message ?? (targetAgentId
      ? (livePromptByAgentRef.current[targetAgentId] ?? prompt)
      : prompt);
    const attachedImagesSnapshot = override?.images ?? attachedImages;
    const agentMode = override?.agentMode ?? currentComposerAgentMode;
    if (
      (!override && isAgentStarting) ||
      !targetAgentId ||
      (!livePrompt.trim() && attachedImagesSnapshot.length === 0)
    )
      return;
    const message = livePrompt;
    if (!override) delete livePromptByAgentRef.current[targetAgentId];
    const images = attachedImagesSnapshot.length > 0 ? attachedImagesSnapshot : undefined;

    const trimmedMessage = message.trim();

    if (/^\/compact(?:\s|$)/.test(trimmedMessage)) {
      const compactPrompt = trimmedMessage.replace(/^\/compact\s*/, "").trim();
      setPromptForAgent(targetAgentId, "");
      setAttachedImagesForAgent(targetAgentId, []);
      setSuggestionsOpen(false);
      await compactAgent(compactPrompt || undefined, targetAgentId);
      return;
    }

    if (message.trim() && !message.startsWith("!")) {
      const agentId = targetAgentId;
      const prev = promptHistoryRef.current[agentId] ?? [];
      const filtered = prev.filter(cmd => cmd !== message.trim());
      promptHistoryRef.current[agentId] = [message.trim(), ...filtered].slice(0, 50);
    }

    setHistoryIndex(-1);
    setHistoryNavigating(false);
    setSavedPrompt("");

    setAutoScroll(true);
    autoScrollRef.current = true;
    if (!override) {
      setPromptForAgent(targetAgentId, "");
      setAttachedImagesForAgent(targetAgentId, []);
    }
    setBusyDraftByAgent((current) => {
      if (!current[targetAgentId]) return current;
      const next = { ...current };
      delete next[targetAgentId];
      return next;
    });
    setSuggestionsOpen(false);
    setSendBehaviorMenuOpen(false);
    setComposerAutoHeight(composerMinHeight);

    const { message: expandedMessage, description: templateDescription } = expandPromptTemplates(message, promptTemplateList);

    const queuedPromptSnapshot = {
      id: crypto.randomUUID(),
      message: expandedMessage,
      displayText: message,
      images,
      behavior: "steer",
      agentMode,
      templateDescription,
      timestamp: Date.now(),
    };
    if (isAgentBusy) {
      if (!queuedPrompt?.enqueue(targetAgentId, queuedPromptSnapshot)) {
        setPromptForAgent(targetAgentId, (current) =>
          [message, current].filter((text) => text.trim()).join("\n\n"),
        );
        if (images) {
          setAttachedImagesForAgent(targetAgentId, (current) => [...images, ...current]);
        }
        showToast(t("app.queuedFull", { count: 10 }), 3000);
      }
      return;
    }

    const accepted = await submitPromptSnapshot(
      targetAgentId,
      expandedMessage,
      images,
      undefined,
      agentMode,
      templateDescription,
    );
    if (accepted === "unknown") {
      queuedPrompt?.appendUnknown?.(targetAgentId, {
        ...queuedPromptSnapshot,
        behavior: "direct",
      });
      return;
    }
    if (!accepted) {
      setPromptForAgent(targetAgentId, (current) =>
        [message, current].filter((text) => text.trim()).join("\n\n"),
      );
      if (images) {
        setAttachedImagesForAgent(targetAgentId, (current) => [...images, ...current]);
      }
      return;
    }
    requestAnimationFrame(() => {
      const el = timelineRef.current;
      if (el && autoScrollRef.current) {
        programmaticScrollRef.current = true;
        el.scrollTo({ top: el.scrollHeight, behavior: "instant" });
      }
    });
  }

  async function sendPromptAsFollowUp() {
    if (currentSessionIdRef.current) {
      await sendCurrentSessionPrompt("followUp");
      return;
    }
    const targetAgentId = activeAgentIdRef.current;
    const livePrompt = targetAgentId
      ? (livePromptByAgentRef.current[targetAgentId] ?? prompt)
      : prompt;
    if (
      isAgentStarting ||
      !targetAgentId ||
      (!livePrompt.trim() && attachedImages.length === 0)
    )
      return;
    const message = livePrompt;
    delete livePromptByAgentRef.current[targetAgentId];
    const images = attachedImages.length > 0 ? attachedImages : undefined;
    setAutoScroll(true);
    autoScrollRef.current = true;
    programmaticScrollRef.current = true;
    const scrollTimeline = timelineRef.current;
    if (scrollTimeline) scrollTimeline.scrollTo({ top: scrollTimeline.scrollHeight, behavior: "instant" });
    setPrompt("");
    setAttachedImages([]);
    if (message.trim() && !message.startsWith("!")) {
      const prev = promptHistoryRef.current[targetAgentId] ?? [];
      const filtered = prev.filter(cmd => cmd !== message.trim());
      promptHistoryRef.current[targetAgentId] = [message.trim(), ...filtered].slice(0, 50);
    }
    setHistoryIndex(-1);
    setHistoryNavigating(false);
    setSavedPrompt("");
    setBusyDraftByAgent((current) => {
      if (!current[targetAgentId]) return current;
      const next = { ...current };
      delete next[targetAgentId];
      return next;
    });
    setSuggestionsOpen(false);
    setSendBehaviorMenuOpen(false);
    setComposerAutoHeight(composerMinHeight);

    const queuedPromptSnapshot = {
      id: crypto.randomUUID(),
      message,
      displayText: message,
      images,
      behavior: "followUp",
      agentMode: currentComposerAgentMode,
      timestamp: Date.now(),
    };
    if (isAgentBusy) {
      if (!queuedPrompt?.enqueue(targetAgentId, queuedPromptSnapshot)) {
        setPromptForAgent(targetAgentId, (current) =>
          [message, current].filter((text) => text.trim()).join("\n\n"),
        );
        if (images) {
          setAttachedImagesForAgent(targetAgentId, (current) => [...images, ...current]);
        }
        showToast(t("app.queuedFull", { count: 10 }), 3000);
      }
      return;
    }

    const accepted = await submitPromptSnapshot(
      targetAgentId,
      message,
      images,
      "followUp",
      currentComposerAgentMode,
    );
    if (accepted === "unknown") {
      queuedPrompt?.appendUnknown?.(targetAgentId, queuedPromptSnapshot);
      return;
    }
    if (!accepted) {
      livePromptByAgentRef.current[targetAgentId] = message;
      setPromptForAgent(targetAgentId, (current) =>
        [message, current].filter((text) => text.trim()).join("\n\n"),
      );
      if (images) {
        setAttachedImagesForAgent(targetAgentId, (current) => [...images, ...current]);
      }
      return;
    }

    const scrollOnNewMessage = () => {
      const timeline = timelineRef.current;
      if (!timeline) return;
      const list = timeline.querySelector(".message-list");
      if (!list) return;
      const observer = new MutationObserver(() => {
        if (!autoScrollRef.current) return;
        programmaticScrollRef.current = true;
        timeline.scrollTo({ top: timeline.scrollHeight, behavior: "instant" });
      });
      observer.observe(list, { childList: true, subtree: false });
      setTimeout(() => observer.disconnect(), 8000);
    };
    requestAnimationFrame(scrollOnNewMessage);
  }

  // ── Message mutations ──

  function resendUserMessage(message: ChatMessage) {
    const activeAgentId = activeAgentIdRef.current;
    if (!activeAgentId || message.agentId !== activeAgentId) return;
    if (!resendLockRef.current.claim(message.id)) return;
    void submitPromptSnapshot(activeAgentId, message.text, message.images);
  }

  async function editMessage(messageId: string, newText: string) {
    const activeAgentId = activeAgentIdRef.current;
    if (!activeAgentId) return;
    try {
      await api.agents.editMessage(activeAgentId, messageId, newText);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      showToast(`${t("message.editFailed")}: ${translateAgentErrorMessage(msg)}`, 5000);
    }
  }

  function deleteMessage(messageId: string, onConfirm: (fn: () => void) => void) {
    const activeAgentId = activeAgentIdRef.current;
    if (!activeAgentId) return;
    onConfirm(async () => {
      try {
        await api.agents.deleteMessage(activeAgentId!, messageId);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        showToast(`${t("message.deleteFailed")}: ${translateAgentErrorMessage(msg)}`, 5000);
      }
    });
  }

  // ── Key handler ──

  function handleComposerKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (suggestionsOpen && suggestionItems.length > 0) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setSelectedSuggestionIndex((index) =>
          Math.min(index + 1, suggestionItems.length - 1),
        );
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setSelectedSuggestionIndex((index) => Math.max(index - 1, 0));
        return;
      }
      if (event.key === "Enter") {
        if ((event.nativeEvent as KeyboardEvent).isComposing || event.keyCode === 229) return;
        event.preventDefault();
        const selected =
          suggestionItems[
            Math.min(selectedSuggestionIndex, suggestionItems.length - 1)
          ];
        if (selected) {
          const el = event.currentTarget;
          const cursor = getCaretOffsetOf(el);
          const liveComposerPrompt = getLiveComposerPrompt();
          const result = applySuggestion(liveComposerPrompt, cursor, selected.value);
          setPrompt(result.text);
          setComposerCursor(result.cursor);
          pendingComposerCaretRef.current = result.cursor;
          setSuggestionsOpen(false);
          requestAnimationFrame(() => {
            composerTextareaRef.current?.focus();
          });
        }
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        const el = event.currentTarget;
        const cursor = getCaretOffsetOf(el);
        const liveComposerPrompt = getLiveComposerPrompt();
        const result = clearSuggestionTrigger(liveComposerPrompt, cursor);
        setPrompt(result.text);
        setComposerCursor(result.cursor);
        pendingComposerCaretRef.current = result.cursor;
        setSuggestionsOpen(false);
        requestAnimationFrame(() => {
          composerTextareaRef.current?.focus();
        });
        return;
      }
    }

    const editor = event.currentTarget;
    const cursorPos = getCaretOffsetOf(editor);
    const textBeforeCursor = prompt.substring(0, cursorPos);
    const isFirstLine = !textBeforeCursor.includes('\n');
    const textAfterCursor = prompt.substring(cursorPos);
    const isLastLine = !textAfterCursor.includes('\n');

    const agentHistory = promptHistoryRef.current[getComposerTargetId() ?? ""] ?? [];

    if (event.key === "ArrowUp" && isFirstLine && agentHistory.length > 0) {
      event.preventDefault();

      if (!historyNavigating) {
        setSavedPrompt(prompt);
        setHistoryNavigating(true);
        const newIndex = 0;
        setHistoryIndex(newIndex);
        setPrompt(agentHistory[newIndex]);
      } else {
        const newIndex = Math.min(historyIndex + 1, agentHistory.length - 1);
        if (newIndex !== historyIndex) {
          setHistoryIndex(newIndex);
          setPrompt(agentHistory[newIndex]);
        }
      }
      return;
    }

    if (event.key === "ArrowDown" && isLastLine && historyNavigating) {
      event.preventDefault();

      if (historyIndex > 0) {
        const newIndex = historyIndex - 1;
        if (newIndex >= agentHistory.length) {
          setHistoryIndex(-1);
          setHistoryNavigating(false);
          setSavedPrompt("");
          return;
        }
        setHistoryIndex(newIndex);
        setPrompt(agentHistory[newIndex]);
      } else {
        setHistoryIndex(-1);
        setHistoryNavigating(false);
        setPrompt(savedPrompt);
        setSavedPrompt("");
      }
      return;
    }

    if (event.key === "Escape") {
      const el = event.currentTarget;
      const cursor = getCaretOffsetOf(el);
      const liveComposerPrompt = getLiveComposerPrompt();
      const result = clearSuggestionTrigger(liveComposerPrompt, cursor);
      setPrompt(result.text);
      setComposerCursor(result.cursor);
      if (historyNavigating) {
        setPrompt(savedPrompt);
        setHistoryIndex(-1);
        setHistoryNavigating(false);
        setSavedPrompt("");
      }
    }
    const enterIntent = getComposerEnterIntent(event, settings.sendShortcut);
    if (enterIntent === "send") {
      event.preventDefault();
      void sendPrompt();
    } else if (enterIntent === "newline") {
      return;
    }
  }

  return {
    syncComposerFlags,
    getComposerMaxHeight,
    clampComposerHeight,
    ensureComposerTailVisible,
    syncComposerAutoHeight,
    translateAgentErrorMessage,
    dispatchPromptSnapshot,
    submitPromptSnapshot,
    sendPrompt,
    sendPromptAsFollowUp,
    resendUserMessage,
    editMessage,
    deleteMessage,
    handleComposerKeyDown,
  };
}
