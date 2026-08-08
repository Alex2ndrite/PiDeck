import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const app = readFileSync("src/renderer/src/App.tsx", "utf8");
const stage = readFileSync("src/renderer/src/components/workspace/WorkbenchStage.tsx", "utf8");
const content = readFileSync("src/renderer/src/components/workspace/WorkbenchContent.tsx", "utf8");
const fileEditor = readFileSync("src/renderer/src/hooks/useFileEditor.ts", "utf8");
const drawer = readFileSync("src/renderer/src/components/workspace/DrawerSurface.tsx", "utf8");
const settings = readFileSync("src/shared/types/settings.ts", "utf8");
const store = readFileSync("src/main/settings/SettingsStore.ts", "utf8");
const settingsModal = readFileSync("src/renderer/src/components/app/SettingsModal.tsx", "utf8");
const zh = readFileSync("src/renderer/src/i18n/rendererCopy.zh-CN.ts", "utf8");
const en = readFileSync("src/renderer/src/i18n/rendererCopy.en-US.ts", "utf8");
const surfaces = readFileSync("src/renderer/src/styles/surfaces.css", "utf8");

test("settings expose workspace content open mode and split orientation", () => {
  assert.match(settings, /WorkspaceContentOpenMode = "split" \| "maximize"/);
  assert.match(settings, /WorkspaceSplitOrientation = "horizontal" \| "vertical"/);
  assert.match(settings, /workspaceContentOpenMode: WorkspaceContentOpenMode/);
  assert.match(settings, /workspaceSplitOrientation: WorkspaceSplitOrientation/);
  assert.match(store, /workspaceContentOpenMode: "split"/);
  assert.match(store, /workspaceSplitOrientation: "horizontal"/);
  assert.match(settingsModal, /workspaceContentOpenMode/);
  assert.match(settingsModal, /workspaceSplitOrientation/);
  assert.match(zh, /"settings\.workspaceContentOpenMode"/);
  assert.match(en, /"settings\.workspaceContentOpenMode"/);
  assert.match(surfaces, /\.workbench-stage\s*\{/);
  assert.match(surfaces, /\.workbench-stage-split/);
  assert.match(surfaces, /\.workbench-stage-solo\s*>\s*\.session-tabs-bar/);
  assert.match(surfaces, /\.workbench-stage-solo\s*>\s\*:not\(\.session-tabs-bar\)/);
  assert.doesNotMatch(
    surfaces,
    /\.workbench-stage-solo\s*>\s*\*\s*\{[^}]*height:\s*100%/,
    "solo must not force every Fragment child to height 100% (breaks empty-state layout)",
  );
});

test("WorkbenchStage hosts session + content with collapse-safe maximize", () => {
  assert.match(stage, /export function WorkbenchStage/);
  assert.match(stage, /layout === "maximize"/);
  assert.match(stage, /panel\.collapse\(\)/);
  assert.match(stage, /panel\.expand\(\)/);
  assert.match(stage, /from "\.\.\/\.\.\/\.\.\/\.\.\/shared\/types"/);
  assert.match(app, /<WorkbenchStage/);
  assert.match(app, /workbenchHasContent/);
  assert.match(app, /WorkbenchContent/);
  // 阅读面静态引入 FileDiffViewer：避免 lazy 动态 import 在 Electron/Vite 下偶发失败且无法重试恢复
  assert.doesNotMatch(app, /lazy\(\(\) => import\("\.\/components\/app\/FileDiffViewer"/);
  assert.doesNotMatch(content, /lazy\(\(\) =>/);
  assert.match(content, /import \{ FileDiffViewer \} from "\.\.\/app\/FileDiffViewer"/);
});

test("file view and git diff open into workbench modes, not drawer overlays", () => {
  assert.match(fileEditor, /editorMode: WorkspaceContentOpenMode/);
  assert.match(fileEditor, /gitDiffDisplayMode: WorkspaceContentOpenMode/);
  assert.match(fileEditor, /contentOpenMode: WorkspaceContentOpenMode/);
  // 打开文件不再切抽屉到 editor
  const viewBlock = fileEditor.slice(
    fileEditor.indexOf("const viewFilePath = useCallback"),
    fileEditor.indexOf("const diffFilePath = useCallback"),
  );
  assert.doesNotMatch(viewBlock, /setDrawer\("editor"\)/);
  assert.match(viewBlock, /contentOpenModeRef\.current/);
  // Git Diff 不再要求 drawer 叠层
  assert.doesNotMatch(drawer, /git-drawer-detail/);
  assert.doesNotMatch(drawer, /displayMode="drawer"/);
  // App 不再挂 body modal 阅读面
  assert.doesNotMatch(app, /editorMode === "modal"/);
  assert.doesNotMatch(app, /gitDiffDisplayMode === "modal"/);
  assert.match(content, /displayMode=\{props\.gitDiffDisplayMode\}/);
  assert.match(content, /displayMode=\{props\.editorMode\}/);
});
