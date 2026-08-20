import assert from "node:assert/strict";
import test from "node:test";
import ts from "typescript";
import vm from "node:vm";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

function loadManager() {
	const module = { exports: {} };
	const source = ts.transpileModule(
		require("node:fs").readFileSync("src/main/delegation/DelegationWorktreeManager.ts", "utf8"),
		{
			compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
		},
	).outputText;
	vm.runInNewContext(source, {
		exports: module.exports,
		module,
		require: (specifier) => require(specifier),
	}, { filename: "DelegationWorktreeManager.ts" });
	return module.exports.DelegationWorktreeManager;
}

function project(id, fields = {}) {
	return {
		id,
		name: id,
		path: `C:/workspace/${id}`,
		lastOpenedAt: 1,
		environment: "windows",
		...fields,
	};
}

class FakeProjectStore {
	constructor(initial) {
		this.projects = new Map(initial.map((entry) => [entry.id, entry]));
		this.added = [];
		this.removed = [];
		this.enabled = [];
		this.failAdd = false;
	}

	get(id) {
		return this.projects.get(id);
	}

	async add(path, worktreeParentId, environment) {
		if (this.failAdd) throw new Error("register failed");
		const child = project(`child-${this.added.length + 1}`, { path, worktreeParentId, environment });
		this.projects.set(child.id, child);
		this.added.push(child);
		return child;
	}

	async remove(id) {
		this.removed.push(id);
		this.projects.delete(id);
	}

	async setWorktreeEnabled(id, enabled) {
		const root = this.projects.get(id);
		if (!root) return null;
		root.worktreeEnabled = enabled;
		this.enabled.push({ id, enabled });
		return root;
	}
}

test("worktree creation registers and enables the root, including sibling creation", async () => {
	const DelegationWorktreeManager = loadManager();
	const root = project("root");
	const store = new FakeProjectStore([root]);
	const creates = [];
	const worktree = {
		create: async (projectPath, projectId, branch) => {
			creates.push({ projectPath, projectId, branch });
			return { path: `C:/worktrees/${creates.length}`, branch };
		},
		remove: async () => true,
	};
	const manager = new DelegationWorktreeManager(worktree, store, () => "delegate-12345678");

	const first = await manager.create(root);
	const second = await manager.create(first.childProject);

	assert.equal(creates[0].projectPath, root.path);
	assert.equal(creates[0].projectId, root.id);
	assert.equal(creates[0].branch, "delegation-implement-delegate");
	assert.equal(creates[1].projectPath, root.path);
	assert.equal(creates[1].projectId, root.id);
	assert.equal(first.childProject.worktreeParentId, root.id);
	assert.equal(second.childProject.worktreeParentId, root.id);
	assert.deepEqual(store.enabled, [{ id: root.id, enabled: true }]);
});

test("registration failure rolls back, while a failed physical remove preserves the project record", async () => {
	const DelegationWorktreeManager = loadManager();
	const root = project("root");
	const store = new FakeProjectStore([root]);
	store.failAdd = true;
	let removeCalls = 0;
	const worktree = {
		create: async () => ({ path: "C:/worktrees/failing", branch: "delegation-implement-failing" }),
		remove: async () => { removeCalls += 1; return true; },
	};
	const manager = new DelegationWorktreeManager(worktree, store, () => "failure");

	await assert.rejects(() => manager.create(root), /register failed/);
	assert.equal(removeCalls, 1);
	assert.deepEqual(store.removed, []);

	const child = project("child", { worktreeParentId: root.id });
	store.projects.set(child.id, child);
	const failedRemoveManager = new DelegationWorktreeManager({
		create: worktree.create,
		remove: async () => false,
	}, store, () => "failure");
	const removed = await failedRemoveManager.rollback({ rootProject: root, childProject: child, path: child.path, branch: "delegation-implement-failing" });

	assert.equal(removed, false);
	assert.equal(store.projects.get(child.id), child);
	assert.deepEqual(store.removed, []);
});
