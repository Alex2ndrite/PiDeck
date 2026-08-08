import { memo } from "react";
import { useAtomValue } from "jotai";
import { streamingTextByIdAtom } from "../../atoms/session-atoms";
import { MarkdownStream } from "./MarkdownStream";

/** 与 TimelineFormat 同逻辑的内联副本（node 单测可直接加载，零外部依赖）。 */
const ANSI_RE = /\x1b\[[0-9;]*[a-zA-Z]/g;

function stripAnsi(text: string): string {
	return text.replace(ANSI_RE, "");
}

function stripThinkingTags(text: string): string {
	return text.replace(/<thinking>[\s\S]*?<\/thinking>/gi, "").trim();
}

/**
 * 助手正文唯一输出入口。
 *
 * - live：读 streamingTextByIdAtom，MarkdownStream 轻量渲染（与思考同构，
 *   打字机/超长纯文本兜底都在 MarkdownStream 内部）
 * - settled：原文一次交给全量 Streamdown（高亮/mermaid/math）
 *
 * 视觉容器仍用 execution-interim.markdown-body，兼容 typewriter E2E 选择器。
 */
export const AnswerOutput = memo(function AnswerOutput(props: {
	mode: "live" | "settled";
	/** live 模式：订阅该 session 的独立正文通道 */
	sessionId?: string;
	/** settled 模式：History 消息正文 */
	text?: string;
	hidden?: boolean;
	isStreaming?: boolean;
	/** live→settled 交接时播放一次淡入（assistant-answer-settle） */
	settle?: boolean;
	onOpenExternal: (url: string) => void;
	onOpenFile?: (path: string) => void;
}) {
	if (props.mode === "live") {
		return (
			<LiveAnswerBody
				sessionId={props.sessionId ?? ""}
				hidden={props.hidden}
				isStreaming={props.isStreaming}
				onOpenExternal={props.onOpenExternal}
				onOpenFile={props.onOpenFile}
			/>
		);
	}
	const cleanText = stripThinkingTags(stripAnsi(props.text ?? ""));
	if (!cleanText.trim()) return null;
	return (
		<div
			className="execution-interim markdown-body"
			data-is-streaming="0"
			data-settle={props.settle ? "1" : undefined}
			style={{ display: props.hidden ? "none" : undefined }}
		>
			<MarkdownStream
				text={cleanText}
				isStreaming={false}
				onOpenExternal={props.onOpenExternal}
				onOpenFile={props.onOpenFile}
			/>
		</div>
	);
});

/**
 * Live 正文：atom → MarkdownStream（打字机在 MarkdownStream 内部，
 * 不再自持打字机，避免双重逐字；流式轻量渲染与思考同构）。
 */
const LiveAnswerBody = memo(function LiveAnswerBody(props: {
	sessionId: string;
	hidden?: boolean;
	isStreaming?: boolean;
	onOpenExternal: (url: string) => void;
	onOpenFile?: (path: string) => void;
}) {
	const streaming = useAtomValue(streamingTextByIdAtom);
	const entry = props.sessionId ? streaming[props.sessionId] : undefined;
	const sourceText = entry?.content ?? "";
	const text = stripThinkingTags(stripAnsi(sourceText));
	return (
		<div
			className="execution-interim markdown-body"
			data-is-streaming={props.isStreaming ? "1" : "0"}
			style={{ display: props.hidden ? "none" : undefined }}
		>
			<MarkdownStream
				text={text}
				isStreaming={Boolean(props.isStreaming)}
				onOpenExternal={props.onOpenExternal}
				onOpenFile={props.onOpenFile}
			/>
		</div>
	);
});
