import { memo } from "react";
import { useAtomValue } from "jotai";
import { streamingTextByIdAtom } from "../../atoms/session-atoms";
import { useSmoothStream } from "../../utils/useSmoothStream";
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
 * - live：读 streamingTextByIdAtom，打字机喂轻量 plain DOM（不跑 Streamdown 全量 parse）
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

/** Live 正文：atom → useSmoothStream → plain 文本节点（主线程只做字符串切片）。 */
const LiveAnswerBody = memo(function LiveAnswerBody(props: {
	sessionId: string;
	hidden?: boolean;
	isStreaming?: boolean;
}) {
	const streaming = useAtomValue(streamingTextByIdAtom);
	const entry = props.sessionId ? streaming[props.sessionId] : undefined;
	const sourceText = entry?.content ?? "";
	const { displayedContent } = useSmoothStream({
		content: sourceText,
		isStreaming: Boolean(props.isStreaming),
		minDelay: 16,
	});
	const text = stripThinkingTags(stripAnsi(displayedContent));
	return (
		<div
			className="execution-interim markdown-body whitespace-pre-wrap break-words"
			data-is-streaming={props.isStreaming ? "1" : "0"}
			style={{ display: props.hidden ? "none" : undefined }}
		>
			{text}
		</div>
	);
});
