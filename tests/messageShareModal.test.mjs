import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const surface = readFileSync(
  "src/renderer/src/components/session/SurfaceComponents.tsx",
  "utf8",
);
const shareModal = readFileSync(
  "src/renderer/src/components/session/MessageShareModal.tsx",
  "utf8",
);
const tree = readFileSync(
  "src/renderer/src/components/session/MessageSelectionTree.tsx",
  "utf8",
);
const selection = readFileSync(
  "src/renderer/src/utils/messageSelection.ts",
  "utf8",
);

test("message sharing keeps the SurfaceComponents facade after presentation extraction", () => {
  assert.match(shareModal, /export function MultiSelectModal/);
  assert.match(surface, /from "\.\/MessageShareModal"/);
  assert.match(surface, /export \{ MultiSelectModal \}/);
  // 选择逻辑与树渲染已抽到共享模块：弹窗只保留外壳与复制动作
  assert.match(shareModal, /from "\.\/MessageSelectionTree"/);
  assert.doesNotMatch(shareModal, /function getSelectableMessageIds/);
  assert.doesNotMatch(surface, /function getSelectableMessageIds/);
});

test("message sharing uses a shared tree component and pure selection logic", () => {
  assert.match(tree, /export function MessageSelectionTree/);
  assert.match(selection, /export function getSelectableMessageIds/);
  assert.match(selection, /export function toggleRun/);
});
