/**
 * Composer TipTap 扩展组装：StarterKit 裁剪 + mention。
 * 数学 / mermaid 后续只在本文件追加，避免散落 configure。
 */

import StarterKit from "@tiptap/starter-kit";
import { MentionChip } from "./mentionChip";

export function createComposerExtensions() {
	return [
		StarterKit.configure({
			heading: false,
			bold: false,
			italic: false,
			strike: false,
			code: false,
			codeBlock: false,
			blockquote: false,
			bulletList: false,
			orderedList: false,
			listItem: false,
			horizontalRule: false,
			// 保留 document / paragraph / hardBreak / history
		}),
		MentionChip,
	];
}
