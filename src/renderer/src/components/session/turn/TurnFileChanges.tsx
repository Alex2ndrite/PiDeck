import { memo, useMemo, useState } from "react";
import { ChevronDown, ChevronUp, ExternalLink, Files } from "lucide-react";
import { t } from "../../../i18n";
import { Button } from "../../ui-shadcn/button";
import { FileDiff } from "../../agents/file-diff";
import { collectRunFileChanges, fileChangeToDiffLines } from "../TimelineFormat";
import type { AgentRunItem } from "../timeline/types";
import type { DiffFileHandler } from "../ToolCallComponents";

/** 默认折叠阈值：文件数超过该值时只展示前 N 个，其余由「展开」按钮控制 */
const COLLAPSED_LIMIT = 3;

/**
 * 一轮 agent-run 底部固定的「本轮文件修改」列表：
 * - 数据来自 run.items 内的 write/edit/create/patch 工具调用，run 完成后不再变化
 *   （TurnRow 的 memo 深度比较保证历史 run 不重渲染，因此该列表固定显示、不会被后续消息清除）；
 * - 每行一个 beUI FileDiff：点击行展开内联语法高亮 diff，complete 后自动收起；
 * - 行尾按钮在右侧差异查看器中打开（复用工具卡片 diff 链路）；
 * - 文件数超过 COLLAPSED_LIMIT 时默认折叠（长列表会撑高整个 turn，阅读体验差）。
 */
export const TurnFileChanges = memo(function TurnFileChanges(props: {
	run: AgentRunItem;
	/** 流式中：FileDiff 呈现 streaming 态（转圈 + 跟随滚动），完成后自动收起 */
	streaming?: boolean;
	onDiffFile?: DiffFileHandler;
}) {
	const files = useMemo(() => collectRunFileChanges(props.run), [props.run]);
	const [expanded, setExpanded] = useState(false);
	if (files.length === 0) return null;
	// 折叠态只渲染前 N 个；按钮显隐由 exceedsLimit 决定（展开后仍需能收起），
	// hiddenCount 仅驱动「展开其余 N 个」文案
	const exceedsLimit = files.length > COLLAPSED_LIMIT;
	const visibleFiles = expanded || !exceedsLimit ? files : files.slice(0, COLLAPSED_LIMIT);
	const hiddenCount = files.length - visibleFiles.length;
	return (
		<div className="turn-file-changes w-full min-w-0">
			<div className="mb-1.5 flex items-center gap-1.5 text-micro font-medium uppercase tracking-wider text-muted-foreground/60">
				<Files size={12} aria-hidden="true" className="shrink-0" />
				<span>{t("session.turnFileChangesTitle")}</span>
			</div>
			<div className="flex flex-col gap-0.5">
				{visibleFiles.map((entry) => (
					<div key={entry.path} className="flex items-center gap-1">
						<FileDiff
							className="min-w-0 flex-1"
							// 同文件多次修改时在路径后附次数（truncate 由 FileDiff 内部处理）
							file={`${entry.path}${entry.count > 1 ? ` ×${entry.count}` : ""}`}
							lines={fileChangeToDiffLines(entry)}
							status={props.streaming ? "streaming" : "complete"}
							defaultOpen={false}
							maxHeight={200}
							language="diff"
						/>
						<Button
							type="button"
							variant="ghost"
							size="icon-sm"
							className="size-7 shrink-0 rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground"
							title={t("session.openInDiffViewer", { path: entry.path })}
							onClick={() =>
								props.onDiffFile?.(
									entry.path,
									entry.originalContent,
									entry.content,
								)
							}
						>
							<ExternalLink size={13} />
						</Button>
					</div>
				))}
				{exceedsLimit && (
					<Button
						type="button"
						variant="ghost"
						size="sm"
						className="mt-0.5 h-6 justify-start gap-1 self-start rounded-md px-2 text-micro font-medium text-muted-foreground hover:bg-muted/60 hover:text-foreground"
						onClick={() => setExpanded((v) => !v)}
					>
						{expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
						{expanded
							? t("common.collapse")
							: t("session.turnFileChangesShowMore", { count: hiddenCount })}
					</Button>
				)}
			</div>
		</div>
	);
});
