import { memo } from "react";
import { AnswerOutput } from "../AnswerOutput";

/**
 * 中间回答：执行过程折叠区内的阶段性正文。
 *
 * - live：订阅独立流式通道（AnswerOutput），History 骨架可为空
 * - settled：渲染 message.text 的全量 Markdown
 */
export const InterimAnswer = memo(function InterimAnswer(props: {
	/** live 时读 streamingTextByIdAtom；settled 时用 text */
	mode?: "live" | "settled";
	sessionId?: string;
	text?: string;
	hidden?: boolean;
	isStreaming?: boolean;
	onOpenExternal: (url: string) => void;
	onOpenFile?: (path: string) => void;
}) {
	const mode = props.mode ?? "settled";
	return (
		<AnswerOutput
			mode={mode}
			sessionId={props.sessionId}
			text={props.text}
			hidden={props.hidden}
			isStreaming={props.isStreaming}
			onOpenExternal={props.onOpenExternal}
			onOpenFile={props.onOpenFile}
		/>
	);
});
