import { memo, useMemo } from "react";
import { MultiFileDiff, type FileContents } from "@pierre/diffs/react";
import { t } from "../../i18n";

/**
 * 文件差异对比视图（只读）：基于 @pierre/diffs 的 MultiFileDiff 渲染，
 * 支持分栏 / 单栏两种布局。
 *
 * 视觉约定（GitHub 风格）：
 * - 行级背景一层颜色：添加=绿（--color-success-soft）、删除=红（--color-danger-soft）
 * - 行号列跟随变更着色（浅底 + 语义色数字）
 * - 变更指示 = 分栏中缝的红/绿竖条（diffIndicators: bars），无 +/- 字符
 * - 折叠区 = hunk 分隔条（hunkSeparators: line-info），GitHub 式 @@ 行号信息
 * - 行内 diff 不标注（lineDiffType: none），保持干净
 *
 * 大文件保护：任一侧超过 MAX_DIFF_LINES 行不计算 diff（Myers O(N*D) + Shiki
 * 高亮会阻塞主线程），降级为纯文本提示。
 */

/** 单侧超过此行数的文件不计算 diff */
const MAX_DIFF_LINES = 5_000;

export type CodeDiffViewMode = "split" | "unified";

export const CodeDiffView = memo(function CodeDiffView(props: {
	oldContent: string;
	newContent: string;
	filePath: string;
	viewMode: CodeDiffViewMode;
	theme?: "light" | "dark";
}) {
	const theme = props.theme ?? (typeof document !== "undefined"
		? (document.documentElement.dataset.theme === "dark" ? "dark" : "light")
		: "light");

	const oldLines = useMemo(() => countLines(props.oldContent), [props.oldContent]);
	const newLines = useMemo(() => countLines(props.newContent), [props.newContent]);
	const tooLarge = oldLines > MAX_DIFF_LINES || newLines > MAX_DIFF_LINES;

	const oldFile: FileContents = useMemo(() => ({
		name: props.filePath,
		contents: props.oldContent,
	}), [props.filePath, props.oldContent]);

	const newFile: FileContents = useMemo(() => ({
		name: props.filePath,
		contents: props.newContent,
	}), [props.filePath, props.newContent]);

	const options = useMemo(() => ({
		diffStyle: props.viewMode,
		theme: { dark: "one-dark-pro" as const, light: "one-light" as const },
		disableFileHeader: true,
		diffIndicators: "bars" as const,
		hunkSeparators: "line-info" as const,
		lineDiffType: "none" as const,
		overflow: "scroll" as const,
		themeType: theme as "light" | "dark" | "system",
		// 颜色全部引用应用 token（明暗随 data-theme 自动切换），不写死色值
		unsafeCSS: `
			:root, :host {
				--diffs-bg: transparent;
				--diffs-addition-base: var(--color-success);
				--diffs-deletion-base: var(--color-danger);
				--diffs-addition-bg: var(--color-success-soft);
				--diffs-deletion-bg: var(--color-danger-soft);
				--diffs-separator-bg: var(--color-bg-panel);
				--diffs-gap-style: 3px solid var(--color-border-subtle);
				--diffs-scrollbar-thumb: color-mix(in srgb, var(--color-border-strong) 70%, transparent);
				--diffs-scrollbar-thumb-hover: var(--color-text-tertiary);
			}
			[data-line-type="change-addition"] {
				background-color: var(--diffs-addition-bg) !important;
			}
			[data-line-type="change-deletion"] {
				background-color: var(--diffs-deletion-bg) !important;
			}
			[data-line-type="change-addition"] [data-column-number],
			[data-line-type="change-addition"] [data-gutter-buffer]:not([data-gutter-buffer="buffer"]) {
				color: var(--diffs-addition-base) !important;
				background-color: var(--diffs-addition-bg) !important;
			}
			[data-line-type="change-deletion"] [data-column-number],
			[data-line-type="change-deletion"] [data-gutter-buffer]:not([data-gutter-buffer="buffer"]) {
				color: var(--diffs-deletion-base) !important;
				background-color: var(--diffs-deletion-bg) !important;
			}
			[data-gutter-buffer="buffer"] {
				background: none !important;
			}
			[data-line-type="context"] [data-column-number],
			[data-line-type="metadata"] [data-column-number],
			[data-line-type="expanded"] [data-column-number],
			[data-gutter] {
				background-color: var(--color-bg-panel) !important;
			}
		`,
	}), [props.viewMode, theme]);

	if (tooLarge) {
		return (
			<div className="flex h-full items-center justify-center overflow-auto bg-[var(--color-bg-panel)]">
				<div className="px-4 text-center text-[var(--color-text-secondary)]">
					<p className="mb-1 text-[13px] font-medium">{t("editor.diffTooLarge")}</p>
					<p className="text-[12px]">
						{t("editor.diffTooLargeDetail", {
							old: oldLines.toLocaleString(),
							new: newLines.toLocaleString(),
						})}
					</p>
				</div>
			</div>
		);
	}

	return (
		<div className="code-diff-view h-full overflow-auto bg-[var(--color-bg-panel)]">
			<MultiFileDiff oldFile={oldFile} newFile={newFile} options={options} className="h-full" />
		</div>
	);
});

function countLines(content: string): number {
	if (!content) return 0;
	let count = 1;
	for (let i = 0; i < content.length; i++) {
		if (content[i] === "\n") count++;
	}
	return count;
}
