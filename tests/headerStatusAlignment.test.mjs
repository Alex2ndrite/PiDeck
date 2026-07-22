import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const headerSource = readFileSync(
  "src/renderer/src/components/session/SessionHeader.tsx",
  "utf8",
);
const css = readFileSync("src/renderer/src/styles.css", "utf8");

function cssRule(selector) {
  return css.match(new RegExp(`${selector} \\{([\\s\\S]*?)\\n\\}`))?.[1] ?? "";
}

test("header status cards share the right-aligned actions group", () => {
  const actionsIndex = headerSource.indexOf("chat-header-actions");
  const sessionStatusIndex = headerSource.indexOf("<SessionStatus");
  const rightActionsIndex = headerSource.indexOf('className="header-actions-right"');

  assert.ok(sessionStatusIndex > actionsIndex, "runtime status must be inside header actions");
  assert.ok(sessionStatusIndex < rightActionsIndex, "runtime status must precede Session actions");
  assert.match(cssRule("\\.chat-header-actions"), /justify-self:\s*end;/);
  assert.match(cssRule("\\.header-actions-right"), /margin-left:\s*0;/);
});
