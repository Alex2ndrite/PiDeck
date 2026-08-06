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
  // 用户气泡规则在 #113 会话动画改版中重新引入；要求只使用语义 token（color-mix + var），
  // 禁止写死 hex，保证暗色模式与主题色切换自然适配。
  const bubbleBlocks = [...css.matchAll(/\.user-turn-bubble(?::hover)?\s*\{([^}]*)\}/g)]
    .map((m) => m[1])
    // 跳过 prefers-reduced-motion 里只关动画的覆写块，只检查真正着色的规则
    .filter((body) => /background|border-color|box-shadow/.test(body));
  assert.ok(bubbleBlocks.length > 0, "user-turn-bubble rules should exist");
  for (const body of bubbleBlocks) {
    assert.doesNotMatch(body, /#[0-9a-f]{3,8}\b/i, "user-turn-bubble must not hardcode hex colors");
    assert.match(body, /var\(--color-/, "user-turn-bubble must use semantic tokens");
  }
  // 表格 wrapper 只负责工具栏和横向滚动，实际表格/表头承载唯一视觉表面。
  assert.match(block('[data-streamdown="table-wrapper"] > div:first-child'), /background:\s*transparent;/);
  assert.match(block('[data-streamdown="table-wrapper"] > div:last-child'), /background:\s*transparent;/);
  assert.match(block('[data-streamdown="table"]'), /background:\s*var\(--color-chat-table-bg\);/);
  assert.match(block('[data-streamdown="table-wrapper"] thead'), /background:\s*var\(--color-chat-muted-bg\);/);
});
