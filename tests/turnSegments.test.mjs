import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import vm from "node:vm";
import { buildTurnDisplay } from "../src/renderer/src/components/session/timeline/buildTurnDisplay.ts";

/**
 * 一轮回答（agent-run）扁平展示序列测试。
 *
 * 背景：旧 buildTurnSegments 把「不连续的思考/工具」拆成多个 process 折叠段，
 * 一轮回答出现多个「执行过程」汇总。buildTurnDisplay 改为扁平展示序列：
 * - process-entry（思考/工具）原位穿插，由 run 级折叠开关统一控制；
 * - interim-answer（非最后一条 assistant 文本）；
 * - final-answer（最后一条 assistant 文本，常驻）。
 * 严格按 run.items 原始时序输出，不允许重排。
 */

let seq = 0;
function assistantMessage(text, thinking) {
	seq += 1;
	return {
		id: `a-${seq}`,
		agentId: "agent",
		role: "assistant",
		text,
		timestamp: seq,
		...(thinking ? { thinking } : {}),
	};
}

function toolMessage() {
	seq += 1;
	return {
		id: `t-${seq}`,
		agentId: "agent",
		role: "tool",
		text: "✓ read",
		timestamp: seq,
		meta: { toolName: "read", status: "done" },
	};
}

function thinkingGroup(text) {
	const message = assistantMessage("", text);
	return {
		kind: "thinking-group",
		id: `tg-${message.id}`,
		messages: [message],
		text,
		startedAt: message.timestamp,
		endedAt: message.timestamp,
	};
}

function toolGroup() {
	const message = toolMessage();
	return { kind: "tool-group", id: `tg-${message.id}`, messages: [message] };
}

function runOf(items) {
	return {
		kind: "agent-run",
		id: "run-1",
		items,
		startedAt: 1,
		endedAt: 999,
	};
}

/** 提取序列概要：[类型:内容]，便于断言顺序 */
function outline(items) {
	return items.map((item) => {
		if (item.kind === "process-entry") {
			const entry = item.entry;
			return entry.kind === "thinking-entry"
				? `think:${entry.group.text}`
				: "tool";
		}
		if (item.kind === "interim-answer") return `interim:${item.message.text}`;
		return `final:${item.message.text}`;
	});
}

test("流式中间态：扁平序列严格按真实时序，不重排", () => {
	// 真实时序：思考T1 → 回答段1 → 工具 → 思考T2（还在进行，run 未结束）
	const run = runOf([
		{ kind: "message", message: assistantMessage("段1", "T1") },
		toolGroup(),
		thinkingGroup("T2"),
	]);
	const items = buildTurnDisplay(run, { showThinking: true });
	assert.deepEqual(outline(items), [
		"think:T1",
		"final:段1",
		"tool",
		"think:T2",
	]);
	// 段1 是本轮唯一 assistant 文本 → final-answer（常驻）
	assert.equal(items[1].kind, "final-answer");
});

test("中断的 run（回答后还有工具调用）：回答保持原位", () => {
	const run = runOf([
		{ kind: "message", message: assistantMessage("段1") },
		toolGroup(),
	]);
	const items = buildTurnDisplay(run, { showThinking: true });
	assert.deepEqual(outline(items), ["final:段1", "tool"]);
});

test("多段回答：中间回答与最终回答正确区分，各自思考插入到文本之前", () => {
	// 真实时序：T1 → 段1 → 工具 → T2 → 段2
	const run = runOf([
		{ kind: "message", message: assistantMessage("段1", "T1") },
		toolGroup(),
		{ kind: "message", message: assistantMessage("段2", "T2") },
	]);
	const items = buildTurnDisplay(run, { showThinking: true });
	assert.deepEqual(outline(items), [
		"think:T1",
		"interim:段1",
		"tool",
		"think:T2",
		"final:段2",
	]);
	// 段1 不是最后一条 assistant → interim；段2 是最后一条 → final
	assert.equal(items[1].kind, "interim-answer");
	assert.equal(items[4].kind, "final-answer");
});

test("相邻多段回答（中间无工具）：各自思考保持「思考→回答」时序", () => {
	const run = runOf([
		{ kind: "message", message: assistantMessage("段1", "T1") },
		{ kind: "message", message: assistantMessage("段2", "T2") },
	]);
	const items = buildTurnDisplay(run, { showThinking: true });
	assert.deepEqual(outline(items), [
		"think:T1",
		"interim:段1",
		"think:T2",
		"final:段2",
	]);
});

test("流式中（isComplete=false）：所有 assistant 都归中间回答，不提前常驻", () => {
	// 真实流式场景：run 尚未结束（agent 忙碌），当前最后一条 assistant
	// 不能判定为最终回答——否则会常驻在折叠栏外（用户反馈的 bug）。
	const run = runOf([
		{ kind: "message", message: assistantMessage("段1", "T1") },
		toolGroup(),
		{ kind: "message", message: assistantMessage("段2", "T2") },
	]);
	const items = buildTurnDisplay(run, { showThinking: true, isComplete: false });
	assert.deepEqual(outline(items), [
		"think:T1",
		"interim:段1",
		"tool",
		"think:T2",
		"interim:段2",
	]);
	// 即使最后一条也不得标记为 final-answer（流式中无法判断）
	assert.equal(items[4].kind, "interim-answer");
});

test("完整轮次：最终回答的思考插到其前，顺序保持", () => {
	const run = runOf([
		thinkingGroup("T1"),
		toolGroup(),
		{ kind: "message", message: assistantMessage("回答", "T2") },
	]);
	const items = buildTurnDisplay(run, { showThinking: true });
	assert.deepEqual(outline(items), [
		"think:T1",
		"tool",
		"think:T2",
		"final:回答",
	]);
});

test("showThinking 关闭时不展开消息自带思考，但已有 thinking-group 仍保留", () => {
	const run = runOf([
		thinkingGroup("T1"),
		{ kind: "message", message: assistantMessage("段1", "T2") },
	]);
	const items = buildTurnDisplay(run, { showThinking: false });
	assert.deepEqual(outline(items), ["think:T1", "final:段1"]);
});

test("无 assistant 消息的 run：全部归入过程步骤", () => {
	const run = runOf([thinkingGroup("T1"), toolGroup()]);
	const items = buildTurnDisplay(run, { showThinking: true });
	assert.deepEqual(outline(items), ["think:T1", "tool"]);
});

test("过程步骤使用稳定 id（流式重渲染不重置展开状态）", () => {
	const message = assistantMessage("段1", "T1");
	const run = runOf([{ kind: "message", message }]);
	const first = buildTurnDisplay(run, { showThinking: true });
	const second = buildTurnDisplay(run, { showThinking: true });
	const firstThinking = first[0];
	const secondThinking = second[0];
	assert.equal(firstThinking.kind, "process-entry");
	assert.equal(secondThinking.kind, "process-entry");
	assert.equal(firstThinking.entry.id, secondThinking.entry.id);
});

/* ── groupToolMessages：连续 assistant 消息不再合并（多段回答原位平铺，issue #130） ── */

function loadAppUtils() {
	const source = readFileSync("src/renderer/src/components/app/AppUtils.ts", "utf8");
	const { outputText } = ts.transpileModule(source, {
		compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
	});
	const sandbox = {
		exports: {},
		location: { href: "file:///Users/test/app" },
		require: (id) => {
			if (id === "./RichInput") return { formatFilePathRef: (p) => p };
			return {};
		},
	};
	vm.runInNewContext(outputText, sandbox, { filename: "AppUtils.ts" });
	return sandbox.exports;
}

test("groupToolMessages 不合并连续 assistant 消息：多段回答各自独立、顺序保持", () => {
	const { groupToolMessages } = loadAppUtils();
	const user = { id: "u1", agentId: "a", role: "user", text: "问题", timestamp: 1 };
	const a1 = { id: "a1", agentId: "a", role: "assistant", text: "段1", thinking: "T1", timestamp: 2 };
	const a2 = { id: "a2", agentId: "a", role: "assistant", text: "段2", thinking: "T2", timestamp: 3 };
	const rendered = groupToolMessages([user, a1, a2]);
	const run = rendered.find((item) => item.kind === "agent-run");
	assert.ok(run, "should produce one agent-run");
	const texts = run.items
		.filter((item) => item.kind === "message")
		.map((item) => item.message.text);
	// vm 沙箱跨 realm 的数组与 Node 侧 Array 原型不同，deepEqual 会误判，统一走 JSON 比较
	assert.equal(JSON.stringify(texts), JSON.stringify(["段1", "段2"]));
	// 合并会把 T1/T2 串接到同一条消息上导致思考上移；不合并时各自保留在各自消息里
	assert.equal(run.items[0].message.thinking, "T1");
	assert.equal(run.items[1].message.thinking, "T2");
});
