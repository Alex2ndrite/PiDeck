/**
 * 全局通知（#115 U5 收尾）：统一走 sonner（shadcn 官方 toast）。
 * 保留 showNotice(message, duration, kind) 旧 API，调用点零改动；
 * kind 映射 sonner 的 error/warning/info 变体。
 *
 * Toaster 未挂载（App 尚未启动 / 渲染树崩溃）时回退到 DOM toast，
 * 保证全局错误处理仍能给用户可见反馈。
 */

import { toast } from "sonner";
import { t } from "../i18n";

type NoticeData = {
	message: string;
	duration: number;
	kind?: "info" | "error" | "warning";
};

let fallbackHost: HTMLDivElement | null = null;

// sonner 2.x 在没有可见 toast 时不会渲染任何 DOM（源码里 `if (!filteredToasts.length) return null`），
// 因此不能用 DOM 查询该属性来探测挂载态——那会在每次首个 toast 前都误判为未挂载，
// 导致所有通知永远走黑色 DOM 兜底。挂载状态改由 Toaster 组件挂载时显式回报。
let toasterReady = false;

export function setToasterReady(ready: boolean) {
	toasterReady = ready;
}

function ensureFallbackHost() {
	if (fallbackHost && document.body.contains(fallbackHost)) return fallbackHost;
	const host = document.createElement("div");
	host.id = "app-notice-fallback-host";
	host.setAttribute("aria-live", "polite");
	// 与 sonner 的 top-right 位置保持一致，并让开标题栏拖拽区，避免兑底与正式 toast 位置跳动
	host.style.cssText = [
		"position:fixed",
		"top:calc(var(--window-drag-height, 0px) + 12px)",
		"right:16px",
		"z-index:2147483000",
		"display:flex",
		"flex-direction:column",
		"gap:8px",
		"pointer-events:none",
		"max-width:min(520px, calc(100vw - 32px))",
		"-webkit-app-region:no-drag",
	].join(";");
	document.body.appendChild(host);
	fallbackHost = host;
	return host;
}

/** Toaster 未挂载时的 DOM 兜底 toast，避免全局异常完全静默。 */
function showFallbackNotice(message: string, duration: number, kind: NoticeData["kind"] = "info") {
	if (typeof document === "undefined") return;
	const host = ensureFallbackHost();
	const item = document.createElement("div");
	// 与 sonner 卡片同一套中性面板样式（走 CSS 变量，主题自动适配）；
	// kind 仅保留语义入口，不叠加彩色竖条。
	void kind;
	item.style.cssText = [
		"pointer-events:auto",
		"padding:10px 14px",
		"border-radius:10px",
		"background:var(--color-bg-panel, #ffffff)",
		"color:var(--color-text-primary, #1f2328)",
		"border:1px solid var(--color-border-subtle, rgba(0,0,0,0.08))",
		"box-shadow:var(--shadow-popover, 0 4px 12px rgba(0,0,0,0.12))",
		"font:500 13px/1.4 var(--font-family-base, system-ui,-apple-system,Segoe UI,sans-serif)",
		"word-break:break-word",
	].join(";");
	item.textContent = message;
	// 兑底 toast 没有 sonner 的 closeButton，点击卡片本身即关闭
	item.style.cursor = "pointer";
	item.title = t("common.close");
	item.addEventListener("click", () => item.remove());
	host.appendChild(item);
	window.setTimeout(() => {
		item.remove();
		if (host.childElementCount === 0) {
			host.remove();
			if (fallbackHost === host) fallbackHost = null;
		}
	}, Math.max(1200, duration));
}

/**
 * sonner 的 toast() 在 Toaster 未挂载（启动早期/渲染树崩溃）时静默丢弃，
 * 此时走 DOM 兜底，保证全局异常仍能给用户可见反馈。
 */
function toasterMounted() {
	return toasterReady;
}

export function showNotice(message: string, duration = 3500, kind?: NoticeData["kind"]) {
	const text = String(message ?? "").trim();
	if (!text) return;
	if (!toasterMounted()) {
		showFallbackNotice(text, duration, kind);
		return;
	}
	const options = { duration };
	if (kind === "error") toast.error(text, options);
	else if (kind === "warning") toast.warning(text, options);
	else if (kind === "info") toast.info(text, options);
	else toast(text, options);
}
