import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const appSource = readFileSync("src/renderer/src/App.tsx", "utf8");
const timelineSource = readFileSync(
  "src/renderer/src/components/session/SessionMessageTimeline.tsx",
  "utf8",
);
const turnRowSource = readFileSync(
  "src/renderer/src/components/app/AppParts.tsx",
  "utf8",
);

function componentInvocation(source, componentName) {
  const start = source.indexOf(`<${componentName}`);
  const end = source.indexOf("/>", start);
  assert.notEqual(start, -1, `${componentName} invocation must exist`);
  assert.notEqual(end, -1, `${componentName} invocation must be self-closing`);
  return source.slice(start, end + 2);
}

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
  const sessionTimeline = componentInvocation(appSource, "SessionMessageTimeline");

  assert.match(
    timelineRender,
    /agentRunning=\{\s*props\.isAgentBusy && index === renderedRuns\.length - 1\s*\}/,
  );
  assert.doesNotMatch(timelineRender, /agentRunning=\{props\.isAgentBusy\}/);
  assert.match(sessionTimeline, /isAgentBusy=\{isAgentBusy\}/);
});
