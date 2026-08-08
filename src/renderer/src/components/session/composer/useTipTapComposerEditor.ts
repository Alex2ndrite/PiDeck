/**
 * TipTap Composer 编辑器生命周期：创建、受控同步、DOM 注册。
 * 视图层（TipTapComposer）只负责挂载 EditorContent。
 */

import {
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	type RefObject,
} from "react";
import { useEditor, type Editor } from "@tiptap/react";
import type { ComposerEditorProps } from "./types";
import { createComposerExtensions } from "./tiptap/createComposerExtensions";
import { buildComposerEditorProps } from "./tiptap/buildComposerEditorProps";
import {
	plainTextToComposerDoc,
	serializeComposerEditorJson,
} from "./tiptap/plainTextCodec";
import {
	plainOffsetToPos,
	posToPlainOffset,
	registerComposerTipTapEditor,
} from "./tiptap/caretBridge";

export type UseTipTapComposerEditorArgs = Pick<
	ComposerEditorProps,
	| "value"
	| "onChange"
	| "onCursorChange"
	| "onKeyDown"
	| "onPaste"
	| "onDrop"
	| "onDragOver"
	| "onChipClick"
	| "disabled"
	| "placeholder"
	| "className"
	| "caretRef"
	| "validCommandNames"
	| "validFilePaths"
	| "validSessionRefs"
> & {
	hostRef: RefObject<HTMLDivElement | null>;
};

function syncEmptyClass(editor: Editor): void {
	editor.view.dom.classList.toggle("is-editor-empty", editor.isEmpty);
}

export function useTipTapComposerEditor(
	args: UseTipTapComposerEditorArgs,
): Editor | null {
	const {
		value,
		onChange,
		onCursorChange,
		onKeyDown,
		onPaste,
		onDrop,
		onDragOver,
		onChipClick,
		disabled,
		placeholder,
		className,
		caretRef,
		validCommandNames,
		validFilePaths,
		validSessionRefs,
		hostRef,
	} = args;

	const whitelist = useMemo(
		() => ({ validCommandNames, validFilePaths, validSessionRefs }),
		[validCommandNames, validFilePaths, validSessionRefs],
	);
	const whitelistRef = useRef(whitelist);
	whitelistRef.current = whitelist;

	const onChangeRef = useRef(onChange);
	onChangeRef.current = onChange;
	const onCursorChangeRef = useRef(onCursorChange);
	onCursorChangeRef.current = onCursorChange;
	const onKeyDownRef = useRef(onKeyDown);
	onKeyDownRef.current = onKeyDown;
	const onPasteRef = useRef(onPaste);
	onPasteRef.current = onPaste;
	const onDropRef = useRef(onDrop);
	onDropRef.current = onDrop;
	const onDragOverRef = useRef(onDragOver);
	onDragOverRef.current = onDragOver;
	const onChipClickRef = useRef(onChipClick);
	onChipClickRef.current = onChipClick;

	const composingRef = useRef(false);
	/** 最近一次由编辑器 onUpdate 推给父层的纯文本；用于区分「父层滞后」与「外部改草稿」。 */
	const lastEmittedRef = useRef(value);

	const emitPlainText = (editor: Editor) => {
		const next = serializeComposerEditorJson(editor.getJSON());
		lastEmittedRef.current = next;
		onChangeRef.current(next, posToPlainOffset(editor, editor.state.selection.from));
	};

	const editor = useEditor({
		immediatelyRender: false,
		editable: !disabled,
		extensions: createComposerExtensions(),
		content: plainTextToComposerDoc(value, whitelist),
		editorProps: buildComposerEditorProps(
			{
				composingRef,
				onKeyDown: (event) => {
					onKeyDownRef.current?.(
						event as unknown as React.KeyboardEvent<HTMLDivElement>,
					);
				},
				onPaste: (event) => {
					onPasteRef.current?.(
						event as unknown as React.ClipboardEvent<HTMLDivElement>,
					);
				},
				onDrop: (event) => {
					onDropRef.current?.(
						event as unknown as React.DragEvent<HTMLDivElement>,
					);
				},
				onDragOver: (event) => {
					onDragOverRef.current?.(
						event as unknown as React.DragEvent<HTMLDivElement>,
					);
				},
				onChipClick: (chip) => onChipClickRef.current?.(chip),
			},
			{ className, placeholder, disabled },
		),
		onUpdate: ({ editor: ed }) => {
			syncEmptyClass(ed);
			if (composingRef.current) return;
			emitPlainText(ed);
		},
		onSelectionUpdate: ({ editor: ed }) => {
			if (composingRef.current) return;
			onCursorChangeRef.current(posToPlainOffset(ed, ed.state.selection.from));
		},
		onCreate: ({ editor: ed }) => {
			syncEmptyClass(ed);
		},
	});

	useEffect(() => {
		const dom = editor?.view?.dom as HTMLElement | undefined;
		if (!dom || !editor) return;
		registerComposerTipTapEditor(dom, editor);
		const host = hostRef.current;
		if (host) registerComposerTipTapEditor(host, editor);
		return () => {
			registerComposerTipTapEditor(dom, null);
			if (host) registerComposerTipTapEditor(host, null);
		};
	}, [editor, hostRef]);

	useEffect(() => {
		if (!editor || editor.isDestroyed) return;
		editor.setEditable(!disabled);
		editor.setOptions({
			editorProps: buildComposerEditorProps(
				{
					composingRef,
					onKeyDown: (event) => {
						onKeyDownRef.current?.(
							event as unknown as React.KeyboardEvent<HTMLDivElement>,
						);
					},
					onPaste: (event) => {
						onPasteRef.current?.(
							event as unknown as React.ClipboardEvent<HTMLDivElement>,
						);
					},
					onDrop: (event) => {
						onDropRef.current?.(
							event as unknown as React.DragEvent<HTMLDivElement>,
						);
					},
					onDragOver: (event) => {
						onDragOverRef.current?.(
							event as unknown as React.DragEvent<HTMLDivElement>,
						);
					},
					onChipClick: (chip) => onChipClickRef.current?.(chip),
				},
				{ className, placeholder, disabled },
			),
		});
	}, [editor, disabled, className, placeholder]);

	// composition 结束后补一次同步：合成期间 onUpdate 被跳过，避免草稿 atom 一直为空导致无法发送。
	useEffect(() => {
		if (!editor) return;
		const dom = editor.view.dom;
		const onCompositionEnd = () => {
			composingRef.current = false;
			requestAnimationFrame(() => {
				if (composingRef.current || editor.isDestroyed) return;
				syncEmptyClass(editor);
				emitPlainText(editor);
			});
		};
		dom.addEventListener("compositionend", onCompositionEnd);
		return () => dom.removeEventListener("compositionend", onCompositionEnd);
	}, [editor]);

	/**
	 * 受控同步：只在父层 value 与「我们上次发出的文本」不一致时写回编辑器。
	 * 禁止用 editorText !== value 当条件——打字后父层尚未 re-render 时会把新输入打回旧草稿。
	 * 白名单变化只影响下次 setContent 解析，不作为同步触发依赖。
	 */
	useLayoutEffect(() => {
		if (!editor || editor.isDestroyed) return;
		const caret = caretRef?.current;
		if (value !== lastEmittedRef.current) {
			editor.commands.setContent(plainTextToComposerDoc(value, whitelistRef.current), {
				emitUpdate: false,
			});
			lastEmittedRef.current = value;
			syncEmptyClass(editor);
		}
		if (typeof caret === "number" && caretRef) {
			editor.commands.setTextSelection(
				plainOffsetToPos(editor, Math.min(caret, value.length)),
			);
			caretRef.current = null;
		}
	}, [value, editor, caretRef]);

	return editor;
}
