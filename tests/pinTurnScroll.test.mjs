import assert from "node:assert/strict";
import test from "node:test";
import {
  animateScrollTop,
  measurePinSpacerHeight,
  pinScrollDurationMs,
  pinScrollEase,
} from "../src/renderer/src/lib/pinTurnScroll.ts";

test("pin scroll duration is short for small jumps and capped for long transcripts", () => {
  assert.equal(pinScrollDurationMs(0), 380);
  assert.equal(pinScrollDurationMs(100), 380);
  assert.equal(pinScrollDurationMs(500), 440);
  assert.equal(pinScrollDurationMs(10_000), 780);
});

test("pin scroll ease is ease-out quart from 0 to 1", () => {
  assert.equal(pinScrollEase(0), 0);
  assert.equal(pinScrollEase(1), 1);
  assert.equal(pinScrollEase(-1), 0);
  assert.equal(pinScrollEase(2), 1);
  const mid = pinScrollEase(0.5);
  assert.ok(mid > 0.9, `ease-out quart at 0.5 should be near 1, got ${mid}`);
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
