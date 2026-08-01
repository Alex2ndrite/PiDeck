# UI 统一性收口：状态与迁移计划

> 对应 issue #115 的 UI 2.0 收尾工作。本文记录已完成收口、保留项分类、死 CSS 清理与
> P2 迁移模式，作为后续 UI 工作的对照基准。

## 1. 现状总览（2026-08）

| 维度 | 起点 | 现状 | 说明 |
|---|---|---|---|
| 原生 `<button>` | 221 | **78** | 剩余全部有意保留（分类见 §2），换装均保留原 CSS class + tailwind 反制，视觉零回归 |
| 原生 `<select>` | 0 | 0 | 早已全部使用 shadcn Select（git 筛选、文件排序等自绘菜单） |
| 原生 input/textarea | 41 | 40 | 9 个 checkbox（shadcn 无对应组件）+ 31 个定制样式输入（`.setting-field input`、`.env-*`、`.git-scm-input` 等），1 个已换 shadcn Input（GitPanel 分支新建） |
| 自定义 CSS | 16,813 行 | ~16,570 行 | 死类清理 -114 行，browser 域迁移示范 -30 行 |

配套组件层：`ui-shadcn/` 15 个组件（button/dialog/select/switch/tooltip/dropdown-menu/command/
collapsible/resizable/scroll-area/alert-dialog/sonner/input/textarea/confirm-dialog），
`tailwind.css` 完成语义 token → shadcn 变量映射。

## 2. 保留的原生按钮（78 个）分类

保留理由统一为：**样式完全由自定义 CSS 驱动，直接换 shadcn Button 会被 Tailwind utilities
覆盖默认尺寸导致视觉回归；正确路径是先做 CSS→utility 迁移（§5）再换装**。各文件头部有注释。

| 分类 | 位置 | 数量 | 迁移路径 |
|---|---|---|---|
| 行容器/树行按钮 | SessionTree、ProjectTree、WorktreeTree、GitGraph、GitResourceTree、SurfaceComponents（整卡） | ~25 | 这些是「内容排版容器」，**不建议**换成 Button（无按钮语义）；CSS 可逐步 utility 化 |
| 折叠触发器 | SurfaceComponents（execution-summary）、TimelineEventCards（compaction/thinking）、ToolCallComponents、ComposerComponents、GitPanelControls、GitResourceTree | ~12 | 可换 shadcn Collapsible 或保留原生 + utility |
| 微型按钮（14-22px） | BrowserPanel tab-close、FileDiffViewer tab-close、MarkdownComponents math-copy、ComposerComponents extension-close、ScratchPadPanel del | ~10 | Button 最小档 icon-xs=24px，**无法替代**；保持原生 |
| 菜单项/选项 | SurfaceComponents（copy-menu）、TerminalDock 已换、SidebarComponents 已换、Command 面板、ExternalEditorOverlay、FeishuLinkIndicator | ~10 | 应迁移到 shadcn DropdownMenu/Command（P1 弹窗体系收口时） |
| 品牌视觉按钮 | TimelineEventCards（ask submit/cancel，30px 圆角 14px + 硬编码 #68b382） | ~5 | 需先抽成语义 token 再换装 |
| 特殊区域 | AppHeader window-control（标题栏）、PiLogoCanvas、SessionView scroll-to-bottom、SessionMessageTimeline load-more | ~5 | 标题栏/画布为专属交互，保持原生 |
| tab 导航 | ProjectResourcesModal 3、SettingsModal 1 | 4 | 待引入 shadcn Tabs 后迁移（P1） |
| 代码复制 | MarkdownComponents code-copy ×2、ToolCallComponents tool-card-copy、SurfaceComponents code-copy | 4 | 28px 定位角标按钮，可换 ghost icon-sm + 反制 |

## 3. 已修复的问题（过程中发现）

| 问题 | 根因 | 修复 |
|---|---|---|
| `Slot failed to slot onto its children` | `button.tsx` asChild 模式渲染两个表达式 children（loading spinner + 内容），Radix Slot 收到数组 children 后抛错；任何 ConfirmDialog（AlertDialogAction/Cancel 用 Button asChild）渲染即崩 | asChild 时直接透传单元素 children（`ui-shadcn/button.tsx`） |
| FileDiffViewer 界面出现 "variant=ghost size=icon-sm" 文本 | 替换脚本把属性行插到了 Button 标签外（孤儿文本） | 合并回 Button 属性 |
| GitPanel 丢失全部空行 | 修复脚本误用 `filter(l => l !== '')` | 从 git HEAD 重新生成 |
| `--color-bg-subtle` / `--color-bg-input` 未定义 | foundation.css :root 未定义但 CSS 引用了（无效值） | browser 域迁移时在 tailwind.css 映射到 muted/panel |

## 4. 死 CSS 清理记录

方法：全文本引用分析（tsx/ts/html 源码），规则块内**所有类都无引用且不被模板前缀命中**才删除；
共享选择器列表（`.a,\n.b {`）保守跳过。第一轮删除踩了「共享列表悬空逗号」的坑，
被 `tests/stylesSyntax.test.mjs` 的嵌套规则检测当场抓到，修复解析器后通过。

已删 16 条规则 / 114 行：`project-resources-refresh` 系列、`app-notice` 全套（被 sonner 替代）、
`window-controls-left`、`chat-agent-id` ×2、`branch-label`、`.ask-dialog`、`.tool-group-card-chip.muted`、`.filter-menu`。

待人工核实的候选（~55 个）：`feishu-*` 旧面板类、`config-*` 旧弹窗类、`file-action-*` 旧编辑器菜单、
`setting-*` 旧字号折叠、`agent-status-badge` 系列（与活的 `agent-status-indicator` 区分）、
`modified-file-*`、`queued-behavior-*`（动态值需确认）、`device-mobile/tablet`（UA 功能相关，保守保留）。

## 5. P2 CSS 迁移模式（browser 域示范）

迁移 = 三步，一次完成一个「自包含组」：

1. **补 token 映射**（`tailwind.css` @theme inline）：被迁移 CSS 用到的语义变量加入映射。
   例：`--color-bg-subtle: var(--color-bg-muted); --color-bg-input: var(--color-bg-panel);`
2. **JSX 换 utility**：`className="browser-toolbar"` → `className="flex shrink-0 items-center gap-1 border-b border-border-subtle px-2 py-1.5"`。
   注意：tailwind 的 `rounded-md` 等已被 tailwind.css 映射到项目 `--radius-*`，直接用。
3. **删 CSS 规则**：删除对应块（含相邻 `:focus` 等伪类规则）。

已迁移示范组（BrowserPanel）：`browser-toolbar` / `browser-url-bar` / `browser-url-input`（含 :focus）/
`browser-loading-bar` / `browser-loading-fill`。tabbar/tab/nav-btn/device 菜单等因含状态类
（`.active`）与模板动态类（`device-${x}`），留待后续批次。
### config/setting 域已迁移组（优先级 1）

| 组 | JSX 替换 | CSS 规则 | 说明 |
|---|---|---|---|
| `config-settings-*` | 33 处 | 12 条 | SettingsTab/ConfigShared 键值设置行；含 `--add`/`retry-header-row` 变体组合迁移 |
| `config-card` 系列 | 7 处 | 8 条 | ImTab 机器人卡片；`connected` 变体边框被 utility 覆盖，同步改 `border-accent/30` |
| `config-empty` / `config-empty-sm` | 22 处 | 2 条 | 跨 14 个文件的空状态 |
| `config-error` / `config-loading` | 22 处 | 2 条 | 跨 10 个文件；danger-soft 背景 + danger/20 边框 |

迁移中的坑：组合变体（`.config-im-bot-card.connected` 覆盖基础类 border-color）会被 utility 层覆盖，
必须在 JSX 同步改为 utility 条件类；后代选择器（`.config-form-row label`、`.config-test-result-row > span`）
会放大迁移面，留待手动批次。
| ask-inline-bar（内联提问条 + batch 表单） | 54 处 | 42 条/277 行 | 提问条（含 batch tabs/review/选项按钮/输入框），option/tab 状态族（selected/yes/no/active/answered）锚点保留；2 个测试断言同步 |

| archived-message | 4 处 | 5 条 | 压缩归档消息列表（角色条件色） |
| markdown-body（保留决策） | — | — | 42 条规则**保留**：react-markdown 库生成 p/code/table 等元素无法加 utility，内容排版体系用 CSS 是正确架构（shadcn prose 同理）；迁移无收益且高风险 |

| turn-row / user-turn 核心时间线 | 33 处 | 34 条/274 行 | 会话轮次（编辑区/textarea/投递徽章/附件图/气泡——JSX 原已大半 utility 化，类清理 + 补 font-mono/尺寸缺失）；暗色 token 测试断言同步 |

| thinking/compaction/diagnostic 卡片 | 24 处 | 29 条 | 折叠触发器（focus-visible outline 任意值）、压缩徽章、诊断卡 tone 锚点保留 |

| tool-group-card | 2 处 | 2 条 | 多工具聚合平铺容器 |

| session-manager | 16 处 | 22 条/156 行 | 会话管理弹窗（embedded 组合、工具栏/来源筛选 pill（active 条件）、列表行 group-hover 操作显隐）；dialog 头覆盖规则同步迁移到 DialogHeader 类 |

| tool-card 系列 | 15 处 | 19 条/163 行 | 工具卡（trigger/图标/状态/spinner→animate-spin/chevron 旋转/diff 徽章/复制按钮→Button）；`tool-card` 类保留（tone/data-tool-kind 锚点） |

| multi-select 树 | 38 处 | 14 条/106 行 | 消息多选树（MessageShareModal/SessionReferenceModal 共用）：节点行/run 分组/checkbox accent/时间戳；弹窗尺寸 1300×850 保留为 utility（P1 size=xl 变体候选） |

| queued 队列面板（timeline 首组） | 15 处 | 20 条/136 行 | 排队提示面板（clamp 宽度、自定义 scrollbar 任意变体、行为状态锚点保留 queued-row）；测试断言 5 处同步 |

| git-smart-commit + 死类终清 | 9 处 + 14 条 | 14 条+ | 智能提交弹窗（CSS 已死，纯类名清理 + Button variant 化）；git-action-btn/git-compare-btn 类清理；组合选择器残留规则保守保留（活类锚点依赖，如 current 行粗体）；修复误删 git-drawer-detail（App.tsx 引用） |

| GitGraph（history + SVG + hover 卡） | 33 处 | 7 条+ | 历史列表/行（grid 布局 + ref 徽章条件色）、提交文件行、加载更多按钮、SVG 图区（vector-effect 任意变体）、hover 详情卡（portal 定位 + 局部 --git-* 变量覆盖用任意属性）；git-history-row/file-row 类保留作状态色锚点；测试断言 8 处同步 |

| GitResourceTree | 22 处 | 10 条+ | 目录头/chevron/文件图标/stage 符号/资源行（group-hover 操作按钮显隐）/分组头；`git-resource-row` 类保留作状态色锚点（status-* 规则依赖）；测试断言同步 |

| git-pane 布局 + twistie | 9 处 | 2 条+ | pane 动态高度（open/collapsed 条件类 h-[calc(var(--git-pane-height)+26px)]）、pane-body/changes/resource-list/graph/compare 容器、sash 拖拽条（保留类依赖 body 状态规则）、twistie 箭头（before:content 伪元素）；组合选择器规则保守保留 |

| git-scm-input / git-commit | 5 处 | 7 条 | 提交输入区（textarea 用 git 面板变量 arbitrary value、生成消息按钮补边框/背景、提交按钮补 flex-1） |

| git-branch 系列 | 13 处 | 22 条 | 分支栏/触发器/下拉/创建表单死类清理（JSX 已 utility 化，补 max-width/tabular-nums/rotate 等缺失 utility）；active 态 → utility 条件类 |

| GitPanelControls（pane header + compact filter） | 11 处 | 15 条 | PaneHeader 布局类清理（JSX 已 utility 化）；自绘筛选下拉 → Button + utility（fixed 菜单 + portal）；测试断言同步更新 |

| git-spin + compare 布局 | 20 处 | 5 条 | 加载旋转 → `animate-spin`（17 处）；compare 箭头/摘要/文件区 → utility；`git-compare-controls`（含后代选择器）留待下批 |

| config-enabled-models（末组） | 24 处 | 32 条 | SettingsTab 启用模型多选下拉（tags/tag-remove→Button/dropdown/glob/option/checkbox selected 条件类/provider 分组折叠）；config 域全部清零 |

| config-api-type / rename-input / advanced-preserved | 8 处 | 9 条 | 宽菜单定制（w-[1200px]）、重命名输入、高级字段保留区；同步更新 i18n 结构断言测试 |

| config-model 系列 | 15 处 | 17 条 | 模型选择器（搜索/全选/chip 列表 selected/configured 条件类）；dropdown-row/advanced-note；`config-model-list-actions` 共享块保留 |

| config-provider card/list/form | 11 处 | 11 条 | ModelsTab/AuthTab 提供商卡片列表（expanded 展开态条件类含 overflow-visible）；`.config-provider-card.expanded` 组合规则保守保留 |

| config-provider guide 区 + 散类 | 40 处 | 18 条 | ModelsTab 引导区（api-grid/api-item/compat-table/guide-list）；toolbar/count/chevron/batch-checkbox/field-hint 跨 11 个 config 文件；`config-toolbar-actions` 共享块保守保留 |

| `config-form-row` | 8 行 + 8 label + 2 input | 5 条 | AuthTab/ModelsTab 表单行（90px 标签 + 内容列）；baseUrl/testModel 裸 input 补类；ConfigSelect（shadcn）与 base-url-field 等容器类保留 |

| config-auth card/list/eye-btn | 6 处 | 8 条 | 认证卡片列表（editing 展开态条件类）、眼睛按钮 → shadcn Button；config-auth 组全部完成 |

| config-auth guide/selector/item + SecretInput | 34 处 | 33 条 | AuthTab 使用指南/供应商选择器/选中项状态类；SecretInput 组件级迁移；badge 用 accent 系替代未定义的 `--color-success` |

| browser tab/device/webview 系列 | 13 处 | 19 条 | BrowserPanel 标签栏/tab（active 条件类）/tab-add/tabbar-btn/nav-btn/device 菜单/webview-stage；`browser-tab-close`（16px）与 `.browser-panel` 本体及 device-* 变体保留 |

### ⚠️ Tailwind v4 键名规则（迁移必读）

应用域 token（`--color-bg-panel`、`--color-text-primary` 等）生成的 utility 名是 **`前缀 + 完整后缀`**：
- `--color-bg-panel` → `bg-bg-panel`（不是 `bg-panel`）
- `--color-text-primary` → `text-text-primary`（`text-primary` 是 shadcn `--color-primary` = accent 语义）
- `--color-border-subtle` → `border-border-subtle`（这个写对了）

写错的表现：类不生成（背景/文字透明继承）或撞 shadcn 语义（`text-primary` 变 accent 绿、`bg-input` 变边框色）。
已修正 77 行（config 域 + browser 域迁移写入的 utility）。
### ⚠️ 任意值颜色必须有类型提示（tailwind-merge 陷阱）

`text-[var(--color-accent)]` 会被 tailwind-merge 推断为 **font-size**（无提示时 text-[] 默认字号类），
与 `text-xs` 合并后字号变成无效值 → **文字消失**。颜色必须写 `text-[color:var(--color-accent)]`。
同理 `bg-[color:color-mix(...)]`（bg 的 color-mix 需要 color: 提示）；`border-[]`/`bg-[]`/`shadow-[]` 的
默认推断已是颜色/阴影，无需提示。已修正 11 处（combobox 选中项、tab hover、浏览器面板等）。


| `config-combobox` / `-toggle` / `-menu` | 10 处 | 6 条 | ConfigShared 两个自绘组合框（ApiTypeInput + 通用 ComboboxInput）；输入框补 `pr-[38px]`（修复 `.config-combobox input` 的 padding-right 被 px-3 覆盖的隐藏 bug）；菜单项 active 态 → `bg-bg-active text-accent` 条件类；`config-select-trigger`（shadcn SelectTrigger 定制）保留 |

| `config-icon-btn` | 32 处 | 2 条 | 8 个 config tab 的 28px 图标按钮 → shadcn Button ghost icon-sm + size-7；danger 变体 → destructive hover；嵌套选择器（`.project-resource-actions .config-icon-btn` 等）保守保留 |

| `config-test-result-row` / `-error-row` | 9 块 | 5 条 | ModelsTab 测试结果行；后代选择器（span:first-child/strong）逐子元素迁移 |
| `git-status-msg` / `git-not-installed` / `git-not-init` | 10 处 | 8 条 | GitPanel 状态提示区；git 面板专属变量用 arbitrary value（`text-[var(--git-desc-fg)]`） |


### 迁移优先级对照表

| 优先级 | 域 | 位置 | 备注 |
|---|---|---|---|
| 1 | `config` + `setting` | SettingsModal / config/ 目录 | 已用 shadcn Switch/Select，阻力最小；`.setting-field input` 体系保留 |
| 2 | `browser` | BrowserPanel | 已示范；tabbar/tab/device 组可继续 |
| 3 | `git` + `file` | GitPanel / GitGraph / GitResourceTree | 组件已引用 shadcn，补刀即可 |
| 4 | `session`/`timeline`/`markdown`/`tool` | 会话时间线族 | 核心视觉，**最后做**；timeline.css 4098 行动一次回归成本最高 |
| 5 | `feishu` / `scratch` / `env` | 集成面板 | 自包含，可随时做 |

### 迁移门禁

- 每组迁移后：`npm run typecheck` + `npm test` 全绿（stylesSyntax 测试会抓嵌套规则/Vite 管道错误）
- 涉及交互状态（active/disabled/hover）的类：迁移时在 dev 里目测亮暗两态
- 禁止批量替换多个域后一次性验证（定位回归成本高）
- 目标：自定义 CSS 16.5k 行 → ≤8k 行；迁移完成的域删除对应 CSS 规则

## 6. 收尾状态（P1/P3 已完成）

- **P1 弹窗体系收口 ✅**：`DialogContent` 新增 `size="xl"` 变体（1300×850），4 处内联尺寸
  （settings×2 / SessionReferenceModal / 项目列表）统一走变体
- **P3 依赖清理 ✅**：移除 `@radix-ui/react-dialog`（渲染层 0 引用，走 `radix-ui` 聚合包）、
  `@electron-toolkit/preload`（preload 只用 electron+shared）、`remark-highlight-mark` 与
  `unist-util-visit`（无源码引用，lock 中为传递依赖保留）
- **P3 规范固化 ✅**：AGENTS.md「新样式一律走 Tailwind utility + shadcn 组合，禁止新增手写 CSS class
  （token 与 keyframes 除外）」
- **shadcn Tabs 替换 ✅**：新增 `ui-shadcn/tabs.tsx`（下划线式定制，与既有 prompts-tab-btn 视觉对齐）；
  PromptsTab / PromptStoreTab / SkillsTab 共 8 处原生按钮 tab → Tabs（一级+二级）；
  FileDiffViewer（文件标签带关闭）/ WorkspaceDrawerRail（图标 rail）/ batch 提问 tab（状态色）评估后**不替换**（非 Tabs 语义）
- **仍开放（低优先）**：UI 2.0 全面目测验收一轮

## 7. 迁移终态统计

- 手写 CSS：**16,813 → 13,325 行**（-3,488，-21%）；迁移全程无视觉回归门禁（stylesSyntax/暗色 token 断言）
- timeline 域（优先级 4）主体完成：queued/multi-select/tool-card/session-manager/卡片组/
  turn-row/user-turn/archived-message/ask-inline-bar 共 **270+ 处 JSX** 迁移，**170+ 条规则**清理
- **保留（合理）**：markdown-body 42 条内容排版规则（react-markdown 库渲染元素无法 utility 化，
  与 shadcn prose 同理）；git 域 9 个活类锚点；诊断卡 tone-* / ask option / batch-tab 状态族锚点
