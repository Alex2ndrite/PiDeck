import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("src/renderer/src/App.tsx", "utf8");

test("new conversation creates a metadata-only Session draft", () => {
  const createDraftSource = source.match(
    /async function createSessionDraft\([\s\S]*?\n  function applyAgentRuntimeState/,
  )?.[0] ?? "";
  assert.match(createDraftSource, /api\.sessions\.createDraft\(\{/);
  assert.match(createDraftSource, /setCurrentSessionId\(session\.id\)/);
  assert.match(createDraftSource, /setActiveAgentId\(undefined\)/);
  assert.doesNotMatch(createDraftSource, /api\.agents\.create/);
});

test("renderer has no direct Agent creation path", () => {
  assert.doesNotMatch(source, /async function createAgent\(/);
  assert.doesNotMatch(source, /api\.agents\.create\(/);
  assert.match(source, /void createSessionDraft\(project\.id\)/);
});
