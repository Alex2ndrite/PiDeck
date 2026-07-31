# PiDeck 设备交接文档（2026-08）

> 换设备开发前先读这份。覆盖：分支/远端、已完成改动清单、官方化目标、E2E 基建、门禁、剩余任务。

---

## 0. 一句话现状

**分支 `refactor/issue-113-structure` 是当前主战场**，已在远端备份，HEAD = `268c055`。
工作台 UI 已全面切到 **shadcn new-york / zinc 纯官方视觉**；#113 合并门禁的自动化部分基本完成，剩 5 个真实环境手动项。

---

## 1. 克隆与恢复（新设备必做）

```bash
# 远端有两个 remote，代码在 new-origin
git clone git@github.com:ayuayue/PiDeck.git pi-desktop
cd pi-desktop

# 切到主开发分支
git fetch new-origin
git checkout -b refactor/issue-113-structure new-origin/refactor/issue-113-structure

# 安装依赖（原生模块 node-pty 需要 postinstall 修权限）
npm install

# 验证环境
npm run typecheck   # 必须 0 error
npm test            # 单测全绿（基线 752 pass）
```

- 原机 worktree 路径：`D:\project\github\pi-desktop-worktrees\issue-113-structure`（新设备无需还原 worktree，直接 clone 即可）。
- 远端地址：`git@github.com:ayuayue/PiDeck.git`（remote 名为 `new-origin`）。
- 开发用 `npm run dev`；打包验证 `npm run pack`（--dir 快速）→ `dist:win/mac/linux`。

---

## 2. 已完成改动清单（按 commit 从新到旧）

### UI 2.0 官方化（#115，分支头部 15 个 commit）

| Commit | 内容 |
|---|---|
| `268c055` | P2-8 工具/诊断卡片官方卡片面（border+bg-card+rounded-md） |
| `12b2a63` | P2-7 ConfigModal 侧栏导航 → shadcn ghost/secondary Button；清死类 config-tabs/toast |
| `14e95f7` | P3b 清理 `.config-btn*` 家族（ConfigModal 迁移后仅注释引用） |
| `dde89c0` | P3 死 CSS 第一轮：全库交叉扫描删无主规则（-155 行） |
| `0f70aab` | P2-6 终端 Dock header 官方化（保留终端主题变量） |
| `22ac71f` | P2-5 Files 抽屉头 + 消息时间线 chrome（用户气泡柔和化） |
| `9845307` | P2-4 Drawer rail + Git 面板 chrome |
| `b2e4177` | P2-3 Composer 壳/底栏/发送钮官方化 |
| `8ad0509` | P2-2 项目树/会话行（treeRowClass 共享行底） |
| `2ac4112` | P2-1 侧栏 chrome + SessionHeader |
| `a789a15` | **P0 纯官方 zinc 色板**（primary=正文色，accent=悬停面，去品牌绿 primary） |

### #113 会话链路 + E2E（自动化主体）

| Commit | 内容 |
|---|---|
| `fd9cf32` | compact nothing-to-do 产品修复（RPC success:false 现在抛错）+ 3.2-7/9/10/3.3-12 自动化 |
| `2410270` | **Streamdown 转默认开启**（保留回退开关）+ markdown 元素 polish + logo polish |
| `542e494` | Git 面板 E2E（真实临时仓库，3.4-14） |
| `3d607ad` | picker-palette → shadcn Dialog + cmdk Command |
| `5314920` | 通知 → sonner 全局 toast（删 NoticeCenter/app-notice） |
| `5d32459` | 最后一批 legacy 弹窗 → shadcn Dialog |
| `e11ab93`~`187dd33` | mock pi E2E 体系：agent-flow / layout / visual-tour / compact / fork / restart |

### 关键产品契约（E2E 逼出来的，改代码前先读）

1. **「启动 Agent」只建会话 DRAFT**，pi 进程在首次发送才 spawn。
2. **模型列表来自 `pi --list-models` CLI 表格**（`src/main/pi/modelListCache.ts`），不是 RPC。
3. **replaceAgentSession 要求 get_state 带 sessionFile**，否则抛 "Replacement runtime has no session path"。
4. **桌面端在启动时把配置的 thinking level 推给 pi**（set_thinking_level）。
5. **compact success:false 必须抛错**（已修，渲染层靠 debugDetails 映射友好文案）。
6. **fork 预填直接写 Session draft atom**（防 currentSessionId 空窗丢草稿）。
7. 文件路径链接是核心能力：Streamdown 的 harden 插件会把 `file:` 写死进 blockedProtocols → 已排除。

---

## 3. UI 官方化目标（#115 对齐）

**原则**：用成熟库替换自研 workaround；业务逻辑不重写；Jotai/Vite 保留；文案全走 i18n。

已完成：
- ✅ P0 官方 zinc/new-york 色板（light/dark）
- ✅ P1 控件语义（primary/accent/ring 中性化）
- ✅ P2-1~P2-8 全工作台壳（侧栏/顶栏/树/composer/drawer/git/files/时间线/终端/ConfigModal/卡片）
- ✅ P3 死 CSS 两轮（-218+ 行）
- ✅ Streamdown 默认渲染 + sonner toast + shadcn picker

**遗留债务**（有意保留，勿误删）：
- `components/ui/*` 包装层（Button/Modal/IconButton/SelectField/TextField）内部已是 shadcn，纯删文件改 import 收益低 → 待最终退役
- `.modal-backdrop` 残留：FileDiffViewer.tsx、App.tsx Suspense fallback ×2、BrowserSurface.tsx
- dark 共享块里混入的死类选择器项（如 `config-btn`）——删选择器项会破坏共享块，保留
- `~2 万行旧 CSS` 仍有大量按面归属的规则，可继续按「类名→TSX 引用」扫描清理（方法见 P3 commit 说明）

---

## 4. E2E 基建（mock pi，无需真实 pi / 网络）

| 文件 | 作用 |
|---|---|
| `e2e/mock-pi.cjs` | 最小 stdio JSONL RPC 子集：get_state/get_messages/get_entries/prompt 流式/abort/compact/fork/模型/thinking；会话双写（tmp + 项目 `.pi/sessions`） |
| `e2e/mock-pi-fixture.ts` | 隔离 userData + settings.json 种子（customPiPath→shim）+ seedProjects 选项 |
| `e2e/agent-flow.spec.ts` | prompt→流式→done→abort、排队、模型/thinking、compact、fork、restart、nothing-to-do、排队丢弃 |
| `e2e/history-restore.spec.ts` | 双次 launch 历史恢复（3.2-9） |
| `e2e/git-panel.spec.ts` | 真实临时 git 仓库 status/diff/stage/commit（3.4-14） |
| `e2e/layout*.spec.ts` | 侧栏/抽屉/终端 dock 开合 |
| `e2e/visual-*.spec.ts` | 视觉巡检截图（test-results/visual/） |

**运行**：`npx playwright test`（**注意：会弹窗打断人，用户明确要求日常不跑，只在需要时手动跑**）。

**环境细节**：
- 未打包运行时 userData 追加 `-dev` 后缀 → settings 种子写 `profile-dev/`
- mock 必须应答 `--version`，否则进安装向导
- E2E 调起用 `PIDECK_E2E_KEEP=1` 保留 userData 便于查日志
- Playwright `connectOverCDP` 连 dev electron 在本机不稳定，E2E 一律用打包产物（`out/main/index.js`）

---

## 5. 门禁（AGENTS.md 硬性）

| 命令 | 要求 |
|---|---|
| `npm run typecheck` | 0 error |
| `npm test` | 全绿（基线 752 pass） |
| `npx playwright test` | 按需跑（会弹窗） |
| `npm run build:fast` | 构建通过 |

**注意**：工具里 `&&`/管道组合命令易挂，跑长命令用单条命令 + 重定向到文件再 tail。
Windows 禁止 `>null` 重定向（会生成删不掉的 null 文件）。

---

## 6. 剩余任务

### #113 合并门禁（用户手动项，需真实环境）
- 3.1-1 冷启动窗口大小
- 3.1-3 沙箱开关重启
- 3.1-4 pi RPC flags 生效
- 3.4-15 飞书收发
- 3.4-16 扩展安装/技能开关

### #113 合并流程（自动化/文档已备好）
1. 从 `main` 回填当周新改动（backfill 规则：先分支内补，cherry-pick 或按能力手写移植，禁止整棵 merge）
2. 开 PR → main，Squash and merge，`refactor: session-first architecture (#113)`
3. 合并后发 pre-release（`v0.7.0-beta.1`）观察 2–3 天
4. 无阻断 → 正式 `v0.7.0`；main → dev 同步；关 #113
5. **CHANGELOG 草稿 + README 核对**（阶段 4 硬性门禁，还没写）

### #115 遗留债务（低优先级）
- legacy `components/ui/` 最终退役
- 继续深挖死 CSS（可按 P3 方法）
- 消息气泡内 markdown 排版微调（可选）

---

## 7. 协作与提交规范（AGENTS.md 摘要）

- **不要自以为是地提交**：只有用户明确说「提交吧/commit/push」才执行 git add/commit/push
- 一个功能/修复一个 commit，`fix:`/`feat:`/`refactor:`/`test:`/`docs:`/`style:` 前缀，`Refs #113` / `Refs #115` footer
- 文案必须 i18n（zh-CN + en-US 同步）；JSX 禁止硬编码中英文
- 禁止新增 `any`；禁止 `as` 强转绕过类型错误（第三方边界用 `unknown` + 收窄）
- IPC 通道集中在 `shared/ipc.ts`；类型共享走 `shared/types/`；renderer 不得直接碰 Node API
- 单文件 ≤400 行（超 600 必须拆）；新业务建新模块，不塞 App.tsx/main/index.ts
- 高风险特性走设置开关 + 默认关 + 回滚路径

---

## 8. 快速定位速查

| 想找 | 位置 |
|---|---|
| 官方化计划 | `docs/ui-2.0-revamp-plan.md`（U0-U6 批次表） |
| #113 parity + 手测清单 | `docs/issue-113-main-parity-plan.md` |
| 架构规则/提交规范 | `AGENTS.md`（仓库根） |
| shadcn 组件 | `src/renderer/src/components/ui-shadcn/` |
| legacy 包装层 | `src/renderer/src/components/ui/` |
| 官方主题 token | `src/renderer/src/styles/tailwind.css` + `foundation.css` |
| mock pi | `e2e/mock-pi.cjs` + `mock-pi-fixture.ts` |
