import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const projectTree = readFileSync("src/renderer/src/components/sidebar/ProjectTree.tsx", "utf8");
const projectAvatar = readFileSync("src/renderer/src/components/sidebar/SidebarComponents.tsx", "utf8");
const agentAvatar = readFileSync("src/renderer/src/components/session/SurfaceComponents.tsx", "utf8");
const foundation = readFileSync("src/renderer/src/styles/foundation.css", "utf8");

test("project Avatar derives one stable status from project agents", () => {
  assert.match(projectTree, /const projectAgents = props\.controller\.catalog\.agents\.filter/);
  assert.match(projectTree, /const projectStatus = projectAgents\.some/);
  assert.match(projectTree, /<ProjectAvatar[\s\S]*status=\{projectStatus\}/);
});

test("ProjectAvatar exposes status as an accessible, theme-aware indicator", () => {
  assert.match(projectAvatar, /status\?: "idle" \| "running" \| "starting" \| "error"/);
  assert.match(projectAvatar, /data-avatar-status=\{props\.status \?\? "idle"\}/);
  assert.match(projectAvatar, /avatar-status-indicator/);
  assert.match(foundation, /\.avatar-status-running \.avatar-status-indicator/);
});

test("AgentAvatar uses the same four status states", () => {
  assert.match(agentAvatar, /normalizedStatus = props\.status === "running"/);
  assert.match(agentAvatar, /data-avatar-status=\{normalizedStatus\}/);
  assert.match(agentAvatar, /normalizedStatus === "error"/);
  assert.match(agentAvatar, /normalizedStatus === "starting"/);
  assert.match(agentAvatar, /normalizedStatus === "running"/);
});

test("Avatar status indicator keeps fixed geometry and semantic tokens", () => {
  assert.match(foundation, /\.avatar-status-indicator \{/);
  assert.match(foundation, /width: 11px/);
  assert.match(foundation, /height: 11px/);
  assert.match(foundation, /var\(--color-accent\)/);
  assert.match(foundation, /var\(--color-warning\)/);
  assert.match(foundation, /var\(--color-danger\)/);
});
