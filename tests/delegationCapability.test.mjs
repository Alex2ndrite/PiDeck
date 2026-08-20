import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";

const require = createRequire(import.meta.url);

/**
 * 按 CommonJS 转译单个 TS 模块并在当前 realm 内执行（`new Function` 而非 vm 新上下文：
 * 跨 realm 的数组/对象原型不同，会让 deepEqual 断言无谓失败）。
 * shared 依赖以内存替身注入，避免拉起整棵 import 图。
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

function loadSharedCapability() {
	return loadModule("src/shared/delegationCapability.ts");
}

function loadMainCapability() {
	const shared = loadSharedCapability();
	return loadModule("src/main/delegation/delegationCapability.ts", (specifier) =>
		specifier.endsWith("delegationCapability") ? shared : undefined);
}

test("read-only roles resolve to a non-writable pi tool allowlist without mutating tools", () => {
	const {
		resolveDelegationCapabilityProfile,
		resolveDelegationToolAllowlistForRole,
		isDelegationToolAllowlistSafe,
		PI_MUTATING_TOOLS,
	} = loadSharedCapability();

	for (const role of ["explore", "review", "consult"]) {
		const profile = resolveDelegationCapabilityProfile(role);
		assert.equal(profile.writable, false);
		assert.equal(isDelegationToolAllowlistSafe(profile.allowedTools), true);
		for (const mutating of PI_MUTATING_TOOLS) {
			assert.equal(profile.allowedTools.includes(mutating), false, `${role} must not allow ${mutating}`);
		}
		// 只读档必须真的下发白名单，否则 pi 会继承默认（可写）工具集。
		assert.deepEqual(resolveDelegationToolAllowlistForRole(role), profile.allowedTools);
		assert.ok(profile.allowedTools.includes("read"));
		assert.ok(profile.allowedTools.includes("grep"));
	}
});

test("implement role stays writer and never sends an allowlist", () => {
	const { resolveDelegationCapabilityProfile, resolveDelegationToolAllowlistForRole } = loadSharedCapability();
	const profile = resolveDelegationCapabilityProfile("implement");
	assert.equal(profile.writable, true);
	assert.deepEqual(profile.allowedTools, []);
	// undefined = 不下发 --tools；空数组会让 pi 关掉全部工具，属于误用。
	assert.equal(resolveDelegationToolAllowlistForRole("implement"), undefined);
});

test("allowlist safety check rejects unknown or mutating tool names", () => {
	const { isDelegationToolAllowlistSafe } = loadSharedCapability();
	assert.equal(isDelegationToolAllowlistSafe(["read", "grep"]), true);
	assert.equal(isDelegationToolAllowlistSafe(["read", "write"]), false);
	assert.equal(isDelegationToolAllowlistSafe(["read", "totally_unknown_tool"]), false);
});

test("spawn-time resolver maps child sessions to their role profile and stays fail-open", () => {
	const { resolveDelegationToolAllowlist } = loadMainCapability();
	const relations = new Map([
		["child-explore", { childSessionId: "child-explore", role: "explore" }],
		["child-implement", { childSessionId: "child-implement", role: "implement" }],
	]);
	const store = { findByChild: (id) => relations.get(id) };

	assert.ok(resolveDelegationToolAllowlist(store, "child-explore")?.includes("read"));
	assert.equal(resolveDelegationToolAllowlist(store, "child-explore")?.includes("write"), false);
	// writer child 与普通会话一样不受限制。
	assert.equal(resolveDelegationToolAllowlist(store, "child-implement"), undefined);
	assert.equal(resolveDelegationToolAllowlist(store, "not-a-child"), undefined);
	assert.equal(resolveDelegationToolAllowlist(undefined, "child-explore"), undefined);
	assert.equal(resolveDelegationToolAllowlist(store, undefined), undefined);
	// store 未 load（启动早期）时抛错不得阻断会话启动。
	const throwingStore = { findByChild: () => { throw new Error("DelegationStore.load() must complete before use"); } };
	assert.equal(resolveDelegationToolAllowlist(throwingStore, "child-explore"), undefined);
});
