import type { ChatMessage } from "../../../../shared/types";
import type {
	AgentRunItem,
	ThinkingGroupItem,
	ToolGroupItem,
} from "../app/AppUtils";

/* ── 工具参数解析（与 AppUtils 同逻辑的内联副本：此文件被 node 单测直接加载，
   不能带 AppUtils 的运行时依赖链；改动时需与 AppUtils 同步） ── */

function parseToolArgs(value: unknown): Record<string, unknown> | undefined {
	if (!value) return undefined;
	if (typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
	if (typeof value !== "string" || !value.trim()) return undefined;
	try {
		let parsed = JSON.parse(value) as unknown;
		if (typeof parsed === "string" && parsed.trim()) {
			try { parsed = JSON.parse(parsed); } catch { return undefined; }
		}
		return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : undefined;
	} catch {
		return undefined;
	}
}

function getToolFilePath(args: unknown): string | undefined {
	if (!args) return undefined;
	let a: unknown = args;
	if (typeof a === "string" && a.trim()) {
		try { a = JSON.parse(a); } catch { return undefined; }
	}
	if (typeof a !== "object" || a === null) return undefined;
	const r = a as Record<string, unknown>;
	return typeof r.filePath === "string" && r.filePath ? r.filePath
		: typeof r.file_path === "string" && r.file_path ? r.file_path
		: typeof r.path === "string" && r.path ? r.path
		: typeof r.targetPath === "string" && r.targetPath ? r.targetPath
		: typeof r.target_path === "string" && r.target_path ? r.target_path
		: typeof r.outputPath === "string" && r.outputPath ? r.outputPath
		: typeof r.output_path === "string" && r.output_path ? r.output_path
		: typeof r.file === "string" && r.file ? r.file
		: typeof r.fileName === "string" && r.fileName ? r.fileName
		: typeof r.filename === "string" && r.filename ? r.filename
		: undefined;
}

function countTextLines(value: string): number {
	return value ? value.split(/\r\n|\r|\n/).length : 0;
}

function getToolEditDiff(args: Record<string, unknown>): { oldText: string; newText: string } | undefined {
	const edits = Array.isArray(args.edits) ? args.edits : undefined;
	if (edits) {
		const parts = edits.map((edit: unknown) => {
			if (!edit || typeof edit !== "object") return null;
			const e = edit as Record<string, unknown>;
			const oldText = String(e.oldText ?? e.old_text ?? e.old_string ?? "");
			const newText = String(e.newText ?? e.new_text ?? e.new_string ?? "");
			return { oldText, newText };
		}).filter((p): p is { oldText: string; newText: string } => p !== null);
		if (parts.length === 0) return undefined;
		return {
			oldText: parts.map((p) => p.oldText).join("\n"),
			newText: parts.map((p) => p.newText).join("\n"),
		};
	}
	const oldText = typeof args.oldText === "string" ? args.oldText : typeof args.old_text === "string" ? args.old_text : typeof args.old_string === "string" ? args.old_string : undefined;
	const newText = typeof args.newText === "string" ? args.newText : typeof args.new_text === "string" ? args.new_text : typeof args.new_string === "string" ? args.new_string : undefined;
	if (oldText === undefined || newText === undefined) return undefined;
	return { oldText, newText };
}

const ANSI_RE = /\x1b\[[0-9;]*[a-zA-Z]/g;

export function stripAnsi(text: string): string {
  return text.replace(ANSI_RE, "");
}

/* stripThinkingTags 与 AppUtils 同逻辑的内联副本（此文件被 node 单测直接加载，改动需同步） */
export function stripThinkingTags(text: string): string {
	return text.replace(/<thinking>[\s\S]*?<\/thinking>/gi, "").trim();
}

export function getToolStatus(
  message: ChatMessage,
): "running" | "done" | "error" {
  const status = String(message.meta?.status ?? "");
  if (status === "running") return "running";
  if (status === "error" || message.role === "error") return "error";
  return "done";
}

/** 从工具参数中提取文件路径（write/edit/create/patch 等文件工具） */
export function getToolArgFilePath(args: Record<string, unknown> | undefined): string | undefined {
	return getToolFilePath(args);
}

/**
 * 提取单条工具消息的 diff 目标（write/edit/create/patch）：
 * write/create 提供完整新内容；edit/patch 提供变动区域（oldText/newText）。
 * 与单条工具卡片的 diff 按钮共用，会话文件汇总也复用此逻辑。
 */
export function getToolDiffTarget(message: ChatMessage): { path: string; originalContent: string; content: string; changedLines: number } | undefined {
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
 * 遍历会话消息收集 write/edit/create/patch 修改的文件（复用 getToolDiffTarget）。
 * 同文件多次修改取最后一次 diff 并累计次数。供会话文件汇总组件与单测共用。
 */
export function collectSessionFileChanges(
	messages: readonly ChatMessage[],
): Array<{ path: string; count: number; originalContent: string; content: string }> {
	const map = new Map<string, { path: string; count: number; originalContent: string; content: string }>();
	for (const message of messages) {
		const target = getToolDiffTarget(message);
		if (!target) continue;
		const prev = map.get(target.path);
		map.set(target.path, {
			path: target.path,
			count: (prev?.count ?? 0) + 1,
			originalContent: target.originalContent,
			content: target.content,
		});
	}
	return [...map.values()];
}

export function getToolName(message: ChatMessage): string {
  const fromMeta = message.meta?.toolName;
  if (typeof fromMeta === "string" && fromMeta.trim()) return fromMeta;
  const text = stripAnsi(message.text).replace(/^[\u25b6\u2713\u2717]\s*/u, "").trim();
  return text.split(/\s+/)[0] || "tool";
}

export function getToolDetailText(message: ChatMessage): string {
  if (typeof message.meta?.detailText === "string") {
    return stripAnsi(message.meta.detailText);
  }
  return stripAnsi(JSON.stringify(message.meta ?? {}, null, 2));
}

export function getToolExitCode(message: ChatMessage): number | undefined {
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

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}.${Math.floor((ms % 1000) / 100)}s`;
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds % 60;
  return remaining > 0 ? `${minutes}m${remaining}s` : `${minutes}m`;
}

export function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString(undefined, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/* ── 一轮回答的时序分段 ── */

/** 过程段：连续的思考/工具组成，可折叠。 */
export type TurnProcessSegment = {
	kind: "process";
	id: string;
	items: (ThinkingGroupItem | ToolGroupItem)[];
};

/** 回答文本段：常驻平铺；isFinal 标记本轮最后一条回答（TurnRow 用它挂载编辑入口），位置仍在时序原位。 */
export type TurnTextSegment = {
	kind: "text";
	id: string;
	message: ChatMessage;
	isFinal: boolean;
};

export type TurnSegment = TurnProcessSegment | TurnTextSegment;

/**
 * 把一轮回答（agent-run）严格按 run.items 时序拆成展示段：
 * - 连续的思考/工具合成一个 process 折叠段；
 * - 每条回答文本原位平铺为 text 段（issue #130 多段回答）；
 * - assistant 消息自带的 thinking 作为过程条目插到该文本之前（思考→回答）。
 *
 * 修复：旧实现把「最后一条 assistant 消息」抽离时序固定渲染到底部、其思考
 * append 到分段末尾。流式期间或中断的 run 里这条消息后往往还有工具/思考，
 * 导致尾部条目被渲到回答上方、思考块上下颠倒。此处不允许任何重排。
 */
export function buildTurnSegments(
	run: AgentRunItem,
	options: { showThinking?: boolean } = {},
): TurnSegment[] {
	const showThinking = Boolean(options.showThinking);
	// 本轮最后一条 assistant 消息的位置：仅用于 isFinal 标记，不影响排序
	let lastAssistantIndex = -1;
	run.items.forEach((item, index) => {
		if (item.kind === "message" && item.message.role === "assistant") {
			lastAssistantIndex = index;
		}
	});
	const segments: TurnSegment[] = [];
	const pushProcessItem = (item: ThinkingGroupItem | ToolGroupItem) => {
		const last = segments[segments.length - 1];
		if (last?.kind === "process") last.items.push(item);
		else segments.push({ kind: "process", id: item.id, items: [item] });
	};
	run.items.forEach((item, index) => {
		if (item.kind === "thinking-group" || item.kind === "tool-group") {
			pushProcessItem(item);
			return;
		}
		if (item.kind !== "message" || item.message.role !== "assistant") return;
		// 消息自带的思考：插到该回答文本之前，保持「思考→回答」时序。
		// thinking-only 消息在 groupToolMessages 阶段已归入 thinking-group，不会重复。
		const thinking =
			showThinking && item.message.thinking?.trim()
				? stripAnsi(item.message.thinking)
				: "";
		if (thinking) {
			pushProcessItem({
				kind: "thinking-group",
				// 稳定 id 由消息 id 派生：流式期间 thinking 持续增长但 key 不变，
				// 避免 React 重建组件导致展开状态丢失。
				id: `msg-thinking-${item.message.id}`,
				messages: [item.message],
				text: thinking,
				startedAt: item.message.timestamp ?? run.startedAt,
				endedAt: item.message.timestamp ?? run.endedAt,
			});
		}
		// 空文本消息（纯思考已归入过程段）不再产生 text 段
		if (!stripThinkingTags(stripAnsi(item.message.text)).trim()) return;
		segments.push({
			kind: "text",
			id: item.message.id,
			message: item.message,
			isFinal: index === lastAssistantIndex,
		});
	});
	return segments;
}
