import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const composer = readFileSync(
	"src/renderer/src/components/session/composer/TipTapComposer.tsx",
	"utf8",
);
const timelineCss = readFileSync("src/renderer/src/styles/timeline.css", "utf8");

test("TipTap composer keeps EditorContent inside a height-constrained overflow host", () => {
	// EditorContent 多一层 wrapper：host/surface 都必须 min-h-0 + overflow-hidden，
	// 否则 ProseMirror 跟着内容无限长高，正文会画出 composer-box。
	assert.match(
		composer,
		/tiptap-composer-host[^"]*overflow-hidden/,
	);
	assert.match(
		composer,
		/tiptap-composer-surface[^"]*overflow-hidden/,
	);
	assert.match(composer, /min-h-0/);
});

test("TipTap ProseMirror fills host height then scrolls instead of growing past the box", () => {
	assert.match(
		timelineCss,
		/\.composer \.tiptap-composer-host \{[\s\S]*?overflow:\s*hidden;/,
	);
	assert.match(
		timelineCss,
		/\.composer \.tiptap-composer-host \.tiptap-composer-surface \{[\s\S]*?overflow:\s*hidden;/,
	);
	assert.match(
		timelineCss,
		/\.composer \.tiptap-composer-host \.ProseMirror,\s*\.composer \.tiptap-composer-host \.rich-input \{[\s\S]*?max-height:\s*100%;[\s\S]*?overflow-y:\s*auto;/,
	);
	assert.match(
		timelineCss,
		/\.composer \.tiptap-composer-host \.ProseMirror,\s*\.composer \.tiptap-composer-host \.rich-input \{[\s\S]*?min-height:\s*0;/,
	);
});
