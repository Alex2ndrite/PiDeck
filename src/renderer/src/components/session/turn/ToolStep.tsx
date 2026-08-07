import { memo } from "react";
import { ToolGroupCard } from "../ToolCallComponents";
import type { ToolGroupItem } from "../timeline/types";

/**
 * 工具步骤（原位穿插，受 run 级折叠开关控制显隐）。
 * 与 ThinkingStep 一致，用 CSS display:none 隐藏以保留 DOM/内部状态。
 */
export const ToolStep = memo(function ToolStep(props: {
	group: ToolGroupItem;
	hidden: boolean;
}) {
	return (
		<div style={{ display: props.hidden ? "none" : undefined }}>
			<ToolGroupCard group={props.group} />
		</div>
	);
});
