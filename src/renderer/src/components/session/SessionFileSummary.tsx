import { memo, useMemo, useState } from "react";
import { ChevronDown, FileCode2 } from "lucide-react";
import { t } from "../../i18n";
import type { ChatMessage } from "../../../../shared/types";
import { collectSessionFileChanges } from "./TimelineFormat";

/** 与 ToolCallComponents 一致的 diff 回调签名（path + 新旧内容） */
export type DiffFileHandler = (
	path: string,
	originalContent?: string,
	content?: string,
) => void;

type FileChangeEntry = {
	path: string;
	count: number;
	originalContent: string;
	content: string;
};

/**
 * 会话文件修改汇总：会话空闲时显示本轮修改过的文件列表，
 * 点击文件/DIFF 按钮直接打开差异查看器。
 */
export const SessionFileSummary = memo(function SessionFileSummary(props: {
	messages: ChatMessage[];
	onDiffFile?: DiffFileHandler;
}) {
	const files = useMemo<FileChangeEntry[]>(
		() => collectSessionFileChanges(props.messages),
		[props.messages],
	);

	const [collapsed, setCollapsed] = useState(false);
	if (files.length === 0) return null;
	const totalTimes = files.reduce((sum, f) => sum + f.count, 0);

	return (
		<section className="session-file-summary my-2 w-full min-w-0 overflow-hidden rounded-md border border-border-subtle bg-bg-panel">
			{/* 汇总头：点击折叠/展开 */}
			<button
				type="button"
				className="flex min-h-8 w-full cursor-pointer items-center gap-2 border-0 bg-transparent p-1.5 pl-2.5 text-left text-control leading-5 text-text-secondary hover:bg-[color:color-mix(in_srgb,var(--color-bg-hover)_55%,var(--color-bg-panel))] focus-visible:-outline-offset-2 focus-visible:outline-2"
				onClick={() => setCollapsed((v) => !v)}
				aria-expanded={!collapsed}
			>
				<span className="inline-flex shrink-0 items-center justify-center text-[var(--color-accent)]">
					<FileCode2 size={15} />
				</span>
				<span className="shrink-0 text-body font-[650] text-text-primary">
					{t("session.fileSummaryTitle")}
				</span>
				<span className="inline-flex items-center gap-[5px] font-mono text-micro tabular-nums text-text-tertiary">
					{t("session.fileSummaryCount", {
						count: files.length,
						times: totalTimes,
					})}
				</span>
				<ChevronDown
					size={14}
					className={`ml-auto shrink-0 text-text-tertiary transition-transform duration-150${collapsed ? "" : " rotate-180"}`}
				/>
			</button>
			{!collapsed && (
				<ul className="max-h-[240px] overflow-y-auto border-t border-border-subtle">
					{files.map((file) => (
						<li
							key={file.path}
							className="flex min-h-8 items-center gap-2 border-b border-border-subtle px-2.5 py-1 text-caption last:border-b-0 hover:bg-[color:color-mix(in_srgb,var(--color-bg-hover)_55%,var(--color-bg-panel))]"
						>
							<button
								type="button"
								className="min-w-0 flex-1 cursor-pointer truncate text-left font-mono text-[12px] text-text-secondary hover:text-[var(--color-accent)] focus-visible:shadow-[var(--focus-ring)] focus-visible:outline-none"
								title={file.path}
								onClick={() =>
									props.onDiffFile?.(
										file.path,
										file.originalContent,
										file.content,
									)
								}
							>
								{file.path}
							</button>
							{file.count > 1 && (
								<span className="shrink-0 font-mono text-micro tabular-nums text-text-tertiary">
									×{file.count}
								</span>
							)}
							<button
								type="button"
								className="inline-flex h-[22px] shrink-0 cursor-pointer items-center self-center rounded-sm border border-[color:color-mix(in_srgb,var(--color-accent)_24%,var(--color-border-subtle))] bg-transparent px-2 font-mono text-micro leading-none text-[color:color-mix(in_srgb,var(--color-accent)_80%,var(--color-text-tertiary))] transition-[background-color,border-color,color] duration-150 hover:border-[var(--color-accent)] hover:bg-[color:color-mix(in_srgb,var(--color-accent)_6%,transparent)] hover:text-[var(--color-accent)] focus-visible:shadow-[var(--focus-ring)] focus-visible:outline-none"
								title={`${t("tool.viewDiff")} · ${file.path}`}
								onClick={() =>
									props.onDiffFile?.(
										file.path,
										file.originalContent,
										file.content,
									)
								}
							>
								{t("tool.diff")}
							</button>
						</li>
					))}
				</ul>
			)}
		</section>
	);
});
