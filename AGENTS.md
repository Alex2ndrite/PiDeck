# AGENTS.md

## 项目简介

PiDeck：Electron 38 + React 19 + TypeScript + Vite + Tailwind v4 + shadcn/ui + Jotai 的桌面工作台，用于管理多个 pi RPC Agent 会话（多项目工作区、会话时间线、文件/Git 面板、内置浏览器、终端、飞书、宠物、打包发布）。

**核心边界（不可逾越）：**

- pi 负责 Agent 行为、工具调用、会话读写、模型调用 —— **pi 的事不要替它做**。
- PiDeck 负责窗口/进程生命周期、会话浏览导入、Git、终端、设置 —— **UI 框架的事 pi 也不要做**。
- 两者通过 stdio JSON-RPC 通信，禁止引入第二条通信通道。

## 目录结构（要点）

```
src/main/        # Electron 主进程
  pi/ sessions/ projects/ git/ fs/ prompts/ skills/ extensions/ settings/
  terminal/ editors/ browser/（浏览器安全白名单） pet/ feishu/ telemetry/
  logging/（AppLogger） config/（ConfigManager） wsl/ web/ ipc/（★IPC 域注册）
  index.ts（仅装配）
src/preload/     # contextBridge 受限 IPC
src/renderer/src/
  atoms/（Jotai，session-first） components/（ui-shadcn/ session/ sidebar/ workspace/ terminal/ app/）
  hooks/ i18n/（rendererCopy.zh-CN/en-US） styles/（语义 token） web/（WebChatApp）
src/shared/      # 共享类型（types/ 按域拆分）+ IPC 通道定义（ipc.ts）
```

## 架构规则（硬性）

1. **session-first**：会话是一等公民，新功能优先挂 session/runtime 链路，不要退回"围绕 agent tab 堆全局 state"。
2. **状态管理用 Jotai**：跨组件状态放 `atoms/` 按域建 atom；禁止引入第二种全局状态方案。
3. **IPC 按域注册**：handler 放 `src/main/ipc/*Ipc.ts`；通道名集中在 `src/shared/ipc.ts`，禁止散落字符串。
4. **类型共享走 `src/shared/types/`**：主进程、preload、renderer 不得各自重复定义同一结构。
5. **单向依赖**：`renderer → shared → main`；main 不得 import renderer；renderer 不得直接碰 Node API（一律走 preload）。
6. **文件体量红线**：单文件目标 ≤ 400 行，超 600 行必须评估拆分；`App.tsx`、`main/index.ts` 只增装配，不增业务逻辑。

## 代码风格

- TypeScript strict；禁止新增 `any`（万不得已用 `unknown` + 收窄并注释原因）；禁止 `as` 绕过类型错误。
- 命名：类型 PascalCase / 函数变量 camelCase / 常量 UPPER_SNAKE；IPC 通道 `domain:action`。
- React：函数组件 + hooks；副作用必须有清理函数；派生状态用 `useMemo`，不存 state。
- 用户可见文案必须走 i18n（zh-CN/en-US 同步加 key）；JSX 禁止硬编码中英文。
- 日志用 `logging/AppLogger.ts`，不散落 `console.log`。

## 注释要求

对核心逻辑、业务规则、状态流转、权限校验、异常处理、边界条件加注释，解释"为什么"，不逐行解释显而易见的代码；新函数/类/模块加简短功能说明；改旧代码时顺手补缺的上下文注释。

## 测试标准（硬性门禁）

单测：`tests/*.test.mjs`（`npm test`，node --test）；e2e：`e2e/*.spec.ts`（Playwright）。

1. **合并前 `npm run typecheck` + `npm test` 必须全绿**，不许"先合再修"。
2. 修 bug 先写复现测试（红）再修到绿，回归测试永久保留；新增主进程业务逻辑 / 数据转换 / 状态机必须有单测。
3. 测行为不测实现：从公开接口/IPC 边界断言，不依赖执行顺序、真实网络或真实 pi 进程。
4. 禁止：放宽断言、注释掉失败测试、恒真测试。

## 安全约束

1. preload 只暴露页面需要的 API，禁止 `ipcRenderer` 透传。
2. IPC handler 第一行校验入参；渲染层数据一律不可信。
3. 文件读写限制在项目/应用数据目录内；路径先规范化再拼接，禁止直接拼用户输入。
4. spawn/exec 参数必须数组形式，禁止字符串拼 shell；子进程环境变量经 `sanitizePiChildEnv` 类函数清洗。
5. 内置浏览器：禁止加载 `file://` 以外的本地内容；白名单/partition 单一事实源在 `src/main/browser/browserSecurity.ts`。
6. Auth 配置只经 `config/ConfigManager.ts` 读写；日志/遥测禁止输出 token/key。
7. 新增依赖需说明理由，禁止为小功能引重型库。

## Electron 经验（改动窗口/主进程/打包前必读）

**启动**：`appendSwitch`/`setPath`/单实例判断必须在 `whenReady()` 前完成；关键节点写 appLogger（黑屏排查只靠日志）；窗口隐藏时先 `maximize()` 再加载，`zoomFactor` 在 `did-finish-load` 后应用。
**单实例**：用 `singleInstance.ts` 的 `acquireVersionSingleInstance`（按版本互斥，不同版本可并行），不用 `requestSingleInstanceLock`；第二实例 `app.exit(0)`。
**窗口**：主窗口基线 `contextIsolation:true` + `nodeIntegration:false` + `sandbox:false`（沙箱默认关是刻意的，Win 上安全软件/旧驱动会触发原生断点 0x80000003）+ `webviewTag:true`（仅主窗口）；`electronChromiumSandbox` 开关重启生效。
**内置浏览器（webview）**：专属 partition + `sandbox:true` + 删外部 preload/allowpopups（`configureBrowserPanelWebviewHost`）；`did-attach-webview` 校验 session 否则 `close()`；`will-frame-navigate`/`will-redirect`/`setWindowOpenHandler` 三层过 `isAllowedBrowserPanelUrl` 白名单。
**窗口链接**：主窗口与 guest 都要注册 `setWindowOpenHandler` → `openExternalUrl` + `deny`。
**IPC**：新通道三处同步——`shared/ipc.ts` 常量、`ipc/*Ipc.ts` handler、preload 暴露；preload 不做业务；`webContents.send` 推送必须可退订。
**打包**：node-pty 等原生模块必须 `asarUnpack` + postinstall 修权限；afterPack 清理要有对应测试；发版前跑目标平台完整安装包 smoke；资源路径用 `process.resourcesPath`/`app.getAppPath()`，preload 路径走 `preloadPath.ts`。
**跨平台**：禁止硬编码路径分隔符，覆盖 win/mac/linux（含 WSL，见 `wsl/wslExe.ts`）；平台特判集中在专属模块（如 `linuxDisplayBackend.ts`）；Windows 偶发失败优先怀疑路径空格/杀软锁文件/长路径。

## 稳定性与可扩展性

1. 错误处理分层：主进程 catch → 日志 + 结构化错误返回；渲染层走 toast/i18n 文案；异步函数禁止无 catch 裸 promise。
2. 生命周期配对：listener/timer/子进程/watcher 必须能在同一模块找到清理路径（unmount/quit/close）。
3. 资源边界：大文件读取/扫描/diff 要有大小上限或流式处理。
4. 向后兼容：设置项、会话文件、缓存格式变更必须有迁移或默认值兜底。
5. 特性开关：高风险/实验性功能必须可从设置关闭，默认取保守项。
6. 扩展点：新增能力优先"注册式"（IPC 域、面板注册），不在 switch/if 链上加分支。

## UI 约定（底线 + 唯一真源）

**组件（优先成熟组件库，不造轮子）**：

- **AI Elements**（elements.ai-sdk.com.cn）：AI 聊天/工作流场景组件（思维链、工具卡、消息、计划、队列、微光、文件树、代码块、终端、stack-trace 等），copy-paste 使用。新增会话时间线/工具调用/聊天交互类 UI 先查这里。
- **beUI**（beui.dev）：Motion + Tailwind 动画组件（102 个），copy-paste 使用。需要交互动效/加载态时先查这里。
- **shadcn/ui**（已收录在 `components/ui-shadcn/`）：基础控件（button/dialog/select/switch/tooltip/dropdown-menu/command/tabs 等）。
- 以上都没有时才允许自建；自建组件也要用 Tailwind utility + 语义 token，禁止写手写 CSS。
- 原生 `<button>` 仅保留 shadcn 无法替代的场景(并且后续会考虑重新用shadcn替换)：内容排版容器（树行/整卡，无按钮语义）、折叠触发器（Collapsible 或原生+utility）、微型按钮 <24px（Button 最小档 icon-xs=24px 无法替代）、标题栏窗口控制、代码复制角标（28px ghost icon-sm）。保留处文件头部有注释。
- 原生 input/textarea/checkbox 已全部换 shadcn Input/Textarea/Checkbox；仅剩 range（无 slider 组件）与 datetime-local 合理保留。

**样式**：

- 一律 Tailwind utility + shadcn 组合，禁止新增手写 CSS class（token 定义与 keyframes 除外）；颜色/圆角/字号用语义 token（`styles/foundation.css` + `tailwind.css` `@theme` 映射），暗色自然适配。
- **Tailwind v4 键名规则**：应用域 token 的 utility 名 = 前缀 + 完整后缀：`--color-bg-panel` → `bg-bg-panel`（不是 `bg-panel`）；`--color-text-primary` → `text-text-primary`（`text-primary` 是 shadcn accent 语义，注意撞名）。
- **任意值颜色必须有类型提示**：`text-[var(--color-accent)]` 会被 tailwind-merge 推断为字号导致文字消失，必须写 `text-[color:var(--color-accent)]`；同理 `bg-[color:color-mix(...)]`。
- 内容排版（markdown-body 的 p/code/table）用 CSS 是正确架构（react-markdown 库元素无法 utility 化，与 shadcn prose 同理），不迁移。
- 删 CSS 类前核对 e2e 锚点类（`tests` 与 `e2e/*.spec.ts` 的类选择器是隐式锚点）；迁移 group 组合状态时 group 类必须与状态类同元素。

**动效（motion token）**：

- 三档时长：120ms 微反馈 / 200ms 常规 / 320ms 面板级；统一缓动（ease-out-quint 进场、ease-in 离场），进 Tailwind `@theme`；全站禁止裸写 `transition: all`。
- 布局动画只动 transform/opacity（合成器线程）；width/height 动画是掉帧主因，评审红线。
- 列表 stagger 限流：只对前 8–12 个元素 stagger；加载态（会话激活、项目展开）用骨架屏。

**字号 token（唯一真源，`styles/foundation.css`）**：

| Token | 默认 | Tailwind 类 | 用途 |
|---|---|---|---|
| `--font-size-micro` | 11px | `text-micro` | 徽标、时间戳、状态点 |
| `--font-size-caption` | 12px | `text-caption` | 次要标签、Tab 栏、工具按钮 |
| `--font-size-control` | 13px | `text-control` | 紧凑控件、菜单项 |
| `--font-size-body` | 14px | `text-body` | 正文/UI 默认 |
| `--font-size-chat` | 15px | `text-chat` | 会话消息正文 |
| `--font-size-input` | 14px | `text-input` | composer 输入框 |
| `--font-size-title` | 16px | `text-title` | 区块标题 |
| `--font-size-brand` | 18px | `text-brand` | 品牌字标 |
| `--font-size-heading` | 20px | `text-heading` | 弹窗/页面大标题 |

禁止裸字号类（`text-sm`/`text-xs`/`text-[13px]`），一律语义类（`text-sm→text-body`、`text-xs→text-caption`、`text-[13px]→text-control`、`text-base→text-title`）。字号缩放由 `data-ui-font-size`/`data-chat-font-size`/`data-input-font-size`（compact/default/medium/large）整体控制，组件内禁止硬编码像素。

**字重/字体族**：页面标题 `font-semibold`、区块/行内强调 `font-medium`、正文 `font-normal`、数值/代码 `font-mono`；禁止 `font-bold` 做正文强调。字体族：界面 `--font-family-base`、等宽 `--font-family-mono`（Commit Mono）、品牌 `--font-family-brand`（仅 Logo）。

**其他**：图标统一 `lucide-react`；品牌 Logo 用 `LogoMark`（`AppParts.tsx`）；保持桌面工作台布局（左列表/中会话/右抽屉/底终端）。

## 性能基线
- 渲染进程私有内存目标 ≤ 800MB（基线曾 1.6GB）；切会话 P95 ≤ 150ms；首屏 ≤ 300ms。
- 大文件读取、会话扫描、diff 计算要有大小上限或流式处理；激活会话按轮次分页下发，不做全量 IPC 传输。

## 验证命令

| 场景 | 命令 |
|------|------|
| 类型检查 | `npm run typecheck` |
| 全量单测 | `npm test` |
| 单测串行（排查并发干扰） | `npm run test:serial` |
| e2e（Playwright） | `npm run test:e2e` |
| 全量门禁 | `npm run verify` |

改主进程/IPC/会话链路 → typecheck + 单测必跑；UI 改动至少 typecheck；主链路交互补 e2e。

## 发版要求

1. README / CHANGELOG（中英文）核对更新；Release notes 写明主要变化。
2. `package.json` 与 lock 版本号一致，提交用 `chore: release vX.Y.Z`。
3. docs-site 官网同步更新；架构级变更先发 pre-release 观察。

## 提交 commit 规则

> **只有用户明确要求时才执行 `git add`/`git commit`/`git push`。** 工作过程不自动提交；完成后总结并询问是否提交；一个功能/修复的全部变更放一个 commit。

## 重构纪律

- 大重构必须先写对照计划（能力 parity 表 + 合并门禁），再动工。
- 禁止无对照表的长期分叉分支；main 的用户可感知改动当周回填。
- 重构期间禁止 `-X theirs`/`-X ours` 静默吞掉对方改动。
