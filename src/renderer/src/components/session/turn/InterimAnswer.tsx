import { memo } from "react";
import { MarkdownStream } from "../MarkdownStream";

/** 与 TimelineFormat 同逻辑的内联副本（本文件被 node 测试断言，保持零外部运行时依赖）。 */
const ANSI_RE = /\x1b\[[0-9;]*[a-zA-Z]/g;

function stripAnsi(text: string): string {
	return text.replace(ANSI_RE, "");
}

function stripThinkingTags(text: string): string {
	return text.replace(/<thinking>[\s\S]*?<\/thinking>/gi, "").trim();
}

/**
 * 中间回答：与思考（ThinkingBlock）相同的 markdown 渲染路径
 * （MarkdownStream + markdown-body 容器）。
 *
 * 视觉归属：execution-interim（左缩进 + 次级色调），属于「执行过程」折叠内容——
 * 展开时可见、折叠时隐藏；外面（常驻主色调）只留给最终回答。
 */
export const InterimAnswer = memo(function InterimAnswer(props: {
	text: string;
	hidden?: boolean;
	isStreaming?: boolean;
	onOpenExternal: (url: string) => void;
	onOpenFile?: (path: string) => void;
}) {
	const cleanText = stripThinkingTags(stripAnsi(props.text));
	if (!cleanText.trim()) return null;
	return (
		<div
			className="execution-interim markdown-body"
			style={{ display: props.hidden ? "none" : undefined }}
		>
			<MarkdownStream
				text={cleanText}
				isStreaming={props.isStreaming ?? false}
				onOpenExternal={props.onOpenExternal}
				onOpenFile={props.onOpenFile}
			/>
		</div>
	);
});
