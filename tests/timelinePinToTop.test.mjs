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
const engineSource = readFileSync(
  "src/renderer/src/lib/stick-to-bottom/useStickToBottom.ts",
  "utf8",
);

test("sending a user message while following pins that turn to the top", () => {
  assert.match(timelineSource, /resolvePinTurnOnTailChange/);
  assert.match(timelineSource, /controller\.pinTurnToTop\(freshUserId/);
  assert.match(timelineSource, /animate: !controller\.pinAnimating/);
  assert.match(timelineSource, /className="timeline-pin-spacer/);
  assert.match(timelineSource, /followOutput=\{controller\.autoScroll && !controller\.pinAnimating\}/);
  assert.match(
    timelineSource,
    /controller\.autoScroll \|\| controller\.pinAnimating \|\| controller\.pinnedTurnId/,
  );
  // 空会话首条也要在发送当下置顶，不能再等 previousTail 基线。
  assert.doesNotMatch(timelineSource, /if \(!nextTail \|\| !previousTail\) return/);
  assert.match(timelineSource, /pendingRequestId:\s*sendState\?\.requestId/);
});

test("pin-to-top unlocks the live-edge engine before the spacer lands", () => {
  assert.match(controllerSource, /restoreAt\(timeline\.scrollTop\)/);
  assert.match(controllerSource, /if \(animate\) \{\s*pinAnimateRequestRef\.current = true;/s);
  assert.match(scrollerSource, /stopScroll: StopScroll/);
  assert.match(scrollerSource, /stopScroll: engineStopScroll/);
  // 乐观气泡下一帧才挂 data-message-id：缺行只能等，不能把清屏请求掐掉。
  assert.doesNotMatch(
    controllerSource,
    /if \(!row\) \{\s*pinAnimatingRef\.current = false;\s*setPinAnimating\(false\);/s,
  );
});

test("pin-to-top ignores follow reports and user-cancel unpins the spacer", () => {
  assert.match(controllerSource, /if \(pinAnimatingRef\.current\) return;/);
  assert.match(controllerSource, /if \(!following && pinnedTurnIdRef\.current\)/);
  assert.match(controllerSource, /setAutoScrollFromScroller/);
  assert.match(controllerSource, /addEventListener\("wheel", cancelPinByUser/);
  assert.match(controllerSource, /setPinnedTurnId\(undefined\)/);
  assert.match(controllerSource, /scrollToBottom\(\{ animation: "instant" \}\)/);
});

test("MessageScroller still owns live-edge follow after pin-to-top returns", () => {
  assert.match(timelineSource, /<MessageScroller/);
  assert.match(timelineSource, /onFollowChange=\{controller\.setAutoScrollFromScroller\}/);
  assert.match(scrollerSource, /followThreshold\?\: number/);
  assert.match(engineSource, /ResizeObserver/);
  assert.match(scrollerSource, /onWheel/);
  assert.match(scrollerSource, /onTouchStart/);
});
