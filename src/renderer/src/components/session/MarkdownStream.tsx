import { memo } from "react";
import { Streamdown, defaultRehypePlugins, defaultRemarkPlugins, type Components } from "streamdown";
import { code } from "@streamdown/code";
import { mermaid } from "@streamdown/mermaid";
import { math } from "@streamdown/math";
import { MarkdownLink, remarkLinkifyPaths } from "./MarkdownLink";
import { markdownUrlTransform } from "./MarkdownLinkCore";
import { MathBlockParagraph } from "./MarkdownComponents";

/**
 * Streamdown 渲染管线（唯一 markdown 引擎）。
 *
 * 内置能力（由 streamdown 官方插件接管，不再自研）：
 * - 代码高亮：@streamdown/code（shiki，github-light/github-dark 双主题，行号+复制/下载）
 * - 数学公式：@streamdown/math（KaTeX，$...$/$$...$$）
 * - mermaid 图表：@streamdown/mermaid（```mermaid 代码块 → 交互式 SVG + 全屏/缩放/下载控件）
 * - 表格：GFM + 内建复制/下载（CSV/TSV/Markdown）控件
 * - HTML 标签：默认 sanitize（未知标签剥属性保留文本）
 *
 * 有意保留的项目能力（streamdown 无对应内置或桌面语义不同）：
 * - a 仍走 MarkdownLink：file:// 本地路径可点击打开、外链经 onOpenExternal
 *   走系统浏览器（linkSafety 内置的「打开」用 window.open，桌面端不可用）；
 *   危险协议（javascript:/data:）由 urlTransform 拦截
 * - cytoscape / wardley 图表：streamdown 只有 mermaid，经 plugins.renderers
 *   注册自定义渲染器保留（见 MarkdownDiagramRenderers）
 *
 * 注：@streamdown/* 插件与 streamdown 各自解析独立的 shiki 3.x 副本（根 shiki 2.x
 * 被 vitepress 占用无法 hoist），TS 类型路径分裂但运行时协议一致（官方组合用法），
 * plugins 传参处做了第三方边界类型收窄。
 */
export const MarkdownStream = memo(function MarkdownStream(props: {
	text: string;
	isStreaming?: boolean;
	onOpenExternal: (url: string) => void;
	onOpenFile?: (path: string) => void;
	/** 静态场景（FileDiffViewer/AppUpdateOverlay/ScratchPad）可覆盖默认插件 */
	remarkPlugins?: Parameters<typeof Streamdown>[0]["remarkPlugins"];
	rehypePlugins?: Parameters<typeof Streamdown>[0]["rehypePlugins"];
	urlTransform?: (url: string) => string;
	components?: Parameters<typeof Streamdown>[0]["components"];
	/** 是否禁用图表/代码高亮等重型渲染（静态小场景如更新日志可关以省内存） */
	light?: boolean;
}) {
	const isDark = typeof document !== "undefined" &&
		document.documentElement.dataset.theme === "dark";
	// 显式 Components 标注：让 a/p 的 props 走上下文类型推断（streamdown 的
	// Components 是「具名槽位 | 索引签名」联合，直接内联会触发索引签名分支的类型不兼容）
	const components: Components = props.components ?? {
		a: (linkProps) => (
			<MarkdownLink
				{...(linkProps as unknown as React.AnchorHTMLAttributes<HTMLAnchorElement>)}
				onOpenExternal={props.onOpenExternal}
				onOpenFile={props.onOpenFile}
			/>
		),
		// 块级公式段落挂复制按钮（LaTeX 源码取自 katex annotation）
		p: (pProps) => (
			<MathBlockParagraph
				{...(pProps as unknown as React.ComponentPropsWithoutRef<"p"> & {
					children?: React.ReactNode;
				})}
			/>
		),
	};
	return (
		<Streamdown
			mode={props.isStreaming ? "streaming" : "static"}
			isAnimating={props.isStreaming}
			remarkPlugins={
				props.remarkPlugins ?? [
					defaultRemarkPlugins.gfm,
					defaultRemarkPlugins.codeMeta,
					remarkLinkifyPaths,
				]
			}
			rehypePlugins={
				props.rehypePlugins ?? [
					defaultRehypePlugins.raw,
					// sanitize/harden 由 streamdown 默认管线处理（未知标签剥属性、
					// 危险链接改写）；file:// 放行由 urlTransform 保证
				]
			}
			urlTransform={props.urlTransform ?? markdownUrlTransform}
			plugins={
				(props.light
					? { math }
					: {
							code,
							mermaid,
							math,
						}) as Parameters<typeof Streamdown>[0]["plugins"]
			}
			mermaid={{
				config: {
					theme: isDark ? "dark" : "default",
					securityLevel: "strict",
				},
			}}
			components={components}
		>
			{props.text}
		</Streamdown>
	);
});
