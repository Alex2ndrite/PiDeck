import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// 内容宽度百分比重构契约：contentMaxWidth(px) → chatContentWidthPct(%)
const settingsType = readFileSync("src/shared/types/settings.ts", "utf8");
const store = readFileSync("src/main/settings/SettingsStore.ts", "utf8");
const appShell = readFileSync("src/renderer/src/components/app/AppShell.tsx", "utf8");
const splitStage = readFileSync(
  "src/renderer/src/components/session/SessionSplitStage.tsx",
  "utf8",
);
const modal = readFileSync("src/renderer/src/components/app/SettingsModal.tsx", "utf8");
const tailwind = readFileSync("src/renderer/src/styles/tailwind.css", "utf8");
const foundation = readFileSync("src/renderer/src/styles/foundation.css", "utf8");
const timeline = readFileSync(
  "src/renderer/src/components/session/SessionMessageTimeline.tsx",
  "utf8",
);
const composerArea = readFileSync("src/renderer/src/components/session/ComposerArea.tsx", "utf8");
const composerPanels = readFileSync(
  "src/renderer/src/components/session/ComposerPanels.tsx",
  "utf8",
);
const runtimeOverlay = readFileSync(
  "src/renderer/src/components/overlays/SessionRuntimeUiOverlay.tsx",
  "utf8",
);
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
  // 容器查询锚点必须下沉到每个会话栏；chat-pane 只负责传递设置变量。
  assert.doesNotMatch(appShell, /chat-pane @container/);
  assert.match(splitStage, /chat-content-width @container/);
});

test("UI 2.0: shared-margin variables live in tailwind.css, not legacy foundation.css", () => {
  // 变量链是 UI 2.0 自定义 utility：每个 solo/split 会话栏各自按栏宽求值。
  assert.match(
    tailwind,
    /@utility chat-content-width \{[\s\S]*?100cqi \* \(1 - \(var\(--chat-content-pct-set, 80%\) \/ 100%\)\) \/ 2/,
  );
  assert.match(tailwind, /--chat-inline-pad: max\(24px, var\(--chat-side-gap\)\)/);
  // 旧架构（foundation.css）不得再持有宽度体系规则；左右 padding 也不能写死盖住变量
  assert.doesNotMatch(foundation, /--chat-inline-pad|--chat-side-gap|--content-max-width|@container/);
  assert.match(foundation, /\.message-timeline \{[\s\S]*?padding-block: 18px 24px;[\s\S]*?padding-inline: 0;/);
  // 组件侧（UI 2.0 utility）：消息区与输入框共享同一留白 + 分屏窄栏容器查询收敛
  assert.match(
    timeline,
    /\[padding-inline:var\(--chat-inline-pad\)\] transition-\[padding-inline\] duration-150 ease-out @max-\[1100px\]:px-6/,
  );
  assert.match(composerArea, /\[padding-inline:var\(--chat-inline-pad\)\]/);
  assert.match(composerArea, /@max-\[1100px\]:px-6/);
  // 外层 composer 不得再 px-3，否则与消息区左右错位、百分比观感被额外 12px 干扰
  assert.match(composerArea, /className="composer[^"]*px-0 pb-3"/);
  // 消息列表必须撑满（flex 容器内不被内容收缩），并随留白缩进
  assert.match(timeline, /className="message-list min-w-0 w-full mx-auto transition-opacity duration-150"/);
  // 附件条/扩展区/排队条/ask 条与输入框同宽对齐
  assert.match(composerPanels, /image-preview-area mx-auto w-\[calc\(100%-2\*var\(--chat-inline-pad\)\)\]/);
  assert.match(composerPanels, /extension-widgets-container mx-auto w-\[calc\(100%-2\*var\(--chat-inline-pad\)\)\]/);
  assert.match(composerPanels, /queued-track mx-auto flex min-w-0 w-\[calc\(100%-2\*var\(--chat-inline-pad\)\)\]/);
  assert.match(runtimeOverlay, /ask-inline-bar ask-inline-bar--active mx-auto w-\[calc\(100%-2\*var\(--chat-inline-pad\)\)\]/);
});

test("SettingsModal slider is 60–100 with always-visible save button", () => {
  assert.match(modal, /min="60"/);
  assert.match(modal, /max="100"/);
  assert.match(modal, /step="1"/);
  assert.match(modal, /updateDraft\(\{ chatContentWidthPct: parseInt/);
  // 保存按钮常驻（无 dirty 时禁用），不再只在 dirty 时出现
  assert.match(modal, /disabled=\{!hasDirtyChanges\}/);
  // 紧凑单行：不渲染示意图/留白附加行（用户要求去丑）
  assert.doesNotMatch(modal, /sideGapPct/);
  assert.doesNotMatch(modal, /contentWidthGap/);
});

test("i18n has new keys in both locales and legacy width keys are gone", () => {
  for (const locale of [zh, en]) {
    assert.match(locale, /"settings\.contentWidthPct"/);
    assert.match(locale, /"settings\.contentWidthPctDesc"/);
    assert.doesNotMatch(locale, /"settings\.contentMaxWidth"/);
    assert.doesNotMatch(locale, /contentWidthGap/);
  }
});
