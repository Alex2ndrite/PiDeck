import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import vm from "node:vm";

/**
 * 会话缓存命中率统计（cacheHitStats）：latest = 最后一条 assistant 消息，
 * average = 全部 assistant 消息的平均（「当前会话平均缓存率」）。
 */

function loadCacheHitStats() {
	const source = readFileSync("src/main/pi/cacheHitStats.ts", "utf8");
	const output = ts.transpileModule(source, {
		compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
		fileName: "cacheHitStats.ts",
	}).outputText;
	const sandbox = { exports: {}, require: () => ({}) };
	vm.runInNewContext(output, sandbox, { filename: "cacheHitStats.ts" });
	return sandbox.exports;
}

/** 构造一条 assistant 消息 JSONL；usage 缺省时不给 usage 字段 */
function assistantLine(overrides = {}) {
	const usage = overrides.usage === undefined
		? { input: 100, cacheRead: 50, cacheWrite: 50 }
		: overrides.usage;
	return JSON.stringify({
		type: "message",
		id: `e${overrides.id ?? 1}`,
		parentId: null,
		timestamp: "2026-08-02T00:00:00.000Z",
		message: {
			role: "assistant",
			content: [{ type: "text", text: "ok" }],
			...(usage ? { usage } : {}),
		},
	});
}

function userLine() {
	return JSON.stringify({
		type: "message",
		id: "u1",
		parentId: null,
		message: { role: "user", content: [{ type: "text", text: "hi" }] },
	});
}

const json = (value) => JSON.stringify(value);

test("computeCacheHitStats: 空文件/无样本返回 undefined", () => {
	const { computeCacheHitStats } = loadCacheHitStats();
	assert.equal(json(computeCacheHitStats("")), json({ latest: undefined, average: undefined, sampleCount: 0 }));
	// 只有 user 消息与无 usage 的 assistant 消息：无样本
	const noUsage = `${userLine()}\n${assistantLine({ usage: null })}\n`;
	assert.equal(json(computeCacheHitStats(noUsage)), json({ latest: undefined, average: undefined, sampleCount: 0 }));
});

test("computeCacheHitStats: 单条消息 latest === average", () => {
	const { computeCacheHitStats } = loadCacheHitStats();
	// cacheRead 50 / (100 + 50 + 50) = 25%
	const stats = computeCacheHitStats(assistantLine());
	assert.equal(stats.sampleCount, 1);
	assert.equal(stats.latest, 25);
	assert.equal(stats.average, 25);
});

test("computeCacheHitStats: 多条消息取平均，latest 取最后一条", () => {
	const { computeCacheHitStats } = loadCacheHitStats();
	const line1 = assistantLine({ id: 1, usage: { input: 100, cacheRead: 100, cacheWrite: 0 } }); // 50%
	const line2 = assistantLine({ id: 2, usage: { input: 100, cacheRead: 0, cacheWrite: 100 } }); // 0%
	const line3 = assistantLine({ id: 3, usage: { input: 100, cacheRead: 75, cacheWrite: 25 } }); // 37.5%
	// 中间夹 user 消息与坏行，不应影响统计
	const raw = [line1, userLine(), "not-json{{{", line2, userLine(), line3].join("\n");
	const stats = computeCacheHitStats(raw);
	assert.equal(stats.sampleCount, 3);
	assert.equal(stats.latest, 37.5);
	assert.equal(stats.average, (50 + 0 + 37.5) / 3);
});

test("computeCacheHitStats: 无有效 token 的 usage 跳过", () => {
	const { computeCacheHitStats } = loadCacheHitStats();
	const raw = [
		assistantLine({ id: 1, usage: { input: 0, cacheRead: 0, cacheWrite: 0 } }),
		assistantLine({ id: 2, usage: { input: 100, cacheRead: 25, cacheWrite: 75 } }), // 12.5%
	].join("\n");
	const stats = computeCacheHitStats(raw);
	assert.equal(stats.sampleCount, 1);
	assert.equal(stats.latest, 12.5);
	assert.equal(stats.average, 12.5);
});

test("hitRateFromUsage: 口径为 cacheRead / (input + cacheRead + cacheWrite)", () => {
	const { hitRateFromUsage } = loadCacheHitStats();
	assert.equal(hitRateFromUsage(undefined), undefined);
	assert.equal(hitRateFromUsage({}), undefined);
	assert.equal(hitRateFromUsage({ input: 100, cacheRead: 50, cacheWrite: 50 }), 25);
});

// ── 类型与接线契约 ──

test("AgentRuntimeState 携带平均命中率与样本数字段", () => {
	const source = readFileSync("src/shared/types/agent.ts", "utf8");
	assert.match(source, /cacheHitAveragePercent\?: number \| null/);
	assert.match(source, /cacheHitSampleCount\?: number/);
});

test("AgentManager getRuntimeState 返回平均命中率（读取会话文件统计）", () => {
	const source = readFileSync("src/main/pi/AgentManager.ts", "utf8");
	assert.match(source, /getSessionCacheHitStats/);
	assert.match(source, /cacheHitAveragePercent/);
	assert.match(source, /cacheHitSampleCount: fileHitStats\.sampleCount/);
	// 旧的「只读最后一条」实现已移除
	assert.doesNotMatch(source, /getLatestCacheMessageHitRate/);
});

test("SessionStatus 优先使用主进程平均，快照历史仅作回退", () => {
	const source = readFileSync("src/renderer/src/components/session/SurfaceComponents.tsx", "utf8");
	assert.match(source, /state\.cacheHitAveragePercent/);
	assert.match(source, /cacheHitSampleCount/);
});
