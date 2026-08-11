import type { CSSProperties } from "react";

/**
 * 聊天内容宽度：消息区与输入框必须用同一条 inline style。
 *
 * 不能靠父级 padding / Tailwind @utility：
 * - 单栏 SessionView 根节点是 display:contents，子面板按栏宽铺满；
 * - 待发送自己算过 width，所以看起来「有留边」，对话和输入框没有。
 * --chat-content-pct-set 由 AppShell 注入并继承。
 *
 * 对齐契约：消息列与输入框的百分比宽度必须解析自同一个基准。
 * - 时间线侧：宽度挂在滚动内容 [role=log] 上（而非视口/宿主），视口铺满面板、
 *   滚动条贴面板最右；视口自带 scrollbar-gutter:stable，预留真实滚动条槽位。
 * - 输入框侧：composer 面板 overflow-hidden + scrollbar-gutter:stable 预留同一槽位
 *   （见 SessionView），footer 的 width 与两者同基准解析。
 * 两侧槽位均由浏览器按真实滚动条宽度预留（不写死像素），任何宽度设置下都像素级对齐。
 */
export const chatContentWidthStyle: CSSProperties = {
	width: "var(--chat-content-pct-set, 80%)",
	maxWidth: "100%",
	marginInline: "auto",
};
