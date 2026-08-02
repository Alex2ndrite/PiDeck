# PiDeck UI 优化任务与进度

> 目标：在不改变 pi RPC 边界、Jotai 状态模型和 session-first 架构的前提下，统一 PiDeck 的视觉语言、交互原语和会话信息层级。
>
> 每个任务完成后必须通过 `npm run typecheck` 和 `npm test`。涉及会话时间线、工具调用或设置持久化的任务，还需要补充对应行为测试或手测项。

## 总体原则

1. pi 负责 Agent 行为、工具调用和会话读写，renderer 只负责展示和交互转发。
2. 优先复用已有 shadcn 源码组件；缺少组件时先评估是否真的需要，不为替换而替换。
3. 用户可感知的状态必须有明确层级：项目、工作区、运行中会话、历史会话、子 Agent 不混在同一层。
4. 动画服务于状态变化，不用于装饰；布局尺寸不能因切换内容而无预期抖动。
5. 用户可见文案全部进入中英文 i18n；新增复杂逻辑必须写“为什么”和边界条件注释。

## 优先级总表

状态：`✅ 已完成`、`🟡 部分完成/待收口`、`⬜ 待开始`、`🔍 待评估`。

| 优先级 | 任务 | 当前状态 | 主要落点 | 验收重点 |
|---|---|---|---|---|
| P0 | 左侧项目列表改成 Sidebar | ✅ 已完成 | `components/sidebar/*` | 单一滚动区；项目只出现一次；点击一次切换并展开；展开状态持久化；切换不抖动 |
| P0 | 品牌 Logo 与品牌文字 | 🟡 部分完成 | `AppParts.tsx`、`AppSidebar.tsx`、`AppHeader.tsx` | Logo/文字尺寸、字重、间距、拖拽区和暗色主题一致 |
| P0 | 设置、Pi 管理、反馈页面标题与 label 统一 | 🟡 第一批已完成，继续扩展 | `SettingsModal.tsx`、`config/*`、反馈 overlay、共享组件 | 标题层级、label 字号、字重、描述色、间距统一 |
| P0 | Markdown 渲染后的工具调用展示 | 🟡 部分完成 | `MarkdownStream.tsx`、`ToolCallComponents.tsx`、`TimelineEventCards.tsx` | 工具 Logo、状态、展开/折叠、详情、错误和流式状态一致 |
| P0 | 会话响应动画与空白页 | 🟡 部分完成 | `SurfaceComponents.tsx`、`timeline.css`、SessionView | 响应中、工具执行中、空会话、异常和加载状态不互相跳动 |
| P1 | Todo / Plan / Ask | 🟡 Ask 已有 | `TimelineEventCards.tsx`、overlay、pi RPC | Ask 的 pending/answered/cancelled；todo/plan 依赖 pi 扩展，不在 renderer 伪造 |
| P1 | `/theming` 统一 | 🟡 基础已完成 | `themePresets.ts`、`tailwind.css`、`foundation.css` | token 单一来源；明暗、accent、皮肤、背景图和组件状态一致 |
| P1 | Avatar 作为项目 Logo 与状态表达 | ⬜ 待开始 | `ProjectAvatar`、`AgentAvatar`、项目树 | 项目身份、运行态、错误态、worktree 状态一眼可辨 |
| P1 | Command 用于模型、思考级别和模式选择 | ✅ 基础已完成 | `ComposerComponents.tsx`、`ui-shadcn/command.tsx` | 搜索、分组、键盘导航、当前值和空状态统一 |
| P1 | Context Menu 统一右键菜单 | 🟡 部分完成 | `SidebarParts.tsx`、文件树、Git、会话 | 右键菜单统一焦点、碰撞定位、危险操作和关闭行为 |
| P1 | Dropdown Menu 统一下拉菜单 | 🟡 部分完成 | `SessionTabsBar.tsx`、Config、Git、文件相关面板 | 删除自绘定位和重复的 ESC/外部点击逻辑 |
| P1 | Tooltip / Hover Card | 🟡 Tooltip 已有 | `ui-shadcn/tooltip.tsx`、工具卡、项目行、设置项 | Tooltip 只解释图标；复杂详情使用 Hover Card，不滥用 title |
| P1 | Marker 用于思考、工具调用和压缩方向 | ⬜ 待开始 | `TimelineEventCards.tsx`、`SurfaceComponents.tsx` | 时间线中系统事件、思考、工具、压缩有统一的 marker 轨道 |
| P2 | Data Table 会话管理 | ⬜ 待开始 | `SidebarComponents.tsx` 的 SessionManagerModal | 排序、来源、批量选择、删除、重命名和空状态 |
| P2 | Pagination | 🟡 hook 已有 | `useMessagePagination.ts`、SessionManager、YaoPrompt | 分页只负责大列表，不替代时间线滚动和流式加载 |
| P2 | Progress | 🟡 现有自定义进度 | 更新 overlay、环境安装、Ask batch | 下载、安装、批量 Ask 进度统一语义与无障碍属性 |
| P2 | Scroll Area | 🟡 组件已安装 | Sidebar、会话管理、设置、抽屉面板 | 统一滚动条、键盘滚动和边界阴影，避免嵌套滚动 |
| P2 | 其余 shadcn 替换 | 🟡 持续收口 | `components/ui-shadcn/*` 和各业务域 | 先替换有明显交互收益的控件，不替换语义为内容容器的原生 button |

## 执行批次

### Batch 1：视觉基线与标题规范（当前批次）

- [x] 建立本任务文档。
- [x] 标记现有 Sidebar、Command、Ask、Tooltip、主题系统的真实状态。
- [x] 抽取共享的页面区块标题/label 规范，并应用到 Settings、Pi 管理、反馈页面。
- [x] 校验品牌 Logo、品牌文字和设置页面标题在亮暗主题下的字号与字重。
- [x] 运行 typecheck、全量测试并更新本表。

### Batch 2：工具调用与会话状态

- [ ] 盘点工具类型与现有图标映射，补齐未知工具的统一 fallback。
- [ ] 统一工具卡 trigger、状态、详情、复制、错误和展开折叠。
- [ ] 统一 thinking、tool、compaction、diagnostic、ask 的 marker 轨道。
- [ ] 收敛响应中动画和空白页，保证 reduced-motion 下不依赖动画表达状态。

### Batch 3：交互原语

- [ ] Context Menu：会话、项目、文件、Git 四类入口。
- [ ] Dropdown Menu：标签页、模型配置、Git 和设置内自绘下拉。
- [ ] Hover Card / Tooltip：区分短提示和复杂详情。
- [ ] Todo / Plan / Ask：只接真实 pi 扩展状态，补齐错误和不可用状态。

### Batch 4：身份与主题

- [ ] Project Avatar：项目 Logo、worktree、运行态、错误态。
- [ ] Agent Avatar：运行态和来源状态统一。
- [ ] `/theming` token 复核和组件状态色清理。
- [ ] 明暗主题、accent、皮肤、背景图手测巡检。

### Batch 5：大列表和迁移收尾

- [ ] Session Manager 使用 Data Table。
- [ ] 分页、进度、Scroll Area 统一。
- [ ] 清理已迁移域的死 CSS。
- [ ] 更新 E2E 视觉巡检和手测清单。

## 本次变更记录

### 2026-08：建立优化清单

- 根据当前 renderer 代码和已安装 shadcn 组件盘点功能现状。
- 确认 Sidebar 已完成结构重排，但需要继续做视觉验收。
- 确认 Command 已用于模型/思考级别；Ask、Tooltip、Dropdown、主题系统已有部分实现。
- 确认 Context Menu、Hover Card、Avatar、Marker、Data Table、Pagination、Progress 仍需要按业务域补齐。
- 新增 `ui-shadcn/section-heading.tsx`，统一 Settings Storage、Pi 管理 SettingsTab、Feedback 弹窗的标题和描述层级。
- Feedback 弹窗合并重复 header，补齐可访问的 `DialogTitle`，并统一描述、复现步骤、环境信息的区块标题。
- 新增 `tests/uiSectionHeading.test.mjs`，锁定共享组件接入范围和标题层级契约。

## 门禁

- 每个 Batch 完成：`npm run typecheck`、`npm test`。
- 涉及 renderer 交互状态：至少增加一个行为回归测试。
- 涉及主题或布局：至少检查亮色/暗色，以及 Sidebar、设置、会话三类关键页面。
- 不自动提交；只有用户明确要求时才执行 commit/push。
