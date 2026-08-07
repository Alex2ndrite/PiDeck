/**
 * 执行过程折叠汇总统计（纯函数，可单测）。
 *
 * 折叠态只显示纯数字，不显示内容预览（与用户确认）。
 * 文案拼接（i18n）放在展示组件层，本模块只负责统计，保持零副作用。
 */
import type { TurnDisplayItem } from "./types";

export type ProcessSummary = {
	toolCount: number;
	thinkingCount: number;
	interimCount: number;
};

export function buildProcessSummary(items: TurnDisplayItem[]): ProcessSummary {
	let toolCount = 0;
	let thinkingCount = 0;
	let interimCount = 0;
	for (const item of items) {
		if (item.kind === "process-entry") {
			if (item.entry.kind === "tool-entry") toolCount += 1;
			else thinkingCount += 1;
		} else if (item.kind === "interim-answer") {
			interimCount += 1;
		}
	}
	return { toolCount, thinkingCount, interimCount };
}

export function isEmptySummary(summary: ProcessSummary): boolean {
	return (
		summary.toolCount === 0 &&
		summary.thinkingCount === 0 &&
		summary.interimCount === 0
	);
}
