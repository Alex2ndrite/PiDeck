import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * #113 3.2-7：compact nothing-to-do 友好文案链路。
 * 1) AgentManager 必须把 RPC success:false 抛出（不能只 warn）
 * 2) 渲染层优先读 debugDetails 映射 nothing-to-do / too-small
 * 3) /compact 与 chip 共用同一映射
 */

const agentManager = readFileSync("src/main/pi/AgentManager.ts", "utf8");
const composer = readFileSync(
  "src/renderer/src/hooks/useSessionComposerController.ts",
  "utf8",
);
const mockPi = readFileSync("e2e/mock-pi.cjs", "utf8");

test("AgentManager.compact throws when RPC returns success:false", () => {
  // 失败路径：读 response.error 后 throw，而不是只记 warn 后当成功
  assert.match(agentManager, /if \(!response\.success\)/);
  assert.match(agentManager, /throw new Error\(rpcError\)/);
  // 不得再出现「只 warn 不抛」的旧注释语义
  assert.doesNotMatch(
    agentManager,
    /session might still be written[\s\S]{0,80}this\.compactingAgents\.delete\(agentId\);\s*\/\/ 压缩成功/,
  );
});

test("composer maps compact errors via debugDetails-first friendly helper", () => {
  assert.match(composer, /function friendlyCompactError/);
  assert.match(composer, /debugDetails/);
  assert.match(composer, /nothing to compact\|already compacted/i);
  assert.match(composer, /app\.compactNothingToDo/);
  assert.match(composer, /app\.compactSessionTooSmall/);
  // chip 与 /compact 共用
  assert.match(composer, /showNotice\(friendlyCompactError\(error\)/);
  assert.equal(
    (composer.match(/showNotice\(friendlyCompactError\(error\)/g) || []).length,
    2,
  );
});

test("mock pi supports NOTHING compact failure path", () => {
  assert.match(mockPi, /function respondFail/);
  assert.match(mockPi, /NOTHING/);
  assert.match(mockPi, /nothing to compact/);
});
