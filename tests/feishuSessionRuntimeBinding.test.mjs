import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const bridge = readFileSync("src/main/feishu/FeishuBridge.ts", "utf8");
const main = readFileSync("src/main/index.ts", "utf8");

test("FeishuBridge receives a narrow Session runtime binding gateway", () => {
  assert.match(bridge, /export interface SessionRuntimeBindingGateway/);
  assert.match(bridge, /private runtimeBindings: SessionRuntimeBindingGateway/);
  assert.doesNotMatch(bridge, /sessionRuntimeByIdAtom|bindSessionRuntimeAtom/);
});

test("all Feishu create and restore branches bind after Agent creation", () => {
  const createCalls = [...bridge.matchAll(/await this\.agentManager\.create\(/g)].length;
  const bindingCalls = [...bridge.matchAll(/await this\.runtimeBindings\.bindRuntime\(/g)].length;
  assert.equal(createCalls, 3);
  assert.equal(bindingCalls, 3);
});

test("main injects the catalog-backed gateway into every Feishu bridge", () => {
  assert.match(main, /const feishuSessionRuntimeBindings/);
  const constructors = [...main.matchAll(/new FeishuBridge\(/g)].length;
  const injections = [...main.matchAll(/feishuSessionRuntimeBindings/g)].length - 1;
  assert.ok(constructors >= 4);
  assert.ok(injections >= constructors);
});
