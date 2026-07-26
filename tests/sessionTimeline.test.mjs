import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { createStore } from "jotai/vanilla";
import { selectAtom } from "jotai/utils";
import ts from "typescript";
import vm from "node:vm";

const nodeRequire = createRequire(import.meta.url);

const source = readFileSync(
  "src/renderer/src/hooks/useSessionTimelineController.ts",
  "utf8",
);

function compileModule(filePath, imports = {}) {
  const output = ts.transpileModule(readFileSync(filePath, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(output, {
    module,
    exports: module.exports,
    require: (specifier) => imports[specifier] ?? nodeRequire(specifier),
    Date,
  });
  return module.exports;
}

function loadTimelineHelpers() {
  return compileModule("src/renderer/src/hooks/useSessionTimelineController.ts", {
    react: {},
    jotai: {},
    "jotai/utils": {},
    "../atoms": {},
    "./useMessagePagination": {},
  });
}

function loadSessionAtoms() {
  return compileModule("src/renderer/src/atoms/session-atoms.ts", {
    "../utils/agentRuntimeState": compileModule(
      "src/renderer/src/utils/agentRuntimeState.ts",
    ),
    "../utils/sessionRecordIdentity": compileModule(
      "src/renderer/src/utils/sessionRecordIdentity.ts",
    ),
  });
}

test("timeline pagination restores the load-more anchor instead of jumping the viewport", () => {
  const { restoreTimelineAnchor } = loadTimelineHelpers();
  assert.equal(restoreTimelineAnchor(240, 600), 840);
  assert.equal(restoreTimelineAnchor(0, 0), 0);
});

test("timeline auto-scroll only sticks while the reader remains near the bottom", () => {
  const { isTimelineAtBottom } = loadTimelineHelpers();
  assert.equal(isTimelineAtBottom(900, 1100, 120), true);
  assert.equal(isTimelineAtBottom(700, 1100, 120), false);
});

test("timeline owns paging, resize, mutation, and outline jump lifecycle", () => {
  assert.match(source, /selectAtom\([\s\S]*sessionMessagesCacheAtom/);
  assert.match(source, /new ResizeObserver\(stickToBottom\)/);
  assert.match(source, /new MutationObserver\(stickToBottom\)/);
  assert.match(source, /pagination\.loadUntilIncluded\(index\)/);
  assert.match(source, /restoreTimelineAnchor\(/);
});

test("background Session cache changes retain the selected timeline slice", () => {
  const { sessionMessagesCacheAtom } = loadSessionAtoms();
  const store = createStore();
  const currentMessages = [{ id: "current" }];
  const selectedMessages = selectAtom(
    sessionMessagesCacheAtom,
    (cache) => cache.current?.messages,
    Object.is,
  );
  store.set(sessionMessagesCacheAtom, {
    current: { messages: currentMessages },
    background: { messages: [{ id: "old" }] },
  });
  const before = store.get(selectedMessages);
  store.set(sessionMessagesCacheAtom, {
    current: { messages: currentMessages },
    background: { messages: [{ id: "new" }] },
  });
  assert.equal(store.get(selectedMessages), before);
});
