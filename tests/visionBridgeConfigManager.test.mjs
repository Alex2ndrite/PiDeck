/**
 * VisionBridgeConfigManager（主进程）单测。
 *
 * 覆盖：白名单校验（provider/model 必填、api 枚举、baseUrl 协议、数值范围）、
 * 文件读写（PIDECK_VISION_CONFIG_DIR 覆盖目录）、getState 供应商列表组装。
 * 与扩展测试 tests/visionBridgeExtension.test.mjs 共用同一套配置契约。
 */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { join } from "node:path";
import test from "node:test";
import ts from "typescript";
import vm from "node:vm";

const require = createRequire(import.meta.url);

const MODULE_PATH = "src/main/settings/visionBridgeConfig.ts";

function compile(filePath) {
	const source = readFileSync(filePath, "utf8");
	const output = ts.transpileModule(source, {
		compilerOptions: {
			module: ts.ModuleKind.CommonJS,
			target: ts.ScriptTarget.ES2022,
			esModuleInterop: true,
		},
		fileName: filePath,
	}).outputText;
	const module = { exports: {} };
	const localRequire = (specifier) => {
		if (specifier.startsWith("node:")) return require(specifier);
		return {};
	};
	vm.runInNewContext(output, {
		module,
		exports: module.exports,
		require: localRequire,
		console,
		process,
	}, { filename: filePath });
	return module.exports;
}

const mod = compile(MODULE_PATH);
const { VisionBridgeConfigManager } = mod;

/** 在临时目录下创建 manager（PIDECK_VISION_CONFIG_DIR 指向该目录）。 */
function makeManager(modelsProviders = {}) {
	const dir = mkdtempSync(join(tmpdir(), "vision-mgr-"));
	process.env.PIDECK_VISION_CONFIG_DIR = dir;
	const configManager = {
		getModelsConfig: async () => ({
			raw: "{}",
			parsed: { providers: modelsProviders },
			diagnostic: undefined,
		}),
	};
	return { dir, manager: new VisionBridgeConfigManager(configManager) };
}

test("saveConfig: writes sanitized config to file", async () => {
	const { dir, manager } = makeManager();
	const result = await manager.saveConfig({
		enabled: true,
		provider: "glm",
		model: "glm-4v-flash",
		baseUrl: "https://open.bigmodel.cn/api/paas/v4",
		apiKey: "sk-test",
		maxTokens: 2048,
		concurrency: 3,
	});
	assert.equal(result.ok, true);
	assert.equal(result.error, undefined);
	const saved = JSON.parse(readFileSync(join(dir, "pi-deck-vision.json"), "utf8"));
	assert.equal(saved.provider, "glm");
	assert.equal(saved.model, "glm-4v-flash");
	assert.equal(saved.baseUrl, "https://open.bigmodel.cn/api/paas/v4");
	assert.equal(saved.apiKey, "sk-test");
	assert.equal(saved.maxTokens, 2048);
	assert.equal(saved.concurrency, 3);
	assert.equal(saved.enabled, true);
	rmSync(dir, { recursive: true, force: true });
});

test("saveConfig: rejects missing provider/model", async () => {
	const { dir, manager } = makeManager();
	const result = await manager.saveConfig({ provider: "", model: "" });
	assert.equal(result.ok, false);
	assert.ok(result.error);
	rmSync(dir, { recursive: true, force: true });
});

test("saveConfig: rejects non-object input", async () => {
	const { dir, manager } = makeManager();
	assert.equal((await manager.saveConfig(null)).ok, false);
	assert.equal((await manager.saveConfig("str")).ok, false);
	assert.equal((await manager.saveConfig(42)).ok, false);
	rmSync(dir, { recursive: true, force: true });
});

test("saveConfig: drops invalid api enum and non-http baseUrl", async () => {
	const { dir, manager } = makeManager();
	const result = await manager.saveConfig({
		provider: "p",
		model: "m",
		api: "file://evil",
		baseUrl: "javascript:alert(1)",
	});
	assert.equal(result.ok, true);
	const saved = JSON.parse(readFileSync(join(dir, "pi-deck-vision.json"), "utf8"));
	assert.equal(saved.api, undefined, "非法 api 枚举不写入");
	assert.equal(saved.baseUrl, undefined, "非 http(s) baseUrl 不写入");
	rmSync(dir, { recursive: true, force: true });
});

test("saveConfig: clamps numeric fields to sane ranges", async () => {
	const { dir, manager } = makeManager();
	await manager.saveConfig({
		provider: "p",
		model: "m",
		maxTokens: 999999999,
		timeoutMs: -5,
		concurrency: 0,
	});
	const saved = JSON.parse(readFileSync(join(dir, "pi-deck-vision.json"), "utf8"));
	assert.equal(saved.maxTokens, undefined, "超上限数值不写入");
	assert.equal(saved.timeoutMs, undefined, "负数不写入");
	assert.equal(saved.concurrency, undefined, "0 不写入");
	rmSync(dir, { recursive: true, force: true });
});

test("getConfig: missing file returns null, invalid json returns null", async () => {
	const { dir, manager } = makeManager();
	assert.equal(await manager.getConfig(), null);
	writeFileSync(join(dir, "pi-deck-vision.json"), "{ broken", "utf8");
	assert.equal(await manager.getConfig(), null);
	rmSync(dir, { recursive: true, force: true });
});

test("getConfig: reads back what saveConfig wrote", async () => {
	const { dir, manager } = makeManager();
	await manager.saveConfig({ provider: "openai", model: "gpt-4o-mini", apiKey: "sk-1" });
	const config = await manager.getConfig();
	assert.equal(config.provider, "openai");
	assert.equal(config.model, "gpt-4o-mini");
	assert.equal(config.apiKey, "sk-1");
	rmSync(dir, { recursive: true, force: true });
});

test("getState: returns config + configDir (models list comes from listModels in UI)", async () => {
	const { dir, manager } = makeManager();
	const state = await manager.getState();
	assert.equal(state.configDir, dir);
	assert.equal(state.config, null);
	assert.equal(state.providers, undefined, "providers 字段已移除，模型列表由 UI 经 listModels 拉全量");
	assert.equal("providers" in state, false);
	rmSync(dir, { recursive: true, force: true });
});
