import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";
import vm from "node:vm";
import { createStore } from "jotai/vanilla";

const nodeRequire = createRequire(import.meta.url);

function compileModule(filePath, imports = {}) {
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
    Date,
    Set,
  }, { filename: filePath });
  return module.exports;
}

function loadAtoms() {
  return compileModule("src/renderer/src/atoms/session-atoms.ts", {
    "../utils/agentRuntimeState": compileModule(
      "src/renderer/src/utils/agentRuntimeState.ts",
    ),
  });
}

function event(overrides = {}) {
  return {
    sessionId: "session-a",
    agentId: "agent-a",
    runtimeGeneration: 1,
    sourceChannel: "agents:ui-request",
    payload: {
      agentId: "agent-a",
      requestId: "request-a",
      method: "confirm",
      title: "Continue?",
    },
    ...overrides,
  };
}

test("Session UI requests and widgets are stored under the generation envelope", () => {
  const atoms = loadAtoms();
  const store = createStore();
  store.set(atoms.applySessionRuntimeEventAtom, event());
  store.set(atoms.applySessionRuntimeEventAtom, event({
    payload: {
      agentId: "agent-a",
      requestId: "widget-a",
      method: "setWidget",
      widgetKey: "plan",
      widgetLines: ["Step 1"],
    },
  }));

  const ui = store.get(atoms.sessionRuntimeUiByIdAtom)["session-a"];
  assert.equal(ui.agentId, "agent-a");
  assert.equal(ui.runtimeGeneration, 1);
  assert.equal(ui.requests["request-a"].status, "pending");
  assert.deepEqual(ui.widgets.plan, ["Step 1"]);
});

test("renderer claim rejects stale generation and duplicate UI responses", () => {
  const atoms = loadAtoms();
  const store = createStore();
  store.set(atoms.applySessionRuntimeEventAtom, event());

  const stale = store.set(atoms.claimSessionRuntimeUiResponseAtom, {
    sessionId: "session-a",
    requestId: "request-a",
    agentId: "agent-a",
    runtimeGeneration: 0,
  });
  const accepted = store.set(atoms.claimSessionRuntimeUiResponseAtom, {
    sessionId: "session-a",
    requestId: "request-a",
    agentId: "agent-a",
    runtimeGeneration: 1,
  });
  const duplicate = store.set(atoms.claimSessionRuntimeUiResponseAtom, {
    sessionId: "session-a",
    requestId: "request-a",
    agentId: "agent-a",
    runtimeGeneration: 1,
  });

  assert.equal(stale, false);
  assert.equal(accepted, true);
  assert.equal(duplicate, false);
});

test("a newer binding clears old requests and ignores late completion", () => {
  const atoms = loadAtoms();
  const store = createStore();
  store.set(atoms.applySessionRuntimeEventAtom, event());
  store.set(atoms.applySessionRuntimeEventAtom, event({
    agentId: "agent-b",
    runtimeGeneration: 2,
    sourceChannel: "agents:state",
    payload: { id: "agent-b", status: "idle" },
  }));
  store.set(atoms.applySessionRuntimeEventAtom, event({
    payload: { agentId: "agent-a", requestId: "request-a", completed: true },
  }));

  const ui = store.get(atoms.sessionRuntimeUiByIdAtom)["session-a"];
  assert.equal(ui.agentId, "agent-b");
  assert.equal(ui.runtimeGeneration, 2);
  assert.equal(ui.requests["request-a"], undefined);
});
