import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const timelineStyles = readFileSync("src/renderer/src/styles/timeline.css", "utf8");
const events = readFileSync("src/renderer/src/components/session/TimelineEventCards.tsx", "utf8");
const surface = readFileSync("src/renderer/src/components/session/SurfaceComponents.tsx", "utf8");

test("responding indicator reserves stable space across status changes", () => {
  assert.match(timelineStyles, /\.responding-indicator[\s\S]*min-width:\s*168px/);
  assert.match(timelineStyles, /\.responding-indicator-label[\s\S]*min-width:\s*108px/);
  assert.match(events, /data-kind=\{kind\}/);
  assert.match(timelineStyles, /data-kind="waiting"[\s\S]*visibility:\s*hidden/);
});

test("starting state has a distinct indicator before response states", () => {
  assert.match(events, /isStarting\?: boolean/);
  assert.match(events, /if \(isStarting\)[\s\S]*kind = "starting"/);
  assert.match(timelineStyles, /\.responding-indicator\[data-kind="starting"\]/);
  assert.match(timelineStyles, /data-kind="starting"[\s\S]*min-width: 196px/);
});
test("reduced motion keeps response state readable without animation", () => {
  assert.match(timelineStyles, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(timelineStyles, /responding-indicator-dots span[\s\S]*opacity:\s*1/);
  assert.match(timelineStyles, /animation:\s*none !important/);
  assert.match(timelineStyles, /transition:\s*none !important/);
});

test("empty state exposes whether a project can be created", () => {
  assert.match(surface, /data-empty-state=\{props\.hasProject \? "project" : "no-project"\}/);
  assert.match(surface, /app\.emptyProjectTitle/);
  assert.match(surface, /app\.emptyNoProject/);
  assert.doesNotMatch(surface, /empty-state-cta/);
});
