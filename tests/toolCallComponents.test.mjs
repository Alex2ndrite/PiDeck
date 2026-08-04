import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const surface = readFileSync(
  "src/renderer/src/components/session/SurfaceComponents.tsx",
  "utf8",
);
const toolCalls = readFileSync(
  "src/renderer/src/components/session/ToolCallComponents.tsx",
  "utf8",
);
const timelineFormat = readFileSync(
  "src/renderer/src/components/session/TimelineFormat.ts",
  "utf8",
);

test("tool-call rendering stays isolated behind the SurfaceComponents facade", () => {
  assert.match(toolCalls, /export const ToolCard = memo/);
  assert.match(toolCalls, /export const ToolGroupCard = memo/);
  assert.match(surface, /from "\.\/ToolCallComponents"/);
  assert.match(surface, /export \{ ToolCard, ToolGroupCard \}/);
  assert.doesNotMatch(surface, /function toolIcon\(toolName/);
  assert.doesNotMatch(surface, /const BUILT_IN_TOOLS = new Set/);
});

test("timeline tool rendering and message rows share formatting helpers", () => {
  assert.match(toolCalls, /from "\.\/TimelineFormat"/);
  assert.match(surface, /from "\.\/TimelineFormat"/);
  assert.match(timelineFormat, /export function stripAnsi/);
  assert.match(timelineFormat, /export function formatDuration/);
  assert.match(timelineFormat, /export function getToolStatus/);
});

test("tool and thinking disclosure icons use right-for-collapsed down-for-expanded semantics", () => {
  assert.match(toolCalls, /\{expanded \? \([\s\S]*<ChevronDown[\s\S]*\) : \([\s\S]*<ChevronRight/);
});
