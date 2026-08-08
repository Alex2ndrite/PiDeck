/**
 * Composer 编辑器对外契约（与具体实现解耦）。
 * TipTap / 旧 contentEditable 都应实现同一 props；草稿真相永远是 string。
 */

import type {
	ClipboardEvent,
	DragEvent,
	FocusEvent,
	KeyboardEvent,
	MutableRefObject,
} from "react";
import type { ComposerChip } from "./chips";

export type { ComposerChip };

export type ComposerEditorProps = {
	value: string;
	onChange: (value: string, cursor: number) => void;
	onCursorChange: (cursor: number) => void;
	onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
	onPaste?: (event: ClipboardEvent<HTMLDivElement>) => void;
	onDrop?: (event: DragEvent<HTMLDivElement>) => void;
	onDragOver?: (event: DragEvent<HTMLDivElement>) => void;
	onFocus?: (event: FocusEvent<HTMLDivElement>) => void;
	onBlur?: (event: FocusEvent<HTMLDivElement>) => void;
	disabled?: boolean;
	placeholder?: string;
	className?: string;
	/** 程序化变更后恢复纯文本光标偏移；消费后应置回 null */
	caretRef?: MutableRefObject<number | null>;
	onChipClick?: (chip: ComposerChip) => void;
	validCommandNames?: Set<string>;
	validFilePaths?: Set<string>;
	validSessionRefs?: Set<string>;
};
