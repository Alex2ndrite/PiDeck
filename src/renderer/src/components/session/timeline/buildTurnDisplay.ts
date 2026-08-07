/**
 * 把一轮 agent-run 展开为扁平展示序列（纯函数，可单测）。
 *
 * 语义（与用户确认）：
 * - 中间回答：本轮「不是最后一条」的 assistant 文本（思考/工具之间的阶段性输出）。
 * - 最终回答：本轮「最后一条」assistant 文本，常驻、永不折叠。
 * - 思考/工具步骤：原位出现，不打包进同一 DOM 容器（避免折叠容器被回答文本打断），
 *   由外层 run 级折叠开关统一控制显隐。
 * - assistant 消息自带的 thinking 作为思考步骤插到该回答之前（保持「思考→回答」时序）。
 * - 严格按 run.items 原始时序输出，不做任何重排。
 *
 * 设计说明：旧 buildTurnSegments 把「不连续的思考/工具」拆成多个 process 段，
 * 导致一轮回答出现多个「执行过程」折叠汇总。此处改为扁平序列 + 单一折叠控制，
 * 由 turn/TurnRow 渲染成「一个汇总按钮 + 步骤原位穿插 + 回答常驻」。
 */
import type { AgentRunItem, ThinkingGroupItem } from "../../app/AppUtils";
import type { TurnDisplayItem } from "./types";

/* 内联 strip 工具：本模块零运行时依赖（node 单测直接加载 .ts，
 * 无扩展名相对 import 在 node ESM 下不可解析；与 TimelineFormat.ts 同逻辑，改动需同步）。 */
const ANSI_RE = /\x1b\[[0-9;]*[a-zA-Z]/g;

function stripAnsi(text: string): string {
	return text.replace(ANSI_RE, "");
}

function stripThinkingTags(text: string): string {
	return text.replace(/<thinking>[\s\S]*?<\/thinking>/gi, "").trim();
}

export function buildTurnDisplay(
	run: AgentRunItem,
	options: { showThinking?: boolean } = {},
): TurnDisplayItem[] {
	const showThinking = Boolean(options.showThinking);
	// 本轮最后一条 assistant 消息的位置：唯一用于区分中间回答/最终回答的锚点。
	let lastAssistantIndex = -1;
	run.items.forEach((item, index) => {
		if (item.kind === "message" && item.message.role === "assistant") {
			lastAssistantIndex = index;
		}
	});

	const items: TurnDisplayItem[] = [];
	// 已有 thinking-group 始终保留；消息自带 thinking 受 showThinking 控制。
	const pushThinking = (group: ThinkingGroupItem, respectShowThinking: boolean) => {
		if (respectShowThinking && !showThinking) return;
		items.push({
			kind: "process-entry",
			entry: { kind: "thinking-entry", id: group.id, group },
		});
	};

	run.items.forEach((item, index) => {
		if (item.kind === "thinking-group") {
			pushThinking(item, false);
			return;
		}
		if (item.kind === "tool-group") {
			items.push({
				kind: "process-entry",
				entry: { kind: "tool-entry", id: item.id, group: item },
			});
			return;
		}
		if (item.kind !== "message" || item.message.role !== "assistant") return;
		// 消息自带的思考：插到该回答之前（思考→回答时序）。
		const thinking =
			showThinking && item.message.thinking?.trim()
				? stripAnsi(item.message.thinking)
				: "";
		if (thinking) {
			pushThinking(
				{
					kind: "thinking-group",
					// 稳定 id 由消息 id 派生：流式期间 thinking 持续增长但 key 不变，
					// 避免 React 重建组件导致展开状态丢失。
					id: `msg-thinking-${item.message.id}`,
					messages: [item.message],
					text: thinking,
					startedAt: item.message.timestamp ?? run.startedAt,
					endedAt: item.message.timestamp ?? run.endedAt,
				},
				true,
			);
		}
		// 空文本消息（纯思考已归入过程步骤）不产生回答段。
		const text = stripThinkingTags(stripAnsi(item.message.text)).trim();
		if (!text) return;
		if (index === lastAssistantIndex) {
			items.push({ kind: "final-answer", id: item.message.id, message: item.message });
		} else {
			items.push({ kind: "interim-answer", id: item.message.id, message: item.message });
		}
	});

	return items;
}

/** 本轮是否存在「可折叠」内容（思考/工具/中间回答之一），决定是否渲染汇总按钮。 */
export function hasFoldableContent(items: TurnDisplayItem[]): boolean {
	return items.some((item) => item.kind !== "final-answer");
}
