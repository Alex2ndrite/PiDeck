import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { readRendererStyles } from "./helpers/rendererStyles.mjs";

const appShell = readFileSync("src/renderer/src/components/app/AppShell.tsx", "utf8");
const styles = readRendererStyles();

function cssRule(selector) {
  return styles.match(new RegExp(`${selector} \\{([\\s\\S]*?)\\n\\}`))?.[1];
}

test("drawer motion is delegated to resizable panels, not CSS grid transition", () => {
  const shell = cssRule("\\.wechat-shell");
  const drawer = cssRule("\\.detail-drawer");
  const closedDrawer = cssRule(
    '\\.detail-drawer:not\\(\\[data-open="true"\\]\\)',
  );

  assert.ok(shell, "shell styles must exist");
  // #115 U5：三栏宽度由 react-resizable-panels 接管，shell 不再使用 grid 轨道过渡
  assert.doesNotMatch(shell, /transition:\s*grid-template-columns/);
  assert.match(shell, /display:\s*flex/);

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
  assert.match(
    appShell,
    /"--drawer-col-w": `\$\{drawer && !drawerCollapsed \? drawerWidth : 0\}px`/,
  );
});

test("closed drawer does not reserve horizontal gutter", () => {
  // 关闭时必须仍可 collapse（不能 collapsible={Boolean(drawer)}，否则卡在 minSize）
  assert.match(appShell, /id="drawer"[\s\S]*?collapsible\n/);
  assert.doesNotMatch(appShell, /collapsible=\{Boolean\(drawer\)\}/);
  // CSS 兜底：未打开时强制 0 宽，避免偶发 1px/minSize 缝
  assert.match(
    styles,
    /\.wechat-shell:not\(\.drawer-open\) \.shell-panel-drawer \{[\s\S]*?max-width:\s*0 !important;/,
  );
});

test("file rows use the integer control line-height token", () => {
  const fileRow = cssRule("\\.file-node-row");

  assert.ok(fileRow, "file row styles must exist");
  assert.match(fileRow, /line-height:\s*var\(--line-height-control\)/);
  assert.doesNotMatch(fileRow, /line-height:\s*1\.28/);
});
