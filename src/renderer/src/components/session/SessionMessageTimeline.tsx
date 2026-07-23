import { Wrench } from "lucide-react";
import { useAtomValue } from "jotai";
import { selectAtom } from "jotai/utils";
import { useMemo, useState } from "react";
import type { ComponentProps, RefObject } from "react";
import type {
  AgentRuntimeState,
  ChatMessage,
  ImageContent,
} from "../../../../shared/types";
import {
  AskQuestionCard,
  CompactionCard,
  DiagnosticMessageCard,
  EmptyState,
  MultiSelectModal,
  RespondingIndicator,
  TurnRow,
  UserBubble,
  stripMarkdown,
} from "./SurfaceParts";
import {
  getMultiSelectImageCaptureIds,
  groupToolMessages,
} from "../app/AppUtils";
import {
  sessionMessageLoadStateAtom,
  sessionRecordByIdAtomFamily,
  sessionRuntimeBySessionIdAtomFamily,
  sessionSendStateByIdAtom,
} from "../../atoms";
import {
  canLoadSessionTimelineMore,
  deriveSessionSurfaceRuntime,
  isLatestTimelineRunBusy,
  selectSessionModeValue,
  useSessionTimelineController,
  type SessionTimelineController,
} from "../../hooks/useSessionTimelineController";
import { t } from "../../i18n";

type UiResponse = {
  value?: string | boolean;
  cancelled?: boolean;
  confirmed?: boolean;
};

type TurnRowProps = ComponentProps<typeof TurnRow>;
type UserBubbleProps = ComponentProps<typeof UserBubble>;

type TimelineInteractionProps = {
  hasProject: boolean;
  onCreateSession: () => void;
  showThinking: boolean;
  validCommandNames: Set<string>;
  validFilePaths: Set<string>;
  onPreviewImage: (image: ImageContent) => void;
  onOpenExternal: (url: string) => void;
  onOpenFile?: (path: string) => void;
  onDiffFile?: TurnRowProps["onDiffFile"];
  onResendUserMessage?: UserBubbleProps["onResendUserMessage"];
  onEditMessage?: TurnRowProps["onEditMessage"];
  onDeleteMessage?: TurnRowProps["onDeleteMessage"];
  onSendUiResponse: (requestId: string, response: UiResponse) => void;
  onToast: (message: string) => void;
};

type LegacyTimelineProps = TimelineInteractionProps & {
  mode?: "legacy";
  sessionId?: never;
  controller?: never;
  timelineRef: RefObject<HTMLElement | null>;
  activeMessages: ChatMessage[];
  paginatedMessages: ChatMessage[];
  hasMoreMessages: boolean;
  isLoadingMoreMessages: boolean;
  canLoadMoreMessages: boolean;
  onLoadMoreMessages: () => void;
  hasActiveConversation: boolean;
  isConversationLoading: boolean;
  activeThinking?: string;
  activeRuntimeState?: AgentRuntimeState;
  activeConversationStatus?: string;
  isAgentBusy: boolean;
  cancellingUi: boolean;
};

type SessionTimelineProps = TimelineInteractionProps & {
  mode: "session";
  sessionId: string;
  controller?: SessionTimelineController;
  timelineRef?: RefObject<HTMLElement | null>;
  activeMessages?: never;
  paginatedMessages?: never;
  hasMoreMessages?: never;
  isLoadingMoreMessages?: never;
  canLoadMoreMessages?: never;
  onLoadMoreMessages?: never;
  hasActiveConversation?: never;
  isConversationLoading?: never;
  activeThinking?: never;
  activeRuntimeState?: never;
  activeConversationStatus?: never;
  isAgentBusy?: never;
  cancellingUi?: never;
};

export type SessionMessageTimelineProps = LegacyTimelineProps | SessionTimelineProps;

export function SessionMessageTimeline(props: SessionMessageTimelineProps) {
  const sessionMode = props.mode === "session";
  const sessionId = sessionMode ? props.sessionId : "";
  const legacyProps = props as LegacyTimelineProps;
  const session = useAtomValue(sessionRecordByIdAtomFamily(sessionId));
  const runtime = useAtomValue(sessionRuntimeBySessionIdAtomFamily(sessionId));
  const messageLoadStateSelector = useMemo(
    () => selectAtom(
      sessionMessageLoadStateAtom,
      (states) => states[sessionId],
      Object.is,
    ),
    [sessionId],
  );
  const sendStateSelector = useMemo(
    () => selectAtom(
      sessionSendStateByIdAtom,
      (states) => states[sessionId],
      Object.is,
    ),
    [sessionId],
  );
  const messageLoadState = useAtomValue(messageLoadStateSelector);
  const sendState = useAtomValue(sendStateSelector);
  const internalController = useSessionTimelineController({
    sessionId: sessionMode ? sessionId : undefined,
    // An injected controller owns the scroll effects; legacy ownership remains entirely external.
    messages: sessionMode ? (props.controller ? [] : undefined) : legacyProps.activeMessages,
  });
  const controller = sessionMode ? (props.controller ?? internalController) : internalController;
  const timelineRef = sessionMode
    ? (props.timelineRef ?? controller.timelineRef)
    : legacyProps.timelineRef;
  const activeMessages = selectSessionModeValue(
    sessionMode,
    controller.messages,
    legacyProps.activeMessages,
  );
  const paginatedMessages = selectSessionModeValue(
    sessionMode,
    controller.visibleMessages,
    legacyProps.paginatedMessages,
  );
  const hasMoreMessages = sessionMode ? controller.hasMoreMessages : legacyProps.hasMoreMessages;
  const isLoadingMoreMessages = sessionMode
    ? controller.isLoadingMoreMessages
    : legacyProps.isLoadingMoreMessages;
  const hasActiveConversation = sessionMode ? Boolean(session) : legacyProps.hasActiveConversation;
  const modernSurfaceState = deriveSessionSurfaceRuntime(
    activeMessages.length,
    messageLoadState?.status,
    sendState?.status,
    runtime?.status,
    runtime?.state,
  );
  const isConversationLoading = sessionMode
    ? modernSurfaceState.isLoading
    : legacyProps.isConversationLoading;
  const canLoadMoreMessages = sessionMode
    ? canLoadSessionTimelineMore(modernSurfaceState.isStarting, activeMessages.length)
    : legacyProps.canLoadMoreMessages;
  const activeRuntimeState = selectSessionModeValue(
    sessionMode,
    runtime?.state,
    legacyProps.activeRuntimeState,
  );
  const activeConversationStatus = selectSessionModeValue(
    sessionMode,
    modernSurfaceState.status,
    legacyProps.activeConversationStatus,
  );
  const activeThinking = sessionMode ? runtime?.thinking : legacyProps.activeThinking;
  const isAgentBusy = sessionMode
    ? modernSurfaceState.isBusy
    : legacyProps.isAgentBusy;
  const cancellingUi = sessionMode ? false : legacyProps.cancellingUi;
  const loadMoreMessages = sessionMode
    ? controller.loadMoreMessages
    : legacyProps.onLoadMoreMessages;
  const [multiSelectOpen, setMultiSelectOpen] = useState(false);
  const renderedRuns = useMemo(
    () => groupToolMessages(paginatedMessages),
    [paginatedMessages],
  );
  const lastUserMessageId = useMemo(() => {
    for (let index = activeMessages.length - 1; index >= 0; index -= 1) {
      if (activeMessages[index].role === "user") {
        return activeMessages[index].id;
      }
    }
    return undefined;
  }, [activeMessages]);
  const isAwaitingAssistant = Boolean(
    hasActiveConversation &&
      !cancellingUi &&
      (activeConversationStatus === "running" || activeRuntimeState?.isStreaming) &&
      activeMessages.at(-1)?.role !== "assistant",
  );
  const streamingMessageId = useMemo(() => {
    if (
      !hasActiveConversation ||
      activeConversationStatus !== "running" ||
      !activeRuntimeState?.isStreaming
    ) {
      return undefined;
    }
    for (let index = activeMessages.length - 1; index >= 0; index -= 1) {
      const message = activeMessages[index];
      if (message.role === "user") break;
      if (message.role === "assistant" && message.text.trim()) return message.id;
    }
    return undefined;
  }, [
    activeConversationStatus,
    activeMessages,
    activeRuntimeState?.isStreaming,
    hasActiveConversation,
  ]);

  async function copySelectedMessages(
    selectedIds: Set<string>,
    kind: "text" | "markdown" | "image",
  ) {
    if (kind === "image") {
      try {
        const { toBlob } = await import("html-to-image");
        const source = timelineRef.current?.querySelector(
          ".message-list",
        ) as HTMLElement | null;
        if (!source) return;

        const captureIds = getMultiSelectImageCaptureIds(renderedRuns, selectedIds);
        const clone = source.cloneNode(true) as HTMLElement;
        for (const item of Array.from(clone.children)) {
          if (!(item instanceof HTMLElement)) continue;
          const id = item.dataset.messageId;
          if (!id || !captureIds.has(id)) item.remove();
        }
        clone.classList.add("multi-select-image-export");
        clone.style.width = `${Math.max(source.clientWidth, source.scrollWidth)}px`;
        clone.style.padding = "24px";
        clone.style.background =
          getComputedStyle(document.documentElement).getPropertyValue(
            "--color-bg-panel",
          ) || "#fff";
        document.body.appendChild(clone);
        let blob: Blob | null = null;
        try {
          blob = await toBlob(clone, {
            pixelRatio: Math.min(2, window.devicePixelRatio || 1),
            backgroundColor:
              getComputedStyle(document.documentElement).getPropertyValue(
                "--color-bg-panel",
              ) || undefined,
            filter: (node) =>
              !(node instanceof HTMLElement) ||
              (!node.classList.contains("turn-row-actions") &&
                !node.classList.contains("user-turn-actions") &&
                !node.classList.contains("copy-menu-popover")),
          });
        } finally {
          clone.remove();
        }
        if (blob) {
          await navigator.clipboard.write([
            new ClipboardItem({ [blob.type]: blob }),
          ]);
          props.onToast(t("copy.asImageCopied"));
        }
      } catch {
        props.onToast(t("copy.failed"));
      }
      setMultiSelectOpen(false);
      return;
    }

    const selected = activeMessages
      .filter((message) => selectedIds.has(message.id))
      .sort((left, right) => left.timestamp - right.timestamp);
    if (!selected.length) return;

    const separator = "\n\n---\n\n";
    const content = kind === "text"
      ? selected
          .map((message) => {
            let text = message.text;
            text = text.replace(
              /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g,
              "",
            );
            text = text.replace(/<thinking>[\s\S]*?<\/thinking>/g, "");
            text = text.replace(
              /<skill\s+name="[^"]*"[^>]*>[\s\S]*?<\/skill>/gi,
              "",
            );
            return stripMarkdown(text);
          })
          .join(separator)
      : selected.map((message) => message.text).join(separator);

    await navigator.clipboard.writeText(content);
    props.onToast(
      kind === "text" ? t("copy.asTextCopied") : t("copy.asMarkdownCopied"),
    );
    setMultiSelectOpen(false);
  }

  return (
    <section className="message-timeline" ref={timelineRef}>
      {hasMoreMessages && canLoadMoreMessages && (
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            padding: "12px 0",
            borderBottom: "1px solid var(--border-color)",
          }}
        >
          <button
            onClick={loadMoreMessages}
            disabled={isLoadingMoreMessages}
            style={{
              padding: "6px 16px",
              border: "1px solid var(--border-color)",
              borderRadius: "6px",
              background: "var(--bg-secondary)",
              color: "var(--text-primary)",
              fontSize: "13px",
              cursor: isLoadingMoreMessages ? "not-allowed" : "pointer",
              opacity: isLoadingMoreMessages ? 0.6 : 1,
              transition: "all 0.2s",
            }}
          >
            {isLoadingMoreMessages
              ? "加载中..."
              : `加载更多历史消息 (${activeMessages.length - paginatedMessages.length} 条)`}
          </button>
        </div>
      )}

      {isConversationLoading && (
        <div className="history-loading">
          <div className="history-loading-placeholder">
            <div className="skeleton-bubble" />
            <div className="skeleton-line" />
            <div className="skeleton-line" />
            <div className="skeleton-line" />
          </div>
          <div className="history-loading-placeholder">
            <div className="skeleton-line" />
            <div className="skeleton-line" />
            <div className="skeleton-line" />
          </div>
          <div className="history-loading-placeholder">
            <div className="skeleton-line" />
            <div className="skeleton-line" />
          </div>
          <span
            style={{
              paddingTop: "16px",
              alignSelf: "center",
              fontSize: "var(--font-size-small)",
            }}
          >
            {t("app.agentStarting")}
          </span>
        </div>
      )}

      {!hasActiveConversation && (
        <EmptyState
          hasProject={props.hasProject}
          onCreate={props.onCreateSession}
        />
      )}

      {hasActiveConversation &&
        !isConversationLoading &&
        activeMessages.length > 0 && (
          <div className="message-list">
            {renderedRuns.map((item, index) => {
              if (item.kind === "agent-run") {
                const isRunStreaming = Boolean(
                  streamingMessageId &&
                    item.items.some(
                      (runItem) =>
                        runItem.kind === "message" &&
                        runItem.message.id === streamingMessageId,
                    ),
                );
                return (
                  <TurnRow
                    key={item.id}
                    run={item}
                    onPreviewImage={props.onPreviewImage}
                    showThinking={props.showThinking}
                    isStreaming={isRunStreaming}
                    agentRunning={isLatestTimelineRunBusy(
                      isAgentBusy,
                      index,
                      renderedRuns.length,
                    )}
                    onOpenExternal={props.onOpenExternal}
                    onOpenFile={props.onOpenFile}
                    onDiffFile={props.onDiffFile}
                    onEditMessage={props.onEditMessage}
                    onDeleteMessage={props.onDeleteMessage}
                    onEnterMultiSelect={() => setMultiSelectOpen(true)}
                  />
                );
              }
              if (item.kind !== "message") return null;
              const message = item.message;
              if (message.role === "user") {
                return (
                  <UserBubble
                    key={message.id}
                    message={message}
                    onPreviewImage={props.onPreviewImage}
                    onOpenFile={props.onOpenFile}
                    onResendUserMessage={props.onResendUserMessage}
                    onEditMessage={props.onEditMessage}
                    onDeleteMessage={props.onDeleteMessage}
                    agentRunning={isAgentBusy}
                    isLastUserMessage={message.id === lastUserMessageId}
                    validCommandNames={props.validCommandNames}
                    validFilePaths={props.validFilePaths}
                    onEnterMultiSelect={() => setMultiSelectOpen(true)}
                  />
                );
              }
              if (message.role === "error") {
                return <DiagnosticMessageCard key={message.id} message={message} />;
              }
              if (message.role === "system") {
                const meta = message.meta as any;
                if (meta?.type === "askQuestion") {
                  return (
                    <AskQuestionCard
                      key={message.id}
                      message={message}
                      onRespond={(response) => {
                        const request = meta.uiRequest;
                        if (request) {
                          props.onSendUiResponse(request.requestId, response);
                        }
                      }}
                    />
                  );
                }
                if (meta?.type === "compaction") {
                  return <CompactionCard key={message.id} message={message} />;
                }
                return <DiagnosticMessageCard key={message.id} message={message} />;
              }
              return null;
            })}

            {isAwaitingAssistant && (
              <>
                {props.showThinking && activeThinking && (
                  <section className="thinking-card">
                    <div className="thinking-card-content">
                      {activeThinking}
                    </div>
                  </section>
                )}
                {activeRuntimeState?.isExecutingTool &&
                  !renderedRuns.some(
                    (run) =>
                      run.kind === "agent-run" &&
                      run.items.some((item) => item.kind === "tool-group"),
                  ) && (
                    <section className="tool-card tone-info" data-status="running">
                      <div className="tool-card-header">
                        <span className="tool-card-trigger">
                          <span className="tool-card-icon">
                            <Wrench size={14} />
                          </span>
                          <span className="tool-card-name">{t("tool.pending")}</span>
                          <span className="tool-card-status">
                            <span className="tool-card-spinner" aria-hidden="true" />
                            {t("tool.statusRunning")}
                          </span>
                        </span>
                      </div>
                    </section>
                  )}
              </>
            )}

            {hasActiveConversation &&
              !cancellingUi &&
              (activeConversationStatus === "running" || activeRuntimeState?.isStreaming) && (
                <RespondingIndicator
                  thinking={activeThinking}
                  showThinking={props.showThinking}
                  isExecutingTool={activeRuntimeState?.isExecutingTool}
                  isStreaming={activeRuntimeState?.isStreaming}
                />
              )}
          </div>
        )}

      {multiSelectOpen && (
        <MultiSelectModal
          renderedRuns={renderedRuns}
          onClose={() => setMultiSelectOpen(false)}
          onCopy={copySelectedMessages}
        />
      )}
    </section>
  );
}
