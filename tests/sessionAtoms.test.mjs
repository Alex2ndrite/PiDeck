import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";
import vm from "node:vm";
import { createStore } from "jotai/vanilla";

const nodeRequire = createRequire(import.meta.url);

function compileModule(filePath, imports = {}) {
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
  const localRequire = (specifier) => imports[specifier] ?? nodeRequire(specifier);
  vm.runInNewContext(output, {
    module,
    exports: module.exports,
    require: localRequire,
    console,
    Date,
    Set,
  }, { filename: filePath });
  return module.exports;
}

function loadAtoms() {
  const runtimeState = compileModule("src/renderer/src/utils/agentRuntimeState.ts");
  const sessions = compileModule("src/renderer/src/atoms/session-atoms.ts", {
    "../utils/agentRuntimeState": runtimeState,
  });
  const composer = compileModule("src/renderer/src/atoms/composer-atoms.ts", {
    "./session-atoms": sessions,
  });
  return { ...sessions, ...composer };
}

function session(id, projectId = "project-1") {
  return {
    id,
    projectId,
    title: id,
    source: "pi",
    environment: "native",
    preview: "",
    messageCount: 0,
    status: "draft",
    createdAt: 1,
    updatedAt: 1,
  };
}

test("stores catalog records and selection by stable session ID", () => {
  const atoms = loadAtoms();
  const store = createStore();
  store.set(atoms.replaceProjectSessionsAtom, {
    projectId: "project-1",
    sessions: [session("session-a"), session("session-b")],
  });
  store.set(atoms.currentSessionIdAtom, "session-b");
  assert.equal(store.get(atoms.currentSessionAtom).id, "session-b");
  assert.equal(store.get(atoms.sessionIdsByProjectAtom)["project-1"].join(","), "session-a,session-b");
});

test("keeps only the 20 most recently written session message caches", () => {
  const atoms = loadAtoms();
  const store = createStore();
  for (let index = 0; index < 21; index += 1) {
    store.set(atoms.cacheSessionMessagesAtom, {
      sessionId: `session-${index}`,
      messages: [{ id: `message-${index}`, role: "user", text: String(index) }],
      source: "disk",
    });
  }
  const cache = store.get(atoms.sessionMessagesCacheAtom);
  assert.equal(Object.keys(cache).length, 20);
  assert.equal(cache["session-0"], undefined);
  assert.equal(cache["session-20"].messages[0].text, "20");
});

test("does not let a late disk response overwrite newer runtime messages", () => {
  const atoms = loadAtoms();
  const store = createStore();
  store.set(atoms.cacheSessionMessagesAtom, {
    sessionId: "session-a",
    messages: [{ id: "runtime", role: "assistant", text: "live" }],
    source: "runtime",
  });
  const applied = store.set(atoms.cacheSessionMessagesAtom, {
    sessionId: "session-a",
    messages: [{ id: "disk", role: "assistant", text: "stale" }],
    source: "disk",
    expectedRevision: 0,
  });
  assert.equal(applied, false);
  assert.equal(
    store.get(atoms.sessionMessagesCacheAtom)["session-a"].messages[0].text,
    "live",
  );
});

test("routes runtime payloads into session-keyed messages and state", () => {
  const atoms = loadAtoms();
  const store = createStore();
  store.set(atoms.applySessionRuntimeEventAtom, {
    sessionId: "session-a",
    agentId: "agent-a",
    runtimeGeneration: 1,
    sourceChannel: "agents:state",
    payload: { id: "agent-a", status: "running" },
  });
  store.set(atoms.applySessionRuntimeEventAtom, {
    sessionId: "session-a",
    agentId: "agent-a",
    runtimeGeneration: 1,
    sourceChannel: "agents:message",
    payload: { agentId: "agent-a", messages: [{ id: "m1", role: "user", text: "hello" }] },
  });
  const runtime = store.get(atoms.sessionRuntimeByIdAtom)["session-a"];
  assert.equal(runtime.agentId, "agent-a");
  assert.equal(runtime.status, "running");
  assert.equal(
    store.get(atoms.sessionMessagesCacheAtom)["session-a"].messages[0].text,
    "hello",
  );
});

test("ignores late events from an older runtime generation", () => {
  const atoms = loadAtoms();
  const store = createStore();
  store.set(atoms.applySessionRuntimeEventAtom, {
    sessionId: "session-a",
    agentId: "agent-old",
    runtimeGeneration: 1,
    sourceChannel: "agents:message",
    payload: {
      messages: [{ id: "old", role: "assistant", text: "old runtime" }],
    },
  });
  store.set(atoms.bindSessionRuntimeAtom, {
    sessionId: "session-a",
    agentId: "agent-new",
    runtimeGeneration: 2,
    status: "idle",
  });
  store.set(atoms.applySessionRuntimeEventAtom, {
    sessionId: "session-a",
    agentId: "agent-old",
    runtimeGeneration: 1,
    sourceChannel: "agents:message",
    payload: {
      messages: [{ id: "late", role: "assistant", text: "late old runtime" }],
    },
  });
  store.set(atoms.applySessionRuntimeEventAtom, {
    sessionId: "session-a",
    agentId: "agent-old",
    runtimeGeneration: 2,
    sourceChannel: "agents:state",
    payload: { status: "closed" },
  });
  store.set(atoms.applySessionRuntimeEventAtom, {
    sessionId: "session-a",
    agentId: "agent-new",
    runtimeGeneration: 2,
    sourceChannel: "agents:message",
    payload: {
      messages: [{ id: "new", role: "assistant", text: "new runtime" }],
    },
  });

  const runtime = store.get(atoms.sessionRuntimeByIdAtom)["session-a"];
  const messages = store.get(atoms.sessionMessagesCacheAtom)["session-a"].messages;
  assert.equal(runtime.agentId, "agent-new");
  assert.equal(runtime.runtimeGeneration, 2);
  assert.equal(runtime.status, "idle");
  assert.equal(messages.length, 1);
  assert.equal(messages[0].text, "new runtime");
});

test("isolates composer state and only clears the submitted snapshot", () => {
  const atoms = loadAtoms();
  const store = createStore();
  store.set(atoms.setSessionDraftAtom, { sessionId: "session-a", value: "first" });
  store.set(atoms.setSessionDraftAtom, { sessionId: "session-b", value: "second" });
  store.set(atoms.currentSessionIdAtom, "session-a");
  assert.equal(store.get(atoms.currentSessionDraftAtom), "first");

  store.set(atoms.setSessionDraftAtom, { sessionId: "session-a", value: "new edit" });
  store.set(atoms.clearSessionComposerSnapshotAtom, {
    sessionId: "session-a",
    draft: "first",
    attachments: [],
  });
  assert.equal(store.get(atoms.sessionDraftByIdAtom)["session-a"], "new edit");
  assert.equal(store.get(atoms.sessionDraftByIdAtom)["session-b"], "second");
});
