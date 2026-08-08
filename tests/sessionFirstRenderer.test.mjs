import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const appSource = readFileSync("src/renderer/src/App.tsx", "utf8");
const sessionViewSource = readFileSync(
  "src/renderer/src/components/session/SessionView.tsx",
  "utf8",
);
const sessionActionsSource = readFileSync(
  "src/renderer/src/hooks/useSessionActions.ts",
  "utf8",
);
const sessionSendSource = readFileSync(
  "src/renderer/src/hooks/useSessionSend.ts",
  "utf8",
);
const composerSource = readFileSync(
  "src/renderer/src/components/session/ComposerArea.tsx",
  "utf8",
);
const drawerSurfaceSource = readFileSync(
  "src/renderer/src/components/workspace/DrawerSurface.tsx",
  "utf8",
);

function functionBody(name, source = appSource) {
  const marker = `function ${name}(`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `${name} should exist`);
  const bodyStart = source.indexOf("{", start);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    const char = source[index];
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(bodyStart + 1, index);
    }
  }
  throw new Error(`Could not parse ${name}`);
}

test("opening a sidebar history selects a SessionRecord without creating an Agent", () => {
  const body = functionBody("openSidebarSession", sessionActionsSource);
  assert.match(body, /await refreshProjectSessions\(projectId, true\)/);
  assert.match(body, /commitSessionSelection\(projectId, record\.id, true\)/);
  assert.doesNotMatch(body, /listCatalog|bindSessionRuntime|createAgent\(/);
});

test("the history drawer uses the lazy Session open path", () => {
  assert.match(
    drawerSurfaceSource,
    /onOpenSession=\{/,
  );
});

test("App routes project and Session selection through the command owner", () => {
  assert.match(appSource, /selectProject: selectProjectCommand/);
  assert.match(appSource, /selectSession: selectSessionCommand/);
  assert.match(appSource, /selectSessionCommand\(session\.projectId, session\.id, false\)/);
  assert.match(appSource, /selectSessionCommand\(projectId, result\.targetSessionId, true\)/);
  assert.match(appSource, /sessionRecordByIdAtomFamily\(target\.sessionId\)/);
  assert.match(
    appSource,
    /select: \(projectId\) => \{\s*selectProjectCommand\(projectId\);[\s\S]*?const loadState = store\.get\(sessionCatalogLoadStateAtom\)\[projectId\];[\s\S]*?loadState\?\.status !== "loading" && loadState\?\.status !== "ready"/,
  );
  assert.doesNotMatch(appSource, /setCurrentSessionId\(/);
});

test("first Session send is request-addressed and restores rejected snapshots", () => {
  assert.match(sessionSendSource, /requestId = crypto\.randomUUID\(\)/);
  assert.match(sessionSendSource, /options\.sendPrompt\(\{/);
  assert.match(
    sessionSendSource,
    /sendingSessionIdsRef\.current\.add\(sourceSessionId\)/,
  );
  assert.match(sessionSendSource, /result\.delivery === "unknown"/);
  assert.match(sessionSendSource, /\[message, current\]/);
  assert.match(sessionSendSource, /\.\.\.imageSnapshot, \.\.\.current/);
});

test("the renderer-only Chat surface keeps the dev workspace toolbar before first send", () => {
  assert.match(appSource, /const hasActiveConversation = Boolean\(currentSessionId\)/);
  assert.match(appSource, /terminalAction=\{activeAgentId \? \{/);
  // 悬浮栏不再暴露 files/git/browser（入口收进抽屉活动栏，files 由标题栏抽屉开关打开）
  assert.match(appSource, /filesAction=\{undefined\}/);
  assert.match(appSource, /gitAction=\{undefined\}/);
  assert.match(appSource, /browserAction=\{undefined\}/);
});


test("typing in the current Composer prewarms its runtime once", () => {
  assert.match(composerSource, /desktopApi\.sessions\.activateRuntime\(props\.sessionId\)/);
  assert.match(composerSource, /prewarmStartedForSessionRef/);
  assert.match(composerSource, /composer\.draft\.trim\(\)/);
  assert.match(composerSource, /composer\.attachments\.length === 0/);
});


test("active Agent identity is derived from the selected Session runtime", () => {
  assert.match(
    appSource,
    /const activeAgentId = useAtomValue\(activeAgentIdAtom\)/,
  );
  assert.doesNotMatch(appSource, /setActiveAgentId/);
  assert.doesNotMatch(
    appSource,
    /useState<[^>]*>\([^)]*\).*activeAgentId/,
  );
});

test("Session messages and composer render without an active Agent", () => {
  assert.match(appSource, /const hasActiveConversation = Boolean\(currentSessionId\)/);
  assert.match(
    sessionViewSource,
    /\{hasActiveConversation && \([\s\S]*<ComposerArea[\s\S]*sessionId=\{sessionId\}/,
  );
  assert.match(composerSource, /useSessionComposerController\(/);
  assert.match(composerSource, /sessionId=\{props\.sessionId\}/);
  // 消息来自当前会话 atom / 栏内 timeline，不再依赖 activeAgent 兜底
  assert.match(appSource, /currentSessionMessagesAtom/);
  assert.doesNotMatch(appSource, /currentSession \|\| activeAgent/);
});
