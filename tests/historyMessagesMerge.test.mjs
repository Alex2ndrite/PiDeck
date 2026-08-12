import assert from "node:assert/strict";
import test from "node:test";
import { loadTsCommonJs } from "./helpers/loadTsCommonJs.mjs";

const { mergeHistoryWithPreservedMessages } = loadTsCommonJs(
	"src/main/pi/historyMessages.ts",
);

/**
 * 双份回归（issue：中间回复在上一轮/下一轮都显现）复现测试。
 *
 * 背景：attach 打开大会话时后台 loadMessages 与用户发送/模型流式竞态——
 * get_messages 返回的投影消息（id=agentId-history-{entryId}）与运行期事件消息
 * （id=randomUUID）是「同一条 pi 消息的两个副本」，旧 merge 只按 ChatMessage.id
 * 去重（两者永不相同）→ 同一条消息双份进入渲染层，被用户消息切分到上下两个 run。
 *
 * 修复语义：preserved（加载期间新增）消息与投影历史按「内容指纹」一一匹配，
 * 匹配上的丢弃运行期副本（以投影为准：位置正确、带 entryId）；未匹配的保留
 * （真正未落盘的进行中消息，等待后续事件继续 upsert）。
 */

let seq = 0;
function runId() {
	seq += 1;
	return `run-${seq}`;
}

/** 投影身份消息（id = agentId-history-entryId，meta.entryId 存在）。 */
function projectedMessage(text, entryId, role = "assistant", extra = {}) {
	return {
		id: `agent-1-history-${entryId}`,
		agentId: "agent-1",
		role,
		text,
		timestamp: 1_000_000,
		meta: { entryId, _piDeckMsgSeq: 1 },
		...extra,
	};
}

/** 运行期身份消息（id = randomUUID 形态，无 entryId），与投影版同内容。 */
function runtimeMessage(text, role = "assistant", extra = {}) {
	return {
		id: runId(),
		agentId: "agent-1",
		role,
		text,
		timestamp: 2_000_000,
		...extra,
	};
}

/** 带自定义时间戳的运行期消息（preserveMessagesAfter 边界测试用）。 */
function runtimeMessageAt(text, timestamp, role = "user", extra = {}) {
	return { ...runtimeMessage(text, role, extra), timestamp };
}

test("投影与运行期同一条消息双份：merge 后只保留投影版（修复前双份）", () => {
	// attach 后用户发消息 Q、模型流式中间回复 A，期间 get_messages 返回时两者已落盘：
	// 投影含 Q'/A'，运行期含 Q/A → 旧逻辑双份，新逻辑以投影为准去重。
	const history = [
		projectedMessage("画一只猫", "e1", "user"),
		projectedMessage("好的，我来画", "e2"),
	];
	const current = [
		runtimeMessage("画一只猫", "user"),
		runtimeMessage("好的，我来画"),
	];
	const merged = mergeHistoryWithPreservedMessages(history, current, 1_500_000);
	assert.equal(merged.length, 2, "同一条 pi 消息不得出现两份");
	assert.deepEqual(
		merged.map((m) => m.id),
		["agent-1-history-e1", "agent-1-history-e2"],
		"保留投影版（带 entryId）而非运行期副本",
	);
});

test("投影里没有的进行中消息（未落盘）必须保留", () => {
	// 流式中间回复 B 尚未落盘：投影只有 Q'/A'，运行期有 Q/A/B → 保留 B 在尾部
	const history = [
		projectedMessage("画一只猫", "e1", "user"),
		projectedMessage("好的，我来画", "e2"),
	];
	const current = [
		runtimeMessage("画一只猫", "user"),
		runtimeMessage("好的，我来画"),
		runtimeMessage("正在生成图片，请稍候…"),
	];
	const merged = mergeHistoryWithPreservedMessages(history, current, 1_500_000);
	assert.equal(merged.length, 3);
	assert.equal(merged[2].id, current[2].id, "未落盘的进行中消息保留运行期身份");
	assert.equal(merged[2].text, "正在生成图片，请稍候…");
});

test("用户连发两条相同文本：指纹一一消耗，不误删", () => {
	// 用户连发两条「继续」都落盘：投影 2 条、运行期 2 条 → 全部以投影为准，不残留
	const history = [
		projectedMessage("继续", "e1", "user"),
		projectedMessage("继续", "e2", "user"),
	];
	const current = [
		runtimeMessage("继续", "user"),
		runtimeMessage("继续", "user"),
	];
	const merged = mergeHistoryWithPreservedMessages(history, current, 1_500_000);
	assert.equal(merged.length, 2);
	assert.deepEqual(
		merged.map((m) => m.id),
		["agent-1-history-e1", "agent-1-history-e2"],
	);
});

test("tool 消息按 toolCallId 指纹匹配（text 随状态变化不可靠）", () => {
	// 运行期 tool 消息 text 带 ▶/✓ 前缀，投影带 ✓/✗ 前缀，文本不一致；
	// 但两者 meta.toolCallId 同源（pi 的 toolCallId）→ 必须按 toolCallId 去重。
	const history = [
		projectedMessage("✓ image_gen", "e1", "tool", {
			meta: { entryId: "e1", toolCallId: "tc-1" },
		}),
	];
	const current = [
		runtimeMessage("▶ image_gen", "tool", {
			meta: { toolCallId: "tc-1", status: "running" },
		}),
	];
	const merged = mergeHistoryWithPreservedMessages(history, current, 1_500_000);
	assert.equal(merged.length, 1);
	assert.equal(merged[0].meta.entryId, "e1");
});

test("带图片的用户消息：指纹含图片签名，同图去重、异图保留", () => {
	const img = (data) => [{ type: "image", mimeType: "image/png", data }];
	const history = [
		projectedMessage("", "e1", "user", { images: img("AAAA") }),
	];
	// 同图运行期副本 → 去重
	const same = mergeHistoryWithPreservedMessages(
		history,
		[runtimeMessage("", "user", { images: img("AAAA") })],
		1_500_000,
	);
	assert.equal(same.length, 1);
	// 异图（不同内容）→ 保留（投影没有对应消息）
	const diff = mergeHistoryWithPreservedMessages(
		history,
		[runtimeMessage("", "user", { images: img("BBBB") })],
		1_500_000,
	);
	assert.equal(diff.length, 2);
});

test("preserveMessagesAfter 之前的消息不受影响（原语义保留）", () => {
	const history = [projectedMessage("历史问题", "e1", "user")];
	const current = [
		runtimeMessageAt("历史问题", 2_000_000, "user"), // ts < preserveMessagesAfter → 不参与保护
		runtimeMessageAt("新消息", 3_000_000, "user"), // ts >= → 保留
	];
	const merged = mergeHistoryWithPreservedMessages(history, current, 2_500_000);
	assert.equal(merged.length, 2);
	assert.equal(merged[1].text, "新消息");
});

test("无 preserveMessagesAfter：直接返回投影（替换语义不变）", () => {
	const history = [projectedMessage("h", "e1", "user")];
	const current = [runtimeMessage("c", "user")];
	const merged = mergeHistoryWithPreservedMessages(history, current);
	assert.equal(merged.length, 1);
	assert.equal(merged[0].id, "agent-1-history-e1");
});
