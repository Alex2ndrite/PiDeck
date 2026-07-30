import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import test from "node:test";

const require = createRequire(import.meta.url);
const typescript = require("typescript");

const host = readFileSync("src/renderer/src/components/workspace/WorkspaceDrawerHost.tsx", "utf8");
const hook = readFileSync("src/renderer/src/hooks/useWorkspacePanels.ts", "utf8");
const editor = readFileSync("src/renderer/src/components/workspace/EditorSurface.tsx", "utf8");
const browser = readFileSync("src/renderer/src/components/workspace/BrowserSurface.tsx", "utf8");
const external = readFileSync("src/renderer/src/components/workspace/ExternalEditorOverlay.tsx", "utf8");

async function loadPureExports(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(start, -1, `${startMarker} must exist`);
  assert.notEqual(end, -1, `${endMarker} must follow ${startMarker}`);
  const output = typescript.transpileModule(source.slice(start, end), {
    compilerOptions: { module: typescript.ModuleKind.ESNext, target: typescript.ScriptTarget.ES2022 },
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(output).toString("base64")}`);
}

const gitState = await loadPureExports(
  hook,
  "export function invalidateGitDiffState",
  "/** The adapter deliberately mirrors GitPanel's resource boundary",
);
const drawerState = await loadPureExports(
  host,
  "export function getVisibleDrawerPanel",
  "export type WorkspaceDrawerHostProps",
);

test("workspace drawer keeps a rendered panel through the 120ms compositor close", () => {
  assert.match(hook, /DRAWER_ANIMATION_MS\s*=\s*120/);
  assert.match(host, /const \[renderedDrawer, setRenderedDrawer\]/);
  assert.match(host, /setTimeout\(\(\) => \{[\s\S]*?setRenderedDrawer\(null\)/);
  assert.match(host, /\}, DRAWER_ANIMATION_MS\)/);
  assert.match(host, /data-open=\{open\}/);
  assert.match(host, /const visiblePanel = getVisibleDrawerPanel\(open, props\.panel, renderedDrawer\)/);
  assert.match(host, /data-rendered=\{Boolean\(visiblePanel\)\}/);
});

test("Git diff lifecycle helper invalidates close races and rejects old project responses", () => {
  const initial = {
    request: 7,
    snapshot: { projectId: "project-a", path: "a.ts", originalContent: "", modifiedContent: "", label: "a.ts" },
    displayMode: "modal",
  };
  const invalidated = gitState.invalidateGitDiffState(initial);
  assert.deepEqual(invalidated, { request: 8, snapshot: null, displayMode: "drawer" });
  assert.equal(gitState.isCurrentGitDiffResponse({
    request: 8,
    currentRequest: 8,
    responseProjectId: "project-a",
    activeProjectId: "project-a",
  }), true);
  assert.equal(gitState.isCurrentGitDiffResponse({
    request: 7,
    currentRequest: invalidated.request,
    responseProjectId: "project-a",
    activeProjectId: "project-a",
  }), false);
  assert.equal(gitState.isCurrentGitDiffResponse({
    request: 8,
    currentRequest: invalidated.request,
    responseProjectId: "project-a",
    activeProjectId: "project-b",
  }), false);
});

test("all Git leave paths invalidate the request and clear the snapshot", () => {
  const openDrawer = hook.slice(hook.indexOf("const openDrawer"), hook.indexOf("const closeDrawer"));
  const closeDrawer = hook.slice(hook.indexOf("const closeDrawer"), hook.indexOf("const collapseDrawer"));
  assert.match(openDrawer, /if \(next !== "git"\) invalidateGitDiff\(\)/);
  assert.match(closeDrawer, /invalidateGitDiff\(\)/);
  assert.match(hook, /const closeGitDiff = useCallback\(\(\) => \{\s*invalidateGitDiff\(\);/);
  assert.match(hook, /const openBrowser = useCallback\(\(\) => \{\s*invalidateGitDiff\(\);/);
  assert.match(hook, /useEffect\(\(\) => \{\s*invalidateGitDiff\(\);/);
});

test("drawer visible-panel helper renders first opens and switches immediately but retains close content", () => {
  assert.equal(drawerState.getVisibleDrawerPanel(true, "files", null), "files");
  assert.equal(drawerState.getVisibleDrawerPanel(true, "browser", "files"), "browser");
  assert.equal(drawerState.getVisibleDrawerPanel(false, null, "browser"), "browser");
  assert.equal(drawerState.getVisibleDrawerPanel(false, null, null), null);
});

test("workspace panel hook exposes narrow drawer commands and project persistence", () => {
  assert.match(hook, /export function useWorkspacePanels/);
  for (const command of ["openDrawer", "closeDrawer", "collapseDrawer", "expandDrawer", "toggleDrawerPinned"]) {
    assert.match(hook, new RegExp(`const ${command} = useCallback`));
  }
  assert.match(hook, /drawerStoragePrefix/);
  assert.match(hook, /projectIdRef\.current/);
  assert.match(hook, /setDrawerPinnedByProject/);
});

test("editor tabs enforce both count and text-budget LRU while keeping IO callbacks stable", () => {
  // Editor state moved to useFileEditor (Phase 2 Gate 2D). Constants preserved in useWorkspacePanels.
  assert.match(hook, /EDITOR_TAB_LIMIT\s*=\s*5/);
  assert.match(hook, /EDITOR_TAB_TEXT_BUDGET\s*=\s*24 \* 1024 \* 1024/);
  // Editor tabs, trimEditorTabs, readContent now owned by useFileEditor.
  const fileEditor = readFileSync("src/renderer/src/hooks/useFileEditor.ts", "utf8");
  assert.match(fileEditor, /const EDITOR_TAB_LIMIT = 5/);
  assert.match(fileEditor, /const trimEditorTabs/);
  assert.match(fileEditor, /lastAccess/);
});

test("Git diff and external editor flows reject stale project responses", () => {
  assert.match(hook, /gitRequestRef\.current/);
  assert.match(hook, /isCurrentGitDiffResponse\(\{/);
  assert.match(hook, /editorRequestRef\.current/);
  assert.match(hook, /request !== editorRequestRef\.current \|\| projectIdRef\.current !== forProjectId/);
  assert.match(hook, /openProjectInExternalEditor/);
  assert.match(hook, /projectIdRef\.current !== id/);
  assert.match(external, /onOpenProject/);
});

test("browser surface has explicit fullscreen and minimize paths", () => {
  assert.match(browser, /isFullscreen/);
  assert.match(browser, /onMinimize=\{props\.onMinimize\}/);
  assert.match(browser, /onToggleFullscreen=\{props\.onEnterFullscreen\}/);
  assert.match(hook, /browserFullscreen/);
  assert.match(hook, /const minimizeBrowser = useCallback/);
  assert.match(hook, /openBrowser\(\)/);
});

// 回归（#113 parity）：抽屉面板切换入口必须挂在抽屉自身（activity rail），
// 不能只在会话 outline 浮动按钮里 —— 否则无活跃会话时无法切到 git/browser。
test("drawer host renders an injected activity rail while open", () => {
  const rail = readFileSync("src/renderer/src/components/workspace/WorkspaceDrawerRail.tsx", "utf8");
  const app = readFileSync("src/renderer/src/App.tsx", "utf8");
  const shell = readFileSync("src/renderer/src/components/app/AppShell.tsx", "utf8");
  // rail 组件：垂直 tablist + 激活态
  assert.match(rail, /role="tablist"/);
  assert.match(rail, /aria-orientation="vertical"/);
  assert.match(rail, /aria-selected=\{action\.active\}/);
  // host：打开期间渲染注入的 rail
  assert.match(host, /rail\?: ReactNode/);
  assert.match(host, /\{open && props\.rail\}/);
  // shell：drawerRail 透传
  assert.match(shell, /drawerRail\?: ReactNode/);
  assert.match(shell, /rail=\{drawerRail\}/);
  // App：rail 三个面板入口齐全，且与 outline 共用同一套切换语义
  assert.match(app, /handleToolDrawerAction\("files"\)/);
  assert.match(app, /handleToolDrawerAction\("git"\)/);
  assert.match(app, /handleToolDrawerAction\("browser"\)/);
  // Git 入口受 enableGitManagement 门控（与 outline 一致）
  assert.match(app, /settings\.enableGitManagement && activeProjectId \? \[\{/);
});
