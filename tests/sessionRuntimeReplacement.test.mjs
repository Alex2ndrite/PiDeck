import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";
import vm from "node:vm";

const nodeRequire = createRequire(import.meta.url);

function compileModule(filePath, imports = {}) {
  const output = ts.transpileModule(readFileSync(filePath, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: filePath,
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(output, {
    module,
    exports: module.exports,
    require: (specifier) => imports[specifier] ?? nodeRequire(specifier),
    console,
  }, { filename: filePath });
  return module.exports;
}

function loadCoordinator() {
  const identity = compileModule("src/shared/sessionIdentity.ts");
  return compileModule("src/main/sessions/SessionRuntimeCoordinator.ts", {
    "../../shared/sessionIdentity": identity,
  });
}

function makeHarness() {
  const records = new Set(["old-session", "clone-session", "fork-session", "switch-session"]);
  const tabs = [{ id: "agent-1", status: "idle", createdAt: 1 }];
  const catalog = {
    get: (sessionId) => records.has(sessionId) ? { id: sessionId } : undefined,
    attachRuntime: async () => undefined,
  };
  const agents = { list: () => tabs };
  return { catalog, agents };
}

for (const operation of ["clone", "fork", "switch"]) {
  test(`${operation} success detaches old Session, blocks bridge, and binds one target`, async () => {
    const { SessionRuntimeCoordinator } = loadCoordinator();
    const harness = makeHarness();
    const coordinator = new SessionRuntimeCoordinator(harness.catalog, harness.agents, async () => ({ accepted: true }));
    assert.equal(coordinator.bindExistingAgent("old-session", "agent-1"), 1);
    const order = [];
    const targetSessionId = `${operation}-session`;
    harness.agents.list().push({ id: "agent-2", status: "idle", createdAt: 2 });
    assert.equal(coordinator.bindExistingAgent(targetSessionId, "agent-2"), 1);
    const result = await coordinator.replaceBoundRuntime({
      agentId: "agent-1",
      replace: async () => {
        order.push("operation");
        assert.equal(coordinator.getSessionId("agent-1"), undefined);
        assert.equal(coordinator.getRuntimeBinding("agent-1"), undefined);
        return { text: operation };
      },
      resolveTargetSessionId: async () => targetSessionId,
      onDetached: (binding) => {
        order.push("detach");
        assert.equal(binding.sessionId, "old-session");
      },
      onAttached: (binding) => {
        order.push("attach");
        assert.equal(binding.sessionId, targetSessionId);
      },
      onRestored: () => order.push("restore"),
    });
    assert.equal(result.targetSessionId, targetSessionId);
    assert.deepEqual(order, ["detach", "operation", "attach"]);
    assert.equal(coordinator.getSessionId("agent-1"), targetSessionId);
    assert.equal(coordinator.getSessionId("agent-2"), undefined);
    assert.equal(coordinator.getAgentId("old-session"), undefined);
    assert.equal(coordinator.getAgentId(targetSessionId), "agent-1");
  });
}

test("replacement failure restores the old binding with a newer generation", async () => {
  const { SessionRuntimeCoordinator } = loadCoordinator();
  const harness = makeHarness();
  const coordinator = new SessionRuntimeCoordinator(harness.catalog, harness.agents, async () => ({ accepted: true }));
  assert.equal(coordinator.bindExistingAgent("old-session", "agent-1"), 1);
  const order = [];
  await assert.rejects(
    coordinator.replaceBoundRuntime({
      agentId: "agent-1",
      replace: async () => {
        order.push("operation");
        throw new Error("replacement failed");
      },
      resolveTargetSessionId: async () => "switch-session",
      onDetached: () => order.push("detach"),
      onAttached: () => order.push("attach"),
      onRestored: (binding) => {
        order.push("restore");
        assert.equal(binding.sessionId, "old-session");
        assert.equal(binding.runtimeGeneration, 3);
      },
    }),
    /replacement failed/,
  );
  assert.deepEqual(order, ["detach", "operation", "restore"]);
  assert.equal(coordinator.getSessionId("agent-1"), "old-session");
  assert.equal(coordinator.getRuntimeBinding("agent-1").runtimeGeneration, 3);
});

test("cancelled replacement restores the old binding and preserves cancellation fields", async () => {
  const { SessionRuntimeCoordinator } = loadCoordinator();
  const harness = makeHarness();
  const coordinator = new SessionRuntimeCoordinator(harness.catalog, harness.agents, async () => ({ accepted: true }));
  coordinator.bindExistingAgent("old-session", "agent-1");
  let restored = 0;
  const result = await coordinator.replaceBoundRuntime({
    agentId: "agent-1",
    replace: async () => ({ cancelled: true, text: "kept" }),
    resolveTargetSessionId: async () => "clone-session",
    onDetached: () => undefined,
    onAttached: () => assert.fail("cancelled replacement must not attach target"),
    onRestored: () => { restored += 1; },
  });
  assert.deepEqual(result, { cancelled: true, text: "kept" });
  assert.equal(restored, 1);
  assert.equal(coordinator.getSessionId("agent-1"), "old-session");
});

test("unbound external runtime keeps the legacy result and does not create a Session", async () => {
  const { SessionRuntimeCoordinator } = loadCoordinator();
  const harness = makeHarness();
  const coordinator = new SessionRuntimeCoordinator(harness.catalog, harness.agents, async () => ({ accepted: true }));
  const result = await coordinator.replaceBoundRuntime({
    agentId: "external-agent",
    replace: async () => ({ cancelled: false, text: "legacy" }),
    resolveTargetSessionId: async () => assert.fail("external runtime must not resolve a Session"),
    onDetached: () => assert.fail("external runtime must not detach"),
    onAttached: () => assert.fail("external runtime must not attach"),
    onRestored: () => assert.fail("external runtime must not restore"),
  });
  assert.deepEqual(result, { cancelled: false, text: "legacy" });
});
