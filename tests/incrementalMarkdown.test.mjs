import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import vm from "node:vm";

function loadModule() {
	const source = readFileSync(
		"src/renderer/src/components/session/markdown/incrementalMarkdown.ts",
		"utf8",
	);
	const { outputText } = ts.transpileModule(source, {
		compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
	});
	const sandbox = { exports: {}, module: { exports: {} } };
	sandbox.module.exports = sandbox.exports;
	vm.runInNewContext(outputText, sandbox, { filename: "incrementalMarkdown.ts" });
	return sandbox.exports;
}

test("appending a paragraph only grows the unstable tail; earlier headings stay frozen", () => {
	const { IncrementalMarkdownFrontier } = loadModule();
	const frontier = new IncrementalMarkdownFrontier();
	// 4 个内容块：冻住前 2 个（UNSTABLE_TAIL_BLOCKS=2），后两段留在 tail。
	const first = frontier.update("# Title\n\nHello world.\n\nSecond para.\n\nMore text");
	assert.ok(first.prefix.includes("# Title"));
	assert.ok(first.prefix.includes("Hello world."));
	assert.match(first.tail, /Second para/);
	assert.match(first.tail, /More text/);
	assert.equal(first.generation, 0);

	const second = frontier.update("# Title\n\nHello world.\n\nSecond para.\n\nMore text continues");
	assert.equal(second.prefix, first.prefix);
	assert.match(second.tail, /More text continues/);
	assert.equal(second.generation, 0);
});

test("an open fence is never frozen into the prefix", () => {
	const { IncrementalMarkdownFrontier } = loadModule();
	const frontier = new IncrementalMarkdownFrontier();
	// 足够多的稳定块 + 未闭合围栏：围栏必须整段落在 tail。
	const split = frontier.update("# Intro\n\nHello world.\n\nSecond para.\n\n```ts\nconst x = 1;\n");
	assert.ok(split.prefix.includes("# Intro"));
	assert.match(split.tail, /```ts/);
	assert.doesNotMatch(split.prefix, /```ts/);
});

test("non-append input bumps generation so callers drop frozen nodes", () => {
	const { IncrementalMarkdownFrontier } = loadModule();
	const frontier = new IncrementalMarkdownFrontier();
	const first = frontier.update("alpha\n\nbeta\n\ngamma");
	const second = frontier.update("totally different");
	assert.equal(first.generation, 0);
	assert.equal(second.generation, 1);
	assert.equal(second.prefixEnd, 0);
});

test("identical input is idempotent", () => {
	const { IncrementalMarkdownFrontier } = loadModule();
	const frontier = new IncrementalMarkdownFrontier();
	const text = "# A\n\npara one\n\npara two";
	const first = frontier.update(text);
	const second = frontier.update(text);
	assert.equal(first, second);
});

test("prefix grows when the frozen boundary moves forward (cache must reslice)", () => {
	const { IncrementalMarkdownFrontier } = loadModule();
	const frontier = new IncrementalMarkdownFrontier();
	// 首帧：冻住 "# Title" + "Hello world."，tail 含 "Second para."。
	const first = frontier.update("# Title\n\nHello world.\n\nSecond para.");
	// 追加两个新块后 "Second para." 也稳定下来 → 冻结边界前移，prefix 必须重切片变长
	// （防回归：frontier 在边界未动时复用 prefix 字符串对象，边界动了必须重新 slice）。
	const second = frontier.update("# Title\n\nHello world.\n\nSecond para.\n\nThird para.\n\nFourth para.");
	assert.ok(second.prefixEnd > first.prefixEnd);
	assert.ok(second.prefix.startsWith(first.prefix));
	assert.ok(second.prefix.includes("Second para."));
	assert.match(second.tail, /Third para/);
	// 边界稳定后继续追加（段内追加，内容块数不变）：prefix 内容保持不变
	const third = frontier.update("# Title\n\nHello world.\n\nSecond para.\n\nThird para.\n\nFourth para. continues");
	assert.equal(third.prefix, second.prefix);
	assert.equal(third.prefixEnd, second.prefixEnd);
});

test("MarkdownStream streams through frozen prefix + tail split", () => {
	const stream = readFileSync("src/renderer/src/components/session/MarkdownStream.tsx", "utf8");
	assert.match(stream, /IncrementalMarkdownFrontier/);
	assert.match(stream, /FrozenMarkdownChunk/);
	assert.match(stream, /UNSTABLE_TAIL_BLOCKS/);
	assert.match(stream, /data-md-frozen/);
});

test("MarkdownStream keeps streaming plugin arrays as stable module references", () => {
	// 防回归：流式精简插件若内联 []（每帧新引用），pipe 的 useMemo 依赖随之变化
	// → pipe 每帧重建 → FrozenMarkdownChunk 的 memo 比较 props.pipe 引用变化
	// → 冻结 prefix 每帧全量重解析（掉帧/抖动/GC 压力的根源）。
	const stream = readFileSync("src/renderer/src/components/session/MarkdownStream.tsx", "utf8");
	assert.match(stream, /NO_STREAM_REMARK_PLUGINS/);
	assert.match(stream, /NO_STREAM_REHYPE_PLUGINS/);
	// 流式分支必须引用常量，不得内联新数组
	assert.match(stream, /isStreamingNow\s*\?\s*NO_STREAM_REMARK_PLUGINS/);
	assert.match(stream, /isStreamingNow\s*\?\s*NO_STREAM_REHYPE_PLUGINS/);
	assert.doesNotMatch(stream, /isStreamingNow\s*\?\s*\[\]/);
});
