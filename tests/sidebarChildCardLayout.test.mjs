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
const agentListDisplay = readFileSync(
  "src/renderer/src/agentListDisplay.ts",
  "utf8",
);
const tabBar = readFileSync(
  "src/renderer/src/components/session/SessionTabsBar.tsx",
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

test("session status dots reuse shared Tailwind colors and stay text-free", () => {
  // 会话/Agent 行与 Tab 共享同一状态点语义：idle=蓝、starting/运行中=黄、error=红。
  assert.match(agentListDisplay, /export function sessionStatusDotClass/);
  assert.match(agentListDisplay, /case "idle"/);
  assert.match(agentListDisplay, /return "bg-info"/);
  assert.match(agentListDisplay, /case "error"/);
  assert.match(agentListDisplay, /return "bg-danger"/);
  assert.match(agentListDisplay, /case "running"/);
  assert.match(agentListDisplay, /return "bg-warning"/);
  // 未启动/无 runtime（含 detached）不渲染色点。
  assert.match(agentListDisplay, /if \(!status \|\| status === "detached"\) return undefined/);
  // SessionTree 不再渲染带文本的状态徽标，改用纯色点。
  assert.doesNotMatch(sessionTree, /\/agent-status-indicator/);
  assert.match(sessionTree, /sessionStatusDotClass\(/);
  // 硺点：无 runtime 的行不回退渲染灰色点；仅当 helper 返回颜色时条件渲染。
  assert.doesNotMatch(sessionTree, /\?\? \"bg-muted-foreground\/50\"|\?\? \"bg-border\"/);
  assert.match(sessionTree, /\{sessionStatusDotClass\(child\.agent\.status\) && <span/);
  assert.match(sessionTree, /\{sessionStatusDotClass\(runtime\?\.status\) && <span/);
  // Tab 同样未启动不显示点，已启动按状态点渲染。
  assert.match(tabBar, /sessionStatusDotClass\(status\)/);
  assert.match(tabBar, /dotClass &&/);
});
