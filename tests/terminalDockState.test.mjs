import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import vm from "node:vm";

function compile(filePath, imports = {}) {
  const output = ts.transpileModule(readFileSync(filePath, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(output, {
    module,
    exports: module.exports,
    require: (id) => imports[id] ?? {},
  });
  return module.exports;
}

function loadTerminalDockStateModule() {
  return compile("src/renderer/src/terminalDockState.ts");
}

function assertMotion(state, expected) {
  assert.equal(state.mounted, expected.mounted);
  assert.equal(state.closing, expected.closing);
  assert.equal(state.agentId, expected.agentId);
}

function loadDockMotion() {
  return compile("src/renderer/src/components/session/SessionRuntimeDock.tsx", {
    react: {},
    "react/jsx-runtime": { jsx: () => null },
    "../terminal/TerminalDock": {},
  });
}

test("remembers collapsed terminal dock state for each agent", () => {
  const { setTerminalDockCollapsed } = loadTerminalDockStateModule();
  const current = {
    agentA: { open: true, collapsed: false },
    agentB: { open: true, collapsed: false },
  };
  const next = setTerminalDockCollapsed(current, "agentA", true);
  assert.equal(next.agentA.collapsed, true);
  assert.equal(next.agentA.open, true);
  assert.equal(next.agentB.collapsed, false);
});

test("preserves collapsed state when toggling terminal open state", () => {
  const { setTerminalDockOpen } = loadTerminalDockStateModule();
  const closed = setTerminalDockOpen({ agentA: { open: true, collapsed: true } }, "agentA", false);
  const reopened = setTerminalDockOpen(closed, "agentA", true);
  assert.equal(closed.agentA.open, false);
  assert.equal(reopened.agentA.collapsed, true);
});

test("prunes agent and project keys against their own live sets", () => {
  const { pruneTerminalDockState, terminalOwnerKey } = loadTerminalDockStateModule();
  const agentA = terminalOwnerKey({ kind: "agent", id: "agentA" });
  const agentB = terminalOwnerKey({ kind: "agent", id: "agentB" });
  const projectP = terminalOwnerKey({ kind: "project", id: "projP" });
  const current = {
    [agentA]: { open: true, collapsed: true },
    [agentB]: { open: true, collapsed: false },
    [projectP]: { open: true, collapsed: false },
  };

  // 关键回归：不能用 agent 集合误删 project 键
  const next = pruneTerminalDockState(
    current,
    new Set(["agentB"]),
    new Set(["projP"]),
  );

  assert.equal(next[agentA], undefined);
  assert.equal(next[agentB].open, true);
  assert.equal(next[projectP].open, true);
});

test("rapid reopen cancels the closing state without a second timer owner", () => {
  const { transitionSessionRuntimeDock } = loadDockMotion();
  const open = transitionSessionRuntimeDock({ mounted: false, closing: false }, { agentId: "A", open: true });
  const closing = transitionSessionRuntimeDock(open, { agentId: "A", open: false });
  const reopened = transitionSessionRuntimeDock(closing, { agentId: "A", open: true });
  assertMotion(closing, { mounted: true, closing: true, agentId: "A" });
  assertMotion(reopened, { mounted: true, closing: false, agentId: "A" });
});

test("runtime replacement mounts B directly and close completion cannot retain stale A", () => {
  const { transitionSessionRuntimeDock, finishSessionRuntimeDockClose, disposeSessionRuntimeDock } = loadDockMotion();
  const agentB = transitionSessionRuntimeDock(
    { mounted: true, closing: false, agentId: "A" }, { agentId: "B", open: true },
  );
  const closed = finishSessionRuntimeDockClose(
    transitionSessionRuntimeDock(agentB, { agentId: undefined, open: false }),
  );
  assertMotion(agentB, { mounted: true, closing: false, agentId: "B" });
  assertMotion(closed, { mounted: false, closing: false, agentId: undefined });
  assertMotion(disposeSessionRuntimeDock(), { mounted: false, closing: false, agentId: undefined });
});
