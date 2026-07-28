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
  const drawer = cssRule("\\.detail-drawer");

  assert.ok(drawer, "drawer styles must exist");
  assert.match(drawer, /box-shadow:\s*none;/);
});
