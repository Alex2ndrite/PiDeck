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
const scrollerSource = readFileSync(
  "src/renderer/src/components/agents/message-scroller.tsx",
  "utf8",
);

// 发送置顶动画：发消息后垫片撑高 + 平滑滚动，把最新用户消息钉到视口顶部，
// 此前消息整体顶出屏幕；回答流式增长时垫片收敛。
test("pin-to-top animation is disabled while normal follow remains active", () => {
  // 发送后的顶屏定位暂时关闭，时间线恢复普通追加。
  assert.doesNotMatch(timelineSource, /controller\.pinTurnToTop/);
  assert.doesNotMatch(timelineSource, /timeline-pin-spacer/);

  assert.match(controllerSource, /setAutoScrollFromScroller/);
  assert.match(timelineSource, /followOutput=\{controller\.autoScroll\}/);
});

test("MessageScroller owns live-edge follow and releases control on user input", () => {
  assert.match(timelineSource, /<MessageScroller/);
  assert.match(timelineSource, /onFollowChange=\{controller\.setAutoScrollFromScroller\}/);
  assert.match(scrollerSource, /followThreshold\?\: number/);
  assert.match(scrollerSource, /ResizeObserver/);
  assert.match(scrollerSource, /onWheel/);
  assert.match(scrollerSource, /onTouchStart/);
});

test("legacy pin controller remains isolated from normal scroll follow", () => {
  assert.match(controllerSource, /pinAnimatingRef/);
  assert.match(controllerSource, /setAutoScrollFromScroller/);
});

test("timeline keeps normal tail rendering without a pin spacer", () => {
  assert.match(timelineSource, /新消息只播放轻量入场效果/);
  assert.doesNotMatch(timelineSource, /timeline-pin-spacer/);
});
