import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { readRendererStyles } from "./helpers/rendererStyles.mjs";

const styles = readRendererStyles();

function cssRule(selector) {
  return styles.match(new RegExp(`${selector} \\{([\\s\\S]*?)\\n\\}`))?.[1];
}

test("drawer header uses the panel white and matches the visible toolbar baseline", () => {
  const drawerHeader = cssRule("\\.drawer-header");

  assert.ok(drawerHeader, "drawer header styles must exist");
  assert.match(drawerHeader, /height:\s*55px;/);
  assert.match(drawerHeader, /flex:\s*0 0 55px;/);
  assert.match(drawerHeader, /background:\s*var\(--color-bg-panel\);/);
});

test("drawer does not cast a shadow over the adjacent white pane", () => {
  // 用行首锚定取裸 .detail-drawer 规则，避免误中 .shell-panel-drawer .detail-drawer
  // （AppShell resizable-panels 的高度作用域规则，不含 box-shadow 语义）
  const drawer = styles.match(/(?:^|\n)\.detail-drawer \{([\s\S]*?)\n\}/)?.[1];

  assert.ok(drawer, "drawer styles must exist");
  assert.match(drawer, /box-shadow:\s*none;/);
});
