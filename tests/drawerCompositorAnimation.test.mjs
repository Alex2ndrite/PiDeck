import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { readRendererStyles } from "./helpers/rendererStyles.mjs";

const appShell = readFileSync("src/renderer/src/components/app/AppShell.tsx", "utf8");
const styles = readRendererStyles();

function cssRule(selector) {
  return styles.match(new RegExp(`${selector} \\{([\\s\\S]*?)\\n\\}`))?.[1];
}

test("drawer uses only the short grid transition for open and close", () => {
  const shell = cssRule("\\.wechat-shell");
  const drawer = cssRule("\\.detail-drawer");
  const closedDrawer = cssRule(
    '\\.detail-drawer:not\\(\\[data-open="true"\\]\\)',
  );

  assert.ok(shell, "shell styles must exist");
  assert.match(shell, /transition:\s*grid-template-columns 120ms/);
  assert.match(
    styles,
    /body\.is-resizing \.wechat-shell \{\s*transition:\s*none;/,
  );

  assert.ok(drawer, "drawer styles must exist");
  assert.doesNotMatch(drawer, /(?:transform|will-change)\s*:/);
  assert.doesNotMatch(drawer, /transition\s*:\s*transform/);

  assert.ok(closedDrawer, "closed drawer styles must exist");
  assert.match(closedDrawer, /pointer-events:\s*none/);
  assert.doesNotMatch(closedDrawer, /transform\s*:/);
});

test("drawer keeps its content mounted through the layout transition", () => {
  assert.match(appShell, /WorkspaceDrawerHost/);
  assert.match(appShell, /renderPanel=\{\(panel\) => drawerContent\(panel\)\}/);
  assert.match(appShell, /drawer && !drawerCollapsed \? drawerWidth : 0/);
  assert.match(appShell, /drawer && !drawerCollapsed \? 260 : 0/);
});

test("file rows use the integer control line-height token", () => {
  const fileRow = cssRule("\\.file-node-row");

  assert.ok(fileRow, "file row styles must exist");
  assert.match(fileRow, /line-height:\s*var\(--line-height-control\)/);
  assert.doesNotMatch(fileRow, /line-height:\s*1\.28/);
});
