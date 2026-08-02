import { memo, useState, type ReactNode } from "react";
import {
  Brain,
  Check,
  ChevronDown,
  Copy,
  FileText,
  Folder,
  Globe2,
  MessageCircle,
  Network,
  Search,
  SquarePen,
  Terminal,
  Wrench,
} from "lucide-react";
import {
  countTextLines,
  getToolEditDiff,
  getToolFilePath,
  parseToolArgs,
  type ToolGroupItem,
} from "../app/AppUtils";
import { t } from "../../i18n";
import { Button } from "../ui-shadcn/button";
import { showNotice } from "../../utils/notice";
import type { ChatMessage } from "../../../../shared/types";
import {
  formatDuration,
  getToolDetailText,
  getToolExitCode,
  getToolName,
  getToolStatus,
	getToolDiffTarget,
} from "./TimelineFormat";

export type DiffFileHandler = (
  path: string,
  originalContent?: string,
  content?: string,
) => void;

function toolIcon(toolName: string): ReactNode {
	const key = toolName.toLowerCase();
	if (key.includes("read") || key.includes("view")) return <FileText size={15} />;
	if (key.includes("write") || key.includes("edit") || key.includes("apply_patch") || key.includes("patch"))
		return <SquarePen size={15} />;
	if (key.includes("bash") || key.includes("shell") || key.includes("terminal")) return <Terminal size={15} />;
	if (key.includes("grep") || key.includes("search")) return <Search size={15} />;
	if (key.includes("glob") || key.includes("list") || key.includes("ls")) return <Folder size={15} />;
	if (key.includes("task") || key.includes("subagent") || key.includes("agent")) return <Network size={15} />;
	if (key.includes("web") || key.includes("fetch")) return <Globe2 size={15} />;
	if (key.includes("todo")) return <Check size={15} />;
	return <Wrench size={15} />;
}



/** 从工具消息 meta 中提取副标题（文件路径或命令），让 trigger 行能体现工具作用对象。
 *  pi 的工具参数可能是对象，也可能已被主进程截断/序列化为 JSON 字符串；两种格式都要兼容，否则 bash 命令摘要会丢失。 */
function getToolSubtitle(message: ChatMessage): string {
	const meta = message.meta;
	if (!meta) return "";
	// 优先从 args 取参数（pi 工具事件的标准结构）
	const args = parseToolArgs(meta.args);
	if (args) {
		for (const key of [
			// 文件操作类
			"filePath", "file_path", "path", "file",
			// bash/shell 命令
			"command",
			// 搜索/查询类（grep、web_search 等）
			"pattern", "query", "queries",
			// 网络获取类（fetch_content 等）
			"url", "urls",
			// 待办事项类（todo 等）
			"action", "text",
		]) {
			const v = args[key];
			if (typeof v === "string" && v) return v;
			// queries 和 urls 是数组，取第一条
			if (Array.isArray(v) && v.length > 0 && typeof v[0] === "string") return v[0];
		}
	}
	// 兼容历史平铺写法
	const path = meta.path;
	if (typeof path === "string" && path) return path;
	const command = meta.command;
	if (typeof command === "string" && command) return command;
	const file = meta.file;
	if (typeof file === "string" && file) return file;
	// 兜底：取 args 中第一个非空字符串值
	if (args && typeof args === "object") {
		for (const val of Object.values(args as Record<string, unknown>)) {
			if (typeof val === "string" && val) return val;
		}
	}
	return "";
}

/**
 * 识别模型主动触发的 skill：pi 系统提示会指示 LLM 用 read 工具读取 SKILL.md 来加载 skill，
 * 所以 toolName==="read" 且 path 以 SKILL.md 结尾时，视为 skill 调用，返回 skill 名（父目录名）。
 * 这是模型侧的 skill 触发，与用户侧 /skill:name 展开成 <skill> 块不同。
 */
function getReadSkillName(message: ChatMessage): string | undefined {
	const meta = message.meta;
	if (!meta) return;
	const toolName = typeof meta.toolName === "string" ? meta.toolName : "";
	if (toolName.toLowerCase() !== "read") return;
	const args = meta.args as Record<string, unknown> | undefined;
	if (!args || typeof args !== "object") return;
	const rawPath = String(args.path ?? args.filePath ?? args.file_path ?? "");
	if (!rawPath) return;
	// 取最后一段文件名与父目录名，跨平台分隔符兼容
	const segs = rawPath.split(/[\\/]/).filter(Boolean);
	const fileName = segs[segs.length - 1] ?? "";
	if (fileName.toUpperCase() !== "SKILL.MD") return;
	return segs[segs.length - 2] ?? fileName;
}

/** 计算工具的语气色：running 黄、error 红、非零退出 warning、其余 ok。 */
function getToolTone(message: ChatMessage): "running" | "error" | "warning" | "ok" {
	const status = getToolStatus(message);
	const exitCode = getToolExitCode(message);
	if (status === "running") return "running";
	if (status === "error" || message.meta?.isError === true) return "error";
	if (typeof exitCode === "number" && exitCode !== 0) return "warning";
	return "ok";
}

/** pi 内置工具名集合，用于与 MCP / 扩展工具区分。 */
const BUILT_IN_TOOLS = new Set(["bash", "edit", "find", "grep", "ls", "read", "write"]);

/**
 * 扩展工具中带下划线的名称，会被 MCP-direct 正则误匹配为形如 {server}_{tool}。
 * 在此登记后 getToolKind 将其归为 "extension" 而非 "mcp-direct"。
 */
const NON_MCP_TOOLS = new Set(["ask_question"]);

/**
 * 识别工具来源类型：
 * - mcp-proxy：toolName 为 mcp（pi-mcp-adapter 代理模式，LLM 通过单一 mcp 工具调用具体 server/tool）
 * - mcp-direct：toolName 形如 {server}_{tool} 且非内置/非扩展工具（directTools 模式，server 名去掉 -mcp 后缀）
 * - builtin：pi 内置工具（bash/edit/find/grep/ls/read/write）
 * - extension：扩展工具或自定义命名的其他工具
 */
function getToolKind(toolName: string): "mcp-proxy" | "mcp-direct" | "builtin" | "extension" {
	const key = toolName.toLowerCase();
	if (key === "mcp") return "mcp-proxy";
	if (BUILT_IN_TOOLS.has(key)) return "builtin";
	// directTools 模式：server_tool，server 名通常含字母/连字符，tool 名也是标识符
	if (/^[a-z][a-z0-9-]*_[a-z][a-z0-9_-]*$/i.test(toolName)) {
		// 已知扩展工具名含下划线但不是 MCP 直连 → 归为 extension
		if (NON_MCP_TOOLS.has(key)) return "extension";
		return "mcp-direct";
	}
	return "extension";
}

/** 从 MCP direct 工具名中拆出 server 名（chrome_devtools_navigate → chrome）。 */
function getMcpServerName(toolName: string): string {
	const idx = toolName.indexOf("_");
	return idx > 0 ? toolName.slice(0, idx) : toolName;
}

/** 给工具返回展示标签：MCP 代理/直连/内置/扩展，用于 ToolCard trigger 的 kind 徽标。 */
function getToolKindLabel(toolName: string): string {
	const kind = getToolKind(toolName);
	if (kind === "mcp-proxy") return "MCP";
	if (kind === "mcp-direct") return `MCP·${getMcpServerName(toolName)}`;
	return "";
}

/** 单个工具调用卡片：trigger 行（图标+工具名+副标题+状态+耗时）+ 展开后详情。 */
export const ToolCard = memo(function ToolCard(props: {
	message: ChatMessage;
	defaultOpen?: boolean;
	onDiffFile?: DiffFileHandler;
}) {
	const [expanded, setExpanded] = useState(props.defaultOpen ?? false);
	const status = getToolStatus(props.message);
	const toolName = getToolName(props.message);
	const detailText = getToolDetailText(props.message);
	const tone = getToolTone(props.message);
	const subtitle = getToolSubtitle(props.message);
	const kindLabel = getToolKindLabel(toolName);
	const diffTarget = getToolDiffTarget(props.message);
	const durationMs =
		typeof props.message.meta?.durationMs === "number"
			? props.message.meta.durationMs
			: undefined;
	const showDuration = status !== "running" && durationMs !== undefined;
	// 模型用 read 工具读取 SKILL.md 来加载 skill：识别后以 skill 徽标样式渲染
	const skillName = getReadSkillName(props.message);
	const isSkillRead = Boolean(skillName);
	// 历史会话中从 ask_question 工具结果反推的提问卡片数据
	const askCard = props.message.meta?._askCard as
		| { question?: string; type?: string; answered?: boolean; answer?: unknown; answerLabel?: string; options?: string[] }
		| undefined;
	const isAskCard = Boolean(askCard?.question);
	// 运行中显示 "运行中"，出错显示 "错误"，完成后不显示状态文本
const statusLabel =
	status === "running"
		? t("tool.statusRunning")
		: status === "error"
			? t("tool.statusError")
			: "";
	const [copied, setCopied] = useState(false);
	const handleCopy = () => {
		navigator.clipboard.writeText(detailText);
		setCopied(true);
		showNotice(t("app.codeCopied"), 1200);
		setTimeout(() => setCopied(false), 2000);
	};
	return (
		<section
			className={`tool-card w-full min-w-0 overflow-hidden rounded-md border border-border-subtle bg-bg-panel transition-[border-color,background-color] duration-150 tone-${tone}${isSkillRead ? " tool-card--skill" : ""}${isAskCard ? " tool-card--ask" : ""}`}
			data-status={status}
			data-tool-kind={isSkillRead ? "skill" : getToolKind(toolName)}
			data-message-id={props.message.id}
		>
			<div className={`flex min-h-8 items-center transition-colors duration-150 hover:bg-[color:color-mix(in_srgb,var(--color-bg-hover)_55%,var(--color-bg-panel))]${diffTarget ? " gap-2" : ""}`}>
				<button
					className="flex min-h-8 min-w-0 flex-[1_1_auto] cursor-pointer items-center gap-2 border-0 bg-transparent p-1.5 pl-2.5 text-left text-[13px] leading-5 text-text-secondary focus-visible:-outline-offset-2 focus-visible:outline-2"
					onClick={() => setExpanded((v) => !v)}
					aria-expanded={expanded}
				>
					<span className="inline-flex shrink-0 items-center justify-center text-text-tertiary">
						{isSkillRead ? <Brain size={15} /> : isAskCard ? <MessageCircle size={15} /> : toolIcon(toolName)}
					</span>
					<span className="shrink-0 text-sm font-[650] lowercase text-text-primary">
						{isSkillRead ? `skill:${skillName}` : isAskCard ? t("ask.toolName") : toolName}
					</span>
					<ChevronDown
						size={14}
						className={`shrink-0 text-text-tertiary transition-transform duration-150${expanded ? " rotate-180" : ""}`}
					/>
					{!isSkillRead && kindLabel && (
						<span className="tool-card-kind">{kindLabel}</span>
					)}
					<span className="inline-flex shrink-0 items-center gap-[5px] font-mono text-[11px] tabular-nums text-text-tertiary">
						{status === "running" && <span className="size-2.5 animate-spin rounded-full border-2 border-[color:color-mix(in_srgb,var(--color-warning)_30%,transparent)] border-t-[var(--color-warning)]" aria-hidden="true" />}
						{askCard?.answered ? t("ask.answered") : (statusLabel)}
					</span>
					{showDuration && (
						<span className="shrink-0 font-mono text-[11px] tabular-nums text-text-tertiary" title={t("tool.durationTitle")}>
							{formatDuration(durationMs)}
						</span>
					)}
					{isAskCard && askCard?.question ? (
						<span className="min-w-0 flex-[1_1_auto] truncate font-mono text-xs text-text-tertiary" title={askCard.question}>
							| {askCard.question}
						</span>
					) : subtitle ? (
						<span className="min-w-0 flex-[1_1_auto] truncate font-mono text-xs text-text-tertiary" title={subtitle}>
							| {subtitle}
						</span>
					) : null}
				</button>
				{diffTarget && props.onDiffFile && (
					<button
						className="mr-auto inline-flex h-[22px] shrink-0 cursor-pointer items-center self-center rounded-sm border border-[color-mix(in_srgb,var(--color-accent)_24%,var(--color-border-subtle))] bg-transparent px-2 font-mono text-[11px] leading-none text-[color:color-mix(in_srgb,var(--color-accent)_80%,var(--color-text-tertiary))] transition-[background-color,border-color,color] duration-150 hover:border-[var(--color-accent)] hover:bg-[color:color-mix(in_srgb,var(--color-accent)_6%,transparent)] hover:text-[var(--color-accent)] focus-visible:shadow-[var(--focus-ring)] focus-visible:outline-none"
						type="button"
						onClick={() => props.onDiffFile?.(diffTarget.path, diffTarget.originalContent, diffTarget.content)}
						title={`${t("tool.viewDiff")} · ${diffTarget.path}`}
					>
						{t("tool.diff")}
					</button>
				)}
			</div>
			{expanded && (
				<div className="relative rounded-b-sm border-t border-border-subtle bg-transparent">
					{isAskCard && askCard ? (
						<div className="ask-question-card-tool-inner">
							<div className="ask-question-card-title"><MessageCircle size={13} />{askCard.question}</div>
							{askCard.options && askCard.options.length > 0 && (
								<div className="ask-question-card-options-list">
									{askCard.options.map((opt, i) => {
										const optLabel = typeof opt === "string" ? opt : (opt as any).label ?? String((opt as any).value ?? "");
										const optValue = typeof opt === "string" ? opt : String((opt as any).value ?? optLabel);
										const desc = typeof opt === "object" ? (opt as any).description : undefined;
										const isSelected = askCard.answered && (optLabel === askCard.answerLabel || optValue === askCard.answer);
										return (
											<div key={i} className={`ask-question-card-option-item${isSelected ? " selected" : ""}`}>
												<span className="ask-question-card-option-selector">{isSelected ? "✓" : ""}</span>
												<div className="ask-question-card-option-text">
													<span className="ask-question-card-option-label">{optLabel}</span>
													{desc && <span className="ask-question-card-option-desc">{desc}</span>}
												</div>
											</div>
										);
									})}
								</div>
							)}
							{askCard.answered && (!askCard.options || askCard.options.length === 0) ? (
								<div className="ask-question-card-answered">
									<Check size={14} className="ask-question-card-answered-ok" />
									<span className="ask-question-card-answer-text">
										{askCard.answerLabel ?? (
											typeof askCard.answer === "string" ? askCard.answer :
											typeof askCard.answer === "boolean" ? (askCard.answer ? t("common.true") : t("common.false")) :
											t("ask.answered")
										)}
									</span>
								</div>
							) : askCard.answered ? (
								<div className="ask-question-card-answered">
									<Check size={14} className="ask-question-card-answered-ok" />
									<span className="ask-question-card-answer-text">
										{askCard.answerLabel ?? (
											typeof askCard.answer === "string" ? askCard.answer :
											typeof askCard.answer === "boolean" ? (askCard.answer ? t("common.true") : t("common.false")) :
											t("ask.answered")
										)}
									</span>
								</div>
							) : (
								<div className="ask-question-card-answered" style={{ color: "var(--color-text-tertiary)" }}>
									{t("ask.unanswered")}
								</div>
							)}
						</div>
					) : (
						<pre className="m-0 max-h-[320px] overflow-auto p-2 font-mono text-xs leading-relaxed break-words whitespace-pre-wrap text-text-tertiary">{detailText}</pre>
					)}
					<Button
						variant="ghost" size="icon-sm"
						className="tool-card-copy absolute top-1.5 right-1.5 size-7 rounded-[4px] p-0 text-text-tertiary opacity-55 hover:text-[var(--color-accent)]"
						onClick={handleCopy}
						title={t("tool.copyDetail")}
					>
						{copied ? <Check size={14} /> : <Copy size={14} />}
					</Button>
				</div>
			)}
		</section>
	);
});
/** 工具组直接平铺为工具列表；每个 ToolCard 自己默认折叠，避免外层再占一行。 */
export const ToolGroupCard = memo(function ToolGroupCard(props: {
	group: ToolGroupItem;
	onDiffFile?: DiffFileHandler;
}) {
	return (
		<section className="w-full min-w-0 overflow-hidden rounded-none border-0 bg-transparent" data-message-id={props.group.id}>
			<div className="flex flex-col gap-1 p-0">
				{props.group.messages.map((message) => (
					<ToolCard key={message.id} message={message} onDiffFile={props.onDiffFile} />
				))}
			</div>
		</section>
	);
});
