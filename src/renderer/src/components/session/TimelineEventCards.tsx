import { memo, useEffect, useRef, useState } from "react";
import { AlertTriangle, Brain, Check, ChevronDown, ChevronRight, ChevronUp, MessageCircle, X } from "lucide-react";
import type { ChatMessage } from "../../../../shared/types";
import { t, translateI18nDescriptor } from "../../i18n";
import { formatDuration, formatTime, stripAnsi } from "./TimelineFormat";
import { Textarea } from "../ui-shadcn/textarea";
import { StackTrace } from "../ui-shadcn/stack-trace";
import { ApprovalCard } from "../ui-shadcn/approval-card";
import { TimelineMarker } from "./TimelineMarker";
import { MarkdownStream } from "./MarkdownStream";
import { ShimmerText } from "./ShimmerText";
import { useSmoothStream } from "../../utils/useSmoothStream";

// Button 收口状态（P0）：本文件按钮全部保留原生——
// compaction-card-header / thinking-card-trigger 是折叠触发器 + 内容排版容器（内部 span/small/em 结构）；
// ask-question-card-option 是选项卡片；ask-question-card-submit/cancel 是品牌视觉按钮
// （30px 圆角 14px + 2px 边框 + 硬编码品牌绿/危险色，非 token 值，换装会丢失品牌感）。
// 迁移路径见 P2 CSS 收口。

function getDiagnosticTone(message: ChatMessage): "error" | "warning" | "success" | "info" {
	if (message.role === "error") return "error";
	const status = String(message.meta?.status ?? "");
	if (status === "error") return "error";
	if (status === "running") return "warning";
	if (status === "success") return "success";
	return "info";
}

/** 压缩事件卡片：在时间线上标记会话被压缩过，展示摘要和节约的 token 数。
 * 支持展开查看压缩前的归档消息。 */
export const CompactionCard = memo(function CompactionCard(props: {
	message: ChatMessage;
}) {
	const [expanded, setExpanded] = useState(false);
	const summary = props.message.text;
	const tokensBefore = (props.message.meta as any)?.tokensBefore;
	const compactionCount = (props.message.meta as any)?.compactionCount;
	const archivedMessages = (props.message.meta as any)?.archivedMessages as ChatMessage[] | undefined;
	const time = formatTime(props.message.timestamp);
	const hasArchived = Array.isArray(archivedMessages) && archivedMessages.length > 0;

	return (
		<TimelineMarker kind="compaction" tone="active">
		<article
			className={`my-px flex flex-col overflow-hidden rounded-sm border border-[color-mix(in_srgb,var(--color-accent)_8%,transparent)] bg-[color:color-mix(in_srgb,var(--color-accent)_4%,var(--color-bg-panel))]${expanded ? " compaction-card--expanded" : ""}`}
			data-message-id={props.message.id}
		>
			<button
				type="button"
				className="flex w-full cursor-pointer items-start gap-2 rounded-[inherit] border-none bg-none p-1 px-3 text-left text-inherit select-none hover:bg-[color:color-mix(in_srgb,var(--color-accent)_6%,transparent)] focus-visible:-outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
				onClick={() => hasArchived && setExpanded(!expanded)}
				disabled={!hasArchived}
				aria-expanded={expanded}
			>
				<span className="shrink-0 text-body leading-6" aria-hidden="true">
					{hasArchived ? (expanded ? "📂" : "📁") : "🔁"}
				</span>
				<div className="flex min-w-0 flex-1 flex-col gap-0.5">
					<span className="truncate text-caption leading-[1.4] text-text-secondary">{stripAnsi(summary)}</span>
					<div className="flex flex-wrap items-center gap-1">
						{typeof compactionCount === "number" && compactionCount > 0 && (
							<span className="inline-flex items-center rounded-full border border-[color-mix(in_srgb,var(--color-accent)_16%,transparent)] bg-[color:color-mix(in_srgb,var(--color-accent)_8%,transparent)] px-1.5 font-mono text-micro text-text-tertiary">
								{t("app.compactionCount", { count: compactionCount })}
							</span>
						)}
						{typeof tokensBefore === "number" && (
							<span className="font-mono text-micro text-text-tertiary">
								{t("app.compactionTokensBefore", { count: Math.round(tokensBefore / 1000) })}
							</span>
						)}
						{hasArchived && (
							<span className="font-mono text-micro opacity-80 text-text-tertiary">
								{expanded ? t("app.compactionCollapse") : t("app.compactionExpand")}
							</span>
						)}
					</div>
					<time className="text-micro opacity-70 text-text-tertiary">{time}</time>
				</div>
			</button>
			{expanded && hasArchived && (
				<div className="border-t border-[color-mix(in_srgb,var(--color-accent)_8%,transparent)]">
					<div />
					<ArchivedMessageList messages={archivedMessages} />
				</div>
			)}
		</article>
		</TimelineMarker>
	);
});

/** 归档消息列表：压缩卡片展开时，以简略格式渲染压缩前的消息历史。 */
function ArchivedMessageList({ messages }: { messages: ChatMessage[] }) {
	return (
		<div className="flex max-h-[360px] flex-col overflow-y-auto p-1 px-2">
			{messages.map((msg) => (
				<ArchivedMessage key={msg.id} message={msg} />
			))}
		</div>
	);
}

/** 单条归档消息：根据角色显示对应的图标和内容预览。
 * 只展示纯文本内容，不渲染 Markdown / 代码高亮 / 工具详情，保持归档区视觉干净。 */
function ArchivedMessage({ message }: { message: ChatMessage }) {
	const text = stripAnsi(message.text).trim();
	// 截断过长的消息以减少展开区体积
	const preview = text.length > 300 ? text.slice(0, 300) + "…" : text;
	const roleIcon =
		message.role === "user" ? "👤" :
		message.role === "assistant" ? "🤖" :
		message.role === "tool" ? "🔧" : "💬";

	return (
		<div className={`flex items-start gap-1 rounded-[2px] p-0.5 px-1 text-caption leading-[1.4] hover:bg-[color:color-mix(in_srgb,var(--color-accent)_4%,transparent)]${message.role === "user" ? "" : ""}`}>
			<span className="w-5 shrink-0 text-center text-caption">{roleIcon}</span>
			<span className={`min-w-0 flex-1 truncate${message.role === "user" ? " text-text-primary" : message.role === "tool" ? " font-mono text-micro text-text-tertiary" : " text-text-secondary"}`}>{preview || "(empty)"}</span>
		</div>
	);
}

/** 错误/RPC/系统诊断消息使用独立卡片，避免和普通 AI 正文混在一起难以扫读。 */
export const DiagnosticMessageCard = memo(function DiagnosticMessageCard(props: {
	message: ChatMessage;
}) {
	const tone = getDiagnosticTone(props.message);
	const localizedText = translateI18nDescriptor(props.message.meta, props.message.text);
	const debugDetails = typeof props.message.meta?.debugDetails === "string"
		? props.message.meta.debugDetails.trim()
		: "";
	const title = props.message.role === "error"
		? t("diagnostic.errorTitle")
		: t("diagnostic.systemTitle");
	return (
		<TimelineMarker
			kind="diagnostic"
			tone={
				tone === "error"
					? "error"
					: tone === "warning"
						? "warning"
						: tone === "success"
							? "success"
							: "neutral"
			}
			// 系统状态/自动重试/错误提示是独立卡片，不需要轨道归属关系
			hideRail
		>
		<article
			className={`diagnostic-card w-full min-w-0 overflow-hidden rounded-md border border-border-subtle bg-[var(--color-chat-muted-bg)] tone-${tone}`}
			data-message-id={props.message.id}
			data-role={props.message.role}
		>
			<div className="flex items-center gap-2 px-2 py-1.5 font-mono text-caption text-text-secondary">
				<AlertTriangle size={14} aria-hidden="true" />
				<span className="font-semibold">{title}</span>
				<time className="ml-auto text-micro tabular-nums text-text-tertiary">{formatTime(props.message.timestamp)}</time>
			</div>
			<div className="p-2">
				<p className="m-0 whitespace-pre-wrap break-words text-caption leading-relaxed text-text-secondary">{stripAnsi(localizedText)}</p>
				{debugDetails ? <StackTrace trace={stripAnsi(debugDetails)} defaultOpen={tone === "error"} /> : null}
			</div>
		</article>
		</TimelineMarker>
	);
});

/**
 * 内联提问卡片：渲染 Extension UI 请求（select/confirm/input/editor）作为 system 消息。
 * 用于实时会话中模型通过 ask_question 扩展向用户发起交互。
 */
export const AskQuestionCard = memo(function AskQuestionCard(props: {
	message: ChatMessage;
	onRespond?: (response: { value?: string | boolean; cancelled?: boolean; confirmed?: boolean }) => void;
}) {
	const meta = props.message.meta as Record<string, unknown> | undefined;
	const uiRequest = meta?.uiRequest as Record<string, unknown> | undefined;
	const status = String(meta?.status ?? "pending");
	const response = meta?.response as Record<string, unknown> | undefined;
	const answered = status === "answered" && response && !response.cancelled;
	const cancelled = status === "cancelled" || status === "error";

	const [inputValue, setInputValue] = useState("");
	const [cancelling, setCancelling] = useState(false);
	const [expanded, setExpanded] = useState(true);
	const inputRef = useRef<HTMLTextAreaElement>(null);

	// 编辑器输入 ref
	const editorRef = useRef<HTMLTextAreaElement>(null);

	// 当 prefill 变化时同步到 inputValue
	useEffect(() => {
		if (uiRequest?.prefill) setInputValue(String(uiRequest.prefill));
		setExpanded(true);
	}, [uiRequest?.prefill, props.message.id]);

	const handleSelect = (value: string) => {
		props.onRespond?.({ value });
	};

	const handleConfirm = (value: boolean) => {
		props.onRespond?.({ confirmed: value });
	};

	const handleInputSubmit = () => {
		if (inputValue.trim()) {
			props.onRespond?.({ value: inputValue });
		}
	};

	const handleCancel = () => {
		setCancelling(true);
		props.onRespond?.({ cancelled: true });
	};

	// 已回答/取消的卡片：信息已在 ToolCard 的 _askCard 中展示，此处不再重复渲染
	if (answered || cancelled) {
		return null;
	}

	// pending 卡片：显示交互界面
	const cancellingLabel = t("ask.cancelling");
	const method = String(uiRequest?.method ?? "input");
	const title = String(uiRequest?.title ?? "");
	const placeholder = String(uiRequest?.placeholder ?? "");
	const options = uiRequest?.options as string[] | undefined;

	return (
		<TimelineMarker kind="ask" tone="active">
			<ApprovalCard
				open={expanded}
				onOpenChange={setExpanded}
				title={t("ask.toolName")}
				description={title || t("ask.defaultTitle")}
				status={cancelling ? t("ask.cancelling") : t("ask.waiting")}
				onCancel={handleCancel}
				cancelDisabled={cancelling}
				cancelLabel={t("common.cancel")}
				className="ask-question-card pending"
			>
				<div className="ask-question-card-body">
					{method === "select" && options && options.length > 0 && (
						<div className="ask-question-card-options">
							{/* 过滤掉 Pi 自带的 "✎ 自行输入..." 选项，用下方内联输入框替代。 */}
							{options.filter((opt) => !opt.startsWith("✎")).map((opt) => (
								<button
									key={opt}
									className="ask-question-card-option"
									onClick={() => handleSelect(opt)}
									disabled={cancelling}
								>
									{opt}
								</button>
							))}
						</div>
					)}
					{method === "confirm" && (
						<div className="ask-question-card-options ask-question-card-options-confirm">
							<button
								className="ask-question-card-option ask-question-card-option-yes"
								onClick={() => handleConfirm(true)}
								disabled={cancelling}
							>
								{t("common.true")}
							</button>
							<button
								className="ask-question-card-option ask-question-card-option-no"
								onClick={() => handleConfirm(false)}
								disabled={cancelling}
							>
								{t("common.false")}
							</button>
						</div>
					)}
					{method === "input" && (
						<div className="ask-question-card-input-row">
							<Textarea
								ref={inputRef}
								className="ask-question-card-input"
								placeholder={placeholder || t("ask.inputPlaceholder")}
								value={inputValue}
								onChange={(e) => setInputValue(e.target.value)}
								onKeyDown={(e) => {
									if (e.key === "Enter" && !e.shiftKey) {
										e.preventDefault();
										handleInputSubmit();
									}
								}}
								disabled={cancelling}
							/>
							<button
								className="ask-question-card-submit"
								onClick={handleInputSubmit}
								disabled={!inputValue.trim() || cancelling}
								title={t("ask.submit")}
							>
								<Check size={14} />
							</button>
						</div>
					)}
					{method === "editor" && (
						<div className="ask-question-card-editor-area">
							<Textarea
								ref={editorRef}
								className="ask-question-card-editor"
								placeholder={placeholder || t("ask.editorPlaceholder")}
								value={inputValue}
								onChange={(e) => setInputValue(e.target.value)}
								disabled={cancelling}
							/>
							<div className="ask-question-card-editor-actions">
								<button
									className="ask-question-card-submit"
									onClick={handleInputSubmit}
									disabled={!inputValue.trim() || cancelling}
								>
									{t("ask.submit")}
								</button>
							</div>
						</div>
					)}
				</div>
			</ApprovalCard>
		</TimelineMarker>
	);
});

/** 思考过程折叠卡片：标签行（图标+标题+耗时，纯展示不可点击）与虚线框内容区分行；
 * 折叠态最多显示 4 行半（第 5 行切半，提示下面还有内容），左下角「展开思考」按钮；
 * 展开后 markdown 全文实时渲染（isStreaming 透传 MarkdownStream），按钮变「收起思考」；
 * agent 完成（endedAt 出现）时强制回到折叠态，随执行过程整体收起。
 * defaultExpanded=false 时以「单步」形态呈现，用于执行过程折叠详情。 */
export const ThinkingBlock = memo(
	function ThinkingBlock(props: {
		text: string;
		startedAt?: number;
		endedAt?: number;
		showThinking?: boolean;
		/** 初始展开状态（仅初始值）：standalone 思考卡默认 true，折叠详情内传 false */
		defaultExpanded?: boolean;
		/** 流式进行中：MarkdownStream 以 isStreaming 实时渲染 */
		isStreaming?: boolean;
		onOpenExternal: (url: string) => void;
		onOpenFile?: (path: string) => void;
	}) {
	const [expanded, setExpanded] = useState(props.defaultExpanded ?? true);
	const contentRef = useRef<HTMLDivElement | null>(null);
	const [overflowing, setOverflowing] = useState(false);
	// agent 完成时强制收起：即使之前手动展开过，思考也随执行过程整体收起（回到折叠 4 行半态）
	useEffect(() => {
		if (props.endedAt) setExpanded(false);
	}, [props.endedAt]);
	// 流式思考走打字机，避免大块 thinking_delta 一次糊上屏幕（「咔」一下）
	const { displayedContent } = useSmoothStream({
		content: props.text,
		isStreaming: Boolean(props.isStreaming),
	});
	// 始终走打字机输出：历史首挂时 hook 初始即全文；流式结束也不再绕过 displayedContent 造成整段蹦出。
	// 折叠态内容溢出检测：超过 4 行半才显示「展开思考」按钮。
	// 折叠时 clientHeight 被 max-height 锁死，ResizeObserver 收不到文本增长，
	// 因此 text 变化时（流式追加）主动重查；ResizeObserver 兜底窗口/字号档位变化。
	useEffect(() => {
		const el = contentRef.current;
		if (!el) return;
		const check = () => setOverflowing(el.scrollHeight > el.clientHeight + 1);
		check();
		const ro = new ResizeObserver(check);
		ro.observe(el);
		return () => ro.disconnect();
	}, [displayedContent, expanded]);

	if (!props.showThinking || !props.text.trim()) return null;
	// 计算思考耗时（毫秒），有 endAt 且有 startAt 时才显示
	const durationMs =
		props.endedAt && props.startedAt && props.endedAt >= props.startedAt
			? props.endedAt - props.startedAt
			: null;
	const durationText = durationMs != null ? formatDuration(durationMs) : null;
	// 展开/收起按钮：展开态常显（收起按钮），折叠态仅内容溢出时显示（展开按钮）
	const showToggle = expanded || overflowing;
	return (
		<TimelineMarker kind="thinking" tone={props.endedAt ? "neutral" : "active"}>
		<section className="w-full min-w-0 overflow-hidden rounded-md border-0">
			{/* 标签行：纯展示，不可点击；展开/收起走左下角按钮。不显示「思考」文字，
			    只留图标+耗时，保持轨道安静（思考内容本身已有虚线框区分） */}
			<div className="flex min-h-6 items-center gap-2 px-1">
				<Brain size={15} className="shrink-0 text-text-secondary" aria-hidden="true" />
				{durationText && (
					<small className="shrink-0 font-mono text-micro tabular-nums text-text-tertiary">
						{t("thinking.duration", { duration: durationText })}
					</small>
				)}
			</div>
			{/* 虚线框内容区：折叠态最多 4 行半（max-height=4.5×行高，第 5 行切半提示还有内容），
			    行高按正文字号计算（1.65 × 14px × 4.5 ≈ 104px） */}
			<div className="rounded-md border border-dashed border-border-subtle bg-[color:color-mix(in_srgb,var(--color-bg-muted)_45%,transparent)]">
				<div
					ref={contentRef}
					className={`markdown-body px-3 pt-2 pb-1 text-text-tertiary ${expanded ? "" : "max-h-[calc(var(--font-size-body)*7.425)] overflow-hidden"}`}
				>
					<MarkdownStream
						text={displayedContent}
						isStreaming={props.isStreaming}
						onOpenExternal={props.onOpenExternal}
						onOpenFile={props.onOpenFile}
					/>
				</div>
				{showToggle && (
					<div className="flex px-1 pb-1">
						<button
							type="button"
							className="inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-micro text-text-tertiary opacity-60 transition-colors duration-150 hover:opacity-100 focus-visible:outline-2 focus-visible:outline-[var(--focus-ring)]"
							onClick={() => setExpanded((v) => !v)}
							aria-expanded={expanded}
						>
							{expanded ? <ChevronUp size={10} aria-hidden="true" /> : <ChevronDown size={10} aria-hidden="true" />}
							{expanded ? t("thinking.collapse") : t("thinking.expand")}
						</button>
					</div>
				)}
			</div>
		</section>
		</TimelineMarker>
	);
	},
	// 回调函数（onOpenExternal/onOpenFile）行为稳定（读 ref），不参与比较
	(prev, next) =>
		prev.text === next.text &&
		prev.startedAt === next.startedAt &&
		prev.endedAt === next.endedAt &&
		prev.showThinking === next.showThinking &&
		prev.isStreaming === next.isStreaming,
);



/**
 * 流式响应指示器（三点脉动动画 + 状态文案），在 agent 运行/流式期间显示。
 *
 * 状态优先级：
 *  1. Agent 启动中 → "正在启动 Agent"（琥珀色）
 *  2. 工具执行中 → "正在工具调用"（琥珀色）
 *  3. 有思考文本 / 流式回答中 → "正在回应"
 *  4. 过渡等待 → 只显示三点动画，无标签
 *
 * 启动状态单独展示，避免用户发消息后 Agent 尚未完成预热时看起来像“没有响应”。
 */
export function RespondingIndicator(props: {
	thinking?: string;
	showThinking?: boolean;
	isStarting?: boolean;
	isExecutingTool?: boolean;
	isStreaming?: boolean;
}) {
	const { isStarting, isExecutingTool, isStreaming, thinking, showThinking } = props;

	let kind: "starting" | "executing" | "responding" | "waiting";
	let label: string;

	if (isStarting) {
		kind = "starting";
		label = t("app.agentStarting");
	} else if (isExecutingTool) {
		kind = "executing";
		label = t("thinking.executing");
	} else if ((showThinking && thinking && thinking.length > 0) || isStreaming) {
		// 有思考文本或流式回答中统一显示“正在回应”
		kind = "responding";
		label = t("thinking.responding");
	} else {
		// 过渡等待：只显示三点动画
		kind = "waiting";
		label = "...";
	}

	return (
		<div className="responding-indicator" data-kind={kind}>
			<span className="responding-indicator-dots" aria-hidden="true">
				<span />
				<span />
				<span />
			</span>
			{/* 标签始终渲染，waiting 态用静态文本并通过 CSS visibility:hidden 隐藏，保持容器宽度稳定；
			    进行态（启动/工具调用/回应）用微光扫过提示活动进行中（AI Elements Shimmer 借鉴） */}
			{kind === "waiting" ? (
				<span className="responding-indicator-label">{label}</span>
			) : (
				<ShimmerText
					text={label}
					className="responding-indicator-label"
					tone={kind === "responding" ? "muted" : "warning"}
				/>
			)}
		</div>
	);
}

/** 宠物选择预览：给定宠物清单项，用 <canvas> 解码其 spritesheet 并循环播放
 *  对应 mode 行（默认 idle）的网格帧，让用户在选择宠物时即时看到动画效果，
 *  不必切换真实宠物窗。失败时降级为空占位，不阻塞设置面板。 */
