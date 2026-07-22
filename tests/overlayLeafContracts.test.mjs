import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import vm from "node:vm";

const root = "src/renderer/src";
const read = (file) => readFileSync(`${root}/${file}`, "utf8");

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
  assert.match(imports, /mounted/);
  assert.match(imports, /requestSequence/);
  assert.match(imports, /sequence\.current \+= 1/);
  assert.match(updates, /mounted/);
  assert.match(updates, /requestSequence/);
  assert.match(updates, /unsubscribe\?\./);
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
  const filePath = `${root}/components/overlays/SessionRuntimeUiOverlay.tsx`;
  const output = ts.transpileModule(read(filePath.replace(`${root}/`, "")), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
    fileName: filePath,
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(output, {
    module,
    exports: module.exports,
    require: (specifier) => {
      if (specifier === "react") return {};
      if (specifier === "lucide-react") return { Info: () => null };
      if (specifier === "../../i18n") return { t: (key) => key };
      return {};
    },
  }, { filename: filePath });
  return module.exports;
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
