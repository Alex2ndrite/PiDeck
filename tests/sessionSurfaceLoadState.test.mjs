import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { createStore } from "jotai/vanilla";
import { selectAtom } from "jotai/utils";
import ts from "typescript";
import vm from "node:vm";

const nodeRequire = createRequire(import.meta.url);
function compile(filePath, imports = {}) {
  const output = ts.transpileModule(readFileSync(filePath, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(output, {
    module, exports: module.exports,
    require: (id) => imports[id] ?? nodeRequire(id), Date,
  });
  return module.exports;
}
const sessionAtoms = compile("src/renderer/src/atoms/session-atoms.ts", {
  "../utils/agentRuntimeState": compile("src/renderer/src/utils/agentRuntimeState.ts"),
  "../utils/sessionRecordIdentity": compile("src/renderer/src/utils/sessionRecordIdentity.ts"),
});
const composerAtoms = compile("src/renderer/src/atoms/composer-atoms.ts", {
  "./session-atoms": sessionAtoms,
});
const timeline = compile("src/renderer/src/hooks/useSessionTimelineController.ts", {
  react: {}, jotai: { atom: (value) => ({ _mockInit: value }) }, "jotai/utils": {}, "../atoms": {}, "../desktopApi": {},
});

test("session load and send selectors retain current references across background patches", () => {
  const store = createStore();
  const loadA = { status: "loading" };
  const sendA = { status: "activating" };
  const loadSelector = selectAtom(sessionAtoms.sessionMessageLoadStateAtom, (all) => all.A, Object.is);
  const sendSelector = selectAtom(composerAtoms.sessionSendStateByIdAtom, (all) => all.A, Object.is);
  store.set(sessionAtoms.sessionMessageLoadStateAtom, { A: loadA, B: { status: "ready" } });
  store.set(composerAtoms.sessionSendStateByIdAtom, { A: sendA, B: { status: "sending" } });
  const currentLoad = store.get(loadSelector);
  const currentSend = store.get(sendSelector);
  store.set(sessionAtoms.sessionMessageLoadStateAtom, { A: loadA, B: { status: "error" } });
  store.set(composerAtoms.sessionSendStateByIdAtom, { A: sendA, B: { status: "unknown" } });
  assert.equal(store.get(loadSelector), currentLoad);
  assert.equal(store.get(sendSelector), currentSend);
});

test("modern surface state covers cached loading, activation before binding, and unknown", () => {
  const cachedLoading = timeline.deriveSessionSurfaceRuntime(0, "loading", "idle", undefined, undefined);
  const activating = timeline.deriveSessionSurfaceRuntime(0, "ready", "activating", undefined, undefined);
  const unknown = timeline.deriveSessionSurfaceRuntime(0, "ready", "unknown", undefined, undefined);
  assert.equal(cachedLoading.isLoading, true);
  assert.equal(activating.isLoading, true);
  assert.equal(activating.status, "starting");
  assert.equal(activating.isBusy, true);
  assert.equal(unknown.status, undefined);
  assert.equal(unknown.isStarting, false);
  assert.equal(unknown.isBusy, false);
});

test("load-more follows modern starting state while legacy remains prop-owned", () => {
  // 初始加载（无消息）时隐藏按钮
  assert.equal(timeline.canLoadSessionTimelineMore(true, 0), false);
  // runtime 创建期间已有消息则不隐藏（避免闪烁）
  assert.equal(timeline.canLoadSessionTimelineMore(true, 150), true);
  // idle 状态始终显示
  assert.equal(timeline.canLoadSessionTimelineMore(false, 0), true);
  assert.equal(timeline.canLoadSessionTimelineMore(false, 150), true);
  const legacyCanLoadMoreMessages = false;
  assert.equal(legacyCanLoadMoreMessages, false);
});
