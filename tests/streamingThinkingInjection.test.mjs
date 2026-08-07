import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const turnRowSource = readFileSync(
  "src/renderer/src/components/session/SurfaceComponents.tsx",
  "utf8",
);
const timelineSource = readFileSync(
  "src/renderer/src/components/session/SessionMessageTimeline.tsx",
  "utf8",
);

// 流式思考注入：runtime 实时思考文本（streamingThinking）在 run 尚未落地
// thinking-group 时合成虚拟 thinking-group，让思考卡与工具卡同轨出现在执行区；
// 消息落地后自动退出，避免双份渲染。
test("TurnRow injects a virtual thinking group from streaming thinking", () => {
  assert.match(turnRowSource, /streamingThinking\?: string/);
  const effectiveRun = turnRowSource.match(
    /const effectiveRun = useMemo<AgentRunItem>\(\(\) => \{[\s\S]*?\}, \[run, props\.streamingThinking\]\);/,
  )?.[0] ?? "";
  assert.ok(effectiveRun, "effectiveRun must exist");
  // 已有 thinking-group 时不注入（消息落地后避免双份渲染）
  assert.match(effectiveRun, /run\.items\.some\(\(item\) => item\.kind === "thinking-group"\)/);
  // 虚拟组保持未结束语义：endedAt 为 0 → ThinkingBlock 维持 active tone、不触发完成收起
  assert.match(effectiveRun, /endedAt: 0/);
  // 注入后思考卡进入执行区：buildTurnSegments / renderExecutionItem 走 effectiveRun
  assert.match(turnRowSource, /buildTurnSegments\(effectiveRun/);
  assert.match(turnRowSource, /effectiveRun\.items\.some/);
});

test("streaming thinking flows into the execution area, not the timeline footer", () => {
  // 底部平铺的流式思考卡已移除，思考只出现在 run 的执行区（虚拟组或 thinking-group）
  assert.doesNotMatch(timelineSource, /thinking-card markdown-body/);
  assert.doesNotMatch(timelineSource, /thinking-card-content/);
  // 当前流式 run 接收 runtime 实时思考文本
  assert.match(timelineSource, /streamingThinking=\{isRunStreaming \? activeThinking : undefined\}/);
  // ThinkingBlock 透传流式标记，展开后 MarkdownStream 实时增长
  assert.match(turnRowSource, /isStreaming=\{props\.isStreaming\}/);
});
