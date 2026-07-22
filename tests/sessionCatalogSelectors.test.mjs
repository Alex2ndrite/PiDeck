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
  const sessions = compileModule("src/renderer/src/atoms/session-atoms.ts", {
    "../utils/agentRuntimeState": compileModule(
      "src/renderer/src/utils/agentRuntimeState.ts",
    ),
  });
  const selectors = compileModule("src/renderer/src/atoms/session-selectors.ts", {
    "./session-atoms": sessions,
  });
  return { ...sessions, ...selectors };
}

function session(id, projectId, updatedAt = 1) {
  return {
    id,
    projectId,
    title: id,
    source: "pi",
    environment: "native",
    filePath: `C:/sessions/${id}.jsonl`,
    preview: id,
    messageCount: 1,
    status: "active",
    createdAt: 1,
    updatedAt,
  };
}

test("catalog selectors expose read-only project summaries from the single record owner", () => {
  const atoms = loadAtoms();
  const store = createStore();
  store.set(atoms.replaceProjectSessionsAtom, {
    projectId: "project-a",
    sessions: [session("session-a", "project-a")],
  });
  const summaries = store.get(atoms.sessionSummariesByProjectIdAtomFamily("project-a"));
  assert.equal(summaries[0].id, "session-a");
  assert.equal(summaries[0].name, "session-a");
});

test("background Session patches do not update current Timeline/runtime selector values", () => {
  const atoms = loadAtoms();
  const store = createStore();
  store.set(atoms.replaceProjectSessionsAtom, {
    projectId: "project-a",
    sessions: [session("session-a", "project-a")],
  });
  store.set(atoms.replaceProjectSessionsAtom, {
    projectId: "project-b",
    sessions: [session("session-b", "project-b")],
  });
  store.set(atoms.currentSessionIdAtom, "session-a");
  store.set(atoms.cacheSessionMessagesAtom, {
    sessionId: "session-a",
    messages: [{ id: "m-a", role: "assistant", text: "stable" }],
    source: "disk",
  });

  const messagesBefore = store.get(atoms.currentSessionMessagesAtom);
  const runtimeBefore = store.get(atoms.currentSessionRuntimeAtom);
  let messageNotifications = 0;
  let runtimeNotifications = 0;
  const offMessages = store.sub(atoms.currentSessionMessagesAtom, () => {
    messageNotifications += 1;
  });
  const offRuntime = store.sub(atoms.currentSessionRuntimeAtom, () => {
    runtimeNotifications += 1;
  });

  store.set(atoms.replaceProjectSessionsAtom, {
    projectId: "project-b",
    sessions: [session("session-b", "project-b", 2)],
  });
  store.set(atoms.applySessionRuntimeEventAtom, {
    sessionId: "session-b",
    agentId: "agent-b",
    runtimeGeneration: 1,
    sourceChannel: "agents:state",
    payload: { id: "agent-b", status: "running" },
  });

  assert.equal(store.get(atoms.currentSessionMessagesAtom), messagesBefore);
  assert.equal(store.get(atoms.currentSessionRuntimeAtom), runtimeBefore);
  assert.equal(messageNotifications, 0);
  assert.equal(runtimeNotifications, 0);
  offMessages();
  offRuntime();
});
