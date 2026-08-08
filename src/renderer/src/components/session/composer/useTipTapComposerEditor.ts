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
	const lastEmittedRef = useRef(value);

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
			ed.view.dom.classList.toggle("is-editor-empty", ed.isEmpty);
			if (composingRef.current) return;
			const next = serializeComposerEditorJson(ed.getJSON());
			lastEmittedRef.current = next;
			onChangeRef.current(next, posToPlainOffset(ed, ed.state.selection.from));
		},
		onSelectionUpdate: ({ editor: ed }) => {
			if (composingRef.current) return;
			onCursorChangeRef.current(posToPlainOffset(ed, ed.state.selection.from));
		},
		onCreate: ({ editor: ed }) => {
			ed.view.dom.classList.toggle("is-editor-empty", ed.isEmpty);
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

	useLayoutEffect(() => {
		if (!editor || editor.isDestroyed) return;
		const current = serializeComposerEditorJson(editor.getJSON());
		const caret = caretRef?.current;
		const needsContent = current !== value || lastEmittedRef.current !== value;
		if (needsContent) {
			editor.commands.setContent(plainTextToComposerDoc(value, whitelistRef.current), {
				emitUpdate: false,
			});
			lastEmittedRef.current = value;
			editor.view.dom.classList.toggle("is-editor-empty", editor.isEmpty);
		}
		if (typeof caret === "number" && caretRef) {
			editor.commands.setTextSelection(
				plainOffsetToPos(editor, Math.min(caret, value.length)),
			);
			caretRef.current = null;
		}
	}, [value, editor, caretRef, validCommandNames, validFilePaths, validSessionRefs]);

	return editor;
}
