/**
 * 模型规格存储测试（ModelSpecsStore / modelSpecsIndex / 内置 db 集成）。
 *
 * 覆盖：
 * - modelSpecsIndex 纯函数：stripProviderPrefix、lookupModelSpec 的匹配链
 *   （openrouter 前缀/完整 id/尾段、models.dev 裸 id、双源合并、未命中）
 * - entriesFromRows：db 行 → 双源条目（JSON 模态解析、损坏行跳过）
 * - 集成：真实 resources/model-specs.db（sync-model-specs.mjs 产物，随 repo 提交）
 *   → sql.js 读库 → 索引 → 真实模型命中（不绑定具体数值，发版同步会更新数据）
 */

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";
import ts from "typescript";
import vm from "node:vm";

const nodeRequire = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

function compileModule(filePath, imports = {}) {
	const source = readFileSync(filePath, "utf8");
	const output = ts.transpileModule(source, {
		compilerOptions: {
			module: ts.ModuleKind.CommonJS,
			target: ts.ScriptTarget.ES2022,
		},
		fileName: filePath,
	}).outputText;
	const module = { exports: {} };
	const localRequire = (specifier) => imports[specifier] ?? nodeRequire(specifier);
	vm.runInNewContext(
		output,
		{ module, exports: module.exports, require: localRequire, console },
		{ filename: filePath },
	);
	return module.exports;
}

/** modelSpecsIndex：无外部依赖的纯函数模块 */
const indexMod = compileModule("src/main/pi/modelSpecsIndex.ts");

/** 构造测试用双源数据（与 sync 脚本裁剪口径一致） */
function makeFixture() {
	const openrouter = [
		{ id: "openai/gpt-4o", contextWindow: 128000, maxTokens: 16384, inputModalities: ["text", "image"] },
		{ id: "anthropic/claude-sonnet-4.5", contextWindow: 1000000, maxTokens: 64000, inputModalities: ["text", "image"] },
		{ id: "deepseek/deepseek-chat", contextWindow: 163840, maxTokens: 16000, inputModalities: ["text"] },
	];
	const modelsDev = [
		{ provider: "zhipuai", id: "glm-5", reasoning: true, toolCall: true, attachment: false, inputModalities: ["text"] },
		{ provider: "deepseek", id: "deepseek-r1", reasoning: true, toolCall: true, attachment: false, inputModalities: ["text"] },
		// 跨厂商同名：能力应 OR 合并（sakana 无推理、huggingface 有附件）
		{ provider: "sakana", id: "llama-3.3-70b", reasoning: false, toolCall: true, attachment: false, inputModalities: ["text"] },
		{ provider: "huggingface", id: "llama-3.3-70b", reasoning: true, toolCall: false, attachment: true, inputModalities: ["text", "image"] },
	];
	return { openrouter, modelsDev };
}

test("stripProviderPrefix: 已知厂商前缀剥除，自定义前缀保留", () => {
	const known = new Set(["openai", "deepseek"]);
	assert.equal(indexMod.stripProviderPrefix("openai/gpt-4o", known), "gpt-4o");
	assert.equal(indexMod.stripProviderPrefix("deepseek/deepseek-chat", known), "deepseek-chat");
	// 自定义中转站前缀不在已知集合 → 不剥（防误剥 "myrelay/model"）
	assert.equal(indexMod.stripProviderPrefix("myrelay/gpt-4o", known), "myrelay/gpt-4o");
	assert.equal(indexMod.stripProviderPrefix("gpt-4o", known), "gpt-4o");
});

test("lookupModelSpec: openrouter 完整 id / provider 前缀 / 尾段三种命中路径", () => {
	const { openrouter, modelsDev } = makeFixture();
	const index = indexMod.buildSpecIndex(openrouter, modelsDev);
	// 1. 完整 id（用户直接填 openai/gpt-4o）
	let spec = indexMod.lookupModelSpec(index, "anything", "openai/gpt-4o");
	assert.equal(spec?.source, "openrouter");
	assert.equal(spec?.contextWindow, 128000);
	assert.equal(spec?.maxTokens, 16384);
	// 2. provider 名恰好是厂商名
	spec = indexMod.lookupModelSpec(index, "deepseek", "deepseek-chat");
	assert.equal(spec?.contextWindow, 163840);
	// 3. 中转站场景：自定义 provider 名 + 裸 id → 尾段匹配
	spec = indexMod.lookupModelSpec(index, "myrelay", "gpt-4o");
	assert.equal(spec?.source, "openrouter");
	assert.equal(spec?.matchedId, "openai/gpt-4o");
	assert.equal(spec?.contextWindow, 128000);
});

test("lookupModelSpec: models.dev 裸 id 命中（中转站 + 官方厂商名都行）", () => {
	const { openrouter, modelsDev } = makeFixture();
	const index = indexMod.buildSpecIndex(openrouter, modelsDev);
	// 中转站 provider + 裸 id（glm-5 在 openrouter 无对应 → 走 models.dev）
	const spec = indexMod.lookupModelSpec(index, "myrelay", "glm-5");
	assert.equal(spec?.source, "models-dev");
	assert.equal(spec?.matchedId, "glm-5");
	assert.equal(spec?.reasoning, true);
});

test("lookupModelSpec: 双源合并（openrouter 补 context，models.dev 补能力）", () => {
	const { openrouter, modelsDev } = makeFixture();
	const index = indexMod.buildSpecIndex(openrouter, modelsDev);
	// gpt-4o 只在 openrouter：images 来自 openrouter 模态
	const spec = indexMod.lookupModelSpec(index, "myrelay", "gpt-4o");
	assert.equal(spec?.images, true);
	// 跨厂商同名（llama-3.3-70b）：reasoning/attachment 取 OR，模态取并集
	const llama = indexMod.lookupModelSpec(index, "myrelay", "llama-3.3-70b");
	assert.equal(llama?.source, "models-dev");
	assert.equal(llama?.reasoning, true);
	assert.equal(llama?.images, true); // huggingface 声明的 attachment
});

test("lookupModelSpec: 未命中返回 undefined（空 id / 未知模型）", () => {
	const { openrouter, modelsDev } = makeFixture();
	const index = indexMod.buildSpecIndex(openrouter, modelsDev);
	assert.equal(indexMod.lookupModelSpec(index, "myrelay", "gpt-9999"), undefined);
	assert.equal(indexMod.lookupModelSpec(index, "myrelay", "  "), undefined);
	assert.equal(indexMod.lookupModelSpec(index, "myrelay", ""), undefined);
});

test("lookupModelSpec: models.dev 条目缺能力字段时不下发 false（保持 undefined）", () => {
	const index = indexMod.buildSpecIndex([], [
		{ provider: "foo", id: "plain-model", reasoning: false, toolCall: false, attachment: false, inputModalities: ["text"] },
	]);
	// 能力「不支持」≠「已设置」：reasoning/images 都应保持 undefined，避免误填覆盖用户配置
	const spec = indexMod.lookupModelSpec(index, "myrelay", "plain-model");
	assert.equal(spec?.reasoning, undefined);
	assert.equal(spec?.images, undefined);
});

// ── entriesFromRows（db 行 → 双源条目）──────────────────────────────

const storeMod = compileModule("src/main/pi/modelSpecsStore.ts", {
	electron: { app: { isPackaged: false, getAppPath: () => ROOT } },
	"./modelSpecsIndex": indexMod,
});

test("entriesFromRows: 行映射 + JSON 模态解析 + 损坏行跳过", () => {
	const { openrouter, modelsDev } = storeMod.entriesFromRows([
		{ source: "openrouter", provider: "openai", id: "openai/gpt-4o", contextWindow: 128000, maxTokens: 16384, reasoning: null, toolCall: null, attachment: null, inputModalities: '["text","image"]' },
		{ source: "openrouter", provider: "x", id: "broken/ctx", contextWindow: null, maxTokens: null, reasoning: null, toolCall: null, attachment: null, inputModalities: null },
		{ source: "models-dev", provider: "zhipuai", id: "glm-5", contextWindow: null, maxTokens: null, reasoning: 1, toolCall: 1, attachment: 0, inputModalities: "{bad json" },
		{ source: "unknown-source", provider: "x", id: "skip-me", contextWindow: 1, maxTokens: null, reasoning: null, toolCall: null, attachment: null, inputModalities: null },
	]);
	assert.equal(openrouter.length, 1);
	assert.equal(openrouter[0].contextWindow, 128000);
	// vm 跨 realm 数组 deepEqual 会因原型不同失败，逐元素断言
	assert.equal(openrouter[0].inputModalities.length, 2);
	assert.equal(openrouter[0].inputModalities[0], "text");
	assert.equal(openrouter[0].inputModalities[1], "image");
	assert.equal(modelsDev.length, 1);
	assert.equal(modelsDev[0].reasoning, true);
	// 损坏的 input_modalities JSON 降级为空数组（不抛错、不丢行）
	assert.equal(modelsDev[0].inputModalities.length, 0);
});

// ── 集成：真实 resources/model-specs.db（sync 脚本产物，随 repo 提交）──────

test("integration: 内置 db 可读且真实模型可命中（不绑定数值）", async () => {
	const dbPath = join(ROOT, "resources", "model-specs.db");
	const initSqlJs = nodeRequire("sql.js");
	const SQL = await initSqlJs({
		locateFile: (file) => join(ROOT, "node_modules", "sql.js", "dist", file),
	});
	const db = new SQL.Database(readFileSync(dbPath));

	const specRows = db.exec(
		`SELECT source, provider, id, context_window, max_tokens,
		        reasoning, tool_call, attachment, input_modalities
		 FROM model_specs`,
	);
	const rows = (specRows[0]?.values ?? []).map((row) => ({
		source: String(row[0] ?? ""),
		provider: row[1] == null ? null : String(row[1]),
		id: String(row[2] ?? ""),
		contextWindow: row[3] == null ? null : Number(row[3]),
		maxTokens: row[4] == null ? null : Number(row[4]),
		reasoning: row[5] == null ? null : Number(row[5]),
		toolCall: row[6] == null ? null : Number(row[6]),
		attachment: row[7] == null ? null : Number(row[7]),
		inputModalities: row[8] == null ? null : String(row[8]),
	}));
	const metaRows = db.exec(`SELECT key, value FROM model_specs_meta`);
	const meta = Object.fromEntries(
		(metaRows[0]?.values ?? []).map((row) => [String(row[0]), String(row[1] ?? "")]),
	);
	db.close();

	// 同步时间必须存在（发版同步的核心字段）
	assert.ok(meta.synced_at, "model_specs_meta.synced_at 应存在");
	assert.ok(meta.openrouter_count && Number(meta.openrouter_count) > 100, "openrouter 条数应 > 100");
	assert.ok(meta.models_dev_count && Number(meta.models_dev_count) > 1000, "models.dev 条数应 > 1000");

	const { openrouter, modelsDev } = storeMod.entriesFromRows(rows);
	assert.ok(openrouter.length > 100, `openrouter 行数异常: ${openrouter.length}`);
	assert.ok(modelsDev.length > 1000, `models.dev 行数异常: ${modelsDev.length}`);
	const index = indexMod.buildSpecIndex(openrouter, modelsDev);

	// 命中路径（数值会随发版同步变化，只断言类型/来源）
	const gpt4o = indexMod.lookupModelSpec(index, "openai", "gpt-4o");
	assert.ok(gpt4o?.contextWindow > 0, "gpt-4o 应有 contextWindow");
	const viaRelay = indexMod.lookupModelSpec(index, "myrelay", "gpt-4o");
	assert.ok(viaRelay?.contextWindow > 0, "中转站 provider + 裸 id 应命中");
	const deepseek = indexMod.lookupModelSpec(index, "deepseek", "deepseek-chat");
	assert.ok(deepseek?.contextWindow > 0, "deepseek-chat 应命中");
	// 纯 models.dev 模型（openrouter 无对应）
	const glm = indexMod.lookupModelSpec(index, "myrelay", "glm-5");
	assert.ok(glm?.source === "models-dev" || glm?.contextWindow, "glm-5 应命中 models.dev");
	// 未知模型不命中
	assert.equal(indexMod.lookupModelSpec(index, "myrelay", "definitely-not-a-model-xyz"), undefined);
});
