import { memo } from "react";
import { Streamdown, defaultRehypePlugins, defaultRemarkPlugins } from "streamdown";
import rehypeKatex from "rehype-katex";
import remarkMath from "remark-math";
import { CodeBlock, MathSpan } from "./MarkdownComponents";
import { markdownUrlTransform, MarkdownLink, remarkLinkifyPaths } from "./MarkdownLink";

/**
 * Streamdown 渲染管线（UI 2.0 / issue #115 U2 灰度开关）。
 *
 * 相对旧 react-markdown 管线的收益：流式半截 markdown（未闭合代码围栏/表格/加粗）
 * 由 remend 容错补全、按 block 粒度 memo（不再需要流式期间切换轻量插件管线）、
 * 表格复制等内建控件。
 *
 * 有意保留的项目行为（灰度期不回退这些能力）：
 * - pre/span/a 仍走自定义组件：mermaid/cytoscape/wardley 代码块、数学 span、
 *   文件路径链接（file:// → onOpenFile）与外链拦截（onOpenExternal）；
 * - rehype 不加 sanitize / harden：与旧管线同一信任模型（本地 AI 输出），
 *   sanitize 会剥高 file:// 链接、harden 把 file: 写死进 blockedProtocols，
 *   文件路径可点击打开是项目核心能力，两者都只能弃用（危险协议由 urlTransform 拦）。
 */
export const MarkdownStream = memo(function MarkdownStream(props: {
	text: string;
	isStreaming?: boolean;
	onOpenExternal: (url: string) => void;
	onOpenFile?: (path: string) => void;
}) {
	return (
		<Streamdown
			mode={props.isStreaming ? "streaming" : "static"}
			isAnimating={props.isStreaming}
			remarkPlugins={[
				defaultRemarkPlugins.gfm,
				defaultRemarkPlugins.codeMeta,
				remarkMath,
				remarkLinkifyPaths,
			]}
			rehypePlugins={[
				defaultRehypePlugins.raw,
				rehypeKatex,
				// 有意排除 sanitize 与 harden 两个 rehype 插件：
				// 与旧管线同一信任模型（本地 AI 输出），sanitize 默认 schema 会剥高 file:// 链接；
				// harden 则把 file: 写死进 blockedProtocols（不允许覆盖），
				// 而「AI 回复中的文件路径可点击打开」是本项目核心能力，两插件都只能弃用。
				// javascript:/data: 等危险协议由 urlTransform（defaultUrlTransform）拦截。
			]}
			urlTransform={markdownUrlTransform}
			// Streamdown 的 components 索引签名为 Record<string, unknown> & ExtraProps，
			// 与 react-markdown 组件的 DOM props 类型不交集；运行时传入的就是 hast DOM 属性，
			// 属第三方边界的类型收窄（AGENTS 例外条款），故经 unknown 转到具体 DOM props。
			components={{
				pre: (preProps) => <CodeBlock {...(preProps as unknown as React.HTMLAttributes<HTMLPreElement>)} />,
				span: (spanProps) => <MathSpan {...(spanProps as unknown as React.HTMLAttributes<HTMLSpanElement>)} />,
				a: (linkProps) => (
					<MarkdownLink
						{...(linkProps as unknown as React.AnchorHTMLAttributes<HTMLAnchorElement>)}
						onOpenExternal={props.onOpenExternal}
						onOpenFile={props.onOpenFile}
					/>
				),
			}}
		>
			{props.text}
		</Streamdown>
	);
});
