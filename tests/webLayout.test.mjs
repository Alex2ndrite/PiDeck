import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const webCss = readFileSync("src/renderer/src/web/web.css", "utf8");
const webSidebar = readFileSync("src/renderer/src/web/WebSidebar.tsx", "utf8");
const webHeader = readFileSync("src/renderer/src/web/WebHeader.tsx", "utf8");
const webChatApp = readFileSync("src/renderer/src/web/WebChatApp.tsx", "utf8");

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

test("Web model picker supports search and mobile header wrapping", () => {
	assert.match(webHeader, /<CommandInput placeholder=\{t\("web\.modelSearch"\)\}/);
	assert.match(webHeader, /CommandEmpty>\{t\("web\.modelEmpty"\)\}/);
	assert.match(webHeader, /chat-header flex min-w-0 flex-wrap/);
});

test("Mobile Web keeps chat full-screen and opens the project tree as a drawer", () => {
	assert.match(webChatApp, /mobileSidebarOpen/);
	assert.match(webChatApp, /onOpenSidebar/);
	assert.match(webSidebar, /mobile-sidebar-backdrop/);
	assert.match(webSidebar, /mobile-open/);
	assert.match(webSidebar, /onDeleteProject/);
});

test("Web starts with no selected session and exposes a scroll-to-bottom action", () => {
	assert.doesNotMatch(webChatApp, /setActiveSessionId\(next\.sessions\[0\]\?\.id \?\? ""\)/);
	assert.match(webChatApp, /setActiveSessionId\(""\)/);
	assert.match(readFileSync("src/renderer/src/web/WebTimeline.tsx", "utf8"), /scroll-to-bottom|ScrollDown|scrollToBottom/);
});

test("Project actions are sibling buttons instead of nested controls", () => {
	assert.match(webSidebar, /project-row-actions[\s\S]*?<Button/);
	assert.doesNotMatch(webSidebar, /project-row-actions[\s\S]*?<span[\s\S]*?role="button"/);
});
