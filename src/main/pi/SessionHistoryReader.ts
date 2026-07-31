import { open, readFile, stat } from "node:fs/promises";
import type { ChatMessage, SessionMessagePage } from "../../shared/types";
import type { MainProcessTranslationKey } from "../../shared/i18n/mainProcessCopy";
import type { RpcResponse } from "./PiRpcClient";
import type { AppLogger } from "../logging/AppLogger";

type SessionDisplayEntry = {
	id: string;
	parentId: string | null;
	type: string;
	offset: number;
	byteLength: number;
	hasMessage: boolean;
	summary?: string;
	firstKeptEntryId?: string;
};

type SessionDisplayIndex = {
	hostPath: string;
	size: number;
	mtimeMs: number;
	hasCompaction: boolean;
	activeMessageEntries: SessionDisplayEntry[];
};

export type SessionArchiveData = {
	compactions: Array<{
		id: string;
		summary: string;
		timestamp: string;
		firstKeptEntryId?: string;
		tokensBefore?: number;
	}>;
	archivedMessagesByCompactionId: Map<string, ChatMessage[]>;
};

export type SessionHistoryReaderDeps = {
	toHostPath: (sessionPath: string) => string;
	convertMessages: (
		agentId: string,
		rawMessages: unknown[],
		activeEntryIds?: string[],
	) => ChatMessage[];
	trimMessages: (rawMessages: unknown[], maxTurns?: number) => unknown[];
	translate: (
		key: MainProcessTranslationKey,
		params?: Record<string, string | number>,
	) => string;
	logger?: Pick<AppLogger, "info" | "warn">;
};

/**
 * Reads persisted Session JSONL without starting Pi. Runtime ownership remains in
 * AgentManager; this reader owns bounded display paging and compaction recovery.
 */
export class SessionHistoryReader {
	private readonly sessionDisplayIndexes = new Map<string, SessionDisplayIndex>();
	private static readonly SESSION_DISPLAY_INDEX_LIMIT = 32;
	private static readonly MAX_SESSION_DISPLAY_PAGE_SIZE = 100;
	private static readonly MAX_SESSION_DISPLAY_PAGE_BYTES = 256 * 1024;

	constructor(private readonly deps: SessionHistoryReaderDeps) {}

	/**
	 * 不启动 pi 进程，直接从 JSONL 构造与运行态相同的时间线数据。
	 * Viewer 必须复用 AgentManager 的压缩归档与消息转换规则，避免维护第二套显示模型。
	 */
	async readSessionDisplayMessages(
		sessionPath: string,
		agentId = "_viewer",
		sessionContent?: string,
	): Promise<ChatMessage[]> {
		const content = sessionContent ?? await readFile(this.deps.toHostPath(sessionPath), "utf8");
		const entries: Array<{
			id: string;
			parentId: string | null;
			type: string;
			message?: unknown;
			summary?: string;
			firstKeptEntryId?: string;
			tokensBefore?: number;
			timestamp?: string;
		}> = [];

		for (const line of content.split("\n")) {
			if (!line.trim()) continue;
			try {
				const entry = JSON.parse(line);
				if (!entry || typeof entry !== "object" || typeof entry.id !== "string") continue;
				entries.push({
					id: entry.id,
					parentId: typeof entry.parentId === "string" ? entry.parentId : null,
					type: typeof entry.type === "string" ? entry.type : "",
					message: entry.message,
					summary: typeof entry.summary === "string" ? entry.summary : undefined,
					firstKeptEntryId: typeof entry.firstKeptEntryId === "string" ? entry.firstKeptEntryId : undefined,
					tokensBefore: typeof entry.tokensBefore === "number" ? entry.tokensBefore : undefined,
					timestamp: typeof entry.timestamp === "string" ? entry.timestamp : undefined,
				});
			} catch {
				// 单行损坏不应阻断整个 Viewer。
			}
		}
		if (entries.length === 0) return [];

		// JSONL 最后一个 entry 是 pi 当前叶节点；沿 parentId 回溯得到与 get_messages 一致的活动分支。
		const byId = new Map(entries.map((entry) => [entry.id, entry]));
		const activeBranch: typeof entries = [];
		const seen = new Set<string>();
		let current: (typeof entries)[number] | undefined = entries[entries.length - 1];
		while (current && !seen.has(current.id)) {
			seen.add(current.id);
			activeBranch.push(current);
			current = current.parentId ? byId.get(current.parentId) : undefined;
		}
		activeBranch.reverse();

		const lastCompactionIndex = activeBranch.findLastIndex((entry) => entry.type === "compaction");
		const lastCompaction = lastCompactionIndex >= 0 ? activeBranch[lastCompactionIndex] : undefined;
		const firstKeptIndex = lastCompaction?.firstKeptEntryId
			? activeBranch.findIndex((entry) => entry.id === lastCompaction.firstKeptEntryId)
			: -1;
		// pi 压缩后上下文由 summary + firstKeptEntryId 起的保留消息 + 后续消息组成；
		// 不能只取 compaction entry 之后，否则会漏掉压缩时明确保留的尾部消息。
		const currentStartIndex = firstKeptIndex >= 0
			? firstKeptIndex
			: lastCompactionIndex >= 0
				? lastCompactionIndex + 1
				: 0;
		const currentEntries = activeBranch
			.slice(currentStartIndex)
			.filter((entry) => entry.type === "message" && entry.message);
		const rawMessages = currentEntries.map((entry) => entry.message);
		// Offline Session viewers must expose the complete active branch. The runtime
		// prompt-history cap belongs to Agent startup, while renderer pagination owns
		// how much of a historical Session is rendered at one time.
		const activeEntryIds = currentEntries.map((entry) => entry.id);

		let finalRaw: unknown[] = rawMessages;
		if (lastCompaction) {
			const compactionEntry = lastCompaction;
			const archiveData = await this.parseSessionArchives(sessionPath, agentId, content);
			const archivedMessages = archiveData.archivedMessagesByCompactionId.get(compactionEntry.id) ?? [];
			finalRaw = [{
				role: "compactionSummary",
				summary: compactionEntry.summary || this.deps.translate("session.summaryPlaceholder"),
				timestamp: compactionEntry.timestamp ? Date.parse(compactionEntry.timestamp) : Date.now(),
				meta: {
					compactionId: compactionEntry.id,
					compactionCount: archiveData.compactions.length,
					firstKeptEntryId: compactionEntry.firstKeptEntryId,
					tokensBefore: compactionEntry.tokensBefore,
					archivedMessages,
				},
			}, ...rawMessages];
		}

		return this.deps.convertMessages(agentId, finalRaw, activeEntryIds);
	}

	async readSessionDisplayMessagePage(
		sessionPath: string,
		agentId = "_viewer",
		before?: number,
		pageSize = SessionHistoryReader.MAX_SESSION_DISPLAY_PAGE_SIZE,
	): Promise<SessionMessagePage> {
		const index = await this.getSessionDisplayIndex(sessionPath);
		const total = index.activeMessageEntries.length;
		const boundedBefore = Number.isSafeInteger(before)
			? Math.min(Math.max(0, before!), total)
			: total;
		const requestedPageSize = Number.isFinite(pageSize)
			? Math.floor(pageSize)
			: SessionHistoryReader.MAX_SESSION_DISPLAY_PAGE_SIZE;
		const limit = Math.min(
			Math.max(1, requestedPageSize),
			SessionHistoryReader.MAX_SESSION_DISPLAY_PAGE_SIZE,
		);
		let start = boundedBefore;
		let selectedBytes = 0;
		let selectedCount = 0;
		while (start > 0 && selectedCount < limit) {
			const candidate = index.activeMessageEntries[start - 1];
			if (
				selectedCount > 0 &&
				selectedBytes + candidate.byteLength > SessionHistoryReader.MAX_SESSION_DISPLAY_PAGE_BYTES
			) {
				break;
			}
			selectedBytes += candidate.byteLength;
			selectedCount += 1;
			start -= 1;
		}

		// Compaction cards contain archived child messages. Preserve their existing
		// semantics until archive data gets its own cursor protocol; normal Sessions,
		// including the 50 MiB fixture, use the bounded offset reader below.
		if (index.hasCompaction) {
			const messages = await this.readSessionDisplayMessages(sessionPath, agentId);
			return {
				messages: messages.slice(start, boundedBefore),
				total: messages.length,
				nextBefore: start > 0 ? start : null,
			};
		}

		const entries = index.activeMessageEntries.slice(start, boundedBefore);
		const rawMessages = await this.readIndexedSessionMessages(index.hostPath, entries);
		return {
			messages: this.deps.convertMessages(agentId, rawMessages, entries.map((entry) => entry.id)),
			total,
			nextBefore: start > 0 ? start : null,
		};
	}

	private async getSessionDisplayIndex(sessionPath: string): Promise<SessionDisplayIndex> {
		const hostPath = this.deps.toHostPath(sessionPath);
		const version = await stat(hostPath);
		const cached = this.sessionDisplayIndexes.get(hostPath);
		if (cached && cached.size === version.size && cached.mtimeMs === version.mtimeMs) {
			this.sessionDisplayIndexes.delete(hostPath);
			this.sessionDisplayIndexes.set(hostPath, cached);
			return cached;
		}

		const content = await readFile(hostPath, "utf8");
		const entries = new Map<string, SessionDisplayEntry>();
		let lastEntryId: string | undefined;
		let byteOffset = 0;
		const lines = content.split("\n");
		for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
			const sourceLine = lines[lineIndex];
			const hasNewline = lineIndex < lines.length - 1;
			const byteLength = Buffer.byteLength(sourceLine, "utf8");
			const jsonLine = sourceLine.endsWith("\r") ? sourceLine.slice(0, -1) : sourceLine;
			try {
				const entry = JSON.parse(jsonLine) as Record<string, unknown>;
				if (typeof entry.id === "string") {
					entries.set(entry.id, {
						id: entry.id,
						parentId: typeof entry.parentId === "string" ? entry.parentId : null,
						type: typeof entry.type === "string" ? entry.type : "",
						offset: byteOffset,
						byteLength,
						hasMessage: entry.message !== undefined && entry.message !== null,
						summary: typeof entry.summary === "string" ? entry.summary : undefined,
						firstKeptEntryId: typeof entry.firstKeptEntryId === "string"
							? entry.firstKeptEntryId
							: undefined,
					});
					lastEntryId = entry.id;
				}
			} catch {
				// A malformed JSONL line must not make the historical viewer unusable.
			}
			byteOffset += byteLength + (hasNewline ? 1 : 0);
		}

		const activeBranch: SessionDisplayEntry[] = [];
		const seen = new Set<string>();
		let current = lastEntryId ? entries.get(lastEntryId) : undefined;
		while (current && !seen.has(current.id)) {
			seen.add(current.id);
			activeBranch.push(current);
			current = current.parentId ? entries.get(current.parentId) : undefined;
		}
		activeBranch.reverse();
		const lastCompactionIndex = activeBranch.findLastIndex((entry) => entry.type === "compaction");
		const lastCompaction = lastCompactionIndex >= 0 ? activeBranch[lastCompactionIndex] : undefined;
		const firstKeptIndex = lastCompaction?.firstKeptEntryId
			? activeBranch.findIndex((entry) => entry.id === lastCompaction.firstKeptEntryId)
			: -1;
		const currentStartIndex = firstKeptIndex >= 0
			? firstKeptIndex
			: lastCompactionIndex >= 0 ? lastCompactionIndex + 1 : 0;
		const index: SessionDisplayIndex = {
			hostPath,
			size: version.size,
			mtimeMs: version.mtimeMs,
			hasCompaction: lastCompactionIndex >= 0,
			activeMessageEntries: activeBranch
				.slice(currentStartIndex)
				.filter((entry) => entry.type === "message" && entry.hasMessage),
		};
		this.sessionDisplayIndexes.delete(hostPath);
		this.sessionDisplayIndexes.set(hostPath, index);
		while (this.sessionDisplayIndexes.size > SessionHistoryReader.SESSION_DISPLAY_INDEX_LIMIT) {
			this.sessionDisplayIndexes.delete(this.sessionDisplayIndexes.keys().next().value!);
		}
		return index;
	}

	private async readIndexedSessionMessages(
		hostPath: string,
		entries: SessionDisplayEntry[],
	): Promise<unknown[]> {
		const handle = await open(hostPath, "r");
		try {
			return await Promise.all(entries.map(async (entry) => {
				const buffer = Buffer.allocUnsafe(entry.byteLength);
				await handle.read(buffer, 0, buffer.length, entry.offset);
				const line = buffer.toString("utf8").replace(/\r$/, "");
				return (JSON.parse(line) as { message?: unknown }).message;
			}));
		} finally {
			await handle.close();
		}
	}


	/**
	 * 直接从历史会话 JSONL 文件读取最近 N 轮对话的消息条目。
	 * 用于大会话场景：绕过 get_messages RPC 的整文件 JSON 传输瓶颈，
	 * 直接在桌面进程解析 JSONL 并只取尾部消息，避免大会话加载导致界面冻结。
	 * 返回兼容 RpcResponse 格式的对象，可复用 loadMessages 的消息处理管线。
	 */
	async readRecentMessages(
		sessionPath: string,
		maxTurns: number,
	): Promise<RpcResponse> {
		const t0 = Date.now();
		let content: string;
		try {
			content = await readFile(this.deps.toHostPath(sessionPath), "utf8");
		} catch (error) {
			void this.deps.logger?.warn("agent", "Failed to read session file for recent messages", {
				sessionPath,
				error: error instanceof Error ? error.message : String(error),
			});
			throw error;
		}

		const lines = content.split("\n");
		const messageEntries: unknown[] = [];

		for (const line of lines) {
			if (!line.trim()) continue;
			try {
				const entry = JSON.parse(line);
				if (entry.type === "message" && entry.message) {
					messageEntries.push(entry.message);
				}
			} catch {
				// 跳过单行解析失败，不影响后续行
			}
		}

		// 只保留最近 maxTurns 轮对话
		const trimmed = this.deps.trimMessages(messageEntries, maxTurns);
		const t1 = Date.now();

		void this.deps.logger?.info("agent", "Recent messages read from session file", {
			sessionPath,
			totalLines: lines.length,
			messageEntries: messageEntries.length,
			trimmedTurns: maxTurns,
			trimmedMessages: trimmed.length,
			readMs: t1 - t0,
		});

		return {
			type: "response" as const,
			command: "get_messages",
			success: true,
			data: { messages: trimmed },
		};
	}

	/**
	 * 从原始会话文件解析压缩（compaction）记录。
	 * pi 的 get_messages 对压缩后的会话只返回压缩后的消息，不携带压缩摘要，
	 * 因此桌面端直接从 JSONL 里扫描 type:="compaction" 和 type:="message" 条目，用于：
	 *   1) 在时间线最前面补回"压缩摘要"卡片（与 pi 行为一致）；
	 *   2) 统计压缩次数，供前端展示"已压缩 N 次";
	 *   3) 提取每个压缩段归档的消息，支持在时间线中展开查看压缩前内容。
	 */
	async parseSessionArchives(
		sessionPath: string,
		agentId: string,
		sessionContent?: string,
	): Promise<{
		compactions: Array<{ id: string; summary: string; timestamp: string; firstKeptEntryId?: string; tokensBefore?: number }>;
		/** 每个压缩条目对应的归档消息（ChatMessage 格式），key 为压缩条目 id */
		archivedMessagesByCompactionId: Map<string, ChatMessage[]>;
	}> {
		let content: string;
		try {
			content = sessionContent ?? await readFile(this.deps.toHostPath(sessionPath), "utf8");
		} catch (error) {
			void this.deps.logger?.warn("agent", "Failed to read session file for archive parsing", {
				sessionPath,
				error: error instanceof Error ? error.message : String(error),
			});
			return { compactions: [], archivedMessagesByCompactionId: new Map() };
		}

		// 一次遍历收集所有 entry 和原始消息
		const allEntries: Array<{ id: string; parentId: string | null; type: string; message?: unknown; summary?: string; firstKeptEntryId?: string; tokensBefore?: number; timestamp: string }> = [];
		const rawMessagesByEntryId = new Map<string, unknown>();

		for (const line of content.split("\n")) {
			if (!line.trim()) continue;
			try {
				const entry = JSON.parse(line);
				if (!entry || typeof entry !== "object") continue;
				allEntries.push({
					id: typeof entry.id === "string" ? entry.id : "",
					parentId: typeof entry.parentId === "string" ? entry.parentId : null,
					type: typeof entry.type === "string" ? entry.type : "",
					message: entry.message,
					summary: typeof entry.summary === "string" ? entry.summary : undefined,
					firstKeptEntryId: typeof entry.firstKeptEntryId === "string" ? entry.firstKeptEntryId : undefined,
					tokensBefore: typeof entry.tokensBefore === "number" ? entry.tokensBefore : undefined,
					timestamp: typeof entry.timestamp === "string" ? entry.timestamp : "",
				});
				// 缓存消息型 entry 的原始 message 对象，供后续 convertAgentMessages 使用
				if (entry.type === "message" && entry.message && typeof entry.message === "object" && entry.id) {
					rawMessagesByEntryId.set(entry.id, entry.message);
				}
			} catch {
				// 跳过单行解析失败
			}
		}

		// 建立 entryId → entry 索引（含 parentId 关系）
		const entryById = new Map<string, typeof allEntries[number]>();
		for (const entry of allEntries) {
			if (entry.id) entryById.set(entry.id, entry);
		}

		// 提取压缩条目（按文件顺序，即时间顺序）
		const compactionEntries = allEntries.filter((e) => e.type === "compaction");
		const compactions = compactionEntries.map((c) => ({
			id: c.id,
			summary: c.summary ?? "",
			timestamp: c.timestamp,
			firstKeptEntryId: c.firstKeptEntryId,
			tokensBefore: c.tokensBefore,
		}));

		// 为每个压缩条目收集其归档范围内的消息。
		// 归档范围：从压缩条目的 parentId 沿 parentId 链向上，收集所有 type=message 的条目，
		// 直到遇到该压缩条目的 firstKeptEntryId 或上一个压缩条目的 firstKeptEntryId（避免重复归组）。
		const archivedMessagesByCompactionId = new Map<string, ChatMessage[]>();
		const coveredEntryIds = new Set<string>();

		// 按文件顺序处理（从旧到新），确保较早的压缩条目优先确定范围
		for (const compEntry of compactionEntries) {
			const rawMessages: unknown[] = [];
			const seenIds = new Set<string>();

			// 从压缩条目的 parentId 开始向上回溯
			let currentId: string | null = compEntry.parentId;
			while (currentId) {
				if (seenIds.has(currentId)) break; // 防止循环
				seenIds.add(currentId);

				const entry = entryById.get(currentId);
				if (!entry) break;

				// 遇到 firstKept 或已被上一个压缩条目覆盖的条目时停止
				if (currentId === compEntry.firstKeptEntryId) break;
				if (coveredEntryIds.has(currentId)) break;

				// 收集消息型 entry
				if (entry.type === "message") {
					const rawMsg = rawMessagesByEntryId.get(currentId);
					if (rawMsg) {
						rawMessages.push(rawMsg);
						coveredEntryIds.add(currentId);
					}
				}

				currentId = entry.parentId;
			}

			if (rawMessages.length > 0) {
				// 反转消息顺序（回溯得到的是从新到旧，需反转为从旧到新）
				rawMessages.reverse();
			// 转换为 ChatMessage 格式
			try {
				const chatMessages = this.deps.convertMessages(agentId, rawMessages);
				if (chatMessages.length > 0) {
					archivedMessagesByCompactionId.set(compEntry.id, chatMessages);
				}
			} catch (err) {
				void this.deps.logger?.warn("agent", "Failed to convert archived messages", {
					agentId,
					compactionId: compEntry.id,
					rawCount: rawMessages.length,
					error: err instanceof Error ? err.message : String(err),
				});
			}
			}
		}

		return { compactions, archivedMessagesByCompactionId };
	}

}
