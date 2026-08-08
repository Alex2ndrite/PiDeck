import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import vm from "node:vm";

function loadCodec() {
	const chipsSource = readFileSync(
		"src/renderer/src/components/session/composer/chips.ts",
		"utf8",
	);
	const chipsOut = ts.transpileModule(chipsSource, {
		compilerOptions: {
			module: ts.ModuleKind.CommonJS,
			target: ts.ScriptTarget.ES2022,
		},
		fileName: "chips.ts",
	}).outputText;
	const chipsModule = { exports: {} };
	vm.runInNewContext(
		chipsOut,
		{ module: chipsModule, exports: chipsModule.exports, require: () => ({}), console, Set },
		{ filename: "chips.ts" },
	);

	const codecSource = readFileSync(
		"src/renderer/src/components/session/composer/tiptap/plainTextCodec.ts",
		"utf8",
	);
	const codecOut = ts.transpileModule(codecSource, {
		compilerOptions: {
			module: ts.ModuleKind.CommonJS,
			target: ts.ScriptTarget.ES2022,
		},
		fileName: "plainTextCodec.ts",
	}).outputText;
	const codecModule = { exports: {} };
	vm.runInNewContext(
		codecOut,
		{
			module: codecModule,
			exports: codecModule.exports,
			require: (id) => {
				if (id === "../chips") return chipsModule.exports;
				return {};
			},
			console,
			Set,
		},
		{ filename: "plainTextCodec.ts" },
	);
	return codecModule.exports;
}

const { plainTextToComposerDoc, composerDocToPlainText } = loadCodec();

test("plainText codec roundtrips empty, multiline, and trailing newline", () => {
	for (const sample of ["", "hello", "a\nb", "a\n\nb", "line\n"]) {
		const doc = plainTextToComposerDoc(sample);
		assert.equal(composerDocToPlainText(doc), sample);
	}
});

test("plainText codec roundtrips mention chips with whitelist", () => {
	const text = "看 @src/a.ts 与 /compact 和 &alpha 结束";
	const doc = plainTextToComposerDoc(text, {
		validCommandNames: new Set(["compact"]),
		validFilePaths: new Set(["src/a.ts"]),
		validSessionRefs: new Set(["alpha"]),
	});
	assert.equal(composerDocToPlainText(doc), text);
	const kinds = [];
	const walk = (node) => {
		if (node.type === "mentionChip") kinds.push(node.attrs.kind);
		node.content?.forEach(walk);
	};
	walk(doc);
	assert.deepEqual(kinds, ["file", "skill", "session"]);
});

test("plainText codec does not create session chip for && when whitelisted", () => {
	const doc = plainTextToComposerDoc("run && echo", {
		validSessionRefs: new Set(["alpha"]),
	});
	assert.equal(composerDocToPlainText(doc), "run && echo");
	let mentions = 0;
	const walk = (node) => {
		if (node.type === "mentionChip") mentions += 1;
		node.content?.forEach(walk);
	};
	walk(doc);
	assert.equal(mentions, 0);
});
