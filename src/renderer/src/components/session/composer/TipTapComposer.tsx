/**
 * TipTapComposer —— 会话输入框视图壳。
 * 编辑器生命周期见 useTipTapComposerEditor；本文件只做 ref / 焦点壳 / EditorContent。
 */

import { forwardRef, useRef } from "react";
import { EditorContent } from "@tiptap/react";
import type { ComposerEditorProps } from "./types";
import { useTipTapComposerEditor } from "./useTipTapComposerEditor";

export type TipTapComposerProps = ComposerEditorProps;

export const TipTapComposer = forwardRef<HTMLDivElement, TipTapComposerProps>(
	function TipTapComposer(props, ref) {
		const hostRef = useRef<HTMLDivElement | null>(null);
		const setHostRef = (node: HTMLDivElement | null) => {
			hostRef.current = node;
			if (typeof ref === "function") ref(node);
			else if (ref) ref.current = node;
		};

		const editor = useTipTapComposerEditor({
			...props,
			hostRef,
		});

		return (
			<div
				ref={setHostRef}
				// overflow-hidden：把滚动关进 ProseMirror；否则 EditorContent 中间层
				// 不传高度约束时，内容会直接撑出 composer-box。
				className="tiptap-composer-host flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
				data-placeholder={props.placeholder}
				onFocus={props.onFocus}
				onBlur={props.onBlur}
			>
				<EditorContent
					editor={editor}
					className="tiptap-composer-surface flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
				/>
			</div>
		);
	},
);
