import { defaultUrlTransform } from "react-markdown";

/**
 * Markdown 链接处理纯逻辑（与组件分离，供 node 单测直接加载）。
 *
 * - markdownUrlTransform：放行 file:// 本地文件链接，其余走默认安全过滤
 * - remarkLinkifyPaths：mdast 层把裸文件路径转成 file:// 链接
 * - isLocalPathRef：判断无协议 href 是否为本地路径引用（[text](path) 形式）
 */

/** Markdown 内的链接默认会在 Electron 窗口内导航,这里拦截点击统一用系统浏览器打开。
 * 支持文件路径链接（file:// 协议）点击打开文件。
 */
export function markdownUrlTransform(url: string): string {
	// react-markdown 默认会清空 file:// 协议；这里只放行本地文件链接，普通外链仍使用默认安全过滤。
	return url.startsWith("file://") ? url : defaultUrlTransform(url);
}

/**
 * 裸文件路径识别正则（修复误判/特殊字符问题）：
 * - 排除空白 + ASCII 标点 + 全角标点/符号（，。；：！？、（）【】《》「」『』“”‘’·…—～￥×÷→←↑↓⇒／）
 * - 排除全角区（\u{FF00}-\u{FFEF}）、连字符/破折号区（\u{2010}-\u{2027}）、
 *   一般标点区（\u{2030}-\u{205E}）——避免 "src/a.ts，" 把全角逗号吞进路径
 * - 目录段与扩展名支持 Unicode 字母（中文/日文文件名）
 */
export const FILE_PATH_RE =
	/(?:[A-Z]:[\\/]|(?:\.\.?[\\/]|[\\/])|(?:[\p{L}_][\p{L}\p{N}_.-]*[\\/])+)[^\s<>"'`|?*\[\](){}，。；：！？、（）【】《》「」『』“”‘’·…—～￥×÷→←↑↓⇒／\u{FF00}-\u{FFEF}\u{2010}-\u{2027}\u{2030}-\u{205E}]+\.[\p{L}\p{N}]+/gu;

/**
 * mdast 插件：把裸文件路径转成 file:// 链接。
 * 只处理 type === "text" 的叶子节点，天然跳过 code / inlineCode / link 内的文本。
 */
export const remarkLinkifyPaths = () => {
	return (tree: any) => {
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
						url: `file://${encodeURIComponent(m[0]).replace(/%2F/g, "/").replace(/%3A/g, ":")}`,
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

/**
 * 判断是否为本地文件路径引用（无协议的相对/绝对路径）：
 * markdown 链接 [text](docs/guide.md) 的 href 无协议，此前被当作外链交给系统浏览器
 * 打开（打开方式错误/无法打开）——这里识别为本地路径，点击走 onOpenFile。
 */
export function isLocalPathRef(url: string): boolean {
	if (!url) return false;
	// Windows 盘符路径（D:\x 或 D:/x）→ 本地路径（先于协议判断，避免 D: 被当协议）
	if (/^[a-zA-Z]:[\\/]/.test(url)) return true;
	// 有协议（http/https/ftp/mailto/file/data/javascript 等）→ 外链
	if (/^[a-z][a-z0-9+.-]*:/i.test(url)) return false;
	// 锚点 / 协议相对 URL → 不拦截（保持默认行为）
	if (url.startsWith("#") || url.startsWith("//")) return false;
	return true;
}
