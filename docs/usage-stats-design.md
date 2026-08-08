# PiDeck 用量统计（Usage Stats）设计文档

> 状态：待评审 · 日期：2026-08 · 关联调研：`docs/` 无（结论见本文件「决策记录」）
> 原则：不内置采集逻辑；pi 的事交给 pi（扩展采集），PiDeck 只做「读数据 + 展示」；符合 AGENTS.md 全部硬性约束。

## 0. 决策记录（ADR 摘要）

| # | 决策 | 理由 |
|---|------|------|
| D1 | 数据源 = pi-tracker 扩展的 `~/.pi/agent/analytics/usage.jsonl` | 事件捕获覆盖「终端/其他宿主直接跑的 pi」，PiDeck 零采集代码；装插件=开功能，卸载=隐藏（扩展机制） |
| D2 | PiDeck 不内置采集、不读会话文件聚合 | 与 D1 同一理由；避免维护第二套解析（会话 JSONL 结构复杂） |
| D3 | 读端采用「游标增量 + 版本化缓存」 | 日志 append-only；只读新增字节（TokenTracker `parsePiIncremental` 同款算法），全量重扫仅发生在文件变小/重写 |
| D4 | 图表自绘 SVG，不引 recharts/echarts | AGENTS.md「禁止为小功能引重型库」；热力图（53×7 格子）与堆叠柱（按 provider）自绘约 300 行 |
| D5 | 聚合输出以「天 × provider × model」桶为最小粒度 | 覆盖全部视图（总览/热力图/日柱/模型表/项目表）一次成型，渲染进程只收聚合结果，不碰原始日志 |
| D6 | 聚合结果缓存进磁盘（复用 `SessionSummaryCache<V>`），增量合并 | 常态刷新 O(新增行)；避免大日志全量重聚 |
| D7 | P0 不做实时 watcher/事件推送 | 面板打开时刷新 + 手动刷新按钮 + 展示数据覆盖时间窗；P1 再接 `agent_settled` 事件桥接 |

## 1. 目标与非目标

### 目标（P0）
1. 检测 pi-tracker 是否安装；未安装时显示引导卡片（安装命令 + 说明 + 回填提示）
2. 总览卡：累计 token（input/output/cacheRead/cacheWrite 分解）、成本（含「成本未知」标记）、turn 数、活跃天数、覆盖时间窗
3. 53 列（52 周回溯 + 当前周）GitHub 风格热力图（点阵，0-4 级色阶，tooltip 显示当日明细）
4. 每日用量堆叠柱状图（按 provider 堆叠；日/周/月切换）
5. 模型用量表 / 项目用量表（token、成本、turn 数）
6. 全链路增量读取：常态刷新只解析新增日志行

### 非目标（明确不做，防止范围蔓延）
- 不做采集/插件本体：不写扩展、不维护插件、不 fork pi-tracker
- 不做预算/警告系统（pi-tracker 已有；RPC 模式下其 TUI 部分天然不可用，不影响数据文件）
- 不做小时级活跃分布（P1）、价格兜底重算（P1）、导出/分享（P2）
- 不引入 SQLite / REST 服务 / 轮询守护（TokenTracker 的架构对 PiDeck 过重）

## 2. 架构分层

```
┌─ pi 进程（用户安装 pi-tracker 扩展）─────────────────────────────┐
│  message_end 事件 → append 一行到 usage.jsonl（append-only）      │
└─────────────────────────────────────────────────────────────────┘
                              ↓ 读（只读新增段）
┌─ src/main/usageStats/（新域，纯主进程）─────────────────────────┐
│  usageLogParser.ts     纯函数：行 → UsageRecord（防御式）        │
│  usageStatsAggregator.ts 纯函数：records → 聚合视图（可单测）     │
│  UsageLogReader.ts     游标增量读取 + 全量重建触发               │
│  UsageStatsCache.ts    磁盘缓存（复用 SessionSummaryCache<V>）   │
│  UsageStatsService.ts  域服务：detect / refresh / query / 装配    │
│  ipc/usageStatsIpc.ts  只做入参校验与适配（薄层）                 │
└─────────────────────────────────────────────────────────────────┘
                              ↓ shared/ipc.ts 通道 + shared/types/usageStats.ts
┌─ preload ── desktopApi.usageStats.*（最小白名单，订阅返回 unsubscribe）
┌─ renderer ── atoms/usageStatsAtoms.ts + hooks/useUsageStats.ts
│             + components/app/settings/UsageStatsTab.tsx（<400 行，超则拆）
```

依赖方向：main/preload/renderer → shared；main 不 import renderer；纯函数文件不 import Node/Electron（聚合器），读取器只 import `node:fs/promises` 与 shared 类型。

## 3. 数据契约（pi-tracker usage.jsonl）

已从 `pi-tracker@0.3.0` 源码核实（`src/storage/jsonl-store.ts`）：

```
文件：<agentDir>/analytics/usage.jsonl        （agentDir = ~/.pi/agent；不支持 $PI_CODING_AGENT_DIR，见 §4.5）
每行：JSON 数组（位置字段，紧凑格式）
  [ts, sid, cwd, model, in, out, cR, cW, tot, cost]            // 10 字段（旧版）
  [ts, sid, cwd, model, in, out, cR, cW, tot, cost, costKnown] // 11 字段（≥ 0.3.x）
字段：ts=Unix ms, sid=会话 id, cwd=pi 进程 cwd, model="provider/model",
      in/out/cR/cW/tot/cost=number, costKnown=0|1（0/缺失 = 成本未知）
```

**防御式解析规则**（`usageLogParser.ts`，全部单测覆盖）：
1. 行首尾 trim；空行跳过；JSON.parse 失败 → 跳过并计数（坏行容忍，不中断）
2. 必须是数组；字段数 10 或 11，否则跳过
3. 类型校验：ts/in/out/cR/cW/tot/cost 为有限 number（非有限值按 0 兜底或跳行——按 0 兜底并计入 warn 计数）；sid/cwd/model 为 string
4. `costKnown = 字段数 > 10 ? a[10] === 1 : cost > 0`（与 pi-tracker 自身兼容逻辑一致）
5. 去重键：`ts|sid|model`（日志 append-only，正常不重复；此为防御，防止文件被外部改写/多进程异常）
6. 单文件读取上限：`MAX_LOG_BYTES`（默认 256MB，已实现于 UsageLogReader：超限截读前段并置 `truncated` 标记，service 记录告警——防御日志失控导致全量读 OOM；数据可能不完整但可见）

## 4. 主进程域设计（src/main/usageStats/）

### 4.1 纯函数：`usageLogParser.ts`

```ts
export interface UsageRecord {
  ts: number;            // Unix ms
  sid: string;
  cwd: string;
  model: string;         // "provider/model"
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
  cost: number;
  costKnown: boolean;
}
export interface ParseLogResult {
  records: UsageRecord[];
  skippedLines: number;      // 坏行数
  warnedLines: number;       // 类型兜底数
}
export function parseUsageLogLine(line: string): UsageRecord | null;
export function parseUsageLogContent(content: string): ParseLogResult;
```

### 4.2 纯函数：`usageStatsAggregator.ts`

```ts
export type DayKey = string; // "YYYY-MM-DD" 本地时区
export interface DayTotals { tokens: number; input: number; output: number;
  cacheRead: number; cacheWrite: number; cost: number; turns: number; sessions: Set<string>; }
export interface ProviderSlice { provider: string; tokens: number; cost: number; turns: number; }
export interface UsageDayRow {
  day: DayKey; totals: DayTotals;
  byProvider: ProviderSlice[];          // 供堆叠柱
}
export interface HeatmapCell { tokens: number; turns: number; level: 0|1|2|3|4; }
export interface UsageAggregated {
  window: { since: number; to: number };   // 数据覆盖时间窗（首/末条记录 ts）
  totals: DayTotals;                        // 累计
  activeDays: number;                       // totals.tokens > 0 的天数
  today: DayTotals; thisWeek: DayTotals; thisMonth: DayTotals;
  daily: UsageDayRow[];                     // 升序，仅含有效天（前端补齐空天）
  heatmap: HeatmapCell[];                   // 53 列 × 7 天（周一开头，含空天）
  heatmapStart: string;                    // 首格日键（渲染层锚点唯一来源）
  byModel: Array<{ model: string; provider: string; tokens: number; cost: number; turns: number; sessions: number }>;
  byProject: Array<{ project: string; tokens: number; cost: number; turns: number }>;
  costKnown: boolean;                       // 存在 costKnown=false 的记录时置 false（UI 显示「部分成本未知」）
  recordCount: number;
}
export function aggregateUsage(records: UsageRecord[], now?: Date): UsageAggregated;
export function mergeAggregated(base: UsageAggregated, delta: UsageAggregated): UsageAggregated; // 增量合并（P0 用不上，P1 增量聚合预留）
```

约定：
- 日键 = 本地时区（`getFullYear/Month/Date`），测试用 `TZ=UTC` 稳定化
- 热力图周对齐：周一为一周起点；`level` 按 tokens 固定阈值分档（跨天可比）：0 / 1..99 / 100..999 / 1000..99999 / ≥100000
- 排序：byModel/byProject 按 tokens 降序

### 4.3 读取器：`UsageLogReader.ts`

```ts
export interface LogFileState { size: number; mtimeMs: number; count: number; }  // 游标
export interface IncrementalReadResult {
  newRecords: UsageRecord[];   // 本次新增解析
  fullRescan: boolean;         // 本次是否全量重扫
  fileState: LogFileState;
  skippedLines: number;
}
export class UsageLogReader {
  // 返回新增记录；文件变小/游标缺失 → 全量重扫；size 相同 → 空
  async readIncremental(logPath: string, prev: LogFileState | null): Promise<IncrementalReadResult>;
}
```

实现要点：
- `stat` → `size < prev.size`（截断/重写）或 `ino` 变化 → `start=0` 全量；否则 `createReadStream({start: prev.size})` 只读新增段
- 读完后新游标 `{size, mtimeMs, count: prev.count + newRecords.length}`
- 逐行走 `parseUsageLogLine`；用 `for await` 流式，不整读入内存

### 4.4 缓存：`UsageStatsCache`

直接复用 `src/main/sessions/SessionSummaryCache<V>`（泛型 + mtime/size 版本 + 磁盘持久化 + debounce 原子写）：

```ts
type CachedStats = { aggregated: UsageAggregated; fileState: LogFileState; };
const cache = new SessionSummaryCache<CachedStats>("usage-stats-cache.json");
// key = usage.jsonl 绝对路径；命中条件 mtimeMs+size 全等
```

P0 简化：refresh = 增量读新行 → **全量重聚**（新行并入 records 后 aggregateUsage 一次）。日志 <100k 行时重聚 <100ms；P1 若需大日志优化再做 `mergeAggregated` 增量聚合。此简化保持聚合器纯函数无状态，正确性优先。

### 4.5 域服务：`UsageStatsService.ts`

```ts
export interface UsageStatsServiceDeps {
  agentDir: string;              // 由装配层解析（见下）
  translate: (key: ...) => string;
  logger?: ...;
}
export class UsageStatsService {
  detect(): Promise<UsageStatsDetectResult>;   // 探测日志存在性/行数/最后记录时间
  refresh(): Promise<UsageStatsRefreshResult>; // 增量读 → 聚合 → 写缓存
  getAggregated(): Promise<UsageAggregated | null>; // 缓存命中直接返回，未缓存先 refresh
}
```

- **agentDir 解析**（关键细节）：复用 PiLocator/WslPaths 既有能力——与 `SessionScanner` 同源逻辑：`~/.pi/agent`（**不支持** `$PI_CODING_AGENT_DIR`，PiDeck 无法可靠得知 pi 进程的环境变量，设置自定义 agent dir 的用户看不到统计，属已知限制），WSL 场景经 `toWindowsHostPath` 转 host 路径。装配层注入，服务不自己探测环境
- detect 只 stat 文件 + 读尾几行，不触发全量读
- 错误处理：任何 IO 失败 → 结构化错误返回，不抛裸异常跨 IPC

### 4.6 IPC 装配（三处同步）

`shared/ipc.ts` 新增通道（`domain:action`）：

```ts
usageStatsDetect: "usage-stats:detect",
usageStatsRefresh: "usage-stats:refresh",
usageStatsGet: "usage-stats:get",           // 返回聚合视图
usageStatsLogPath: "usage-stats:log-path",  // 诊断用（面板显示日志位置）
```

`src/main/ipc/usageStatsIpc.ts`：只做入参校验（无入参或枚举校验）→ 调 UsageStatsService → 结构化结果；`main/index.ts` 装配：解析 agentDir（复用既有 locator）→ 构造 service → `registerUsageStatsIpc(ipc, service)`。

`preload` 暴露最小面：

```ts
usageStats: {
  detect(): Promise<UsageStatsDetectResult>;
  refresh(): Promise<UsageStatsRefreshResult>;
  get(): Promise<UsageAggregated | null>;
  getLogPath(): Promise<string | null>;
}
```

## 5. 共享类型（src/shared/types/usageStats.ts）

与第 4 节类型同名同构（`UsageRecord` 不进 shared——主进程内部；shared 只放跨层 DTO）：

```ts
UsageStatsDetectResult {
  installed: boolean;          // analytics/usage.jsonl 存在
  logPath: string | null;      // host 路径（显示用）
  recordCount: number | null;  // 行数（读前 10k 行统计或 stat 估算——P0 只给 null 也可，见实现）
  lastRecordAt: number | null; // 尾行 ts
  firstRecordAt: number | null;
}
UsageStatsRefreshResult { fullRescan: boolean; parsedRecords: number; skippedLines: number; }
UsageAggregated            // 见 4.2，Set 序列化为 string[]（IPC 结构化克隆）
```

## 6. 渲染层设计

> 实现落地与本节部分条目有出入（以代码为准）：main 分支无 jotai/atoms 与 `i18n/` 目录，组件用组件内 `useState`（`UsageStatsTab.tsx`），i18n key 加进单文件 `i18n.ts`（zh-CN/en-US 两处 + 契约测试守护），样式走 `styles.css` 手写 class（main 分支现状，无 Tailwind）；`UsageStatsCache.ts` 未单独建文件（service 直接复用 `SessionSummaryCache`）。

### 6.1 入口

- 设置弹窗（`SettingsModal.tsx`）新增 tab `usage`（`SettingsTabId` 加 `"usage"`）；**只加 tab 按钮 + 一行渲染**，组件独立成 `components/app/settings/UsageStatsTab.tsx`（不增大 SettingsModal 体量）
- tab 内三态：未安装（引导卡）→ 加载中（Skeleton）→ 数据视图；无数据（空日志）→ 空态提示

### 6.2 组件树（UsageStatsTab < 400 行，超出拆子组件）

```
UsageStatsTab
├─ UsageSummaryCards       4 张卡：累计 token / 成本（含未知标记）/ turn 数 / 活跃天数
│                           + 覆盖时间窗文案 + 刷新按钮 + 上次更新时间
├─ UsageHeatmap            SVG 53 列点阵（周一开头，月/周标签，tooltip 当日 tokens/turns）
├─ DailyUsageChart         SVG 堆叠柱（日/周/月切换；每柱按 provider 堆叠；hover 显示明细）
├─ UsageModelTable         模型排行（token/cost/turns/占比条）
└─ UsageProjectTable       项目排行（basename 显示 + 全路径 tooltip）
└─ UsageInstallGuide       （未安装态）安装命令 + 回填提示 + 展开说明
```

### 6.3 状态与 hook

- `atoms/usageStatsAtoms.ts`（单域 atom，Jotai）：`usageStatsStateAtom`（`{phase: 'unknown'|'missing'|'loading'|'ready'|'error', detect, aggregated, refreshing, error}`）；刷新动作 `refreshUsageStatsAtom`
- `hooks/useUsageStats.ts`：挂载时 `detect → get`（未缓存时自动 refresh）；提供 `refresh()`（手动按钮）；不订阅实时事件（P0）
- 派生：`useMemo` 计算热力图色阶、堆叠柱分组、空天补齐（禁止把可计算值存 state）

### 6.4 图表规格（自绘 SVG）

- 热力图：53 列 × 7 行格子，格子 10×10px + 2px 间隙；色阶 5 档复用 foundation 语义色（0 档用表面色，1-4 档用 accent 递增，暗色自动适配）；tooltip 用 shadcn Tooltip
- 堆叠柱：柱宽自适应（~30 天视图 12px/柱）；provider 配色用固定调色板（≤8 色循环，参照 aiusage DESIGN.md 图表色板思路但落到 foundation token 系）
- 无动画/无第三方图表依赖

### 6.5 i18n

`i18n/rendererCopy.zh-CN.ts` + `en-US.ts` 同步新增 `usageStats.*` key：tab 名、卡片标题、引导文案（安装命令、回填说明）、空态、错误文案、时间窗文案（「数据覆盖 2026-07-01 起 · 共 N 天」）。

### 6.6 样式

全部 Tailwind utility + shadcn 原语；不新增手写 CSS class；暗色通过 token 自动适配；数值用等宽字体（Geist Mono 已有？若无则用现有 mono token）。

## 7. 性能预算

| 项 | 预算 |
|---|---|
| 日志单行 | ~150B；10k 条 ≈ 1.5MB |
| 常态刷新 | 只读新增段 + 全量重聚 ≤ 100ms（<100k 行）；超过走 P1 增量合并 |
| 首刷（大日志 100k 行） | ≤ 1s 后台执行，不阻塞 UI（refresh 期间渲染层显示 Skeleton） |
| 渲染进程 | 只收聚合结果（daily+heatmap+表 ≈ 几十 KB），不接触原始日志 |
| 内存 | 聚合桶常驻 < 5MB（天×provider×model 稀疏桶） |
| 磁盘缓存 | usage-stats-cache.json（聚合结果，KB 级），debonce 800ms 原子写 |
| 单文件上限 | 256MB 防御（超限截读 + 告警） |

## 8. 测试计划（tests/*.test.mjs，node --test）

纯函数经 Node 22 type stripping 直 import（`streamGate.test.mjs` 先例）；`UsageStatsService` 经 transpile + vm 沙箱注入 electron stub（`sessionScannerSubagents.test.mjs` 先例）：

1. `tests/usageLogParser.test.mjs`
   - 10/11 字段行解析正确（含 costKnown 兼容：11 字段 0/1、10 字段 cost>0 推断）
   - 坏行（非 JSON/非数组/字段数错/类型错）→ 跳过计数，不抛
   - 空行/空白行；CRLF；U+2028 在 JSON 字符串内（严格 LF 分隔）
   - 去重键语义
2. `tests/usageStatsAggregator.test.mjs`
   - 日键本地时区（TZ 固定）；跨天/跨周/跨月边界
   - 热力图周对齐（周一起始）、level 阈值、空天补 0
   - provider 堆叠分解、byModel/byProject 排序、activeDays、today/thisWeek/thisMonth
   - costKnown 传播（任一未知 → false）
   - 空输入 / 单条 / 同天多条合并
3. `tests/usageLogReader.test.mjs`（临时目录 fixture）
   - 追加 → 只返回新增；size 相同 → 空；文件变小 → 全量重扫
   - 游标持久化（prev 状态恢复）；坏行计数
4. `tests/usageStatsIpcContract.test.mjs`（源码契约测试，项目惯例）：通道常量三处同步（shared/ipc.ts ↔ main handler ↔ preload）、非法入参校验存在

门禁：`npm run typecheck` 全绿 + `node --test tests/*.test.mjs`（main 分支无 test 脚本；基线有 49 个既有失败，验收标准 = 本功能不新增失败）。

## 9. 实现顺序（Checklist）

1. `src/shared/types/usageStats.ts`（DTO）
2. `src/main/usageStats/usageLogParser.ts` + 测试（红→绿）
3. `src/main/usageStats/usageStatsAggregator.ts` + 测试（红→绿）
4. `src/main/usageStats/UsageLogReader.ts` + 测试（临时文件）
5. `src/main/usageStats/UsageStatsCache.ts`（薄封装复用 SessionSummaryCache）
6. `src/main/usageStats/UsageStatsService.ts`（detect/refresh/get）
7. `shared/ipc.ts` 通道 + `main/ipc/usageStatsIpc.ts` + `main/index.ts` 装配（agentDir 注入）+ `preload/index.ts`
8. `atoms/usageStatsAtoms.ts` + `hooks/useUsageStats.ts`
9. `UsageStatsTab.tsx` 及子组件 + i18n key（zh-CN/en-US）
10. `typecheck` + `node --test` + 手动 smoke（装 pi-tracker → 面板数据 → 卸载 → 引导态）

## 10. 演进路径

- **P1**：`agent_settled` 事件桥接自动刷新（装配层订阅 → service.notifyActivity）；`mergeAggregated` 增量聚合；小时活跃分布；价格兜底（复用 models.json/modelListCache 成本表重算 cost=0 记录）
- **P2**：导出（CSV/JSON）、图表交互增强；把 usage.jsonl 格式文档 PR 贡献回 pi-tracker 上游（把实现细节变稳定契约）；商店页 pi-tracker 入口 + 最低版本锁定
- **不做**：自建扩展/采集、SQLite、REST、实时 watcher 轮询

## 11. 风险与缓解

| 风险 | 缓解 |
|---|---|
| pi-tracker 格式漂移 | 防御式解析（字段数/类型/坏行）+ 上游文档 PR + 商店锁最低版本；P2 增 schema 探测 |
| 插件未运行时段数据缺失 | 面板展示覆盖时间窗 + 引导 `/analytics import` 回填（幂等） |
| 多 pi 进程并发 append | 日志 append-only 原子小写；读端按 `ts\|sid\|model` 去重兜底 |
| 日志失控增长 | 单文件 256MB 上限 + 游标增量（大日志下成本 O(新增)） |
| WSL/自定义 agentDir | agentDir 解析复用 PiLocator/WslPaths 既有 host 路径转换，不在新域另造 |
| 跨层契约漂移 | 通道三处同步 + 契约测试；类型只在 shared/types/usageStats.ts 定义一次 |
