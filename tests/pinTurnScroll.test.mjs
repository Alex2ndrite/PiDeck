import assert from "node:assert/strict";
import test from "node:test";
import {
  animateScrollTop,
  measurePinSpacerHeight,
  pinScrollDurationMs,
  pinScrollEase,
  resolvePinTurnOnTailChange,
} from "../src/renderer/src/lib/pinTurnScroll.ts";

test("pin scroll duration is short for small jumps and capped for long transcripts", () => {
  assert.equal(pinScrollDurationMs(0), 420);
  assert.equal(pinScrollDurationMs(100), 420);
  assert.equal(pinScrollDurationMs(500), 460);
  assert.equal(pinScrollDurationMs(10_000), 860);
});

test("pin scroll ease is a soft spring that overshoots then settles", () => {
  assert.equal(pinScrollEase(0), 0);
  assert.equal(pinScrollEase(1), 1);
  assert.equal(pinScrollEase(-1), 0);
  assert.equal(pinScrollEase(2), 1);
  const mid = pinScrollEase(0.5);
  // 中段接近匀速，不能再像 quart 那样 0.5 就冲到 0.9+。
  assert.ok(mid > 0.45 && mid < 0.8, `spring mid should stay linear-ish, got ${mid}`);
  const late = pinScrollEase(0.82);
  assert.ok(late > 1, `soft spring should overshoot before settle, got ${late}`);
});

test("empty-session send pins the pending user immediately", () => {
  assert.equal(
    resolvePinTurnOnTailChange({
      messages: [{ id: "req-1", role: "user" }],
      pendingRequestId: "req-1",
    }),
    "req-1",
  );
  // 气泡先上屏、requestId 后到：尾没变也要钉。
  assert.equal(
    resolvePinTurnOnTailChange({
      previousTail: "req-1",
      messages: [{ id: "req-1", role: "user" }],
      pendingRequestId: "req-1",
    }),
    "req-1",
  );
  assert.equal(
    resolvePinTurnOnTailChange({
      previousTail: "req-1",
      messages: [{ id: "req-1", role: "user" }],
      pendingRequestId: "req-1",
      alreadyPinnedId: "req-1",
    }),
    undefined,
  );
});

test("history first paint does not pin the last historical user", () => {
  assert.equal(
    resolvePinTurnOnTailChange({
      messages: [
        { id: "old-user", role: "user" },
        { id: "old-assistant", role: "assistant" },
      ],
    }),
    undefined,
  );
  // 进行中的发送还没进列表：不能把历史最后一条用户消息当成刚发出的。
  assert.equal(
    resolvePinTurnOnTailChange({
      messages: [
        { id: "old-user", role: "user" },
        { id: "old-assistant", role: "assistant" },
      ],
      pendingRequestId: "req-new",
    }),
    undefined,
  );
  assert.equal(
    resolvePinTurnOnTailChange({
      messages: [{ id: "old-user", role: "user" }],
      pendingRequestId: "req-new",
    }),
    undefined,
  );
});

test("runtime flush replacing optimistic id still pins the latest user", () => {
  assert.equal(
    resolvePinTurnOnTailChange({
      previousTail: "optimistic-user",
      messages: [
        { id: "authoritative-user", role: "user" },
        { id: "assistant-1", role: "assistant" },
      ],
      pendingRequestId: "optimistic-user",
    }),
    "authoritative-user",
  );
});

function createFakeScroller(scrollTop = 0) {
  return { scrollTop };
}

test("animateScrollTop jumps instantly when motion is reduced", () => {
  const el = createFakeScroller(40);
  let completed = 0;
  const cancel = animateScrollTop(el, 400, {
    reduceMotion: true,
    onComplete: () => {
      completed += 1;
    },
  });
  assert.equal(el.scrollTop, 400);
  assert.equal(completed, 1);
  cancel();
});

test("animateScrollTop tweens with injected raf", () => {
  const el = createFakeScroller(0);
  const queued = [];
  let clock = 0;
  animateScrollTop(el, 1000, {
    now: () => clock,
    raf: (callback) => {
      queued.push(callback);
      return queued.length;
    },
    caf: () => undefined,
  });
  queued.shift()?.();
  assert.equal(el.scrollTop, 0);
  clock = 200;
  queued.shift()?.(clock);
  const expected = 1000 * pinScrollEase(200 / pinScrollDurationMs(1000));
  assert.ok(el.scrollTop > 0 && el.scrollTop < 1000);
  assert.ok(Math.abs(el.scrollTop - expected) < 1);
});

test("pin spacer keeps the user message one inset below the viewport top", () => {
  assert.equal(
    measurePinSpacerHeight({
      rowTop: 2400,
      clientHeight: 800,
      contentWithoutSpacer: 2480,
    }),
    700,
  );
  assert.equal(
    measurePinSpacerHeight({
      rowTop: 2400,
      clientHeight: 800,
      contentWithoutSpacer: 3200,
    }),
    0,
  );
});

test("animateScrollTop cancel prevents later frames from writing scrollTop", () => {
  const el = createFakeScroller(0);
  const queued = [];
  const cancel = animateScrollTop(el, 800, {
    now: () => 0,
    raf: (callback) => {
      queued.push(callback);
      return queued.length;
    },
    caf: () => undefined,
  });
  queued.shift()?.();
  cancel();
  const before = el.scrollTop;
  queued.shift()?.(400);
  assert.equal(el.scrollTop, before);
});
