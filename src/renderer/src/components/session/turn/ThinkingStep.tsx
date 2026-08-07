import { memo } from "react";
import { ThinkingBlock } from "../TimelineEventCards";
import type { ThinkingGroupItem } from "../timeline/types";

/**
 * 思考步骤（单步形态，原位穿插）。
 *
 * hidden 用 CSS display:none 而非卸载：保持 DOM 稳定、保留内部状态，
 * 后续做折叠/展开动画时可直接加 transition。
 */
export const ThinkingStep = memo(function ThinkingStep(props: {
	group: ThinkingGroupItem;
	hidden: boolean;
	isStreaming?: boolean;
	showThinking?: boolean;
	onOpenExternal: (url: string) => void;
	onOpenFile?: (path: string) => void;
}) {
	return (
		<div style={{ display: props.hidden ? "none" : undefined }}>
			<ThinkingBlock
				text={props.group.text}
				startedAt={props.group.startedAt}
				endedAt={props.group.endedAt}
				showThinking={props.showThinking}
				isStreaming={props.isStreaming}
				// 执行过程折叠详情里思考以「单步」呈现（标题+折叠预览），
				// 与工具卡片同为 Chain of Thought 步骤，不默认摊开 markdown。
				defaultExpanded={false}
				onOpenExternal={props.onOpenExternal}
				onOpenFile={props.onOpenFile}
			/>
		</div>
	);
});
