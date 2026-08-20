import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";

const require = createRequire(import.meta.url);

/**
 * 转译并在当前 realm 内执行 TS 模块（`new Function` 而非 vm 新上下文：跨 realm 原型不同，
 * 会让数组 deepEqual 断言无谓失败）。
 */
function loadModule(path, resolveDependency = () => undefined) {
	const source = ts.transpileModule(fs.readFileSync(path, "utf8"), {
		compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
	}).outputText;
	const module = { exports: {} };
	const factory = new Function("module", "exports", "require", source);
	factory(module, module.exports, (specifier) => resolveDependency(specifier) ?? require(specifier));
	return module.exports;
}

/** 预检模块只依赖 shared/delegationCapability（纯函数），其余 import 都是类型。 */
function loadPreflight() {
	const capability = loadModule("src/shared/delegationCapability.ts");
	return loadModule("src/main/delegation/delegationPreflight.ts", (specifier) =>
		specifier.endsWith("delegationCapability") ? capability : undefined);
}

function project(fields = {}) {
	return {
		id: "project-1",
		name: "project-1",
		path: "C:/workspace/project-1",
		lastOpenedAt: 1,
		environment: "windows",
		...fields,
	};
}

function deps(overrides = {}) {
	return {
		resolveProject: () => project(),
		directoryExists: async () => true,
		checkPiInstalled: async () => ({ installed: true, version: "0.84.2" }),
		listAvailableModels: async () => [{ provider: "deepseek", id: "deepseek-v4-pro" }],
		listAuthenticatedProviders: async () => ["deepseek"],
		isGitRepository: async () => true,
		...overrides,
	};
}

function statusOf(report, id) {
	return report.checks.find((check) => check.id === id)?.status;
}

test("shared workspace fresh explore delegation passes and skips model/provider/worktree", async () => {
	const { runDelegationPreflight } = loadPreflight();
	const report = await runDelegationPreflight({
		parentSessionId: "parent-1",
		projectId: "project-1",
		role: "explore",
		workspaceMode: "shared",
	}, deps());

	assert.equal(report.ok, true);
	assert.equal(statusOf(report, "cwd"), "pass");
	assert.equal(statusOf(report, "pi"), "pass");
	assert.equal(statusOf(report, "model"), "skip");
	assert.equal(statusOf(report, "provider"), "skip");
	assert.equal(statusOf(report, "capability"), "pass");
	assert.equal(statusOf(report, "worktree"), "skip");
});

test("unavailable model fails while missing provider credentials only warns", async () => {
	const { runDelegationPreflight, failedDelegationPreflightIds } = loadPreflight();
	const missingModel = await runDelegationPreflight({
		parentSessionId: "parent-1",
		projectId: "project-1",
		role: "implement",
		model: { provider: "deepseek", modelId: "not-installed" },
	}, deps());
	assert.equal(missingModel.ok, false);
	assert.equal(statusOf(missingModel, "model"), "fail");
	assert.deepEqual(failedDelegationPreflightIds(missingModel), ["model"]);

	const unauthenticated = await runDelegationPreflight({
		parentSessionId: "parent-1",
		projectId: "project-1",
		role: "implement",
		// provider 大小写差异不应影响匹配（pi 侧 provider 名大小写不敏感地由用户配置）。
		model: { provider: "DeepSeek", modelId: "deepseek-v4-pro" },
	}, deps({ listAuthenticatedProviders: async () => [] }));
	assert.equal(unauthenticated.ok, true, "missing credentials must not block: env-var/local providers stay usable");
	assert.equal(statusOf(unauthenticated, "model"), "pass");
	assert.equal(statusOf(unauthenticated, "provider"), "warn");
});

test("missing cwd, missing pi and non-git worktree targets all fail", async () => {
	const { runDelegationPreflight, failedDelegationPreflightIds } = loadPreflight();
	const missingCwd = await runDelegationPreflight({
		parentSessionId: "parent-1",
		projectId: "project-1",
		role: "explore",
	}, deps({ directoryExists: async () => false }));
	assert.equal(statusOf(missingCwd, "cwd"), "fail");
	assert.equal(missingCwd.ok, false);

	const missingPi = await runDelegationPreflight({
		parentSessionId: "parent-1",
		projectId: "project-1",
		role: "explore",
	}, deps({ checkPiInstalled: async () => ({ installed: false, error: "pi not found" }) }));
	assert.equal(statusOf(missingPi, "pi"), "fail");
	assert.equal(missingPi.checks.find((check) => check.id === "pi")?.detail, "pi not found");

	const nonGit = await runDelegationPreflight({
		parentSessionId: "parent-1",
		projectId: "project-1",
		role: "implement",
		workspaceMode: "worktree",
	}, deps({ isGitRepository: async () => false }));
	assert.equal(statusOf(nonGit, "worktree"), "fail");
	assert.deepEqual(failedDelegationPreflightIds(nonGit), ["worktree"]);

	const unknownProject = await runDelegationPreflight({
		parentSessionId: "parent-1",
		projectId: "missing",
		role: "implement",
		workspaceMode: "worktree",
	}, deps({ resolveProject: () => undefined }));
	assert.deepEqual(failedDelegationPreflightIds(unknownProject), ["cwd", "worktree"]);
});

test("dependency errors degrade to failing checks instead of throwing", async () => {
	const { runDelegationPreflight } = loadPreflight();
	const report = await runDelegationPreflight({
		parentSessionId: "parent-1",
		projectId: "project-1",
		role: "implement",
		model: { provider: "deepseek", modelId: "deepseek-v4-pro" },
		workspaceMode: "worktree",
	}, deps({
		directoryExists: async () => { throw new Error("EPERM"); },
		checkPiInstalled: async () => { throw new Error("locator crashed"); },
		listAvailableModels: async () => { throw new Error("pi --list-models failed"); },
		listAuthenticatedProviders: async () => { throw new Error("auth.json unreadable"); },
		isGitRepository: async () => { throw new Error("git missing"); },
	}));

	assert.equal(report.ok, false);
	assert.equal(statusOf(report, "cwd"), "fail");
	assert.equal(statusOf(report, "pi"), "fail");
	assert.equal(statusOf(report, "model"), "fail");
	assert.equal(statusOf(report, "provider"), "warn");
	assert.equal(statusOf(report, "worktree"), "fail");
});
