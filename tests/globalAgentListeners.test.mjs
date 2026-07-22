import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  "src/renderer/src/hooks/useGlobalAgentListeners.ts",
  "utf8",
);
const app = readFileSync("src/renderer/src/App.tsx", "utf8");

test("global listener owner handles inventory, capability, project, settings, app, and trust events", () => {
  for (const listener of [
    "projects.onChanged",
    "agents.onState",
    "agents.onRuntimeState",
    "agents.onLog",
    "agents.onFocusTarget",
    "agents.onTrustRequest",
    "settings.onApplyWindow",
    "app.onUpdateProgress",
    "app.onOpenInBrowser",
  ]) {
    assert.match(source, new RegExp(listener.replace(".", "\\.")), listener);
  }
  assert.match(source, /return \(\) => \{[\s\S]*offProjects\(\)[\s\S]*offState\(\)[\s\S]*offRuntimeState\(\)/);
  assert.match(source, /disposed = true/);
});

test("global listener owner explicitly excludes Session message, thinking, and UI request streams", () => {
  assert.doesNotMatch(source, /\.onMessages\(/);
  assert.doesNotMatch(source, /\.onThinking\(/);
  assert.doesNotMatch(source, /\.onUiRequest\(/);
  assert.doesNotMatch(app, /api\.agents\.(?:onMessages|onThinking|onUiRequest)\(/);
  assert.match(app, /useGlobalAgentListeners\(/);
});
