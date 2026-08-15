import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const app = readFileSync("src/renderer/src/App.tsx", "utf8");

test("startup auto-select registers a pending draft instead of creating inline", () => {
  // 启动引导：首项目自动选中只登记 startupDraftProjectId，不在 onProjectsChanged
  // 回调里直接创建——首次 projects.list 返回时本帧 projects 闭包可能还是空数组，
  // useSessionActions 按闭包 projects 校验项目存在性会静默失败。
  assert.match(
    app,
    /onProjectsChanged: \(next: Project\[\]\) => \{\s*if \(!activeProjectId && next\.length > 0\) \{\s*setActiveProjectId\(next\[0\]\.id\);[\s\S]*?setStartupDraftProjectId\(next\[0\]\.id\);/,
  );
  assert.match(app, /const \[startupDraftProjectId, setStartupDraftProjectId\] = useState<string>\(\);/);
});

test("startup draft is created by effect after projects render, skipping chat projects", () => {
  // effect 等到 projects 渲染到位（闭包能找到项目对象）后再创建；
  // Chat 项目跳过：匿名会话创建即 spawn pi 进程，启动无用户意图不拉起 agent。
  assert.match(
    app,
    /useEffect\(\(\) => \{\s*if \(!startupDraftProjectId\) return;[\s\S]*?const project = projects\.find\(\(item\) => item\.id === startupDraftProjectId\);\s*if \(!project\) return;\s*setStartupDraftProjectId\(undefined\);\s*if \(isChatProject\(project\)\) return;\s*void createSessionDraftWithTab\(project\.id\);/,
  );
  assert.doesNotMatch(
    app,
    /if \(isChatProject\(project\)\) \{\s*void createAnonymousSessionWithTab\(project\.id\);/,
  );
});

test("opening a sidebar directory no longer auto-creates an agent session", () => {
  // 回归：点开目录只选中项目并显示引导页，创建由用户手动点「启动 Agent /
  // 临时对话」触发；自动创建只保留启动引导与「关闭全部 Tab」两个入口。
  const selectBlock = app.match(
    /select: \(projectId\) => \{([\s\S]*?)},\s*\n\s*refresh:/,
  );
  assert.ok(selectBlock, "sidebar projects.select block should exist");
  const body = selectBlock[1];
  assert.match(body, /selectProjectCommand\(projectId\)/);
  assert.match(body, /sessionCatalogLoadStateAtom\)\[projectId\]/);
  assert.doesNotMatch(body, /createSessionDraftWithTab|createAnonymousSessionWithTab/);
});

test("startup draft registration is one-shot for the auto-selected first project", () => {
  // 仅启动这次自动选中触发登记：activeProjectId 已有值时不再登记，避免
  // projects 后续变化（增删/重排广播）重复新建草稿会话。
  assert.match(app, /if \(!activeProjectId && next\.length > 0\) \{\s*setActiveProjectId\(next\[0\]\.id\);/);
  assert.match(app, /createSessionDraftWithTab\(project\.id\)/);
});
