import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const controls = readFileSync(
  "src/renderer/src/components/app/git/GitPanelControls.tsx",
  "utf8",
);

test("Git compact filter uses shadcn Select instead of a hand-rolled listbox", () => {
  assert.match(controls, /import \{\s*Select,\s*SelectContent,\s*SelectItem,\s*SelectTrigger,/);
  assert.match(controls, /<Select value=\{props\.value\} onValueChange=\{props\.onChange\}>/);
  assert.match(controls, /<SelectTrigger/);
  assert.match(controls, /<SelectContent className="min-w-40">/);
  assert.match(controls, /<SelectItem key=\{option\.value\} value=\{option\.value\}>/);
});

test("Git compact filter no longer hand positions or tracks the viewport", () => {
  assert.doesNotMatch(controls, /getViewportBoundMenuPlacement/);
  assert.doesNotMatch(controls, /createPortal/);
  assert.doesNotMatch(controls, /handlePointerDown/);
  assert.doesNotMatch(controls, /menuStyle/);
  assert.doesNotMatch(controls, /role="listbox"/);
});

test("Git compact filter keeps the compact trigger and accessible label", () => {
  assert.match(controls, /aria-label=\{props\.ariaLabel\}/);
  assert.match(controls, /h-6 min-w-0 gap-1 overflow-hidden rounded-sm border border-transparent/);
  assert.match(controls, /max-w-\[80px\] truncate/);
});
