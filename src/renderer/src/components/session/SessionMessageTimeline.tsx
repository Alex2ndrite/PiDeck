import { useAtomValue } from "jotai";
import { selectAtom } from "jotai/utils";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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
  liveThinkingIdBySessionIdAtomFamily,
  sessionMessageCacheBySessionIdAtomFamily,
  sessionMessageLoadStateAtom,
  sessionRecordByIdAtomFamily,
  sessionRuntimeBySessionIdAtomFamily,
  sessionSendStateByIdAtom,
} from "../../atoms";
import {
  canLoadSessionTimelineMore,
  deriveSessionSurfaceRuntime,
  isLatestTimelineRunBusy,
  useSessionTimelineController,
  type SessionTimelineController,
} from "../../hooks/useSessionTimelineController";
import { t, translateI18nDescriptor } from "../../i18n";
import { cn } from "../../lib/utils";
import { showNotice } from "../../utils/notice";
import { stripAnsi } from "./TimelineFormat";
import { SessionStartSurface } from "./SessionStartSurface";
import { MessageScroller } from "../agents/message-scroller";
import { chatContentWidthStyle } from "./chatContentWidth";
import {
  selectTimelineTurnWindow,
  shouldWindowTimelineTurns,
  TIMELINE_MOUNTED_TURN_LIMIT,
  countAgentRunItems,
} from "./timeline/turnRenderWindow";

type TurnRowProps = ComponentProps<typeof TurnRow>;
type UserBubbleProps = ComponentProps<typeof UserBubble>;

// ── 失败/重试提示：时间线不再渲染卡片，改为 toast ──
// 主进程以 role=error / role=system 消息携带这些 i18nKey（见 AgentManager 的
// addLocalizedMessage / upsertRetryStatusMessage）。它们在时间线里的诊断卡片
// 视觉过重且打断阅读流，改为首次出现时弹 toast；pi 启动失败
// （diagnostic.agentStartFailed）与携带完整排查诊断的 runtimeError 保留卡片。
const FLOATING_FAILURE_KEYS = new Set([
	"diagnostic.requestFailed",
	"diagnostic.requestFailedAfterRetries",
	"diagnostic.requestFailedUnknown",
	"diagnostic.requestFailedUnknownAfterRetries",
	"diagnostic.agentStopped",
	"diagnostic.promptRejected",
	"diagnostic.promptDeliveryUnknown",
	"diagnostic.commandFailed",
	"diagnostic.commandDeliveryUnknown",
	"diagnostic.commandCancelled",
	"diagnostic.processReconnectFailed",
	"diagnostic.historyLoadFailed",
	"diagnostic.extensionError",
	"diagnostic.retryScheduled",
	"diagnostic.retryScheduledAfterDelay",
	"diagnostic.retrySucceeded",
	"diagnostic.retryFailed",
]);

// 已弹过 toast 的消息 id：模块级去重，分屏多栏同一条消息只弹一次，
// 也避免消息重发（re-emit）或重新渲染时重复打扰。
// 上限裁剪：失败类消息 id 全局唯一且无删除路径，长期运行会无界增长（2026-10）。
const toastedFailureIds = new Set<string>();
const TOASTED_FAILURE_IDS_LIMIT = 500;
function markFailureToastShown(messageId: string) {
	toastedFailureIds.add(messageId);
	if (toastedFailureIds.size <= TOASTED_FAILURE_IDS_LIMIT) return;
	// 超限：清空重建（Set 无 FIFO；失败 toast 是低频事件，偶发重复提醒可接受）
	toastedFailureIds.clear();
	toastedFailureIds.add(messageId);
}

/** 判断消息是否为「失败/重试类」提示（时间线不渲染、改 toast）。 */
function isFloatingFailureMessage(message: ChatMessage): boolean {
	const key = (message.meta as Record<string, unknown> | undefined)?.i18nKey;
	return typeof key === "string" && FLOATING_FAILURE_KEYS.has(key);
}

/** 弹失败/重试 toast：重试类用中性标题，失败类用错误变体。 */
function showFailureToast(message: ChatMessage): void {
	const meta = message.meta as Record<string, unknown> | undefined;
	const key = typeof meta?.i18nKey === "string" ? meta.i18nKey : "";
	const isRetry = key.startsWith("diagnostic.retry");
	// translateI18nDescriptor 优先取 meta.i18nKey 的本地化文案，
	// 取不到时回退消息原文（主进程写的中文/占位文本）。
	const text = translateI18nDescriptor(meta, message.text) || message.text;
	showNotice(
		stripAnsi(text),
		isRetry ? 4000 : 6000,
		isRetry ? "info" : "error",
		t(isRetry ? "diagnostic.retryToastTitle" : "diagnostic.failureToastTitle"),
	);
}

type TimelineInteractionProps = {
  hasProject: boolean;
  onCreateSession: () => void;
  showThinking: boolean;
  validCommandNames: Set<string>;
  validFilePaths: Set<string>;
  onPreviewImage: (image: ImageContent) => void;
  onOpenExternal: (url: string, forceSystem?: boolean) => void;
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
  // disk 读取无论空/非空都会创建缓存条目：「条目是否存在」用于区分
  // 读取未到达（无条目→钉骨架屏）与读取已返回（有条目→起始页合法）。
  const surfaceCachedEntry = useAtomValue(
    sessionMessageCacheBySessionIdAtomFamily(sessionId ?? ""),
  );
  const modernSurfaceState = deriveSessionSurfaceRuntime(
    activeMessages.length,
    messageLoadState?.status,
    sendState?.status,
    runtime?.status,
    runtime?.state,
    // 缓存条目存在性（disk 读取无论空/非空都会创建条目）：ready 且无条目 =
    // 读取结果未到达 → 钉骨架屏；有条目（即使空）＝读取已返回，空会话起始页合法。
    // 不依赖 catalog messageCount（摘要缺失时兑底为 0，不可靠）。
    Boolean(surfaceCachedEntry),
  );
  const isConversationLoading = modernSurfaceState.isLoading;
  const canLoadMoreMessages = canLoadSessionTimelineMore(
    modernSurfaceState.isStarting,
    activeMessages.length,
  );
  const activeRuntimeState = runtime?.state;
  const activeConversationStatus = modernSurfaceState.status;
  // 只订 live id：思考正文由 ThinkingStep 叶子订阅，避免 50ms 戳醒整条 timeline。
  const liveThinkingId = useAtomValue(liveThinkingIdBySessionIdAtomFamily(sessionId ?? ""));
  const isAgentBusy = modernSurfaceState.isBusy;
  const cancellingUi = false;
  const loadMoreMessages = controller.loadMoreMessages;
  // ── 滚动接近顶部自动加载历史（2026-11 轮次模型）──
  // 监听器已迁移到 useSessionTimelineController（程序化滚动抑制在同一 owner）：
  // 用户上滚到距顶部 240px 内即按轮补历史，prepend 补偿不会连锁触发下一页。
  // 新增消息入场动画跟踪 ──
  // 只对「时间线尾部新增」的消息播放一次入场动画：历史加载/分页前插不算，
  // 避免整屏消息同时闪烁。乐观上屏的用户消息与流式替换后的权威消息都会触发。
  const [multiSelectOpen, setMultiSelectOpen] = useState(false);
  const [freshMessageIds, setFreshMessageIds] = useState<ReadonlySet<string>>(() => new Set());
  const seenTailMessageIdRef = useRef<string | undefined>(undefined);
  const freshTimersRef = useRef<Map<string, number>>(new Map());
  // 会话内容就绪淡入：isConversationLoading true→false（切会话历史加载完成）时，
  // 给 MessageScroller 挂一次 160ms 淡入动画类，与骨架屏消失衔接，避免整块瞬间出现。
  // 触发必须用 useLayoutEffect（paint 前同步）：若用 useEffect，内容会先以正常透明度
  // 绘制一帧，再被动画类重置到 opacity:0 重新淡入——视觉上就是「闪一下再淡入」。
  const [contentEntering, setContentEntering] = useState(false);
  const prevConversationLoadingRef = useRef(isConversationLoading);
  useLayoutEffect(() => {
    if (prevConversationLoadingRef.current && !isConversationLoading) {
      setContentEntering(true);
    }
    prevConversationLoadingRef.current = isConversationLoading;
  }, [isConversationLoading]);
  // 动画播完清理类（非视觉关键路径，放 useEffect 避免 layout 阶段多一次重渲染）
  useEffect(() => {
    if (!contentEntering) return;
    const timer = window.setTimeout(() => setContentEntering(false), 180);
    return () => window.clearTimeout(timer);
  }, [contentEntering]);

  useEffect(() => {
    // 会话切换时重置：新会话的首帧（历史加载）不播动画
    seenTailMessageIdRef.current = undefined;
    setFreshMessageIds(new Set());
    for (const timer of freshTimersRef.current.values()) window.clearTimeout(timer);
    freshTimersRef.current.clear();
  }, [sessionId]);

  // ── 失败/重试 toast：只对「加载完成后新增」的消息弹，历史回放不打扰 ──
  // 加载中（loading=true）直接返回；加载完成瞬间把已存在的失败消息静默记为基线；
  // 之后新增的失败/重试消息才弹 toast（模块级 Set 跨栏/跨渲染去重）。
  const failureBaselineRef = useRef<string[] | null>(null);
  useEffect(() => {
    if (isConversationLoading) {
      failureBaselineRef.current = null;
      return;
    }
    const floating = activeMessages.filter(isFloatingFailureMessage);
    if (failureBaselineRef.current === null) {
      // 加载完成基线：本次会话已有的失败消息不弹（历史回放/attach 重连）
      failureBaselineRef.current = floating.map((message) => message.id);
      return;
    }
    for (const message of floating) {
      if (failureBaselineRef.current.includes(message.id)) continue;
      if (toastedFailureIds.has(message.id)) continue;
      markFailureToastShown(message.id);
      showFailureToast(message);
    }
  }, [activeMessages, isConversationLoading]);

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
  // 贴底长会话：只挂尾部 N 个 agent-run；上滚/恢复历史位置时放开（autoScroll=false）。
  // 数据仍在 atoms；这里只减少 TurnRow / Streamdown 挂载。
  const followingForTurnWindow = controller.autoScroll;
  const displayRuns = useMemo(
    () => selectTimelineTurnWindow(
      reconciledRuns,
      followingForTurnWindow,
      TIMELINE_MOUNTED_TURN_LIMIT,
    ),
    [followingForTurnWindow, reconciledRuns],
  );
  const turnWindowActive = shouldWindowTimelineTurns(
    countAgentRunItems(reconciledRuns),
    followingForTurnWindow,
    TIMELINE_MOUNTED_TURN_LIMIT,
  );
  // 从「窗口裁剪」扩到「全量挂载」时内容加在上方，需补偿 scrollTop，避免视口跳到错误位置。
  const turnWindowStateRef = useRef<{ windowed: boolean; height: number }>({
    windowed: false,
    height: 0,
  });
  useLayoutEffect(() => {
    const timeline = timelineRef.current;
    if (!timeline) return;
    const prev = turnWindowStateRef.current;
    const nextHeight = timeline.scrollHeight;
    if (prev.windowed && !turnWindowActive) {
      const delta = nextHeight - prev.height;
      if (delta > 0) {
        // 标记程序化滚动：补偿的 scrollTop 位移会派发 scroll 事件，
        // 必须让自动加载监听忽略（补偿后视口可能落在 ≤240px 顶部区间）
        controller.markProgrammaticScroll?.();
        timeline.scrollTop += delta;
      }
    }
    turnWindowStateRef.current = { windowed: turnWindowActive, height: timeline.scrollHeight };
  }, [controller, displayRuns, timelineRef, turnWindowActive]);
  // 文件修改展示已下沉到每轮 TurnRow 底部（TurnFileChanges），此处不再做全局汇总
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
      isAgentBusy &&
      activeMessages.at(-1)?.role !== "assistant",
  );

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
      className={cn(
        "message-timeline-host h-full min-h-0",
        contentEntering && "timeline-content-enter",
      )}
      viewportClassName="message-timeline"
      // 宽度约束落在内层 [role=log] 而非 scroller 宿主：视口撑满整个面板，
      // 原生滚动条贴面板最右侧；内容列仍与 composer 同宽居中（见 chatContentWidth）。
      contentProps={{ style: chatContentWidthStyle }}
      viewportRef={timelineRef}
      scrollApiRef={controller.scrollerScrollApiRef}
      followOutput={controller.autoScroll}
      followThreshold={56}
      smooth
      // 整段 agent 忙碌（含工具执行/流式）期间追底用 instant，避免工具卡弹出弹簧滞后砰抖。
      busy={isAgentBusy || isAwaitingAssistant}
      onFollowChange={controller.setAutoScrollFromScroller}
      viewportProps={{
        // 会话切换滚动位置保持：滚动时维护 per-session 锚点（rAF 合并，不触发渲染）
        onScroll: controller.handleTimelineScroll,
      }}
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

      {/* 长会话渲染治理：
          - 不再使用 content-visibility 估算高度（展开工具会抖）。
          - 学 Proma：总折叠压缩单行 DOM；另在贴底时只挂尾部 N 个 agent-run
            （见 turnRenderWindow），上滚放开。分页仍做数据窗口治理。 */}
      {hasActiveConversation &&
        !isConversationLoading &&
        activeMessages.length > 0 && (
          <div className="message-list min-w-0 w-full mx-auto transition-opacity duration-150">
            {displayRuns.map((item, index) => {
              if (item.kind === "agent-run") {
                // Controls：忙碌中的末行 run 视为 live（isStreaming 补丁可能略滞后于正文 atom）。
                const isRunStreaming = isLatestTimelineRunBusy(
                  isAgentBusy,
                  index,
                  displayRuns.length,
                );
                return (
                  <TurnRow
                    key={item.id}
                    run={item}
                    sessionId={sessionId}
                    fresh={freshMessageIds.has(item.id)}
                    onPreviewImage={props.onPreviewImage}
                    showThinking={props.showThinking}
                    isStreaming={isRunStreaming}
                    // 始终下发 live id（按 message id 命中）；勿绑 isRunStreaming，
                    // 否则流结束而 History 未到时会提前卸思考步导致 remount dump。
                    liveThinkingId={liveThinkingId}
                    agentRunning={isRunStreaming}
                    isLatestRun={index === displayRuns.length - 1}
                    onOpenExternal={props.onOpenExternal}
                    onOpenFile={props.onOpenFile}
                    onDiffFile={props.onDiffFile}
                    onEditMessage={props.onEditMessage}
                    onDeleteMessage={props.onDeleteMessage}
                    onEnterMultiSelect={() => setMultiSelectOpen(true)}
                    onProcessAutoCollapsed={controller.scrollFinalAnswerIntoView}
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
                // 失败/重试类提示已转 toast（见 FLOATING_FAILURE_KEYS），
                // 时间线不再渲染卡片；pi 启动失败/运行时诊断仍走诊断卡片。
                if (isFloatingFailureMessage(message)) return null;
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
                  return <CompactionCard key={message.id} message={message} sessionId={sessionId} onOpenExternal={props.onOpenExternal} onOpenFile={props.onOpenFile} />;
                }
                // 自动重试状态（retryScheduled/retrySucceeded/retryFailed 等）
                // 属于「重试提示」，与失败类一样转 toast、不占时间线。
                if (isFloatingFailureMessage(message)) return null;
                return <DiagnosticMessageCard key={message.id} message={message} />;
              }
              return null;
            })}

            {hasActiveConversation &&
              !cancellingUi &&
              isAgentBusy && (
                <RespondingIndicator
                  // 有 live 思考段即可；不订正文 atom，避免 50ms 重渲 timeline。
                  thinking={liveThinkingId ? "." : undefined}
                  showThinking={props.showThinking}
                  isStarting={activeConversationStatus === "starting"}
                  isExecutingTool={activeRuntimeState?.isExecutingTool}
                  isStreaming={activeRuntimeState?.isStreaming}
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
