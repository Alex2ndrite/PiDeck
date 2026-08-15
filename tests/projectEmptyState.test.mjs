import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const app = readFileSync("src/renderer/src/App.tsx", "utf8");
const emptyState = readFileSync(
  "src/renderer/src/components/session/ProjectEmptyState.tsx",
  "utf8",
);
const workspaceChrome = readFileSync(
  "src/renderer/src/hooks/useSessionWorkspaceChrome.ts",
  "utf8",
);
const zh = readFileSync("src/renderer/src/i18n/rendererCopy.zh-CN.ts", "utf8");
const en = readFileSync("src/renderer/src/i18n/rendererCopy.en-US.ts", "utf8");

test("project empty state is shared by normal and chat projects when no session is open", () => {
  // 无 currentSessionId 时渲染统一 ProjectEmptyState（普通项目 / Chat 项目共用）。
  assert.match(app, /ProjectEmptyState/);
  assert.match(app, /<ProjectEmptyState/);
  assert.match(app, /currentSessionId/);
  assert.match(app, /createSessionDraftWithTab\(undefined\)/);
  assert.match(app, /createAnonymousSessionWithTab\(undefined\)/);
  assert.match(app, /addProject/);
});

test("project empty state is a pure creation entry, no second composer implementation", () => {
  // 输入统一由起始页（SessionStartSurface 居中 ComposerArea）承担；
  // 本页不得再出现输入框/模型选择/发送链路的第二套实现。
  assert.match(emptyState, /import \{ LogoMark \} from "\.\/SurfaceParts"/);
  assert.match(emptyState, /<LogoMark size=\{56\} \/>/);
  assert.match(emptyState, /justify-center/);
  assert.match(emptyState, /pt-\[14vh\]/);
  // 创建入口三件套
  assert.match(emptyState, /onCreateAgent/);
  assert.match(emptyState, /onCreateAnonymous/);
  assert.match(emptyState, /onAddProject/);
  assert.match(emptyState, /t\("app\.createAgent"\)/);
  assert.match(emptyState, /t\("app\.anonymousChatShort"\)/);
  assert.match(emptyState, /t\("app\.addProject"\)/);
  // 不再自制输入框/模型选择/发送链路（已下沉到起始页的 ComposerArea）
  assert.doesNotMatch(emptyState, /TipTapComposer/);
  assert.doesNotMatch(emptyState, /ModelPicker|ThinkingPicker/);
  assert.doesNotMatch(emptyState, /sendPrompt|waitRuntimeReady|getComposerEnterIntent/);
  assert.doesNotMatch(emptyState, /WELCOME_MODEL_KEY|WELCOME_THINKING_KEY/);
  assert.doesNotMatch(emptyState, /readLaunchPreferences/);
  // 品牌 tagline/subtitle 不再使用
  assert.doesNotMatch(emptyState, /t\("app\.projectEmptyTitle"/);
  assert.doesNotMatch(emptyState, /t\("app\.emptyNoProjectTitle"/);
});

test("anonymous session short entry stays on the empty state", () => {
  // 匿名聊天入口保留：无项目也显示添加项目入口
  assert.match(emptyState, /t\("app\.anonymousChatShort"\)/);
  assert.match(emptyState, /hasProject/);
});

test("empty-state auto-create is gated to the user clearing all tabs", () => {
  // 回归：启动时首项目（内置 Chat 恒排第一）被自动选中也会挂载引导页，若挂载
  // 即自动创建，每次启动都会无用户意图地新建匿名会话并拉起 pi agent（匿名
  // 会话创建即 spawn 进程）。自动创建只允许发生在「用户亲手关闭全部 Tab」之后：
  // useSessionWorkspaceChrome 在 closeTab/closeAllTabs 清空 Tab 栏时置位闸门，
  // App 以 autoCreateOnMount 传给 ProjectEmptyState，effect 必须先过闸门。
  assert.match(emptyState, /autoCreateOnMount/);
  assert.match(emptyState, /if \(!props\.autoCreateOnMount \|\| !props\.activeProject/);
  assert.match(emptyState, /autoCreatedRef/);
  assert.match(emptyState, /isChatProject\(props\.activeProject\)/);
  assert.match(emptyState, /props\.onCreateAnonymous\(\)/);
  assert.match(emptyState, /props\.onCreateAgent\(\)/);
  assert.match(app, /autoCreateOnMount=\{workspaceChrome\.allTabsClosedByUser\}/);
  assert.match(workspaceChrome, /allTabsClosedByUser/);
  assert.match(workspaceChrome, /setAllTabsClosedByUser\(true\)/);
});

test("shadcn Empty primitive was removed in favor of pi-branded entry", () => {
  const emptyPrimitivePath = "src/renderer/src/components/ui-shadcn/empty.tsx";
  assert.equal(
    (() => {
      try {
        readFileSync(emptyPrimitivePath, "utf8");
        return false;
      } catch {
        return true;
      }
    })(),
    true,
    "ui-shadcn/empty.tsx should be deleted",
  );
});

test("empty-state copy is bilingual and JSX carries no hardcoded text", () => {
  for (const key of ["app.createAgent", "app.anonymousChatShort", "app.addProject"]) {
    assert.ok(zh.includes(`"${key}"`), `${key} zh-CN copy must exist`);
    assert.ok(en.includes(`"${key}"`), `${key} en-US copy must exist`);
  }
  // 旧的项目标题/描述 key 已随 shadcn Empty 删除，JSX 不再引用
  assert.doesNotMatch(zh, /"app\.projectEmptyTitle"/);
  assert.doesNotMatch(en, /"app\.projectEmptyTitle"/);
  // JSX 不硬编码中英文可见文案
  assert.doesNotMatch(emptyState, />[^<]*(在|开始工作|Start working|尚未)</);
});
