/**
 * TipTap editorProps：把上层 Composer 回调桥成 ProseMirror DOM 事件。
 * 与 React 组件生命周期解耦，便于单测与复用。
 */

import type { EditorProps } from "@tiptap/pm/view";
import type { ComposerChip } from "../chips";
import { toComposerDomKeyboardEvent } from "./domEventBridge";

export type ComposerEditorDomHandlers = {
	composingRef: { current: boolean };
	onKeyDown?: (event: KeyboardEvent) => void;
	onPaste?: (event: ClipboardEvent) => void;
	onDrop?: (event: DragEvent) => void;
	onDragOver?: (event: DragEvent) => void;
	onChipClick?: (chip: ComposerChip) => void;
};

function readChipFromDom(chipEl: HTMLElement): ComposerChip | null {
	const raw = chipEl.getAttribute("data-raw") ?? "";
	const kind = chipEl.getAttribute("data-type");
	if (kind !== "file" && kind !== "skill" && kind !== "session") return null;
	const label =
		chipEl.querySelector(".input-chip__label")?.textContent?.trim() || raw.slice(1);
	return { start: 0, end: raw.length, raw, kind, label };
}

export function buildComposerEditorProps(
	handlers: ComposerEditorDomHandlers,
	options: {
		className?: string;
		placeholder?: string;
		disabled?: boolean;
	},
): EditorProps {
	return {
		attributes: {
			class: ["rich-input", "ProseMirror", options.className].filter(Boolean).join(" "),
			role: "textbox",
			"aria-multiline": "true",
			...(options.placeholder ? { "data-placeholder": options.placeholder } : {}),
			...(options.disabled ? { "aria-disabled": "true" } : {}),
		},
		handleKeyDown: (_view, event) => {
			handlers.onKeyDown?.(toComposerDomKeyboardEvent(event));
			return event.defaultPrevented;
		},
		handlePaste: (_view, event) => {
			if (!handlers.onPaste) return false;
			handlers.onPaste(event);
			return event.defaultPrevented;
		},
		handleDOMEvents: {
			compositionstart: () => {
				handlers.composingRef.current = true;
				return false;
			},
			compositionend: () => {
				handlers.composingRef.current = false;
				return false;
			},
			dragover: (_view, event) => {
				handlers.onDragOver?.(event);
				return event.defaultPrevented;
			},
			drop: (_view, event) => {
				handlers.onDrop?.(event);
				return event.defaultPrevented;
			},
			click: (_view, event) => {
				if (!handlers.onChipClick) return false;
				const target = event.target as HTMLElement | null;
				const chipEl = target?.closest?.(".input-chip") as HTMLElement | null;
				if (!chipEl) return false;
				const chip = readChipFromDom(chipEl);
				if (!chip) return false;
				handlers.onChipClick(chip);
				return true;
			},
		},
	};
}
