/**
 * 全局通知（#115 U5 收尾）：统一走 sonner（shadcn 官方 toast）。
 * 保留 showNotice(message, duration, kind) 旧 API，调用点零改动；
 * kind 映射 sonner 的 error/warning/info 变体。
 *
 * Toaster 未挂载（App 尚未启动 / 渲染树崩溃）时回退到 DOM toast，
 * 保证全局错误处理仍能给用户可见反馈。
 */

import { toast } from "sonner";

type NoticeData = {
	message: string;
	duration: number;
	kind?: "info" | "error" | "warning";
};

let fallbackHost: HTMLDivElement | null = null;

function ensureFallbackHost() {
	if (fallbackHost && document.body.contains(fallbackHost)) return fallbackHost;
	const host = document.createElement("div");
	host.id = "app-notice-fallback-host";
	host.setAttribute("aria-live", "polite");
	host.style.cssText = [
		"position:fixed",
		"left:50%",
		"bottom:28px",
		"transform:translateX(-50%)",
		"z-index:2147483000",
		"display:flex",
		"flex-direction:column",
		"gap:8px",
		"pointer-events:none",
		"max-width:min(520px, calc(100vw - 32px))",
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
	const accent =
		kind === "error" ? "#ef4444" : kind === "warning" ? "#ca8a04" : "#18181b";
	item.style.cssText = [
		"pointer-events:auto",
		"padding:10px 14px",
		"border-radius:8px",
		"background:rgba(17,19,21,0.92)",
		"color:#f3f4f6",
		"box-shadow:0 10px 30px rgba(0,0,0,0.28)",
		"border-left:3px solid " + accent,
		"font:500 13px/1.4 system-ui,-apple-system,Segoe UI,sans-serif",
		"word-break:break-word",
	].join(";");
	item.textContent = message;
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
 * sonner 的 toast() 在 Toaster 未挂载时静默丢弃。
 * 通过 DOM 探测 Toaster 是否已挂载，未挂载走兜底，避免启动早期通知丢失。
 */
function toasterMounted() {
	return Boolean(document.querySelector("[data-sonner-toaster]"));
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
