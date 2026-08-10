import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// 内容宽度百分比重构契约：contentMaxWidth(px) → chatContentWidthPct(%)
const settingsType = readFileSync("src/shared/types/settings.ts", "utf8");
const store = readFileSync("src/main/settings/SettingsStore.ts", "utf8");
const appShell = readFileSync("src/renderer/src/components/app/AppShell.tsx", "utf8");
const modal = readFileSync("src/renderer/src/components/app/SettingsModal.tsx", "utf8");
const foundation = readFileSync("src/renderer/src/styles/foundation.css", "utf8");
const zh = readFileSync("src/renderer/src/i18n/rendererCopy.zh-CN.ts", "utf8");
const en = readFileSync("src/renderer/src/i18n/rendererCopy.en-US.ts", "utf8");

test("settings type keeps legacy contentMaxWidth for read compat and adds chatContentWidthPct", () => {
  assert.match(settingsType, /contentMaxWidth: number/);
  assert.match(settingsType, /chatContentWidthPct: number/);
  // 旧字段必须保留（旧 settings.json 读取兼容），不能删成可选（否则全链路 undefined 传播）
  assert.match(settingsType, /@deprecated 由 chatContentWidthPct 取代/);
});

test("SettingsStore default is 80% (readable width, not full width)", () => {
  assert.match(store, /chatContentWidthPct: 80/);
});

test("SettingsStore migrates legacy px via linear mapping on load", () => {
  // 迁移必须在 load() 的兼容迁移区调用（commit-mono 迁移之后、catch 之前）
  assert.match(store, /this\.migrateContentWidth\(\)/);
  // 线性映射公式：px∈[800,1800) → pct∈[60,100)；其余（≤0 或 ≥1800=不限）→ 100
  assert.match(store, /\(\(legacyPx - 800\) \/ 1000\) \* 40 \+ 60/);
  assert.match(store, /legacyPx > 0 && legacyPx < 1800/);
  // 已存在新值（已迁移/用户已设置）时不得覆盖
  assert.match(store, /if \(typeof pct === "number" && Number\.isFinite\(pct\)\) return/);
  // 迁移后写回持久化
  assert.match(store, /this\.save\(\)\.catch/);
});

test("AppShell always injects --chat-content-pct-set without conditional branch", () => {
  // 始终注入（100% 时由 CSS max() 回退最小边距），不再有 contentMaxWidth 条件注入
  assert.match(appShell, /"--chat-content-pct-set": `\$\{chatContentWidthPct\}%/);
  assert.doesNotMatch(appShell, /--content-max-width/);
});

test("foundation.css implements shared-margin variable chain + container-query split adaptivity", () => {
  // 变量链：set → effective → side-gap → inline-pad（max(留白, 24px) 保住最小呼吸）
  assert.match(foundation, /container-type: inline-size/);
  assert.match(foundation, /--chat-content-pct-set/);
  assert.match(foundation, /--chat-side-gap: calc\(\(100% - var\(--chat-content-pct\)\) \/ 2\)/);
  assert.match(foundation, /--chat-inline-pad: max\(var\(--chat-side-gap\), 24px\)/);
  // 分屏/窄栏自适应：≤1100px 内容 100%；1100–1600px 线性过渡
  assert.match(foundation, /@container \(max-width: 1100px\)/);
  assert.match(foundation, /1600px - 100cqw/);
  // 消息与输入框共享同一留白（消除「一边最大一边最小」）
  assert.match(foundation, /\.composer-box \{\s*padding-inline: var\(--chat-inline-pad\)/);
  assert.match(foundation, /padding: 18px var\(--chat-inline-pad\) 24px/);
  // 旧 px 注入体系必须删除
  assert.doesNotMatch(foundation, /--content-max-width/);
});

test("SettingsModal slider is 60–100 with live gap display and always-visible save button", () => {
  assert.match(modal, /min="60"/);
  assert.match(modal, /max="100"/);
  assert.match(modal, /step="1"/);
  assert.match(modal, /updateDraft\(\{ chatContentWidthPct: parseInt/);
  // 留白副显示：左右各 (100-pct)/2
  assert.match(modal, /sideGapPct = \(100 - draftSettings\.chatContentWidthPct\) \/ 2/);
  assert.match(modal, /settings\.contentWidthGap/);
  // 保存按钮常驻（无 dirty 时禁用），不再只在 dirty 时出现
  assert.match(modal, /disabled=\{!hasDirtyChanges\}/);
});

test("i18n has new keys in both locales and legacy width keys are gone", () => {
  for (const locale of [zh, en]) {
    assert.match(locale, /"settings\.contentWidthPct"/);
    assert.match(locale, /"settings\.contentWidthPctDesc"/);
    assert.match(locale, /"settings\.contentWidthGap"/);
    assert.doesNotMatch(locale, /"settings\.contentMaxWidth"/);
  }
});
