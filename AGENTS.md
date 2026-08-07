# AGENTS.md

## 项目简介

PiDeck 是一个面向本地开发工作的 Electron 桌面应用，用于在多个项目目录之间管理和运行 pi RPC Agent。应用提供多项目工作区、会话时间线、历史会话恢复、文件抽屉、Git 面板、模型选择、工具调用展示、内置浏览器、中文提示词精选、技能/扩展商店以及打包发布能力，目标是让用户可以在桌面端更稳定地管理多个 pi 编码助手会话。

技术栈：Electron 38 + React 19 + TypeScript + Vite。

**核心边界（不可逾越）：**

- pi 负责 Agent 行为、工具调用、会话读写、模型调用 —— **pi 的事不要替它做**。
- PiDeck 负责窗口管理、进程生命周期、会话浏览/导入、Git 面板、终端、设置 —— **UI 框架的事 pi 也不要做**。
- 两者通过 stdio JSON-RPC 通信，禁止引入第二条通信通道（如直接 HTTP 到 pi 内部）。

## 目录结构

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
│       │   ├── ui/        # 共享 UI 组件（Button/IconButton/SelectField/TextField/Modal）
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
5. **单向依赖**：`renderer → shared → main`；main 不得 import renderer 代码，renderer 不得直接碰 Node API（一律走 preload）。
6. **文件体量红线**：
   - 组件/模块单文件目标 ≤ 400 行，超过 600 行必须评估拆分。
   - `App.tsx`、`main/index.ts` 只增装配代码，不增业务逻辑；新业务先建新模块。
   - 为“省一次 import”把逻辑塞回大文件，视为架构倒退，评审应拒绝。

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

## 测试标准（硬性门禁）

测试位于 `tests/*.test.mjs`，运行 `npm test`（node --test）。

1. **必过门禁**：任何合并前 `npm run typecheck` 与 `npm test` 必须全绿；不许“先合再修”。
2. **何时必须写测试**：
   - 修复 bug：先写复现测试（红），再修到绿。回归测试永久保留。
   - 新增主进程业务逻辑（sessions/git/settings/extensions/prompts 等）：必须有单测。
   - 新增数据转换/解析/状态机逻辑：必须有单测。
   - 纯 UI 布局调整可不强求，但涉及交互状态流转的 hook 应有测试。
3. **测试写法**：
   - 测行为不测实现：从公开接口/IPC 边界断言结果，不断言内部私有函数调用次数。
   - 不依赖执行顺序、不依赖真实网络/真实 pi 进程；外部依赖用 mock/替身。
   - 一个测试只验证一件事，命名即意图（如 `agentCreateTimeout.test.mjs`）。
4. **禁止**：为通过测试而放宽断言、注释掉失败测试、把测试改成恒真。

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

| 场景 | 命令 |
|------|------|
| 类型检查（每次改动后） | `npm run typecheck` |
| 全量单测 | `npm test` |
| 单测串行（排查并发干扰） | `npm run test:serial` |

改动影响主进程/IPC/会话链路时，两个命令都必须跑；纯 UI 样式微调至少跑 typecheck。

## UI 约定（简版）

> UI 细节规范（组件用法、图标、弹框尺寸、字体、token）后续会单独整理，本节只保留底线。

- 新增 UI 优先复用 `components/ui/` 共享组件（Button/IconButton/SelectField/TextField/Modal），不用原生 `<select>`、不裸写 `<input>`。
- 图标统一 `lucide-react`，不用 emoji 充当功能图标；品牌 Logo 用 `LogoMark`（`AppParts.tsx`），不用通用图标替代。
- 颜色/圆角/字号优先复用 `styles/` 里的语义 token，不写死色值；暗色模式必须自然适配。
- 布局保持桌面工作台结构（左列表 / 中会话 / 右抽屉 / 底终端），不引入营销页式大改版。
- **新样式一律走 Tailwind utility + shadcn 组合**：禁止新增手写 CSS class（token 定义与 keyframes 除外）；动态状态色通过保留锚点类（如 `tone-*`/`status-*`）+ 状态规则实现，不写新的状态 class。

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
6. 架构级变更（如 session-first 切换）先发 pre-release 观察，再标正式版。

## 提交 commit 规则

> **不要自以为是地提交代码。只有用户明确要求时，AI 助手才可以执行 `git add`、`git commit` 或 `git push`。**

1. 工作过程中不自动 commit；完成一步后也不提交。
2. 只有用户明确说「提交吧」「commit」「push」等意图时才执行。
3. 整个功能/修复完成后简要总结，并询问「需要我提交吗？」。
4. 用户同意提交时，一个功能/修复的全部变更放在一个 commit，不拆多个小 commit（用户另有要求除外）。

## 长期重构纪律

- 大重构必须先写对照计划（参考 `docs/issue-113-main-parity-plan.md`），明确能力 parity 表与合并门禁。
- 禁止无对照表的长期分叉分支；main 的用户可感知改动当周回填到进行中重构分支。
- 重构期间禁止用 `-X theirs`/`-X ours` 静默吞掉对方改动；每个冲突都要确认能力归属。
