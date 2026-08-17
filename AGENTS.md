# AGENTS.md

## 项目简介

PiDeck 是一个面向本地开发工作的 Electron 桌面应用，用于在多个项目目录之间管理和运行 pi RPC Agent。应用提供多项目工作区、会话时间线、历史会话恢复、文件抽屉、Git 面板、模型选择、工具调用展示、内置浏览器、中文提示词精选、技能/扩展商店以及打包发布能力，目标是让用户可以在桌面端更稳定地管理多个 pi 编码助手会话。

技术栈：Electron 38 + React 19 + TypeScript + Vite。

**核心边界（不可逾越）：**

- pi 负责 Agent 行为、工具调用、会话读写、模型调用 —— **pi 的事不要替它做**。
- PiDeck 负责窗口管理、进程生命周期、会话浏览/导入、Git 面板、终端、设置 —— **UI 框架的事 pi 也不要做**。
- 两者通过 stdio JSON-RPC 通信，禁止引入第二条通信通道（如直接 HTTP 到 pi 内部）。

## 代码结构与跨层契约

本项目只维护项目根目录这一份 `AGENTS.md`；除非用户明确要求，不要再在子目录生成同名规则文件。`docs/开发规范.md` 中仍有历史架构表述，若与本文件或实际类型/API 冲突，以本文件和代码为准。

- `src/shared/` 是跨进程纯契约层：共享类型按 `shared/types/*.ts` 拆分，`shared/types.ts` 仅做兼容导出；IPC 名称只定义在 `shared/ipc.ts`。
- `src/main/` 是唯一可访问 Node/Electron 主进程能力的业务层。`main/<domain>/` 拥有领域行为，`main/ipc/*Ipc.ts` 只做输入校验和适配，`main/index.ts` 只增装配，不新增业务。
- `src/preload/index.ts` 通过 `contextBridge` 暴露最小 `PiDesktopApi`；新增 IPC 必须同步共享通道、main handler、preload 方法三处，订阅 API 必须返回 unsubscribe。
- `src/renderer/` 只通过 `desktopApi`/preload 调用桌面能力。跨组件状态使用 Jotai atom，副作用放 hook，视图放 component；不得直接 import Node/Electron 或新增第二种全局状态方案。
- `SessionRecord.id` 是跨重启的稳定会话身份，`agentId` 仅表示当前 pi 子进程。所有 runtime 命令和事件都必须带 `sessionId + agentId + runtimeGeneration`，拒绝旧 runtime 的迟到结果。
- pi 只通过 stdio JSON-RPC 与 PiDeck 通信；PiDeck 不复刻 pi 的 Agent/工具/会话行为，也不为访问 pi 引入第二条通信通道。
- 持久化结构、设置和 session catalog 变更必须兼容旧数据；listener、timer、子进程、terminal 和 watcher 必须在同一模块找到配对清理路径。


```
src/
├── main/              # Electron 主进程
│   ├── pi/            # pi RPC 进程管理、消息解析
│   ├── sessions/      # 会话扫描、导入、摘要缓存、SessionRuntimeCoordinator
│   ├── git/           # GitService（status/diff/commit/cherry-pick 等）
│   ├── prompts/       # PromptManager（本地模板）+ XuePromptManager（SQLite 中文精选）
│   ├── skills/        # SkillManager
│   ├── extensions/    # ExtensionManager
│   ├── settings/      # SettingsStore + DesktopProxy
│   ├── terminal/      # 终端会话管理（node-pty）
│   ├── pet/           # 桌面宠物
│   ├── feishu/        # 飞书集成（FeishuBridge + FeishuConnection）
│   ├── ipc/           # ★ IPC 域注册（sessionIpc/systemIpc/gitIpc/storeIpc/...）
│   └── web/           # Web 服务管理
├── preload/           # preload 脚本，经 contextBridge 暴露受限 IPC API
├── renderer/
│   └── src/
│       ├── atoms/         # Jotai 状态（session-first）
│       ├── components/
│       │   ├── ui-shadcn/  # 共享 UI 原语（button/dialog/input/select 等）
│       │   ├── session/   # 会话视图族（SessionView/Composer*/Timeline*）
│       │   ├── sidebar/   # 左侧栏
│       │   ├── workspace/ # 右侧抽屉（files/git/browser/editor）
│       │   └── app/       # 业务组件
│       ├── hooks/         # 渲染层 hooks（useWorkspacePanels/useSessionComposerController 等）
│       ├── i18n/          # 文案（zh-CN / en-US，rendererCopy.*.ts）
│       └── styles/        # 按域拆分的样式 + 语义 token
└── shared/            # 主/渲染共享类型（按域拆分）与 IPC 通道定义
```

## 架构规则（硬性）

1. **session-first**：会话是一等公民。新功能优先挂在 session/runtime 链路上，不要退回“围绕 agent tab 堆全局 state”。
2. **状态管理用 Jotai**：新增跨组件状态放 `atoms/`，按域建 atom；禁止再引入第二种全局状态方案。
3. **IPC 按域注册**：主进程 handler 一律放 `src/main/ipc/*Ipc.ts`，`index.ts` 只做装配；通道名集中在 `shared/ipc.ts` 定义，禁止散落字符串字面量。
4. **类型共享走 `shared/types/`**：按域拆文件；主进程、preload、渲染进程不得各自重复定义同一结构。
5. **单向依赖**：`main`、`preload`、`renderer` 只能依赖 `shared` 契约；`renderer` 通过 preload 暴露的 API 访问主进程，不能直接 import Node/Electron；main 不得 import renderer 代码；`shared` 不得反向依赖任何运行时层。
6. **文件体量红线**：
   - 组件/模块单文件目标 ≤ 400 行，超过 600 行必须评估拆分。
   - `App.tsx`、`main/index.ts` 只增装配代码，不增业务逻辑；新业务先建新模块。
   - 为“省一次 import”把逻辑塞回大文件，视为架构倒退，评审应拒绝。

## 模块内聚与低耦合（硬性）

> 写代码的默认标准：**高内聚、低耦合、可单测、装配层不长胖**。功能能跑不等于结构合格。

1. **一个模块一件事**：状态机/策略/几何/解析放纯函数（`utils/` 或同域 helper），UI 只负责呈现与事件转发，hook 拥有该域状态与命令。禁止把「Tab / 预览 / 分屏 / 拖拽落点」这类完整域逻辑散落在 `App.tsx` 匿名回调里。
2. **装配层只装配**：`App.tsx` / `main/index.ts` 只做依赖注入与布局拼装。新增交互或状态流转时，优先抽 `hooks/useXxx`、组件宿主或 atoms；若改动让 `App.tsx` 再长出大段 `if/else` 业务，视为未完成拆分。
3. **按域抽 hook，而不是按屏幕堆 props**：跨多个子树的同一域（例如会话工作区 chrome、composer、timeline）应有明确 owner（如 `useSessionWorkspaceChrome`）。禁止用 30+ 字段的「共享 props 袋」在 App → Pane → Injector → View 之间层层透传；稳定回调与服务用窄接口 / context / 工厂，视图 props 只留身份与 chrome 开关。
4. **选中 ≠ 呈现**：`selectSession` / 打开会话记录只负责「当前会话是谁」；Tab 预览/常驻、分屏布局、拖拽 MIME 属于 chrome 域。不要把 `preview | permanent | keep` 之类 UI 模式长期渗进通用 selection API；chrome 应在边界组合「选中 + 登记」。
5. **多实例必须按 session 订阅**：分屏/多栏挂载时，runtime / messages / sendState 只订本栏 `sessionId` 的 atom family。禁止非聚焦栏订阅 `currentSession*` 全局原子，以免一栏流式更新拖垮另一栏重渲染。
6. **纯策略可单测**：落点边、预览替换、分屏关闭晋升等规则写成纯函数并配 `tests/*.test.mjs`；闭包回调里的产品策略（「第三个 Tab 替换聚焦栏」）应回到同一 chrome/reducer，禁止只活在 JSX lambda 中。
7. **异步与拖放用快照/稳定入口**：`drop` / `close` / 定时器不要闭包过期的 `tabs`/`previewId`；用 ref 快照、`useCallback` 稳定命令，或单一 `dispatch`。组件依赖数组禁止写整个 `props` 对象。
8. **同一 UI 能力一个挂载点**：如会话 Tab 栏、右侧抽屉开关，避免 solo/split 两套父级各挂一份导致「有的栏有、有的栏没有」。共享 chrome 放外层；栏内只保留本会话操作（停/重启等）。
9. **改前自检（合并前过一遍）**：
   - 这个改动是否让 `App.tsx` 更懂业务细节？若是，先抽出。
   - 新状态是否有单一 owner？还是 App + 侧栏 + Tab 栏各写一份？
   - 多会话场景下订阅是否按 `sessionId` 隔离？
   - 核心规则能否离开 React 单独测绿？

## 代码风格

- TypeScript strict；禁止新增 `any`（与第三方交互不得不用时，用 `unknown` + 收窄，并注释原因）。
- 禁止用 `as` 强转绕过类型错误；测试数据需要部分字段时用工厂函数构造完整对象。
- 命名：类型/类 PascalCase，函数/变量 camelCase，常量 UPPER_SNAKE；IPC 通道用 `domain:action` 格式。
- React：函数组件 + hooks；副作用必须有清理函数；派生状态用 `useMemo`，禁止把可计算值存进 state。
- 文案：所有用户可见文本走 `i18n`（`i18n/rendererCopy.zh-CN.ts` + `en-US.ts` 同步加 key），JSX 中禁止硬编码中英文。
- 日志/调试输出/内部标识符可硬编码，但日志用主进程 logging 模块，不散落 `console.log`（调试残留需删除）。

## 注释要求

- 对核心逻辑、复杂判断、业务规则、状态流转、权限校验、数据转换、异常处理添加必要注释。
- 注释解释“为什么这样做”“对应什么业务规则”“边界条件是什么”，不要逐行解释显而易见的代码。
- 新增函数、类、模块添加简短功能说明。
- 修改旧代码时，相关逻辑缺上下文说明的应顺手补注释。

## Agent 工作范围与停止条件（硬性）

> 当前任务的目标是完成用户明确要求的功能，不是顺手修复整个仓库、测试基础设施或本机开发环境。遇到无关问题时，**记录并停止扩张范围**。

1. **任务边界优先于“顺手修好”**：
   - 只修改与当前需求直接相关的产品代码、契约和必要的定向测试。
   - 发现无关 bug、flaky、历史技术债、平台兼容问题时，记录为 follow-up，不在当前任务中处理。
   - 不得因为“再修一个就全绿”“顺手补一下更完整”而扩大范围。

2. **停止条件**：
   - 当前需求已实现；
   - `npm run typecheck` 通过；
   - 与本次改动直接相关的定向验证通过；
   - 若需要运行应用确认行为，一次最小 smoke 通过。

   满足以上条件后即停止。不得自行增加第二轮“更完整验收”、真实 provider smoke、全仓库 QA 或跨平台复测。

3. **失败处理预算**：
   - 同一个验证失败最多进行 1 次根因分析 + 1 次针对性复跑。
   - 若确认属于环境、平台、依赖安装形态、既有 flaky 或无关模块，立即停止继续修复并向用户报告。
   - 不允许通过不断切换 Windows / WSL、并发 / 串行、mock / real provider 来追求偶然全绿。

4. **禁止无授权修复环境**：
   除非用户明确要求，或当前任务本身就是依赖/构建环境维护，否则禁止：
   - `npm install` / `npm ci` / `npm update` / `npm rebuild`；
   - 修改 `node_modules`；
   - 补装另一平台的 optional/native binary（Rollup、esbuild、node-pty 等）；
   - 修改 `package.json` / `package-lock.json` 以解决测试环境问题；
   - 修改 npm 全局配置、TEMP/TMP、系统 PATH 或 CI 配置；
   - 为让 WSL 测试通过而改变 Windows Electron 的依赖树，反之亦然。

5. **运行平台一致性**：
   - 不要假设同一份 `node_modules` 可以同时服务 Windows Node/Electron 与 WSL/Linux Node。
   - 当前依赖安装平台与验证平台不一致时，报告“环境不匹配”，不要自行补二进制或重装依赖。
   - 若用户需要双平台验证，应使用彼此独立的依赖目录/worktree，而不是混装同一 `node_modules`。

6. **测试不是修复授权**：
   - 测试失败只说明需要判断原因，不代表自动获得修改失败模块的权限。
   - 与当前改动无关的既有测试不得为了“全绿”而修改。
   - 只有本次功能有意改变了对应公开契约时，才允许同步修改该契约测试。

## 最小验证策略（硬性）

> 本项目不再把“全量测试全绿”作为 AI 日常开发任务的默认门禁。AI 的职责是用**最小、直接、可归因**的验证证明本次改动可用，而不是运行和维护整个仓库的测试矩阵。

### 默认验证顺序

每次功能/修复默认最多执行以下验证：

1. **类型检查**
   - 运行一次 `npm run typecheck`。
   - 只有在修改后确实修复了类型错误时才重新运行一次。

2. **定向测试**
   - 只运行与本次改动直接相关的测试文件或最小测试集合。
   - 新增测试时优先创建少量行为测试，禁止为了覆盖率大量铺测试。
   - 一个功能原则上不应为了“保险”扩展到多个无关测试域。

3. **最小 smoke（必要时）**
   - 涉及 Electron 启动、主进程、IPC、session/runtime 或关键 UI 流程时，可运行一次最小人工 smoke。
   - smoke 只验证本次新增路径是否能启动并完成核心动作，不建立庞大的自动化 E2E。
   - 若应用启动失败，先判断是否由本次代码直接造成；不要立即进入依赖/环境修复循环。

### 何时需要写测试

只在以下情况新增或修改定向测试：

- 修复明确 bug：保留一个能复现该 bug 的回归测试；
- 新增纯数据转换、解析、状态机或持久化规则：为核心规则写少量单测；
- 新增 IPC 边界：必要时验证输入校验和返回契约；
- 用户明确要求增加测试。

以下情况**默认不新增测试**：

- 纯 UI 布局/样式调整；
- 简单装配、透传或复用现有 session/runtime 能力；
- Pi 已经负责并已有成熟行为的能力（模型调用、compaction、tool lifecycle 等）；
- 为证明“普通 Pi session 仍然是普通 Pi session”而重复覆盖其所有已有能力。

### 默认禁止的验证

除非用户明确要求，或当前任务本身是 CI / 测试基础设施 / 发版验证，否则 AI **不得自行运行**：

- `npm test`（全量单测）；
- `npm run test:serial`（全量串行单测）；
- 全仓库 Playwright / Electron E2E；
- 跨平台全量测试矩阵；
- 真实付费模型 / 真实 provider 自动化 E2E；
- 为测试目的反复启动多个长期 Electron/Pi 子进程。

如果用户要求全量验证，则把它视为一个独立任务执行；失败时仍遵守“任务边界与停止条件”，不得顺手修复无关失败。

### 测试失败处理

1. 若失败明显由本次改动造成：修复当前功能并做一次针对性复跑。
2. 若失败属于既有 flaky、无关模块、平台差异、依赖安装、权限、网络或临时目录问题：
   - 记录失败命令和最小原因；
   - 不修改无关产品代码或测试；
   - 不修复开发环境；
   - 停止继续验证并向用户报告。
3. 忽略 `[Feishu] 状态查询: bridge 为 null，返回 disconnected` 的提示。
4. 禁止：
   - 为通过测试而放宽断言；
   - 注释掉失败测试；
   - 把测试改成恒真；
   - 修改无关测试夹具；
   - 为取得“0 failed”反复运行整套测试直到偶然全绿。

### 测试写法

- 测行为不测实现：从公开接口/IPC 边界断言结果，不断言内部私有函数调用次数。
- 外部网络、真实模型和真实账号默认不用作自动化测试依赖。
- 测试必须可独立运行，不依赖执行顺序。
- 能用纯函数/小替身完成的，不启动完整 Electron 或真实 pi。

## 安全约束

1. **IPC 最小权限**：preload 只暴露当前页面需要的 API；新增通道必须加进类型定义，禁止 `ipcRenderer` 透传。
2. **输入校验在边界**：所有 IPC handler 的第一行职责是校验入参（类型、路径合法性、枚举范围）；渲染层来的数据一律不可信。
3. **路径安全**：文件读写必须限制在项目目录或应用数据目录内；拼接路径前做规范化与逃逸检查，禁止直接拼用户输入。
4. **进程调用**：spawn/exec 的参数必须数组形式传递，禁止字符串插值拼 shell 命令；子进程环境变量经 `sanitizePiChildEnv` 类函数清洗。
5. **Webview/浏览器面板**：禁止加载 `file://` 以外的任意本地内容；`allowpopups`、node integration 等属性保持最小化，新增 webview 属性需评审。
6. **密钥与令牌**：Auth 配置只经 `config/` 模块读写；日志、错误上报、遥测中禁止输出 token/key。
7. **依赖引入**：新增依赖需说明理由；优先用已有依赖能力，禁止为一个小功能引重型库。

## Electron 开发规范与经验总结

> 本节沉淀本项目在 Electron 上的硬性规范与踩坑经验。改动 `main/index.ts`、窗口创建、preload、打包配置前必读。

### 启动与进程生命周期

1. **app.ready 前的配置窗口**：`commandLine.appendSwitch`、`app.setPath("userData")`、单实例判断等必须在 `app.whenReady()` 之前完成；错过时机一律无效，不要试图在 ready 后补救。
2. **启动失败要可诊断**：主进程关键节点（窗口创建、load 开始/结束、preload 路径、pi 启动）必须写 `appLogger`，黑屏/白屏排查只靠日志。
3. **首帧体验**：窗口保持隐藏时先 `maximize()` 再加载页面，避免 `ready-to-show` 后再最大化造成布局跳变；`zoomFactor` 等用户设置在 `did-finish-load` 后应用，防止被加载过程覆盖。
4. **单实例用自研按版本互斥，不用 `requestSingleInstanceLock`**：原生锁按 userData 全局互斥，会导致不同版本无法并行。本项目实现见 `acquireVersionSingleInstance`（同版本复用窗口、不同版本并存）；第二实例用 `app.exit(0)`（未 ready，比 `quit()` 快）。
5. **开发/正式数据目录隔离**：dev 模式 userData 追加 `-dev` 后缀，防止开发调试污染正式数据；追加前判断已有后缀，避免重复拼接。
6. **退出清理**：quit 路径必须覆盖 pi 子进程、node-pty、文件 watcher、单实例锁文件；新增常驻资源时在退出清单里同步登记。

### 窗口与 webContents

7. **主窗口 webPreferences 基线**：`contextIsolation: true`、`nodeIntegration: false`、`sandbox` 跟随用户设置、`webviewTag: true`（仅主窗口，浏览器面板需要）。新增窗口以此为起点逐项评估，禁止默认全开。
8. **Chromium 沙箱默认关闭是刻意的**：Windows 上部分安全软件/旧 GPU 驱动会在沙箱初始化时触发原生断点（0x80000003）。关闭时必须显式 `appendSwitch("no-sandbox")`；`electronChromiumSandbox` 开关改动需整应用重启生效，不要做成运行时热切换。
9. **`setWindowOpenHandler` 统一收口**：主窗口与 webview guest 都必须注册，走 `openExternalUrl` 并 `deny`；漏注册 = 用户点击链接开出无管控新窗口。
10. **自定义标题栏**：frame/titleBarStyle 相关改动要同时验证三平台窗口控制按钮、拖拽区、双击最大化；全屏式弹层内容不得被窗口控制区遮挡。

### Webview（内置浏览器面板）

11. **独立 partition + 收敛 webPreferences**：webview 用专属 `partition`，强制 `sandbox: true`、`nodeIntegration: false`、`webSecurity: true`、`allowRunningInsecureContent: false`、`webviewTag: false`，并删除外部传入的 `preload`/`preloadURL`/`allowpopups` 等危险参数（见 `configureBrowserPanelWebviewHost`）。
12. **session 校验**：`did-attach-webview` 时校验 guest.session 是否为预期 partition，不是立即 `close()` —— 防止页面注入意外 guest。
13. **导航白名单**：`will-frame-navigate` / `will-redirect` / `setWindowOpenHandler` 三层都要过 `isAllowedBrowserPanelUrl` 白名单；只拦一层会被重定向绕过。

### IPC 与 preload

14. **handle/invoke 成对注册**：新增通道三处同步——`shared/ipc.ts` 通道常量、主进程 `ipc/*Ipc.ts` handler、preload 白名单暴露；漏任何一处就是运行时 undefined。
15. **preload 不做业务**：preload 只做参数校验后的 `invoke` 转发与事件订阅封装，禁止在 preload 里写业务逻辑或缓存状态。
16. **事件推送要可退订**：`webContents.send` 类推送，preload 侧返回 unsubscribe 函数；渲染层组件卸载必须退订，防止向已销毁页面推送导致泄漏。

### 原生模块与打包

17. **node-pty 等原生模块**：必须 `asarUnpack` 并在 postinstall 修权限（`scripts/fix-pty-permissions.js`）；新增原生依赖时同步检查这两项，否则打包后运行时才炸。
18. **afterPack 清理要谨慎**：删除 node_modules 冗余文件（如 `@larksuiteoapi/node-sdk` 的 lib/）必须有对应测试（`tests/afterPackCleanup.test.mjs`）；清理脚本误删运行时必需文件 = 打包能过、用户启动崩。
19. **打包验证分层**：`npm run pack`（--dir 快速验证）→ `dist:win/mac/linux`；发版前至少跑过一次目标平台完整安装包的人工 smoke，不依赖 CI 构建成功即发布。
20. **资源路径**：运行时资源用 `process.resourcesPath` / `app.getAppPath()` 推导，禁止写相对 `__dirname` 的裸路径假设 asar 内可直接读；preload 路径统一走 `preloadPath.ts` 解析。

### 跨平台

21. **路径与命令**：禁止硬编码 `/` 或 `\`；shell 检测、外部编辑器、git 路径查找必须覆盖 win/mac/linux（含 WSL 场景，见 `wslExe.ts`）。
22. **平台 workaround 集中管理**：如 `linuxDisplayBackend.ts`，平台特判写在专属模块并注明触发条件，不散落在业务代码里。
23. **Windows 特有问题优先怀疑**：路径空格、杀毒软件锁文件、长路径、权限弹窗；Windows 上的"偶发失败"大多不是偶发，日志要带足上下文。

## 稳定性与可扩展性约束

1. **错误处理分层**：
   - 主进程：catch 后写日志 + 向渲染层返回结构化错误（不抛裸异常跨 IPC）。
   - 渲染层：用户可感知错误走 toast/内联友好文案（i18n），不只 console。
   - 异步函数禁止无 catch 的“裸 promise”。
2. **生命周期配对**：注册 listener / timer / 子进程 / watcher 的地方，必须能在同一模块找到对应清理路径（unmount、quit、session close）。
3. **资源边界**：大文件读取、会话扫描、diff 计算要有大小上限或流式处理；渲染进程不做全量日志/历史的主存。
4. **向后兼容**：设置项、会话文件、缓存格式变更必须有迁移或默认值兜底；删除旧字段前先保留一个版本的读取兼容。
5. **特性开关**：高风险或实验性功能（如 RPC 启动 flags、沙箱开关）必须可从设置关闭/回退，默认值取保守项。
6. **扩展点**：新增能力优先做成“注册式”（如 IPC 域注册、面板注册），避免在既有 switch/if 链上继续加分支。

## 验证命令

| 场景 | 默认命令 |
|------|----------|
| 类型检查 | `npm run typecheck` |
| 定向单测 | `node --test tests/<相关测试>.test.mjs`，或项目已有的等价最小命令 |
| Electron / IPC / session 关键链路 | 一次最小人工 `npm run dev` smoke（仅在确有必要时） |

**默认不要运行** `npm test`、`npm run test:serial` 或全量 Playwright/Electron E2E。

全量测试属于 CI / 发版 / 用户明确要求的专项验证，不是普通功能开发的完成条件。

如果当前 `node_modules` 与执行平台不匹配，停止并报告；不要为了运行测试自动安装、重建或混入另一平台原生依赖。


## UI 约定（简版）

> UI 细节规范（组件用法、图标、弹框尺寸、字体、token）后续会单独整理，本节只保留底线。

- 新增 UI 优先复用 `components/ui-shadcn/` 共享原语（button/dialog/input/select 等），不用原生 `<select>`、不裸写 `<input>`。
- 图标统一 `lucide-react`，不用 emoji 充当功能图标；品牌 Logo 用 `LogoMark`（`AppParts.tsx`），不用通用图标替代。
- 颜色/圆角/字号优先复用 `styles/` 里的语义 token，不写死色值；暗色模式必须自然适配。
- 布局保持桌面工作台结构（左列表 / 中会话 / 右抽屉 / 底终端），不引入营销页式大改版。
- **新样式一律走 Tailwind utility + shadcn 组合**：禁止新增手写 CSS class（token 定义与 keyframes 除外）；动态状态色通过保留锚点类（如 `tone-*`/`status-*`）+ 状态规则实现，不写新的状态 class。

### CSS 双轨与迁移规则（硬性）

渲染层同时存在两套样式，**禁止 big-bang 全量重写**，也**禁止再开第二套视觉语言**。

| 轨 | 是什么 | 落点 |
|---|---|---|
| 旧（legacy） | 手写语义 class | `styles/{foundation,timeline,surfaces,integrations,workspace}.css` |
| 新（UI 2.0） | Tailwind v4 + shadcn | `styles/tailwind.css`、`components/ui-shadcn/` |

**迁移口诀：视觉上「新学旧」；代码上「改到哪，旧迁新到哪」。**

1. **Token / 长相以旧为准**：颜色、圆角、字号、间距继续用 `foundation` 语义变量；新栈通过 `@theme` 桥接同一套 token，不要另起 zinc/indigo 平行色板。
2. **新改动只写 Tailwind + shadcn**：禁止新增手写 CSS class（token、keyframes、既有 `tone-*`/`status-*` 锚点除外）。
3. **按触达面增量收口**：改某块 UI 时，把该块上抢同属性的旧规则删掉或收窄，再依赖 utility；不要开「删光旧 CSS」专项。
4. **Cascade 层序不可改错**（入口 `styles.css`，契约测试 `tests/cssCascadeLayers.test.mjs`）：

   `theme < base(preflight) < components < vendor < legacy < utilities`

   - `legacy` **必须高于** `base`：否则 preflight 冲掉整站手写外观（表现为「CSS 全没了」）。
   - `legacy` **必须低于** `utilities`：否则组件上改 Tailwind 不生效。
   - `vendor`（`streamdown` / `file-icons`）**低于** `legacy`：应用内观感覆盖才能压过第三方默认皮。
   - 旧 5 个域文件只在入口用 `layer(legacy)` 引入；vendor 只在入口用 `layer(vendor)`；**禁止**在文件内部再包 `@layer`（避免嵌套层）。
5. **`!important` 会反转层优先级**：旧规则里的 `!important` 仍可能压住 utility；碰到时删掉 `!important` 或收窄旧规则，不要给 utility 堆 `!`。
6. **半吊子 utility 比没写更糟**：组件上写了 `min-h-11`/`rounded-xl`/Button 默认 `h-9`，分层后会真生效并冲掉旧观感。改 UI 时 utility 必须「新学旧」对齐原视觉，再删掉同属性的冗余 legacy 声明。
7. **排障**：utility「看不见」时用 DevTools 看胜出规则来自哪一层——unlayered / `!important` / 同属性旧选择器；先处理冲突源，再改 class。

### beUI 组件迁移（硬性）

> 项目从 beui.dev 迁移动效组件（`components/motion/`、`components/agents/` 等）。
> 共享模块（`lib/ease.ts` / `lib/utils.ts` / `agents/agent-disclosure.tsx`）已与 beui.dev registry **逐字节一致**（2026-08 统一），CLI 安装时内容相同会自动 skip，无需任何恢复操作。

1. **安装走 CLI，不手动复制源码**：`npx shadcn add @beui/<name>` 即可（`components.json` 已配置 `"registries": {"@beui": "https://beui.dev/r/{name}.json"}`）；文件已存在时加 `--overwrite`。手动复制源码是下策（易漏依赖、注释标记不一致）。
2. **共享文件保持官方原版，禁止存项目私有曲线值**：`lib/ease.ts` / `lib/utils.ts` / `agents/agent-disclosure.tsx` 一律接受 CLI 覆盖（内容一致会 skip；官方更新则同步跟随）。历史上项目曾把 `EASE_OUT`/`SPRING_LAYOUT` 改为私有基线值，导致每次安装都被 CLI 连坐覆盖、需手动恢复——已废弃，不要复辟。
3. **共享运动常量统一从 `@/lib/ease` 取**，禁止在组件里另写曲线值；新组件缺常量时按官方 registry 值补进 `lib/ease.ts`，不要改既有导出值。
4. 迁移惯例：文件放 `src/renderer/src/components/<域>/`，头部保留官方 `// beui.dev/components/<path>` 注释，用户可见文案走 i18n。

## Issue 修复流程

1. 从最新 `main` 建短修复分支：`fix/issue-<number>-<short-description>`。
2. 先定位根因，记录影响范围；涉及启动、环境检测、会话恢复等核心流程时，同步检查相邻路径同类问题。
3. 修复聚焦单一问题，`fix:` 前缀提交，关联 issue。
4. PR 描述包含：问题原因、修复摘要、验证命令、`Closes #<number>`。
5. 建议 Squash and merge；合并后按用户影响决定是否发 patch。

## 发版要求

1. 核对 `README.md` / `README.en.md` 功能与安装说明仍准确。
2. `CHANGELOG.md` / `CHANGELOG.zh-CN.md` 加版本号与日期，条目记录用户可感知变化，中英文一致。
3. GitHub Release notes 写明主要变化，不接受只写版本号。
4. `package.json` 与 `package-lock.json` 版本号一致；发版提交用 `chore: release vX.Y.Z`。
5. docs-site 官网同步更新。
6. 发布说明同步走 `scripts/sync-release-notes.js`，不手改 README 亮点区块 / docs-site：
   - 先更新 `CHANGELOG.md` / `CHANGELOG.zh-CN.md`（中英一致），条目用 `- **标题** — 描述` 格式；
   - `node scripts/sync-release-notes.js` 预览 → `--apply` 应用，自动同步 README.md / README.en.md /
     docs-site/changelog.md 三处亮点（README 取 🚀 前 12 + ✨/🐛 前 4，docs-site 取 🚀 前 15 + ✨ 前 4）；
   - 脚本不更新 README 顶部版本徽章（shields.io badge），需手动改为当前版本；
   - `--apply` 后检查 `git diff`：脚本只清理重复的 v0.6.6 条目，历史条目不允许丢失（2026-08 曾因
     无条件删除逻辑误删唯一一份 v0.6.6 条目，已修复）。
7. 架构级变更（如 session-first 切换）先发 pre-release 观察，再标正式版。

## 提交 commit 规则

> **不要自以为是地提交代码。只有用户明确要求时，AI 助手才可以执行 `git add`、`git commit` 或 `git push`。**

1. 工作过程中不自动 commit；完成一步后也不提交。
2. 只有用户明确说「提交吧」「commit」「push」等意图时才执行。
3. 整个功能/修复完成后简要总结，并询问「需要我提交吗？」。
4. 用户同意提交时，一个功能/修复的全部变更放在一个 commit，不拆多个小 commit（用户另有要求除外）。

### GitHub 协作说明

详见 `docs/PiDeck-协作说明.md`。

## 长期重构纪律

- 大重构必须先写对照计划（参考 `docs/issue-113-main-parity-plan.md`），明确能力 parity 表与合并门禁。
- 禁止无对照表的长期分叉分支；main 的用户可感知改动当周回填到进行中重构分支。
- 重构期间禁止用 `-X theirs`/`-X ours` 静默吞掉对方改动；每个冲突都要确认能力归属。
