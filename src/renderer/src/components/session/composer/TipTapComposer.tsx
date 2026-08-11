/**
 * TipTapComposer —— 会话输入框视图壳。
 * 编辑器生命周期见 useTipTapComposerEditor；本文件只做 ref / 焦点壳 / EditorContent /
 * 右键粘贴菜单（纯文本粘贴 / 原样粘贴）。
 */

import { forwardRef, useRef } from "react";
import { EditorContent, type Editor } from "@tiptap/react";
import { ClipboardPaste } from "lucide-react";
import type { ComposerEditorProps } from "./types";
import { useTipTapComposerEditor } from "./useTipTapComposerEditor";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "../../ui-shadcn/context-menu";
import { readClipboardHtmlConsistent, readClipboardText } from "../../../utils/clipboard";
import { t } from "../../../i18n";

export type TipTapComposerProps = ComposerEditorProps;

/** 粘贴：剪贴板有 HTML 时插入富文本（TipTap 按 schema 过滤未知标签），否则降级纯文本 */
function insertClipboard(editor: Editor) {
  // 只接受与当前纯文本同源的 HTML：Windows 剪贴板纯文本复制不会更新 HTML 槽，
  // 直接用 readClipboardHtml 会粘出上一次富文本复制的残留内容
  const html = readClipboardHtmlConsistent();
  if (html) {
    editor.commands.insertContent(html);
    return;
  }
  const text = readClipboardText();
  if (!text) return;
  // 用 ProseMirror 文本节点而非 HTML 字符串，避免 `<`/`&` 被当作标签解析
  editor.commands.insertContent({ type: "text", text });
}

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
			<ContextMenu>
				<ContextMenuTrigger asChild>
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
				</ContextMenuTrigger>
				<ContextMenuContent alignOffset={-6}>
					<ContextMenuItem
						onSelect={() => {
							if (!editor) return;
							insertClipboard(editor);
						}}
					>
						<ClipboardPaste size={13} strokeWidth={2} aria-hidden="true" />
						{t("common.paste")}
					</ContextMenuItem>
				</ContextMenuContent>
			</ContextMenu>
		);
	},
);
