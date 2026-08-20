import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import ts from "typescript";
import vm from "node:vm";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

function transpile(path) {
	return ts.transpileModule(require("node:fs").readFileSync(path, "utf8"), {
		compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
	}).outputText;
}

function loadStore() {
	const retry = { exports: {} };
	vm.runInNewContext(transpile("src/main/utils/fsRetry.ts"), {
		exports: retry.exports,
		module: retry,
		require: (specifier) => require(specifier),
		setTimeout,
		clearTimeout,
	}, { filename: "fsRetry.ts" });
	const delegationTypes = { exports: {} };
	vm.runInNewContext(transpile("src/shared/types/delegation.ts"), {
		exports: delegationTypes.exports,
		module: delegationTypes,
	}, { filename: "delegation.ts" });
	const store = { exports: {} };
	vm.runInNewContext(transpile("src/main/delegation/DelegationStore.ts"), {
		exports: store.exports,
		module: store,
		require: (specifier) => {
			if (specifier === "../utils/fsRetry") return retry.exports;
			if (specifier === "../../shared/types") return delegationTypes.exports;
			return require(specifier);
		},
	}, { filename: "DelegationStore.ts" });
	return store.exports.DelegationStore;
}

test("DelegationStore persists relation metadata and reloads in a new instance", async () => {
	const DelegationStore = loadStore();
	const dir = await mkdtemp(join(tmpdir(), "pideck-delegation-"));
	const path = join(dir, "delegations.json");
	try {
		const first = new DelegationStore(path);
		await first.load();
		const created = await first.create({
			parentSessionId: "parent",
			childSessionId: "child",
			task: "inspect the repository",
			role: "explore",
			contextMode: "fresh",
			workspace: { mode: "shared", path: "C:/workspace" },
		});
		const second = new DelegationStore(path);
		await second.load();
		assert.deepEqual(second.findByChild("child"), created);
		assert.equal(JSON.parse(await readFile(path, "utf8")).version, 1);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("delegation projection nests child and excludes its runtime from top level", () => {
	const source = transpile("src/renderer/src/agentListDisplay.ts");
	const identity = { exports: {} };
	vm.runInNewContext(transpile("src/shared/sessionIdentity.ts"), { exports: identity.exports, module: identity }, { filename: "sessionIdentity.ts" });
	const display = { exports: {} };
	vm.runInNewContext(source, {
		exports: display.exports,
		module: display,
		require: (specifier) => specifier === "../../shared/sessionIdentity" ? identity.exports : require(specifier),
	}, { filename: "agentListDisplay.ts" });
	const session = (id, filePath) => ({ id, filePath, source: "pi", preview: "", updatedAt: 1, messageCount: 0 });
	const parent = session("parent", "C:/parent.jsonl");
	const child = session("child", "C:/child.jsonl");
	const result = display.exports.getProjectAgentSessionDisplay({
		agents: [{ id: "child-runtime", sessionPath: child.filePath, sessionEnvironment: "native", createdAt: 2, status: "running" }],
		sessions: [parent, child],
		delegations: [{ id: "relation", parentSessionId: parent.id, childSessionId: child.id, task: "inspect", role: "explore", contextMode: "fresh", workspace: { mode: "shared", path: "C:/" }, createdAt: 1 }],
	});
	assert.equal(result.children.length, 1);
	assert.equal(result.children[0].session.id, "parent");
	assert.equal(result.children[0].delegatedChildren[0].summary.id, "child");
	const orphan = display.exports.getProjectAgentSessionDisplay({
		agents: [],
		sessions: [child],
		delegations: [{ id: "relation", parentSessionId: parent.id, childSessionId: child.id, task: "inspect", role: "explore", contextMode: "fresh", workspace: { mode: "shared", path: "C:/workspace" }, createdAt: 1 }],
	});
	assert.equal(orphan.children.length, 1);
	assert.equal(orphan.children[0].type, "session");
	assert.equal(orphan.children[0].session.id, "child");
});
