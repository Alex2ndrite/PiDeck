import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const timelineSource = readFileSync(
  "src/renderer/src/components/session/SessionMessageTimeline.tsx",
  "utf8",
);
const turnRowSource = readFileSync(
  "src/renderer/src/components/app/AppParts.tsx",
  "utf8",
);

test("renders the execution process before the final assistant answer", () => {
  assert.ok(
    turnRowSource.indexOf("{/* 执行过程概要") < turnRowSource.indexOf("{/* 最终回答"),
    "the execution summary must precede the final answer in TurnRow",
  );
});

test("only the latest agent run receives the global running state", () => {
  const timelineRender = timelineSource.slice(
    timelineSource.indexOf("{renderedRuns.map"),
    timelineSource.indexOf('if (item.kind !== "message")'),
  );
  assert.match(
    timelineRender,
    /agentRunning=\{\s*props\.isAgentBusy && index === renderedRuns\.length - 1\s*\}/,
  );
  assert.doesNotMatch(timelineRender, /agentRunning=\{props\.isAgentBusy\}/);
});
