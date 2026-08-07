import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const toolCard = readFileSync(
  "src/renderer/src/components/session/ToolCallComponents.tsx",
  "utf8",
);
const turnExecution = readFileSync(
  "src/renderer/src/components/session/turn/useTurnExecution.ts",
  "utf8",
);
const controller = readFileSync(
  "src/renderer/src/hooks/useSessionTimelineController.ts",
  "utf8",
);
const scroller = readFileSync(
  "src/renderer/src/components/agents/message-scroller.tsx",
  "utf8",
);
const turnRow = readFileSync(
  "src/renderer/src/components/session/turn/TurnRow.tsx",
  "utf8",
);
const timeline = readFileSync(
  "src/renderer/src/components/session/SessionMessageTimeline.tsx",
  "utf8",
);

test("tool card name uses medium weight like process summary, not bold 650", () => {
  assert.match(
    toolCard,
    /className="shrink-0 text-caption font-medium lowercase text-text-secondary"/,
  );
  assert.doesNotMatch(toolCard, /font-\[650\]/);
  // ToolActivityCard 也不再用 <strong> 加粗
  assert.doesNotMatch(toolCard, /tool-activity-copy>\s*<strong>/);
  assert.match(toolCard, /tool-activity-name/);
});

test("auto-collapse process waits 1.5s after run completes", () => {
  assert.match(turnExecution, /}, 1500\)/);
  assert.match(turnExecution, /1\.5s 后自动收起/);
  assert.match(turnExecution, /autoCollapseTick/);
});

test("scrollToBottom uses stick-to-bottom spring via scrollerScrollApiRef", () => {
  assert.match(controller, /scrollerScrollApiRef/);
  assert.match(controller, /api\.scrollToBottom\(\{ animation \}\)/);
  // 不再把回底按钮绑成裸 timeline.scrollTo 作为主路径（兜底除外）
  assert.match(scroller, /scrollApiRef/);
  assert.match(scroller, /MessageScrollerScrollApi/);
  assert.match(timeline, /scrollApiRef=\{controller\.scrollerScrollApiRef\}/);
});

test("auto-collapse anchors viewport to final answer start when following", () => {
  assert.match(controller, /scrollFinalAnswerIntoView/);
  assert.match(controller, /data-final-answer/);
  assert.match(turnRow, /data-final-answer=\{run\.id\}/);
  assert.match(turnRow, /onProcessAutoCollapsed/);
  assert.match(timeline, /onProcessAutoCollapsed=\{controller\.scrollFinalAnswerIntoView\}/);
  // 仅跟随中才对准；先解除 autoScroll 避免 stick 锁在末尾
  assert.match(controller, /if \(!autoScrollRef\.current\) return;/);
  assert.match(controller, /autoScrollRef\.current = false;/);
  // 中上部 35%，不要贴顶 -20（对准最终回答路径）
  assert.match(controller, /clientHeight \* 0\.35/);
  assert.match(
    controller,
    /scrollFinalAnswerIntoView[\s\S]*?viewportAnchor[\s\S]*?rowTop - viewportAnchor/,
  );
  // 旧轮迟到定时器：只对准最后一条最终回答
  assert.match(controller, /finals\[finals\.length - 1\]/);
  assert.match(timeline, /isLatestRun=\{index === reconciledRuns\.length - 1\}/);
});

test("followOutput re-lock uses spring when far from bottom", () => {
  // 避免回底按钮 setAutoScroll(true) 后被 layout instant 掐死弹簧
  assert.match(
    scroller,
    /reduce \|\| distance <= followThreshold \? "instant" : "smooth"/,
  );
});
