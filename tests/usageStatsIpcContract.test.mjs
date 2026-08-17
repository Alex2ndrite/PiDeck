import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * 用量统计跨层契约护栏：
 *  - IPC 通道三处同步（shared/ipc.ts ↔ main handler ↔ preload ↔ previewApi stub）
 *  - 渲染层 i18n 中英文 key 同步
 *  - 通道命名遵循 domain:action
 */

const ipc = readFileSync("src/shared/ipc.ts", "utf8");
const handler = readFileSync("src/main/ipc/usageStatsIpc.ts", "utf8");
const preload = readFileSync("src/preload/index.ts", "utf8");
const previewApi = readFileSync("src/renderer/src/previewApi.ts", "utf8");
const usageStatsTab = readFileSync(
  "src/renderer/src/components/app/settings/UsageStatsTab.tsx",
  "utf8",
);
const usageDashboard = readFileSync(
  "src/renderer/src/components/app/usageStats/UsageDashboardSection.tsx",
  "utf8",
);
const composer = readFileSync(
  "src/renderer/src/components/session/ComposerComponents.tsx",
  "utf8",
);
const settingsFeatureRoot = readFileSync(
  "src/renderer/src/components/app/SettingsFeatureRoot.tsx",
  "utf8",
);
const settingsModal = readFileSync(
  "src/renderer/src/components/app/SettingsModal.tsx",
  "utf8",
);
const appUiAtoms = readFileSync("src/renderer/src/atoms/app-ui-atoms.ts", "utf8");
const quotaOverview = readFileSync(
  "src/renderer/src/components/app/usageStats/OpenAiCodexQuotaOverview.tsx",
  "utf8",
);
const usageStyles = readFileSync("src/renderer/src/styles/usageStats.css", "utf8");
// 新架构 i18n 按语言拆分为 rendererCopy.{zh-CN,en-US}.ts（旧单文件 i18n.ts 只含类型/工具）
const i18nZh = readFileSync("src/renderer/src/i18n/rendererCopy.zh-CN.ts", "utf8");
const i18nEn = readFileSync("src/renderer/src/i18n/rendererCopy.en-US.ts", "utf8");

const CHANNELS = [
  "usageStatsDetect",
  "usageStatsRefresh",
  "usageStatsGet",
  "usageStatsGetCodexQuota",
];

test("usage-stats channels are declared in shared/ipc.ts with domain:action names", () => {
  for (const key of CHANNELS) {
    assert.match(ipc, new RegExp(`${key}:\\s*"usage-stats:[a-z-]+"`), key);
  }
  assert.match(ipc, /usageStatsDetect:\s*"usage-stats:detect"/);
  assert.match(ipc, /usageStatsRefresh:\s*"usage-stats:refresh"/);
  assert.match(ipc, /usageStatsGet:\s*"usage-stats:get"/);
  assert.match(ipc, /usageStatsGetCodexQuota:\s*"usage-stats:get-codex-quota"/);
});

test("main handler registers every usage-stats channel", () => {
  for (const key of CHANNELS) {
    assert.match(handler, new RegExp(`ipc\\.handle\\(ipcChannels\\.${key}`), key);
  }
  assert.match(handler, /typeof options !== "object"/);
  assert.match(handler, /typeof force !== "boolean"/);
});

test("preload exposes the usageStats group with local and Codex methods", () => {
  assert.match(preload, /usageStats:\s*\{/);
  assert.match(preload, /detect:\s*\(\)/);
  assert.match(preload, /refresh:\s*\(\)/);
  assert.match(preload, /get:\s*\(\)/);
  assert.match(preload, /getCodexQuota:/);
  for (const key of CHANNELS) {
    assert.match(preload, new RegExp(`ipcChannels\\.${key}`), key);
  }
});

test("previewApi stub keeps the PiDesktopApi shape (usageStats group present)", () => {
  assert.match(previewApi, /usageStats:\s*\{/);
  assert.match(previewApi, /installed: false/);
  assert.match(previewApi, /get: async \(\) => null/);
});

test("i18n zh-CN and en-US dictionaries carry the same usageStats keys", () => {
  const zhSection = i18nZh;
  const enSection = i18nEn;
  const zhKeys = [...zhSection.matchAll(/"(usageStats\.[a-zA-Z0-9.]+)"/g)].map((m) => m[1]);
  const enKeys = [...enSection.matchAll(/"(usageStats\.[a-zA-Z0-9.]+)"/g)].map((m) => m[1]);
  assert.ok(zhKeys.length >= 25, `expected a full key set, got ${zhKeys.length}`);
  assert.deepEqual(
    [...zhKeys].sort(),
    [...enKeys].sort(),
    "zh-CN and en-US usageStats key sets must match",
  );
  // 必含的 tab key
  assert.ok(zhKeys.includes("usageStats.cards.totalTokens"));
  assert.ok(zhKeys.includes("usageStats.heatmap.title"));
});

test("usage dashboard keeps data state in the tab and presentation in a dedicated view", () => {
  assert.match(usageStatsTab, /<UsageDashboardSection/);
  assert.doesNotMatch(usageStatsTab, /usage-stats-/);
  assert.doesNotMatch(usageStatsTab, /console\./);
  assert.match(usageDashboard, /<Progress/);
  assert.match(usageDashboard, /buildUsagePeriodRows\(data\)/);
  assert.match(usageDashboard, /buildTokenBreakdown\(data\.totals\)/);
  assert.match(usageDashboard, /<OpenAiCodexQuotaOverview/);
  assert.doesNotMatch(i18nEn, /not account quota or remaining credits/);
});

test("Composer exposes the quota indicator only for the selected openai-codex provider", () => {
  assert.match(composer, /const quotaProvider = modelTo\?\.provider \?\? modelFrom\?\.provider/);
  assert.match(composer, /quotaProvider === "openai-codex"/);
  assert.match(composer, /<OpenAiCodexQuotaIndicator/);
  assert.match(composer, /<TooltipContent[\s\S]*<OpenAiCodexQuotaOverview/);
  assert.match(quotaOverview, /snapshot\.fiveHour, props\.snapshot\.weekly/);
});

test("quota UI shows remaining percentage and a precise reset timestamp", () => {
  assert.match(quotaOverview, /remainingQuotaPercent\(window\.usedPercent\)/);
  assert.match(quotaOverview, /<Progress value=\{remainingPercent\}/);
  assert.match(quotaOverview, /formatQuotaResetAt\(window\.resetsAt/);
  assert.doesNotMatch(quotaOverview, /Math\.ceil\(hours \/ 24\)/);
  assert.match(i18nZh, /"usageStats\.quota\.remainingPercent":\s*"剩余 \{percentage\}%"/);
  assert.match(i18nEn, /"usageStats\.quota\.remainingPercent":\s*"\{percentage\}% remaining"/);
});

test("clicking the Composer quota indicator opens Settings on the usage tab", () => {
  assert.match(appUiAtoms, /settingsRequestedTabAtom/);
  assert.match(composer, /setSettingsRequestedTab\("usage"\)/);
  assert.match(composer, /setSettingsOpen\(true\)/);
  assert.match(composer, /onClick=\{handleOpenUsageStats\}/);
  assert.match(settingsFeatureRoot, /initialTab:\s*requestedTab/);
  assert.match(settingsModal, /props\.initialTab \?\? loadLastSettingsTab\(\)/);
});

test("usage legacy stylesheet retains only the dynamic heatmap color anchors", () => {
  assert.doesNotMatch(usageStyles, /\.usage-stats-/);
  const heatmapAnchors = [...usageStyles.matchAll(/\.usage-heatmap-l([0-4])\s*\{/g)]
    .map((match) => Number(match[1]));
  assert.deepEqual(heatmapAnchors, [0, 1, 2, 3, 4]);
});
