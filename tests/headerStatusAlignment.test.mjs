import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { readRendererStyles } from "./helpers/rendererStyles.mjs";

const appSource = readFileSync("src/renderer/src/App.tsx", "utf8");
const sessionViewSource = readFileSync(
  "src/renderer/src/components/session/SessionView.tsx",
  "utf8",
);
const headerSource = readFileSync(
  "src/renderer/src/components/session/SessionHeader.tsx",
  "utf8",
);
const css = readRendererStyles();

function componentInvocation(source, componentName) {
  const start = source.indexOf(`<${componentName}`);
  const end = source.indexOf("/>", start);
  assert.notEqual(start, -1, `${componentName} invocation must exist`);
  assert.notEqual(end, -1, `${componentName} invocation must be self-closing`);
  return source.slice(start, end + 2);
}

function cssRule(selector) {
  return css.match(new RegExp(`${selector} \\{([\\s\\S]*?)\\n\\}`))?.[1] ?? "";
}

test("header status cards share the right-aligned actions group", () => {
  const actionsIndex = headerSource.indexOf("chat-header-actions");
  const sessionStatusIndex = headerSource.indexOf("<SessionStatus");
  const rightActionsIndex = headerSource.indexOf('className="header-actions-right"');
  const sessionHeader = componentInvocation(sessionViewSource, "SessionHeader");

  assert.ok(sessionStatusIndex > actionsIndex, "runtime status must be inside header actions");
  assert.ok(sessionStatusIndex < rightActionsIndex, "runtime status must precede Session actions");
  assert.match(sessionHeader, /runtimeState=\{activeRuntimeState\}/);
  assert.match(cssRule("\\.chat-header-actions"), /justify-self:\s*end;/);
  assert.match(cssRule("\\.header-actions-right"), /margin-left:\s*0;/);
});
