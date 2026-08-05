// 回归测试：sonner Toaster 挂载探测必须走显式 ready 标记，不能用 DOM 探测。
// 背景：sonner 2.x 在没有可见 toast 时不渲染任何 DOM（`if (!filteredToasts.length) return null`），
// 旧的 querySelector("[data-sonner-toaster]") 探测会在每个首个 toast 前误判未挂载，
// 导致所有通知永远走 DOM 兜底（黑底药丸样式），sonner 美化样式完全不生效。
import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";

const notice = readFileSync("src/renderer/src/utils/notice.ts", "utf8");
const toaster = readFileSync("src/renderer/src/components/ui-shadcn/sonner.tsx", "utf8");
const surfaces = readFileSync("src/renderer/src/styles/surfaces.css", "utf8");

test("toaster mounted state is reported explicitly, not probed via DOM", () => {
  assert.match(notice, /export function setToasterReady/);
  assert.doesNotMatch(notice, /querySelector\("\[data-sonner-toaster\]"\)/);
  assert.match(toaster, /setToasterReady\(true\)/);
  assert.match(toaster, /closeButton/);
  // 顶部 offset 必须让开自定义标题栏拖拽区，否则关闭按钮点击被 drag 命中测试吞掉
  assert.match(toaster, /var\(--window-drag-height/);
});

test("sonner toast uses neutral panel tokens instead of the dark pill", () => {
  assert.match(toaster, /background:\s*"var\(--color-bg-panel\)"/);
  assert.match(toaster, /var\(--shadow-popover\)/);
  // 兜底 DOM toast 也不再使用黑色背景
  assert.doesNotMatch(notice, /rgba\(17,19,21/);
});

test("typed toast icons carry semantic colors", () => {
  assert.match(surfaces, /\[data-sonner-toast\]\[data-type="error"\] \[data-icon\]/);
  assert.match(surfaces, /\[data-sonner-toast\]\[data-type="warning"\] \[data-icon\]/);
});

test("toaster is excluded from the window drag region and drag height is exposed at :root", () => {
  // Electron 自定义标题栏的 -webkit-app-region: drag 命中测试优先于 z-index，
  // toaster 必须显式 no-drag，否则首个 toast 的关闭按钮/hover 全部失效
  assert.match(surfaces, /\[data-sonner-toaster\][\s\S]*?-webkit-app-region:\s*no-drag/);
  // toaster 不是 .wechat-shell 的后代，--window-drag-height 必须在 :root 可读
  const foundation = readFileSync("src/renderer/src/styles/foundation.css", "utf8");
  assert.match(foundation, /:root:has\(\.wechat-shell\.custom-titlebar-enabled\)/);
});
