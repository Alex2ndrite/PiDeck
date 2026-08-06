import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const marker = readFileSync(
  "src/renderer/src/components/session/TimelineMarker.tsx",
  "utf8",
);
const toolCard = readFileSync(
  "src/renderer/src/components/session/ToolCallComponents.tsx",
  "utf8",
);
const events = readFileSync(
  "src/renderer/src/components/session/TimelineEventCards.tsx",
  "utf8",
);

test("TimelineMarker keeps event kinds and tones explicit", () => {
  assert.match(marker, /TimelineMarkerKind = "thinking" \| "tool" \| "compaction" \| "diagnostic" \| "ask"/);
  assert.match(marker, /TimelineMarkerTone = "neutral" \| "active" \| "success" \| "warning" \| "error"/);
  assert.match(marker, /data-marker-kind=\{props\.kind\}/);
  assert.match(marker, /data-marker-tone=\{tone\}/);
  assert.match(marker, /bg-border-subtle/);
});

test("tool cards map execution status to marker tone without changing detail behavior", () => {
  assert.match(toolCard, /kind="tool"/);
  assert.match(toolCard, /tone=\{tone === "error" \? "error" : tone === "running" \? "active" : "success"\}/);
  assert.match(toolCard, /aria-expanded=\{expanded\}/);
  assert.match(toolCard, /getToolDetailText/);
  assert.match(toolCard, /tool-card-copy/);
});

test("thinking, compaction, diagnostic, and ask cards use the same marker rail", () => {
  for (const kind of ["thinking", "compaction", "diagnostic", "ask"]) {
    assert.match(events, new RegExp(`kind=\\"${kind}\\"`));
  }
  assert.match(events, /setExpanded\(\(v\) => !v\)/);
  assert.match(events, /setExpanded\(!expanded\)/);
  assert.match(events, /data-message-id=\{props\.message\.id\}/);
});

// Chain of Thought 步骤节点升级：完成/失败不再是同色圆点，轨道节点直接承载
// 状态语义（✓/✗），扫一眼即可定位失败步骤。
test("marker rail nodes carry status icons for success and error tones", () => {
  // success → Check、error → X；active/neutral/warning 保持圆点（无图标映射）
  assert.match(marker, /success: <Check size=\{9\}/);
  assert.match(marker, /error: <X size=\{9\}/);
  assert.doesNotMatch(marker, /active: </);
  // 图标必须显式白色 stroke：tone 类把 color 设为底色，lucide 默认 currentColor
  // 会导致图标与底色同色不可见
  assert.match(marker, /strokeWidth=\{3\.5\} color="#fff"/);
  // ✓/✗ 节点放大为 14px 并微调基线
  assert.match(marker, /TONE_STATUS_ICONS\[tone\] && "mt-1 size-3\.5"/);
});
