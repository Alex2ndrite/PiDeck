import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const controllerSource = readFileSync(
  "src/renderer/src/hooks/useSessionTimelineController.ts",
  "utf8",
);
const timelineSource = readFileSync(
  "src/renderer/src/components/session/SessionMessageTimeline.tsx",
  "utf8",
);

// 发送置顶动画：发消息后垫片撑高 + 平滑滚动，把最新用户消息钉到视口顶部，
// 此前消息整体顶出屏幕；回答流式增长时垫片收敛。
test("pin-to-top exposes controller API and guards the smooth animation", () => {
  // controller API
  assert.match(controllerSource, /pinnedTurnId\?: string/);
  assert.match(controllerSource, /pinSpacerHeight\?: number/);
  assert.match(controllerSource, /pinTurnToTop\?: \(userMessageId: string/);

  // 垫片高度目标：rowTop + clientHeight == 内容总高
  assert.match(controllerSource, /rowTop \+ timeline\.clientHeight - contentWithoutSpacer/);

  // 动画期间：即时贴底与 scroll 事件处理都要让路，保护平滑滚动
  const stick = controllerSource.match(/const stickToBottom = \(\) => \{[\s\S]*?\n    \};/)?.[0] ?? "";
  assert.match(stick, /pinAnimatingRef\.current/);
  const onScroll = controllerSource.match(/const onScroll = \(\) => \{[\s\S]*?isTimelineAtBottom/)?.[0] ?? "";
  assert.match(onScroll, /pinAnimatingRef\.current/);

  // 平滑滚动 + reduced-motion 退化 + 动画结束后补贴底恢复跟随
  assert.match(controllerSource, /behavior: reduceMotion \? "instant" : "smooth"/);
  assert.match(controllerSource, /prefers-reduced-motion/);
  assert.match(controllerSource, /pinAnimatingRef\.current = false/);

  // 会话切换时清理垫片状态
  assert.match(controllerSource, /setPinnedTurnId\(undefined\)/);
  assert.match(controllerSource, /setPinSpacerHeight\(0\)/);
});

test("timeline pins the new tail user message and renders the spacer", () => {
  // 尾部新增用户消息触发 pin；乐观→权威换绑（pin 目标消失）只重定向不重播
  assert.match(timelineSource, /tailMessage\?\.role === "user"/);
  assert.match(timelineSource, /controller\.pinTurnToTop\?\.\(tailMessage\.id, \{ animate: !pinnedGone \}\)/);
  // 垫片渲染在 message-list 尾部
  assert.match(timelineSource, /className="timeline-pin-spacer"/);
  assert.match(timelineSource, /controller\.pinSpacerHeight/);
});
