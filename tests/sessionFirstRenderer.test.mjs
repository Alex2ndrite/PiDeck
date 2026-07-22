import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const appSource = readFileSync("src/renderer/src/App.tsx", "utf8");
const sessionSendSource = readFileSync(
  "src/renderer/src/hooks/useSessionSend.ts",
  "utf8",
);

function functionBody(name) {
  const marker = `function ${name}(`;
  const start = appSource.indexOf(marker);
  assert.notEqual(start, -1, `${name} should exist`);
  const bodyStart = appSource.indexOf("{", start);
  let depth = 0;
  for (let index = bodyStart; index < appSource.length; index += 1) {
    const char = appSource[index];
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return appSource.slice(bodyStart + 1, index);
    }
  }
  throw new Error(`Could not parse ${name}`);
}

test("opening a sidebar history selects a SessionRecord without creating an Agent", () => {
  const body = functionBody("openSidebarSession");
  assert.match(body, /api\.sessions\.listCatalog\(projectId\)/);
  assert.match(body, /setCurrentSessionId\(record\.id\)/);
  assert.doesNotMatch(body, /bindSessionRuntime|createAgent\(/);
});

test("the history drawer uses the lazy Session open path", () => {
  assert.match(
    appSource,
    /onOpenSession=\{\(session\) =>\s*void openSidebarSession\(/,
  );
});

test("first Session send is request-addressed and restores rejected snapshots", () => {
  assert.match(sessionSendSource, /requestId = crypto\.randomUUID\(\)/);
  assert.match(sessionSendSource, /options\.sendPrompt\(\{/);
  assert.match(
    sessionSendSource,
    /sendingSessionIdsRef\.current\.add\(sessionId\)/,
  );
  assert.match(sessionSendSource, /result\.delivery === "unknown"/);
  assert.match(sessionSendSource, /\[message, current\]/);
  assert.match(sessionSendSource, /\.\.\.imageSnapshot, \.\.\.current/);
});

test("active Agent identity is derived from the selected Session runtime", () => {
  assert.match(
    appSource,
    /const activeAgentId = currentSessionRuntime\?\.agentId/,
  );
  assert.doesNotMatch(appSource, /setActiveAgentId/);
  assert.doesNotMatch(
    appSource,
    /useState<[^>]*>\([^)]*\).*activeAgentId/,
  );
});

test("Session messages and composer render without an active Agent", () => {
  assert.match(appSource, /const hasActiveConversation = Boolean\(currentSession\)/);
  assert.match(appSource, /\{hasActiveConversation && \(\s*<footer/);
  assert.match(
    appSource,
    /const activeMessages = currentSessionId \? currentSessionMessages : \[\]/,
  );
  assert.doesNotMatch(appSource, /currentSession \|\| activeAgent/);
});
