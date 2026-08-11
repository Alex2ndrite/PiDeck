import { useEffect } from "react";
import { t } from "../../i18n";
import { showNotice } from "../../utils/notice";

/**
 * 通用公式复制（行内 $...$ 与块级 $$...$$ 全覆盖，按钮常显）。
 *
 * streamdown/@streamdown/math 无自带公式复制（interactive controls 只覆盖
 * images/tables/code/mermaid），而 rehype-katex 输出是纯 HTML span、不进
 * Components map——旧实现只能在 p 层拦截「段落唯一子元素是 .katex」的罕见
 * 场景，真正的块级公式（math-display，p 外）与行内公式都无法复制。
 *
 * 实现：DOM 直插按钮（非 React 管理）+ MutationObserver 跟随流式重渲染
 * （KaTeX 每帧重建容器，按钮随旧元素销毁、对新元素自动补齐）。
 * - 块级公式（.math-display 容器，独占一行）：按钮插在容器末尾，公式 flex
 *   居中 + 按钮靠右（容器 flex 化见 surfaces.css）
 * - 行内公式（文本流中）：按钮插在 .katex 元素之后，占用约 20px 行内空间
 *   （不遮挡公式后文字；常显的唯一代价是公式与后文之间的小空隙）
 *
 * LaTeX 源码取自 KaTeX 的 MathML annotation（rehype-katex 固定输出
 * annotation[encoding="application/x-tex"]）。全局单次监听，多实例共享。
 */

// 图标用 lucide 官方 path 内联（非 React 环境无法用组件）
const COPY_SVG =
	'<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>';
const CHECK_SVG =
	'<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';

// 块级按钮：公式容器末尾，常显半透明（仿代码块 actions 观感）；
// 间距由 .math-display 容器 gap 提供，按钮自身不留外边距
const BLOCK_BUTTON_CLASS =
	"flex h-[22px] w-[22px] shrink-0 cursor-pointer items-center justify-center rounded-[4px] border-0 bg-transparent p-0 text-text-tertiary opacity-55 transition-opacity hover:opacity-100 hover:text-[var(--color-accent)] focus-visible:outline-2 focus-visible:outline-[var(--focus-ring)]";
// 行内按钮：插在 .katex 之后紧贴右缘（无外边距，避免“浮在外面”观感）；
// 尺寸收敛到 18px 防撑行高，垂直中线对齐公式
const INLINE_BUTTON_CLASS =
	"inline-flex h-[18px] w-[18px] shrink-0 cursor-pointer items-center justify-center rounded-[3px] border-0 bg-transparent p-0 align-middle text-text-tertiary opacity-55 transition-opacity hover:opacity-100 hover:text-[var(--color-accent)] focus-visible:outline-2 focus-visible:outline-[var(--focus-ring)]";

let listenersInitialized = false;

/** 复制 LaTeX 源码（KaTeX MathML annotation），返回是否成功。 */
function copyTexFrom(root: Element): Promise<boolean> {
	const tex =
		root.querySelector('.katex-mathml annotation[encoding="application/x-tex"]')
			?.textContent?.trim() ?? "";
	if (!tex) return Promise.resolve(false);
	return navigator.clipboard
		.writeText(tex)
		.then(() => true)
		.catch(() => false);
}

function attachCopyHandlers(button: HTMLButtonElement, root: Element) {
	button.addEventListener("click", () => {
		void copyTexFrom(root).then((ok) => {
			if (!ok) {
				showNotice(t("copy.failed"), 2000);
				return;
			}
			button.innerHTML = CHECK_SVG;
			window.setTimeout(() => {
				button.innerHTML = COPY_SVG;
			}, 1500);
			showNotice(t("copy.formulaCopied"), 1200);
		});
	});
}

/** 块级公式：容器末尾插按钮（幂等）。 */
function attachBlockButton(container: HTMLElement) {
	if (container.querySelector("[data-math-copy-btn]")) return;
	const button = document.createElement("button");
	button.type = "button";
	button.dataset.mathCopyBtn = "";
	button.title = t("copy.formula");
	button.setAttribute("aria-label", t("copy.formula"));
	button.className = BLOCK_BUTTON_CLASS;
	button.innerHTML = COPY_SVG;
	attachCopyHandlers(button, container);
	container.appendChild(button);
}

/** 行内公式：.katex 元素之后插按钮（幂等）。 */
function attachInlineButton(katex: HTMLElement) {
	if (katex.dataset.mathCopyAttached) return;
	katex.dataset.mathCopyAttached = "1";
	const button = document.createElement("button");
	button.type = "button";
	button.dataset.mathCopyBtn = "";
	button.title = t("copy.formula");
	button.setAttribute("aria-label", t("copy.formula"));
	button.className = INLINE_BUTTON_CLASS;
	button.innerHTML = COPY_SVG;
	attachCopyHandlers(button, katex);
	katex.insertAdjacentElement("afterend", button);
}

/** 为 root 及其后代补齐公式按钮（幂等）：块级进容器，行内进文本流。 */
function ensureFormulaButtons(root: Element) {
	// 行内公式：所有 .katex 中不在 .math-display 容器内的（块级已由容器统一处理）
	for (const el of root.querySelectorAll(".katex")) {
		if (!el.closest(".math-display")) attachInlineButton(el as HTMLElement);
	}
	if (root.classList.contains("katex") && !root.closest(".math-display")) {
		attachInlineButton(root as HTMLElement);
	}
	for (const el of root.querySelectorAll(".math-display")) {
		attachBlockButton(el as HTMLElement);
	}
	if (root.classList.contains("math-display")) attachBlockButton(root as HTMLElement);
}

function initFormulaButtons() {
	if (listenersInitialized || !(typeof document !== "undefined")) return;
	listenersInitialized = true;
	// 初始补齐一次（页面已有渲染完成的公式），之后观察流式重渲染增量补齐
	ensureFormulaButtons(document.body);
	const observer = new MutationObserver((mutations) => {
		for (const mutation of mutations) {
			for (const node of mutation.addedNodes) {
				if (node instanceof Element) ensureFormulaButtons(node);
			}
		}
	});
	observer.observe(document.body, { childList: true, subtree: true });
}

/** 公式复制层：挂在 MarkdownStream 内，不渲染任何 DOM。
 * 按钮全部为 DOM 直插（非 React），随 KaTeX 元素生命周期自动销毁/重建。 */
export function FormulaCopyLayer() {
	useEffect(() => {
		initFormulaButtons();
	}, []);
	return null;
}
