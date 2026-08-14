import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const surface = readFileSync(
  "src/renderer/src/components/session/SessionStartSurface.tsx",
  "utf8",
);
const view = readFileSync("src/renderer/src/components/session/SessionView.tsx", "utf8");
const timeline = readFileSync(
  "src/renderer/src/components/session/SessionMessageTimeline.tsx",
  "utf8",
);
const zh = readFileSync("src/renderer/src/i18n/rendererCopy.zh-CN.ts", "utf8");
const en = readFileSync("src/renderer/src/i18n/rendererCopy.en-US.ts", "utf8");

test("start surface reuses the session bottom composer, not a second input implementation", () => {
  // 统一输入：直接居中挂完整 ComposerArea（模型/思考/模式/安全级别/发送全保留），
  // 禁止再出现自制 TipTapComposer / waitRuntimeReady / sendPrompt 链路。
  assert.match(surface, /<ComposerArea/);
  assert.match(surface, /import \{ ComposerArea \} from "\.\/ComposerArea"/);
  assert.match(surface, /import \{ QueuedPromptPanel \} from "\.\/ComposerPanels"/);
  assert.match(surface, /useSessionPaneServices\(\)/);
  assert.match(surface, /queuedPromptsBySession\[props\.sessionId\]/);
  assert.match(surface, /<LogoMark size=\{56\} \/>/);
  assert.doesNotMatch(surface, /TipTapComposer/);
  assert.doesNotMatch(surface, /waitRuntimeReady|sendPrompt|getComposerEnterIntent/);
});

test("start surface centers the composer and keeps quick-prompt chips", () => {
  // DeepSeek 式居中：flex 列 + 重心下移；快捷项点击填入输入框不自动发送
  assert.match(surface, /justify-center/);
  assert.match(surface, /pt-\[14vh\]/);
  assert.match(surface, /max-w-\[880px\]/);
  assert.match(surface, /defaultHeight=\{220\}/);
  assert.match(surface, /session-start-surface/);
  assert.match(surface, /QUICK_ACTIONS/);
  assert.match(surface, /sessionStart\.inspectPrompt/);
  assert.match(surface, /sessionStart\.planPrompt/);
  assert.match(surface, /sessionStart\.debugPrompt/);
  assert.match(surface, /insertQuickPrompt\(props\.sessionId, t\(action\.prompt\)\)/);
  assert.match(surface, /t\(action\.title\)/);
});

test("bottom composer is hidden while the start surface is showing", () => {
  // 无消息时底部栏不渲染，避免同屏两个输入框；有消息后回归
  assert.match(view, /sessionTimeline\.messages\.length > 0/);
  assert.match(view, /ResizablePanel\s*\n\s*id="composer"/);
});

test("empty active sessions render the start surface with the session id", () => {
  assert.match(timeline, /activeMessages\.length === 0/);
  assert.match(timeline, /<SessionStartSurface sessionId=\{sessionId\} \/>/);
});

test("quick prompt copy is present in both locale dictionaries", () => {
  for (const key of [
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
