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
const app = readFileSync("src/renderer/src/App.tsx", "utf8");
const surfaces = readFileSync("src/renderer/src/styles/surfaces.css", "utf8");
const foundation = readFileSync("src/renderer/src/styles/foundation.css", "utf8");

test("session tabs mount once outside SessionView; pane keeps standalone header", () => {
  // Tab 栏统一外置；SessionView 只保留会话操作 Header（抽屉开关在共享 Tab 栏）。
  assert.doesNotMatch(sessionView, /SessionTabsBar/);
  assert.match(app, /sessionTabsBarNode/);
  assert.match(app, /SessionPaneServicesProvider/);
  // Tab 栏挂在 WorkbenchStage chrome，分屏之上（与文件 Tab 同一条）
  assert.match(app, /chrome=\{sessionTabsBarNode\}/);
  assert.doesNotMatch(app, /\{sessionTabsBarNode\}\s*\n\s*\{currentSessionId/);

  const headerStart = sessionView.indexOf("<SessionHeader");
  const contentStart = sessionView.indexOf("<ResizablePanelGroup", headerStart);
  assert.notEqual(headerStart, -1);
  assert.notEqual(contentStart, -1);
  const headerArea = sessionView.slice(headerStart, contentStart);
  assert.match(headerArea, /<SessionHeader/);
  assert.doesNotMatch(headerArea, /onToggleDrawer/);
  assert.doesNotMatch(headerArea, /embedded/);
});

test("session status and new-session controls use the shared medium radius", () => {
  // Tab 栏右侧嵌入状态徽章与操作；chip 与 combo 用同一中号圆角保持一致视觉。
  const statusBlock = surfaces.slice(
    surfaces.indexOf(".session-status span"),
    surfaces.indexOf(".session-status .ctx-chip"),
  );
  const newSessionBlock = foundation.slice(
    foundation.indexOf(".session-combo-trigger {"),
    foundation.indexOf(".session-combo-trigger:hover"),
  );

  assert.match(statusBlock, /border-radius:\s*var\(--radius-md\)/);
  assert.match(newSessionBlock, /border-radius:\s*var\(--radius-md\)/);
});

test("restart is offered only when the current session has a bound Agent", () => {
  assert.match(
    runtimeInjector,
    /showRestart=\{Boolean\(runtime\.activeAgentId\) && !services\.isLanWeb\}/,
  );
});

test("split panes show per-pane session title in SessionHeader", () => {
  // 共享顶栏 Tab 时，分屏各栏靠 paneTitle 对上「这栏是谁」；单栏不重复标题。
  const header = readFileSync(
    "src/renderer/src/components/session/SessionHeader.tsx",
    "utf8",
  );
  assert.match(header, /paneTitle\?:/);
  assert.match(header, /session-pane-title/);
  assert.match(sessionView, /paneTitle=\{splitPane \? sessionTitle : undefined\}/);
});

test("session header has no bottom border under pane identity row", () => {
  const header = readFileSync(
    "src/renderer/src/components/session/SessionHeader.tsx",
    "utf8",
  );
  // 身份标题下不再叠 border-b，避免分屏/单栏碎线
  assert.doesNotMatch(
    header,
    /chat-header[^"]*border-b/,
  );
});

test("split panes expose exit-split expand control on the left", () => {
  const header = readFileSync(
    "src/renderer/src/components/session/SessionHeader.tsx",
    "utf8",
  );
  assert.match(header, /onExitSplit\?:/);
  assert.match(header, /Maximize2/);
  assert.match(header, /session\.split\.exit/);
  assert.match(sessionView, /onExitSplit=\{splitPane \? paneServices\.exitSessionSplit : undefined\}/);
  assert.match(app, /exitSessionSplit:\s*workspaceChrome\.exitSplit/);
  const chrome = readFileSync(
    "src/renderer/src/hooks/useSessionWorkspaceChrome.ts",
    "utf8",
  );
  assert.match(chrome, /const exitSplit = useCallback/);
});
