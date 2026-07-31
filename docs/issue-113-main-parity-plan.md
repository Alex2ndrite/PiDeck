# Issue #113 重构分支追平 main 能力计划

> 目标：让 `refactor/issue-113-structure` 成为 **可发布的 main 超集**（session-first 架构 + main 全部用户可感知能力），再一次性合并发布，避免“合并完再改一堆再测一堆”。
>
> 适用分支：`refactor/issue-113-structure`
> 基线：`origin/main`（功能事实源）、`integrate/dev-sync-wip`（结构事实源，已合入）

---

## 0. 背景与硬约束

| 事实 | 含义 |
|------|------|
| 文件已拆分（session-first + IPC 域拆分） | main 的改动 **不能靠整棵 merge 自动带入**，只能按能力人工移植 |
| 曾用 `-X theirs` 合并 | 冲突处偏向 integrate 骨架，main 的 UI polish 默认丢失，需回填 |
| main 仍会前进 | 每周同步一次 main 的“用户可感知变化”，小步回填，禁止攒到发布前 |
| 用户体验优先 | 判断标准 = 用户能不能感知到差异，不是代码行数是否一致 |

**三条铁律：**

1. **先在重构分支补齐，再合并发布** —— 顺序不可颠倒。
2. **能力回填，不做文件搬运** —— 把 main 行为落到新架构对应模块，不复制大文件。
3. **每次回填必过门禁** —— `npm run typecheck` + 相关单测 + 对应手测项，全绿才算完成。

---

## 1. 能力 parity 总表（发布阻断项）

> 状态图例：✅ 已对齐 / 🟡 部分对齐 / ⬜ 未做 / ❓ 待确认
> 每项验收 = typecheck 绿 + 单测（如适用）+ 手测通过。

### 1.1 会话核心（P0，发布阻断）

| 能力 | main 行为 | 新架构落点 | 状态 |
|------|-----------|------------|------|
| 新建/切换/关闭会话 | 侧栏 + 会话头操作 | `components/sidebar/*` + `SessionView` | ✅ |
| 发送消息 / 流式渲染 | composer → RPC → timeline | `useSessionComposerController` + `SessionMessageTimeline` | ✅ |
| 停止 / 重启 Agent | 会话头按钮 | `SessionHeader` 链路 | ✅ |
| 会话 fork | 用户消息气泡 fork 入口 | `UserBubble` → `forkRuntimeSession` IPC | ✅ |
| compact 手动压缩 | >30% 显示，70/90 色阶 | `ComposerComponents` compact chip | ✅ |
| compact 友好错误 | nothing-to-do 等文案 | `useSessionComposerController` + i18n | ✅ |
| 历史会话恢复 | 扫描 + 摘要缓存 | `main/sessions/*` | ❓ 手测待做 |
| 消息编辑/删除/重发 | timeline 操作 | `SessionMessageTimeline` | ❓ |
| 队列（queued prompts） | 排队/撤回/丢弃 | queue hook | ❓ |
| @目录引用 | composer 输入 | composer | ❓ |

### 1.2 设置（P0）

| 能力 | 落点 | 状态 |
|------|------|------|
| 单实例运行 | `SettingsModal` + `SettingsStore` + `index.ts` | ✅ |
| 启动窗口大小 | `SettingsModal` + `main/index.ts` bootstrap | ✅ |
| Chromium 沙箱开关 | `SettingsModal` + 主进程 | ✅ |
| pi RPC 启动诊断（offline/no-extensions/no-skills） | `SettingsModal` + `PiProcess` flags | ✅ |
| 关闭到托盘 / 通知 | `SettingsModal` | ✅ |
| 更新检查 / 禁用更新 | `SettingsModal` | ✅ |
| 自定义 pi 路径 | `SettingsModal` | ✅ |
| 模型 / Auth / Skills / Prompts / Extensions 各 tab | `config/*` | ❓ 逐项手测 |

### 1.3 侧栏与布局（P1，体验对齐）

| 能力 | main 行为 | 新架构落点 | 状态 |
|------|-----------|------------|------|
| 左侧栏折叠/展开 | 标题栏 PanelLeft，折叠宽 68px | `AppShell` + `AppHeader` | ✅ |
| 右侧抽屉开关 | 标题栏 PanelRight | `SessionHeader` → `toggleRightDrawer` | ✅ |
| 右侧抽屉面板（files/git/browser/editor） | 切换 + 折叠 + 钉住 | `components/workspace/*` | 🟡 手测 |
| 底部终端 Dock | 高度拖拽、shell 选择（含 git-bash/wsl） | `TerminalDock` | ❓ |
| 抽屉宽度拖拽 | 拖拽手柄 | `AppShell` | ❓ |

### 1.4 提供商与模型（P0）

| 能力 | 落点 | 状态 |
|------|------|------|
| MiniMax endpoints | `config/providerHeaders.ts` | ✅ |
| 模型列表缓存 | `main/config/modelListCache.ts` | ✅ |
| 模型选择 / thinking 级别 | composer pickers | ❓ 手测 |

### 1.5 集成（P1）

| 能力 | 落点 | 状态 |
|------|------|------|
| 宠物 #107 状态卡死修复 | `pet/PetStateBridge.ts` | ✅ 勿回退 |
| 飞书连接/发消息 | `feishu/FeishuBridge` + `FeishuConnection` | 🟡 旧面板已删，主路径需 smoke |
| 扩展管理（安装/卸载/内置移除） | `extensions/ExtensionManager` | ❓ |
| 技能/提示词商店 | `skills/` + `prompts/` | ❓ |
| Git 面板（status/diff/commit/分支） | `git/GitService` + GitPanel | ❓ |
| 内置浏览器 | `web/` + BrowserSurface | ❓ |

---

## 2. 执行步骤（从现在到发布）

### 阶段 0：基线冻结（本周）✅ 已完成（2026-07-30）

- [x] 2.1 版本号对齐：分支改为 `0.7.0-beta.0`（明确这是架构切换版本，区别于 main 0.6.7）
- [x] 2.2 把本文档的 parity 表复制到 issue #113 评论，逐项勾选
- [x] 2.3 跑全量现有单测：`npm test`，记录当前通过率作为基线 → **基线 715/740，修复后 746/748**
- [x] 2.4 跑 `npm run typecheck`，必须 0 error → ✅

> 补充：基线 23 个失败测试全部修复（多数为 `-X theirs` 丢失的 main 能力，已回填）；
> 首次 main 周同步完成（efa45d9 session_info 格式、666a6f1 Wayland 门控），
> 并顺藤摸出「启动窗口模式」回归一并回填。

### 阶段 1：P0 能力手测与补缺（1–2 周）

按 1.1 / 1.2 / 1.4 逐项手测，发现差异即修：

- 每项修复 = 独立小提交，信息带 `Refs #113`
- 修复落点必须在新架构对应模块，**禁止为省事往 `App.tsx` 堆**
- 对修复的行为补单测（见第 4 节测试标准）

### 阶段 2：main 周同步机制（持续到合并）

每周固定一次（建议周一）：

```bash
git fetch origin
git log --oneline HEAD..origin/main --since="7 days ago"
```

- 过滤出 **用户可感知** 的 commit（fix/feat，排除 docs/chore）
- 逐个判断：cherry-pick 可行就 cherry-pick；冲突大就按能力手写移植到新模块
- 移植后在 parity 表更新状态
- **禁止** `git merge origin/main` 整棵合入（会再次冲击拆分结构）

### 阶段 3：P1 体验对齐（1 周）

- 侧栏/抽屉/终端逐项对 main 手测，只补行为差异，不追求像素一致
- 飞书 smoke：连接 → 绑定 → 收发消息
- 扩展/技能/商店 smoke

### 阶段 4：发布前验收（合并阻断门禁）

全部满足才可开合并 PR：

- [ ] parity 表 P0 全 ✅，P1 无 ❓
- [ ] `npm run typecheck` 0 error
- [ ] `npm test` 全绿
- [ ] 手测清单（第 3 节）全过
- [ ] CHANGELOG 草稿写好（架构切换 + 能力对齐说明）
- [ ] README 功能描述核对

### 阶段 5：合并与发布

1. 开 PR `refactor/issue-113-structure` → `main`，描述写清：架构切换、能力对照、验证命令
2. 合并方式：**Squash and merge**，提交信息 `refactor: session-first architecture (#113)`
3. 合并后立即发 **pre-release**（如 `v0.7.0-beta.1`），观察 2–3 天
4. 无阻断问题 → 正式 release `v0.7.0`
5. `main → dev` 同步一次，让基于 dev 的开放 PR 拿到新结构
6. 关闭 issue #113，`integrate/dev-sync-wip` 归档不再使用

---

## 3. 手测清单（每次发布候选必跑）

### 3.1 启动与生命周期

1. 冷启动 → 窗口按设置的启动大小打开　👤 手动
2. 单实例开启时二次启动 → 聚焦已有窗口（含托盘唤起）　✅ **已验证**（2026-07-31 脚本复测：同 userData 双开，第二实例 1s 内 exit(0)，第一实例正常；托盘唤起手动）
3. 修改沙箱开关 → 重启后应用启动正常　👤 手动
4. 修改 pi RPC 启动 flags → 重启 Agent 后生效　👤 手动

### 3.2 会话路径

5. 新建会话 → 发送消息 → 流式渲染 → 停止　🤖 **已自动化**（`e2e/agent-flow.spec.ts` + `e2e/mock-pi.cjs`，真实 spawn+RPC）
6. 重启 Agent → 会话可继续　🤖 **已自动化**（`e2e/agent-flow.spec.ts` 重启用例；发现「Agent 已重启」toast 前发送会被 coordinator 拒发）
7. compact：上下文 >30% 出现 chip，点击压缩成功；nothing-to-do 场景出友好文案　🤖 **压缩主路径已自动化**（`e2e/agent-flow.spec.ts`：chip 出现→点击→占比下降 chip 消失→可续聊；nothing-to-do 仍手动）
8. fork：从某条用户消息 fork 出新会话　🤖 **已自动化**（同 spec：get_fork_messages→fork RPC→toast+原文预填）
9. 关闭再打开应用 → 历史会话恢复
10. 排队消息：发送中再发 → 排队 → 可撤回　🤖 **排队+顺序回答已自动化**（同上 spec 第二用例；「可撤回」仍手动）

### 3.3 布局

11. 左侧栏折叠/展开；右侧抽屉开关、切换 files/git/browser、钉住　🤖 **已自动化**（`e2e/layout.spec.ts`）
12. 终端 Dock 开合、拖拽高度、切换 shell　🤖 **开合/shell 菜单已自动化**（`e2e/layout-terminal.spec.ts`，mock pi；拖拽高度仍手动）

### 3.4 集成 smoke

13. 模型选择 + thinking 级别切换　🤖 **已自动化**（`e2e/agent-flow.spec.ts` 第三用例：set_model/set_thinking_level 真实 RPC 闭环）
14. Git 面板看 status/diff，做一次 commit　🤖 **已自动化**（`e2e/git-panel.spec.ts`：真实临时 git 仓库 + projects.json 种子；状态刷新 → 行内 diff → 全部暂存 → 提交 → git log 仓库侧复核）
15. 飞书连接 + 收发一条消息
16. 安装/卸载一个扩展；开关一个技能

---

## 4. 合并后防回退机制

- `main` 之后的所有新功能 PR：CI 必须过 typecheck + 单测（见 AGENTS.md 门禁）
- main 有新修复 → 当周判断是否需要同步到发布分支，不再存在第二条长期重构分支
- 下次大重构：先写 parity 计划文档再动手，**禁止再出现无对照表的长期分叉**
