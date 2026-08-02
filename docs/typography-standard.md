# 字体与排版规范（Typography Standard）

> 目标：全应用字号/字重/字体统一，默认值与 shadcn new-york（zinc）官方样例对齐；
> 用户可在设置中按区域缩放，所有区域都必须跟随设置。

## 一、字号 Token 刻度（唯一真源）

定义在 `src/renderer/src/styles/foundation.css` `:root`，由
`data-ui-font-size` / `data-chat-font-size` / `data-input-font-size`
（compact / default / medium / large）整体缩放：

| Token（CSS 变量） | 默认值 | Tailwind 工具类 | 用途 |
|---|---|---|---|
| `--font-size-micro` | 11px | `text-micro` | 徽标、时间戳、状态点文字 |
| `--font-size-caption` | 12px | `text-caption` | 次要标签、Tab 栏、工具按钮 |
| `--font-size-control` | 13px | `text-control` | 紧凑控件、菜单项 |
| `--font-size-body` | 14px | `text-body` | 正文/UI 默认（≈ shadcn `text-sm`） |
| `--font-size-chat` | 15px | `text-chat` | 会话消息正文 |
| `--font-size-input` | 14px | `text-input` | 输入框（composer） |
| `--font-size-title` | 16px | `text-title` | 区块标题（≈ shadcn `text-base`） |
| `--font-size-brand` | 18px | `text-brand` | 品牌字标 |
| `--font-size-heading` | 20px | `text-heading` | 弹窗/页面大标题 |
| `--font-size-logo` | 36px | — | 启动 Logo（不参与 UI 缩放） |

## 二、Tailwind 映射（让设置全局生效）

`src/renderer/src/styles/tailwind.css` 的 `@theme inline` 中把上述 token
映射为 Tailwind v4 字号工具类（`text-micro` ~ `text-heading`）。
**新代码禁止使用裸字号类**（`text-sm`/`text-xs`/`text-[13px]` 等），
一律用语义工具类；默认值与原样一致，但会随用户字号设置缩放。

旧代码迁移对照：
- `text-sm` → `text-body`
- `text-xs` → `text-caption`
- `text-[13px]` → `text-control`
- `text-[11px]` / `text-[10px]` → `text-micro`
- `text-base` → `text-title`
- `text-[15px]`（会话正文）→ `text-chat`

## 三、字重规范（对齐 shadcn）

| 层级 | 字重 | 示例 |
|---|---|---|
| 页面/弹窗标题 | `font-semibold` (600) | 抽屉 Header、会话标题 |
| 区块/行内强调 | `font-medium` (500) | 项目名、会话名、Tab 激活态 |
| 正文/次级 | `font-normal` (400) | 消息正文、描述、时间戳 |
| 数值/代码 | `font-mono` | token 计数、路径、日志 |

禁止：`font-bold` 做正文强调；同一语义层级混用多种字重。

## 四、字体族

- 界面字体：`--font-family-base`（系统字体栈，设置里可切换 sans/serif/custom）
- 等宽字体：`--font-family-mono`（Commit Mono，设置里可切换）
- 品牌字体：`--font-family-brand`（仅 Logo/品牌场景）

## 五、设置联动

- `uiFontSize` → `data-ui-font-size`：侧栏、按钮、列表、弹窗、Tab 栏等全部 UI。
- `chatFontSize` → `data-chat-font-size`：会话消息正文（`--font-size-chat`）。
- `inputFontSize` → `data-input-font-size`：composer 输入框。
- 各区域字号 = 对应 data 属性 × 上表 token；不再允许组件内硬编码像素值。
