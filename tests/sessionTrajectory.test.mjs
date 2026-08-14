import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import vm from "node:vm";

function loadModule() {
	const source = readFileSync(
		"src/renderer/src/components/session/trajectory/buildTrajectory.ts",
		"utf8",
	);
	const { outputText } = ts.transpileModule(source, {
		compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
	});
	const sandbox = { exports: {}, module: { exports: {} } };
	sandbox.module.exports = sandbox.exports;
	vm.runInNewContext(outputText, sandbox, { filename: "buildTrajectory.ts" });
	return sandbox.exports;
}

function msg(partial) {
	return {
		id: "m",
		agentId: "a",
		role: "user",
		text: "",
		timestamp: 1,
		...partial,
	};
}

test("user message opens a turn; assistant/tool/thinking belong to it", () => {
	const { buildTrajectory } = loadModule();
	const model = buildTrajectory([
		msg({ id: "u1", role: "user", text: "fix the bug", timestamp: 1000 }),
		msg({
			id: "a1",
			role: "assistant",
			text: "looking",
			thinking: "hmm",
			thinkingStartedAt: 1100,
			thinkingEndedAt: 1400,
			timestamp: 1500,
			stopReason: "toolUse",
		}),
		msg({
			id: "t1",
			role: "tool",
			text: "✓ read",
			timestamp: 1800,
			meta: {
				toolName: "read",
				toolCallId: "c1",
				startedAt: 1600,
				durationMs: 200,
				status: "done",
				detailText: "src/a.ts",
			},
		}),
	]);
	assert.equal(model.turns.length, 1);
	assert.equal(model.records.map((r) => r.kind).join(","), "user,thinking,assistant,tool");
	const tool = model.records.find((r) => r.kind === "tool");
	assert.equal(tool.startedAt, 1600);
	assert.equal(tool.durationMs, 200);
	assert.equal(tool.endedAt, 1800);
	assert.equal(tool.lane, "tools");
	assert.equal(model.records[0].lane, "input");
	assert.equal(model.records[1].lane, "model");
});

test("in-flight tool does not invent duration", () => {
	const { buildTrajectory } = loadModule();
	const model = buildTrajectory(
		[
			msg({ id: "u1", role: "user", text: "go", timestamp: 10 }),
			msg({
				id: "t1",
				role: "tool",
				text: "▶ bash",
				timestamp: 20,
				meta: { toolName: "bash", startedAt: 15, status: "running" },
			}),
		],
		100,
	);
	const tool = model.records.find((r) => r.kind === "tool");
	assert.equal(tool.endedAt, undefined);
	assert.equal(tool.durationMs, undefined);
	assert.equal(model.turns[0].inFlight, true);
	assert.ok(model.domainEnd >= 100);
});

test("filterRecordsByRange keeps overlapping spans only", () => {
	const { filterRecordsByRange } = loadModule();
	const records = [
		{ id: "a", startedAt: 0, endedAt: 10 },
		{ id: "b", startedAt: 20, endedAt: 30 },
		{ id: "c", startedAt: 25, endedAt: undefined },
	];
	const hit = filterRecordsByRange(records, { start: 22, end: 28 }).map((r) => r.id);
	assert.equal(JSON.stringify(hit), JSON.stringify(["b", "c"]));
});

test("session chrome wires a chat/trajectory view switch", () => {
	const sessionView = readFileSync("src/renderer/src/components/session/SessionView.tsx", "utf8");
	const stage = readFileSync("src/renderer/src/components/session/SessionSurfaceStage.tsx", "utf8");
	const header = readFileSync("src/renderer/src/components/session/SessionHeader.tsx", "utf8");
	assert.match(sessionView, /SessionSurfaceStage/);
	assert.match(sessionView, /sessionSurfaceViewByIdAtomFamily/);
	assert.match(stage, /SessionTrajectoryView/);
	assert.match(header, /trajectory/);
	assert.match(header, /session.view.trajectory/);
});
