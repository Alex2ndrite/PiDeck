import { Fragment, memo, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ChevronUp, Share, SquarePen, Trash } from "lucide-react";
import type { ImageContent } from "../../../../../shared/types";
import { t } from "../../../i18n";
import { Button } from "../../ui-shadcn/button";
import { Collapsible, CollapsibleContent } from "../../ui-shadcn/collapsible";
import { formatDuration, formatTime, stripAnsi, stripThinkingTags } from "../TimelineFormat";
import { CopyMenu, stripMarkdown } from "../SurfaceComponents";
import { buildTurnDisplay, hasFoldableContent } from "../timeline/buildTurnDisplay";
import { buildProcessSummary } from "../timeline/segmentSummary";
import type {
	AgentRunItem,
	MessageItem,
	ThinkingGroupItem,
} from "../timeline/types";
import { FinalAnswer } from "./FinalAnswer";
import { InterimAnswer } from "./InterimAnswer";
import { ProcessSummaryToggle } from "./ProcessSummaryToggle";
import { ThinkingStep } from "./ThinkingStep";
import { ToolStep } from "./ToolStep";
import { useTurnExecution } from "./useTurnExecution";
import type { DiffFileHandler } from "../ToolCallComponents";

/**
 * 一轮 AI 回答的扁平容器：左侧竖线聚合，内含思考/工具/回答。
 *
 * 展示语义（与用户确认）：
 * - 唯一「执行过程」折叠汇总按钮（run 开头，纯数字）；
 * - 思考/工具/中间回答原位穿插，共用一个 run 级折叠开关；
 * - 最终回答常驻、永不折叠；
 * - 流式中自动展开（实时滚出），run 结束后 1s 自动收起。
 *
 * 模块化说明：旧 TurnRow 与 UserBubble/EmptyState 等共享一个 1462 行的
 * SurfaceComponents.tsx。此处拆为 turn/ 组合层 + timeline/ 纯函数，
 * 各子组件（ThinkingStep/ToolStep/AnswerText/FinalAnswer）props 驱动、可独立复用。
 */
export type TurnRowProps = {
	run: AgentRunItem;
	/** 新消息入场动画：仅发送后尾部新增的消息播放一次 */
	fresh?: boolean;
	onPreviewImage: (image: ImageContent) => void;
	showThinking?: boolean;
	isStreaming?: boolean;
	/** 流式思考实时文本（runtime.thinking）：run 尚未落地 thinking-group 时注入执行区 */
	streamingThinking?: string;
	onOpenExternal: (url: string) => void;
	onOpenFile?: (path: string) => void;
	onDiffFile?: DiffFileHandler;
	onResendUserMessage?: (message: never) => void;
	onEditMessage?: (messageId: string, newText: string) => void;
	onDeleteMessage?: (messageId: string) => void;
	/** Agent 正在处理请求或流式输出中时禁用编辑/删除等操作按钮 */
	agentRunning?: boolean;
	/** 打开多选分享弹框 */
	onEnterMultiSelect?: () => void;
};

export const TurnRow = memo(function TurnRow(props: TurnRowProps) {
	const { run } = props;
	const rowRef = useRef<HTMLElement | null>(null);
	const [editing, setEditing] = useState(false);
	const [editText, setEditText] = useState("");
	const editAreaRef = useRef<HTMLDivElement | null>(null);
	// 激活编辑时自动滚动到编辑区（避免 textarea 超出可视区域）
	useEffect(() => {
		if (editing && editAreaRef.current) {
			editAreaRef.current.scrollIntoView({ behavior: "smooth", block: "nearest" });
		}
	}, [editing]);

	const isComplete = run.endedAt > 0;
	const duration = isComplete && run.startedAt > 0 ? run.endedAt - run.startedAt : 0;
	const showDuration = isComplete && duration > 0;

	// 流式思考注入：runtime 实时思考文本尚未落地为 thinking-group 时，
	// 合成虚拟 thinking-group 追加到 run 末尾，让思考卡与工具卡同轨出现在执行区；
	// 消息落地后（thinking-group 出现）自动退出，避免双份渲染。
	const effectiveRun = useMemo<AgentRunItem>(() => {
		if (
			!props.streamingThinking ||
			run.items.some((item) => item.kind === "thinking-group")
		) {
			return run;
		}
		const virtualGroup: ThinkingGroupItem = {
			kind: "thinking-group",
			id: `${run.id}:streaming-thinking`,
			messages: [],
			text: props.streamingThinking,
			startedAt: run.startedAt,
			// 未结束：endedAt 为 0，ThinkingBlock 保持 active tone、不触发完成收起
			endedAt: 0,
		};
		return { ...run, items: [...run.items, virtualGroup] };
	}, [run, props.streamingThinking]);

	// 扁平展示序列（纯函数：思考/工具/中间回答/最终回答，严格按时序）
	// isComplete：流式中（agent 忙碌）无法判断哪条是最后一条 assistant，
	// 全部按中间回答处理收进折叠栏；run 结束后才把最后一条提升为常驻最终回答。
	const displayItems = useMemo(
		() =>
			buildTurnDisplay(effectiveRun, {
				showThinking: props.showThinking,
				isComplete: !props.agentRunning,
			}),
		[effectiveRun, props.showThinking, props.agentRunning],
	);
	const processSummary = useMemo(() => buildProcessSummary(displayItems), [displayItems]);
	const showProcessToggle = hasFoldableContent(displayItems);

	// run 级折叠状态（一个开关控制全部思考/工具/中间回答步骤）
	// hasFinalAnswer：无最终回答的 run 不自动收起（中间回答是唯一输出，不能被折叠隐藏）
	const hasFinalAnswer = displayItems.some((item) => item.kind === "final-answer");
	const { stepsVisible, toggleSteps } = useTurnExecution({
		agentRunning: props.agentRunning,
		isComplete,
		hasFinalAnswer,
	});
	// 中间内容（思考/工具/中间回答）与最终回答分组：
	// 中间内容统一收进执行过程折叠容器（stepsVisible 整体控制显隐），
	// 最终回答留在容器外常驻、永不折叠。
	const foldableItems = useMemo(
		() => displayItems.filter((item) => item.kind !== "final-answer"),
		[displayItems],
	);
	const finalItems = useMemo(
		() => displayItems.filter((item) => item.kind === "final-answer"),
		[displayItems],
	);

	// 收集本轮所有 assistant 消息（按 run.items 的时序保持原始顺序）
	const assistantMessages = run.items.filter(
		(item): item is MessageItem =>
			item.kind === "message" && item.message.role === "assistant",
	);
	const allImages: ImageContent[] = [];
	for (const item of assistantMessages) {
		if (item.message.images) allImages.push(...item.message.images);
	}
	// 合并后的完整文本仅用于编辑/复制/删除等操作栏，不用于展示
	const mergedText = assistantMessages
		.map((item) => stripThinkingTags(stripAnsi(item.message.text)).trim())
		.filter(Boolean)
		.join("\n\n");

	// 本轮没有任何可渲染内容时不输出空容器
	if (displayItems.length === 0 && allImages.length === 0) return null;

	const startEditing = () => {
		setEditText(mergedText);
		setEditing(true);
	};
	const saveEdit = () => {
		const targetId = assistantMessages.at(-1)?.message.id;
		if (targetId && props.onEditMessage) {
			props.onEditMessage(targetId, editText);
			setEditing(false);
		}
	};
	const deleteMessage = () => {
		const targetId = assistantMessages.at(-1)?.message.id;
		if (targetId) props.onDeleteMessage?.(targetId);
	};

	return (
		<article
			ref={rowRef}
			className={`turn-row mb-6 w-full min-w-0 max-w-full ${
				props.agentRunning && !isComplete
					? "turn-row--running"
					: isComplete
						? "turn-row--complete"
						: "turn-row--pending"
			} ${props.fresh ? "turn-row--fresh" : ""}`}
			data-message-id={run.id}
		>
			<div className="flex min-w-0 flex-col gap-3">
				{/* 行头：logo 用字号 token（text-brand 18px），随 data-ui-font-size 整体缩放；
				    日期/耗时用 text-body（14px），比思考字号（text-micro）大但小于 logo。 */}
				<div className="mb-1 inline-flex items-center gap-2 text-muted-foreground tabular-nums">
					<span className="shrink-0 font-mono text-brand font-semibold leading-none text-foreground/80">pi</span>
					<time className="shrink-0 font-mono text-body leading-none">{formatTime(run.endedAt)}</time>
					{showDuration && (
						<span className="shrink-0 font-mono text-body leading-none text-muted-foreground">
							{formatDuration(duration)}
						</span>
					)}
				</div>

				{/* 执行过程折叠栏：中间内容（思考/工具/中间回答）统一收进容器，
				    由 stepsVisible 整体控制显隐；最终回答在容器外常驻。
				    学 Proma ProcessBlockGroup：CollapsibleContent 自带高度过渡动画，
				    折叠/展开是 scrollHeight 高度渐变而非 display:none 突变。 */}
				{showProcessToggle && (
					<Collapsible
						className="execution-summary"
						open={stepsVisible}
						onOpenChange={toggleSteps}
					>
						<ProcessSummaryToggle
							summary={processSummary}
							expanded={stepsVisible}
							onToggle={toggleSteps}
						/>
						<CollapsibleContent className="execution-summary-details">
							{foldableItems.map((item) => {
								let content: ReactNode;
								let itemKey: string;
								if (item.kind === "process-entry") {
									itemKey = item.entry.id;
									if (item.entry.kind === "thinking-entry") {
										content = (
											<ThinkingStep
												group={item.entry.group}
												hidden={!stepsVisible}
												isStreaming={props.isStreaming}
												showThinking={props.showThinking}
												onOpenExternal={props.onOpenExternal}
												onOpenFile={props.onOpenFile}
											/>
										);
									} else {
										content = (
											<ToolStep group={item.entry.group} hidden={!stepsVisible} />
										);
									}
								} else if (item.kind === "interim-answer") {
									itemKey = item.id;
									// 中间回答：与思考相同的 MarkdownStream 渲染 + execution-interim 过程样式
									content = (
										<InterimAnswer
											text={item.message.text}
											hidden={!stepsVisible}
											isStreaming={props.isStreaming ?? false}
											onOpenExternal={props.onOpenExternal}
											onOpenFile={props.onOpenFile}
										/>
									);
								} else {
									// final-answer 不在此容器内（见下方常驻区），此处仅兜底跳过
									return null;
								}
								return <Fragment key={itemKey}>{content}</Fragment>;
							})}
							{/* 收起按钮：固定在折叠容器末尾（不再是动态跟随） */}
							{stepsVisible && (
								<button
									type="button"
									className="execution-summary-collapse"
									onClick={toggleSteps}
									title={t("common.collapse")}
								>
									<ChevronUp size={12} aria-hidden="true" />
									<span>{t("common.collapse")}</span>
								</button>
							)}
						</CollapsibleContent>
					</Collapsible>
				)}

				{/* 最终回答：本轮最后一条 assistant 文本，常驻、永不折叠 */}
				{finalItems.map((item) => (
					<FinalAnswer
						key={item.id}
						message={item.message}
						images={allImages}
						isStreaming={props.isStreaming ?? false}
						editing={editing}
						editText={editText}
						editAreaRef={editAreaRef}
						onEditTextChange={setEditText}
						onStartEdit={startEditing}
						onCancelEdit={() => setEditing(false)}
						onSaveEdit={saveEdit}
						onPreviewImage={props.onPreviewImage}
						onOpenExternal={props.onOpenExternal}
						onOpenFile={props.onOpenFile}
					/>
				))}

				{/* 操作栏 */}
				{mergedText && !editing && (
					<div className="flex min-h-6 items-center gap-1 opacity-55 transition-opacity hover:opacity-100 focus-within:opacity-100">
						<CopyMenu
							text={stripMarkdown(mergedText)}
							markdown={mergedText}
							targetRef={rowRef}
						/>
						<Button
							type="button"
							className="turn-row-action-btn inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground"
							onClick={props.onEnterMultiSelect}
							title={t("app.multiSelectEnter")}
						>
							<Share size={14} />
						</Button>
						{!props.isStreaming &&
							!props.agentRunning &&
							assistantMessages.at(-1)?.message.id && (
								<>
									{props.onEditMessage && (
										<Button
											type="button"
											className="turn-row-action-btn inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground"
											onClick={startEditing}
											title={t("common.edit")}
										>
											<SquarePen size={14} />
										</Button>
									)}
									{props.onDeleteMessage && (
										<Button
											type="button"
											className="turn-row-action-btn inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground"
											onClick={deleteMessage}
											title={t("common.delete")}
										>
											<Trash size={14} />
										</Button>
									)}
								</>
							)}
					</div>
				)}
			</div>
		</article>
	);
});
