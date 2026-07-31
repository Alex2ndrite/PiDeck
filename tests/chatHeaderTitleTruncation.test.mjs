import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * pure official：标题截断/布局改由 SessionHeader Tailwind 承担。
 */

const header = readFileSync(
  "src/renderer/src/components/session/SessionHeader.tsx",
  "utf8",
);

test("chat header gives the agent title remaining width before ellipsis", () => {
  assert.match(header, /grid-cols-\[minmax\(0,1fr\)_auto\]/);
  assert.match(header, /chat-title-block flex min-w-0 flex-1/);
  assert.match(header, /truncate text-base font-semibold/);
  assert.match(header, /chat-header-actions flex min-w-0 items-center justify-end/);
});
