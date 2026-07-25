import {
	Fragment,
	isValidElement,
	memo,
	useCallback,
	useEffect,
	useId,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
	type CSSProperties,
	type PointerEvent as ReactPointerEvent,
	type ReactNode,
} from "react";
import { toBlob } from "html-to-image";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import "katex/dist/katex.min.css";
import {
	summarizeMessage,
	type ToolGroupItem,
	type MessageItem,
	type ThinkingGroupItem,
	type AgentRunItem,
	type RenderMessage,
	type ComposerSuggestionResult,
	type ComposerTrigger,
	type SuggestionItem,
	groupToolMessages,
	buildOutline,
	detectTrigger,
	applySuggestion,
	clearSuggestionTrigger,
	buildSuggestionItems,
	mergeCommands,
	matches,
	displayPath,
	flattenFiles,
	parseToolArgs,
	getToolFilePath,
	countTextLines,
	getToolEditDiff,
} from "../app/AppUtils";

// Mermaid 库体积数 MB，仅在真正出现 mermaid 代码块时才动态加载，
// 避免随渲染进程常驻、放大内存占用并在流式期间抢占主线程。
let mermaidModulePromise: Promise<typeof import("mermaid")> | null = null;
function loadMermaid() {
	if (!mermaidModulePromise) mermaidModulePromise = import("mermaid");
	return mermaidModulePromise;
}
import {
	AlertTriangle,
	Check,
	ChevronDown,
	ChevronLeft,
	ChevronRight,
	ChevronsUpDown,
	ChevronUp,
	MoveDown,
	MoveUp,
	ChevronsDownUp,
	GitBranch,
	Brain,
	Eye,
	FileText,
	Folder,
	Globe2,
	MessageCircle,
	Network,
	PawPrint,
	Pin,
	Plus,
	RefreshCw,
	Search,
	Settings2,
	Terminal,
	UploadCloud,
	Wrench,
	X,
	Star,
	FolderOpen,
	Copy,
	Trash,
	Share,
	SquarePen,
	Send,
	UserPen,
} from "lucide-react";
import { getFileIconSeti, getFileIconColor, getFileTypeLabel } from "../../fileIcons";
import { normalizeSessionPathForCompare } from "../../agentListDisplay";
import { t, type TranslationKey } from "../../i18n";
import { showNotice } from "../../utils/notice";
import { Button } from "../ui/Button";
import { CloseIconButton, IconButton } from "../ui/IconButton";
import { Modal } from "../ui/Modal";
import { SelectField } from "../ui/SelectField";
import { TextField } from "../ui/TextField";
import type {
	AgentRuntimeState,
	AgentTab,
	AppInfo,
	AppSettings,
	ComposerAgentMode,
	AvailableModel,
	ChatMessage,
	CodexImportReport,
	CodexSessionSummary,
	ClaudeImportReport,
	ClaudeSessionSummary,
	OpenCodeImportReport,
	OpenCodeSessionSummary,
	FileTreeNode,
	GitBranchInfo,
	ImageContent,
	PetManifest,
	PiCliUpdateResult,
	PiCommand,
	PiInstallExecResult,
	PiInstallStatus,
	PiUpdateCheckResult,
	Project,
	SessionSummary,
} from "../../../../shared/types";
import { parseRichInputChips, type RichInputChip } from "../app/RichInput";
import removeMarkdown from "remove-markdown";
/** 复用 petdex 标准网格规格，在主设置面板里为宠物选择器渲染单格动画预览 */
import { GRID_COLS, CELL_W, CELL_H, MODE_ROW, MODE_FRAMES } from "../../pet/PetSpriteSheet";

import type { WorkspaceDrawerPanel } from "../../hooks/useWorkspacePanels";

// ============================================================
// Surface & Workspace domain components
// 从 AppParts.tsx 提取，包含所有会话渲染组件
// ============================================================

type DiffFileHandler = (path: string, originalContent?: string, content?: string) => void;

type SessionModifiedFile = {
	path: string;
	toolName: string;
	status: string;
	changedLines?: number;
	/** 工具执行前的文件原始内容，用于历史会话恢复时展示差异对比。 */
	originalContent?: string;
	/** 工具写入/编辑后的新文件内容，优先于从磁盘实时读取（历史会话恢复时磁盘可能已变化或文件已删除）。 */
	content?: string;
};


export function SessionStatus(props: {
	state?: AgentRuntimeState;
	duration?: number;
}) {
	const state = props.state;
	if (!state) return null;
	return (
		<div className="session-status">
			{state.contextPercent != null && (
				<span className="ctx-chip">
					{t("app.ctx")}:{" "}
					{state.contextPercent?.toFixed?.(1) ??
						state.contextPercent}
					% / {formatCompact(state.contextWindow)}
					{state.inputTokens != null && (
						<>{" "}↑ {formatCompact(state.inputTokens)}</>
					)}
					{state.outputTokens != null && (
						<>{" "}↓ {formatCompact(state.outputTokens)}</>
					)}
				</span>
			)}
			{(state.cacheHitPercent != null || state.cacheTotal != null) && (
				<span className="cache-chip">
					{state.cacheHitPercent != null && (
						<>{t("app.cacheHit")}: {state.cacheHitPercent?.toFixed?.(0) ?? state.cacheHitPercent}%</>
					)}
					{state.cacheHitPercent != null && state.cacheTotal != null && " "}
					{state.cacheTotal != null && (
						<>{t("app.cache")}: {formatCompact(state.cacheTotal)}</>
					)}
				</span>
			)}
			{state.cost != null && (
				<span className="cost-chip" title={t("app.totalCost")}>
					${state.cost.toFixed(3)}
				</span>
			)}
		</div>
	);
}

function formatCompact(value?: number | null) {
	if (value == null) return "-";
	if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
	if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
	return String(value);
}

export function LogoMark() {
	return (
		<div className="logo-mark" aria-label={t("app.logoLabel")}>
			<svg viewBox="140 140 520 520" width="22" height="22" aria-hidden="true">
				<path
					fill="#fff"
					fillRule="evenodd"
					d="M165.29 165.29H517.36V400H400V517.36H282.65V634.72H165.29ZM282.65 282.65V400H400V282.65Z"
				/>
				<path fill="#fff" d="M517.36 400H634.72V634.72H517.36Z" />
			</svg>
		</div>
	);
}


export function AgentAvatar(props: { status: string }) {
	return (
		<div className={`conversation-avatar agent-avatar ${props.status}`}>
			<svg viewBox="140 140 520 520" width="28" height="28" aria-hidden="true">
				<path
					fill="#fff"
					fillRule="evenodd"
					d="M165.29 165.29H517.36V400H400V517.36H282.65V634.72H165.29ZM282.65 282.65V400H400V282.65Z"
				/>
				<path fill="#fff" d="M517.36 400H634.72V634.72H517.36Z" />
			</svg>
		</div>
	);
}

export function EmptyState(props: { hasProject: boolean; onCreate: () => void }) {
	return (
		<div className="empty-state">
			<div className="empty-logo">
				<svg
					viewBox="140 140 520 520"
					width="66"
					height="66"
					aria-hidden="true"
				>
					<path
						fill="#fff"
						fillRule="evenodd"
						d="M165.29 165.29H517.36V400H400V517.36H282.65V634.72H165.29ZM282.65 282.65V400H400V282.65Z"
					/>
					<path fill="#fff" d="M517.36 400H634.72V634.72H517.36Z" />
				</svg>
			</div>
			<div className="empty-tagline" aria-label={`${t("app.emptyTaglineLine1")} ${t("app.emptyTaglineLine2Prefix")}${t("app.emptyTaglineYours")}`}>
				<span>{t("app.emptyTaglineLine1")}</span>
				<span>
					{t("app.emptyTaglineLine2Prefix")}
					<em className="empty-tagline-yours">{t("app.emptyTaglineYours")}</em>
				</span>
			</div>
			<p className="empty-subtitle">
				{t("app.emptySubtitle").split("\n").map((line, i) => (
					<Fragment key={i}>
						{i > 0 && <br />}
						<span className="empty-subtitle-line">{line}</span>
					</Fragment>
				))}
			</p>
			{props.hasProject ? (
				<button onClick={props.onCreate}>{t("app.createAgent")}</button>
			) : (
				<p className="empty-hint">{t("app.emptyNoProject")}</p>
			)}
		</div>
	);
}

async function copyElementAsPng(element: HTMLElement) {
	// 截图复制依赖浏览器 ClipboardItem PNG 支持；失败时由调用方提示/回退，不影响文本复制。
	// 使用 toBlob 而非 toPng+fetch 避免 CSP 拒绝连接 data: URL。
	// 克隆节点 + 内边距 + 临时注入 body 的方式与分享为图片（handleMultiSelectCopy）保持一致，
	// 避免直接截图导致图片紧贴内容边缘、缺少留白。
	const clone = element.cloneNode(true) as HTMLElement;
	clone.style.padding = "24px";
	clone.style.background =
		getComputedStyle(document.documentElement).getPropertyValue("--color-bg-panel") || "#fff";
	// 将 clone 插入到原元素旁边，确保 CSS 样式正确继承（父层选择器、rem 等）
	if (element.parentElement) {
		element.parentElement.insertBefore(clone, element.nextSibling);
	}
	let blob: Blob | null = null;
	try {
		blob = await toBlob(clone, {
			cacheBust: true,
			pixelRatio: Math.min(2, window.devicePixelRatio || 1),
			backgroundColor:
				getComputedStyle(document.documentElement).getPropertyValue("--color-bg-panel") || undefined,
			filter: (node) =>
				!(node instanceof HTMLElement) ||
				(!node.classList.contains("turn-row-actions") &&
					!node.classList.contains("user-turn-actions") &&
					!node.classList.contains("copy-menu-popover")),
		});
	} finally {
		clone.remove();
	}
	if (!blob) return;
	await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
}

function CopyMenu(props: {
	text: string;
	markdown: string;
	targetRef: React.RefObject<HTMLElement | null>;
	className?: string;
}) {
	const [open, setOpen] = useState(false);
	const [copied, setCopied] = useState<string | null>(null);
	const [menuStyle, setMenuStyle] = useState<CSSProperties>({});
	const triggerRef = useRef<HTMLButtonElement | null>(null);
	const closeTimerRef = useRef<number | null>(null);
	const clearCloseTimer = () => {
		if (closeTimerRef.current !== null) {
			window.clearTimeout(closeTimerRef.current);
			closeTimerRef.current = null;
		}
	};
	const scheduleClose = () => {
		// 操作栏由 hover/focus 控制显隐；离开后主动收起菜单，避免下次 hover 时复用旧 open 状态。
		clearCloseTimer();
		closeTimerRef.current = window.setTimeout(() => {
			setOpen(false);
			closeTimerRef.current = null;
		}, 180);
	};
	useEffect(() => clearCloseTimer, []);
	const copy = async (kind: "text" | "markdown" | "image") => {
		try {
			if (kind === "text") await navigator.clipboard.writeText(props.text);
			if (kind === "markdown") await navigator.clipboard.writeText(props.markdown);
			if (kind === "image" && props.targetRef.current) await copyElementAsPng(props.targetRef.current);
			setCopied(kind);
			setOpen(false);
			showNotice(t("copy.success"), 1200);
			window.setTimeout(() => setCopied(null), 1800);
		} catch {
			setCopied(null);
			showNotice(t("copy.failed"), 2000);
		}
	};
	const toggleOpen = () => {
		clearCloseTimer();
		const rect = triggerRef.current?.getBoundingClientRect();
		if (rect) {
			setMenuStyle({
				position: "fixed",
				top: rect.bottom + 4,
				left: Math.min(window.innerWidth - 156, Math.max(8, rect.right - 148)),
			});
		}
		setOpen((value) => !value);
	};
	return (
		<div
			className={`copy-menu ${props.className ?? ""}`}
			onPointerEnter={clearCloseTimer}
			onPointerLeave={scheduleClose}
		>
			<button
				ref={triggerRef}
				className="copy-menu-trigger"
				type="button"
				onClick={toggleOpen}
				aria-expanded={open}
				title={t("common.copy")}
			>
				{copied ? <Check size={14} /> : <Copy size={14} />}
			</button>
			{open && (
				<div className="copy-menu-popover" style={menuStyle}>
					<button type="button" onClick={() => void copy("text")}>{t("copy.asText")}</button>
					<button type="button" onClick={() => void copy("markdown")}>{t("copy.asMarkdown")}</button>
					<button type="button" onClick={() => void copy("image")}>{t("copy.asImage")}</button>
				</div>
			)}
		</div>
	);
}

// ============================================================
// 会话时间线渲染组件（借鉴 opencode 扁平 timeline 风格重写）
// 设计要点：
// - 助手内容去掉气泡，改为左对齐扁平排版，用左侧竖线聚合一轮对话
// - 工具调用做成独立可折叠卡片，trigger 行 + 展开内容，内联在 timeline 里
// - 用户消息保留右对齐气泡，但收窄并去掉头像，操作栏 hover 显隐
// - 思考过程做成轻量折叠卡片，不再占用大块气泡空间
// ============================================================

/** 按工具名选择语义图标：read→文件、edit→铅笔、bash→终端、grep→搜索等，未匹配回退扳手。 */
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

function getToolArgFilePath(args: Record<string, unknown> | undefined): string | undefined {
	return getToolFilePath(args);
}

function getToolDiffTarget(message: ChatMessage): { path: string; originalContent: string; content: string; changedLines: number } | undefined {
	const toolName = getToolName(message);
	if (!/write|edit|create|patch/i.test(toolName)) return undefined;
	const args = parseToolArgs(message.meta?.args);
	const path = getToolArgFilePath(args);
	if (!args || !path) return undefined;
	if (/write|create/i.test(toolName)) {
		const content = typeof args.content === "string"
			? args.content
			: typeof args.text === "string"
				? args.text
				: undefined;
		if (content === undefined) return undefined;
		return { path, originalContent: "", content, changedLines: countTextLines(content) };
	}
	// edit/patch：不存储 full file originalContent，只展示变动区域
	const diff = getToolEditDiff(args);
	if (!diff) return undefined;
	return {
		path,
		originalContent: diff.oldText,
		content: diff.newText,
		changedLines: Math.max(countTextLines(diff.oldText), countTextLines(diff.newText)),
	};
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
			className={`tool-card tone-${tone}${isSkillRead ? " tool-card--skill" : ""}${isAskCard ? " tool-card--ask" : ""}`}
			data-status={status}
			data-tool-kind={isSkillRead ? "skill" : getToolKind(toolName)}
			data-message-id={props.message.id}
		>
			<div className={`tool-card-header${diffTarget ? " has-diff" : ""}`}>
				<button
					className="tool-card-trigger"
					onClick={() => setExpanded((v) => !v)}
					aria-expanded={expanded}
				>
					<span className="tool-card-icon">
						{isSkillRead ? <Brain size={15} /> : isAskCard ? <MessageCircle size={15} /> : toolIcon(toolName)}
					</span>
					<span className="tool-card-name">
						{isSkillRead ? `skill:${skillName}` : isAskCard ? t("ask.toolName") : toolName}
					</span>
					<ChevronDown
						size={14}
						className={`tool-card-chevron${expanded ? " open" : ""}`}
					/>
					{!isSkillRead && kindLabel && (
						<span className="tool-card-kind">{kindLabel}</span>
					)}
					<span className="tool-card-status">
						{status === "running" && <span className="tool-card-spinner" aria-hidden="true" />}
						{askCard?.answered ? t("ask.answered") : (statusLabel)}
					</span>
					{showDuration && (
						<span className="tool-card-duration" title={t("tool.durationTitle")}>
							{formatDuration(durationMs)}
						</span>
					)}
					{isAskCard && askCard?.question ? (
						<span className="tool-card-subtitle" title={askCard.question}>
							| {askCard.question}
						</span>
					) : subtitle ? (
						<span className="tool-card-subtitle" title={subtitle}>
							| {subtitle}
						</span>
					) : null}
				</button>
				{diffTarget && props.onDiffFile && (
					<button
						className="tool-card-diff-chip"
						type="button"
						onClick={() => props.onDiffFile?.(diffTarget.path, diffTarget.originalContent, diffTarget.content)}
						title={`${t("tool.viewDiff")} · ${diffTarget.path}`}
					>
						{t("tool.diff")}
					</button>
				)}
			</div>
			{expanded && (
				<div className="tool-card-content">
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
						<pre className="tool-card-detail">{detailText}</pre>
					)}
					<button
						className="tool-card-copy"
						onClick={handleCopy}
						title={t("tool.copyDetail")}
					>
						{copied ? <Check size={14} /> : <Copy size={14} />}
					</button>
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
		<section className="tool-group-card flat" data-message-id={props.group.id}>
			<div className="tool-group-card-list">
				{props.group.messages.map((message) => (
					<ToolCard key={message.id} message={message} onDiffFile={props.onDiffFile} />
				))}
			</div>
		</section>
	);
});

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
		<article
			className={`compaction-card${expanded ? " compaction-card--expanded" : ""}`}
			data-message-id={props.message.id}
		>
			<button
				type="button"
				className="compaction-card-header"
				onClick={() => hasArchived && setExpanded(!expanded)}
				disabled={!hasArchived}
				aria-expanded={expanded}
			>
				<span className="compaction-card-icon" aria-hidden="true">
					{hasArchived ? (expanded ? "📂" : "📁") : "🔁"}
				</span>
				<div className="compaction-card-body">
					<span className="compaction-card-summary">{stripAnsi(summary)}</span>
					<div className="compaction-card-meta">
						{typeof compactionCount === "number" && compactionCount > 0 && (
							<span className="compaction-card-count">
								{t("app.compactionCount", { count: compactionCount })}
							</span>
						)}
						{typeof tokensBefore === "number" && (
							<span className="compaction-card-tokens">
								~{Math.round(tokensBefore / 1000)}k tokens before
							</span>
						)}
						{hasArchived && (
							<span className="compaction-card-hint">
								{expanded ? t("app.compactionCollapse") : t("app.compactionExpand")}
							</span>
						)}
					</div>
					<time className="compaction-card-time">{time}</time>
				</div>
			</button>
			{expanded && hasArchived && (
				<div className="compaction-card-archive">
					<div className="compaction-card-archive-divider" />
					<ArchivedMessageList messages={archivedMessages} />
				</div>
			)}
		</article>
	);
});

/** 归档消息列表：压缩卡片展开时，以简略格式渲染压缩前的消息历史。 */
function ArchivedMessageList({ messages }: { messages: ChatMessage[] }) {
	return (
		<div className="archived-message-list">
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
		<div className={`archived-message archived-message--${message.role}`}>
			<span className="archived-message-role">{roleIcon}</span>
			<span className="archived-message-text">{preview || "(empty)"}</span>
		</div>
	);
}

/** 错误/RPC/系统诊断消息使用独立卡片，避免和普通 AI 正文混在一起难以扫读。 */
export const DiagnosticMessageCard = memo(function DiagnosticMessageCard(props: {
	message: ChatMessage;
}) {
	const tone = getDiagnosticTone(props.message);
	const title = props.message.role === "error"
		? t("diagnostic.errorTitle")
		: t("diagnostic.systemTitle");
	return (
		<article
			className={`diagnostic-card tone-${tone}`}
			data-message-id={props.message.id}
			data-role={props.message.role}
		>
			<div className="diagnostic-card-header">
				<AlertTriangle size={14} aria-hidden="true" />
				<span>{title}</span>
				<time>{formatTime(props.message.timestamp)}</time>
			</div>
			<pre className="diagnostic-card-body">{stripAnsi(
				props.message.meta && typeof props.message.meta === "object" && "i18nKey" in props.message.meta
					? t((props.message.meta as Record<string, string>).i18nKey as TranslationKey)
					: props.message.text
			)}</pre>
		</article>
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
	const inputRef = useRef<HTMLTextAreaElement>(null);

	// 编辑器输入 ref
	const editorRef = useRef<HTMLTextAreaElement>(null);

	// 当 prefill 变化时同步到 inputValue
	useEffect(() => {
		if (uiRequest?.prefill) setInputValue(String(uiRequest.prefill));
	}, [uiRequest?.prefill]);

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
		<article className="ask-question-card pending" data-message-id={props.message.id}>
			<div className="ask-question-card-header">
				<MessageCircle size={14} />
				<span className="ask-question-card-title">{title || t("ask.defaultTitle")}</span>
				<span className="ask-question-card-status">{cancelling ? t("ask.cancelling") : t("ask.waiting")}</span>
			</div>
			<div className="ask-question-card-body">
				{method === "select" && options && options.length > 0 && (
					<div className="ask-question-card-options">
						{/* 过滤掉 Pi 自带的 "✎ 自行输入..." 选项，用下方内联输入框替代 */}
						{options.filter((opt) => !opt.startsWith("✎")).map((opt, i) => (
							<button
								key={i}
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
						<textarea
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
						<button
							className="ask-question-card-cancel"
							onClick={handleCancel}
							disabled={cancelling}
							title={t("common.cancel")}
							aria-label={t("common.cancel")}
						>
							<X size={14} />
						</button>
					</div>
				)}
				{method === "editor" && (
					<div className="ask-question-card-editor-area">
						<textarea
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
							<button
								className="ask-question-card-cancel"
								onClick={handleCancel}
								disabled={cancelling}
								title={t("common.cancel")}
								aria-label={t("common.cancel")}
							>
								<X size={14} />
							</button>
						</div>
					</div>
				)}
			</div>
		</article>
	);
});

/** 思考过程折叠卡片：默认收起，展开后显示完整推理文本（超长时提供截断展开）。 */
export const ThinkingBlock = memo(function ThinkingBlock(props: {
	text: string;
	startedAt?: number;
	endedAt?: number;
	showThinking?: boolean;
}) {
	// 默认展开，方便用户看到推理过程；可手动折叠
	const [expanded, setExpanded] = useState(true);
	if (!props.showThinking || !props.text.trim()) return null;
	const previewLen = 220;
	const needsTruncate = props.text.length > previewLen;
	const previewText =
		expanded || !needsTruncate
			? props.text
			: `${props.text.slice(0, previewLen)}...`;
	// 计算思考耗时（毫秒），有 endAt 且有 startAt 时才显示
	const durationMs =
		props.endedAt && props.startedAt && props.endedAt >= props.startedAt
			? props.endedAt - props.startedAt
			: null;
	const durationText = durationMs != null ? formatDuration(durationMs) : null;
	return (
		<section className="thinking-card">
			<button
				className="thinking-card-trigger"
				onClick={() => setExpanded((v) => !v)}
				aria-expanded={expanded}
			>
				<Brain size={15} />
				<span>{t("thinking.title")}</span>
				<ChevronDown
					size={15}
					className={`thinking-card-chevron${expanded ? " open" : ""}`}
				/>
				{!expanded && props.text && (
					<span className="thinking-card-subtitle" title={props.text}>
						{props.text.slice(0, 80)}{props.text.length > 80 ? "..." : ""}
					</span>
				)}
				{durationText && <small>{durationText}</small>}
			</button>
			{expanded && <div className="thinking-card-content">{previewText}</div>}
		</section>
	);
});



/**
 * 流式响应指示器（三点脉动动画 + 状态文案），在 agent 运行/流式期间显示。
 *
 * 状态优先级：
 *  1. 工具执行中 → "正在工具调用"（琥珀色）
 *  2. 有思考文本 / 流式回答中 → "正在回应"
 *  3. 过渡等待 → 只显示三点动画，无标签
 *
 * 注意：原来的 "正在思考" 状态已合并到 "正在回应"，不再单独展示。
 */
export function RespondingIndicator(props: {
	thinking?: string;
	showThinking?: boolean;
	isExecutingTool?: boolean;
	isStreaming?: boolean;
}) {
	const { isExecutingTool, isStreaming, thinking, showThinking } = props;

	let kind: "executing" | "responding" | "waiting";
	let label: string;

	if (isExecutingTool) {
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
			{/* 标签始终渲染，waiting 态通过 CSS visibility:hidden 隐藏，保持容器宽度稳定 */}
			<span className="responding-indicator-label">{label}</span>
		</div>
	);
}

/** 宠物选择预览：给定宠物清单项，用 <canvas> 解码其 spritesheet 并循环播放
 *  对应 mode 行（默认 idle）的网格帧，让用户在选择宠物时即时看到动画效果，
 *  不必切换真实宠物窗。失败时降级为空占位，不阻塞设置面板。 */
function PetChooserPreview(props: {
	pet?: PetManifest;
	mode?: string;
}) {
	const canvasRef = useRef<HTMLCanvasElement | null>(null);
	const imgRef = useRef<HTMLImageElement | null>(null);
	const rafRef = useRef<number | null>(null);

	useEffect(() => {
		const pet = props.pet;
		const canvas = canvasRef.current;
		if (!pet || !pet.spritesheetUrl || !canvas) {
			const ctx = canvas!.getContext("2d");
			ctx?.clearRect(0, 0, canvas!.width, canvas!.height);
			return;
		}

		// 复用 petdex 标准网格规格（8 列 × 9 行，单格 192×208）
		const mode = props.mode && props.mode !== "__auto" ? props.mode : "idle";
		const row = MODE_ROW[mode] ?? 0;
		const frameCount = MODE_FRAMES[mode] ?? 6;
		const cols = GRID_COLS;
		const cellW = CELL_W;
		const cellH = CELL_H;

		// 解码 spritesheet；成功后用 rAF 按帧定时绘制单格，避免每帧重新解码。
		const img = new Image();
		img.src = pet.spritesheetUrl;
		let disposed = false;
		const start = () => {
			if (disposed) return;
			imgRef.current = img;
			let frame = 0;
			let last = performance.now();
			const FPS = 8;
			let acc = 0;
			const tick = (now: number) => {
				rafRef.current = requestAnimationFrame(tick);
				acc += now - last;
				last = now;
				if (acc < 1000 / FPS) return;
				acc = 0;
				if (frameCount <= 0) return;
				frame = (frame + 1) % frameCount;
				const ctx = canvas.getContext("2d");
				if (!ctx) return;
				ctx.clearRect(0, 0, canvas.width, canvas.height);
				// 仅绘制当前帧对应的单格，按 canvas 尺寸等比缩放，避免拉伸出框。
				ctx.drawImage(img, frame * cellW, row * cellH, cellW, cellH, 0, 0, canvas.width, canvas.height);
			};
			rafRef.current = requestAnimationFrame(tick);
		};
		img.decode().then(start).catch(() => undefined);

		return () => {
			disposed = true;
			if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
			rafRef.current = null;
			imgRef.current = null;
		};
	}, [props.pet, props.mode]);

	return (
		<div className="pet-chooser-preview">
			<canvas ref={canvasRef} width={CELL_W} height={CELL_H} aria-hidden="true" />
		</div>
	);
}

/** 助手正文：扁平 markdown 渲染，无气泡包裹，全宽排版，支持内嵌图片。
 *  路径链接化用 remark 插件在 mdast 层处理（见底部 remarkLinkifyPaths），不再前置改写原始字符串。 */
/** 表格容器：与 code-block-wrap 保持相同的宽度与圆角，内部 <table> 仍负责横向滚动。 */
function TableWrapper(props: React.ComponentProps<"table">) {
	return (
		<div className="table-wrap">
			<table {...props} />
		</div>
	);
}

/** 流式输出期间的轻量代码块：不加载 mermaid、不跑数学/语法高亮，只展示原始文本，
 *  避免未闭合的 ```mermaid 围栏触发 mermaid.initialize/render 挤占主线程。 */
function StreamingCodeBlock(props: React.HTMLAttributes<HTMLPreElement>) {
	const child = Array.isArray(props.children) ? props.children[0] : props.children;
	const codeProps = isValidElement(child)
		? (child.props as { className?: string; children?: ReactNode })
		: undefined;
	const text = extractText(codeProps?.children ?? props.children);
	const [copied, setCopied] = useState(false);
	const handleCopy = () => {
		navigator.clipboard.writeText(text);
		setCopied(true);
		showNotice(t("app.codeCopied"), 1200);
		setTimeout(() => setCopied(false), 1800);
	};
	return (
		<div className="code-block-wrap">
			<button className="code-copy" onClick={handleCopy} title={t("code.copy")}>
				{copied ? <Check size={14} /> : <Copy size={14} />}
			</button>
			<pre {...props}>{props.children}</pre>
		</div>
	);
}

export const AssistantText = memo(
	function AssistantText(props: {
		text: string;
		images?: ImageContent[];
		onPreviewImage: (image: ImageContent) => void;
		onOpenExternal: (url: string) => void;
		onOpenFile?: (path: string) => void;
		/** 当前消息是否正在流式追加。为 true 时走轻量渲染路径，跳过 KaTeX 数学解析与
		 *  mermaid 图渲染，避免每个 token 都对不断增长的全量正文调用重型插件导致主线程卡死。 */
		isStreaming?: boolean;
	}) {
		// 清理 ANSI 转义码与 <thinking> 标签，thinking 由调用方通过 ThinkingBlock 渲染
		const cleanText = stripThinkingTags(stripAnsi(props.text));
		// 流式期间用轻量管线（仅 GFM + 路径链接化），回答结束后切回含数学/图表的完整渲染。
		const streaming = Boolean(props.isStreaming);
		return (
			<div className="assistant-text markdown-body">
				{props.images && props.images.length > 0 && (
					<div className="message-images">
						{props.images.map((img, index) => (
							<img
								key={index}
								src={`data:${img.mimeType};base64,${img.data}`}
								alt={t("app.imageAlt", { index: index + 1 })}
								className="message-image"
								onClick={() => props.onPreviewImage(img)}
							/>
						))}
					</div>
				)}
				<ReactMarkdown
					remarkPlugins={
						streaming
							? [remarkGfm, remarkLinkifyPaths]
							: [remarkGfm, remarkMath, remarkLinkifyPaths]
					}
					rehypePlugins={streaming ? [] : [rehypeKatex]}
					urlTransform={markdownUrlTransform}
					components={{
						pre: streaming ? StreamingCodeBlock : CodeBlock,
						table: TableWrapper,
						span: MathSpan,
						a: (linkProps) => (
							<MarkdownLink
								{...linkProps}
								onOpenExternal={props.onOpenExternal}
								onOpenFile={props.onOpenFile}
							/>
						),
					}}
				>
					{cleanText}
				</ReactMarkdown>
			</div>
		);
	},
	// 自定义比较：文本、流式标记、图片一致时跳过重渲染。回调函数（onPreviewImage/onOpenExternal/
	// onOpenFile）行为稳定（读 ref 或 setState），不参与比较，避免 App 每次渲染新建内联箭头
	// 函数导致 memo 失效——历史消息在流式期间因此不再重复解析 Markdown，从根上消除卡顿。
	(prev, next) =>
		prev.text === next.text &&
		prev.isStreaming === next.isStreaming &&
		prev.images === next.images,
);

/** 一轮 AI 回答的扁平容器：左侧竖线聚合，内含思考/工具/正文/文件摘要。
 *  替代旧的 AgentRun + ChatBubble 助手分支 + RunActivity 三层结构。 */
export const TurnRow = memo(function TurnRow(props: {
	run: AgentRunItem;
	onPreviewImage: (image: ImageContent) => void;
	showThinking?: boolean;
	isStreaming?: boolean;
	onOpenExternal: (url: string) => void;
	onOpenFile?: (path: string) => void;
	onDiffFile?: DiffFileHandler;
	onResendUserMessage?: (message: ChatMessage) => void;
	onDeleteMessage?: (messageId: string) => void;
	onEditMessage?: (messageId: string, newText: string) => void;
	/** Agent 正在处理请求或流式输出中时禁用编辑/删除等操作按钮 */
	agentRunning?: boolean;
	/** 打开多选分享弹框 */
	onEnterMultiSelect?: () => void;
}) {
	const { run } = props;
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

	/** 找出 message 在 run.items 中的位置，分离「执行过程」（最后一条 assistant message 之前的所有条目）。
	 *  执行过程包含 thinking-group、tool-group 以及中间穿插的 assistant 消息，
	 *  默认折叠并以概要形式展示，用户可展开查看细节。最后一条 assistant 消息作为最终回答始终可见。 */
	const lastAssistantIndex = (() => {
		for (let i = run.items.length - 1; i >= 0; i--) {
			if (run.items[i].kind === "message" && (run.items[i] as MessageItem).message.role === "assistant") {
				return i;
			}
		}
		return -1;
	})();
	// 执行过程 = 除最终回答外的所有条目（最终回答在折叠区外始终可见，不能再进折叠详情）。
	// 边界：lastAssistantIndex === 0（如「思考+直接回答」的无工具回合）时，若取 run.items 全量，
	// 最终回答会被同时渲染进折叠详情和下方正文，展开后出现两份；filter 排除它本身，
	// 同时保留最终回答之后可能存在的尾部 tool/thinking 条目（slice 方案会将其丢弃）。
	const executionItems = lastAssistantIndex >= 0
		? (run.items as (ThinkingGroupItem | ToolGroupItem | MessageItem)[]).filter(
			(_, index) => index !== lastAssistantIndex,
		)
		: (run.items as (ThinkingGroupItem | ToolGroupItem | MessageItem)[]);
	const finalMessageItem = lastAssistantIndex >= 0 ? (run.items[lastAssistantIndex] as MessageItem) : null;

	const toolCount = executionItems.filter((i) => i.kind === "tool-group").length;
	const thinkingCount = executionItems.filter((i) => i.kind === "thinking-group").length;
	const interReplyCount = executionItems.filter(
		(i) => i.kind === "message" && i.message.role === "assistant",
	).length;

	// 最终回答文本，用于判断自然完成 vs 手动中断。
	// 提前定义以在 useEffect 中使用（auto-collapse 逻辑需要判断是否有最终文本回答）。
	const finalTxt = finalMessageItem
		? stripThinkingTags(stripAnsi(finalMessageItem.message.text)).trim()
		: "";

	// 执行过程默认展开（agent 处理中），输出完毕后自动折叠。
	// 使用 agentRunning 而非 isStreaming：后者在多步工具调用之间会短暂 flicker 为 false，
	// 导致过早折叠工具输出；agentRunning 在整个 agent 处理生命周期内始终为 true。
	const [executionExpanded, setExecutionExpanded] = useState(
		!isComplete || Boolean(props.agentRunning),
	);
	useEffect(() => {
		if (props.agentRunning) {
			setExecutionExpanded(true);
		} else if (isComplete) {
			setExecutionExpanded(false);
		}
	}, [isComplete, props.agentRunning]);

	const rowRef = useRef<HTMLElement | null>(null);
	// 本轮没有任何可渲染内容时不输出空容器
	const hasContent =
		assistantMessages.length > 0 ||
		run.items.some(item => item.kind === "thinking-group") ||
		run.items.some(item => item.kind === "tool-group") ||
		allImages.length > 0;
	if (!hasContent) return null;

	/** 渲染执行过程中的一个条目（thinking-group / tool-group / assistant message）。 */
	const renderExecutionItem = (item: ThinkingGroupItem | ToolGroupItem | MessageItem) => {
		if (item.kind === "thinking-group") {
			if (!props.showThinking) return null;
			return (
				<ThinkingBlock
					key={item.id}
					text={item.text}
					startedAt={item.startedAt}
					endedAt={item.endedAt}
					showThinking={props.showThinking}
				/>
			);
		}
		if (item.kind === "tool-group") {
			return <ToolGroupCard key={item.id} group={item} onDiffFile={props.onDiffFile} />;
		}
		if (item.kind === "message" && item.message.role === "assistant") {
			const txt = stripThinkingTags(stripAnsi(item.message.text)).trim();
			if (!txt) return null;
			return (
				<AssistantText
					key={item.message.id}
					text={txt}
					images={allImages}
					onPreviewImage={props.onPreviewImage}
					onOpenExternal={props.onOpenExternal}
					onOpenFile={props.onOpenFile}
					isStreaming={props.isStreaming ?? false}
				/>
			);
		}
		return null;
	};

	const finalThinking = finalMessageItem?.message.thinking?.trim()
		? stripAnsi(finalMessageItem.message.thinking)
		: null;
	const hasFinalThinking = Boolean(finalThinking && props.showThinking);

	// 将最终消息的思考插入执行过程（放在工具之前），确保时序正确：思考→工具→文本
	const executionItemsWithFinalThinking = useMemo(() => {
		const items = [...executionItems];
		if (hasFinalThinking && finalThinking && props.showThinking) {
			const thinkingItem: ThinkingGroupItem = {
				kind: "thinking-group",
				id: `final-thinking-${finalMessageItem?.message.id ?? run.id}`,
				messages: finalMessageItem?.message ? [finalMessageItem.message] : [],
				text: finalThinking,
				startedAt: run.startedAt,
				endedAt: finalMessageItem?.message.timestamp ?? run.endedAt,
			};
			// 插到 executionItems 的 lastAssistantIndex 位置，保持与原 run.items 一致的时序
			const insertIndex = Math.min(lastAssistantIndex, items.length);
			items.splice(insertIndex, 0, thinkingItem);
		}
		return items;
	}, [executionItems, hasFinalThinking, finalThinking, props.showThinking, finalMessageItem, run.id, run.startedAt, run.endedAt]);

	// 统计
	const totalThinkingCount = executionItemsWithFinalThinking.filter((i) => i.kind === "thinking-group").length;
	const totalToolCount = executionItemsWithFinalThinking.filter((i) => i.kind === "tool-group").length;
	const totalInterReplyCount = executionItemsWithFinalThinking.filter(
		(i) => i.kind === "message" && i.message.role === "assistant",
	).length;
	/** 将统计拼成概要文本。 */
	const summaryParts: string[] = [];
	if (totalToolCount > 0) summaryParts.push(`${totalToolCount}个工具`);
	if (totalThinkingCount > 0) summaryParts.push(`${totalThinkingCount}次思考`);
	if (totalInterReplyCount > 0) summaryParts.push(`${totalInterReplyCount}次回答`);
	const summaryText = summaryParts.length > 0 ? `执行过程: ${summaryParts.join(" ")}` : "";

	// 是否有任何需要折叠的内容
	const hasFoldableContent = executionItemsWithFinalThinking.length > 0 || run.items.some((i) => i.kind !== "message");

	// 没有助手指令消息的情况：整轮只含工具/思考，用执行过程折叠渲染
	if (lastAssistantIndex === -1) {
		return (
			<article ref={rowRef} className="turn-row" data-message-id={run.id}>
				<div className="turn-row-body">
					<div className="turn-row-meta">
						<span className="turn-row-agent">pi</span>
						<time>{formatTime(run.endedAt)}</time>
						{showDuration && (
							<span className="turn-row-duration">{formatDuration(duration)}</span>
						)}
					</div>
					{/* 执行过程概要（含工具/思考），默认折叠 */}
					{hasFoldableContent && summaryText && (
						<div className="execution-summary">
							<button
								type="button"
								className="execution-summary-toggle"
								onClick={() => setExecutionExpanded((prev) => !prev)}
								aria-expanded={executionExpanded}
								title={executionExpanded ? t("common.collapse") : t("common.expand")}
							>
								{executionExpanded ? (
									<ChevronDown size={14} aria-hidden="true" />
								) : (
									<ChevronRight size={14} aria-hidden="true" />
								)}
								<span>{summaryText}</span>
							</button>
							{executionExpanded && (
								<div className="execution-summary-details">
									{executionItemsWithFinalThinking.map(renderExecutionItem)}
									<button
										type="button"
										className="execution-summary-collapse"
										onClick={() => setExecutionExpanded(false)}
										title={t("common.collapse")}
									>
										<ChevronUp size={12} aria-hidden="true" />
										<span>{t("common.collapse")}</span>
									</button>
								</div>
							)}
						</div>
					)}
				</div>
			</article>
		);
	}

	return (
		<article ref={rowRef} className="turn-row" data-message-id={run.id}>
			<div className="turn-row-body">
				<div className="turn-row-meta">
					<span className="turn-row-agent">pi</span>
					<time>{formatTime(run.endedAt)}</time>
					{showDuration && (
						<span className="turn-row-duration">{formatDuration(duration)}</span>
					)}
				</div>
				{/* 执行过程概要（含工具/思考/中间回答），置于最终回答之前以保持调用顺序。 */}
				{hasFoldableContent && summaryText && (
					<div className="execution-summary">
						<button
							type="button"
							className="execution-summary-toggle"
							onClick={() => setExecutionExpanded((prev) => !prev)}
							aria-expanded={executionExpanded}
							title={executionExpanded ? t("common.collapse") : t("common.expand")}
						>
							{executionExpanded ? (
								<ChevronDown size={14} aria-hidden="true" />
							) : (
								<ChevronRight size={14} aria-hidden="true" />
							)}
							<span>{summaryText}</span>
						</button>
						{executionExpanded && (
							<div className="execution-summary-details">
								{executionItemsWithFinalThinking.map(renderExecutionItem)}
								<button
									type="button"
									className="execution-summary-collapse"
									onClick={() => setExecutionExpanded(false)}
									title={t("common.collapse")}
								>
									<ChevronUp size={12} aria-hidden="true" />
									<span>{t("common.collapse")}</span>
								</button>
							</div>
						)}
					</div>
				)}
				{/* 最终回答（始终可见）；最终思考已融入执行过程折叠区 */}
				{finalMessageItem && (
					<Fragment key={finalMessageItem.message.id}>
						{editing ? (
							<div className="turn-row-edit-area" ref={editAreaRef}>
								<div className="edit-area-indicator">{t("common.edit")}</div>
								<textarea
									className="turn-row-edit-textarea"
									value={editText}
									onChange={(e) => setEditText(e.target.value)}
									onKeyDown={(e) => {
										if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
											e.preventDefault();
											const targetId = assistantMessages.at(-1)?.message.id;
											if (targetId && props.onEditMessage) {
												props.onEditMessage(targetId, editText);
												setEditing(false);
											}
										}
										if (e.key === "Escape") setEditing(false);
									}}
									autoFocus
								/>
								<div className="turn-row-edit-actions">
									<button className="turn-row-edit-btn primary" onClick={() => {
										const targetId = assistantMessages.at(-1)?.message.id;
										if (targetId && props.onEditMessage) {
											props.onEditMessage(targetId, editText);
											setEditing(false);
										}
									}}>{t("common.save")}</button>
									<button className="turn-row-edit-btn" onClick={() => setEditing(false)}>{t("common.cancel")}</button>
								</div>
							</div>
						) : finalTxt ? (
							<AssistantText
								text={finalTxt}
								images={allImages}
								onPreviewImage={props.onPreviewImage}
								onOpenExternal={props.onOpenExternal}
								onOpenFile={props.onOpenFile}
								isStreaming={props.isStreaming ?? false}
							/>
						) : null}
					</Fragment>
				)}
				{/* 操作栏 */}
				{mergedText && !editing && (
					<div className="turn-row-actions">
						<CopyMenu text={stripMarkdown(mergedText)} markdown={mergedText} targetRef={rowRef} />
						<button
							className="turn-row-action-btn"
							onClick={props.onEnterMultiSelect}
						title={t("app.multiSelectEnter")}
						>
							<Share size={14} />
						</button>
						{!props.isStreaming && !props.agentRunning && assistantMessages.at(-1)?.message.id && (
							<>
								{props.onEditMessage && (
									<button
										className="turn-row-action-btn"
										onClick={() => {
											setEditText(mergedText);
											setEditing(true);
										}}
										title={t("common.edit")}
									>
										<SquarePen size={14} />
									</button>
								)}
								{props.onDeleteMessage && (
									<button
										className="turn-row-action-btn"
										onClick={() => {
											const targetId = assistantMessages.at(-1)?.message.id;
											if (targetId) props.onDeleteMessage?.(targetId);
										}}
										title={t("common.delete")}
									>
										<Trash size={14} />
									</button>
								)}
							</>
						)}
					</div>
				)}
			</div>
		</article>
	);
});

/**
 * 从用户消息文本中提取 pi 展开后的 <skill name="..." location="...">...</skill> 块。
 * pi 在发送 /skill:name 时会把 skill 内容展开成该 XML 块注入用户消息，
 * 这里在展示层把它们识别出来，渲染成 skill 徽标，并把原始 XML 从正文里剥除。
 * 返回 { skills, text }：skills 为 skill 名列表，text 为移除 skill 块后的正文。
 */
function extractSkillBlocks(text: string): { skills: string[]; text: string } {
	const skills: string[] = [];
	// 非贪婪匹配 skill 块；name/location 属性顺序与引号样式兼容 pi 实际输出
	const re = /<skill\s+name="([^"]+)"[^>]*>[\s\S]*?<\/skill>/gi;
	const cleaned = text.replace(re, (_m, name: string) => {
		if (name) skills.push(name);
		return "";
	});
	return { skills, text: cleaned.trim() };
}

/** 用户消息：右对齐气泡 + 附件 + hover 显隐操作栏（复制/编辑/删除/重发/修改输入框）。
 * 编辑分两种：原地编辑（修改 JSONL + 重载会话）和修改输入框（放回 composer 不自动发送）。 */
export const UserBubble = memo(function UserBubble(props: {
	message: ChatMessage;
	onPreviewImage: (image: ImageContent) => void;
	onOpenFile?: (path: string) => void;
	onResendUserMessage?: (message: ChatMessage) => void;
	onEditMessage?: (messageId: string, newText: string) => void;
	onDeleteMessage?: (messageId: string) => void;
	/** 是否为最后一条用户消息，用于控制重发按钮的显隐 */
	isLastUserMessage?: boolean;
	/** 仅当该消息后出现 error/abort 时显示重发（取代无条件 isLastUserMessage） */
	showResendButton?: boolean;
	validCommandNames?: Set<string>;
	validFilePaths?: Set<string>;
	/** Agent 正在处理请求或流式输出中时禁用编辑/删除等操作按钮 */
	agentRunning?: boolean;
	/** 打开多选分享弹框 */
	onEnterMultiSelect?: () => void;
}) {
	const { message } = props;
	const rowRef = useRef<HTMLElement | null>(null);
	const [editing, setEditing] = useState(false);
	const [editText, setEditText] = useState("");
	const editAreaRef = useRef<HTMLDivElement | null>(null);
	// 激活编辑时自动滚动到编辑区
	useEffect(() => {
		if (editing && editAreaRef.current) {
			editAreaRef.current.scrollIntoView({ behavior: "smooth", block: "nearest" });
		}
	}, [editing]);
	// 提取 pi 展开后的 <skill> 块：渲染为 skill 徽标，并从正文里剥除 XML
	const { skills, text: bodyText } = extractSkillBlocks(stripAnsi(message.text));
	const cleanText = bodyText;
	// 投递策略标签：steer(下次调用前插入) / followUp(停止后排队)
	const deliveryBehavior = message.meta?.streamingBehavior as
		| "steer"
		| "followUp"
		| undefined;
	const deliveryLabel =
		deliveryBehavior === "steer"
			? t("app.messageDeliverySteer")
			: deliveryBehavior === "followUp"
				? t("app.messageDeliveryFollowUp")
				: null;
	/** 原地编辑不影响输入框；先提交给确认弹窗。 */
	const handleSaveEdit = () => {
		if (props.onEditMessage && editText.trim()) {
			props.onEditMessage(message.id, editText);
			setEditing(false);
		}
	};
	/** 编辑后重发：放回 composer 输入框，由用户自行修改后发送。 */
	const handleEditAndResend = () => {
		document.querySelector<HTMLTextAreaElement>(".composer-box textarea")?.focus();
		window.dispatchEvent(
			new CustomEvent("user-message-edit", { detail: { text: message.text } }),
		);
	};
	return (
		<article ref={rowRef} className="user-turn" data-message-id={message.id}>
			{skills.length > 0 && (
				<div className="user-turn-skills">
					{skills.map((name) => (
						<span key={name} className="user-turn-skill-badge" title={`/${name}`}>
							<span className="user-turn-skill-icon">/</span>
							{name}
						</span>
					))}
				</div>
			)}
			{message.images && message.images.length > 0 && (
				<div className="user-turn-attachments">
					{message.images.map((img, index) => (
						<img
							key={index}
							src={`data:${img.mimeType};base64,${img.data}`}
							alt={t("app.imageAlt", { index: index + 1 })}
							className="user-turn-attachment"
							onClick={() => props.onPreviewImage(img)}
						/>
					))}
				</div>
			)}
			{cleanText && !editing && (
				<div className="user-turn-bubble">
					<div className="user-turn-text">
						{renderChipText(cleanText, props.onOpenFile, props.validCommandNames, props.validFilePaths)}
					</div>
				</div>
			)}
			{editing && (
				<div className="user-turn-edit-area" ref={editAreaRef}>
					<div className="edit-area-indicator">{t("common.edit")}</div>
					<textarea
						className="message-edit-textarea"
						value={editText}
						onChange={(e) => setEditText(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
								e.preventDefault();
								handleSaveEdit();
							}
							if (e.key === "Escape") setEditing(false);
						}}
						autoFocus
					/>
					<div className="message-edit-actions">
						<button className="message-edit-btn primary" onClick={handleSaveEdit}>
							{t("common.save")}
						</button>
						<button className="message-edit-btn" onClick={() => setEditing(false)}>
							{t("common.cancel")}
						</button>
					</div>
				</div>
			)}
			<div className="user-turn-meta">
				{deliveryLabel && (
					<span
						className={`user-turn-delivery${
							deliveryBehavior === "followUp" ? " follow-up" : " steer"
						}`}
						title={
							deliveryBehavior === "followUp"
								? t("app.messageDeliveryFollowUpTitle")
								: t("app.messageDeliverySteerTitle")
						}
					>
						{deliveryLabel}
					</span>
				)}
				<time>{formatTime(message.timestamp)}</time>
			</div>
			<div className="user-turn-actions">
				<CopyMenu text={stripMarkdown(cleanText)} markdown={message.text} targetRef={rowRef} />
				<button
					className="user-turn-action-btn"
					onClick={props.onEnterMultiSelect}
					title={t("app.multiSelectEnter")}
						>
							<Share size={14} />
						</button>
				{!editing && !props.agentRunning && (
					<>
						{props.onEditMessage && (
							<button className="user-turn-action-btn" onClick={() => {
								setEditText(cleanText);
								setEditing(true);
							}} title={t("common.edit")}>
								<SquarePen size={14} />
							</button>
						)}
						<button
							className="user-turn-action-btn"
							onClick={handleEditAndResend}
							title={t("app.editAndResendTitle")}
						>
							<UserPen size={14} />
						</button>
						{props.onDeleteMessage && (
							<button
								className="user-turn-action-btn"
								onClick={() => props.onDeleteMessage?.(message.id)}
								title={t("common.delete")}
							>
								<Trash size={14} />
							</button>
						)}
						{((props.isLastUserMessage || props.showResendButton) && props.onResendUserMessage) && (
							<button
								className="user-turn-action-btn"
								onClick={() => props.onResendUserMessage?.(message)}
								title={t("app.resendTitle")}
							>
								<Send size={14} />
							</button>
						)}
					</>
				)}
			</div>
		</article>
	);
});

/**
 * remark 插件：把助手正文里的裸文件路径转换成可点击的 file:// 链接。
 *
 * 以前用对原始 markdown 字符串做正则替换的 linkifyFilePaths，缺点是会把
 * ```代码块``` 里的路径字符串也改写掉（例如 AI 给出的 path: "D:\..." 示例
 * 被替换成 [D:\...](file://...) 破坏代码块），且 file:// 经 encodeURIComponent
 * 后反斜杠全被编码，链接既不可用又渲染异常。
 *
 * 改为在 mdast 层遍历，只处理 type === "text" 的叶子节点，天然跳过
 * code / inlineCode / link 内的文本，从根上消除双重处理与代码块破坏。
 * URL 用 file:// + encodeURIComponent 编码路径，MarkdownLink 里解码还原。
 */
const FILE_PATH_RE =
	/(?:[A-Z]:[\\/][^\s<>"'`|?*\n\[\]()]+|(?:\.\.?\/|\/)[^\s<>"'`|?*\n\[\]()]+|(?:[a-zA-Z_][a-zA-Z0-9_-]*[\\/])+[^\s<>"'`|?*\n\[\]()]+)\.[a-zA-Z0-9]+/g;

const remarkLinkifyPaths = () => {
	return (tree: any) => {
		// 遍历 mdast，仅替换 text 叶子节点；code/inlineCode/link 等节点不被处理。
		// 文本节点无 children，所以先用 __segs 标记待拆分节点，由父节点遍历时展开。
		const visit = (node: any) => {
			if (!node || typeof node !== "object") return;
			const type: string = node.type;
			if (type === "code" || type === "inlineCode" || type === "link") return;
			if (type === "text" && typeof node.value === "string") {
				const text: string = node.value;
				FILE_PATH_RE.lastIndex = 0;
				const segs: any[] = [];
				let last = 0;
				let m: RegExpExecArray | null;
				let touched = false;
				while ((m = FILE_PATH_RE.exec(text)) !== null) {
					const start = m.index;
					const end = start + m[0].length;
					if (start > last) segs.push({ type: "text", value: text.slice(last, start) });
					segs.push({
						type: "link",
						url: `file://${encodeURIComponent(m[0])}`,
						children: [{ type: "text", value: m[0] }],
					});
					last = end;
					touched = true;
				}
				if (touched) {
					if (last < text.length) segs.push({ type: "text", value: text.slice(last) });
					node.__segs = segs;
				}
				return;
			}
			const children: any[] | undefined = node.children;
			if (Array.isArray(children)) {
				const next: any[] = [];
				for (const child of children) {
					visit(child);
					if (child && (child as any).__segs) {
						const segs = (child as any).__segs;
						delete (child as any).__segs;
						next.push(...segs);
					} else {
						next.push(child);
					}
				}
				node.children = next;
			}
		};
		visit(tree);
	};
};

function getToolStatus(message: ChatMessage): "running" | "done" | "error" {
	const status = String(message.meta?.status ?? "done");
	if (status === "running" || status === "error") return status;
	return "done";
}

function getToolName(message: ChatMessage) {
	const name = message.meta?.toolName;
	if (typeof name === "string" && name.trim()) return name.trim();
	const text = stripAnsi(message.text).replace(/^[▶✓✗]\s*/u, "").trim();
	return text || "tool";
}

function getToolDetailText(message: ChatMessage) {
	if (typeof message.meta?.detailText === "string") {
		return stripAnsi(message.meta.detailText);
	}
	return stripAnsi(JSON.stringify(message.meta ?? {}, null, 2));
}

function getToolExitCode(message: ChatMessage) {
	const result = message.meta?.result;
	if (!result || typeof result !== "object") return undefined;
	const value = (result as { exitCode?: unknown }).exitCode;
	if (typeof value === "number") return value;
	if (typeof value === "string" && value.trim()) {
		const parsed = Number(value);
		return Number.isFinite(parsed) ? parsed : undefined;
	}
	return undefined;
}

export function ImagePreviewModal(props: {
	image: ImageContent;
	onClose: () => void;
}) {
	return (
		<div className="image-preview-modal" onClick={props.onClose}>
			<button
				className="image-preview-close"
				onClick={props.onClose}
				aria-label={t("app.imagePreviewClose")}
			>
				<X size={20} strokeWidth={2.4} />
			</button>
			<img
				src={`data:${props.image.mimeType};base64,${props.image.data}`}
				alt={t("app.imagePreviewAlt")}
				onClick={(event) => event.stopPropagation()}
			/>
		</div>
	);
}

// ANSI 转义码正则:匹配 \x1b[...m 等终端颜色/样式序列
const ANSI_RE = /\x1b\[[0-9;]*[a-zA-Z]/g;

/** 去除 pi 输出中的 ANSI 终端转义码,避免在 React UI 中显示原始 \e[38;5;109m 等文本 */
function stripAnsi(text: string): string {
	return text.replace(ANSI_RE, "");
}

/** 去除文本中的 <thinking> 标签 */
function stripThinkingTags(text: string): string {
	return text.replace(/<thinking>[\s\S]*?<\/thinking>/gi, "").trim();
}

/** 将 Markdown 语法转换为纯文本，保留可读的文字内容 */
export function stripMarkdown(text: string): string {
	return removeMarkdown(text, {
		// 保留列表项文本，移除列表标记符号
		stripListLeaders: true,
		// 使用 Unicode 字符替换列表标记
		listUnicodeChar: "",
		// 启用 GFM 表格/任务列表等处理
		gfm: true,
		// 图片保留 alt 文本
		useImgAltText: true,
	});
}

/** 将消息文本中的 @path / /command 渲染为行内 chip（聊天区展示用，与输入框 chip 视觉一致）。
 * 可通过 onOpenFile 回调使 chip 可点击跳转。 */
function renderChipText(text: string, onOpenFile?: (path: string) => void, validCommandNames?: Set<string>, validFilePaths?: Set<string>): ReactNode[] {
	const chips = parseRichInputChips(text, validCommandNames, validFilePaths);
	if (chips.length === 0) return [text];
	const nodes: ReactNode[] = [];
	let cursor = 0;
	for (const chip of chips) {
		if (chip.start > cursor) {
			nodes.push(text.slice(cursor, chip.start));
		}
		const clickable = onOpenFile && chip.kind === "file";
		nodes.push(
			<span
				key={`chip-${chip.start}`}
				className={`input-chip input-chip--${chip.kind}${clickable ? " clickable" : ""}`}
				data-type={chip.kind}
				data-raw={chip.raw}
				title={chip.raw}
				onClick={clickable ? () => onOpenFile(chip.raw.slice(1)) : undefined}
			>
				<span className="input-chip__icon">
					{chip.kind === "file" ? "@" : "/"}
				</span>
				<span className="input-chip__label">{chip.label}</span>
			</span>,
		);
		cursor = chip.end;
	}
	if (cursor < text.length) {
		nodes.push(text.slice(cursor));
	}
	return nodes;
}

function MathSpan(props: React.HTMLAttributes<HTMLSpanElement>) {
	const { className, children, ...spanProps } = props;
	const ref = useRef<HTMLSpanElement | null>(null);
	const isDisplayMath = /\bkatex-display\b/.test(className ?? "");
	// 只对 KaTeX 最外层 span 添加复制按钮，内部嵌套的 katex-mathml / katex-html 等直接透传。
	// 行内公式外层 class 精确为 "katex"，块级外层为 "katex-display"（可能同时含 "katex"）。
	const isOuterKatex = isDisplayMath || className === "katex";
	if (!isOuterKatex) return <span className={className} {...spanProps}>{children}</span>;
	const [copied, setCopied] = useState(false);
	const copyMath = () => {
		const annotation = ref.current?.querySelector('annotation[encoding="application/x-tex"]');
		const source = annotation?.textContent || extractText(children);
		// 行内公式用 $...$ 包裹，块级公式用 $$...$$ 包裹
		const texContent = isDisplayMath ? `$$\n${source}\n$$` : `$${source}$`;
		void navigator.clipboard.writeText(texContent);
		setCopied(true);
		showNotice(t("app.latexCopied"), 1200);
		setTimeout(() => setCopied(false), 1800);
	};
	return (
		<span className={`math-copy-wrap${isDisplayMath ? "" : " math-copy-wrap--inline"}`}>
			<span ref={ref} className={className} {...spanProps}>{children}</span>
			<button className={`math-copy-btn${isDisplayMath ? "" : " math-copy-btn--inline"}`} type="button" onClick={copyMath} title={t("common.copy")}>
				{copied ? <Check size={isDisplayMath ? 12 : 10} /> : <Copy size={isDisplayMath ? 12 : 10} />}
			</button>
		</span>
	);
}

function CodeBlock(props: React.HTMLAttributes<HTMLPreElement>) {
	const child = Array.isArray(props.children) ? props.children[0] : props.children;
	const codeProps = isValidElement(child)
		? (child.props as { className?: string; children?: ReactNode })
		: undefined;
	const languageClass = codeProps?.className ?? "";
	const text = extractText(codeProps?.children ?? props.children);
	if (/\blanguage-mermaid\b/i.test(languageClass)) {
		return <MermaidDiagram chart={text} />;
	}
	const [copied, setCopied] = useState(false);
	const handleCopy = () => {
		navigator.clipboard.writeText(text);
		setCopied(true);
		showNotice(t("app.codeCopied"), 1200);
		setTimeout(() => setCopied(false), 1800);
	};
	return (
		<div className="code-block-wrap">
			<button
				className="code-copy"
				onClick={handleCopy}
				title={t("code.copy")}
			>
				{copied ? <Check size={14} /> : <Copy size={14} />}
			</button>
			<pre {...props}>{props.children}</pre>
		</div>
	);
}

function normalizeMermaidChart(chart: string) {
	// Mermaid flowchart 的方括号节点 label 未加引号时，`foo(bar)` 里的括号会被解析成形状语法。
	// 模型常输出 `A[api.call(arg)]` 这种写法，这里仅把含括号的普通方括号 label 自动转成 quoted label。
	return chart.replace(
		/(\b[A-Za-z][\w-]*\s*)\[([^\]\n"]*[()][^\]\n"]*)\]/g,
		(_match, prefix: string, label: string) =>
			`${prefix}["${label.replace(/"/g, "\\\"")}"]`,
	);
}

function MermaidDiagram(props: { chart: string }) {
	const reactId = useId();
	const containerRef = useRef<HTMLDivElement | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [zoom, setZoom] = useState(1);

	useEffect(() => {
		let disposed = false;
		const chart = normalizeMermaidChart(props.chart);
		const renderId = `pi-mermaid-${reactId.replace(/[^a-zA-Z0-9_-]/g, "")}`;
		// Mermaid 图由模型输出生成，使用 strict 安全级别并禁用 startOnLoad，
		// 避免库扫描整个页面或执行不受控的链接/脚本行为。此处动态加载 mermaid，
		// 保证不按需出现的图表场景不占用渲染进程常驻内存。
		loadMermaid()
			.then((mod) => {
				const mermaid = mod.default;
				mermaid.initialize({
					startOnLoad: false,
					securityLevel: "strict",
					theme: document.documentElement.dataset.theme === "dark" ? "dark" : "default",
				});
				return mermaid.render(renderId, chart);
			})
			.then(({ svg }) => {
				if (disposed || !containerRef.current) return;
				containerRef.current.innerHTML = svg;
				setError(null);
			})
			.catch((err: unknown) => {
				if (disposed) return;
				setError(err instanceof Error ? err.message : String(err));
			});
		return () => {
			disposed = true;
		};
	}, [props.chart, reactId]);

	return (
		<div className="mermaid-block">
			{error ? (
				<MermaidMarkdownFallback chart={props.chart} error={error} />
			) : (
				<>
					<div className="mermaid-toolbar" aria-label="Mermaid diagram controls">
						<button type="button" onClick={() => { navigator.clipboard.writeText(`\`\`\`mermaid\n${props.chart}\n\`\`\``); showNotice(t("app.mermaidCopied"), 1200); }} title={t("common.copy")}><Copy size={14} /></button>
						<button type="button" onClick={() => setZoom((value) => Math.max(0.5, value - 0.1))}>−</button>
						<span>{Math.round(zoom * 100)}%</span>
						<button type="button" onClick={() => setZoom((value) => Math.min(2.5, value + 0.1))}>＋</button>
						<button type="button" onClick={() => setZoom(1)}>100%</button>
					</div>
					<div className="mermaid-viewport">
						<div
							ref={containerRef}
							className="mermaid-diagram"
							style={{ transform: `scale(${zoom})`, "--mermaid-zoom": zoom } as CSSProperties}
						/>
					</div>
				</>
			)}
		</div>
	);
}

function MermaidMarkdownFallback(props: { chart: string; error: string }) {
	const markdown = `\`\`\`mermaid\n${props.chart}\n\`\`\``;
	return (
		<div className="code-block-wrap mermaid-fallback">
			<button
				className="code-copy"
				onClick={() => { navigator.clipboard.writeText(markdown); showNotice(t("app.codeCopied"), 1200); }}
				title={t("code.copy")}
			>
				<Copy size={14} />
			</button>
			<pre>{markdown}</pre>
			<small className="mermaid-error-message">Mermaid render failed: {props.error}</small>
		</div>
	);
}

/** Markdown 内的链接默认会在 Electron 窗口内导航,这里拦截点击统一用系统浏览器打开。
 * 支持文件路径链接（file:// 协议）点击打开文件。
 */
function markdownUrlTransform(url: string): string {
	// react-markdown 默认会清空 file:// 协议；这里只放行本地文件链接，普通外链仍使用默认安全过滤。
	return url.startsWith("file://") ? url : defaultUrlTransform(url);
}

function MarkdownLink(
	props: React.AnchorHTMLAttributes<HTMLAnchorElement> & {
		onOpenExternal: (url: string) => void;
		onOpenFile?: (path: string) => void;
	},
) {
	const { onOpenExternal, onOpenFile, children, className, title, ...anchorProps } = props;
	// remarkLinkifyPaths 生成的文件路径链接走 file:// 协议，与普通外链区分展示
	const isFileLink = props.href?.startsWith("file://") ?? false;
	const handleClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
		e.preventDefault();
		if (!props.href) return;
		
		// 处理文件路径链接（file:// 协议）
		if (props.href.startsWith('file://')) {
			const filePath = decodeURIComponent(props.href.slice(7));
			if (onOpenFile) {
				void onOpenFile(filePath);
			}
		} else {
			// 普通 URL 链接用系统浏览器打开
			void onOpenExternal(props.href);
		}
	};
	const linkClass =
		[className, isFileLink ? "markdown-link-file" : undefined]
			.filter(Boolean)
			.join(" ") || undefined;
	return (
		<a
			{...anchorProps}
			className={linkClass}
			onClick={handleClick}
			// 文件链接 hover 展示解码后的完整路径，便于确认目标文件；
			// 普通链接不传 title，保留 markdown 自带 title 语法的原行为
			title={isFileLink ? decodeURIComponent(props.href!.slice(7)) : title}
		>
			{isFileLink ? (
				<>
					<FileText size={12} className="markdown-link-file-icon" />
					<span>{children}</span>
				</>
			) : (
				children
			)}
		</a>
	);
}

function extractText(node: ReactNode): string {
	if (typeof node === "string" || typeof node === "number") return String(node);
	if (Array.isArray(node)) return node.map(extractText).join("");
	if (isValidElement<{ children?: ReactNode }>(node))
		return extractText(node.props.children);
	return "";
}

/** 将毫秒数格式化为短可读形式,如 "3.2s" "1m23s" */
function formatDuration(ms: number): string {
	if (ms < 1000) return `${ms}ms`;
	const seconds = Math.floor(ms / 1000);
	if (seconds < 60) return `${seconds}.${Math.floor((ms % 1000) / 100)}s`;
	const minutes = Math.floor(seconds / 60);
	const remaining = seconds % 60;
	return remaining > 0 ? `${minutes}m${remaining}s` : `${minutes}m`;
}

function formatTime(timestamp: number) {
	return new Date(timestamp).toLocaleString(undefined, {
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
	});
}

/** 收集所有可勾选的消息 ID（user + assistant） */
function getSelectableMessageIds(
	items: RenderMessage[],
): string[] {
	const ids: string[] = [];
	for (const item of items) {
		if (item.kind === "message" &&
			(item.message.role === "user" || item.message.role === "assistant")) {
			ids.push(item.message.id);
		} else if (item.kind === "agent-run") {
			for (const sub of item.items) {
				if (sub.kind === "message" && sub.message.role === "assistant") {
					ids.push(sub.message.id);
				}
			}
		}
	}
	return ids;
}

/**
 * 多选分享弹框：以会话树形式展示消息，用户勾选后复制分享。
 * 支持按 agent-run 层级全选或逐条选择。
 */
export function MultiSelectModal(props: {
	renderedRuns: RenderMessage[];
	onClose: () => void;
	onCopy: (
		selectedIds: Set<string>,
		kind: "text" | "markdown" | "image",
	) => void;
}) {
	const [selectedIds, setSelectedIds] = useState<Set<string>>(
		() => new Set(getSelectableMessageIds(props.renderedRuns)),
	);
	const [copying, setCopying] = useState<
		"text" | "markdown" | "image" | null
	>(null);

	const allSelectableIds = useMemo(
		() => getSelectableMessageIds(props.renderedRuns),
		[props.renderedRuns],
	);

	const toggleMessage = useCallback((id: string) => {
		setSelectedIds((prev) => {
			const next = new Set(prev);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	}, []);

	const isRunFullySelected = useCallback(
		(run: AgentRunItem) => {
			const ids = run.items
				.filter(
					(i): i is MessageItem =>
						i.kind === "message" && i.message.role === "assistant",
				)
				.map((i) => i.message.id);
			return ids.length > 0 && ids.every((id) => selectedIds.has(id));
		},
		[selectedIds],
	);

	const toggleRun = useCallback(
		(run: AgentRunItem) => {
			const ids = run.items
				.filter(
					(i): i is MessageItem =>
						i.kind === "message" && i.message.role === "assistant",
				)
				.map((i) => i.message.id);
			if (ids.length === 0) return;
			const allSelected = ids.every((id) => selectedIds.has(id));
			setSelectedIds((prev) => {
				const next = new Set(prev);
				for (const id of ids) {
					if (allSelected) next.delete(id);
					else next.add(id);
				}
				return next;
			});
		},
		[selectedIds],
	);

	const selectAll = useCallback(() => {
		setSelectedIds(new Set(allSelectableIds));
	}, [allSelectableIds]);

	const deselectAll = useCallback(() => {
		setSelectedIds(new Set());
	}, []);

	/** 点击分享按钮：先显示脉冲动画，再执行复制关闭弹框 */
	const handleCopy = useCallback(
		async (kind: "text" | "markdown" | "image") => {
			setCopying(kind);
			// 让按钮脉冲动画渲染一帧后再执行复制
			await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 120)));
			setCopying(null);
			props.onCopy(selectedIds, kind);
		},
		[selectedIds, props.onCopy],
	);

	const selectedCount = selectedIds.size;
	const totalCount = allSelectableIds.length;

	return (
		<div
			className="multi-select-modal-overlay"
			onClick={props.onClose}
		>
			<div
				className="multi-select-modal"
				onClick={(e) => e.stopPropagation()}
			>
				{/* 标题栏 */}
				<header className="multi-select-modal-header">
					<h3>{t("app.multiSelectEnter")}</h3>
					<button
						className="multi-select-modal-close"
						onClick={props.onClose}
						aria-label={t("common.close")}
					>
						<X size={18} strokeWidth={2} />
					</button>
				</header>

				{/* 树状列表 */}
				<div className="multi-select-modal-tree">
					{props.renderedRuns.map((item) => {
						if (item.kind === "message") {
							const msg = item.message;
							if (msg.role === "user" || msg.role === "assistant") {
								const isChecked = selectedIds.has(msg.id);
								return (
									<label
										key={msg.id}
										className={`multi-select-tree-node${isChecked ? " selected" : ""}`}
									>
										<input
											type="checkbox"
											checked={isChecked}
											onChange={() => toggleMessage(msg.id)}
										/>
										<MessageCircle
											size={14}
											className="multi-select-node-icon user"
										/>
										<span className="multi-select-node-label">
											<span className="multi-select-node-summary">
												{summarizeMessage(stripAnsi(msg.text))}
											</span>
										</span>
									</label>
								);
							}
							return null;
						}

						if (item.kind === "agent-run") {
							const runChecked = isRunFullySelected(item);
							const runHasSome = item.items.some(
								(i) =>
									i.kind === "message" &&
									i.message.role === "assistant" &&
									selectedIds.has(i.message.id),
							);
							const runAnyChecked = runChecked || runHasSome;
							const assistantMsgs = item.items.filter(
								(i): i is MessageItem =>
									i.kind === "message" && i.message.role === "assistant",
							);
							if (assistantMsgs.length === 0) return null;

							return (
								<div key={item.id} className="multi-select-tree-run">
									<div
										className={`multi-select-tree-node run-parent${runAnyChecked ? " selected" : ""}`}
										onClick={() => toggleRun(item)}
									>
										<Brain size={15} className="multi-select-node-icon assistant" />
										<span className="multi-select-node-label">
											<span className="multi-select-node-run-label">pi</span>
											<span className="multi-select-node-time">
												{formatTime(item.endedAt)}
											</span>
										</span>
										<span className="multi-select-node-assistant-count">
											{assistantMsgs.length}
										</span>
									</div>
									<div className="multi-select-run-children">
										{assistantMsgs.map((sub) => {
											const subChecked = selectedIds.has(sub.message.id);
											return (
												<label
													key={sub.message.id}
													className={`multi-select-tree-node run-child${subChecked ? " selected" : ""}`}
												>
													<input
														type="checkbox"
														checked={subChecked}
														onChange={() =>
															toggleMessage(sub.message.id)
														}
													/>
													<FileText
														size={14}
														className="multi-select-node-icon child"
													/>
													<span className="multi-select-node-label">
														<span className="multi-select-node-summary">
															{summarizeMessage(
																stripAnsi(sub.message.text),
															)}
														</span>
													</span>
												</label>
											);
										})}
									</div>
								</div>
							);
						}

						return null;
					})}
				</div>

				{/* 底部操作栏 */}
				<footer className="multi-select-modal-footer">
					<div className="multi-select-modal-footer-top">
						<span className="multi-select-count">
							{t("app.multiSelectCount", { count: selectedCount })}
						</span>
						<div className="multi-select-bulk-actions">
							<button
								className="multi-select-bulk-btn"
								onClick={selectAll}
								disabled={!totalCount}
							>
								{t("common.selectAll")}
							</button>
							<button
								className="multi-select-bulk-btn"
								onClick={deselectAll}
								disabled={!selectedCount}
							>
								{t("common.deselectAll")}
							</button>
						</div>
					</div>
					<div className="multi-select-modal-footer-bottom">
						<button
							className={`multi-select-action-btn${copying === "text" ? " copying" : ""}`}
							disabled={!selectedCount || !!copying}
							onClick={() => handleCopy("text")}
						>
							{copying === "text" ? (
								<Check size={14} strokeWidth={3} />
							) : (
								t("app.shareAsText")
							)}
						</button>
						<button
							className={`multi-select-action-btn${copying === "markdown" ? " copying" : ""}`}
							disabled={!selectedCount || !!copying}
							onClick={() => handleCopy("markdown")}
						>
							{copying === "markdown" ? (
								<Check size={14} strokeWidth={3} />
							) : (
								t("app.shareAsMarkdown")
							)}
						</button>
						<button
							className={`multi-select-action-btn${copying === "image" ? " copying" : ""}`}
							disabled={!selectedCount || !!copying}
							onClick={() => handleCopy("image")}
						>
							{copying === "image" ? (
								<Check size={14} strokeWidth={3} />
							) : (
								t("app.shareAsImage")
							)}
						</button>
						<button
							className="multi-select-action-btn primary"
							onClick={props.onClose}
							disabled={!!copying}
						>
							{t("app.multiSelectCancel")}
						</button>
					</div>
				</footer>
			</div>
		</div>
	);
}


type EntryAction = {
	active?: boolean;
	label: string;
	onClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
	icon: ReactNode;
};

export function ConversationOutline(props: {
	items: Array<{ id: string; role: string; title: string; time: string }>;
	onJump: (id: string) => void;
	extraAction?: EntryAction;
	terminalAction?: EntryAction;
	filesAction?: EntryAction;
	gitAction?: EntryAction;
	editorsAction?: EntryAction & { anchorRef?: React.RefObject<HTMLButtonElement | null> };
	browserAction?: EntryAction;
}) {
	const [expanded, setExpanded] = useState(false);
	const [dragging, setDragging] = useState(false);
	const [top, setTop] = useState(() => getInitialOutlineTop());
	const dragRef = useRef<{ startY: number; startTop: number } | null>(null);
	const topRef = useRef(top);
	const visibleItems = expanded ? props.items : props.items.slice(-15);
	const hasMore = props.items.length > 15;

	useEffect(() => {
		topRef.current = top;
	}, [top]);

	useEffect(() => {
		if (!dragging) return;
		function onMove(event: PointerEvent) {
			const drag = dragRef.current;
			if (!drag) return;
			setTop(clampOutlineTop(drag.startTop + event.clientY - drag.startY));
		}
		function onUp() {
			setDragging(false);
			dragRef.current = null;
			localStorage.setItem(OUTLINE_TOP_STORAGE_KEY, String(topRef.current));
		}
		window.addEventListener("pointermove", onMove);
		window.addEventListener("pointerup", onUp);
		return () => {
			window.removeEventListener("pointermove", onMove);
			window.removeEventListener("pointerup", onUp);
		};
	}, [dragging]);

	useEffect(() => {
		const onResize = () => setTop((value) => clampOutlineTop(value));
		window.addEventListener("resize", onResize);
		return () => window.removeEventListener("resize", onResize);
	}, []);

	function startDrag(event: ReactPointerEvent<HTMLElement>) {
		event.preventDefault();
		event.stopPropagation();
		dragRef.current = { startY: event.clientY, startTop: topRef.current };
		setDragging(true);
	}

	return (
		<div
			className={`outline-hover${dragging ? " dragging" : ""}`}
			style={{ "--outline-top": `${top}px` } as React.CSSProperties}
		>
			<div className="outline-zone">
				<button
					className={`outline-trigger${props.items.length > 0 ? "" : " is-disabled"}`}
					disabled={props.items.length === 0}
					title={t("outline.trigger", { count: props.items.length })}
					onPointerDown={props.items.length > 0 ? startDrag : undefined}
				>
					☰
				</button>
				{props.items.length > 0 && (
				<nav className="conversation-outline">
				<div className="outline-title">
					<span
						className="outline-drag-handle"
						title={t("outline.drag")}
						onPointerDown={startDrag}
					>
						⋮⋮
					</span>
					<span>{t("outline.title")}</span>
					<span className="outline-count">{props.items.length}</span>
				</div>
				<div className="outline-list">
					{hasMore && !expanded && (
						<button
							className="outline-expand"
							onClick={() => setExpanded(true)}
						>
							{t("outline.showAll", { count: props.items.length })}
						</button>
					)}
					{visibleItems.map((item) => (
						<button
							key={item.id}
							className={
								item.role === "user" ? "outline-user" : "outline-assistant"
							}
							onClick={() => props.onJump(item.id)}
						>
							<strong>{item.title}</strong>
							<span>{item.time}</span>
						</button>
					))}
				</div>
				</nav>
				)}
			</div>
			{props.extraAction && (
				<button
					type="button"
					className={`scratch-pad-entry${props.extraAction.active ? " active" : ""}`}
					title={props.extraAction.label}
					aria-label={props.extraAction.label}
					onClick={props.extraAction.onClick}
				>
					{props.extraAction.icon}
				</button>
			)}
			{props.terminalAction && (
				<button
					type="button"
					className={`terminal-entry${props.terminalAction.active ? " active" : ""}`}
					title={props.terminalAction.label}
					aria-label={props.terminalAction.label}
					onClick={props.terminalAction.onClick}
				>
					{props.terminalAction.icon}
				</button>
			)}
			{props.filesAction && (
				<button
					type="button"
					className={`files-entry${props.filesAction.active ? " active" : ""}`}
					title={props.filesAction.label}
					aria-label={props.filesAction.label}
					onClick={props.filesAction.onClick}
				>
					{props.filesAction.icon}
				</button>
			)}
			{props.gitAction && (
				<button
					type="button"
					className={`git-entry${props.gitAction.active ? " active" : ""}`}
					title={props.gitAction.label}
					aria-label={props.gitAction.label}
					onClick={props.gitAction.onClick}
				>
					{props.gitAction.icon}
				</button>
			)}
			{props.editorsAction && (
				<button
					type="button"
					className={`editors-entry${props.editorsAction.active ? " active" : ""}`}
					title={props.editorsAction.label}
					aria-label={props.editorsAction.label}
					onClick={props.editorsAction.onClick}
				>
					{props.editorsAction.icon}
				</button>
			)}
			{props.browserAction && (
				<button
					type="button"
					className={`browser-entry${props.browserAction.active ? " active" : ""}`}
					title={props.browserAction.label}
					aria-label={props.browserAction.label}
					onClick={props.browserAction.onClick}
				>
					{props.browserAction.icon}
				</button>
			)}
		</div>
	);
}

const OUTLINE_TOP_STORAGE_KEY = "pi-desktop:outline-top";
function getInitialOutlineTop() {
	if (typeof window === "undefined") return 180;
	const saved = Number(localStorage.getItem(OUTLINE_TOP_STORAGE_KEY));
	if (Number.isFinite(saved) && saved > 0) return clampOutlineTop(saved);
	return clampOutlineTop(Math.round(window.innerHeight * 0.32));
}

function clampOutlineTop(value: number) {
	if (typeof window === "undefined") return value;
	return Math.min(window.innerHeight - 92, Math.max(76, value));
}

export function DrawerContent(props: {
	panel: WorkspaceDrawerPanel;
	project?: Project;
	files: FileTreeNode[];
	sessions: SessionSummary[];
	sessionsLoading?: boolean;
	expandedDirs: Set<string>;
	onToggleDirectory: (path: string) => void;
	onCollapseAllDirectories: () => void;
	pinned: boolean;
	onTogglePin: () => void;
	onCollapse: () => void;
	onClose: () => void;
	onFileContextMenu: (node: FileTreeNode, x: number, y: number) => void;
	onRefreshFiles: () => void;
	onOpenFolder?: () => void;
	onRefreshSessions: () => void;
	onOpenSession: (session: SessionSummary) => void;
	onRenameSession: (filePath: string, newName: string) => void;
	onCopySession: (session: SessionSummary) => void | Promise<void>;
	onExportSession: (session: SessionSummary) => void | Promise<void>;
	onDeleteSession: (session: SessionSummary) => void | Promise<void>;
	onOpenFile?: (path: string) => void;
	onViewFile?: (path: string) => void;
}) {
	const title =
		props.panel === "files"
			? t("drawer.files")
			: props.project
				? t("drawer.projectSessions", { name: props.project.name })
				: t("drawer.historyTitle");
	return (
		<>
			<div className="drawer-header">
				<strong>{title}</strong>
				<div className="drawer-header-actions">
					<button
						className={props.pinned ? "active" : ""}
						title={props.pinned ? t("drawer.unpin") : t("drawer.pin")}
						aria-label={props.pinned ? t("drawer.unpin") : t("drawer.pin")}
						onClick={props.onTogglePin}
					>
						<Pin size={15} />
					</button>
					<button
						disabled={props.pinned}
						title={props.pinned ? t("drawer.pinnedCannotClose") : t("drawer.closePanel")}
						aria-label={t("drawer.closePanel")}
						onClick={props.onClose}
					>
						<X size={16} />
					</button>
				</div>
			</div>
			{props.panel === "files" && (
				<FilesPanel
					files={props.files}
					expandedDirs={props.expandedDirs}
					onToggleDirectory={props.onToggleDirectory}
					onCollapseAll={props.onCollapseAllDirectories}
					onFileContextMenu={props.onFileContextMenu}
					onRefreshFiles={props.onRefreshFiles}
					onOpenFolder={props.onOpenFolder}
					onOpenFile={props.onOpenFile}
					onViewFile={props.onViewFile}
				/>
			)}
			{props.panel === "sessions" && (
				<SessionsPanel
					sessions={props.sessions}
					onRefresh={props.onRefreshSessions}
					onOpen={props.onOpenSession}
					onRename={props.onRenameSession}
					onCopy={props.onCopySession}
					onExport={props.onExportSession}
					onDelete={props.onDeleteSession}
				/>
			)}
		</>
	);
}

function FilesPanel(props: {
	files: FileTreeNode[];
	expandedDirs: Set<string>;
	onToggleDirectory: (path: string) => void;
	onFileContextMenu: (node: FileTreeNode, x: number, y: number) => void;
	onRefreshFiles: () => void;
	/** 收起文件树中所有已展开的目录，清空 expandedDirs。 */
	onCollapseAll?: () => void;
	onOpenFolder?: () => void;
	onOpenFile?: (path: string) => void;
	onViewFile?: (path: string) => void;
}) {
	return (
		<div className="files-panel">
			<div className="panel-action-row">
				<span>{t("drawer.fileItems", { count: props.files.length })}</span>
				<div className="panel-action-buttons">
					{props.onOpenFolder && (
						<button onClick={props.onOpenFolder} title={t("drawer.openFolder")}>
							<Folder size={14} />
							{t("drawer.openFolder")}
						</button>
					)}
					{/* 刷新与全部收起使用纯图标按钮，保持工具栏紧凑、与列表项字号对齐 */}
					<button
						className="icon-only"
						onClick={props.onRefreshFiles}
						title={t("common.refresh")}
						aria-label={t("common.refresh")}
					>
						<RefreshCw size={14} />
					</button>
					{props.onCollapseAll && (
						<button
							className="icon-only"
							onClick={props.onCollapseAll}
							title={t("drawer.collapseAllDirs")}
							aria-label={t("drawer.collapseAllDirs")}
							disabled={props.expandedDirs.size === 0}
						>
							<ChevronsDownUp size={14} />
						</button>
					)}
				</div>
			</div>
			{props.files.map((node) => (
				<FileNode
					key={node.path}
					node={node}
					expandedDirs={props.expandedDirs}
					onToggleDirectory={props.onToggleDirectory}
					onFileContextMenu={props.onFileContextMenu}
					onOpenFile={props.onOpenFile}
					onViewFile={props.onViewFile}
				/>
			))}
		</div>
	);
}

const SESSION_FILE_SUMMARY_COLLAPSED_KEY_PREFIX =
	"pid:session-file-summary-collapsed:";
const SESSION_FILE_SUMMARY_FILE_LIST_EXPANDED_KEY_PREFIX =
	"pid:session-file-summary-file-list-expanded:";

/** 读取指定 session 的折叠状态(无存储返回默认值) */
function loadCollapsed(sessionKey: string | null): boolean {
	if (!sessionKey || typeof window === "undefined") return true;
	const stored = localStorage.getItem(
		SESSION_FILE_SUMMARY_COLLAPSED_KEY_PREFIX + sessionKey,
	);
	return stored !== null ? stored === "true" : true;
}

function loadFileListExpanded(sessionKey: string | null): boolean {
	if (!sessionKey || typeof window === "undefined") return false;
	const stored = localStorage.getItem(
		SESSION_FILE_SUMMARY_FILE_LIST_EXPANDED_KEY_PREFIX + sessionKey,
	);
	return stored !== null ? stored === "true" : false;
}

export function SessionFileSummary(props: {
	files: SessionModifiedFile[];
	onOpenFile?: (path: string) => void;
	onDiffFile?: DiffFileHandler;
	/** sessionIdOrPath: 会话唯一标识(如 sessionPath),用于按 agent/session 隔离折叠状态。
	 *  组件卸载后再次挂载相同标识时,恢复之前保存的折叠偏好。 */
	sessionIdOrPath?: string;
}) {
	const [collapsed, setCollapsed] = useState(() =>
		loadCollapsed(props.sessionIdOrPath ?? null),
	);
	const [fileListExpanded, setFileListExpanded] = useState(() =>
		loadFileListExpanded(props.sessionIdOrPath ?? null),
	);
	const prevSessionRef = useRef(props.sessionIdOrPath);

	// 当 sessionIdOrPath 变化时重新从 localStorage 读取
	useEffect(() => {
		if (prevSessionRef.current === props.sessionIdOrPath) return;
		prevSessionRef.current = props.sessionIdOrPath;
		setCollapsed(loadCollapsed(props.sessionIdOrPath ?? null));
		setFileListExpanded(loadFileListExpanded(props.sessionIdOrPath ?? null));
	}, [props.sessionIdOrPath]);

	// 仅在用户主动点击时写 localStorage,不在 sessionIdOrPath 切换时误写
	const handleToggleCollapsed = useCallback(() => {
		setCollapsed((prev) => {
			const next = !prev;
			if (props.sessionIdOrPath) {
				localStorage.setItem(
					SESSION_FILE_SUMMARY_COLLAPSED_KEY_PREFIX + props.sessionIdOrPath,
					String(next),
				);
			}
			return next;
		});
	}, [props.sessionIdOrPath]);

	const handleToggleFileList = useCallback(() => {
		setFileListExpanded((prev) => {
			const next = !prev;
			if (props.sessionIdOrPath) {
				localStorage.setItem(
					SESSION_FILE_SUMMARY_FILE_LIST_EXPANDED_KEY_PREFIX +
						props.sessionIdOrPath,
					String(next),
				);
			}
			return next;
		});
	}, [props.sessionIdOrPath]);

	const visibleFiles = fileListExpanded ? props.files : props.files.slice(0, 4);
	const hiddenCount = Math.max(0, props.files.length - visibleFiles.length);

	// 无文件时不渲染
	if (props.files.length === 0) return null;

	return (
		<section className="session-file-summary-list-card" aria-label={t("drawer.modifiedFilesAria")}>
			<button
				className="session-file-summary-header"
				type="button"
				onClick={handleToggleCollapsed}
				aria-expanded={!collapsed}
			>
				<ChevronDown
					size={14}
					className={`session-file-summary-chevron${collapsed ? "" : " open"}`}
				/>
				<span className="session-file-summary-title-span">{t("drawer.modifiedFiles")}</span>
				<small className="session-file-summary-count">
					{props.files.length} {t("app.files")}
				</small>
			</button>
			{!collapsed && (
				<>
					<ul className="session-file-summary-list">
						{visibleFiles.map((file) => {
							const fileName = file.path.split(/[/\\]/).pop() ?? file.path;
							return (
								<li key={file.path}>
									<button
										className="session-file-summary-row"
										type="button"
										title={file.path}
										onClick={() => props.onDiffFile?.(file.path, file.originalContent, file.content)}
									>
										<span className="session-file-summary-name">{fileName}</span>
									</button>
								</li>
							);
						})}
					</ul>
					{props.files.length > 4 && (
						<button
							className="session-file-summary-toggle"
							type="button"
							onClick={handleToggleFileList}
						>
							{fileListExpanded ? t("common.collapse") : t("drawer.moreFiles", { count: hiddenCount })}
						</button>
					)}
				</>
			)}
		</section>
	);
}

function fileIconElement(name: string, isDirectory: boolean, isExpanded: boolean) {
	if (isDirectory) {
		return isExpanded ? <FolderOpen size={16} /> : <Folder size={16} />;
	}
	try {
		const { svg, colorName } = getFileIconSeti(name);
		const color = getFileIconColor(colorName);
		// SVG 只来自仓库内附带许可证的只读 Seti 数据快照，不接收文件内容或用户输入。
		return (
			<span
				aria-hidden="true"
				className="file-node-seti-icon"
				style={{ color }}
				dangerouslySetInnerHTML={{ __html: svg }}
			/>
		);
	} catch {
		return <FileText size={15} />;
	}
}

function FileNode(props: {
	node: FileTreeNode;
	expandedDirs: Set<string>;
	onToggleDirectory: (path: string) => void;
	onFileContextMenu: (node: FileTreeNode, x: number, y: number) => void;
	onOpenFile?: (path: string) => void;
	onViewFile?: (path: string) => void;
	depth?: number;
}) {
	const { node, expandedDirs, onToggleDirectory, depth = 0 } = props;
	const expanded = expandedDirs.has(node.path);
	const typeLabel = node.type === "file" ? getFileTypeLabel(node.name) : "";
	const rowStyle = { "--file-depth-offset": `${depth * 16}px` } as CSSProperties;
	const menu = (event: React.MouseEvent) => {
		event.preventDefault();
		props.onFileContextMenu(node, event.clientX, event.clientY);
	};
	if (node.type === "file")
		return (
			<div className="file-node" style={rowStyle}>
				<button className="file file-node-row" style={rowStyle}
					title={`${node.relativePath}\n${typeLabel}`}
					onClick={() => props.onViewFile?.(node.path)}
					onContextMenu={menu}>
					<span className="file-node-icon">
						{fileIconElement(node.name, false, false)}
					</span>
					<span className="file-node-name">{node.name}</span>
					<span className="file-node-type-label">{typeLabel}</span>
				</button>
			</div>
		);
	return (
		<div className="file-node" style={rowStyle}>
			<button className="directory file-node-row" style={rowStyle}
				onClick={() => onToggleDirectory(node.path)}
				onContextMenu={menu}
				title={node.relativePath}>
				<span className="file-node-icon">
					{fileIconElement(node.name, true, expanded)}
				</span>
				<span className="file-node-name">{node.name}</span>
			</button>
			{expanded && node.children && node.children.length > 0 && (
				<div className="file-children">
					{node.children.map((child) => (
						<FileNode key={child.path} node={child}
							expandedDirs={expandedDirs}
							onToggleDirectory={onToggleDirectory}
							onFileContextMenu={props.onFileContextMenu}
							onOpenFile={props.onOpenFile}
							onViewFile={props.onViewFile}
							depth={depth + 1} />
					))}
				</div>
			)}
		</div>
	);
}

function SessionsPanel(props: {
	sessions: SessionSummary[];
	onRefresh: () => void;
	onOpen: (session: SessionSummary) => void;
	onRename: (filePath: string, newName: string) => void | Promise<void>;
	onCopy: (session: SessionSummary) => void | Promise<void>;
	onExport: (session: SessionSummary) => void | Promise<void>;
	onDelete: (session: SessionSummary) => void | Promise<void>;
}) {
	const [renamingPath, setRenamingPath] = useState<string | null>(null);
	const [editValue, setEditValue] = useState("");
	/* sessionActionNotice 已改用 toast (sonner) 实现 */
	const [sessionActionLoading, setSessionActionLoading] = useState<{
		filePath: string;
		action: "copy" | "export" | "delete";
	} | null>(null);
	const [deleteConfirmSession, setDeleteConfirmSession] =
		useState<SessionSummary | null>(null);
	const inputRef = useRef<HTMLInputElement>(null);

	function startRename(session: SessionSummary) {
		setRenamingPath(session.filePath);
		setEditValue(session.name || "");
		requestAnimationFrame(() => inputRef.current?.focus());
	}

	function confirmRename() {
		if (renamingPath && editValue.trim()) {
			void props.onRename(renamingPath, editValue.trim());
		}
		setRenamingPath(null);
		setEditValue("");
	}

	async function runSessionAction(
		session: SessionSummary,
		actionType: "copy" | "export" | "delete",
		action: () => void | Promise<void>,
		successText: string,
	) {
		setSessionActionLoading({ filePath: session.filePath, action: actionType });
		showNotice(
			actionType === "copy"
				? t("drawer.sessionActionCopying")
				: actionType === "export"
					? t("drawer.sessionActionExporting")
					: t("drawer.sessionActionDeleting"),
			3500,
		);
		try {
			await action();
			showNotice(successText, 1600);
		} catch (error) {
			showNotice(
				error instanceof Error ? error.message : t("drawer.sessionActionFailed"),
				2400,
			);
		} finally {
			setSessionActionLoading(null);
		}
	}

	// 计算子会话到父会话的分组映射；路径可能跨 Windows/WSL 或经过 IPC，统一分隔符和大小写。
	const parentToChildren = useMemo(() => {
		const map = new Map<string, SessionSummary[]>();
		for (const s of props.sessions) {
			const parentKey = normalizeSessionPathForCompare(s.parentSessionPath);
			if (parentKey) {
				const list = map.get(parentKey) ?? [];
				list.push(s);
				map.set(parentKey, list);
			}
		}
		return map;
	}, [props.sessions]);
	// 仅显示顶层会话（非子会话）的计数
	const parentSessions = useMemo(() =>
		props.sessions.filter(s => !s.parentSessionPath),
		[props.sessions],
	);
	const [expandedParents, setExpandedParents] = useState<Set<string>>(new Set());
	const toggleParent = useCallback((filePath: string) => {
		const key = normalizeSessionPathForCompare(filePath) ?? filePath;
		setExpandedParents(prev => {
			const next = new Set(prev);
			if (next.has(key)) next.delete(key);
			else next.add(key);
			return next;
		});
	}, []);

	return (
		<div className="sessions-panel">
			<div className="panel-action-row">
				<span>{t("drawer.sessionCount", { count: parentSessions.length })}</span>
				<button onClick={props.onRefresh}>{t("common.refresh")}</button>
			</div>
			{parentSessions.length === 0 && (
				<div className="sessions-empty">
					<strong>{t("drawer.sessionEmptyTitle")}</strong>
					<span>{t("drawer.sessionEmptyDesc")}</span>
				</div>
			)}
			{parentSessions.map((session) => {
				const children = parentToChildren.get(normalizeSessionPathForCompare(session.filePath) ?? "");
				const normalizedPath = normalizeSessionPathForCompare(session.filePath) ?? session.filePath;
				const isExpanded = expandedParents.has(normalizedPath);
				return (
				<div
					key={session.filePath}
					className="session-card-group"
				>
					<div className="session-card">
					{renamingPath === session.filePath ? (
						<div className="session-rename-row">
							<input
								ref={inputRef}
								value={editValue}
								onChange={(e) => setEditValue(e.target.value)}
								onKeyDown={(e) => {
									if (e.key === "Enter") confirmRename();
									if (e.key === "Escape") {
										setRenamingPath(null);
										setEditValue("");
									}
								}}
								autoFocus
							/>
							<button onClick={confirmRename}>{t("common.save")}</button>
							<button
								onClick={() => {
									setRenamingPath(null);
									setEditValue("");
								}}
							>
								{t("common.cancel")}
							</button>
						</div>
					) : (
						<div className="session-card-display">
							<button
								className="session-card-inner"
								onClick={() => props.onOpen(session)}
								title={session.filePath}
							>
								<div className="session-card-title">
									<strong>{session.name || t("common.untitled")}</strong>
									{session.source && session.source !== "pi" && (
										<span className={`session-source-badge ${session.source}`}>
											{t(`sessionSource.${session.source}` as any)}
										</span>
									)}
									<small>
										{new Date(session.updatedAt).toLocaleString()} ·{" "}
										{t("drawer.sessionMessages", {
											count: session.messageCount,
										})}
									</small>
								</div>
							</button>
							<div className="session-card-actions">
								<button
									className="session-rename-button"
									title={t("menu.copySession")}
									disabled={Boolean(sessionActionLoading)}
									onClick={() =>
										void runSessionAction(
											session,
											"copy",
											() => props.onCopy(session),
											t("drawer.sessionCopied"),
										)
									}
								>
									{sessionActionLoading?.filePath === session.filePath &&
										sessionActionLoading.action === "copy" && <span className="mini-loader" />}
									<span>
										{sessionActionLoading?.filePath === session.filePath &&
										sessionActionLoading.action === "copy"
											? t("menu.copying")
											: t("common.copy")}
									</span>
								</button>
								<button
									className="session-rename-button"
									title={t("menu.exportHtml")}
									disabled={Boolean(sessionActionLoading)}
									onClick={() =>
										void runSessionAction(
											session,
											"export",
											() => props.onExport(session),
											t("drawer.sessionExported"),
										)
									}
								>
									{sessionActionLoading?.filePath === session.filePath &&
										sessionActionLoading.action === "export" && <span className="mini-loader" />}
									<span>
										{sessionActionLoading?.filePath === session.filePath &&
										sessionActionLoading.action === "export"
											? t("menu.exporting")
											: t("common.export")}
									</span>
								</button>
								<button
									className="session-rename-button"
									title={t("common.rename")}
									onClick={() => startRename(session)}
								>
									<span>{t("common.rename")}</span>
								</button>
								<button
									className="session-rename-button danger"
									title={t("common.delete")}
									disabled={Boolean(sessionActionLoading)}
									onClick={() => setDeleteConfirmSession(session)}
								>
									{sessionActionLoading?.filePath === session.filePath &&
										sessionActionLoading.action === "delete" && <span className="mini-loader" />}
									<span>
										{sessionActionLoading?.filePath === session.filePath &&
										sessionActionLoading.action === "delete"
											? t("drawer.sessionActionDeleting")
											: t("common.delete")}
									</span>
								</button>
							</div>
							{/* sessionActionNotice 已改用 toast (sonner) 实现 */}
						</div>
					)}
				</div>
					{children && children.length > 0 && (
						<div className="session-card-children-header">
							<button
								className="session-card-expand-btn"
								title={isExpanded ? t("drawer.collapseSubagentSessions") : t("drawer.expandSubagentSessions")}
								onClick={() => toggleParent(session.filePath)}
							>
								{isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
								<span>{t("drawer.subagentSessionCount", { count: children.length })}</span>
							</button>
						</div>
					)}
					{isExpanded && children?.map((child) => (
						<div key={child.filePath} className="session-card session-card-child">
							<div className="session-card-display">
								<button
									className="session-card-inner"
									onClick={() => props.onOpen(child)}
									title={child.filePath}
								>
									<div className="session-card-title">
										<strong>{child.name || t("common.untitled")}</strong>
										<span className="session-source-badge subagent">{t("drawer.subagentSession")}</span>
										<small>
											{new Date(child.updatedAt).toLocaleString()} ·{" "}
											{t("drawer.sessionMessages", {
												count: child.messageCount,
											})}
										</small>
									</div>
								</button>
							</div>
						</div>
					))}
				</div>
				);
			})}
			{deleteConfirmSession && (() => {
					const deleteChildren = parentToChildren.get(normalizeSessionPathForCompare(deleteConfirmSession.filePath) ?? "") ?? [];
					return (
				<div className="session-delete-confirm-backdrop" onClick={() => setDeleteConfirmSession(null)}>
					<section
						className="session-delete-confirm"
						onClick={(event) => event.stopPropagation()}
					>
						<strong>{t("drawer.sessionDeleteTitle")}</strong>
						<p>
							{deleteChildren.length > 0
								? t("drawer.sessionDeleteBodyWithChildren", {
										name: deleteConfirmSession.name || t("common.untitled"),
										count: deleteChildren.length,
									})
								: t("drawer.sessionDeleteBody", {
										name: deleteConfirmSession.name || t("common.untitled"),
									})}
						</p>
						<div className="session-delete-confirm-actions">
							<button onClick={() => setDeleteConfirmSession(null)}>{t("common.cancel")}</button>
							<button
								className="danger"
								onClick={() => {
									const target = deleteConfirmSession;
									setDeleteConfirmSession(null);
									void runSessionAction(
										target,
										"delete",
										() => props.onDelete(target),
										t("drawer.sessionDeleted"),
									);
								}}
							>
								{t("common.delete")}
							</button>
						</div>
					</section>
				</div>
			); })()
		}
		</div>
	);
}

export function SessionHistoryModal(props: {
	project: Project;
	sessions: SessionSummary[];
	loading: boolean;
	onClose: () => void;
	onRefresh: () => void;
	onOpen: (session: SessionSummary) => void;
	onRename: (filePath: string, newName: string) => void | Promise<void>;
	onCopy: (session: SessionSummary) => void | Promise<void>;
	onExport: (session: SessionSummary) => void | Promise<void>;
	onDelete: (session: SessionSummary) => void | Promise<void>;
}) {
	return (
		<div className="picker-backdrop session-history-backdrop" onClick={props.onClose}>
			<section
				className="session-history-modal command-palette"
				onClick={(event) => event.stopPropagation()}
			>
				<div className="command-palette-header session-history-header">
					<div>
						<strong>{t("drawer.historyTitle")}</strong>
						<span>{props.project.name}</span>
					</div>
					<IconButton
						className="command-palette-close"
						label={t("common.close")}
						onClick={props.onClose}
					>
						<X size={16} strokeWidth={2.2} aria-hidden="true" />
					</IconButton>
				</div>
				<div className="session-history-path" title={props.project.path}>
					{props.project.path}
				</div>
				<div className="session-history-body">
					{props.loading ? (
						<div className="session-history-loading">
							<div className="loader" />
							<span>{t("drawer.historyLoading")}</span>
						</div>
					) : (
						<SessionsPanel
							sessions={props.sessions}
							onRefresh={props.onRefresh}
							onOpen={props.onOpen}
							onRename={props.onRename}
							onCopy={props.onCopy}
							onExport={props.onExport}
							onDelete={props.onDelete}
						/>
					)}
				</div>
			</section>
		</div>
	);
}

/** 创建 git worktree 的对话框 */

export function PromptSuggestions(props: {
	prompt: string;
	items: SuggestionItem[];
	selectedIndex: number;
	onSelectedIndexChange: (index: number) => void;
	onClose: () => void;
	onPick: (value: string) => void;
	/** 菜单锚定位置（屏幕坐标），未传则使用默认居中定位 */
	anchorStyle?: React.CSSProperties;
}) {
	const listRef = useRef<HTMLDivElement>(null);
	// 头部标题类型由选中项推导:光标相关触发后,第一个候选的 value 前缀即代表当前是命令还是文件。
	const isCommand = props.items[0]?.value.startsWith("/") ?? false;
	const isSession = props.items[0]?.value.startsWith("&") ?? false;
	const headerLabel = isCommand ? t("prompt.commands") : isSession ? t("prompt.sessions") : t("prompt.files");

	// 滚动到选中项
	useEffect(() => {
		const list = listRef.current;
		if (!list) return;
		const item = list.children[props.selectedIndex] as HTMLElement;
		if (item) {
			item.scrollIntoView({ block: "nearest" });
		}
	}, [props.selectedIndex]);

	if (props.items.length === 0) return null;

	// 阻止 mousedown 冒泡到 RichInput，避免点击面板时触发 blur 关闭面板，
	// 但保留各按钮的 onClick 正常工作。
	return (
		<div
			className="command-palette"
			style={props.anchorStyle}
			onMouseDown={(e) => e.preventDefault()}
		>
			<div className="command-palette-header">
				<span>{headerLabel}</span>
				<IconButton
					className="command-palette-close"
					label={t("common.close")}
					onClick={props.onClose}
				>
					<X size={16} strokeWidth={2.2} aria-hidden="true" />
				</IconButton>
			</div>
			<div className="command-palette-list" ref={listRef}>
				{props.items.map((item, index) => (
					<button
						key={item.key}
						className={`command-palette-item${index === props.selectedIndex ? " selected" : ""}`}
						onMouseEnter={() => props.onSelectedIndexChange(index)}
						onClick={() => props.onPick(item.value)}
					>
						<span className="command-palette-label">{item.label}</span>
						<span className="command-palette-desc">{item.description}</span>
					</button>
				))}
			</div>
			<div className="command-palette-footer">
				<span>{t("prompt.selectHint")}</span>
				<span>{t("prompt.confirmHint")}</span>
				<span>{t("prompt.closeHint")}</span>
			</div>
		</div>
	);
}

export function FileContextMenu(props: {
	menu: { x: number; y: number; node: FileTreeNode };
	onClose: () => void;
	onOpen: () => void;
	onReveal: () => void;
	onAttach: () => void;
	onCopyPath: () => void;
	onDelete?: () => void;
	onRename?: () => void;
}) {
	const menuRef = useRef<HTMLDivElement | null>(null);
	const [pos, setPos] = useState({ x: props.menu.x, y: props.menu.y });
	const isFile = props.menu.node.type === "file";
	const isDir = props.menu.node.type === "directory";

	// 测量菜单实际高度，超底部时向上翻转，避免底部文件右键菜单被视口遮挡。
	// 翻转后至少保留 8px 上边距，使菜单始终可读。
	useEffect(() => {
		const el = menuRef.current;
		if (!el) return;
		const rect = el.getBoundingClientRect();
		const overflowY = rect.bottom - window.innerHeight;
		if (overflowY > 0) {
			setPos({ x: props.menu.x, y: Math.max(8, props.menu.y - rect.height) });
		}
	}, [props.menu.x, props.menu.y]);

	return (
		<div className="context-backdrop" onClick={props.onClose}>
			<div
				ref={menuRef}
				className="context-menu"
				style={{ left: pos.x, top: pos.y }}
				onClick={(event) => event.stopPropagation()}
			>
				<button disabled={!isFile} onClick={props.onAttach}>
					{t("menu.attachFile")}
				</button>
				<button disabled={!isFile} onClick={props.onOpen}>
					{t("menu.defaultOpen")}
				</button>
				<button onClick={props.onReveal}>{t("menu.revealFile")}</button>
				<button onClick={props.onCopyPath}>{t("menu.copyPath")}</button>
				{props.onRename && (
					<button onClick={props.onRename}>{t("common.rename")}</button>
				)}
				{props.onDelete && (
					<button className="danger" onClick={props.onDelete}>
						{t("common.delete")}
					</button>
				)}
			</div>
		</div>
	);
}

/** 会话管理弹框：展示项目所有会话，支持多选删除、导出、重命名 */

