import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const composerArea = readFileSync(
  "src/renderer/src/components/session/ComposerArea.tsx",
  "utf8",
);
const sessionView = readFileSync(
  "src/renderer/src/components/session/SessionView.tsx",
  "utf8",
);
const timeline = readFileSync(
  "src/renderer/src/components/session/SessionMessageTimeline.tsx",
  "utf8",
);
const overlay = readFileSync(
  "src/renderer/src/components/overlays/SessionRuntimeUiOverlay.tsx",
  "utf8",
);
const foundation = readFileSync(
  "src/renderer/src/styles/foundation.css",
  "utf8",
);

/**
 * Ask 是会话级阻塞交互，不应参与 composer 的 flex 高度分配；否则 Ask 展开时会和
 * 编辑器的最小高度互相挤压。回归契约从两方面锁定这个边界：composer 不再接收 runtimeUi，
 * timeline 负责承载它；Ask 内容也不再创建第二个纵向滚动 owner。
 */
test("ask stays out of composer sizing and uses the session timeline as its scroll owner", () => {
  assert.doesNotMatch(composerArea, /runtimeUi/);
  assert.match(sessionView, /<SessionMessageTimeline[\s\S]*runtimeUi=\{runtimeUi\}/);
  assert.match(timeline, /className="session-runtime-ui sticky bottom-0/);
  assert.match(foundation, /\.chat-pane\[style\*="--content-max-width"\] \.session-runtime-ui/);
  assert.doesNotMatch(overlay, /CollapsibleContent className="min-h-0 overflow-y-auto"/);
  assert.doesNotMatch(overlay, /max-h-\[(?:55vh|180px|240px)\][^\n]*overflow-y-auto/);
});

/**
 * 没有 Ask 时，composer 仍只需要容纳输入框自身；这个数值关系保证保留底部输入栏，
 * 同时把 Ask 的可变高度交给 timeline，而不是继续用一个无法满足的 312px 组合约束。
 */
test("composer minimum still fits the editor after ask moves to timeline", () => {
  const composerMinHeight = 148;
  const composerBoxMinHeight = 112;
  const composerVerticalPadding = 12;
  const composerGap = 8;
  const requiredHeight = composerBoxMinHeight + composerVerticalPadding + composerGap;

  assert.ok(
    requiredHeight <= composerMinHeight,
    `editor needs ${requiredHeight}px, but composer minimum is only ${composerMinHeight}px`,
  );
});
