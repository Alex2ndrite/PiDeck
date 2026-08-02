import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { loadTsCommonJs } from "./helpers/loadTsCommonJs.mjs";

/**
 * 模型列表实时性（issue：本地 models.json 优先 + 新模型需重启 Agent 生效）：
 * 1) parsePiModelsFile 把嵌套 providers 结构转成 AvailableModel[]（字段完整）
 * 2) fetchModelList 优先读本地 models.json，空/缺失时回退 --list-models
 * 3) AgentManager.setModel 在 pi 报 Model not found 且本地有该模型时抛 needsRestart 错误
 * 4) SessionRuntimeCoordinator.commandFailure 把 needsRestart 映射为 SESSION_MODEL_NOT_FOUND
 * 5) 渲染层 ComposerPickerHost 捕获 needsRestart 弹确认重启
 */

const { parsePiModelsFile } = loadTsCommonJs("src/main/pi/modelListCache.ts");
const agentManager = readFileSync("src/main/pi/AgentManager.ts", "utf8");
const coordinator = readFileSync("src/main/sessions/SessionRuntimeCoordinator.ts", "utf8");
const pickerHost = readFileSync(
  "src/renderer/src/components/session/ComposerPickerHost.tsx",
  "utf8",
);
const sharedTypes = readFileSync("src/shared/types/session.ts", "utf8");

test("parsePiModelsFile converts nested providers structure with full fields", () => {
  const models = parsePiModelsFile({
    providers: {
      openai: {
        models: [
          { id: "gpt-5", name: "GPT-5", contextWindow: 200000, reasoning: true },
          { id: "gpt-4o", contextWindow: 128000 },
        ],
      },
      anthropic: {
        models: [{ id: "claude-sonnet-4", reasoning: true }],
      },
    },
  });
  assert.equal(models.length, 3);
  assert.equal(models[0].id, "gpt-5");
  assert.equal(models[0].name, "GPT-5");
  assert.equal(models[0].provider, "openai");
  assert.equal(models[0].contextWindow, 200000);
  assert.equal(models[0].reasoning, true);
  // name 缺省时回退 provider/id
  assert.equal(models[1].name, "openai/gpt-4o");
  assert.equal(models[1].reasoning, undefined);
  assert.equal(models[2].provider, "anthropic");
  assert.equal(models[2].id, "claude-sonnet-4");
});

test("parsePiModelsFile tolerates empty / undefined input", () => {
  assert.equal(parsePiModelsFile(undefined).length, 0);
  assert.equal(parsePiModelsFile({ providers: {} }).length, 0);
});

test("fetchModelList prefers local models.json and falls back to --list-models", () => {
  const source = readFileSync("src/main/pi/modelListCache.ts", "utf8");
  // 优先本地 models.json（实时 + 字段完整）
  assert.match(source, /modelsFromConfig/);
  assert.match(source, /parsePiModelsFile\(parsed\)/);
  assert.match(source, /if \(fromConfig\.length > 0\)/);
  // 回退逻辑仍在（--list-models 兜底）
  assert.match(source, /--list-models/);
});

test("systemIpc passes models.json reader as primary source", () => {
  const systemIpc = readFileSync("src/main/ipc/systemIpc.ts", "utf8");
  assert.match(systemIpc, /getModelsConfig\(\)/);
  assert.match(systemIpc, /fetchModelList\(piLocator, settingsStore, /);
});

test("AgentManager.setModel detects Model not found with local model present", () => {
  // pi set_model 校验失败（Model not found）时，若本地 models.json 有该模型 → 抛 needsRestart
  assert.match(agentManager, /model not found/i);
  assert.match(agentManager, /needsRestart = true/);
  assert.match(agentManager, /localModelsContains/);
  // 本地 models.json 查询实现
  assert.match(agentManager, /getModelsConfig\(\)/);
  assert.match(agentManager, /providers\?\.\[provider\]\?\.models/);
});

test("coordinator maps needsRestart to SESSION_MODEL_NOT_FOUND", () => {
  assert.match(coordinator, /SESSION_MODEL_NOT_FOUND/);
  assert.match(coordinator, /needsRestart/);
  // 必须优先于 generic "not found" → SESSION_NOT_FOUND 判断
  const needsRestartBlock = coordinator.slice(
    coordinator.indexOf("needsRestart"),
    coordinator.indexOf("const message = errorMessage"),
  );
  assert.match(needsRestartBlock, /needsRestart/);
});

test("session error type carries needsRestart flag", () => {
  assert.match(sharedTypes, /SESSION_MODEL_NOT_FOUND/);
  assert.match(sharedTypes, /needsRestart\?: boolean/);
});

test("renderer ComposerPickerHost shows restart confirm on needsRestart", () => {
  assert.match(pickerHost, /needsRestart/);
  assert.match(pickerHost, /ConfirmDialog/);
  assert.match(pickerHost, /restartRuntime/);
  assert.match(pickerHost, /modelRestartTitle/);
  assert.match(pickerHost, /modelRestartBody/);
});
