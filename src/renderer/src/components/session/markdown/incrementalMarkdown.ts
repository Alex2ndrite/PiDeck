/**
 * 流式 Markdown 冻结切分（学 dsh IncrementalMarkdownParser）。
 *
 * 业务规则：CommonMark 块级解析是行基的，追加文本只会重塑「解析前沿」
 * （末段段落可能变 setext 标题、列表延续、未闭合 fence 吞行）。
 * 因此只把尾部 UNSTABLE_TAIL_BLOCKS 个内容块留在热路径，前面的稳定块
 * 按源 offset 切开，交给各自 memo 的 Streamdown，避免每帧全量重解析。
 *
 * 边界：
 * - 不引入 marked（它只活在 streamdown 内部）；本模块只做顶层块分界扫描。
 * - 未闭合围栏始终算不稳定，不会被冻进 prefix。
 * - 非 append（text 不以 prev 为前缀）时 generation +1，调用方丢弃旧冻结节点。
 * - remend/引用链接跨冻结边界可能字面渲染，settle 后整篇重渲自愈。
 */

/** 尾部保留的不稳定内容块数：1 不够（setext/列表续行），3 收益下降。 */
export const UNSTABLE_TAIL_BLOCKS = 2;

export type MarkdownBlockKind =
	| "fence"
	| "heading"
	| "list"
	| "quote"
	| "hr"
	| "html"
	| "paragraph"
	| "blank";

export type MarkdownBlockSpan = {
	start: number;
	end: number;
	kind: MarkdownBlockKind;
	/** 围栏尚未闭合：禁止冻进 prefix，必须留在 tail。 */
	open?: boolean;
};

export type FrozenMarkdownSplit = {
	prefixEnd: number;
	prefix: string;
	tail: string;
	frozenBlocks: MarkdownBlockSpan[];
	generation: number;
};

type LineSlice = {
	raw: string;
	trimmed: string;
	start: number;
	next: number;
};

function readLine(text: string, from: number): LineSlice {
	const nl = text.indexOf("\n", from);
	const end = nl === -1 ? text.length : nl;
	const raw = text.slice(from, end);
	const trimmed = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
	return { raw, trimmed, start: from, next: nl === -1 ? text.length : nl + 1 };
}

function isBlankLine(line: string): boolean {
	return /^\s*$/.test(line);
}

function isFenceOpen(line: string): { marker: string; len: number } | undefined {
	const match = /^( {0,3})(`{3,}|~{3,})/.exec(line);
	if (!match) return undefined;
	return { marker: match[2][0], len: match[2].length };
}

function isFenceClose(line: string, open: { marker: string; len: number }): boolean {
	const match = /^( {0,3})(`{3,}|~{3,})\s*$/.exec(line);
	if (!match) return false;
	return match[2][0] === open.marker && match[2].length >= open.len;
}

function isAtxHeading(line: string): boolean {
	return /^ {0,3}#{1,6}(?:\s|$)/.test(line);
}

function isThematicBreak(line: string): boolean {
	return /^ {0,3}(?:(?:-[\t ]*){3,}|(?:_[\t ]*){3,}|(?:\*[\t ]*){3,})\s*$/.test(line);
}

function isListItem(line: string): boolean {
	return /^ {0,3}(?:[-+*]|\d{1,9}[.)])(?:\s|$)/.test(line);
}

function isQuote(line: string): boolean {
	return /^ {0,3}>/.test(line);
}

function isIndentedCode(line: string): boolean {
	return /^(?: {4}|\t)/.test(line) && !isBlankLine(line);
}

function isHtmlBlock(line: string): boolean {
	return /^ {0,3}</.test(line);
}

function isSetextUnderline(line: string): boolean {
	return /^ {0,3}(?:=+|-+)\s*$/.test(line) && !isThematicBreak(line);
}

/**
 * 扫描顶层块分界。只关心「下一块从哪开始」，不复刻完整 CommonMark。
 * 空白行单独成块，方便冻结切在内容块 end、tail 从下一内容块 start 起。
 */
export function splitTopLevelMarkdownBlocks(text: string): MarkdownBlockSpan[] {
	const blocks: MarkdownBlockSpan[] = [];
	let offset = 0;
	while (offset < text.length) {
		const first = readLine(text, offset);
		if (isBlankLine(first.trimmed)) {
			let next = first.next;
			while (next < text.length) {
				const look = readLine(text, next);
				if (!isBlankLine(look.trimmed)) break;
				next = look.next;
			}
			blocks.push({ start: offset, end: next, kind: "blank" });
			offset = next;
			continue;
		}

		const fence = isFenceOpen(first.trimmed);
		if (fence) {
			let next = first.next;
			let closed = false;
			while (next < text.length) {
				const look = readLine(text, next);
				next = look.next;
				if (isFenceClose(look.trimmed, fence)) {
					closed = true;
					break;
				}
			}
			blocks.push({
				start: offset,
				end: next,
				kind: "fence",
				open: closed ? undefined : true,
			});
			offset = next;
			continue;
		}

		if (isAtxHeading(first.trimmed) || isThematicBreak(first.trimmed)) {
			blocks.push({
				start: offset,
				end: first.next,
				kind: isAtxHeading(first.trimmed) ? "heading" : "hr",
			});
			offset = first.next;
			continue;
		}

		if (isQuote(first.trimmed) || isListItem(first.trimmed) || isIndentedCode(first.trimmed) || isHtmlBlock(first.trimmed)) {
			const kind: MarkdownBlockKind = isQuote(first.trimmed)
				? "quote"
				: isListItem(first.trimmed)
					? "list"
					: isHtmlBlock(first.trimmed)
						? "html"
						: "paragraph";
			let next = first.next;
			while (next < text.length) {
				const look = readLine(text, next);
				if (isBlankLine(look.trimmed)) break;
				// 列表/引用允许懒延续；新围栏/标题/hr 必须切开，避免把后续结构吞进当前块。
				if (isFenceOpen(look.trimmed) || isAtxHeading(look.trimmed) || isThematicBreak(look.trimmed)) break;
				if (kind === "list" && (isQuote(look.trimmed) || isHtmlBlock(look.trimmed))) break;
				next = look.next;
			}
			blocks.push({ start: offset, end: next, kind: kind === "paragraph" && isIndentedCode(first.trimmed) ? "paragraph" : kind });
			offset = next;
			continue;
		}

		// 段落：吃到空行；若下一行是 setext 下划线，并进本块（可能把段变成标题——所以必须留在 tail）。
		let next = first.next;
		while (next < text.length) {
			const look = readLine(text, next);
			if (isBlankLine(look.trimmed)) break;
			if (isSetextUnderline(look.trimmed)) {
				next = look.next;
				break;
			}
			if (
				isFenceOpen(look.trimmed) ||
				isAtxHeading(look.trimmed) ||
				isThematicBreak(look.trimmed) ||
				isListItem(look.trimmed) ||
				isQuote(look.trimmed)
			) {
				break;
			}
			next = look.next;
		}
		blocks.push({ start: offset, end: next, kind: "paragraph" });
		offset = next;
	}
	return blocks;
}

/** 计算可冻结前缀终点：去掉尾部 N 个内容块 + 任何未闭合围栏。 */
export function resolveFrozenPrefixEnd(
	text: string,
	unstableTail: number = UNSTABLE_TAIL_BLOCKS,
): { prefixEnd: number; frozenBlocks: MarkdownBlockSpan[] } {
	const blocks = splitTopLevelMarkdownBlocks(text);
	const content = blocks.filter((block) => block.kind !== "blank");
	if (content.length === 0) return { prefixEnd: 0, frozenBlocks: [] };

	let lastUnstableIndex = content.length;
	for (let i = content.length - 1; i >= 0; i -= 1) {
		if (content[i].open) lastUnstableIndex = i;
	}
	const keepFrom = Math.min(lastUnstableIndex, Math.max(0, content.length - unstableTail));
	if (keepFrom <= 0) return { prefixEnd: 0, frozenBlocks: [] };

	const frozenBlocks = content.slice(0, keepFrom);
	return { prefixEnd: frozenBlocks[frozenBlocks.length - 1].end, frozenBlocks };
}

/**
 * 增量冻结器：同一实例跟一段流式文本。
 * update 对相同输入幂等；非 append 升 generation，调用方必须丢弃旧冻结 React 节点。
 */
export class IncrementalMarkdownFrontier {
	private prevText = "";
	private generation = 0;
	private cached: FrozenMarkdownSplit | undefined;

	update(text: string): FrozenMarkdownSplit {
		if (this.cached && text === this.prevText) return this.cached;
		// 非追加（回退、整段替换、新一轮）会让已冻结块的源区间失效。
		if (this.prevText && !text.startsWith(this.prevText)) {
			this.generation += 1;
		}
		this.prevText = text;
		const { prefixEnd, frozenBlocks } = resolveFrozenPrefixEnd(text);
		// 冻结边界未动且 generation 未变时复用上一次的 prefix 字符串对象：
		// 流式每帧追加 6~12 字，若每帧 slice 都会新分配一个大字符串
		// （V8 对 slice 可能生成引用父串的 SlicedString，使旧串无法及时回收），
		// 长时间流式会持续积累分配压力；边界移动时内容才真正变化，必须重 slice。
		const prefix =
			this.cached &&
			this.cached.generation === this.generation &&
			this.cached.prefixEnd === prefixEnd
				? this.cached.prefix
				: text.slice(0, prefixEnd);
		this.cached = {
			prefixEnd,
			prefix,
			tail: text.slice(prefixEnd),
			frozenBlocks,
			generation: this.generation,
		};
		return this.cached;
	}

	reset(): void {
		this.prevText = "";
		this.cached = undefined;
	}
}
