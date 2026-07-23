import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const turnRowSource = readFileSync(
  "src/renderer/src/components/session/SurfaceComponents.tsx",
  "utf8",
);

test("renders the execution process before the final assistant answer", () => {
  assert.ok(
    turnRowSource.indexOf("{/* 执行过程概要") < turnRowSource.indexOf("{/* 最终回答"),
    "the execution summary must precede the final answer in TurnRow",
  );
});
