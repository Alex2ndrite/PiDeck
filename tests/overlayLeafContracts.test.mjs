import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import vm from "node:vm";

const root = "src/renderer/src";
const read = (file) => readFileSync(`${root}/${file}`, "utf8");

function compile(file, imports = {}, context = {}) {
  const filePath = `${root}/${file}`;
  const output = ts.transpileModule(read(file), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
    fileName: filePath,
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(output, {
    module,
    exports: module.exports,
    require: (specifier) => imports[specifier] ?? {},
    ...context,
  }, { filename: filePath });
  return module.exports;
}

test("overlay roots expose narrow contracts and never subscribe to raw UI requests", () => {
  const runtime = read("components/overlays/SessionRuntimeUiOverlay.tsx");
  assert.match(runtime, /readBinding/);
  assert.match(runtime, /runtimeGeneration/);
  assert.match(runtime, /sameBinding/);
  assert.match(runtime, /cancelled:\s*true/);
  assert.doesNotMatch(runtime, /onUiRequest/);
  assert.match(read("components/overlays/ImportOverlayHost.tsx"), /kind: "codex"/);
  assert.match(read("components/overlays/EnvironmentOverlay.tsx"), /EnvironmentDialog/);
  assert.match(read("components/overlays/ScratchPadOverlay.tsx"), /scratch-pad-overlay/);
});

test("async leaf controllers contain cancellation and stale-result guards", () => {
  const imports = read("hooks/useImportController.ts");
  const updates = read("hooks/useAppUpdateController.ts");
  assert.match(imports, /mounted\.current = true/);
  assert.match(imports, /mounted\.current = false/);
  assert.match(imports, /requestSequence/);
  assert.match(imports, /sequence\.current \+= 1/);
  assert.match(updates, /downloadGate/);
  assert.match(updates, /acceptsProgress/);
  assert.match(updates, /downloadGate\.current\.settle/);
});

test("ScratchPad and Notice roots preserve shortcut, closing, and timer cleanup", () => {
  const scratch = read("components/overlays/ScratchPadOverlay.tsx");
  const notice = read("components/overlays/NoticeCenter.tsx");
  assert.match(scratch, /ctrlKey.*shiftKey/);
  assert.match(scratch, /event\.key === "Escape"/);
  assert.match(scratch, /isClosing/);
  assert.match(notice, /clearTimeout/);
  assert.match(notice, /unsubscribe\(\)/);
});

function loadResponder() {
  return compile("components/overlays/SessionRuntimeUiOverlay.tsx", {
    react: {},
    "lucide-react": { Info: () => null },
    "../../i18n": { t: (key) => key },
  });
}

test("runtime responder rejects old generation and sends cancelled response with binding", async () => {
  const { createSessionRuntimeUiResponder } = loadResponder();
  const binding = { sessionId: "s1", agentId: "a1", runtimeGeneration: 4 };
  let current = { ...binding };
  const claims = [];
  const sent = [];
  const responder = createSessionRuntimeUiResponder({
    binding,
    readBinding: () => current,
    claim: (input) => { claims.push(input); return true; },
    rollback: () => true,
    send: async (input) => { sent.push(input); },
  });
  const request = { agentId: "a1", requestId: "r1", method: "confirm", title: "Continue" };
  assert.equal(await responder.respond(request, { cancelled: true }), true);
  assert.equal(JSON.stringify(sent[0]), JSON.stringify({ ...binding, requestId: "r1", response: { cancelled: true } }));
  assert.equal(claims[0].request, request);
  current = { ...binding, runtimeGeneration: 3 };
  assert.equal(await responder.respond(request, { confirmed: true }), false);
  assert.equal(sent.length, 1);
});

test("runtime responder rolls back when binding changes after claim", async () => {
  const { createSessionRuntimeUiResponder } = loadResponder();
  const binding = { sessionId: "s1", agentId: "a1", runtimeGeneration: 2 };
  let current = { ...binding };
  let rolledBack = 0;
  const responder = createSessionRuntimeUiResponder({
    binding,
    readBinding: () => { const next = { ...current }; current = { ...current, runtimeGeneration: 3 }; return next; },
    claim: () => true,
    rollback: () => { rolledBack += 1; return true; },
    send: async () => { throw new Error("must not send"); },
  });
  assert.equal(await responder.respond({ agentId: "a1", requestId: "r2", method: "input", title: "Input" }, { value: "x" }), false);
  assert.equal(rolledBack, 1);
});

function createHookHarness() {
  const refs = [];
  const states = [];
  let cursor = 0;
  let effects = [];
  let result;
  const react = {
    useRef(initial) {
      const index = cursor++;
      refs[index] ??= { current: initial };
      return refs[index];
    },
    useState(initial) {
      const index = cursor++;
      states[index] ??= typeof initial === "function" ? initial() : initial;
      return [states[index], (next) => { states[index] = typeof next === "function" ? next(states[index]) : next; }];
    },
    useCallback(fn) { cursor++; return fn; },
    useEffect(fn) { cursor++; effects.push(fn); },
  };
  const hooks = compile("hooks/useImportController.ts", { react });
  return {
    render(options) {
      cursor = 0;
      effects = [];
      result = hooks.useImportController(options);
      return { result, effects };
    },
    state: states,
  };
}

function deferred() {
  let resolve;
  const promise = new Promise((value) => { resolve = value; });
  return { promise, resolve };
}

async function flushAsync() {
  for (let index = 0; index < 5; index += 1) await Promise.resolve();
}

test("import controller effect replay restores mounted state and rejects a deferred result after project null", async () => {
  const scans = [];
  const harness = createHookHarness();
  const options = (projectId) => ({
    projectId,
    scan: async (id) => { const item = deferred(); scans.push({ id, ...item }); return item.promise; },
    importSelected: async () => ({ ok: true }),
  });
  const first = harness.render(options("project-a"));
  const firstCleanups = first.effects.map((setup) => setup()).filter(Boolean);
  assert.equal(scans.length, 1);
  firstCleanups.forEach((cleanup) => cleanup());
  first.effects.forEach((setup) => setup());
  assert.equal(scans.length, 2);
  scans[0].resolve([{ sourcePath: "stale-a" }]);
  scans[1].resolve([{ sourcePath: "fresh-a" }]);
  await flushAsync();
  assert.deepEqual(harness.render(options("project-a")).result.sessions, [{ sourcePath: "fresh-a" }]);

  const old = harness.render(options("project-a"));
  const oldCleanups = old.effects.map((setup) => setup()).filter(Boolean);
  assert.equal(scans.length, 3);
  oldCleanups.forEach((cleanup) => cleanup());
  const closed = harness.render(options(null));
  closed.effects.forEach((setup) => setup());
  scans[2].resolve([{ sourcePath: "must-not-appear" }]);
  await flushAsync();
  assert.equal(harness.render(options(null)).result.sessions.length, 0);
});

test("update gate blocks B after A clear and rejects A progress until A settles", () => {
  const { createAppUpdateDownloadGate } = compile("hooks/useAppUpdateController.ts", { react: {} });
  const gate = createAppUpdateDownloadGate();
  const a = gate.begin();
  assert.equal(gate.acceptsProgress(), true);
  gate.invalidate();
  assert.equal(gate.acceptsProgress(), false);
  assert.equal(gate.begin(), null);
  gate.settle(a);
  const b = gate.begin();
  assert.notEqual(b, null);
  assert.equal(gate.acceptsProgress(), true);
  gate.settle(b);
  assert.equal(gate.isInFlight(), false);
});

test("overlay roots keep controller/import/runtime error visible", () => {
  const update = read("components/overlays/AppUpdateOverlay.tsx");
  const imports = read("components/overlays/ImportOverlayHost.tsx");
  assert.match(update, /props\.error/);
  assert.match(update, /role="alert"/);
  assert.match(imports, /controller\.error/);
  assert.match(imports, /renderImportError/);
});

test("allowOther renders a custom input and sends its value through the responder envelope", async () => {
  const hookStates = [];
  let cursor = 0;
  const sent = [];
  const react = {
    useMemo: (factory) => factory(),
    useState: (initial) => {
      const index = cursor++;
      hookStates[index] ??= typeof initial === "function" ? initial() : initial;
      return [hookStates[index], (next) => { hookStates[index] = typeof next === "function" ? next(hookStates[index]) : next; }];
    },
    useEffect: () => { cursor += 1; },
  };
  const jsx = (type, props) => ({ type, props: props ?? {} });
  const runtime = compile("components/overlays/SessionRuntimeUiOverlay.tsx", {
    react,
    "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "fragment" },
    "lucide-react": { Info: () => null },
    "../../i18n": { t: (key) => key },
  });
  const request = { agentId: "a1", requestId: "r-custom", method: "select", title: "Pick", options: ["one"], allowOther: true };
  const props = {
    sessionId: "s1",
    runtime: { agentId: "a1", runtimeGeneration: 7, status: "idle", thinking: "", updatedAt: 1 },
    ui: { agentId: "a1", runtimeGeneration: 7, requests: { [request.requestId]: { request, status: "pending" } }, widgets: {}, revision: 1 },
    responder: { respond: async (nextRequest, response) => { sent.push({ nextRequest, response }); return true; } },
  };
  const walk = (node, predicate, found = []) => {
    if (!node || typeof node !== "object") return found;
    if (predicate(node)) found.push(node);
    for (const child of Object.values(node.props ?? {})) {
      if (Array.isArray(child)) child.forEach((item) => walk(item, predicate, found));
      else walk(child, predicate, found);
    }
    return found;
  };
  cursor = 0;
  const firstTree = runtime.SessionRuntimeUiOverlay(props);
  const input = walk(firstTree, (node) => node.props?.className === "ask-dialog-custom-field")[0];
  assert.ok(input, "allowOther custom field must render");
  input.props.onChange({ target: { value: "custom answer" } });
  cursor = 0;
  const secondTree = runtime.SessionRuntimeUiOverlay(props);
  const submit = walk(secondTree, (node) => node.props?.className === "ask-dialog-submit-btn")[0];
  assert.ok(submit, "allowOther submit button must render");
  assert.equal(typeof submit.props.onClick, "function");
  await submit.props.onClick();
  await flushAsync();
  assert.equal(sent.length, 1);
  assert.equal(sent[0].nextRequest.requestId, "r-custom");
  assert.equal(JSON.stringify(sent[0].response), JSON.stringify({ value: "custom answer" }));
});
