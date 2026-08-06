import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import vm from "node:vm";
import { buildTurnSegments } from "../src/renderer/src/components/session/TimelineFormat.ts";

/**
 * 一轮回答（agent-run）时序分段测试。
 *
 * 修复背景：TurnRow 曾把「最后一条 assistant 消息」抽离时序、固定渲染到底部，
 * 并把它的思考 append 到分段末尾。流式期间或中断的 run 里，这条消息后往往还有
 * 工具/思考，导致尾部工具/思考被渲染到回答上方、思考块上下颠倒。
 * buildTurnSegments 必须严格按 run.items 时序拆段，不允许重排。
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

/** 提取分段概要：[kind, 首条内容]，便于断言顺序 */
function outline(segments) {
	return segments.map((segment) => {
		if (segment.kind === "text") return `text:${segment.message.text}`;
		return `process:[${segment.items
			.map((item) => (item.kind === "thinking-group" ? `think:${item.text}` : "tool"))
			.join(",")}]`;
	});
}

test("流式中间态：尾部工具/思考保持在回答之后，回答不被拽到底部", () => {
	// 真实时序：思考T1 → 回答段1 → 工具 → 思考T2（还在进行，run 未结束）
	const run = runOf([
		{ kind: "message", message: assistantMessage("段1", "T1") },
		toolGroup(),
		thinkingGroup("T2"),
	]);
	const segments = buildTurnSegments(run, { showThinking: true });
	assert.deepEqual(outline(segments), [
		"process:[think:T1]",
		"text:段1",
		"process:[tool,think:T2]",
	]);
	// 段1 是本轮最后一条回答，标记 isFinal 但位置不动
	assert.equal(segments[1].kind === "text" && segments[1].isFinal, true);
});

test("中断的 run（回答后还有工具调用）：回答保持在原位", () => {
	const run = runOf([
		{ kind: "message", message: assistantMessage("段1") },
		toolGroup(),
	]);
	const segments = buildTurnSegments(run, { showThinking: true });
	assert.deepEqual(outline(segments), ["text:段1", "process:[tool]"]);
});

test("多段回答：每条回答自带的思考插入到各自文本之前，不丢弃、不上移", () => {
	// 真实时序：T1 → 段1 → 工具 → T2 → 段2
	const run = runOf([
		{ kind: "message", message: assistantMessage("段1", "T1") },
		toolGroup(),
		{ kind: "message", message: assistantMessage("段2", "T2") },
	]);
	const segments = buildTurnSegments(run, { showThinking: true });
	assert.deepEqual(outline(segments), [
		"process:[think:T1]",
		"text:段1",
		"process:[tool,think:T2]",
		"text:段2",
	]);
	assert.equal(segments[1].kind === "text" && segments[1].isFinal, false);
	assert.equal(segments[3].kind === "text" && segments[3].isFinal, true);
});

test("相邻多段回答（中间无工具）：分段平铺且各自思考保持「思考→回答」时序", () => {
	const run = runOf([
		{ kind: "message", message: assistantMessage("段1", "T1") },
		{ kind: "message", message: assistantMessage("段2", "T2") },
	]);
	const segments = buildTurnSegments(run, { showThinking: true });
	assert.deepEqual(outline(segments), [
		"process:[think:T1]",
		"text:段1",
		"process:[think:T2]",
		"text:段2",
	]);
});

test("完整轮次：最终回答的思考并入其前的过程段尾部", () => {
	const run = runOf([
		thinkingGroup("T1"),
		toolGroup(),
		{ kind: "message", message: assistantMessage("回答", "T2") },
	]);
	const segments = buildTurnSegments(run, { showThinking: true });
	assert.deepEqual(outline(segments), [
		"process:[think:T1,tool,think:T2]",
		"text:回答",
	]);
});

test("showThinking 关闭时不从消息展开思考块，但已有 thinking-group 仍保留在过程段", () => {
	const run = runOf([
		thinkingGroup("T1"),
		{ kind: "message", message: assistantMessage("段1", "T2") },
	]);
	const segments = buildTurnSegments(run, { showThinking: false });
	assert.deepEqual(outline(segments), ["process:[think:T1]", "text:段1"]);
});

test("无 assistant 消息的 run：全部归入过程段", () => {
	const run = runOf([thinkingGroup("T1"), toolGroup()]);
	const segments = buildTurnSegments(run, { showThinking: true });
	assert.deepEqual(outline(segments), ["process:[think:T1,tool]"]);
});

test("分段的过程条目使用稳定 id（流式重渲染不重置展开状态）", () => {
	const message = assistantMessage("段1", "T1");
	const run = runOf([{ kind: "message", message }]);
	const first = buildTurnSegments(run, { showThinking: true });
	const second = buildTurnSegments(run, { showThinking: true });
	const firstThinking = first[0];
	const secondThinking = second[0];
	assert.equal(firstThinking.kind, "process");
	assert.equal(secondThinking.kind, "process");
	assert.equal(firstThinking.items[0].id, secondThinking.items[0].id);
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
