/**
 * 时间线 turn 挂载窗口：贴底长会话只挂尾部 N 个 agent-run，滚离底部时放开。
 * 与消息分页（100 条）/ 激活 3 轮（数据层）正交——只管「画多少 TurnRow」。
 */

/** 贴底时最多挂载的 agent-run 轮数（2026-11 轮次模型：10 → 3，与激活下发窗口对齐）。 */
export const TIMELINE_MOUNTED_TURN_LIMIT = 3;

export function countAgentRunItems(items: ReadonlyArray<{ kind: string }>): number {
	let count = 0;
	for (const item of items) {
		if (item.kind === "agent-run") count += 1;
	}
	return count;
}

/**
 * 从尾部保留最多 maxTurns 个 agent-run，并带上从首个保留 run 起的全部条目
 * （run 之间的 system/compaction 等附属消息一并保留）。
 * 不足 maxTurns 时原样返回（引用不变，便于 memo）。
 */
export function sliceLastAgentRuns<T extends { kind: string }>(
	items: readonly T[],
	maxTurns: number,
): T[] {
	if (maxTurns <= 0 || items.length === 0) return items as T[];
	let runs = 0;
	for (let index = items.length - 1; index >= 0; index -= 1) {
		if (items[index]?.kind !== "agent-run") continue;
		runs += 1;
		if (runs >= maxTurns) {
			return index === 0 ? (items as T[]) : items.slice(index);
		}
	}
	return items as T[];
}

/**
 * 是否对渲染列表启用 turn 窗口裁剪。
 * following（贴底跟随）且轮次超过上限时才裁；上滚/恢复历史位置时放开以免空白。
 */
export function shouldWindowTimelineTurns(
	agentRunCount: number,
	following: boolean,
	maxTurns: number = TIMELINE_MOUNTED_TURN_LIMIT,
): boolean {
	return following && maxTurns > 0 && agentRunCount > maxTurns;
}

/** 按跟随态决定展示列表；未裁剪时返回原数组引用。 */
export function selectTimelineTurnWindow<T extends { kind: string }>(
	items: readonly T[],
	following: boolean,
	maxTurns: number = TIMELINE_MOUNTED_TURN_LIMIT,
): T[] {
	if (!shouldWindowTimelineTurns(countAgentRunItems(items), following, maxTurns)) {
		return items as T[];
	}
	return sliceLastAgentRuns(items, maxTurns);
}
