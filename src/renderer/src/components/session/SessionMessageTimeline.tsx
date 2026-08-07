import { useAtomValue } from "jotai";
import { selectAtom } from "jotai/utils";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ComponentProps, ReactNode, RefObject } from "react";
import type { ChatMessage, ImageContent } from "../../../../shared/types";
import { MarkdownStream } from "./MarkdownStream";
import {
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
  reconcileRuns,
  type RenderMessage,
} from "../app/AppUtils";
import {
  sessionMessageLoadStateAtom,
  sessionRecordByIdAtomFamily,
  sessionRuntimeBySessionIdAtomFamily,
  sessionSendStateByIdAtom,
  streamingTextByIdAtom,
} from "../../atoms";
import {
  canLoadSessionTimelineMore,
  deriveSessionSurfaceRuntime,
  isLatestTimelineRunBusy,
  useSessionTimelineController,
  type SessionTimelineController,
} from "../../hooks/useSessionTimelineController";
import { t } from "../../i18n";
import { SessionFileSummary } from "./SessionFileSummary";
import { SessionStartSurface } from "./SessionStartSurface";
import { ToolActivityCard } from "./ToolCallComponents";
import { MessageScroller } from "../agents/message-scroller";

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
  onForkMessage?: UserBubbleProps["onForkMessage"];
  forkingMessageId?: string | null;
  onToast: (message: string) => void;
  /** 新建 Agent 的空时间线快捷操作：只写入 composer，不自动投递。 */
  onQuickPrompt?: (prompt: string) => void;
  /** 当前会话的阻塞式交互（如 ask_question），由时间线统一承载滚动与底部定位。 */
  runtimeUi?: ReactNode;
};

export type SessionMessageTimelineProps = TimelineInteractionProps & {
  sessionId: string;
  controller?: SessionTimelineController;
  timelineRef?: RefObject<HTMLElement | null>;
};

export function SessionMessageTimeline(props: SessionMessageTimelineProps) {
  const sessionId = props.sessionId;
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
    sessionId,
    // An injected controller already owns loading and scroll effects; keep this hook inert in that case.
    messages: props.controller ? [] : undefined,
  });
  const controller = props.controller ?? internalController;
  const timelineRef = props.timelineRef ?? controller.timelineRef;
  const activeMessages = controller.messages;
  const paginatedMessages = controller.visibleMessages;
	const totalMessageCount = controller.totalMessageCount;
  const hasMoreMessages = controller.hasMoreMessages;
  const isLoadingMoreMessages = controller.isLoadingMoreMessages;
  const hasActiveConversation = Boolean(session);
  const modernSurfaceState = deriveSessionSurfaceRuntime(
    activeMessages.length,
    messageLoadState?.status,
    sendState?.status,
    runtime?.status,
    runtime?.state,
  );
  const isConversationLoading = modernSurfaceState.isLoading;
  const canLoadMoreMessages = canLoadSessionTimelineMore(
    modernSurfaceState.isStarting,
    activeMessages.length,
  );
  const activeRuntimeState = runtime?.state;
  const activeConversationStatus = modernSurfaceState.status;
  const activeThinking = runtime?.thinking;
  const isAgentBusy = modernSurfaceState.isBusy;
  const cancellingUi = false;
  const loadMoreMessages = controller.loadMoreMessages;
  // ── 新消息入场动画跟踪 ──
  // 只对「时间线尾部新增」的消息播放一次入场动画：历史加载/分页前插不算，
  // 避免整屏消息同时闪烁。乐观上屏的用户消息与流式替换后的权威消息都会触发。
  const [multiSelectOpen, setMultiSelectOpen] = useState(false);
  const [freshMessageIds, setFreshMessageIds] = useState<ReadonlySet<string>>(() => new Set());
  const seenTailMessageIdRef = useRef<string | undefined>(undefined);
  const freshTimersRef = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    // 会话切换时重置：新会话的首帧（历史加载）不播动画
    seenTailMessageIdRef.current = undefined;
    setFreshMessageIds(new Set());
    for (const timer of freshTimersRef.current.values()) window.clearTimeout(timer);
    freshTimersRef.current.clear();
  }, [sessionId]);

  useEffect(() => {
    const previousTail = seenTailMessageIdRef.current;
    const lastMessage = activeMessages[activeMessages.length - 1];
    const nextTail = lastMessage?.id;
    seenTailMessageIdRef.current = nextTail;
    if (!nextTail || !previousTail) return; // 首帧（历史加载完成前）只记录基线
    if (nextTail === previousTail) return;
    // 新消息只播放轻量入场效果；发送后的顶屏动画暂时关闭，避免与流式跟随争夺滚动位置。
    // 找到基线之后的新增消息（尾部追加，而非分页前插）
    const baselineIndex = activeMessages.findIndex((message) => message.id === previousTail);
    const fresh = baselineIndex < 0
      ? [nextTail]
      : activeMessages.slice(baselineIndex + 1).map((message) => message.id);
    if (fresh.length === 0) return;
    setFreshMessageIds((current) => {
      const next = new Set(current);
      for (const id of fresh) next.add(id);
      return next;
    });
    for (const id of fresh) {
      const timer = window.setTimeout(() => {
        freshTimersRef.current.delete(id);
        setFreshMessageIds((current) => {
          if (!current.has(id)) return current;
          const next = new Set(current);
          next.delete(id);
          return next;
        });
      }, 1200);
      freshTimersRef.current.set(id, timer);
    }
  }, [activeMessages]);

  useEffect(() => () => {
    for (const timer of freshTimersRef.current.values()) window.clearTimeout(timer);
    freshTimersRef.current.clear();
  }, []);

  const renderedRuns = useMemo(
    () => groupToolMessages(paginatedMessages),
    [paginatedMessages],
  );
  // 阶段0补强：对未变化的 run 复用旧对象引用，历史 run 的 memo 比较退化为 O(1)
  const prevRenderedRunsRef = useRef<RenderMessage[] | undefined>(undefined);
  const reconciledRuns = useMemo(() => {
    const next = reconcileRuns(prevRenderedRunsRef.current, renderedRuns);
    prevRenderedRunsRef.current = next;
    return next;
  }, [renderedRuns]);
  // 文件修改汇总只统计最后一次 agent 运行（run）内的工具调用：
  // 每次会话（用户发送 → agent 执行 → 完成）清空重算，不累计历史运行的修改
  const lastRunMessages = useMemo(() => {
    const lastRun = reconciledRuns.findLast((r) => r.kind === "agent-run");
    if (!lastRun) return [];
    const msgs: ChatMessage[] = [];
    for (const item of lastRun.items) {
      if (item.kind === "message") {
        msgs.push(item.message);
      } else if (item.kind === "tool-group" || item.kind === "thinking-group") {
        msgs.push(...item.messages);
      }
    }
    return msgs;
  }, [reconciledRuns]);
  const lastUserMessageId = useMemo(() => {
    for (let index = activeMessages.length - 1; index >= 0; index -= 1) {
      if (activeMessages[index].role === "user") {
        return activeMessages[index].id;
      }
    }
    return undefined;
  }, [activeMessages]);

  // Only show resend when last user message is followed by error/abort (not normal assistant)
  const resendableMessageIds = useMemo(() => {
    const ids = new Set<string>();
    for (let i = activeMessages.length - 1; i >= 0; i--) {
      const msg = activeMessages[i];
      if (msg.role !== "user") continue;
      let hasAbortOrError = false;
      for (let j = i + 1; j < activeMessages.length; j++) {
        const next = activeMessages[j];
        if (next.role === "user") break;
        if (next.role === "error") { hasAbortOrError = true; break; }
        if (next.role === "system") {
          const meta = next.meta as Record<string, unknown> | undefined;
          if (meta?.i18nKey === "app.abortRequested") { hasAbortOrError = true; break; }
        }
        if (next.role === "assistant" && next.text?.trim()) {
          // Only block if assistant completed normally (done marker); partial output may precede error
          const am = next.meta as Record<string, unknown> | undefined;
          if (am?.done === true || am?.stopReason) break;
          continue;
        }
      }
      if (hasAbortOrError) ids.add(msg.id);
      break;
    }
    return ids;
  }, [activeMessages]);

  const isAwaitingAssistant = Boolean(
    hasActiveConversation &&
      !cancellingUi &&
      (activeConversationStatus === "running" ||
        // 新操作方式下 Agent 在发消息时才启动：激活期间也要给用户「正在响应」反馈，
        // 避免消息上屏后长时间无任何指示造成「没反应」的错觉。
        activeConversationStatus === "starting" ||
        activeRuntimeState?.isStreaming) &&
      activeMessages.at(-1)?.role !== "assistant",
  );
  // 阶段2b：独立流式正文通道（streamingTextByIdAtom）——messages 数组不再承载
  // 流式正文，这里直接订阅独立通道判断当前会话是否在流式，替代 streamingMessageId
  //（它依赖 messages 数组找最后一条 assistant，阶段2b 后找不到了）。
  const streamingTextMap = useAtomValue(streamingTextByIdAtom);
  const streamingContent = streamingTextMap[sessionId]?.content ?? "";
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

        const captureIds = getMultiSelectImageCaptureIds(reconciledRuns, selectedIds);
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
    <MessageScroller
      className="message-timeline-host h-full min-h-0"
      viewportClassName="message-timeline"
      viewportRef={timelineRef}
      followOutput={controller.autoScroll}
      followThreshold={56}
      smooth
      busy={isAwaitingAssistant}
      onFollowChange={controller.setAutoScrollFromScroller}
    >
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
              ? t("timeline.loadingMore")
              : controller.nextLoadIsHistory
                ? t("timeline.loadMoreTurns")
                : t("timeline.loadMoreHistory", {
					count: totalMessageCount - paginatedMessages.length,
                })}
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
        activeMessages.length === 0 && (
          <SessionStartSurface onQuickPrompt={props.onQuickPrompt} />
        )}

      {/* 长会话渲染治理（2026-08 调整）：不再使用 content-visibility 估算高度。
          - 背景：content-visibility:auto + contain-intrinsic-size:240px 对屏外行用估算高度，
            展开/折叠工具卡或思考卡时，浏览器按估算高度修正滚动位置，产生屏幕抖动。
          - 替代：学 Proma 靠「总折叠 + 各自折叠」压缩单行 DOM 体积（分页仍在做窗口治理），
            所有行真实高度参与 layout，滚动引擎与折叠动画收到准确信号。 */}
      {hasActiveConversation &&
        !isConversationLoading &&
        activeMessages.length > 0 && (
          <div className="message-list">
            {reconciledRuns.map((item, index) => {
              if (item.kind === "agent-run") {
                // 阶段2b：流式判断基于独立通道（streamingContent 非空），不再依赖
                // streamingMessageId（阶段2b 后 messages 数组不承载流式文本，找不到消息）。
                // 只对最后一个 run 标记流式（历史 run 保持 isStreaming=false 走 memo 跳过）。
                const isRunStreaming =
                  Boolean(streamingContent.trim()) &&
                  index === reconciledRuns.length - 1 &&
                  item.kind === "agent-run";
                return (
                  <TurnRow
                    key={item.id}
                    run={item}
                    sessionId={sessionId}
                    fresh={freshMessageIds.has(item.id)}
                    onPreviewImage={props.onPreviewImage}
                    showThinking={props.showThinking}
                    isStreaming={isRunStreaming}
                    // 流式思考实时文本注入当前 run 的执行区（run 落地 thinking-group 前由 TurnRow 虚拟组承载）
                    streamingThinking={isRunStreaming ? activeThinking : undefined}
                    agentRunning={isLatestTimelineRunBusy(
                      isAgentBusy,
                      index,
                      reconciledRuns.length,
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
                    fresh={freshMessageIds.has(message.id)}
                    onPreviewImage={props.onPreviewImage}
                    onOpenFile={props.onOpenFile}
                    onResendUserMessage={props.onResendUserMessage}
                    onEditMessage={props.onEditMessage}
                    onDeleteMessage={props.onDeleteMessage}
                    onForkMessage={props.onForkMessage}
                    forking={props.forkingMessageId === message.id}
                    agentRunning={isAgentBusy}
                    isLastUserMessage={message.id === lastUserMessageId}
                    showResendButton={resendableMessageIds.has(message.id)}
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
                  // Pending extension UI is rendered once in the timeline footer.
                  // Legacy in-memory messages may still contain this placeholder.
                  return null;
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
                {activeRuntimeState?.isExecutingTool &&
                  !reconciledRuns.some(
                    (run) =>
                      run.kind === "agent-run" &&
                      run.items.some((item) => item.kind === "tool-group"),
                  ) && (
                    <ToolActivityCard name={t("tool.pending")} />
                  )}
              </>
            )}

            {hasActiveConversation &&
              !cancellingUi &&
              (activeConversationStatus === "running" ||
                activeConversationStatus === "starting" ||
                activeRuntimeState?.isStreaming) && (
                <RespondingIndicator
                  thinking={activeThinking}
                  showThinking={props.showThinking}
                  isStarting={activeConversationStatus === "starting"}
                  isExecutingTool={activeRuntimeState?.isExecutingTool}
                  isStreaming={activeRuntimeState?.isStreaming}
                />
              )}

            {/* 会话文件修改汇总：会话空闲（非运行/加载中）且有工具修改过文件时显示，
                点击文件/DIFF 按钮直接打开差异查看器（复用单条工具卡片的 diff 链路） */}
            {hasActiveConversation &&
              !isAwaitingAssistant &&
              !(activeConversationStatus === "running" || activeRuntimeState?.isStreaming) &&
              !isConversationLoading &&
              activeMessages.length > 0 && (
                <SessionFileSummary
                  messages={lastRunMessages}
                  onDiffFile={props.onDiffFile}
                />
              )}

          </div>
        )}

      {/* Ask 是阻塞式会话步骤，必须参与时间线的正常布局；这样它展开时会推动正文高度，
          而不是靠 sticky/z-index 覆盖最后一条工具调用或回答。 */}
      {props.runtimeUi ? (
        <div className="session-runtime-ui mx-auto w-full min-w-0 empty:hidden">
          {props.runtimeUi}
        </div>
      ) : null}

      {multiSelectOpen && (
        <MultiSelectModal
          renderedRuns={reconciledRuns}
          onClose={() => setMultiSelectOpen(false)}
          onCopy={copySelectedMessages}
        />
      )}
    </MessageScroller>
  );
}
