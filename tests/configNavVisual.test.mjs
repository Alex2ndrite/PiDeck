import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("Pi management navigation follows the settings tab visual rhythm", () => {
  const styles = readFileSync("src/renderer/src/styles/surfaces.css", "utf8");
  const modal = readFileSync("src/renderer/src/ConfigModal.tsx", "utf8");

  assert.match(modal, /config-nav-btn/);
  assert.match(styles, /\.config-sidebar-group \{[\s\S]*?gap: 4px;/);
  assert.match(styles, /\.config-sidebar-group \+ \.config-sidebar-group \{[\s\S]*?margin-top: 6px;/);
  assert.match(styles, /\.config-nav-btn \{[\s\S]*?font-family: var\(--font-family-sans/);
  assert.match(styles, /\.config-nav-btn\.active \{[\s\S]*?box-shadow:/);
  assert.match(styles, /\.config-nav-btn:hover:not\(\.active\)/);
});
