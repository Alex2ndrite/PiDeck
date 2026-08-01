import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { readRendererStyles } from "./helpers/rendererStyles.mjs";

const css = readRendererStyles();

function block(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`${escaped} \\{([^}]*)\\}`));
  assert.ok(match, `missing ${selector}`);
  return match[1];
}

test("fixed light chat/table colors are tokenized for dark mode", () => {
  // 暖白基底：浅色卡片近白底，暗色对齐暖黑系
  assert.match(block(":root"), /--color-chat-card-bg:\s*#fafafa;/i);
  assert.match(block(":root"), /--color-chat-muted-bg:\s*#f4f4f5;/i);
  assert.match(block(":root"), /--color-chat-table-bg:\s*#ffffff;/i);
  assert.match(block(":root[data-theme=\"dark\"]"), /--color-chat-card-bg:\s*#171717;/i);
  assert.match(block(":root[data-theme=\"dark\"]"), /--color-chat-muted-bg:\s*#202020;/i);
  assert.match(block(":root[data-theme=\"dark\"]"), /--color-chat-table-bg:\s*#171717;/i);

  assert.match(block(".diagnostic-card"), /background:\s*var\(--color-chat-muted-bg\);/);
  assert.doesNotMatch(css, /\.user-turn-bubble\s*\{/);  // 迁移后无独立规则，背景由 bg-muted/60 utility 承担
  assert.match(block(".markdown-body .table-wrap"), /background:\s*var\(--color-chat-table-bg\);/);
  assert.match(block(".markdown-body .table-wrap thead"), /background:\s*var\(--color-chat-muted-bg\);/);
  assert.match(block(".markdown-body .table-wrap tr td"), /background:\s*var\(--color-chat-table-bg\);/);
});
