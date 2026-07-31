import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { readRendererStyles } from "./helpers/rendererStyles.mjs";

/**
 * pure official P2-2：子行尺寸/hover 由组件 Tailwind 承担。
 * 仍保留 session-card 透明容器与状态徽标契约。
 */

const styles = readRendererStyles();
const sessionTree = readFileSync(
  "src/renderer/src/components/sidebar/SessionTree.tsx",
  "utf8",
);
const projectTree = readFileSync(
  "src/renderer/src/components/sidebar/ProjectTree.tsx",
  "utf8",
);

test("sidebar child rows use shared official hover/active classes", () => {
  assert.match(sessionTree, /hover:bg-accent hover:text-accent-foreground/);
  assert.match(sessionTree, /active bg-accent text-accent-foreground/);
  assert.match(sessionTree, /sessionRowClass/);
  assert.match(projectTree, /treeRowClass/);
  assert.match(projectTree, /hover:bg-accent hover:text-accent-foreground/);
});

test("sidebar workspace wrapper stays transparent", () => {
  const workspaceCard = styles.match(
    /\.chat-list-pane\.v3-braun \.sidebar-body \.session-card \{([\s\S]*?)\n\}/,
  )?.[1];
  assert.ok(workspaceCard, "sidebar workspace card styles must exist");
  assert.match(workspaceCard, /background:\s*transparent;/);
  assert.match(workspaceCard, /border:\s*0;/);
  assert.match(workspaceCard, /overflow:\s*visible;/);
});

test("sidebar child titles truncate via component classes", () => {
  assert.match(sessionTree, /truncate font-medium/);
  assert.match(projectTree, /truncate font-medium/);
});

test("sidebar agent statuses use compact color-coded card badges", () => {
  const indicator = styles.match(/\.agent-status-indicator \{([\s\S]*?)\n\}/)?.[1];
  assert.ok(indicator, "sidebar status indicator styles must exist");
  assert.match(indicator, /height:\s*var\(--space-5\);/);
  assert.match(indicator, /padding:\s*0 var\(--space-1\);/);
  assert.match(indicator, /font-size:\s*var\(--font-size-micro\);/);
  assert.match(indicator, /border:\s*1px solid var\(--color-border-subtle\);/);

  for (const [status, color] of [
    ["idle", "info"],
    ["running", "accent"],
    ["starting", "warning"],
    ["error", "danger"],
  ]) {
    const state = styles.match(
      new RegExp(`\\.agent-status-indicator\\.status-${status} \\{([\\s\\S]*?)\\n\\}`),
    )?.[1];
    assert.ok(state, `${status} status styles must exist`);
    assert.match(state, new RegExp(`color:\\s*var\\(--color-${color}\\);`));
    assert.match(state, /border-color:/);
  }
});
