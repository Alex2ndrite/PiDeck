import type { AppAccentMode } from "../../shared/types/settings";

/**
 * 主题色预设（UI 主题扩展点）。
 *
 * 扩展自制主题的方式：
 * 1. 在 foundation.css 新增 `:root[data-accent="<id>"]`（及 dark 变体）覆盖
 *    --color-accent/-strong/-soft 与 --color-logo-green* 系列；
 * 2. 在这里的 ACCENT_PRESETS 追加一条（id/label/色值预览）。
 * 两处同步后，设置页「主题色」下拉即自动出现新选项，无需改业务代码。
 */
export type AccentPreset = {
	id: AppAccentMode;
	labelKey: string;
	/** 预览色（设置页色块展示） */
	preview: string;
};

export const ACCENT_PRESETS: readonly AccentPreset[] = [
	{ id: "green", labelKey: "settings.accent.green", preview: "#238636" },
	{ id: "blue", labelKey: "settings.accent.blue", preview: "#2563eb" },
	{ id: "purple", labelKey: "settings.accent.purple", preview: "#7c3aed" },
	{ id: "amber", labelKey: "settings.accent.amber", preview: "#b45309" },
	{ id: "rose", labelKey: "settings.accent.rose", preview: "#e11d48" },
];

export const DEFAULT_ACCENT: AppAccentMode = "green";
