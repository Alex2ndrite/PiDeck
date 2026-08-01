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

## 6. 后续工作（P1/P3）

- **P1 弹窗体系收口**：1300×850 大弹窗尺寸重复 4 处（settings/browser/codex-import/project-resources），
  抽 shadcn Dialog `size="xl"` 变体；引入 shadcn Tabs 替换 4 个原生 tab 导航
- **P3 依赖清理**：移除 `@radix-ui/react-dialog`（渲染层已 0 引用，全部走 `radix-ui` 聚合包）
- **P3 规范固化**：AGENTS.md 增加「新样式一律走 Tailwind utility + shadcn 组合，禁止新增手写 CSS class
  （token 与 keyframes 除外）」
