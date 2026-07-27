import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const browserPanel = readFileSync("src/renderer/src/components/app/BrowserPanel.tsx", "utf8");
const rendererTypes = readFileSync("src/renderer/src/types.d.ts", "utf8");
const main = readFileSync("src/main/index.ts", "utf8");

function functionBlock(source, signature, nextSignature) {
	const start = source.indexOf(signature);
	assert.ok(start >= 0, `missing ${signature}`);
	const end = source.indexOf(nextSignature, start + signature.length);
	return source.slice(start, end >= 0 ? end : undefined);
}

test("BrowserPanel uses a fixed persistent partition without popup or file access attributes", () => {
	assert.match(browserPanel, /const BROWSER_PANEL_PARTITION = "persist:pideck-browser-panel"/);
	assert.match(browserPanel, /partition=\{BROWSER_PANEL_PARTITION\}/);
	assert.doesNotMatch(browserPanel, /allowfileaccess/i);
	assert.doesNotMatch(browserPanel, /allowpopups/i);
	assert.match(rendererTypes, /partition\?: string/);
	assert.doesNotMatch(rendererTypes, /allowpopups/i);
});

test("BrowserPanel rejects non-http navigation before calling webview.loadURL", () => {
	const loadUrl = functionBlock(browserPanel, "const loadUrl = useCallback(", "\n\n\tuseEffect(");
	assert.match(browserPanel, /targetUrl === "about:blank"/);
	assert.match(browserPanel, /protocol === "http:" \|\| protocol === "https:"/);
	assert.match(browserPanel, /export function navigateTo\(url: string\) \{\n\tif \(!isAllowedBrowserUrl\(url\)\) return;/);
	assert.match(loadUrl, /if \(!isAllowedBrowserUrl\(targetUrl\)\) return;/);
	assert.ok(loadUrl.indexOf("isAllowedBrowserUrl(targetUrl)") < loadUrl.indexOf("wv.loadURL(targetUrl)"));
});

test("main process hardens webPreferences before attaching BrowserPanel guests", () => {
	const attach = functionBlock(main, "function configureBrowserPanelWebviewHost", "\n\nasync function createWindow");
	assert.match(attach, /session\.fromPartition\(BROWSER_PANEL_PARTITION\)/);
	assert.match(attach, /"will-attach-webview"/);
	assert.match(attach, /params\.partition = BROWSER_PANEL_PARTITION/);
	assert.match(attach, /webPreferences\.partition = BROWSER_PANEL_PARTITION/);
	assert.match(attach, /webPreferences\.sandbox = true/);
	assert.match(attach, /webPreferences\.nodeIntegration = false/);
	assert.match(attach, /webPreferences\.contextIsolation = true/);
	assert.match(attach, /webPreferences\.webSecurity = true/);
	assert.match(attach, /delete webPreferences\.preload/);
	assert.match(attach, /delete params\.preload/);
	assert.match(attach, /event\.preventDefault\(\)/);
});

test("BrowserPanel guest navigation, redirects, windows, and permissions default to deny", () => {
	const attach = functionBlock(main, "function configureBrowserPanelWebviewHost", "\n\nasync function createWindow");
	assert.match(attach, /setPermissionCheckHandler\(\(\) => false\)/);
	assert.match(attach, /setPermissionRequestHandler\(\(_webContents, _permission, callback\) => callback\(false\)\)/);
	assert.match(attach, /setDevicePermissionHandler\(\(\) => false\)/);
	assert.match(attach, /webRequest\.onBeforeRequest/);
	assert.match(attach, /details\.resourceType === "mainFrame" \|\| details\.resourceType === "subFrame"/);
	assert.match(attach, /callback\(\{ cancel: true \}\)/);
	assert.match(attach, /guest\.session !== browserPanelSession/);
	assert.match(attach, /guest\.close\(\)/);
	assert.match(attach, /guest\.on\("will-frame-navigate"/);
	assert.match(attach, /guest\.on\("will-redirect"/);
	assert.match(attach, /guest\.setWindowOpenHandler/);
	assert.match(attach, /return \{ action: "deny" \}/);
	assert.match(attach, /if \(isAllowedBrowserPanelUrl\(event\.url\)\) return;/);
});

test("webview hardening is installed before the main window loads renderer content", () => {
	const createWindow = functionBlock(main, "async function createWindow()", "\n\nfunction shouldUseDevRendererUrl");
	const configureIndex = createWindow.indexOf("configureBrowserPanelWebviewHost(createdWindow)");
	const loadIndex = createWindow.indexOf("mainWindow.loadURL");
	assert.ok(configureIndex >= 0, "expected webview hardening setup");
	assert.ok(loadIndex >= 0, "expected renderer load");
	assert.ok(configureIndex < loadIndex, "hardening must be installed before renderer load");
});

test("external browser IPC shares the HTTP(S) protocol gate and Chromium sandbox stays enabled", () => {
	const browserOpenExternal = functionBlock(main, 'ipcMain.handle(ipcChannels.browserOpenExternal', "\n\n\tipcMain.handle(");
	assert.match(browserOpenExternal, /await openExternalUrl\(url, true\)/);
	assert.doesNotMatch(browserOpenExternal, /shell\.openExternal\(url\)/);
	assert.doesNotMatch(main, /appendSwitch\(["']no-sandbox["']\)/);
});
