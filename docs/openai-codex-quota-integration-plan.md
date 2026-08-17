# OpenAI Codex 配额集成计划

> 负责人：Sol（规划、评审、验收） / Luna（细节实现）
> 日期：2026-08-17
> 前置提交：`e86fdde2 feat: add Codex-style usage dashboard`
> 状态：已实现并完成 Sol 验收

## 1. 目标

在现有「用量统计」基础上增加与 pi 实际调用账号一致的 ChatGPT/Codex 配额数据，并在聊天
Composer 选择 `openai-codex` provider 时提供轻量悬浮概览：

1. 「用量统计」页顶部新增 ChatGPT 配额区块，展示五小时窗口和周窗口的剩余百分比、进度、
   重置时间及账户是否已触达限制。
2. Composer 当前选择 `openai-codex` 模型时，在模型/思考 chip 的思考档位（如 `max`）右侧
   显示 `Gauge` 小图标；鼠标悬停或键盘聚焦后显示同一份紧凑配额概览。
3. 账号身份必须来自 pi 当前使用配置目录内 `auth.json` 的 `openai-codex` OAuth 条目，禁止
   改用 Codex Desktop/CLI 的独立登录态。
4. PiDeck 只读取有效 access token 查询配额，不接管 refresh token 的消费、轮换或配置写回。

本计划是 `docs/codex-usage-dashboard-parity-plan.md` 的第二阶段；此前“只展示本地统计、不访问
账户配额”的范围声明仅适用于第一阶段，本阶段由用户明确授权新增只读配额查询。

## 2. 不可跨越的边界

### 2.1 认证所有权

- 凭据源为 `ConfigManager.getAuthConfig()` 当前解析出的配置目录；WSL 开关切换后自然跟随
  `ConfigManager.configureWsl()`，不得另行硬编码 `~/.pi/agent/auth.json`。
- 只接受 provider key 为 `openai-codex`、结构有效的 OAuth 条目。
- 请求只使用 `access` 与 `accountId`：
  - `Authorization: Bearer <access>`
  - `ChatGPT-Account-ID: <accountId>`
- `refresh` 不发送、不经 IPC、不写日志，PiDeck 也不调用 OAuth 刷新端点。
- `expires` 仅作过期判断；兼容 Unix 秒与毫秒格式，不解析或依赖 JWT payload。
- access、refresh、accountId、响应原文和服务端错误正文均不得进入渲染层、日志、toast 或缓存文件。

### 2.2 进程与网络

- HTTP 请求只能在 Electron 主进程执行；渲染层只调用 preload 白名单 API。
- 使用 Electron `net.fetch`，继承 PiDeck 的桌面代理配置；请求超时 10 秒，响应正文上限 64 KiB。
- 固定只读 GET：`https://chatgpt.com/backend-api/wham/usage`，无 query/body。
- 该地址不是公开稳定 API：任何 401/403、网络失败或结构漂移都必须安全降级，不能影响会话发送、
  pi runtime 或现有本地用量统计。
- 配额服务采用 60 秒内存 TTL 与 single-flight；悬浮、设置页并发加载只发出一次真实请求。

### 2.3 Token 过期策略

1. 每次真正发起远端请求前重新读取当前 auth 配置。
2. `expires` 已过期时不使用 refresh token，返回“凭据已过期/等待 pi 更新”。
3. 请求收到 401 时再读取一次 auth；只有 access 或 accountId 已被 pi 更新时才重试一次。
4. 凭据未变化时禁止循环重试。
5. 若已有成功快照，临时失败返回 stale 快照和失败原因；UI 保留旧值并明确标记“可能已过期”，
   绝不把失败显示为 0%。

## 3. 数据契约与归一化

### 3.1 上游结构

仅从未知 JSON 中收窄所需字段：

- `plan_type`
- `rate_limit.allowed`
- `rate_limit.limit_reached`
- `rate_limit.primary_window`
- `rate_limit.secondary_window`
- 窗口内的 `used_percent`、`limit_window_seconds`、`reset_after_seconds`、`reset_at`

`credits`、`additional_rate_limits` 等未用于本期 UI 的字段不透传。

### 3.2 窗口识别规则

禁止假设 `primary_window` 永远是五小时、`secondary_window` 永远是周用量。把两个非空窗口放入
同一候选集合，严格按 `limit_window_seconds` 分类：

| 秒数 | 归一化字段 | UI 文案 |
| ---: | --- | --- |
| `18000` | `fiveHour` | 五小时用量 / 5-hour usage |
| `604800` | `weekly` | 周用量 / Weekly usage |
| 其他 | 忽略并记录不含敏感数据的 schema 警告 | 本期不展示 |

兼容场景必须覆盖：

- primary=18000、secondary=604800；
- primary/secondary 位置互换；
- secondary 为 `null`；
- 取消五小时限制后 primary=604800、secondary=`null`；
- 仅有五小时窗口；
- 百分比小于 0、大于 100、缺字段或类型错误。

`used_percent` 钳制到 `0..100`；`reset_at` 从 Unix 秒转成共享 DTO 的 Unix 毫秒。
`allowed` / `limit_reached` 是是否受限的权威状态，不能仅凭显示为 100% 推断封禁。

### 3.3 共享 DTO

在 `src/shared/types/usageStats.ts` 增加窄 DTO，不暴露认证身份：

- `OpenAiCodexQuotaWindow`：`usedPercent`、`limitWindowSeconds`、`resetsAt`。
- `OpenAiCodexQuotaSnapshot`：`planType`、`allowed`、`limitReached`、`fiveHour`、`weekly`、
  `fetchedAt`。
- `OpenAiCodexQuotaResult`：
  - `ready`：新鲜 snapshot；
  - `stale`：上一次 snapshot + 安全错误 reason；
  - `unavailable`：无 snapshot + 安全错误 reason。
- reason 使用有限枚举：`not-configured`、`expired`、`unauthorized`、`forbidden`、`network`、
  `invalid-response`、`disabled`。

## 4. 主进程设计

### 4.1 新增领域模块

新增 `src/main/usageStats/OpenAiCodexQuotaService.ts`，职责单一：

- 从注入的 `ConfigManager` 读取并严格校验 `openai-codex` OAuth 条目；
- 通过注入 transport 发起 GET，便于 Node 单测完全替换网络；
- 解析、归一化窗口；
- 管理 TTL、single-flight、stale fallback 和一次性 401 重读；
- 日志只包含状态码、窗口秒数和安全 reason，不包含 URL query（本接口无 query）、Header、token、
  accountId 或响应正文。

解析/分类尽量落在同域纯函数 `openAiCodexQuota.ts`，让窗口规则无需 Electron 即可测试。

### 4.2 装配

- `main/index.ts` 只在 `ConfigManager` 创建后装配 service，并注入 `net.fetch` transport 与
  `appLogger`；不把业务判断写入 `index.ts`。
- 新 service 始终通过同一个 `ConfigManager` 读取配置，因此现有 WSL 同步无需第二份路径状态。
- 应用退出无需新增常驻 timer；服务只有按需 Promise 和内存快照。

### 4.3 IPC

在现有 usage-stats 域增加一个可扩展调用：

- shared channel：`usageStatsGetCodexQuota: "usage-stats:get-codex-quota"`
- preload：`usageStats.getCodexQuota(options?: { force?: boolean })`
- main handler 第一职责是验证 options 为对象且 `force` 为可选 boolean。
- `force=true` 绕过 TTL，但仍复用 single-flight；设置页刷新按钮使用 force，悬浮概览使用缓存路径。
- `previewApi` 同步补齐安全的 unavailable stub。

## 5. 渲染层设计

### 5.1 状态 owner

配额是账户级、跨设置页与 Composer 共享的状态。新增 usage-stats 域 Jotai atoms 与窄 hook，作为
唯一 renderer owner：

- snapshot/result atom；
- loading atom；
- `useOpenAiCodexQuota()` 提供按需 `load()` 与强制 `refresh()`；副作用与组件卸载保护放 hook。

主进程 TTL/single-flight 仍是网络去重的最终防线；renderer atom 负责两个挂载点显示一致。

### 5.2 共用展示组件

新增 `OpenAiCodexQuotaOverview.tsx`，复用同一组窗口行：

- `page` 变体：作为「用量统计」页独立卡片，位于本地当前用量之前；即使 pi-tracker 未安装、
  无本地记录或本地统计失败，远端配额仍独立加载和展示。
- `compact` 变体：用于 Composer tooltip，宽度约 18rem，视觉参考图二，但只展示真实返回字段；
  不计算或伪造“预计多久到限额”和趋势增幅。
- 每个窗口包含图标、名称、按 `100 - usedPercent` 换算的剩余百分比、细进度条和精确到分钟的
  本地绝对重置时间。
- secondary 为 null 且候选中没有相应秒数时，省略缺失窗口，不渲染 0% 占位。
- 两个已知窗口都不存在时显示兼容空态，而非误判为无限额度。
- stale、未配置、过期、未授权、网络失败分别使用 i18n 友好文案；无 token/accountId 泄漏。

### 5.3 用量统计页

- `UsageStatsTab` 在挂载时并行加载本地统计与配额，彼此失败不互相覆盖 phase。
- 现有刷新按钮同时刷新本地统计和远端配额；任一失败保留另一份成功数据。
- 更新页面说明，明确区分“ChatGPT 账户配额”和“pi-tracker 本地 Token 活动”。
- 保留原有安装插件、热力图、趋势、日期明细、模型/项目排行能力。

### 5.4 Composer 入口

- 在 `ComposerBottomBar` 已归一化的当前/待生效模型中计算“用户当前选中的 provider”：有
  pending target 时取 target，否则取 current。
- 仅当 provider 严格等于 `openai-codex` 时，在 `ModelThinkingChip` 后、其他右侧状态控件前显示
  `Gauge` 图标；切换到其他 provider 立即消失。
- 使用现有 shadcn Tooltip 原语承载只读富内容：hover 与键盘 focus 均可打开；首次打开按需加载，
  不在所有会话挂载时主动请求。
- 图标使用 lucide-react，不硬编码文案，不改变 ModelThinkingChip 点击选择模型/思考的行为。
- 多栏会话仅订阅账户级 quota atom，不订阅其他栏的 runtime/messages。

## 6. i18n 与样式

- `rendererCopy.zh-CN.ts`、`rendererCopy.en-US.ts` 同步增加：配额区标题、五小时/周用量、剩余百分比、
  重置时间、套餐、加载/stale/未配置/过期/认证失败/网络失败/结构不兼容、Composer 图标 aria-label。
- 重置时间由纯格式函数根据 `resetsAt` 与当前界面语言生成本地绝对时间，精确到分钟。
- 新 UI 全部使用 Tailwind utility、现有语义 token、shadcn `Progress`/`Tooltip`；不新增手写 CSS class，
  不改 cascade 层序，不引入依赖。
- 浅色、暗色、窄 Composer 和中英文长文案均不得遮挡发送按钮或模型选择器。

## 7. 自动化测试

### 7.1 纯解析与服务测试

新增专项测试，至少覆盖：

1. 用户提供的 JSON 范本正确映射五小时和周窗口；
2. primary/secondary 互换仍按秒数分类；
3. secondary=`null`，以及 primary 直接为周窗口；
4. 百分比钳制、reset 秒转毫秒、坏结构拒绝；
5. 有效 OAuth 条目只发送 access/accountId，refresh 不进入请求；
6. 缺配置、过期、401/403、网络失败、超时和超限响应体安全降级；
7. 401 后仅凭据变化时重试一次；
8. TTL、force、single-flight 与 stale snapshot 行为；
9. logger 记录不包含 access、refresh、accountId 或响应正文。

### 7.2 跨层/UI 契约测试

- shared IPC、main handler、preload、previewApi 四处通道对齐；
- handler 对 options 做边界校验；
- 中英文 quota key 完全对齐；
- 用量页无论本地 phase 如何都装配 quota 区块；
- Composer 只为 `openai-codex` provider 装配图标，provider 判定包含 pending target；
- quota 展示复用同一窗口组件，secondary null 不生成伪造行；
- 用户可见文案无 JSX 硬编码，样式无新增 legacy class。

### 7.3 最终门禁

```bash
npm run typecheck
npm test
git diff --check
```

如全量测试出现环境既有失败，必须隔离复跑相关测试并明确记录；不得放宽断言或把分段通过伪装成
全量通过。Sol 最终独立审查 diff，重点检查认证泄漏、刷新所有权、WSL 配置跟随、窗口映射和
Composer 多会话订阅。

## 8. 完成定义

- [x] 用量统计页同时呈现账户配额与本地 Token 统计，两个数据源独立失败、独立降级。
- [x] openai-codex 模型旁的仪表盘图标位置、hover/focus 概览与参考图意图一致。
- [x] 仪表盘图标点击时定向打开设置中的「用量统计」，普通设置入口仍恢复上次 tab。
- [x] 上游 `usedPercent` 仅作原始契约，页面与概览统一显示剩余额度和绝对重置时间。
- [x] 18000/604800 分类不依赖 primary/secondary 位置，secondary null 全路径安全。
- [x] 查询账号与 pi `auth.json.openai-codex.accountId` 一致，不读取 Codex 独立登录态。
- [x] PiDeck 不消费 refresh token、不写回 auth.json、不泄漏认证信息。
- [x] WSL/host 配置切换、TTL、并发、401 重读和 stale fallback 有自动化覆盖。
- [x] i18n、TypeScript strict、专项测试、完整测试执行、构建与 diff check 均完成验收。

## 9. Sol 验收记录

验收日期：2026-08-17。

- `npm run typecheck`：通过。
- 配额解析、服务、IPC 与既有仪表盘专项测试：28/28 通过。
- `npm test`（WSL Node）：完整执行 2159 项，2157 项通过；2 项失败均为既有的 Windows/WSL
  运行环境差异，分别是 Windows PATH 分隔符断言和 WSL 缺少 Rollup Linux 可选二进制。
- 将上述两个失败文件改用项目实际 Windows Node 隔离复跑：15/15 通过，确认不属于本功能回归。
- `npm run build:fast`（Windows Node）：main、preload、renderer 全部构建通过。
- `git diff --check -- . ":(exclude)package-lock.json"`：通过；工作区原有 `package-lock.json`
  修改未纳入本功能，也未被改写。

Sol 另行审查了账号级缓存隔离、WSL 配置跟随、过期时间秒/毫秒兼容、401 单次重读、响应体
64 KiB 上限、10 秒超时、日志脱敏、stale fallback，以及 Composer 严格 provider 判定。

## 10. 验收后展示调整

根据实际运行验收反馈，统一将进度语义从“已使用”改为“剩余”，例如上游 `used_percent=22`
显示为“剩余 78%”；重置时间由“约 7 天”改为当前系统时区下精确到分钟的绝对时间。Composer
仪表盘继续支持 hover/focus 概览，点击则关闭概览并打开设置的「用量统计」tab。

本轮验证：

- 新增回归与配额/设置相关专项测试：34/34 通过。
- `npm run typecheck`：通过。
- `sessionScannerSubagents.test.mjs` 隔离复跑：10/10 通过。
- `sessionFileEditor.test.mjs` 在 WSL 隔离复跑：37/37 通过；Windows 并发运行偶发受到临时目录
  文件锁影响。
- Windows `npm run build:fast`：main、preload、renderer 全部通过。
- Windows 与 WSL 全量并发测试均在后期停留于 `sessionScannerSubagents.test.mjs` 子进程；该文件
  隔离运行通过，因此记录为既有并发收尾问题，不将未完成的全量运行标记为通过。
