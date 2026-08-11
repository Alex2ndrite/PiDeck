import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import vm from "node:vm";

function compile(filePath) {
  const output = ts.transpileModule(readFileSync(filePath, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(output, { module, exports: module.exports, require: () => ({}) });
  return module.exports;
}

const windowing = compile("src/renderer/src/components/session/timeline/turnRenderWindow.ts");

function runs(...ids) {
  return ids.map((id) => ({ kind: "agent-run", id }));
}

test("sliceLastAgentRuns keeps only the trailing maxTurns agent-runs", () => {
  const items = [
    { kind: "message", id: "sys" },
    ...runs("r1", "r2", "r3", "r4", "r5"),
  ];
  const sliced = windowing.sliceLastAgentRuns(items, 3);
  assert.deepEqual(
    sliced.map((item) => item.id),
    ["r3", "r4", "r5"],
  );
});

test("sliceLastAgentRuns preserves trailing non-run items after the cut", () => {
  const items = [
    ...runs("r1", "r2", "r3"),
    { kind: "message", id: "diag" },
  ];
  const sliced = windowing.sliceLastAgentRuns(items, 2);
  assert.deepEqual(
    sliced.map((item) => item.id ?? item.kind),
    ["r2", "r3", "diag"],
  );
});

test("sliceLastAgentRuns returns same reference when under the limit", () => {
  const items = runs("r1", "r2");
  assert.equal(windowing.sliceLastAgentRuns(items, 10), items);
});

test("selectTimelineTurnWindow only slices while following past the limit", () => {
  const items = runs("a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k");
  assert.equal(windowing.countAgentRunItems(items), 11);
  assert.equal(windowing.shouldWindowTimelineTurns(11, true, 10), true);
  assert.equal(windowing.shouldWindowTimelineTurns(11, false, 10), false);
  assert.equal(windowing.selectTimelineTurnWindow(items, false, 10), items);
  const following = windowing.selectTimelineTurnWindow(items, true, 10);
  assert.equal(following.length, 10);
  assert.equal(following[0].id, "b");
  assert.equal(following.at(-1).id, "k");
});

test("timeline wires the turn mount window helper", () => {
  const source = readFileSync("src/renderer/src/components/session/SessionMessageTimeline.tsx", "utf8");
  assert.match(source, /selectTimelineTurnWindow/);
  assert.match(source, /TIMELINE_MOUNTED_TURN_LIMIT/);
  assert.match(source, /displayRuns\.map/);
});
