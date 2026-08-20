import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";
import vm from "node:vm";

function loadBriefBuilder() {
	const source = ts.transpileModule(fs.readFileSync("src/shared/delegationBrief.ts", "utf8"), {
		compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
	}).outputText;
	const module = { exports: {} };
	vm.runInNewContext(source, { module, exports: module.exports }, { filename: "delegationBrief.ts" });
	return module.exports;
}

test("builds a bounded selected-context brief from contract fields only", () => {
	const { buildDelegationBrief, DELEGATION_BRIEF_LIMITS } = loadBriefBuilder();
	const labels = {
		task: "Task",
		selectedContext: "Selected context",
		constraints: "Constraints",
		acceptanceCriteria: "Acceptance criteria",
		relevantFiles: "Relevant files",
		user: "User",
		assistant: "Assistant",
	};
	const brief = buildDelegationBrief({
		task: "Inspect the change",
		selectedContext: [
			{ role: "user", content: "Please inspect this" },
			{ role: "assistant", content: "I will inspect it" },
			{ role: "tool", content: "SECRET_TOOL_OUTPUT" },
		],
		constraints: "Do not edit files",
		acceptanceCriteria: "Explain the result",
		relevantFiles: "src/example.ts",
		transcript: "SECRET_TRANSCRIPT",
	}, labels);
	assert.deepEqual(brief.split("\n\n").map((section) => section.split("\n")[0]), [
		"Task",
		"Selected context",
		"Constraints",
		"Acceptance criteria",
		"Relevant files",
	]);
	assert.match(brief, /\[User\] Please inspect this/);
	assert.match(brief, /\[Assistant\] I will inspect it/);
	assert.equal(brief.includes("SECRET_TOOL_OUTPUT"), false);
	assert.equal(brief.includes("SECRET_TRANSCRIPT"), false);
	assert.match(brief, /Relevant files\nsrc\/example\.ts/);

	const bounded = buildDelegationBrief({
		task: "t".repeat(DELEGATION_BRIEF_LIMITS.task + 20),
		selectedContext: Array.from({ length: DELEGATION_BRIEF_LIMITS.selectedMessages + 4 }, (_, index) => ({
			role: index % 2 === 0 ? "user" : "assistant",
			content: "x".repeat(DELEGATION_BRIEF_LIMITS.selectedMessage + 20),
		})),
		constraints: "c".repeat(DELEGATION_BRIEF_LIMITS.constraints + 20),
		acceptanceCriteria: "a".repeat(DELEGATION_BRIEF_LIMITS.acceptanceCriteria + 20),
	}, labels);
	const boundedSelected = bounded.split("Selected context\n")[1]?.split("\n\nConstraints")[0] ?? "";
	const boundedMessageCount = (boundedSelected.match(/\[(?:User|Assistant)\]/g) ?? []).length;
	assert.ok(boundedMessageCount > 0 && boundedMessageCount <= DELEGATION_BRIEF_LIMITS.selectedMessages);
	assert.ok(boundedSelected.length <= DELEGATION_BRIEF_LIMITS.selectedContext);
	assert.equal(bounded.match(/Task\n(t+)/)?.[1].length, DELEGATION_BRIEF_LIMITS.task);
	assert.equal(bounded.includes("Relevant files"), false);
});
