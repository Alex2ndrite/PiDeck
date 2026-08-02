import { isValidElement, type ReactNode } from "react";

/**
 * Markdown 渲染辅助（Streamdown 转正后精简）：
 * mermaid 由 @streamdown/mermaid 插件渲染、代码高亮由 @streamdown/code、
 * 数学公式由 @streamdown/math——本文件仅保留通用文本提取工具。
 */

/** 从 ReactNode 树提取纯文本（复制/导出场景使用）。 */
export function extractText(node: ReactNode): string {
	if (typeof node === "string" || typeof node === "number") return String(node);
	if (Array.isArray(node)) return node.map(extractText).join("");
	if (isValidElement<{ children?: ReactNode }>(node)) {
		return extractText(node.props.children);
	}
	return "";
}
