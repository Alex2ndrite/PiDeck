import { useAtomValue, useSetAtom, useStore } from "jotai";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import type {
  FileTreeNode,
  ImageContent,
  PiCommand,
  SessionSummary,
} from "../../../shared/types";
import {
  sessionAttachmentsByIdAtom,
  sessionComposerModeByIdAtom,
  sessionDraftByIdAtom,
  sessionRecordByIdAtomFamily,
  sessionRuntimeBySessionIdAtomFamily,
  sessionRuntimeUiBySessionIdAtomFamily,
  sessionSendStateByIdAtom,
  sessionSummariesByProjectIdAtomFamily,
  setSessionAttachmentsAtom,
  setSessionComposerModeAtom,
  setSessionDraftAtom,
} from "../atoms";
import {
  getComposerEnterIntent,
  parseArgumentHint,
  translateBuiltinPromptDescription,
  type PromptTemplateInfo,
} from "../composerBehavior";
import {
  applySuggestion,
  buildSuggestionItems,
  clearSuggestionTrigger,
  detectTrigger,
  flattenFiles,
  mergeCommands,
} from "../components/app/AppUtils";
import {
  getCaretOffset,
  getRichInputCaretCoords,
  type RichInputChip,
} from "../components/app/RichInput";
import { desktopApi } from "../desktopApi";
import { t } from "../i18n";
import {
  ComposerImageError,
  getClipboardImageFiles,
  getDroppedImageFiles,
  processComposerImageFile,
} from "../utils/composerImages";
import { showNotice } from "../utils/notice";
import { useSessionSend } from "./useSessionSend";

export type ComposerPickerKind = "model" | "mode" | "thinking" | "template";

export type UseSessionComposerControllerOptions = {
  sessionId: string;
  onOpenFile?: (path: string) => void;
};

export type ComposerDraftGuard = {
  sessionId: string;
  agentId?: string;
  runtimeGeneration: number;
  baselineDraft: string;
  version: number;
  pristine: boolean;
};

export function createComposerDraftGuard(input: {
  sessionId: string;
  agentId?: string;
  runtimeGeneration?: number;
  draft: string;
}): ComposerDraftGuard {
  return {
    sessionId: input.sessionId,
    agentId: input.agentId,
    runtimeGeneration: input.runtimeGeneration ?? 0,
    baselineDraft: input.draft,
    version: 0,
    pristine: input.draft.length === 0,
  };
}

export function markComposerDraftMutation(
  guard: ComposerDraftGuard,
): ComposerDraftGuard {
  return { ...guard, version: guard.version + 1, pristine: false };
}

export function canApplyRuntimeEditorText(
  guard: ComposerDraftGuard,
  input: {
    sessionId: string;
    agentId: string;
    runtimeGeneration: number;
    currentDraft: string;
  },
): boolean {
  return guard.sessionId === input.sessionId &&
    guard.agentId === input.agentId &&
    guard.runtimeGeneration === input.runtimeGeneration &&
    guard.pristine &&
    guard.baselineDraft === input.currentDraft;
}

export type LatestRequestToken = { key: string; sequence: number };

export function createLatestRequestGate() {
  let current = { key: "", sequence: 0 };
  return {
    begin(key: string): LatestRequestToken {
      current = { key, sequence: current.sequence + 1 };
      return current;
    },
    invalidate(key: string) {
      current = { key, sequence: current.sequence + 1 };
    },
    isCurrent(token: LatestRequestToken) {
      return token.key === current.key && token.sequence === current.sequence;
    },
  };
}

type SessionReferenceMessage = {
  role: string;
  content: string;
  timestamp: number;
};

export type SessionReferenceSelection = {
  selectedIndices: number[];
  entries: Array<{ index: number; message: SessionReferenceMessage }>;
};

export function createSessionReferenceSelection(
  selectedIndices: number[],
  selectedMessages: SessionReferenceMessage[],
): SessionReferenceSelection {
  const entries = selectedIndices
    .map((index, position) => ({ index, message: selectedMessages[position] }))
    .filter((entry): entry is { index: number; message: SessionReferenceMessage } =>
      Boolean(entry.message),
    );
  return { selectedIndices: entries.map((entry) => entry.index), entries };
}

export function selectedSessionReferenceMessages(
  selection: SessionReferenceSelection,
): SessionReferenceMessage[] {
  return [...selection.entries]
    .sort((left, right) => left.index - right.index)
    .map((entry) => entry.message);
}

function getBangMode(text: string): "none" | "bang" | "bang-bang" {
  if (text.startsWith("!!")) return "bang-bang";
  if (text.startsWith("!")) return "bang";
  return "none";
}

function composerImageNotice(error: unknown): string {
  if (error instanceof ComposerImageError) {
    if (error.code === "too-large") return t("app.imageTooLarge");
    if (error.code === "unsupported") return t("app.imageUnsupported");
  }
  return error instanceof Error ? error.message : String(error);
}

export function useSessionComposerController(
  options: UseSessionComposerControllerOptions,
) {
  const { sessionId } = options;
  const store = useStore();
  const record = useAtomValue(sessionRecordByIdAtomFamily(sessionId));
  const runtime = useAtomValue(sessionRuntimeBySessionIdAtomFamily(sessionId));
  const runtimeUi = useAtomValue(sessionRuntimeUiBySessionIdAtomFamily(sessionId));
  const projectSessions = useAtomValue(
    sessionSummariesByProjectIdAtomFamily(record?.projectId ?? ""),
  );
  const drafts = useAtomValue(sessionDraftByIdAtom);
  const attachmentsBySession = useAtomValue(sessionAttachmentsByIdAtom);
  const modes = useAtomValue(sessionComposerModeByIdAtom);
  const sendStates = useAtomValue(sessionSendStateByIdAtom);
  const setDraftAtom = useSetAtom(setSessionDraftAtom);
  const setAttachmentsAtom = useSetAtom(setSessionAttachmentsAtom);
  const setModeAtom = useSetAtom(setSessionComposerModeAtom);

  const draft = drafts[sessionId] ?? "";
  const attachments = attachmentsBySession[sessionId] ?? [];
  const mode = modes[sessionId] ?? "normal";
  const sendState = sendStates[sessionId] ?? { status: "idle" as const };
  const editorRef = useRef<HTMLDivElement | null>(null);
  const caretRef = useRef<number | null>(null);
  const liveDomDraftRef = useRef({ sessionId, value: draft });
  const draftGuardRef = useRef(createComposerDraftGuard({
    sessionId,
    agentId: runtime?.agentId,
    runtimeGeneration: runtime?.runtimeGeneration,
    draft,
  }));
  const templateRequestGateRef = useRef(createLatestRequestGate());
  const promptHistoryRef = useRef<Record<string, string[]>>({});
  const sendBehaviorCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastEditorTextEnvelopeRef = useRef("");
  const [cursor, setCursor] = useState(0);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [selectedSuggestionIndex, setSelectedSuggestionIndex] = useState(0);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [savedDraft, setSavedDraft] = useState("");
  const [busyDraftLocked, setBusyDraftLocked] = useState(false);
  const [sendBehaviorMenuOpen, setSendBehaviorMenuOpen] = useState(false);
  const [previewImage, setPreviewImage] = useState<ImageContent | null>(null);
  const [picker, setPicker] = useState<ComposerPickerKind | null>(null);
  const [commands, setCommands] = useState<PiCommand[]>([]);
  const [files, setFiles] = useState<FileTreeNode[]>([]);
  const templateKey = `${sessionId}:${record?.projectPath ?? ""}`;
  const [templateState, setTemplateState] = useState<{
    key: string;
    items: PromptTemplateInfo[];
  }>({ key: templateKey, items: [] });
  const templates = templateState.key === templateKey ? templateState.items : [];
  const [sendShortcut, setSendShortcut] = useState<
    "enter-send" | "ctrl-enter-send" | "shift-enter-send"
  >("enter-send");
  const [sessionReference, setSessionReference] = useState<SessionSummary | null>(null);
  const [sessionReferenceSelections, setSessionReferenceSelections] = useState<
    Record<string, SessionReferenceSelection>
  >({});

  const markDraftMutation = useCallback((targetSessionId = sessionId) => {
    if (targetSessionId !== sessionId) return;
    draftGuardRef.current = markComposerDraftMutation(draftGuardRef.current);
  }, [sessionId]);

  const setDraft = useCallback((value: string | ((current: string) => string)) => {
    markDraftMutation();
    setDraftAtom({ sessionId, value });
  }, [markDraftMutation, sessionId, setDraftAtom]);

  const setAttachments = useCallback((
    value: ImageContent[] | ((current: ImageContent[]) => ImageContent[]),
  ) => {
    setAttachmentsAtom({ sessionId, value });
  }, [sessionId, setAttachmentsAtom]);

  const setMode = useCallback((nextMode: "normal" | "plan") => {
    setModeAtom({ sessionId, mode: nextMode });
  }, [sessionId, setModeAtom]);

  const loadTemplates = useCallback(async () => {
    const token = templateRequestGateRef.current.begin(templateKey);
    const next: PromptTemplateInfo[] = [];
    try {
      const globalResult = await desktopApi.prompts.list();
      next.push(...globalResult.templates.map((template) => ({
        ...template,
        description: translateBuiltinPromptDescription(template),
        argumentHint: parseArgumentHint(template.content),
      })));
    } catch {
      // Project templates remain usable when the global store is unavailable.
    }
    if (record?.projectPath) {
      try {
        const projectResult = await desktopApi.prompts.listByProject(record.projectPath);
        next.push(...projectResult.templates.map((template) => ({
          ...template,
          argumentHint: parseArgumentHint(template.content),
        })));
      } catch {
        // A project does not have to provide .pi/prompts.
      }
    }
    if (templateRequestGateRef.current.isCurrent(token)) {
      setTemplateState({ key: templateKey, items: next });
    }
    return next;
  }, [record?.projectPath, sessionId, templateKey]);

  useEffect(() => {
    liveDomDraftRef.current = { sessionId, value: draft };
    setCursor(draft.length);
    setSuggestionsOpen(false);
    setSelectedSuggestionIndex(0);
    setHistoryIndex(-1);
    setSavedDraft("");
    setBusyDraftLocked(false);
    setSendBehaviorMenuOpen(false);
    caretRef.current = draft.length;
    draftGuardRef.current = createComposerDraftGuard({
      sessionId,
      agentId: runtime?.agentId,
      runtimeGeneration: runtime?.runtimeGeneration,
      draft,
    });
    lastEditorTextEnvelopeRef.current = "";
  }, [sessionId]);

  useEffect(() => {
    const currentDraft = store.get(sessionDraftByIdAtom)[sessionId] ?? "";
    draftGuardRef.current = createComposerDraftGuard({
      sessionId,
      agentId: runtime?.agentId,
      runtimeGeneration: runtime?.runtimeGeneration,
      draft: currentDraft,
    });
    lastEditorTextEnvelopeRef.current = "";
  }, [runtime?.agentId, runtime?.runtimeGeneration, sessionId, store]);

  useEffect(() => {
    if (
      liveDomDraftRef.current.sessionId === sessionId &&
      liveDomDraftRef.current.value !== draft
    ) {
      liveDomDraftRef.current = { sessionId, value: draft };
    }
  }, [draft, sessionId]);

  useEffect(() => {
    const editorText = runtimeUi?.editorText;
    if (
      !runtime?.agentId ||
      !editorText ||
      runtimeUi.agentId !== runtime.agentId ||
      runtimeUi.runtimeGeneration !== runtime.runtimeGeneration
    ) {
      return;
    }
    const envelope = `${sessionId}:${runtime.runtimeGeneration}:${editorText.revision}`;
    if (lastEditorTextEnvelopeRef.current === envelope) return;
    lastEditorTextEnvelopeRef.current = envelope;
    const currentDraft = store.get(sessionDraftByIdAtom)[sessionId] ?? "";
    if (!canApplyRuntimeEditorText(draftGuardRef.current, {
      sessionId,
      agentId: runtime.agentId,
      runtimeGeneration: runtime.runtimeGeneration,
      currentDraft,
    })) {
      return;
    }
    liveDomDraftRef.current = { sessionId, value: editorText.text };
    setDraft(editorText.text);
    setCursor(editorText.text.length);
    caretRef.current = editorText.text.length;
  }, [runtime, runtimeUi, sessionId, setDraft, store]);

  useEffect(() => {
    void desktopApi.settings.get().then((settings) => {
      setSendShortcut(settings.sendShortcut);
    }).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!record?.projectId) {
      setFiles([]);
      return;
    }
    let current = true;
    void desktopApi.files.list(record.projectId).then((next) => {
      if (current) setFiles(next);
    }).catch(() => {
      if (current) setFiles([]);
    });
    return () => {
      current = false;
    };
  }, [record?.projectId]);

  useEffect(() => {
    const agentId = runtime?.agentId;
    if (!agentId) {
      setCommands([]);
      return;
    }
    let current = true;
    void desktopApi.agents.commands(agentId).then((next) => {
      if (current) setCommands(next);
    }).catch(() => {
      if (current) setCommands([]);
    });
    return () => {
      current = false;
    };
  }, [runtime?.agentId, runtime?.runtimeGeneration]);

  useEffect(() => {
    templateRequestGateRef.current.invalidate(templateKey);
    setTemplateState({ key: templateKey, items: [] });
    void loadTemplates();
  }, [loadTemplates, templateKey]);

  useEffect(() => () => {
    if (sendBehaviorCloseTimerRef.current) {
      clearTimeout(sendBehaviorCloseTimerRef.current);
    }
  }, []);

  const flatFiles = useMemo(() => flattenFiles(files), [files]);
  const mergedCommands = useMemo(() => mergeCommands(commands), [commands]);
  const validCommandNames = useMemo(() => new Set([
    ...mergedCommands.map((command) => command.name),
    ...templates.map((template) => template.name),
  ]), [mergedCommands, templates]);
  const validFilePaths = useMemo(
    () => new Set(flatFiles.map((file) => file.relativePath)),
    [flatFiles],
  );
  const validSessionRefs = useMemo(
    () => new Set(projectSessions.map((session) => session.name ?? session.filePath)),
    [projectSessions],
  );
  const suggestionItems = useMemo(
    () => suggestionsOpen
      ? buildSuggestionItems(draft, cursor, commands, flatFiles, projectSessions)
      : [],
    [commands, cursor, draft, flatFiles, projectSessions, suggestionsOpen],
  );
  const suggestionAnchorStyle = useMemo<CSSProperties | undefined>(() => {
    if (!suggestionsOpen || !editorRef.current) return undefined;
    const coordinates = getRichInputCaretCoords(editorRef.current, cursor);
    if (!coordinates) return undefined;
    const menuWidth = Math.min(520, window.innerWidth - 120);
    const menuHeight = 380;
    const gap = 8;
    let left = coordinates.left;
    if (left + menuWidth > window.innerWidth - 16) {
      left = Math.max(16, window.innerWidth - menuWidth - 16);
    }
    const below = coordinates.top + gap;
    if (below + menuHeight <= window.innerHeight - 16) {
      return { top: below, left, bottom: "auto", transform: "none" };
    }
    const above = coordinates.top - gap;
    if (above - menuHeight >= 0) {
      return {
        top: "auto",
        bottom: window.innerHeight - above,
        left,
        transform: "none",
      };
    }
    return { top: "auto", bottom: 16, left, transform: "none" };
  }, [cursor, suggestionsOpen]);

  const isBusy = runtime?.status === "running" || Boolean(runtime?.state?.isStreaming);
  const isStarting = runtime?.status === "starting" || sendState.status === "activating";
  const hasContent = Boolean(draft.trim() || attachments.length);

  const resetEphemeralUi = useCallback(() => {
    setHistoryIndex(-1);
    setSavedDraft("");
    setSuggestionsOpen(false);
    setSendBehaviorMenuOpen(false);
    setBusyDraftLocked(false);
    liveDomDraftRef.current = { sessionId, value: "" };
  }, [sessionId]);

  const resolveSessionReferences = useCallback(async (message: string) => {
    let resolved = message;
    const sessionsByLongestName = [...projectSessions].sort(
      (left, right) =>
        (right.name ?? right.filePath).length - (left.name ?? left.filePath).length,
    );
    for (const referencedSession of sessionsByLongestName) {
      const sessionName = referencedSession.name ?? referencedSession.filePath;
      const raw = `&${sessionName}`;
      if (!resolved.toLowerCase().includes(raw.toLowerCase())) continue;
      const escaped = raw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const pattern = new RegExp(escaped, "gi");
      const saved = sessionReferenceSelections[raw];
      const selectedMessages = saved
        ? selectedSessionReferenceMessages(saved)
        : await desktopApi.sessions.readMessages(referencedSession.filePath);
      const context = selectedMessages
        .map((item) => `[${item.role === "user" ? "User" : "Assistant"}]: ${item.content}`)
        .join("\n");
      resolved = resolved.replace(
        pattern,
        context
          ? `<referenced_session name="${sessionName}">\n${context}\n</referenced_session>`
          : "",
      );
    }
    return resolved;
  }, [projectSessions, sessionReferenceSelections]);

  const send = useSessionSend({
    sessionId,
    sendPrompt: (input) => desktopApi.sessions.sendPrompt(input),
    templates,
    prepareMessage: resolveSessionReferences,
    onDraftMutation: markDraftMutation,
    compact: async (agentId, prompt) => {
      await desktopApi.agents.compact(agentId, prompt);
    },
    resetComposerUi: resetEphemeralUi,
    recordPromptHistory: (targetSessionId, message) => {
      if (!message.trim() || message.startsWith("!")) return;
      const normalized = message.trim();
      const previous = promptHistoryRef.current[targetSessionId] ?? [];
      promptHistoryRef.current[targetSessionId] = [
        normalized,
        ...previous.filter((item) => item !== normalized),
      ].slice(0, 50);
    },
    showError: (message, duration) => showNotice(message, duration),
    showUnknown: () => showNotice(t("app.queuedUnknown"), 6000),
    showCompactUnavailable: () => showNotice(
      "会话尚未启动，请先发送一条消息再压缩",
      3000,
    ),
  });

  const selectSuggestion = useCallback((value: string) => {
    const liveDraft = liveDomDraftRef.current.sessionId === sessionId
      ? liveDomDraftRef.current.value
      : draft;
    const liveCursor = editorRef.current ? getCaretOffset(editorRef.current) : cursor;
    const result = applySuggestion(liveDraft, liveCursor, value);
    liveDomDraftRef.current = { sessionId, value: result.text };
    setDraft(result.text);
    setCursor(result.cursor);
    caretRef.current = result.cursor;
    setSuggestionsOpen(false);
    requestAnimationFrame(() => editorRef.current?.focus());
  }, [cursor, draft, sessionId, setDraft]);

  const closeSuggestions = useCallback(() => {
    const liveDraft = liveDomDraftRef.current.sessionId === sessionId
      ? liveDomDraftRef.current.value
      : draft;
    const liveCursor = editorRef.current ? getCaretOffset(editorRef.current) : cursor;
    const result = clearSuggestionTrigger(liveDraft, liveCursor);
    liveDomDraftRef.current = { sessionId, value: result.text };
    setDraft(result.text);
    setCursor(result.cursor);
    caretRef.current = result.cursor;
    setSuggestionsOpen(false);
    requestAnimationFrame(() => editorRef.current?.focus());
  }, [cursor, draft, sessionId, setDraft]);

  const onChange = useCallback((value: string, nextCursor: number) => {
    liveDomDraftRef.current = { sessionId, value };
    setDraft(value);
    setCursor(nextCursor);
    setSuggestionsOpen(detectTrigger(value, nextCursor) !== null);
    if (historyIndex >= 0) {
      const history = promptHistoryRef.current[sessionId] ?? [];
      if (value !== history[historyIndex]) {
        setHistoryIndex(-1);
        setSavedDraft("");
      }
    }
  }, [historyIndex, sessionId, setDraft]);

  const onKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (suggestionsOpen && suggestionItems.length > 0) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setSelectedSuggestionIndex((index) => Math.min(index + 1, suggestionItems.length - 1));
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setSelectedSuggestionIndex((index) => Math.max(index - 1, 0));
        return;
      }
      if (event.key === "Enter") {
        if (event.nativeEvent.isComposing || event.keyCode === 229) return;
        event.preventDefault();
        const selected = suggestionItems[
          Math.min(selectedSuggestionIndex, suggestionItems.length - 1)
        ];
        if (selected) selectSuggestion(selected.value);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        closeSuggestions();
        return;
      }
    }

    const liveDraft = liveDomDraftRef.current.sessionId === sessionId
      ? liveDomDraftRef.current.value
      : draft;
    const liveCursor = getCaretOffset(event.currentTarget);
    const firstLine = !liveDraft.slice(0, liveCursor).includes("\n");
    const lastLine = !liveDraft.slice(liveCursor).includes("\n");
    const history = promptHistoryRef.current[sessionId] ?? [];

    if (event.key === "ArrowUp" && firstLine && history.length > 0) {
      event.preventDefault();
      const nextIndex = historyIndex < 0
        ? 0
        : Math.min(historyIndex + 1, history.length - 1);
      if (historyIndex < 0) setSavedDraft(liveDraft);
      setHistoryIndex(nextIndex);
      liveDomDraftRef.current = { sessionId, value: history[nextIndex] };
      setDraft(history[nextIndex]);
      caretRef.current = history[nextIndex].length;
      return;
    }
    if (event.key === "ArrowDown" && lastLine && historyIndex >= 0) {
      event.preventDefault();
      const nextIndex = historyIndex - 1;
      const nextDraft = nextIndex >= 0 ? history[nextIndex] : savedDraft;
      setHistoryIndex(nextIndex);
      if (nextIndex < 0) setSavedDraft("");
      liveDomDraftRef.current = { sessionId, value: nextDraft };
      setDraft(nextDraft);
      caretRef.current = nextDraft.length;
      return;
    }
    if (event.key === "Escape" && historyIndex >= 0) {
      liveDomDraftRef.current = { sessionId, value: savedDraft };
      setDraft(savedDraft);
      setHistoryIndex(-1);
      setSavedDraft("");
      return;
    }

    const intent = getComposerEnterIntent(event, sendShortcut);
    if (intent === "send") {
      event.preventDefault();
      void send(isBusy ? "steer" : undefined);
    }
  }, [
    closeSuggestions,
    draft,
    historyIndex,
    isBusy,
    savedDraft,
    selectedSuggestionIndex,
    selectSuggestion,
    send,
    sendShortcut,
    sessionId,
    setDraft,
    suggestionItems,
    suggestionsOpen,
  ]);

  const addImageFiles = useCallback(async (imageFiles: File[]) => {
    for (const file of imageFiles) {
      try {
        const image = await processComposerImageFile(file);
        setAttachments((current) => [...current, image]);
      } catch (error) {
        showNotice(composerImageNotice(error), 3000);
      }
    }
  }, [setAttachments]);

  const onPaste = useCallback((event: React.ClipboardEvent<HTMLDivElement>) => {
    const imageFiles = getClipboardImageFiles(event.clipboardData);
    if (!imageFiles.length) return;
    event.preventDefault();
    void addImageFiles(imageFiles);
  }, [addImageFiles]);

  const onDrop = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    void addImageFiles(getDroppedImageFiles(event.dataTransfer));
  }, [addImageFiles]);

  const onChipClick = useCallback((chip: RichInputChip) => {
    if (chip.kind === "file") {
      const path = chip.raw.slice(1);
      if (options.onOpenFile) options.onOpenFile(path);
      else void desktopApi.files.open(path);
      return;
    }
    if (chip.kind === "session") {
      const selected = projectSessions.find(
        (session) => (session.name ?? session.filePath) === chip.label,
      );
      if (selected) setSessionReference(selected);
    }
  }, [options.onOpenFile, projectSessions]);

  useEffect(() => {
    if (!hasContent) {
      setBusyDraftLocked(false);
    } else if (isBusy) {
      setBusyDraftLocked(true);
    }
  }, [hasContent, isBusy, sessionId]);

  const keepSendBehaviorMenuOpen = useCallback(() => {
    if (sendBehaviorCloseTimerRef.current) {
      clearTimeout(sendBehaviorCloseTimerRef.current);
      sendBehaviorCloseTimerRef.current = null;
    }
    setSendBehaviorMenuOpen(true);
  }, []);

  const scheduleSendBehaviorMenuClose = useCallback(() => {
    if (sendBehaviorCloseTimerRef.current) {
      clearTimeout(sendBehaviorCloseTimerRef.current);
    }
    sendBehaviorCloseTimerRef.current = setTimeout(() => {
      setSendBehaviorMenuOpen(false);
      sendBehaviorCloseTimerRef.current = null;
    }, 160);
  }, []);

  const abort = useCallback(async () => {
    const agentId = runtime?.agentId;
    if (!agentId) return;
    await desktopApi.agents.abort(agentId);
  }, [runtime?.agentId, runtime?.runtimeGeneration]);

  const compact = useCallback(async () => {
    const agentId = runtime?.agentId;
    if (!agentId) {
      showNotice("会话尚未启动，请先发送一条消息再压缩", 3000);
      return;
    }
    try {
      await desktopApi.agents.compact(agentId);
    } catch (error) {
      showNotice(error instanceof Error ? error.message : String(error), 4000);
    }
  }, [runtime?.agentId, runtime?.runtimeGeneration]);

  const openPicker = useCallback((kind: ComposerPickerKind) => {
    if (kind === "template") void loadTemplates();
    setPicker(kind);
  }, [loadTemplates]);

  const insertTemplate = useCallback((template: PromptTemplateInfo) => {
    const next = draft.trimEnd()
      ? `${draft.trimEnd()} /${template.name} `
      : `/${template.name} `;
    liveDomDraftRef.current = { sessionId, value: next };
    setDraft(next);
    caretRef.current = next.length;
    setPicker(null);
    requestAnimationFrame(() => editorRef.current?.focus());
  }, [draft, sessionId, setDraft]);

  return {
    sessionId,
    record,
    runtime,
    draft,
    attachments,
    mode,
    sendState,
    templates,
    picker,
    previewImage,
    sessionReference,
    sessionReferenceSelection: sessionReference
      ? sessionReferenceSelections[`&${sessionReference.name ?? sessionReference.filePath}`]
      : undefined,
    bangMode: getBangMode(draft),
    isBusy,
    isStarting,
    hasContent,
    busyDraftLocked,
    editor: {
      ref: editorRef,
      caretRef,
      cursor,
      validCommandNames,
      validFilePaths,
      validSessionRefs,
      onChange,
      onCursorChange: setCursor,
      onKeyDown,
      onPaste,
      onDrop,
      onDragOver: (event: React.DragEvent<HTMLDivElement>) => event.preventDefault(),
      onFocus: () => setSuggestionsOpen(detectTrigger(draft, cursor) !== null),
      onBlur: () => setSuggestionsOpen(false),
      onChipClick,
    },
    suggestions: {
      open: suggestionsOpen,
      items: suggestionItems,
      selectedIndex: selectedSuggestionIndex,
      anchorStyle: suggestionAnchorStyle,
      setSelectedIndex: setSelectedSuggestionIndex,
      close: closeSuggestions,
      pick: selectSuggestion,
    },
    images: {
      preview: setPreviewImage,
      remove: (index: number) => setAttachments((current) => current.filter((_, item) => item !== index)),
      clear: () => setAttachments([]),
    },
    delivery: {
      send: () => void send(isBusy ? "steer" : undefined),
      followUp: () => void send("followUp"),
      abort: () => void abort(),
      compact: () => void compact(),
      canSend: hasContent && !isStarting,
      sendBehaviorMenuOpen,
      toggleSendBehaviorMenu: () => setSendBehaviorMenuOpen((open) => !open),
      keepSendBehaviorMenuOpen,
      scheduleSendBehaviorMenuClose,
    },
    pickers: {
      open: openPicker,
      close: () => setPicker(null),
      setMode,
      insertTemplate,
    },
    modals: {
      closePreview: () => setPreviewImage(null),
      closeSessionReference: () => setSessionReference(null),
      confirmSessionReference: (
        sessionName: string,
        messages: Array<{ role: string; content: string; timestamp: number }>,
        selectedIndices: number[],
      ) => {
        setSessionReferenceSelections((current) => ({
          ...current,
          [`&${sessionName}`]: createSessionReferenceSelection(
            selectedIndices,
            messages,
          ),
        }));
        setSessionReference(null);
      },
    },
  };
}

export type SessionComposerController = ReturnType<typeof useSessionComposerController>;
