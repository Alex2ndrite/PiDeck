import type { CSSProperties } from "react";

/**
 * 聊天内容宽度：消息区与输入框必须用同一条 inline style。
 *
 * 不能靠父级 padding / Tailwind @utility：
 * - 单栏 SessionView 根节点是 display:contents，子面板按栏宽铺满；
 * - 待发送自己算过 width，所以看起来「有留边」，对话和输入框没有。
 * --chat-content-pct-set 由 AppShell 注入并继承。
 */
export const chatContentWidthStyle: CSSProperties = {
	width: "var(--chat-content-pct-set, 80%)",
	maxWidth: "100%",
	marginInline: "auto",
};
