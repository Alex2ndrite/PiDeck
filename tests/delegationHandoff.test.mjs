import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import vm from "node:vm";

function loadFormatter() {
	const source = ts.transpileModule(fs.readFileSync("src/shared/delegationHandoff.ts", "utf8"), {
		compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
	}).outputText;
	const module = { exports: {} };
	vm.runInNewContext(source, { module, exports: module.exports }, { filename: "delegationHandoff.ts" });
	return module.exports;
}

test("formats a bounded explicit handoff without transcript content", () => {
	const { formatDelegationHandoff, DELEGATION_HANDOFF_LIMITS } = loadFormatter();
	const labels = {
		title: "Handoff",
		task: "Task",
		result: "Result",
		changedFiles: "Changed files",
		validation: "Validation",
		childSession: "Child session",
	};
	const required = formatDelegationHandoff({ task: "Do it", result: "Done", changedFiles: "   ", validation: "" }, "child-123", labels);
	assert.equal(required, "Handoff\n\nTask:\nDo it\n\nResult:\nDone\n\nChild session:\nchild-123");
	assert.equal(required.includes("Changed files"), false);
	assert.equal(required.includes("Validation"), false);
	const full = formatDelegationHandoff({ task: "Do it", result: "Done", changedFiles: "a.ts", validation: "typecheck", transcript: "SECRET_TRANSCRIPT" }, "child-123", labels);
	assert.match(full, /Changed files:\na\.ts/);
	assert.match(full, /Validation:\ntypecheck/);
	assert.equal(full.includes("SECRET_TRANSCRIPT"), false);
	const bounded = formatDelegationHandoff({
		task: "t".repeat(DELEGATION_HANDOFF_LIMITS.task + 10),
		result: "r".repeat(DELEGATION_HANDOFF_LIMITS.result + 10),
	}, "c".repeat(DELEGATION_HANDOFF_LIMITS.childSessionId + 10), labels);
	assert.equal(bounded.match(/Task:\n(t+)/)?.[1].length, DELEGATION_HANDOFF_LIMITS.task);
	assert.equal(bounded.match(/Result:\n(r+)/)?.[1].length, DELEGATION_HANDOFF_LIMITS.result);
	assert.equal(bounded.match(/Child session:\n(c+)/)?.[1].length, DELEGATION_HANDOFF_LIMITS.childSessionId);
});
