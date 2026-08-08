import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import ts from "typescript";
import vm from "node:vm";

function compile(filePath, imports = {}) {
  const output = ts.transpileModule(readFileSync(filePath, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(output, { module, exports: module.exports, require: (id) => imports[id] ?? {} });
  return module.exports;
}

const pagination = compile("src/renderer/src/hooks/useMessagePagination.ts", { react: {} });
const timeline = compile("src/renderer/src/hooks/useSessionTimelineController.ts", {
  react: {}, jotai: {}, "jotai/utils": {}, "../atoms": {}, "./useMessagePagination": {},
});

function readRendererRuntimeSources(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const filePath = join(directory, entry.name);
    if (entry.isDirectory()) return readRendererRuntimeSources(filePath);
    if (!/\.(ts|tsx)$/.test(entry.name)) return [];
    return [readFileSync(filePath, "utf8")];
  });
}

test("A to B owner switch renders B's initial page without A visibleCount or loading", () => {
  const old = { ownerKey: "A", visibleCount: 300, isLoading: true };
  const current = pagination.currentMessagePaginationState(old, "B", 100);
  assert.equal(current.ownerKey, "B");
  assert.equal(current.visibleCount, 100);
  assert.equal(current.isLoading, false);
});

test("append growth keeps the top message in the window (no lagged visibleCount)", () => {
  // 旧逻辑：useEffect 追 visibleCount → 先 slice 掉顶部再补回 → 触底上跳
  assert.equal(pagination.growVisibleCountForAppend(100, 250, 251, Infinity), 101);
  assert.equal(pagination.growVisibleCountForAppend(100, 250, 260, Infinity), 110);
  // 批量 ≥10 也必须跟进，否则窗口永久少条
  assert.equal(pagination.growVisibleCountForAppend(100, 200, 215, Infinity), 115);
  assert.equal(pagination.growVisibleCountForAppend(100, 250, 249, Infinity), 100);
});

test("old load completion, anchor, and jump owner tags cannot affect B", () => {
  const old = { ownerKey: "A", visibleCount: 100, isLoading: true };
  assert.equal(pagination.completeMessagePaginationLoad(old, "B", 400, 100, Infinity), old);
  assert.equal(timeline.matchesTimelineOwner("A", "B"), false);
  assert.equal(timeline.matchesTimelineOwner("B", "B"), true);
});

test("Session runtime busy state is authoritative and only the latest run is busy", () => {
  assert.equal(timeline.isSessionRuntimeBusy("idle", { isStreaming: true }), true);
  assert.equal(timeline.isSessionRuntimeBusy("running", undefined), true);
  assert.equal(timeline.isSessionRuntimeBusy("idle", undefined), false);
  assert.equal(timeline.isLatestTimelineRunBusy(true, 1, 2), true);
  assert.equal(timeline.isLatestTimelineRunBusy(true, 0, 2), false);
});

test("renderer runtime code reads historical messages only through the bounded page API", () => {
  assert.equal(
    existsSync("src/renderer/src/hooks/useSessionMessages.ts"),
    false,
    "the obsolete full-history renderer hook must remain removed",
  );
  const rendererRuntime = [
    ...readRendererRuntimeSources("src/renderer/src/hooks"),
    ...readRendererRuntimeSources("src/renderer/src/components/session"),
  ].join("\n");
  assert.doesNotMatch(rendererRuntime, /readRecordMessages\(/);
  assert.match(rendererRuntime, /readRecordMessagePage\(/);
});
