import { isValidElement, useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type React from "react";
import { Check, Copy } from "lucide-react";
import { defaultUrlTransform } from "react-markdown";
import { Button } from "../ui-shadcn/button";
import { t } from "../../i18n";
import { showNotice } from "../../utils/notice";

let mermaidModulePromise: Promise<typeof import("mermaid")> | null = null;
function loadMermaid() {
	if (!mermaidModulePromise) mermaidModulePromise = import("mermaid");
	return mermaidModulePromise;
}
export function MathSpan(props: React.HTMLAttributes<HTMLSpanElement>) {
	const { className, children, ...spanProps } = props;
	const ref = useRef<HTMLSpanElement | null>(null);
	const isDisplayMath = /\bkatex-display\b/.test(className ?? "");
	// 只对 KaTeX 最外层 span 添加复制按钮，内部嵌套的 katex-mathml / katex-html 等直接透传。
	// 行内公式外层 class 精确为 "katex"，块级外层为 "katex-display"（可能同时含 "katex"）。
	const isOuterKatex = isDisplayMath || className === "katex";
	if (!isOuterKatex) return <span className={className} {...spanProps}>{children}</span>;
	const [copied, setCopied] = useState(false);
	const copyMath = () => {
		const annotation = ref.current?.querySelector('annotation[encoding="application/x-tex"]');
		const source = annotation?.textContent || extractText(children);
		// 行内公式用 $...$ 包裹，块级公式用 $$...$$ 包裹
		const texContent = isDisplayMath ? `$$\n${source}\n$$` : `$${source}$`;
		void navigator.clipboard.writeText(texContent);
		setCopied(true);
		showNotice(t("app.latexCopied"), 1200);
		setTimeout(() => setCopied(false), 1800);
	};
	return (
		<span className={`math-copy-wrap${isDisplayMath ? "" : " math-copy-wrap--inline"}`}>
			<span ref={ref} className={className} {...spanProps}>{children}</span>
			<button className={`math-copy-btn${isDisplayMath ? "" : " math-copy-btn--inline"}`} type="button" onClick={copyMath} title={t("common.copy")}>
				{copied ? <Check size={isDisplayMath ? 12 : 10} /> : <Copy size={isDisplayMath ? 12 : 10} />}
			</button>
		</span>
	);
}

export function CodeBlock(props: React.HTMLAttributes<HTMLPreElement>) {
	const child = Array.isArray(props.children) ? props.children[0] : props.children;
	const codeProps = isValidElement(child)
		? (child.props as { className?: string; children?: ReactNode })
		: undefined;
	const languageClass = codeProps?.className ?? "";
	const text = extractText(codeProps?.children ?? props.children);
	if (/\blanguage-mermaid\b/i.test(languageClass)) {
		return <MermaidDiagram chart={text} />;
	}
	const [copied, setCopied] = useState(false);
	const handleCopy = () => {
		navigator.clipboard.writeText(text);
		setCopied(true);
		showNotice(t("app.codeCopied"), 1200);
		setTimeout(() => setCopied(false), 1800);
	};
	return (
		<div className="code-block-wrap">
			<button
				className="code-copy"
				onClick={handleCopy}
				title={t("code.copy")}
			>
				{copied ? <Check size={14} /> : <Copy size={14} />}
			</button>
			<pre {...props}>{props.children}</pre>
		</div>
	);
}

function normalizeMermaidChart(chart: string) {
	// Mermaid flowchart 的方括号节点 label 未加引号时，`foo(bar)` 里的括号会被解析成形状语法。
	// 模型常输出 `A[api.call(arg)]` 这种写法，这里仅把含括号的普通方括号 label 自动转成 quoted label。
	return chart.replace(
		/(\b[A-Za-z][\w-]*\s*)\[([^\]\n"]*[()][^\]\n"]*)\]/g,
		(_match, prefix: string, label: string) =>
			`${prefix}["${label.replace(/"/g, "\\\"")}"]`,
	);
}

function MermaidDiagram(props: { chart: string }) {
	const reactId = useId();
	const containerRef = useRef<HTMLDivElement | null>(null);
	const [renderFailed, setRenderFailed] = useState(false);
	const [zoom, setZoom] = useState(1);

	useEffect(() => {
		let disposed = false;
		const chart = normalizeMermaidChart(props.chart);
		const renderId = `pi-mermaid-${reactId.replace(/[^a-zA-Z0-9_-]/g, "")}`;
		// Mermaid 图由模型输出生成，使用 strict 安全级别并禁用 startOnLoad，
		// 避免库扫描整个页面或执行不受控的链接/脚本行为。此处动态加载 mermaid，
		// 保证不按需出现的图表场景不占用渲染进程常驻内存。
		loadMermaid()
			.then((mod) => {
				const mermaid = mod.default;
				mermaid.initialize({
					startOnLoad: false,
					securityLevel: "strict",
					theme: document.documentElement.dataset.theme === "dark" ? "dark" : "default",
				});
				return mermaid.render(renderId, chart);
			})
			.then(({ svg }) => {
				if (disposed || !containerRef.current) return;
				containerRef.current.innerHTML = svg;
				setRenderFailed(false);
			})
			.catch((err: unknown) => {
				if (disposed) return;
				console.error("[Mermaid] Render failed", err);
				setRenderFailed(true);
			});
		return () => {
			disposed = true;
		};
	}, [props.chart, reactId]);

	return (
		<div className="mermaid-block">
			{renderFailed ? (
				<MermaidMarkdownFallback chart={props.chart} />
			) : (
				<>
					<div className="mermaid-toolbar" aria-label={t("mermaid.controls")}>
						<Button type="button" variant="ghost" size="sm" className="h-6 min-w-7 rounded-[6px] px-[7px] text-caption shadow-none" onClick={() => { navigator.clipboard.writeText(`\`\`\`mermaid\n${props.chart}\n\`\`\``); showNotice(t("app.mermaidCopied"), 1200); }} title={t("common.copy")}><Copy size={14} /></Button>
						<Button type="button" variant="ghost" size="sm" className="h-6 min-w-7 rounded-[6px] px-[7px] text-caption shadow-none" onClick={() => setZoom((value) => Math.max(0.5, value - 0.1))}>−</Button>
						<span>{Math.round(zoom * 100)}%</span>
						<Button type="button" variant="ghost" size="sm" className="h-6 min-w-7 rounded-[6px] px-[7px] text-caption shadow-none" onClick={() => setZoom((value) => Math.min(2.5, value + 0.1))}>＋</Button>
						<Button type="button" variant="ghost" size="sm" className="h-6 min-w-7 rounded-[6px] px-[7px] text-caption shadow-none" onClick={() => setZoom(1)}>100%</Button>
					</div>
					<div className="mermaid-viewport">
						<div
							ref={containerRef}
							className="mermaid-diagram"
							style={{ transform: `scale(${zoom})`, "--mermaid-zoom": zoom } as CSSProperties}
						/>
					</div>
				</>
			)}
		</div>
	);
}

function MermaidMarkdownFallback(props: { chart: string }) {
	const markdown = `\`\`\`mermaid\n${props.chart}\n\`\`\``;
	return (
		<div className="code-block-wrap mermaid-fallback">
			<button
				className="code-copy"
				onClick={() => { navigator.clipboard.writeText(markdown); showNotice(t("app.codeCopied"), 1200); }}
				title={t("code.copy")}
			>
				<Copy size={14} />
			</button>
			<pre>{markdown}</pre>
			<small className="mermaid-error-message">{t("mermaid.renderFailed")}</small>
		</div>
	);
}

export function extractText(node: ReactNode): string {
	if (typeof node === "string" || typeof node === "number") return String(node);
	if (Array.isArray(node)) return node.map(extractText).join("");
	if (isValidElement<{ children?: ReactNode }>(node)) {
		return extractText(node.props.children);
	}
	return "";
}
