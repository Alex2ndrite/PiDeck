import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const composerArea = readFileSync(
  "src/renderer/src/components/session/ComposerArea.tsx",
  "utf8",
);
const overlay = readFileSync(
  "src/renderer/src/components/overlays/SessionRuntimeUiOverlay.tsx",
  "utf8",
);

/**
 * 这些是布局回归契约：runtime UI 属于 composer 的可收缩内容，不能再用
 * 一个固定高度的子盒子叠加 ask 卡片，否则 ask 出现时输入框会被推出面板。
 */
test("composer keeps runtime ask and input inside the resizable panel", () => {
  assert.match(composerArea, /className="composer[^\"]*min-h-0[^\"]*overflow-hidden/);
  assert.match(composerArea, /composer-box relative flex min-h-0[^\"]*flex-1/);
  assert.doesNotMatch(composerArea, /className="composer-box[\s\S]*?style=\{\{ height:/);
});

test("ask inline bar uses shadcn Collapsible for its fold state", () => {
  assert.match(overlay, /from "\.\.\/ui-shadcn\/collapsible"/);
  assert.match(overlay, /<Collapsible[\s\S]*open=/);
  assert.match(overlay, /<CollapsibleTrigger/);
  assert.match(overlay, /<CollapsibleContent/);
});
