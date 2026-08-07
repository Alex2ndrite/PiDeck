import { memo } from "react";
import { useAtomValue } from "jotai";
import { streamingTextByIdAtom } from "../../../atoms/session-atoms";
import { MarkdownStream } from "../MarkdownStream";

/**
 * 流式正文气泡（阶段2：独立流式通道消费）。
 *
 * 订阅 streamingTextByIdAtom（agents:text-stream 独立通道，16ms 节流），
 * 只渲染当前 session 的流式正文，替代 TurnRow 里「最后一条 assistant 消息
 * 随 messages 数组增长」的渲染路径。历史 run 靠阶段0引用稳定跳过重渲染。
 *
 * 视觉：与 InterimAnswer 相同的 execution-interim 缩进样式（流式中最后一条
 * 归中间回答，收在折叠栏内）；MarkdownStream 流式轻渲染（跳过 code/mermaid）。
 */
export const StreamingAnswerBubble = memo(function StreamingAnswerBubble(props: {
	sessionId: string;
	hidden?: boolean;
	isStreaming?: boolean;
	onOpenExternal: (url: string) => void;
	onOpenFile?: (path: string) => void;
}) {
	const streaming = useAtomValue(streamingTextByIdAtom);
	const entry = props.sessionId ? streaming[props.sessionId] : undefined;
	const text = entry?.content ?? "";
	if (!text.trim()) return null;
	return (
		<div
			className="execution-interim markdown-body"
			style={{ display: props.hidden ? "none" : undefined }}
		>
			<MarkdownStream
				text={text}
				isStreaming={props.isStreaming ?? false}
				onOpenExternal={props.onOpenExternal}
				onOpenFile={props.onOpenFile}
			/>
		</div>
	);
});
