import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { loadTsCommonJs } from "./helpers/loadTsCommonJs.mjs";

/**
 * 模型列表实时性 v2（--list-models 加速 + 缓存刷新策略）：
 * 1) parsePiListModels 解析表格输出（provider/model/thinking）
 * 2) MODEL_LIST_FAST_ARGS 包含加速参数（offline/no-ext/skills/themes）
 * 3) fetchModelList 读缓存、refreshModelList 强制重取
 * 4) 配置保存（models/auth）后触发后台重取
 * 5) 每次 spawn Agent 前刷新缓存（onBeforeAgentSpawn 钩子）
 * 6) setModel needsRestart 重启引导（保留）
 */

const {
  parsePiListModels,
  MODEL_LIST_FAST_ARGS,
} = loadTsCommonJs("src/main/pi/modelListCache.ts");
const cacheSource = readFileSync("src/main/pi/modelListCache.ts", "utf8");
const systemIpc = readFileSync("src/main/ipc/systemIpc.ts", "utf8");
const agentManager = readFileSync("src/main/pi/AgentManager.ts", "utf8");
const indexSource = readFileSync("src/main/index.ts", "utf8");
const pickerHost = readFileSync(
  "src/renderer/src/components/session/ComposerPickerHost.tsx",
  "utf8",
);

test("parsePiListModels parses table with provider/model/thinking", () => {
  const stdout = [
    "provider  model  context  max-out  thinking  images",
    "openai    gpt-5   200K     64K      yes       yes",
    "deepseek  v4-flash 1M     384K      yes       no",
  ].join("\n");
  const models = parsePiListModels(stdout);
  assert.equal(models.length, 2);
  assert.equal(models[0].provider, "openai");
  assert.equal(models[0].id, "gpt-5");
  assert.equal(models[0].reasoning, true);
  assert.equal(models[1].provider, "deepseek");
  assert.equal(models[1].reasoning, true);
});

test("MODEL_LIST_FAST_ARGS includes speed flags", () => {
  assert.ok(MODEL_LIST_FAST_ARGS.includes("--list-models"));
  assert.ok(MODEL_LIST_FAST_ARGS.includes("--offline"));
  assert.ok(MODEL_LIST_FAST_ARGS.includes("--no-extensions"));
  assert.ok(MODEL_LIST_FAST_ARGS.includes("--no-skills"));
  assert.ok(MODEL_LIST_FAST_ARGS.includes("--no-themes"));
});

test("fetchModelList uses cache; refreshModelList forces reload", () => {
  // 缓存命中短路
  assert.match(cacheSource, /if \(cachedListModels\) return Promise\.resolve/);
  // 强制刷新绕过缓存
  assert.match(cacheSource, /export function refreshModelList/);
  // 加速参数传入 execFile
  assert.match(cacheSource, /MODEL_LIST_FAST_ARGS/);
  // 空结果不写缓存（避免永久「没有匹配的模型」）+ 自动重试
  assert.match(cacheSource, /models\.length > 0\) cachedListModels/);
  assert.match(cacheSource, /重试一次|setTimeout\(resolve, 500\)/);
});

test("config save (models/auth) triggers background refresh", () => {
  assert.match(systemIpc, /invalidateModelListCache\(\)/);
  assert.match(systemIpc, /refreshModelList\(piLocator, settingsStore\)/);
  // auth 保存同样触发（auth 决定可用模型过滤）
  assert.match(systemIpc, /configSaveAuth/);
});

test("agent spawn refreshes model cache via onBeforeAgentSpawn hook", () => {
  // AgentManager 构造注入 onBeforeAgentSpawn
  assert.match(agentManager, /onBeforeAgentSpawn/);
  // createUnlocked spawn 前调用
  assert.match(agentManager, /this\.onBeforeAgentSpawn\?\.\(\)/);
  // index.ts 装配时传 refreshModelList
  assert.match(indexSource, /refreshModelList\(piLocator, settingsStore\)/);
});

test("startup prefetch still present", () => {
  assert.match(indexSource, /fetchModelList\(piLocator, settingsStore\)/);
  assert.match(indexSource, /getCachedModelList\(\)/);
});

test("AgentManager.setModel detects Model not found with local model present", () => {
  assert.match(agentManager, /model not found/i);
  assert.match(agentManager, /needsRestart = true/);
  assert.match(agentManager, /localModelsContains/);
  assert.match(agentManager, /getModelsConfig\(\)/);
});

test("renderer ComposerPickerHost shows restart confirm on needsRestart", () => {
  assert.match(pickerHost, /needsRestart/);
  assert.match(pickerHost, /ConfirmDialog/);
  assert.match(pickerHost, /restartRuntime/);
  assert.match(pickerHost, /modelRestartTitle/);
  assert.match(pickerHost, /modelRestartBody/);
});

test("ComposerPickerHost loads models on welcome page (no record)", () => {
  // 欢迎页/未启动 Agent 时 record 为 undefined，模型列表也必须加载：
  // useEffect 不再被 `!record` 短路（listModels 是全量的，不依赖 projectId）。
  assert.match(pickerHost, /if \(props\.picker !== "model"\) return/);
  assert.doesNotMatch(pickerHost, /picker !== "model" \|\| !record/);
  assert.match(pickerHost, /listModels\(record\?\.projectId\)/);
});
