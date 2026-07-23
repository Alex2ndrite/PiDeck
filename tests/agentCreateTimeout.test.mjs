import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("src/renderer/src/hooks/useSessionActions.ts", "utf8");
const app = readFileSync("src/renderer/src/App.tsx", "utf8");

test("new conversation creates a metadata-only Session draft", () => {
  const createDraftSource = source.match(
    /async function createSessionDraft\([\s\S]*?\n  \}\n\n  \/\/ ── Session references ──/,
  )?.[0] ?? "";
  assert.match(createDraftSource, /api\.sessions\.createDraft\(\{/);
  assert.match(createDraftSource, /setActiveProjectId\(projectId\)/);
  assert.match(createDraftSource, /setCurrentSessionId\(session\.id\)/);
  assert.doesNotMatch(createDraftSource, /setActiveAgentId/);
  assert.doesNotMatch(createDraftSource, /api\.agents\.create/);
});

test("renderer has no direct Agent creation path", () => {
  assert.doesNotMatch(app, /async function createAgent\(/);
  assert.doesNotMatch(app, /api\.agents\.create\(/);
  assert.match(app, /void runCreateSessionDraft\(/);
});
