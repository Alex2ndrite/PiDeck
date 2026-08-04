import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const surface = readFileSync(
  "src/renderer/src/components/session/SessionStartSurface.tsx",
  "utf8",
);
const timeline = readFileSync(
  "src/renderer/src/components/session/SessionMessageTimeline.tsx",
  "utf8",
);
const injector = readFileSync(
  "src/renderer/src/components/session/SessionRuntimeInjector.tsx",
  "utf8",
);
const app = readFileSync("src/renderer/src/App.tsx", "utf8");
const zh = readFileSync("src/renderer/src/i18n/rendererCopy.zh-CN.ts", "utf8");
const en = readFileSync("src/renderer/src/i18n/rendererCopy.en-US.ts", "utf8");

test("new session surface provides engineering quick prompts and inserts the selected prompt", () => {
  assert.match(surface, /QUICK_ACTIONS/);
  assert.match(surface, /sessionStart\.inspectPrompt/);
  assert.match(surface, /sessionStart\.planPrompt/);
  assert.match(surface, /sessionStart\.debugPrompt/);
  assert.match(surface, /onQuickPrompt\(t\(promptKey\)\)/);
  assert.match(surface, /selectedPrompt/);
  assert.match(surface, /aria-pressed=\{selected\}/);
  assert.match(surface, /disabled=\{!props\.onQuickPrompt\}/);
});

test("empty active sessions render the start surface and put prompts into the composer", () => {
  assert.match(timeline, /activeMessages\.length === 0/);
  assert.match(timeline, /<SessionStartSurface onQuickPrompt=\{props\.onQuickPrompt\}/);
  assert.match(injector, /insertQuickPrompt/);
  assert.match(injector, /onQuickPrompt=\{\(message\) => insertQuickPrompt\(currentSessionId, message\)\}/);
  assert.match(app, /insertQuickPrompt=\{insertQuickPrompt\}/);
  assert.match(app, /setSessionDraft\(\{ sessionId, value: message \}\)/);
});

test("quick prompt copy is present in both locale dictionaries", () => {
  for (const key of [
    "sessionStart.eyebrow",
    "sessionStart.title",
    "sessionStart.inspectPrompt",
    "sessionStart.planPrompt",
    "sessionStart.implementPrompt",
    "sessionStart.debugPrompt",
    "sessionStart.testPrompt",
    "sessionStart.reviewPrompt",
  ]) {
    assert.match(zh, new RegExp(`\\"${key}\\"`));
    assert.match(en, new RegExp(`\\"${key}\\"`));
  }
});
