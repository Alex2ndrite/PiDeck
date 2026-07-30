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

test("message sharing keeps the SurfaceComponents facade after presentation extraction", () => {
  assert.match(shareModal, /export function MultiSelectModal/);
  assert.match(shareModal, /function getSelectableMessageIds/);
  assert.match(shareModal, /summarizeMessage\(stripAnsi/);
  assert.match(surface, /from "\.\/MessageShareModal"/);
  assert.match(surface, /export \{ MultiSelectModal \}/);
  assert.doesNotMatch(surface, /function getSelectableMessageIds/);
});
