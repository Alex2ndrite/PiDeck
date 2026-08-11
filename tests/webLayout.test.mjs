import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const webCss = readFileSync("src/renderer/src/web/web.css", "utf8");
const webSidebar = readFileSync("src/renderer/src/web/WebSidebar.tsx", "utf8");

test("Web shell keeps sidebar and chat pane in a horizontal split", () => {
	assert.match(
		webCss,
		/\.app\.wechat-shell\s*\{[\s\S]*?flex-direction:\s*row;/,
		"the desktop shell defaults to a vertical layout, so Web must explicitly restore the horizontal split",
	);
	assert.match(
		webCss,
		/\.app\.wechat-shell\s*>\s*\.chat-list-pane\s*\{[\s\S]*?flex:\s*0\s+0\s+280px;[\s\S]*?width:\s*280px;/,
		"the Web sidebar needs a stable width or it consumes the chat pane",
	);
	assert.match(
		webCss,
		/\.app\.wechat-shell\s*>\s*\.chat-pane\s*\{[\s\S]*?flex:\s*1\s+1\s+0;/,
		"the chat pane must own the remaining horizontal space",
	);
});

test("Web project rows can collapse after the active session is revealed", () => {
	assert.match(webSidebar, /useEffect\(\(\) => \{/);
	assert.doesNotMatch(
		webSidebar,
		/expandedProjects\.has\(project\.id\) \|\| project\.id === activeSessionProjectId/,
		"the active project must not be forced open on every render",
	);
	assert.match(webSidebar, /const expanded = searching \|\| expandedProjects\.has\(project\.id\)/);
});
