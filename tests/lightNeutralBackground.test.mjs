import assert from "node:assert/strict";
import test from "node:test";
import { readRendererStyles } from "./helpers/rendererStyles.mjs";

const css = readRendererStyles();

function block(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`${escaped} \\{([^}]*)\\}`));
  assert.ok(match, `missing ${selector}`);
  return match[1];
}

test("light theme background tokens are neutral (no green tint)", () => {
  // 大面积背景必须是中性灰白（修复前 #f8f8f5/#f2f2ee/#f0f1ed 带黄绿调）
  assert.match(block(":root"), /--color-bg-app:\s*#fafafa;/i);
  assert.match(block(":root"), /--color-bg-sidebar:\s*#f5f5f5;/i);
  assert.match(block(":root"), /--color-bg-panel:\s*#ffffff;/i);
  assert.match(block(":root"), /--color-bg-muted:\s*#f3f3f3;/i);
  assert.match(block(":root"), /--color-bg-hover:\s*#f3f3f3;/i);
  assert.match(block(":root"), /--color-bg-active:\s*#ededed;/i);
  // 边框也中性化（修复前 #e5e5df 系带黄绿调）
  assert.match(block(":root"), /--color-border-subtle:\s*#e5e5e5;/i);
  assert.match(block(":root"), /--color-border-default:\s*#dfdfdf;/i);
  assert.match(block(":root"), /--color-border-strong:\s*#d7d7d7;/i);
});
