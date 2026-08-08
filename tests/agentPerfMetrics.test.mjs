import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// 最近一次回复的性能指标（TTFT/总耗时/TPS）由主进程 AgentManager 在流式事件上本地计时，
// 经 AgentRuntimeState 下发，渲染层在 ctx.detail 面板展示。pi 不暴露任何耗时字段，
// 因此这三个指标完全由 PiDeck 计算——此处静态断言计算与展示链路完整。

test("AgentManager keeps per-agent streaming perf timers", () => {
	const source = readFileSync("src/main/pi/AgentManager.ts", "utf8");
	// 计时状态：message_start 起表，首个 delta 记 firstDeltaAt
	assert.match(source, /messagePerfByAgent = new Map<\s*\n\s*string,\s*\n\s*\{ startedAt: number; firstDeltaAt: number \}\s*\n\s*>\(\)/);
	assert.match(source, /lastPerfByAgent = new Map<\s*\n\s*string,\s*\n\s*\{ ttftMs\?: number; totalMs: number; tps\?: number; at: number \}\s*\n\s*>\(\)/);
});

test("AgentManager starts the perf timer on message_start", () => {
	const source = readFileSync("src/main/pi/AgentManager.ts", "utf8");
	assert.match(source, /eventType === "start" \|\| eventType === "message_start"/);
	assert.match(source, /messagePerfByAgent\.set\(agentId, \{ startedAt: Date\.now\(\), firstDeltaAt: 0 \}\)/);
});

test("first content delta (text or thinking) stamps firstDeltaAt once", () => {
	const source = readFileSync("src/main/pi/AgentManager.ts", "utf8");
	// 首 token 判定：text_delta 与 thinking_delta 都算（用户最先感知到的是二者之一）
	assert.match(source, /markFirstDelta\(agentId\);/);
	const markFirstDeltaBody = source.slice(source.indexOf("private markFirstDelta"), source.indexOf("private settleMessagePerf"));
	assert.match(markFirstDeltaBody, /if \(perf && perf\.firstDeltaAt === 0\)/);
	assert.match(markFirstDeltaBody, /perf\.firstDeltaAt = Date\.now\(\);/);
});

test("message_end/done/error settles perf and pushes a runtime-state patch", () => {
	const source = readFileSync("src/main/pi/AgentManager.ts", "utf8");
	// 终态分支第一行结算性能指标
	assert.match(source, /eventType === "message_end" \|\| eventType === "done" \|\| eventType === "error"/);
	assert.match(source, /this\.settleMessagePerf\(agentId, partialMessage\);/);
	// 结算口径：ttft = 首 delta − message_start；total = 终态 − message_start；
	// tps = output tokens ÷ 生成期（首 delta → 终态），分母排除 TTFT 更贴近真实生成速度
	const settle = source.slice(source.indexOf("private settleMessagePerf"), source.indexOf("private ensureThinkingSegment"));
	assert.match(settle, /const totalMs = now - perf\.startedAt;/);
	assert.match(settle, /const ttftMs =/);
	assert.match(settle, /outputTokens \/ \(\(now - perf\.firstDeltaAt\) \/ 1000\)/);
	// 结算结果本地缓存 + 边沿推送（不触发 get_state/get_session_stats RPC）
	assert.match(settle, /lastPerfByAgent\.set\(agentId, \{ ttftMs, totalMs, tps, at: now \}\)/);
	assert.match(settle, /state: \{ ttftMs, totalMs, tps, perfAt: now \}/);
});

test("getRuntimeState merges last perf metrics", () => {
	const source = readFileSync("src/main/pi/AgentManager.ts", "utf8");
	assert.match(source, /const perf = this\.lastPerfByAgent\.get\(agentId\);/);
	assert.match(source, /ttftMs: perf\?\.ttftMs,/);
	assert.match(source, /totalMs: perf\?\.totalMs,/);
	assert.match(source, /tps: perf\?\.tps,/);
	assert.match(source, /perfAt: perf\?\.at,/);
});

test("AgentRuntimeState carries perf fields", () => {
	const source = readFileSync("src/shared/types/agent.ts", "utf8");
	for (const field of ["ttftMs?: number", "totalMs?: number", "tps?: number", "perfAt?: number"]) {
		assert.match(source, new RegExp(field.replace("?", "\\?")), `missing ${field}`);
	}
});

test("ctx.detail shows TTFT / total time / speed with i18n labels", () => {
	const surface = readFileSync("src/renderer/src/components/session/SurfaceComponents.tsx", "utf8");
	assert.match(surface, /state\.ttftMs != null/);
	assert.match(surface, /state\.totalMs != null/);
	assert.match(surface, /state\.tps != null/);
	assert.match(surface, /t\("ctx\.detail\.ttft"\), value: formatDuration\(state\.ttftMs\)/);
	assert.match(surface, /t\("ctx\.detail\.total"\), value: formatDuration\(state\.totalMs\)/);
	assert.match(surface, /t\("ctx\.detail\.tps"\), value: `\$\{state\.tps\.toFixed\(0\)\} tok\/s`/);
});

test("perf i18n keys exist in zh-CN and en-US", () => {
	const zh = readFileSync("src/renderer/src/i18n/rendererCopy.zh-CN.ts", "utf8");
	const en = readFileSync("src/renderer/src/i18n/rendererCopy.en-US.ts", "utf8");
	for (const key of ["ctx.detail.ttft", "ctx.detail.total", "ctx.detail.tps"]) {
		assert.match(zh, new RegExp(`"${key}":`), `zh-CN missing ${key}`);
		assert.match(en, new RegExp(`"${key}":`), `en-US missing ${key}`);
	}
});
