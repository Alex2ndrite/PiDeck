/**
 * WebAssistantText — Web 端助手消息 Markdown 渲染。
 *
 * 与桌面端 SurfaceComponents.AssistantText 同管线（react-markdown +
 * remark-gfm/math/linkify-paths + rehype-katex + CodeBlock/MathSpan +
 * MarkdownLink），但去掉桌面专用的 streamdown/jotai 开关：
 * - 流式期间用轻量管线（GFM + 路径链接），跳过 KaTeX/Mermaid，
 *   避免每个 token 都对不断增长的全量正文调用重型插件（与桌面端一致）
 * - 收尾后切回完整管线（含数学公式）
 * - 复用 MarkdownComponents 的 CodeBlock/MathSpan（仅依赖 lucide/Button/t）
 */
import { isValidElement, memo, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import "katex/dist/katex.min.css";
import { CodeBlock, MathSpan } from "@/components/session/MarkdownComponents";
import { MarkdownLink, markdownUrlTransform, remarkLinkifyPaths } from "@/components/session/MarkdownLink";
import { stripAnsi } from "@/components/session/TimelineFormat";

/** 从正文里剥除 <thinking> 标签（思考内容由 reasoning part 单独渲染）。 */
function stripThinkingTags(text: string): string {
	return text.replace(/<thinking>[\s\S]*?<\/thinking>/gi, "").trim();
}

/** 表格容器：与 code-block-wrap 保持相同的宽度与圆角，内部 <table> 负责横向滚动。 */
function TableWrapper(props: React.ComponentProps<"table">) {
	return (
		<div className="table-wrap">
			<table {...props} />
		</div>
	);
}

function extractText(node: ReactNode): string {
	if (typeof node === "string" || typeof node === "number") return String(node);
	if (Array.isArray(node)) return node.map(extractText).join("");
	if (isValidElement<{ children?: ReactNode }>(node)) {
		return extractText(node.props.children);
	}
	return "";
}

export const WebAssistantText = memo(
	function WebAssistantText(props: {
		text: string;
		isStreaming?: boolean;
	}) {
		// 清理 ANSI 转义码与 <thinking> 标签，thinking 由调用方折叠渲染
		const cleanText = stripThinkingTags(stripAnsi(props.text));
		const streaming = Boolean(props.isStreaming);
		return (
			<div className="assistant-text markdown-body">
				<ReactMarkdown
					remarkPlugins={
						streaming
							? [remarkGfm, remarkLinkifyPaths]
							: [remarkGfm, remarkMath, remarkLinkifyPaths]
					}
					rehypePlugins={streaming ? [] : [rehypeKatex]}
					urlTransform={markdownUrlTransform}
					components={{
						pre: CodeBlock,
						table: TableWrapper,
						span: MathSpan,
						a: (linkProps) => (
							<MarkdownLink
								{...linkProps}
								onOpenExternal={(url: string) => {
									// Web 端无系统浏览器通道，直接当前标签页新窗口打开
									window.open(url, "_blank", "noopener");
								}}
							/>
						),
					}}
				>
					{cleanText}
				</ReactMarkdown>
			</div>
		);
	},
	// 文本与流式标记一致时跳过重渲染：历史消息在流式期间不重复解析 Markdown
	(prev, next) =>
		prev.text === next.text && prev.isStreaming === next.isStreaming,
);

/** 供调用方复用的文本提取（复制等场景）。 */
export function extractWebText(node: ReactNode): string {
	return extractText(node);
}
