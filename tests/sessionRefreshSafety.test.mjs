import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const projectSync = readFileSync("src/renderer/src/hooks/useProjectSync.ts", "utf8");
const i18n = readFileSync("src/renderer/src/i18n.ts", "utf8");
const scanner = readFileSync("src/main/sessions/SessionScanner.ts", "utf8");

function refreshProjectSessionsBlock() {
  const match = projectSync.match(/async function refreshProjectSessions\(projectId: string, silent = false\) \{[\s\S]*?\n  \}\n\n  async function refreshProjectTree/);
  assert.ok(match, "refreshProjectSessions implementation should be discoverable");
  return match[0];
}

function withTimeoutBlock() {
  const match = projectSync.match(/function withTimeout<T>\([\s\S]*?\n\}\n/);
  assert.ok(match, "withTimeout implementation should be discoverable");
  return match[0];
}

function assertInOrder(source, fragments, message) {
  let previousIndex = -1;
  for (const fragment of fragments) {
    const index = source.indexOf(fragment, previousIndex + 1);
    assert.notEqual(index, -1, `${message}: missing ${fragment}`);
    assert.ok(index > previousIndex, `${message}: ${fragment} is out of order`);
    previousIndex = index;
  }
}

test("queues every refresh collision instead of dropping user-triggered refreshes", () => {
  const block = refreshProjectSessionsBlock();
  assert.match(
    block,
    /if \(sessionRefreshRunningRef\.current\.has\(projectId\)\) \{[\s\S]*?sessionRefreshPendingRef\.current\.add\(projectId\);\s*return;/,
  );
  assert.doesNotMatch(block, /if \(silent\) sessionRefreshPendingRef\.current\.add\(projectId\)/);
  assert.match(block, /if \(sessionRefreshPendingRef\.current\.delete\(projectId\)\)/);
});

test("bounds session list requests so a hung scan releases the single-flight lock", () => {
  const block = refreshProjectSessionsBlock();
  const timeoutBlock = withTimeoutBlock();
  assert.match(projectSync, /const SESSION_REFRESH_TIMEOUT_MS = 20_000;/);
  assert.match(timeoutBlock, /Promise\.race\(\[promise, timeout\]\)\.finally\(\(\) => \{/);
  assert.match(timeoutBlock, /if \(timer\) clearTimeout\(timer\);/);
  assert.match(
    block,
    /withTimeout\(\s*api\.sessions\.listCatalog\(projectId\),\s*SESSION_REFRESH_TIMEOUT_MS,\s*t\("app\.sessionRefreshTimeout"\),?\s*\)/,
  );
  assert.match(block, /finally \{[\s\S]*?sessionRefreshRunningRef\.current\.delete\(projectId\)/);
  assert.match(i18n, /"app\.sessionRefreshTimeout"/g);
  assert.match(scanner, /private scanTimeoutMs = 18_000;/);
  assert.match(scanner, /new AbortController\(\)/);
  assert.match(scanner, /controller\.abort\(new Error\("Session scan timed out"\)\)/);
  assert.match(scanner, /clearTimeout\(scanTimer\)/);
  assert.match(scanner, /collectWslJsonl\(signal\)/);
  assert.match(scanner, /signal,\s*windowsHide: true/);
});

test("uses the canonical summary converter and preserves refresh result ordering", () => {
  const block = refreshProjectSessionsBlock();
  assert.match(
    projectSync,
    /import \{ sessionRecordToSummary \} from "\.\.\/atoms\/session-selectors";/,
  );
  assert.doesNotMatch(
    projectSync,
    /^(?:function|const|let|var)\s+sessionRecordToSummary\b/m,
  );
  assertInOrder(
    block,
    [
      "if (sessionRequestByProjectRef.current[projectId] !== request) return records;",
      "replaceProjectSessions({ projectId, sessions: records });",
      ".map(sessionRecordToSummary)",
      ".filter((session): session is SessionSummary => Boolean(session))",
      ".sort((a, b) => b.updatedAt - a.updatedAt);",
      "return sorted;",
    ],
    "refresh result pipeline",
  );
});

test("publishes non-silent loading state before yielding to the session request", () => {
  const block = refreshProjectSessionsBlock();
  const beforeRequest = block.slice(0, block.indexOf("try {"));
  assertInOrder(
    beforeRequest,
    [
      "if (!silent)",
      "setSessionLoadingByProject(",
      "[projectId]: true",
      "await new Promise<void>((r) => setTimeout(r, 0));",
    ],
    "non-silent loading yield",
  );
});

test("releases refresh state behind the current-request gate and schedules one silent retry", () => {
  const block = refreshProjectSessionsBlock();
  const finallyIndex = block.indexOf("finally {");
  assert.notEqual(finallyIndex, -1, "refreshProjectSessions should have a finally block");
  const finallyBlock = block.slice(finallyIndex);
  assert.match(
    finallyBlock,
    /^finally \{\s*if \(sessionRequestByProjectRef\.current\[projectId\] === request\) \{/,
  );
  assertInOrder(
    finallyBlock,
    [
      "if (sessionRequestByProjectRef.current[projectId] === request)",
      "sessionRefreshRunningRef.current.delete(projectId);",
      "if (!silent)",
      "setSessionLoadingByProject(",
      "[projectId]: false",
      "if (sessionRefreshPendingRef.current.delete(projectId))",
      "refreshProjectSessions(projectId, true)",
    ],
    "refresh finally cleanup",
  );
  assert.match(
    finallyBlock,
    /if \(sessionRefreshPendingRef\.current\.delete\(projectId\)\) \{[\s\S]*?refreshProjectSessions\(projectId, true\)\.catch\(\(\) => undefined\);\s*\}/,
  );
});
