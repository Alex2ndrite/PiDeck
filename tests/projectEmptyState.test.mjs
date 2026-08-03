import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const app = readFileSync("src/renderer/src/App.tsx", "utf8");
const emptyState = readFileSync(
  "src/renderer/src/components/session/ProjectEmptyState.tsx",
  "utf8",
);
const emptyPrimitive = readFileSync(
  "src/renderer/src/components/ui-shadcn/empty.tsx",
  "utf8",
);
const sessionActions = readFileSync(
  "src/renderer/src/hooks/useSessionActions.ts",
  "utf8",
);
const composerComponents = readFileSync(
  "src/renderer/src/components/session/ComposerComponents.tsx",
  "utf8",
);
const zh = readFileSync("src/renderer/src/i18n/rendererCopy.zh-CN.ts", "utf8");
const en = readFileSync("src/renderer/src/i18n/rendererCopy.en-US.ts", "utf8");

test("project empty state is shared by normal and chat projects when no session is open", () => {
  // 无 currentSessionId 时渲染统一 ProjectEmptyState（普通项目 / Chat 项目共用）。
  assert.match(app, /ProjectEmptyState/);
  assert.match(app, /<ProjectEmptyState/);
  assert.match(app, /currentSessionId/);
  assert.match(app, /runCreateSessionDraft/);
  assert.match(app, /runCreateAnonymousSession/);
  assert.match(app, /addProject/);
});

test("empty state offers New Agent and Anonymous chat quick actions, add project when none", () => {
  assert.match(emptyState, /onCreateAgent/);
  assert.match(emptyState, /onCreateAnonymous/);
  assert.match(emptyState, /onAddProject/);
  assert.match(emptyState, /t\("app\.createAgent"\)/);
  assert.match(emptyState, /t\("app\.anonymousChat"\)/);
  assert.match(emptyState, /t\("app\.addProject"\)/);
  assert.match(emptyState, /t\("app\.projectEmptyTitle"/);
  assert.match(emptyState, /t\("app\.emptyNoProjectTitle"/);
});

test("project empty state reads default model/thinking from pi config via IPC, not localStorage", () => {
  // 通过 config.getSettings 读取（renderer→preload→IPC），不直接用 Node/本地偏好。
  assert.match(emptyState, /desktopApi\.config[\s\S]{0,80}getSettings/);
  assert.match(emptyState, /defaultProvider/);
  assert.match(emptyState, /defaultModel/);
  assert.match(emptyState, /defaultThinkingLevel/);
  assert.doesNotMatch(emptyState, /readWelcomeModelPreference|readWelcomeThinkingPreference/);
  assert.match(emptyState, /useState<\{ model\?: string; thinking\?: string \}>/);
  assert.doesNotMatch(emptyState, /require\(|node:|fs\.read|process\.env|ipcRenderer/);
});

test("empty state model fallback matches main sessionsCatalogCreateDraft rule via getModels", () => {
  // settings 未给全 defaultProvider+defaultModel 时回退 models.json 首 provider 首 model，
  // 与主进程 createDraft 规则一致。
  assert.match(emptyState, /desktopApi\.config[\s\S]{0,60}getModels/);
  assert.match(emptyState, /modelsParsed\.providers/);
  assert.match(emptyState, /Object\.keys\(providersObj\)\[0\]/);
  assert.match(emptyState, /models\[0\]\?\.id/);
  assert.match(emptyState, /\$\{providerName\}\/\$\{firstModel\}/);
  // 只读 provider 名与 model id，不触碰/输出 apiKey、baseUrl 等敏感字段。
  assert.doesNotMatch(emptyState, /apiKey|token\b|baseUrl/);
});

test("project empty state narrows remote config values with unknown guard, not as-casts", () => {
  // 远端 config 是 Record<string, unknown>，字段必须经 typeof 收窄后用，禁 as 强转。
  assert.doesNotMatch(emptyState, /parsed as\s*\{/);
  assert.doesNotMatch(emptyState, / as [A-Za-z_{}\[\] ]+\{/);
  assert.match(emptyState, /typeof parsed\.defaultProvider === "string"/);
  assert.match(emptyState, /typeof parsed\.defaultModel === "string"/);
  assert.match(emptyState, /typeof parsed\.defaultThinkingLevel === "string"/);
});

test("draft creation no longer spreads renderer welcome prefs over pi config", () => {
  // 主进程 createDraft 已按 pi 配置 auto-fill；渲染层不再无条件覆盖。
  assert.doesNotMatch(sessionActions, /readWelcomeModelPreference|readWelcomeThinkingPreference/);
  assert.match(sessionActions, /api\.sessions\.createDraft/);
});

test("composer bottom bar default model/thinking prefer pi-config record over welcome localStorage", () => {
  assert.doesNotMatch(composerComponents, /readWelcomeModelPreference|readWelcomeThinkingPreference|welcomeModel/);
  assert.match(composerComponents, /props\.state\?\.thinkingLevel \?\? props\.record\?\.thinkingLevel/);
  assert.match(composerComponents, /props\.record\?\.model/);
});

test("shadcn Empty primitive exists and carries title/description/actions/footer slots", () => {
  assert.match(emptyPrimitive, /function Empty\(/);
  assert.match(emptyPrimitive, /title: ReactNode/);
  assert.match(emptyPrimitive, /description\?: ReactNode/);
  assert.match(emptyPrimitive, /actions\?: ReactNode/);
  assert.match(emptyPrimitive, /footer\?: ReactNode/);
});

test("new empty-state copy is bilingual", () => {
  for (const key of ["app.projectEmptyTitle", "app.projectEmptyDescription", "app.emptyNoProjectTitle"]) {
    assert.ok(zh.includes(`"${key}"`), `${key} zh-CN copy must exist`);
    assert.ok(en.includes(`"${key}"`), `${key} en-US copy must exist`);
  }
  assert.match(zh, /"app\.projectEmptyTitle": "[^"]*\{name\}[^"]*"/);
  assert.match(en, /"app\.projectEmptyTitle": "[^"]*\{name\}[^"]*"/);
  // JSX 不硬编码中英文可见文案
  assert.doesNotMatch(emptyState, />[^<]*(在|开始工作|Start working|尚未)</);
});
