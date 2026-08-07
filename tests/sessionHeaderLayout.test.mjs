import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sessionView = readFileSync(
  "src/renderer/src/components/session/SessionView.tsx",
  "utf8",
);
const runtimeInjector = readFileSync(
  "src/renderer/src/components/session/SessionRuntimeInjector.tsx",
  "utf8",
);
const surfaces = readFileSync("src/renderer/src/styles/surfaces.css", "utf8");
const foundation = readFileSync("src/renderer/src/styles/foundation.css", "utf8");

test("session status and actions embed into the tab bar right slot", () => {
  const sessionTop = sessionView.indexOf("<SessionTabsBar");
  const contentStart = sessionView.indexOf("<ResizablePanelGroup", sessionTop);
  assert.notEqual(sessionTop, -1);
  assert.notEqual(contentStart, -1);
  const headerArea = sessionView.slice(sessionTop, contentStart);

  // 状态徽章/会话操作/抽屉按钮以 embedded 模式嵌入 Tab 栏右侧，不再单独占一行；
  // 只有无会话空态才保留 actions 为 undefined（Tab 栏自带抽屉快捷入口）。
  assert.match(headerArea, /<SessionTabsBar\s+\{\.\.\.sessionTabs\}/);
  assert.match(headerArea, /actions=\{\s*<SessionHeader/);
  assert.match(headerArea, /<SessionHeader[\s\S]*?embedded[\s\S]*?\/>/);
});

test("session status and new-session controls use the shared medium radius", () => {
  // Tab 栏右侧嵌入状态徽章；运行控制（停止/重启）在 Tab 下拉，combo 控件已移除。
  const statusBlock = surfaces.slice(
    surfaces.indexOf(".session-status span"),
    surfaces.indexOf(".session-status .ctx-chip"),
  );

  assert.match(statusBlock, /border-radius:\s*var\(--radius-md\)/);
  assert.doesNotMatch(foundation, /\.session-combo-trigger/);
});

test("restart is offered only when the current session has a bound Agent", () => {
  assert.match(
    runtimeInjector,
    /showRestart=\{Boolean\(runtime\.activeAgentId\) && !isLanWeb\}/,
  );
});
