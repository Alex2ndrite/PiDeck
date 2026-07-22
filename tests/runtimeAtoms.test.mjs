import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";
import vm from "node:vm";
import { createStore } from "jotai/vanilla";

const nodeRequire = createRequire(import.meta.url);

function loadModule(filePath, imports = {}) {
  const output = ts.transpileModule(readFileSync(filePath, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
    fileName: filePath,
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(output, {
    module,
    exports: module.exports,
    require: (specifier) => imports[specifier] ?? nodeRequire(specifier),
  }, { filename: filePath });
  return module.exports;
}

function tab(id, projectId, status = "idle") {
  return {
    id,
    projectId,
    cwd: `C:/${projectId}`,
    title: id,
    status,
    createdAt: 1,
  };
}

test("agent inventory is replaceable and exposed through narrow ID/project selectors", () => {
  const atoms = loadModule("src/renderer/src/atoms/runtime-atoms.ts", {
    "../utils/agentRuntimeState": loadModule("src/renderer/src/utils/agentRuntimeState.ts"),
  });
  const store = createStore();
  store.set(atoms.replaceAgentInventoryAtom, [
    tab("agent-a", "project-a"),
    tab("agent-b", "project-b", "running"),
  ]);

  assert.equal(store.get(atoms.agentByIdAtomFamily("agent-a")).title, "agent-a");
  assert.deepEqual(
    store.get(atoms.agentsByProjectIdAtomFamily("project-b")).map((agent) => agent.id),
    ["agent-b"],
  );
});

test("runtime capabilities merge by agent ID without containing Session messages", () => {
  const atoms = loadModule("src/renderer/src/atoms/runtime-atoms.ts", {
    "../utils/agentRuntimeState": loadModule("src/renderer/src/utils/agentRuntimeState.ts"),
  });
  const store = createStore();
  store.set(atoms.applyRuntimeCapabilityAtom, {
    agentId: "agent-a",
    state: { modelName: "Model A", isStreaming: true },
  });
  store.set(atoms.applyRuntimeCapabilityAtom, {
    agentId: "agent-a",
    state: { isExecutingTool: true },
  });

  const capability = store.get(atoms.runtimeCapabilityByAgentIdAtomFamily("agent-a"));
  assert.equal(capability.modelName, "Model A");
  assert.equal(capability.isStreaming, true);
  assert.equal(capability.isExecutingTool, true);
  assert.equal("messages" in capability, false);
});

test("project runtime capability selectors isolate notifications and preserve references", () => {
  const atoms = loadModule("src/renderer/src/atoms/runtime-atoms.ts", {
    "../utils/agentRuntimeState": loadModule("src/renderer/src/utils/agentRuntimeState.ts"),
  });
  const store = createStore();
  store.set(atoms.replaceAgentInventoryAtom, [
    tab("agent-a", "project-a"),
    tab("agent-b", "project-b"),
  ]);
  store.set(atoms.applyRuntimeCapabilityAtom, {
    agentId: "agent-a",
    state: { modelName: "Model A" },
  });
  store.set(atoms.applyRuntimeCapabilityAtom, {
    agentId: "agent-b",
    state: { modelName: "Model B" },
  });

  const projectAAtom = atoms.runtimeCapabilitiesByProjectIdAtomFamily("project-a");
  const before = store.get(projectAAtom);
  let notifications = 0;
  const unsubscribe = store.sub(projectAAtom, () => {
    notifications += 1;
  });

  store.set(atoms.applyRuntimeCapabilityAtom, {
    agentId: "agent-b",
    state: { isStreaming: true },
  });
  assert.equal(store.get(projectAAtom), before);
  assert.equal(notifications, 0);

  store.set(atoms.applyRuntimeCapabilityAtom, {
    agentId: "agent-a",
    state: { isStreaming: true },
  });
  assert.notEqual(store.get(projectAAtom), before);
  assert.equal(notifications, 1);
  unsubscribe();
});
