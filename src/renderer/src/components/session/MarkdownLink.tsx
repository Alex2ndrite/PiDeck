import type React from "react";
import { FileText } from "lucide-react";
import { defaultUrlTransform } from "react-markdown";

/**
 * Markdown 链接处理共享模块：旧 react-markdown 管线与 Streamdown 灰度管线
 * 共用同一份实现（UI 2.0 / issue #115 U2），保证两种渲染器下链接行为一致。
 *
 * - markdownUrlTransform：放行 file:// 本地文件链接，其余走默认安全过滤
 * - remarkLinkifyPaths：mdast 层把裸文件路径转成 file:// 链接
 * - MarkdownLink：file:// 链接走 onOpenFile，普通外链走 onOpenExternal
 */

/** Markdown 内的链接默认会在 Electron 窗口内导航,这里拦截点击统一用系统浏览器打开。
 * 支持文件路径链接（file:// 协议）点击打开文件。
 */
export function markdownUrlTransform(url: string): string {
	// react-markdown 默认会清空 file:// 协议；这里只放行本地文件链接，普通外链仍使用默认安全过滤。
	return url.startsWith("file://") ? url : defaultUrlTransform(url);
}

/**
 * 早期实现是渲染前对整段字符串做正则替换，会把代码块里的路径文本
 * 被替换成 [D:\...](file://...) 破坏代码块），且 file:// 经 encodeURIComponent
 * 后反斜杠全被编码，链接既不可用又渲染异常。
 *
 * 改为在 mdast 层遍历，只处理 type === "text" 的叶子节点，天然跳过
 * code / inlineCode / link 内的文本，从根上消除双重处理与代码块破坏。
 * URL 用 file:// + encodeURIComponent 编码路径，MarkdownLink 里解码还原。
 */
const FILE_PATH_RE =
	/(?:[A-Z]:[\\/][^\s<>"'`|?*\n\[\]()]+|(?:\.\.?\/|\/)[^\s<>"'`|?*\n\[\]()]+|(?:[a-zA-Z_][a-zA-Z0-9_-]*[\\/])+[^\s<>"'`|?*\n\[\]()]+)\.[a-zA-Z0-9]+/g;

export const remarkLinkifyPaths = () => {
	return (tree: any) => {
		// 遍历 mdast，仅替换 text 叶子节点；code/inlineCode/link 等节点不被处理。
		// 文本节点无 children，所以先用 __segs 标记待拆分节点，由父节点遍历时展开。
		const visit = (node: any) => {
			if (!node || typeof node !== "object") return;
			const type: string = node.type;
			if (type === "code" || type === "inlineCode" || type === "link") return;
			if (type === "text" && typeof node.value === "string") {
				const text: string = node.value;
				FILE_PATH_RE.lastIndex = 0;
				const segs: any[] = [];
				let last = 0;
				let m: RegExpExecArray | null;
				let touched = false;
				while ((m = FILE_PATH_RE.exec(text)) !== null) {
					const start = m.index;
					const end = start + m[0].length;
					if (start > last) segs.push({ type: "text", value: text.slice(last, start) });
					segs.push({
						type: "link",
						url: `file://${encodeURIComponent(m[0])}`,
						children: [{ type: "text", value: m[0] }],
					});
					last = end;
					touched = true;
				}
				if (touched) {
					if (last < text.length) segs.push({ type: "text", value: text.slice(last) });
					node.__segs = segs;
				}
				return;
			}
			const children: any[] | undefined = node.children;
			if (Array.isArray(children)) {
				const next: any[] = [];
				for (const child of children) {
					visit(child);
					if (child && (child as any).__segs) {
						const segs = (child as any).__segs;
						delete (child as any).__segs;
						next.push(...segs);
					} else {
						next.push(child);
					}
				}
				node.children = next;
			}
		};
		visit(tree);
	};
};

/** 链接渲染：file:// 前缀为 remarkLinkifyPaths 生成的文件路径链接，其余为普通外链。 */
export function MarkdownLink(
	props: React.AnchorHTMLAttributes<HTMLAnchorElement> & {
		onOpenExternal: (url: string) => void;
		onOpenFile?: (path: string) => void;
	},
) {
	const { onOpenExternal, onOpenFile, children, className, title, ...anchorProps } = props;
	// remarkLinkifyPaths 生成的文件路径链接走 file:// 协议，与普通外链区分展示
	const isFileLink = props.href?.startsWith("file://") ?? false;
	const handleClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
		e.preventDefault();
		if (!props.href) return;

		// 处理文件路径链接（file:// 协议）
		if (props.href.startsWith('file://')) {
			const filePath = decodeURIComponent(props.href.slice(7));
			if (onOpenFile) {
				void onOpenFile(filePath);
			}
		} else {
			// 普通 URL 链接用系统浏览器打开
			void onOpenExternal(props.href);
		}
	};
	const linkClass =
		[className, isFileLink ? "markdown-link-file" : undefined]
			.filter(Boolean)
			.join(" ") || undefined;
	return (
		<a
			{...anchorProps}
			className={linkClass}
			onClick={handleClick}
			// 文件链接 hover 展示解码后的完整路径，便于确认目标文件；
			// 普通链接不传 title，保留 markdown 自带 title 语法的原行为
			title={isFileLink ? decodeURIComponent(props.href!.slice(7)) : title}
		>
			{isFileLink ? (
				<>
					<FileText size={12} className="markdown-link-file-icon" />
					<span>{children}</span>
				</>
			) : (
				children
			)}
		</a>
	);
}
