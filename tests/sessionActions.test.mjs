import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  "src/renderer/src/hooks/useSessionActions.ts",
  "utf8",
);

function functionBlock(name, nextName) {
  const start = source.indexOf(`  async function ${name}(`);
  const end = source.indexOf(`  async function ${nextName}(`, start + 1);
  assert.notEqual(start, -1, `${name} implementation should be discoverable`);
  assert.notEqual(end, -1, `${nextName} boundary should be discoverable`);
  return source.slice(start, end);
}

function assertInOrder(subject, fragments, message) {
  let previousIndex = -1;
  for (const fragment of fragments) {
    const index = subject.indexOf(fragment, previousIndex + 1);
    assert.notEqual(index, -1, `${message}: missing ${fragment}`);
    assert.ok(index > previousIndex, `${message}: ${fragment} is out of order`);
    previousIndex = index;
  }
}

const openBySummary = () =>
  functionBlock("openSidebarSession", "openSidebarSessionById");
const openById = () =>
  functionBlock("openSidebarSessionById", "copySidebarSession");
const createDraft = () =>
  functionBlock("createSessionDraft", "resolveSessionRefs");

test("accepts a cached session only when it belongs to the requested project", () => {
  const block = openBySummary();

  assert.equal(
    block.match(/getSessionRecord\(session\.id\)/g)?.length,
    1,
    "the cached record should be read once",
  );
  assertInOrder(
    block,
    [
      "const cachedRecord = getSessionRecord(session.id);",
      "cachedRecord?.projectId === projectId",
      "? cachedRecord",
      ": getProjectSessionRecords(projectId).find(",
      "if (!record)",
      "api.sessions.listCatalog(projectId)",
    ],
    "project identity fallback",
  );
});

test("keeps request sequencing and stale-result gates around catalog fallback", () => {
  const block = openBySummary();

  assertInOrder(
    block,
    [
      "const requestSequence = ++openSessionRequestRef.current;",
      "const cachedRecord = getSessionRecord(session.id);",
      "const projectSessions = await api.sessions.listCatalog(projectId);",
      "if (requestSequence !== openSessionRequestRef.current) return;",
      "replaceProjectSessions({ projectId, sessions: projectSessions });",
    ],
    "catalog stale gate",
  );
  assert.match(
    block,
    /catch \(error\) \{\s*if \(requestSequence !== openSessionRequestRef\.current\) return;\s*showToast/,
  );
  assert.match(
    block,
    /if \(!record \|\| requestSequence !== openSessionRequestRef\.current\) return;\s*setActiveProjectId/,
  );
});

test("matches both project and catalog paths with each candidate environment", () => {
  const block = openBySummary();
  const environmentMatches = block.match(
    /isSameSessionPath\(\s*candidate\.filePath,\s*session\.filePath,\s*candidate\.environment,?\s*\)/g,
  );

  assert.equal(
    environmentMatches?.length,
    2,
    "project and catalog fallbacks must preserve WSL path semantics",
  );
});

test("writes project and session selection before enabling auto-scroll", () => {
  for (const [name, block] of [
    ["openSidebarSession", openBySummary()],
    ["openSidebarSessionById", openById()],
  ]) {
    assertInOrder(
      block,
      [
        "setActiveProjectId(projectId);",
        "setCurrentSessionId(record.id);",
        "setAutoScroll(true);",
        "autoScrollRef.current = true;",
      ],
      `${name} selection writes`,
    );
  }
});

test("focuses the composer after publishing a new draft selection", () => {
  const block = createDraft();

  assertInOrder(
    block,
    [
      "upsertSession(session);",
      "setActiveProjectId(projectId);",
      "setCurrentSessionId(session.id);",
      "setAutoScroll(true);",
      "autoScrollRef.current = true;",
      "requestAnimationFrame(() => composerTextareaRef.current?.focus());",
      "creatingSessionDraftRef.current.delete(projectId);",
    ],
    "draft selection and focus",
  );
});

test("matches project sync refresh return types and silent semantics", () => {
  assert.match(
    source,
    /export type RefreshSessions = \(\s*projectId\?: string,?\s*\) => Promise<SessionSummary\[\]>;/,
  );
  assert.match(
    source,
    /export type RefreshProjectSessions = \(\s*projectId: string,\s*silent\?: boolean,?\s*\) => Promise<SessionSummary\[\] \| SessionRecord\[\] \| undefined>;/,
  );
  assert.match(source, /refreshSessions: RefreshSessions;/);
  assert.match(source, /refreshProjectSessions: RefreshProjectSessions;/);
  assert.doesNotMatch(source, /\bnoCache\b/);
  assert.doesNotMatch(
    source,
    /\b(?:setProjectMenu|setSessionHistoryLoading|setSessionLoadingByProject)\b/,
  );
});
