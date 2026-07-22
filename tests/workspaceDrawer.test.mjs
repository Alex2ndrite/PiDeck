import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const host = readFileSync("src/renderer/src/components/workspace/WorkspaceDrawerHost.tsx", "utf8");
const hook = readFileSync("src/renderer/src/hooks/useWorkspacePanels.ts", "utf8");
const editor = readFileSync("src/renderer/src/components/workspace/EditorSurface.tsx", "utf8");
const browser = readFileSync("src/renderer/src/components/workspace/BrowserSurface.tsx", "utf8");
const external = readFileSync("src/renderer/src/components/workspace/ExternalEditorOverlay.tsx", "utf8");

test("workspace drawer keeps a rendered panel through the 120ms compositor close", () => {
  assert.match(hook, /DRAWER_ANIMATION_MS\s*=\s*120/);
  assert.match(host, /const \[renderedDrawer, setRenderedDrawer\]/);
  assert.match(host, /setTimeout\(\(\) => \{[\s\S]*?setRenderedDrawer\(null\)/);
  assert.match(host, /\}, DRAWER_ANIMATION_MS\)/);
  assert.match(host, /data-open=\{open\}/);
  assert.match(host, /data-rendered=\{Boolean\(renderedDrawer\)\}/);
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
  assert.match(hook, /EDITOR_TAB_LIMIT\s*=\s*5/);
  assert.match(hook, /EDITOR_TAB_TEXT_BUDGET\s*=\s*24 \* 1024 \* 1024/);
  assert.match(hook, /export function trimEditorTabs/);
  assert.match(hook, /protectedId/);
  assert.match(hook, /lastAccess/);
  assert.match(editor, /useStableCallback/);
  assert.match(editor, /readContent=\{readContent\}/);
  assert.match(editor, /readOriginalContent=\{/);
});

test("Git diff and external editor flows reject stale project responses", () => {
  assert.match(hook, /gitRequestRef\.current/);
  assert.match(hook, /request !== gitRequestRef\.current \|\| projectIdRef\.current !== id/);
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
