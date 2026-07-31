import { useSyncExternalStore } from "react";
import { Toaster as SonnerToaster } from "sonner";

/**
 * 全局 Toaster（#115）：sonner 官方组件，主题跟随应用 dataset.theme
 * （应用主题独立于系统主题，不能用 sonner 的 "system" 模式）。
 */

function subscribeTheme(callback: () => void) {
	const observer = new MutationObserver(callback);
	observer.observe(document.documentElement, {
		attributes: true,
		attributeFilter: ["data-theme"],
	});
	return () => observer.disconnect();
}

function getThemeSnapshot(): "light" | "dark" {
	return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

export function Toaster() {
	const theme = useSyncExternalStore(subscribeTheme, getThemeSnapshot);
	return (
		<SonnerToaster
			theme={theme}
			position="bottom-right"
			gap={8}
			toastOptions={{
				style: {
					background: "var(--color-bg-panel)",
					border: "1px solid var(--color-border-subtle)",
					color: "var(--color-text-primary)",
				},
			}}
		/>
	);
}
