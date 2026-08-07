import { memo, useMemo } from "react";
import { Streamdown, defaultRehypePlugins, defaultRemarkPlugins, type Components } from "streamdown";
import { code } from "@streamdown/code";
import { mermaid } from "@streamdown/mermaid";
import { math } from "@streamdown/math";
import { MarkdownLink, remarkLinkifyPaths } from "./MarkdownLink";
import { markdownUrlTransform } from "./MarkdownLinkCore";
import { MathBlockParagraph } from "./MarkdownComponents";
import { useSmoothStream } from "../../utils/useSmoothStream";

/**
 * 流式超长兜底阈值（字符数，UTF-16 code unit）。
 *
 * marked 解析成本随当前累积文本线性增长：实测（marked 17，200 轮平均）
 * 30K 字符约 2.3ms/帧（帧预算 14%）、60K 约 5.1ms（31%）。
 * pi 的典型回答（含代码）在 10K 字符以内；超过该阈值时流式期间回退纯文本，
 * 保住 60fps 与打字机节奏（rAF 掉帧 → queue 积压 → 流式滞后），settle 后
 * 自动切回全量渲染。正文与思考共用此兜底。
 */
export const STREAM_LIGHT_MAX_CHARS = 40_000;

/**
 * Streamdown 渲染管线（唯一 markdown 引擎）。
 *
 * 内置能力（由 streamdown 官方插件接管，不再自研）：
 * - 代码高亮：@streamdown/code（shiki 3.x JS 引擎 + 按语言懒加载；行号/复制/下载由
 *   streamdown 内置外壳提供，观感由 streamdownChrome.css（utilities 层）压掉官方双层皮；
 *   2026-08 曾因全语言常驻移除，恢复时按 memory-profile 复测）
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
 * 注：plugins 传参处对第三方边界类型做了收窄（streamdown 官方组合用法）。
 */
export const MarkdownStream = memo(function MarkdownStream(props: {
	text: string;
	isStreaming?: boolean;
	onOpenExternal: (url: string, forceSystem?: boolean) => void;
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
	// 逐字打字机：默认参数见 useSmoothStream（约 8ms / 每帧最多 6 字）。
	const { displayedContent } = useSmoothStream({
		content: props.text,
		isStreaming: Boolean(props.isStreaming),
	});
	const displayText = props.isStreaming ? displayedContent : props.text;
	const isStreamingNow = Boolean(props.isStreaming);
	// 流式超长兜底：长度单调递增，一旦超过阈值保持纯文本到 settle，不会反复横跳。
	const streamPlain =
		isStreamingNow && displayText.length > STREAM_LIGHT_MAX_CHARS;
	// 流式期间走轻量渲染：跳过代码高亮/mermaid/数学等重插件，只跑 marked 核心解析，
	// 否则 30fps 逐字渲染会让插件管线（每帧全量树遍历）占满主线程，React concurrent
	// 把多帧 setState 合并提交 → DOM 一帧蹦多字（学 Proma：流式期间 react-markdown 轻渲染）。
	// 流结束 isStreaming 变 false 后自动切回全量（含高亮/mermaid/表格）。
	const effectiveLight = props.light || Boolean(props.isStreaming);
	// 流式中精简插件：gfm/codeMeta/linkifyPaths 与 math 等插件都留到静态渲染；
	// 外部显式传入的插件（FileDiffViewer 等场景）不受流式精简影响。
	const resolvedRemarkPlugins = isStreamingNow
		? []
		: (props.remarkPlugins ?? [
				defaultRemarkPlugins.gfm,
				defaultRemarkPlugins.codeMeta,
				remarkLinkifyPaths,
			]);
	const resolvedRehypePlugins = isStreamingNow
		? []
		: (props.rehypePlugins ?? [defaultRehypePlugins.raw]);
	// 显式 Components 标注：让 a/p 的 props 走上下文类型推断（streamdown 的
	// Components 是「具名槽位 | 索引签名」联合，直接内联会触发索引签名分支的类型不兼容）
	// useMemo 依赖回调 props：回调引用变化时 components 重建，streamElement 随之重建，
	// 闭包不会捕获过期回调（比裸对象 + eslint-disable 的做法依赖链完整）。
	const components: Components = useMemo(
		() =>
			props.components ?? {
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
			},
		[props.components, props.onOpenExternal, props.onOpenFile],
	);
	// 节流窗口内 displayText 不变时，useMemo 返回同一 element 引用，
	// React 直接 bailout，Streamdown 子树（含 marked 解析）完全跳过。
	const streamElement = useMemo(
		() =>
			streamPlain ? (
				// 超长兜底：流式期间纯文本节点（主线程只做字符串切片），
				// 排版交给容器 markdown-body（pre-wrap 语义由此处补上）。
				<div className="whitespace-pre-wrap break-words">{displayText}</div>
			) : (
				<Streamdown
				// 学 Proma：流式期间也用 static 模式（同步渲染）。streamdown 的 streaming 模式
				// 内部用 useTransition 低优先级更新块，React 会把多帧 transition 合并提交 →
				// DOM 一帧跳多帧步进（视觉蹦字）；static 模式与 Proma 的 react-markdown 同为
				// 同步提交，每帧独立渲染，DOM 增量 = useSmoothStream 每帧步进。
				mode="static"
				isAnimating={props.isStreaming}
				remarkPlugins={resolvedRemarkPlugins}
				rehypePlugins={resolvedRehypePlugins}
				urlTransform={props.urlTransform ?? markdownUrlTransform}
				plugins={
					(effectiveLight
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
				{displayText}
			</Streamdown>
			),
		// 依赖链完整：displayText 变化（节流窗口到点）或组件配置变化时才重建 element。
		[
			displayText,
			streamPlain,
			components,
			props.isStreaming,
			effectiveLight,
			resolvedRemarkPlugins,
			resolvedRehypePlugins,
			props.urlTransform,
			isDark,
		],
	);
	return streamElement;
});
