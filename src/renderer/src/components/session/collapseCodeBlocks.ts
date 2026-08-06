import { visitParents, SKIP } from "unist-util-visit-parents";
import type { Element, Root } from "hast";

/**
 * rehype 插件：为块级代码增加可手动折叠的 details 容器。
 * 保留原始 pre/code 节点，避免接管 Streamdown 的高亮、复制和下载职责。
 */
export interface CollapseCodeBlockOptions {
	foldThreshold?: number;
	excludeLanguages?: string[];
}

function getLanguage(pre: Element): string | undefined {
	const code = pre.children.find(
		(child): child is Element => child.type === "element" && child.tagName === "code",
	);
	const classes = code?.properties?.className;
	const classList = Array.isArray(classes)
		? classes.map(String)
		: typeof classes === "string"
			? classes.split(/\s+/)
			: [];
	const language = classList.find((value) => value.startsWith("language-"));
	return language?.slice("language-".length);
}

function countLines(pre: Element): number {
	let text = "";
	const collect = (node: Element["children"][number]): void => {
		if (node.type === "text") text += node.value;
		else if (node.type === "element") node.children.forEach(collect);
	};
	pre.children.forEach(collect);
	const value = text.replace(/\n$/, "");
	return value === "" ? 0 : value.split("\n").length;
}

function chevron(): Element {
	return {
		type: "element",
		tagName: "span",
		properties: { "aria-hidden": "true", "data-sd-chevron": "" },
		children: [{ type: "text", value: "›" }],
	};
}

export function collapseCodeBlocks(options: CollapseCodeBlockOptions = {}) {
	const { foldThreshold, excludeLanguages = [] } = options;
	return (tree: Root) => {
		visitParents(tree, "element", (node: Element, parents) => {
			if (node.tagName !== "pre") return;
			const parent = parents.at(-1);
			if (!parent) return;
			const index = parent.children.indexOf(node);
			if (index < 0) return;
			if (parents.some((ancestor) => ancestor.type === "element" && ancestor.properties?.["data-sd-collapse"] !== undefined)) return;

			const language = getLanguage(node);
			if (language && excludeLanguages.includes(language)) return;
			const lines = countLines(node);
			const details: Element = {
				type: "element",
				tagName: "details",
				properties: {
					"data-sd-collapse": "",
					"data-lang": language ?? "",
					"data-lines": String(lines),
					...(foldThreshold === undefined || lines <= foldThreshold ? { open: true } : {}),
					className: ["sd-code-collapse"],
				},
				children: [
					{
						type: "element",
						tagName: "summary",
						properties: { className: ["sd-code-collapse-summary"] },
						children: [
							chevron(),
							...(language ? [{ type: "text" as const, value: `${language} · ` }] : []),
							{ type: "text", value: String(lines) },
						],
					},
					node,
				],
			};
			parent.children.splice(index, 1, details);
			return SKIP;
		});
	};
}
