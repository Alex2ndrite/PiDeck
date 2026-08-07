import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// 长会话渲染治理契约（2026-08 调整）：
// 移除 content-visibility 估算高度（旧方案对屏外行用 240px 估算，展开/折叠工具卡
// 或思考卡时浏览器按估算修正滚动位置，产生屏幕抖动）。
// 替代方案（学 Proma）：靠「总折叠 + 各自折叠」压缩单行 DOM 体积，
// 分页（useMessagePagination / disk 轮次页）继续做窗口治理。

const timeline = readFileSync("src/renderer/src/components/session/SessionMessageTimeline.tsx", "utf8");
const turnRow = readFileSync("src/renderer/src/components/session/turn/TurnRow.tsx", "utf8");

test("message-list no longer estimates offscreen row height via content-visibility", () => {
  // 旧估算高度是展开/折叠抖动的根源：不再对 message-list 行应用 content-visibility 工具类
  assert.doesNotMatch(timeline, /message-list[^\n]*\[content-visibility:auto\]/);
  assert.doesNotMatch(timeline, /message-list[^\n]*contain-intrinsic-size:auto_\d+px/);
});

test("long-session window governance stays via pagination hooks", () => {
  // 分页窗口仍在做长会话治理（渲染尾部 N 条，向上滚动扩窗）
  const controller = readFileSync(
    "src/renderer/src/hooks/useSessionTimelineController.ts",
    "utf8",
  );
  assert.match(controller, /useMessagePagination/);
  assert.match(controller, /initialPageSize: options\.initialPageSize \?\? 100/);
});

test("single-turn DOM stays light via default-collapsed process group", () => {
  // 学 Proma：执行过程总折叠默认收起（历史 run 不弹开），单 turn DOM 体积小
  const turnExecution = readFileSync(
    "src/renderer/src/components/session/turn/useTurnExecution.ts",
    "utf8",
  );
  assert.match(turnExecution, /历史已完成 run 初始即折叠/);
  assert.match(turnExecution, /!\(opts\.isComplete && !opts\.agentRunning && opts\.hasFinalAnswer\)/);
  // 完成后 1.5s 自动收起（落在 1~2s 体验区间）
  assert.match(turnExecution, /}, 1500\)/);
});

test("process group uses CollapsibleContent height transition", () => {
  // 总折叠用 Radix CollapsibleContent（自带 height 过渡动画），替代 display:none 突变
  assert.match(turnRow, /<Collapsible/);
  assert.match(turnRow, /<CollapsibleContent/);
});
