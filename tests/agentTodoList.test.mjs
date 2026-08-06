import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const widget = readFileSync("src/renderer/src/components/session/SessionWidgetChips.tsx", "utf8");
const list = readFileSync("src/renderer/src/components/session/AgentTodoList.tsx", "utf8");

test("plan and todo widgets use the reusable BEUI-style TodoList", () => {
  assert.match(widget, /AgentTodoList/);
  assert.match(widget, /parseAgentTodoItems/);
  assert.match(widget, /collapseOnComplete/);
  assert.match(list, /export function parseAgentTodoItems/);
  assert.match(list, /in-progress/);
  assert.match(list, /collapseOnComplete/);
});

test("todo parser supports plan numbering and completion markers", () => {
  assert.match(list, /replace\(\/\^\\d\+\[\.\)\]/);
  assert.match(list, /startsWith\("☑"\)/);
  assert.match(list, /\^\(\?:☑\|☐\|◐/);
});
