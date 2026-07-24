import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const terminalHook = readFileSync("src/renderer/src/hooks/useTerminalDock.ts", "utf8");
const runtimeDock = readFileSync("src/renderer/src/components/session/SessionRuntimeDock.tsx", "utf8");
const styles = readFileSync("src/renderer/src/styles.css", "utf8");

function cssRule(selector) {
  return styles.match(new RegExp(`${selector} \\{([\\s\\S]*?)\\n\\}`))?.[1];
}

test("terminal dock combines a short grid transition with composited motion", () => {
  const chatPane = cssRule("\\.chat-pane");
  const terminalDock = cssRule("\\.terminal-dock");

  assert.ok(chatPane, "chat pane styles must exist");
  assert.match(chatPane, /transition:\s*grid-template-rows 120ms/);
  assert.ok(terminalDock, "terminal dock styles must exist");
  assert.match(terminalDock, /will-change:\s*transform;/);
  assert.match(terminalDock, /transition:\s*transform/);
  assert.match(styles, /\.terminal-dock\[data-motion-state="hidden"\][\s\S]*?translate3d\(0, 100%, 0\)/);
});

test("terminal dock remains mounted while its exit transform runs", () => {
  assert.match(terminalHook, /const TERMINAL_DOCK_MOTION_MS = 180;/);
  assert.match(terminalHook, /const \[terminalDockMounted, setTerminalDockMounted\] = useState\(false\);/);
  assert.match(terminalHook, /const \[terminalDockClosing, setTerminalDockClosing\] = useState\(false\);/);
  assert.match(terminalHook, /window\.setTimeout\(\s*\(\) => \{\s*setTerminalDockMounted\(false\);\s*setTerminalDockClosing\(false\);\s*\},\s*TERMINAL_DOCK_MOTION_MS,/);
  assert.match(runtimeDock, /mounted: boolean;/);
  assert.match(runtimeDock, /closing: boolean;/);
  assert.match(runtimeDock, /closing=\{props\.closing\}/);
});
