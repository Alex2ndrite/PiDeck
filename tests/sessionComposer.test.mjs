import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import vm from "node:vm";

function compile(filePath, stubs = {}) {
  const source = readFileSync(filePath, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
      jsx: ts.JsxEmit.ReactJSX,
    },
    fileName: filePath,
  }).outputText;
  const module = { exports: {} };
  const localRequire = (specifier) => stubs[specifier] ?? {};
  vm.runInNewContext(output, {
    module,
    exports: module.exports,
    require: localRequire,
    console,
    Set,
  }, { filename: filePath });
  return module.exports;
}

const sendSource = () => readFileSync("src/renderer/src/hooks/useSessionSend.ts", "utf8");
const areaSource = () => readFileSync("src/renderer/src/components/session/ComposerArea.tsx", "utf8");
const runtimeSource = () => readFileSync(
  "src/renderer/src/components/session/ComposerRuntimeIntegrations.tsx",
  "utf8",
);

function loadSendHelpers() {
  return compile("src/renderer/src/hooks/useSessionSend.ts", {
    react: { useRef: (value) => ({ current: value }) },
    jotai: { useAtomValue: () => undefined, useSetAtom: () => () => undefined },
  });
}

function loadImageHelpers() {
  return compile("src/renderer/src/utils/composerImages.ts");
}

test("Composer identity is session-only and send snapshots address the captured Session", () => {
  const source = sendSource();
  assert.match(source, /sessionId\?: string/);
  assert.match(source, /const sessionId = options\.sessionId \?\? selectedSessionId/);
  assert.match(source, /setSendState\(\{\s*sessionId/);
  assert.match(source, /sendPrompt\(\{\s*sessionId,\s*requestId/);
  assert.doesNotMatch(source, /setActiveAgentId/);
});

test("A/B switching cannot clear or restore the other Session draft", () => {
  const source = sendSource();
  assert.match(source, /clearSnapshot\(sessionId\)/);
  assert.match(source, /restoreRejectedSnapshot\(sessionId, message, imageSnapshot\)/);
  assert.match(source, /setDraft\(\{\s*sessionId: targetSessionId/);
  assert.match(source, /setAttachments\(\{\s*sessionId: targetSessionId/);
});

test("sending-time input is appended after a rejected snapshot without losing images", () => {
  const { mergeRejectedComposerDraft, mergeRejectedComposerImages } = loadSendHelpers();
  assert.equal(mergeRejectedComposerDraft("first", "new input"), "first\n\nnew input");
  const oldImage = { type: "image", data: "old", mimeType: "image/png" };
  const newImage = { type: "image", data: "new", mimeType: "image/png" };
  assert.equal(
    JSON.stringify(mergeRejectedComposerImages([oldImage], [newImage])),
    JSON.stringify([oldImage, newImage]),
  );
});

test("pure image submissions and double-click sends are guarded", () => {
  const { createSessionSendLock, hasComposerSubmission } = loadSendHelpers();
  assert.equal(hasComposerSubmission("", [{ type: "image", data: "x", mimeType: "image/png" }]), true);
  assert.equal(hasComposerSubmission("  ", []), false);
  const lock = createSessionSendLock();
  assert.equal(lock.claim("session-a"), true);
  assert.equal(lock.claim("session-a"), false);
  assert.equal(lock.claim("session-b"), true, "A/B sessions have isolated send locks");
  lock.release("session-a");
  assert.equal(lock.claim("session-a"), true);
});

test("unknown delivery is terminal and is not folded into rejected recovery", () => {
  const { classifySessionPromptResult } = loadSendHelpers();
  assert.equal(classifySessionPromptResult({ accepted: true }), "accepted");
  assert.equal(classifySessionPromptResult({ accepted: false, delivery: "rejected", error: "no" }), "rejected");
  assert.equal(classifySessionPromptResult({ accepted: false, delivery: "unknown", error: "timeout" }), "unknown");
  const source = sendSource();
  const unknownBranch = source.match(/else if \(outcome === "unknown"\) \{[\s\S]*?\n      \} else \{/)?.[0] ?? "";
  assert.doesNotMatch(unknownBranch, /restoreRejectedSnapshot/);
});

test("ComposerArea keeps legacy runtime queue outside the Session draft leaf", () => {
  assert.match(areaSource(), /queuePanel\?: ReactNode/);
  assert.match(areaSource(), /\{props\.queuePanel\}/);
  assert.doesNotMatch(areaSource(), /queuedPromptQueue/);
  assert.doesNotMatch(areaSource(), /from ["']\.\.\/\.\.\/App["']/);
  assert.doesNotMatch(readFileSync("src/renderer/src/hooks/useSessionComposerController.ts", "utf8"), /queuedPromptQueue/);
});

test("runtime widgets require the current Session binding generation", () => {
  const { sameRuntimeHandle, isCoherentComposerRuntimeUi } = compile(
    "src/renderer/src/components/session/ComposerRuntimeIntegrations.tsx",
    {
      react: {},
      jotai: {},
    },
  );
  assert.equal(sameRuntimeHandle({ agentId: "a", runtimeGeneration: 2 }, { agentId: "a", runtimeGeneration: 2 }), true);
  assert.equal(sameRuntimeHandle({ agentId: "a", runtimeGeneration: 2 }, { agentId: "a", runtimeGeneration: 1 }), false);
  assert.equal(isCoherentComposerRuntimeUi({ agentId: "a", runtimeGeneration: 2 }, { agentId: "a", runtimeGeneration: 1 }), false);
  assert.equal(isCoherentComposerRuntimeUi(undefined, { agentId: "a", runtimeGeneration: 2 }), false);
  assert.match(runtimeSource(), /runtimeUi\.agentId === runtime\.agentId/);
  assert.match(runtimeSource(), /runtimeUi\.runtimeGeneration === runtime\.runtimeGeneration/);
  assert.match(runtimeSource(), /const sequence = \+\+botRequestSequenceRef\.current/);
  assert.match(runtimeSource(), /setSessionBotId\(undefined\);\s*if \(!runtimeHandle\) return/);
});

test("selected Session reference messages are expanded without a second index pass", () => {
  const controller = readFileSync(
    "src/renderer/src/hooks/useSessionComposerController.ts",
    "utf8",
  );
  assert.match(controller, /const selectedMessages = saved\?\.messages \?\?/);
  assert.doesNotMatch(controller, /saved\.selectedIndices\.map/);
});

test("image handling keeps GIFs lossless and rejects unsupported/oversized files", () => {
  const source = readFileSync("src/renderer/src/utils/composerImages.ts", "utf8");
  const helpers = loadImageHelpers();
  assert.equal(
    JSON.stringify(helpers.dataUrlToImageContent("data:image/png;base64,abc", "image/jpeg")),
    JSON.stringify({ type: "image", data: "abc", mimeType: "image/png" }),
  );
  assert.match(source, /file\.type === "image\/gif"\) return fileToImageContent\(file\)/);
  assert.match(source, /COMPOSER_IMAGE_MAX_BYTES/);
});
