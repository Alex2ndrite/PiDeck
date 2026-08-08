/**
 * Composer mention 原子节点：@file / /skill|/cmd / &session。
 * 渲染为与旧 RichInput 一致的 .input-chip 外观；不可编辑内部。
 */

import { mergeAttributes, Node } from "@tiptap/core";
import type { ComposerChip } from "../chips";

export type MentionChipAttrs = {
	kind: ComposerChip["kind"];
	raw: string;
	label: string;
};

declare module "@tiptap/core" {
	interface Commands<ReturnType> {
		mentionChip: {
			insertMentionChip: (attrs: MentionChipAttrs) => ReturnType;
		};
	}
}

export const MentionChip = Node.create({
	name: "mentionChip",
	group: "inline",
	inline: true,
	atom: true,
	selectable: true,
	draggable: false,

	addAttributes() {
		return {
			kind: { default: "file" as ComposerChip["kind"] },
			raw: { default: "" },
			label: { default: "" },
		};
	},

	parseHTML() {
		return [
			{
				tag: "span.input-chip[data-raw]",
				getAttrs: (el) => {
					if (!(el instanceof HTMLElement)) return false;
					const kind = el.getAttribute("data-type");
					const raw = el.getAttribute("data-raw");
					if (!raw || (kind !== "file" && kind !== "skill" && kind !== "session")) {
						return false;
					}
					return {
						kind,
						raw,
						label: el.textContent?.replace(/^[@/&]/, "").trim() || raw.slice(1),
					};
				},
			},
		];
	},

	renderHTML({ node, HTMLAttributes }) {
		const kind = String(node.attrs.kind ?? "file");
		const raw = String(node.attrs.raw ?? "");
		const label = String(node.attrs.label ?? raw);
		const icon = kind === "file" ? "@" : kind === "session" ? "&" : "/";
		return [
			"span",
			mergeAttributes(HTMLAttributes, {
				class: `input-chip input-chip--${kind}`,
				"data-type": kind,
				"data-raw": raw,
				contenteditable: "false",
				title: raw,
			}),
			["span", { class: "input-chip__icon" }, icon],
			["span", { class: "input-chip__label" }, label],
		];
	},

	addCommands() {
		return {
			insertMentionChip:
				(attrs) =>
				({ commands }) =>
					commands.insertContent({
						type: this.name,
						attrs,
					}),
		};
	},
});
