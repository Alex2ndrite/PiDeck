import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const turnRowSource = readFileSync(
  "src/renderer/src/components/session/turn/TurnRow.tsx",
  "utf8",
);
const timelineSource = readFileSync(
  "src/renderer/src/components/session/SessionMessageTimeline.tsx",
  "utf8",
);

/**
 * Live 思考：History 尚无 thinking 时直接挂 ThinkingStep，不再伪造 effectiveRun 虚拟组。
 */
test("TurnRow mounts live ThinkingStep from streaming thinking", () => {
  assert.match(turnRowSource, /streamingThinking\?: string/);
  assert.match(turnRowSource, /liveThinkingGroup/);
  assert.match(turnRowSource, /id: `\$\{run\.id\}:live-thinking`/);
  assert.match(turnRowSource, /endedAt: 0/);
  // 已有 thinking-group 或消息 thinking 时不挂 live 步
  assert.match(turnRowSource, /item\.kind === "thinking-group"/);
  assert.match(turnRowSource, /item\.message\.thinking\?\.trim\(\)/);
  assert.match(turnRowSource, /buildTurnDisplay\(run/);
  assert.doesNotMatch(turnRowSource, /effectiveRun/);
  assert.match(turnRowSource, /liveThinkingGroup && \(/);
  assert.match(turnRowSource, /<ThinkingStep\n\s*key=\{liveThinkingGroup\.id\}/);
});

test("streaming thinking flows into the execution area, not the timeline footer", () => {
  assert.doesNotMatch(timelineSource, /thinking-card markdown-body/);
  assert.doesNotMatch(timelineSource, /thinking-card-content/);
  assert.match(timelineSource, /streamingThinking=\{isRunStreaming \? activeThinking : undefined\}/);
  assert.match(turnRowSource, /isStreaming=\{props\.isStreaming\}/);
});
