import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import vm from "node:vm";

/** vm 跨 realm 时 deepEqual 会因原型不同误报，统一 JSON 比较。 */
function assertJsonEqual(actual, expected) {
	assert.equal(JSON.stringify(actual), JSON.stringify(expected));
}

function loadChips() {
	const source = readFileSync(
		"src/renderer/src/components/session/composer/chips.ts",
		"utf8",
	);
	const output = ts.transpileModule(source, {
		compilerOptions: {
			module: ts.ModuleKind.CommonJS,
			target: ts.ScriptTarget.ES2022,
			esModuleInterop: true,
		},
		fileName: "chips.ts",
	}).outputText;
	const module = { exports: {} };
	vm.runInNewContext(
		output,
		{ module, exports: module.exports, require: () => ({}), console, Set },
		{ filename: "chips.ts" },
	);
	return module.exports;
}

const {
	parseRichInputChips,
	formatFilePathRef,
	unwrapFileChipPath,
} = loadChips();

test("formatFilePathRef quotes spaced paths and marks directories", () => {
	assert.equal(formatFilePathRef("src/a.ts"), "@src/a.ts");
	assert.equal(formatFilePathRef("src/components", { isDirectory: true }), "@src/components/");
	assert.equal(formatFilePathRef("my docs/a.ts"), '@"my docs/a.ts"');
});

test("unwrapFileChipPath strips @ quotes and trailing separators", () => {
	assert.equal(unwrapFileChipPath("@src/a.ts"), "src/a.ts");
	assert.equal(unwrapFileChipPath("@src/"), "src");
	assert.equal(unwrapFileChipPath('@"my docs/"'), "my docs");
});

test("parseRichInputChips respects file and command whitelists", () => {
	const files = new Set(["src/a.ts"]);
	const cmds = new Set(["compact"]);
	const chips = parseRichInputChips(
		"看 @src/a.ts 和 @src/b.ts 再 /compact /unknown",
		cmds,
		files,
	);
	assertJsonEqual(
		chips.map((c) => ({ kind: c.kind, raw: c.raw })),
		[
			{ kind: "file", raw: "@src/a.ts" },
			{ kind: "skill", raw: "/compact" },
		],
	);
});

test("session chip with whitelist Set only matches known names", () => {
	const sessions = new Set(["alpha", "beta long"]);
	const chips = parseRichInputChips(
		"参考 &alpha 和 &beta long 还有 &ghost 以及 && cmd&x",
		undefined,
		undefined,
		sessions,
	);
	assertJsonEqual(
		chips.map((c) => c.raw),
		["&alpha", "&beta long"],
	);
});

test("session chip with empty whitelist creates no session chips", () => {
	const chips = parseRichInputChips("&& &oops cmd&x", undefined, undefined, new Set());
	assert.equal(chips.filter((c) => c.kind === "session").length, 0);
});

test("session chip without whitelist falls back to first word for timeline display", () => {
	const chips = parseRichInputChips("see &alpha next");
	assertJsonEqual(
		chips.filter((c) => c.kind === "session").map((c) => c.raw),
		["&alpha"],
	);
});

test("URL path segments are not parsed as chips", () => {
	const chips = parseRichInputChips(
		"https://example.com/foo @src/a.ts",
		undefined,
		new Set(["src/a.ts"]),
	);
	assertJsonEqual(
		chips.map((c) => c.raw),
		["@src/a.ts"],
	);
});
