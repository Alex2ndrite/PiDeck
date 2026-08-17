# Codex 用量仪表盘复刻计划

> 负责人：Sol（规划、评审、验收） / Luna（细节实现）
> 日期：2026-08-17
> 目标版本：PiDeck 0.7.x
> 状态：实现完成；专项验收通过，全量门禁受既有跨平台测试问题阻塞（见第 8 节）

## 1. 背景与目标

PiDeck 已经具备完整的本地用量统计链路：`pi-tracker` 将每轮对话写入
`<agentDir>/analytics/usage.jsonl`，主进程负责增量读取、缓存与聚合，渲染层通过
`usage-stats:*` IPC 获取 `UsageAggregated`。本次不重做采集或聚合，而是在现有真实数据上，
复刻 Codex「Usage」页面的视觉结构与信息层级：

- 页面级标题、说明与右上角刷新动作；
- 白底/淡底分组卡片、卡片标题、紧凑指标行与行间分隔；
- 左侧标签和说明、右侧数值与细进度条的 Codex 式阅读节奏；
- 加载、缺插件、空数据、失败、刷新中的完整状态；
- 深浅主题、窄窗口和中英文文案下都保持可读。

官方 OpenAI 文档说明 Codex 的当前限额来自用量仪表盘，常见窗口包括滚动五小时和周限额；
但 PiDeck 的 `pi-tracker` 只记录实际 Token/成本，不提供账户配额或剩余额度。因此本次只做
「视觉与交互模式复刻 + PiDeck 数据语义适配」，绝不把本地 Token 统计伪装成官方配额。

参考：<https://learn.chatgpt.com/docs/pricing#where-can-i-see-my-current-usage-limits>

## 2. 核心边界

### 必须保持

1. 数据源仍为 `pi-tracker`，不新增 OpenAI/ChatGPT HTTP 请求，不读取 Codex 私有接口。
2. 不改变 `UsageStatsService`、`usage-stats:*` IPC、preload API 和 `UsageAggregated` DTO；现有
   主进程增量缓存、WSL 路径切换和历史回填行为全部保留。
3. 不新增依赖，不引入图表库；图表继续使用现有 SVG 实现。
4. 用户可见文案同时落入 `rendererCopy.zh-CN.ts` 与 `rendererCopy.en-US.ts`。
5. 新/改样式只使用 Tailwind utility 与现有 shadcn 原语。触达的旧
   `usage-stats-*` 样式迁出；`usage-heatmap-l*` 仅作为既有动态色阶锚点保留。
6. 保留现有安装 `pi-tracker`、复制命令、历史回填提示、日期筛选、日/周/月切换、
   模型/项目明细等能力。

### 明确不做

- 不展示虚构的「剩余百分比」「五小时重置时间」「周配额」或套餐名称。
- 不新增配额设置、预算告警、购买 credits、账单或订阅入口。
- 不修改 `App.tsx` 或 `main/index.ts` 的业务逻辑。
- 不扩大到其他设置页，也不进行全局 CSS 重写。

## 3. Codex → PiDeck 对照

| Codex Usage 页面模式 | PiDeck 适配 | 数据来源 |
| --- | --- | --- |
| 页面标题 + 副标题 | 「用量统计」标题、说明、数据覆盖区间 | i18n + `UsageAggregated.window` |
| 页面右上刷新/重试 | 保留刷新按钮，加入图标、旋转/禁用和可访问标签 | 现有 `refresh()` |
| 分组卡片 + 紧凑行 | 统一 `UsageDashboardSection` / `UsageMetricRow` | 渲染层组件 |
| General usage limits | 「当前用量」：今日、本周、本月、累计 | `today/thisWeek/thisMonth/totals` |
| 右侧细进度条 + 百分比 | 「Token 构成」：输入、输出、缓存读取、缓存写入占比 | `totals` 各 Token 字段 |
| Credits/plan 等独立区块 | 「成本与活跃度」：成本、轮次、会话、活跃天数 | `totals/costKnown/activeDays` |
| Loading/error row | 同一仪表盘壳内的加载、失败、重试状态 | 现有 phase 状态机 |
| 额外账单分析 | PiDeck 特有活动热力图、趋势、日明细、模型/项目表 | `daily/heatmap/byModel/byProject` |

进度条只表达 Token 构成占比，分母为
`input + output + cacheRead + cacheWrite`。分母为 0 时四项均为 0%；百分比需钳制到
`0..100`，避免坏数据或浮点误差破坏布局。

## 4. 组件与文件设计

### 4.1 新增纯策略

`src/renderer/src/components/app/usageStats/usageDashboardMetrics.ts`

- `buildUsagePeriodRows(data)`：输出今日/本周/本月/累计四行，统一 Token、成本、轮次、会话数。
- `buildTokenBreakdown(totals)`：输出四类 Token 的数值与占比。
- 纯函数不依赖 React、DOM、时区或 i18n，便于 `node:test` 直接覆盖。

### 4.2 新增/重构视图

`src/renderer/src/components/app/usageStats/UsageDashboardSection.tsx`

- 提供 Codex 式卡片标题、说明、内容容器与分隔行。
- `UsageMetricRow` 在宽屏采用「说明 / 控件」双栏，窄屏自然折行。
- `UsageProgressValue` 使用现有 shadcn `Progress`，数值使用 tabular-nums，并补充
  `aria-label` / `aria-valuenow`。

`src/renderer/src/components/app/settings/UsageStatsTab.tsx`

- 只保留数据加载状态机和页面装配，不承载比例计算。
- 顶部变为页面标题、说明、数据路径/覆盖区间与刷新动作。
- ready 状态按「当前用量 → Token 构成 → 活动趋势 → 明细」组织。
- missing/error/empty 状态进入相同视觉语言；安装失败要给用户可见错误，不能只写
  `console.error`。

`UsageDayDetail.tsx`、`UsageDailyChart.tsx`、`UsageHeatmap.tsx`、`UsageTable.tsx`

- 保留原行为，迁移触达区域的旧 class 到 Tailwind。
- SVG 外加横向滚动容器，窄窗口不裁切 53 周热力图和长趋势图。
- 表格增加语义表头、右侧数值对齐和滚动容器；仍最多显示 12 行。

`src/renderer/src/styles/usageStats.css`

- 删除已迁移的布局、卡片、表格、提示和工具栏规则。
- 只保留 `usage-heatmap-l0..l4` 动态色阶锚点及必要说明；不新增视觉 class。

### 4.3 i18n

至少新增/调整以下语义：

- 页面标题、副标题、数据覆盖区间与本地数据源说明；
- 当前用量（今日/本周/本月/累计）及 Token/轮次/会话描述；
- Token 构成（输入/输出/缓存读取/缓存写入）与占比可访问文案；
- 成本未知、刷新失败、安装失败与重试动作；
- 图表/表格空态与屏幕阅读器标签。

中英文 `usageStats.*` key 集必须保持完全一致。

## 5. 状态与交互验收

| 状态 | 预期 |
| --- | --- |
| loading | 仪表盘壳内显示轻量加载行；不闪出 missing 空态 |
| missing | 显示插件用途、安装按钮、命令、复制动作、重启与回填提示 |
| installing | 按钮 loading + disabled；防止重复安装 |
| install failure | 页面内可见错误提示；用户可再次安装/刷新 |
| empty | 已安装但无记录时说明「开始对话」及历史回填方式 |
| ready | 真实统计、构成比例、热力图、趋势、日明细和排行均可见 |
| refreshing | 刷新按钮 loading + disabled；现有数据不消失 |
| refresh failure | 保留现有数据并显示可恢复错误，不把页面永久切成空白 |
| narrow layout | 右侧数值不溢出；SVG/表格可横向滚动；按钮可换行 |
| dark theme | 仅使用语义 token，卡片、轨道、文字和热力图对比正常 |

## 6. 自动化测试

新增 `tests/usageDashboardMetrics.test.mjs`，至少覆盖：

1. 今日/周/月/累计行映射正确，原 DTO 不被修改；
2. Token 构成按四字段总和计算，结果稳定；
3. 全零数据返回 0%，无 `NaN` / `Infinity`；
4. 百分比钳制在 `0..100`，异常负数不污染进度；
5. 四项占比在正常输入下总和约等于 100%；
6. `costKnown=false` 能传递到展示模型。

更新现有 IPC/i18n 契约测试，确保：

- 没有新增跨层通道；
- 中英文 key 对齐；
- `UsageStatsTab.tsx` 不硬编码用户可见中英文；
- 旧 `usage-stats-*` 布局 class 不再残留，仅允许热力图色阶锚点。

最终门禁：

```bash
npm run typecheck
npm test
```

如环境允许，再执行针对设置页的 Electron E2E；E2E 不作为伪造真实用量数据的理由。

## 7. 完成定义

- [x] 视觉结构明显对齐 Codex Usage 页的稀疏分组卡片和指标行节奏。
- [x] 所有数值均来自 `UsageAggregated`，没有虚构配额或网络旁路。
- [x] 原有用量统计功能无能力回退。
- [x] 触达 UI 完成 Tailwind/shadcn 增量迁移，暗色和窄窗使用语义 token 与滚动兜底。
- [x] i18n 双语完整，加载/缺失/空/失败/刷新状态可恢复。
- [x] 新增纯函数与 UI 契约测试通过，`npm run typecheck` 全绿。
- [ ] 单次 `npm test` 全绿；当前混合 WSL/Windows 环境存在与本功能无关的平台失败/并发挂起。
- [x] Sol 完成最终 diff 审查并记录未执行的人工/平台验收项。

## 8. 自动验收记录

| 命令 | 结果 | 说明 |
| --- | --- | --- |
| `npm run typecheck` | 通过 | TypeScript strict 门禁退出码 0。 |
| `node --test tests/usage*.test.mjs` | 通过，67/67 | 覆盖指标映射、坏数据、IPC、i18n、视图分层与 legacy CSS 收口。 |
| `git diff --check` | 通过 | 无空白错误。 |
| Windows Node：`node --test tests/stylesSyntax.test.mjs` | 通过，3/3 | 真实 Vite CSS 管线通过。WSL Node 因当前依赖树缺少 Rollup Linux 可选二进制而无法启动该用例。 |
| Windows Node：`node --test tests/piLocator.test.mjs` | 通过，12/12 | 同一用例在 WSL Node 下因宿主路径分隔符不同失败，确认不是本次回归。 |
| WSL：`npm test` | 2139/2141 | 仅上述 Rollup 可选依赖与 Windows PATH 模拟两项平台失败；用量用例全部通过。 |
| Windows：`npm test` | 未形成总汇 | 运行至既有 `sessionScanner*` 调度区后长期无输出，人工停止；隔离复跑 `sessionScannerSubagents` 10/10、`sessionScannerWslMaxBuffer` 2/2 及相邻会话 UI 用例 39/39 均通过。 |

本轮未执行 Electron 人工视觉 smoke/E2E；交付前仍建议在设置页用真实 `pi-tracker`
数据检查浅色、暗色和窄窗口观感。仓库的合并硬门禁仍应在测试平台问题修复后重新跑出单次
`npm test` 全绿，本计划不把分段通过伪装成单次全绿。
