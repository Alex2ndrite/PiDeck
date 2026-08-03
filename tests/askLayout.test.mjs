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

test("composer default height is raised so ask question and input are both visible", () => {
  // ask 问答 + 底部输入框需要比纯输入框更大的默认可视空间：
  // 面板默认高度 375px，最小仍可缩到 175px（分隔条拖拽），保持原竖向调整能力。
  const rendererUtils = readFileSync("src/renderer/src/rendererUtils.ts", "utf8");
  const sessionView = readFileSync("src/renderer/src/components/session/SessionView.tsx", "utf8");
  assert.match(rendererUtils, /COMPOSER_DEFAULT_HEIGHT = 375/);
  assert.match(sessionView, /COMPOSER_DEFAULT_HEIGHT/);
  assert.match(sessionView, /minSize=\{COMPOSER_MIN_HEIGHT\}/);
  // 面板仍由 react-resizable-panels 接管，可沿分隔条拖拽，保留原有 resizable 能力
  assert.match(sessionView, /ResizablePanelGroup orientation=\"vertical\"/);
  assert.match(sessionView, /id=\"composer\"/);
});

test("ask overlay keeps fold, cancel, batch and resume-height interactions", () => {
  // 折叠（Collapsible+Trigger+Content）、取消（cancel）、批量问答（batch_ask）
  // 与选项/输入交互在高度调整后仍保留：只改默认高度，不动交互逻辑。
  assert.match(overlay, /cancel = \(\) =>/);
  assert.match(overlay, /method === \"batch_ask\"/);
  assert.match(overlay, /BatchAskInlineBar/);
  assert.match(overlay, /ask-inline-bar/);
});

test("ask region has an accessible horizontal-separator resize handle with min/max and drag state", () => {
  // Ask 区域底部提供独立垂直拉伸把手的回归契约（AskRegionResizer）：
  // - 把手存在且可访问：role=separator。这是切分上/下内容的水平分隔线，交互为上下拖动调整高度，
  //   故 aria-orientation=horizontal（不是 vertical）；带 min/max/current 与键盘操作。
  // - 拖拽状态流转把 move/up/cancel 直接绑在带 pointer capture 的 handle 上（易碎点：旧 bug
  //   只在 mount 注册 window 监听，拖拽开始时不会重新注册，导致鼠标拖动无效）。
  // - 高度夹在 min/max 内，键盘/指针共用同一套夹取逻辑。
  const resizer = readFileSync(
    "src/renderer/src/components/session/AskRegionResizer.tsx",
    "utf8",
  );
  const utils = readFileSync("src/renderer/src/rendererUtils.ts", "utf8");
  // ComposerArea 用该 resizer 包裹 runtimeUi（Ask 附加区），替代原先裸滚动层。
  assert.match(composerArea, /AskRegionResizer/);
  assert.match(composerArea, /<AskRegionResizer child=\{props\.runtimeUi\}/);
  // 可见把手 + 可访问语义
  assert.match(resizer, /role=\"separator\"/);
  assert.match(resizer, /aria-orientation=\"horizontal\"/);
  assert.doesNotMatch(resizer, /aria-orientation=\"vertical\"/);
  assert.match(resizer, /aria-valuemin=\{ASK_MIN_HEIGHT\}/);
  assert.match(resizer, /aria-valuemax=\{ASK_MAX_HEIGHT\}/);
  assert.match(resizer, /aria-valuenow=\{maxHeight\}/);
  // 拖拽状态流转：move/up/cancel 直接绑在带 pointer capture 的 handle 上，随卸载自动清理。
  assert.match(resizer, /onPointerDown=\{\(event\) => \{/);
  assert.match(resizer, /setPointerCapture/);
  assert.match(resizer, /onPointerMove={/);
  assert.match(resizer, /onPointerUp={stopDrag}/);
  assert.match(resizer, /onPointerCancel={stopDrag}/);
  // 无裸 promise / 无 window 级监听：旧 bug 只在 mount 注册，拖拽时不再绑定而失效，必须移除。
  assert.doesNotMatch(resizer, /addEventListener(\"pointermove\")/);
  assert.doesNotMatch(resizer, /addEventListener(\"pointerup\")/);
  // 键盘步进（↑/↓ 保持 min/max 收敛，Page 键倍速）
  assert.match(resizer, /case \"ArrowUp\"/);
  assert.match(resizer, /case \"ArrowDown\"/);
  assert.match(resizer, /setDragging\(true\)/);
  assert.match(resizer, /setDragging\(false\)/);
  assert.match(resizer, /Math\.min\(ASK_MAX_HEIGHT, Math\.max\(ASK_MIN_HEIGHT/);
  // 约束常量在 rendererUtils 定义，让数字与状态流转分离：
  // 测试绑定的是常量名与钳制逻辑，而非某个具体默认数字。
  assert.match(utils, /export const ASK_MIN_HEIGHT =/);
  assert.match(utils, /export const ASK_DEFAULT_MAX_HEIGHT =/);
  assert.match(utils, /export const ASK_MAX_HEIGHT =/);
});
