import { memo } from "react";
import type { ChatMessage, ImageContent } from "../../../../../shared/types";
import { AssistantText } from "../SurfaceComponents";

/**
 * 回答文本段（中间回答/最终回答共用）。
 * 纯展示，受 run 级折叠开关控制显隐（中间回答折叠、最终回答常驻由调用方决定）。
 */
export const AnswerText = memo(function AnswerText(props: {
	message: ChatMessage;
	images?: ImageContent[];
	isStreaming?: boolean;
	hidden?: boolean;
	onPreviewImage: (image: ImageContent) => void;
	onOpenExternal: (url: string) => void;
	onOpenFile?: (path: string) => void;
}) {
	return (
		<div style={{ display: props.hidden ? "none" : undefined }} className="timeline-inline-text">
			<AssistantText
				text={props.message.text}
				images={props.images}
				onPreviewImage={props.onPreviewImage}
				onOpenExternal={props.onOpenExternal}
				onOpenFile={props.onOpenFile}
				isStreaming={props.isStreaming ?? false}
			/>
		</div>
	);
});
