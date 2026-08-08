import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const app = readFileSync("src/renderer/src/App.tsx", "utf8");
const drawerSurface = readFileSync("src/renderer/src/components/workspace/DrawerSurface.tsx", "utf8");
const fileEditorHook = readFileSync("src/renderer/src/hooks/useFileEditor.ts", "utf8");
const zhCN = readFileSync("src/renderer/src/i18n/rendererCopy.zh-CN.ts", "utf8");
const enUS = readFileSync("src/renderer/src/i18n/rendererCopy.en-US.ts", "utf8");

test("drawer rail exposes the editor as a first-class panel entry", () => {
  // 编辑器入口与 files/git/browser 平级，复用同一套 toggle 语义
  assert.match(app, /id:\s*"editor"/);
  assert.match(app, /label:\s*t\("editor\.fileEditor"\)/);
  assert.match(app, /active:\s*drawer === "editor"/);
  assert.match(app, /handleToolDrawerAction\("editor"\)/);
});

test("editor drawer renders an empty state instead of requiring an active tab", () => {
  // 阅读面已迁中间栏：抽屉 editor 面板始终是空状态引导
  assert.match(drawerSurface, /drawer === "editor" && !drawerCollapsed\s*\?/);
  assert.doesNotMatch(drawerSurface, /FileDiffViewer/);
  assert.match(drawerSurface, /t\("editor\.emptyTitle"\)/);
  assert.match(drawerSurface, /t\("editor\.emptyHint"\)/);
  assert.match(drawerSurface, /t\("editor\.emptyOpenFiles"\)/);
  assert.match(drawerSurface, /chrome\.onOpenDrawer\("files"\)/);
});

test("closing the last editor tab resets workbench layout to settings default", () => {
  assert.doesNotMatch(
    fileEditorHook,
    /editorTabs\.length === 0 && drawer === "editor"[\s\S]{0,200}?setDrawer\(null\)/,
  );
  const closeTabBlock = fileEditorHook.slice(
    fileEditorHook.indexOf("if (next.length === 0)"),
    fileEditorHook.indexOf("if (next.length === 0)") + 500,
  );
  assert.match(closeTabBlock, /contentOpenModeRef\.current/);
  assert.match(closeTabBlock, /setEditorMode\(contentOpenModeRef\.current\)/);
  const closeEditorBlock = fileEditorHook.slice(
    fileEditorHook.indexOf("const closeEditor = useCallback"),
    fileEditorHook.indexOf("const closeEditor = useCallback") + 500,
  );
  assert.match(closeEditorBlock, /setEditorMode\(contentOpenModeRef\.current\)/);
});

test("editor empty-state copy exists in both locales", () => {
  for (const key of ['"editor.emptyTitle"', '"editor.emptyHint"', '"editor.emptyOpenFiles"']) {
    assert.ok(zhCN.includes(key), `zh-CN missing ${key}`);
    assert.ok(enUS.includes(key), `en-US missing ${key}`);
  }
});
