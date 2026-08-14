/**
 * 将会话消息折叠成轨迹账本（turn + 3-lane 时间线）。
 *
 * 业务规则：
 * - 用户消息开启新 turn；其后的 assistant / thinking / tool 归入该 turn。
 * - system / error 不拆 turn，挂到当前 turn；若还没有 turn 则单独成 turn。
 * - 工具起止优先用 meta.startedAt + meta.durationMs（与 AgentManager 写入约定一致），
 *   不用 message.timestamp（update/end 会刷新，历史恢复后耗时不可还原）。
 * - in-flight（running / pending）不伪造 duration：endedAt 留空，时间列显示为进行中。
 */

import type { ChatMessage } from "../../../../../shared/types";

export type TrajectoryLane = "input" | "model" | "tools";

export type TrajectoryRecordKind =
	| "user"
	| "assistant"
	| "thinking"
	| "tool"
	| "system"
	| "error";

export type TrajectoryRecord = {
	id: string;
	kind: TrajectoryRecordKind;
	lane: TrajectoryLane;
	turnIndex: number;
	title: string;
	summary: string;
	startedAt: number;
	/** 缺省 = in-flight，时间线可投影到 now，账本不得编造耗时。 */
	endedAt?: number;
	durationMs?: number;
	status?: string;
	toolName?: string;
	toolCallId?: string;
	text?: string;
	detail?: string;
};

export type TrajectoryTurn = {
	index: number;
	id: string;
	startedAt: number;
	endedAt?: number;
	inFlight: boolean;
	records: TrajectoryRecord[];
};

export type TrajectoryModel = {
	turns: TrajectoryTurn[];
	records: TrajectoryRecord[];
	domainStart: number;
	domainEnd: number;
};

const SUMMARY_LIMIT = 96;

function asString(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function summarize(text: string): string {
	const flat = text.replace(/\s+/g, " ").trim();
	if (flat.length <= SUMMARY_LIMIT) return flat;
	return `${flat.slice(0, SUMMARY_LIMIT - 1)}…`;
}

function toolNameOf(message: ChatMessage): string {
	const fromMeta = asString(message.meta?.toolName);
	if (fromMeta) return fromMeta;
	const text = message.text.replace(/^[\u25b6\u2713\u2717]\s*/u, "").trim();
	return text.split(/\s+/)[0] || "tool";
}

function laneOf(kind: TrajectoryRecordKind): TrajectoryLane {
	if (kind === "user") return "input";
	if (kind === "tool") return "tools";
	return "model";
}

function isThinkingOnly(message: ChatMessage): boolean {
	return (
		message.role === "assistant" &&
		Boolean(message.thinking?.trim()) &&
		!message.text.replace(/<thinking>[\s\S]*?<\/thinking>/gi, "").trim()
	);
}

function isInFlightTool(message: ChatMessage): boolean {
	return asString(message.meta?.status) === "running";
}

function isInFlightAssistant(message: ChatMessage): boolean {
	return message.stopReason === "pending";
}

function pushRecord(records: TrajectoryRecord[], record: TrajectoryRecord): void {
	records.push(record);
}

function flushTurn(
	turns: TrajectoryTurn[],
	records: TrajectoryRecord[],
	startedAt: number,
	id: string,
): void {
	if (records.length === 0) return;
	const endedCandidates = records
		.map((record) => record.endedAt)
		.filter((value): value is number => typeof value === "number");
	const inFlight = records.some((record) => record.endedAt === undefined);
	turns.push({
		index: turns.length,
		id,
		startedAt,
		endedAt: inFlight ? undefined : endedCandidates.length > 0 ? Math.max(...endedCandidates) : startedAt,
		inFlight,
		records,
	});
}

/**
 * 从 ChatMessage[] 构建轨迹。now 仅用于空会话兜底 domain，不写入 in-flight duration。
 */
export function buildTrajectory(messages: ChatMessage[], now = Date.now()): TrajectoryModel {
	const turns: TrajectoryTurn[] = [];
	let current: TrajectoryRecord[] = [];
	let turnStartedAt = 0;
	let turnId = "";

	const startTurn = (id: string, startedAt: number) => {
		if (current.length > 0) flushTurn(turns, current, turnStartedAt, turnId || current[0].id);
		current = [];
		turnId = id;
		turnStartedAt = startedAt;
	};

	for (const message of messages) {
		if (message.role === "user") {
			startTurn(message.id, message.timestamp);
			pushRecord(current, {
				id: message.id,
				kind: "user",
				lane: laneOf("user"),
				turnIndex: turns.length,
				title: "user",
				summary: summarize(message.text),
				startedAt: message.timestamp,
				endedAt: message.timestamp,
				durationMs: 0,
				text: message.text,
			});
			continue;
		}

		if (current.length === 0) {
			turnId = message.id;
			turnStartedAt = message.timestamp;
		}

		if (message.role === "tool") {
			const startedAt = asNumber(message.meta?.startedAt) ?? message.timestamp;
			const durationMs = asNumber(message.meta?.durationMs);
			const inFlight = isInFlightTool(message);
			const name = toolNameOf(message);
			const endedAt = inFlight ? undefined : startedAt + (durationMs ?? 0);
			pushRecord(current, {
				id: message.id,
				kind: "tool",
				lane: laneOf("tool"),
				turnIndex: turns.length,
				title: name,
				summary: summarize(asString(message.meta?.detailText) || message.text || name),
				startedAt,
				endedAt,
				durationMs: inFlight ? undefined : (durationMs ?? 0),
				status: asString(message.meta?.status) ?? (message.meta?.isError ? "error" : "done"),
				toolName: name,
				toolCallId: asString(message.meta?.toolCallId),
				text: message.text,
				detail: asString(message.meta?.detailText) ?? asString(message.meta?.result),
			});
			continue;
		}

		if (message.role === "assistant") {
			if (message.thinking?.trim()) {
				const startedAt = message.thinkingStartedAt ?? message.timestamp;
				const endedAt = isThinkingOnly(message) && isInFlightAssistant(message)
					? undefined
					: (message.thinkingEndedAt ?? message.timestamp);
				pushRecord(current, {
					id: `${message.id}:thinking`,
					kind: "thinking",
					lane: laneOf("thinking"),
					turnIndex: turns.length,
					title: "thinking",
					summary: summarize(message.thinking),
					startedAt,
					endedAt,
					durationMs: endedAt === undefined ? undefined : Math.max(0, endedAt - startedAt),
					text: message.thinking,
				});
			}
			if (!isThinkingOnly(message)) {
				const inFlight = isInFlightAssistant(message);
				pushRecord(current, {
					id: message.id,
					kind: "assistant",
					lane: laneOf("assistant"),
					turnIndex: turns.length,
					title: "assistant",
					summary: summarize(message.text),
					startedAt: message.timestamp,
					endedAt: inFlight ? undefined : message.timestamp,
					durationMs: inFlight ? undefined : 0,
					status: message.stopReason,
					text: message.text,
				});
			}
			continue;
		}

		const kind: TrajectoryRecordKind = message.role === "error" ? "error" : "system";
		pushRecord(current, {
			id: message.id,
			kind,
			lane: laneOf(kind),
			turnIndex: turns.length,
			title: kind,
			summary: summarize(message.text),
			startedAt: message.timestamp,
			endedAt: message.timestamp,
			durationMs: 0,
			text: message.text,
		});
	}

	if (current.length > 0) flushTurn(turns, current, turnStartedAt, turnId || current[0].id);

	const records = turns.flatMap((turn) => turn.records);
	const times = records.flatMap((record) => {
		const values = [record.startedAt];
		if (record.endedAt !== undefined) values.push(record.endedAt);
		return values;
	});
	const domainStart = times.length > 0 ? Math.min(...times) : now;
	const closedEnd = times.length > 0 ? Math.max(...times) : now;
	// domain 右端：有 in-flight 时伸到 now，让时间线开区间可见；账本本身仍不写 duration。
	const domainEnd = records.some((record) => record.endedAt === undefined)
		? Math.max(closedEnd, now)
		: closedEnd;

	return { turns, records, domainStart, domainEnd };
}

export type TrajectoryTimeRange = { start: number; end: number };

/** 区间过滤：与 span 有重叠即保留；无区间则全量。 */
export function filterRecordsByRange(
	records: TrajectoryRecord[],
	range: TrajectoryTimeRange | undefined,
): TrajectoryRecord[] {
	if (!range) return records;
	const lo = Math.min(range.start, range.end);
	const hi = Math.max(range.start, range.end);
	return records.filter((record) => {
		const start = record.startedAt;
		const end = record.endedAt ?? start;
		return end >= lo && start <= hi;
	});
}
