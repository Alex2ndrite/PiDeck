import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";
import vm from "node:vm";

const require = createRequire(import.meta.url);

function loadModule(mockProcess = {}) {
	const source = readFileSync("src/main/pet/PetWindow.ts", "utf8");
	const { outputText } = ts.transpileModule(source, {
		compilerOptions: {
			module: ts.ModuleKind.CommonJS,
			target: ts.ScriptTarget.ES2022,
		},
	});
	class MockBrowserWindow {
		static last = null;

		constructor(options) {
			this.options = options;
			this.bounds = { x: 0, y: 0, width: options.width, height: options.height };
			this.setBoundsCalls = 0;
			this.listeners = new Map();
			this.webContents = {
				on: () => undefined,
				session: { webRequest: { onHeadersReceived: () => undefined } },
			};
			MockBrowserWindow.last = this;
		}

		isDestroyed() { return false; }
		setAlwaysOnTop() {}
		on(name, listener) { this.listeners.set(name, listener); }
		loadFile() { return Promise.resolve(); }
		loadURL() { return Promise.resolve(); }
		showInactive() {}
		getBounds() { return this.bounds; }
		getPosition() { return [this.bounds.x, this.bounds.y]; }
		getSize() { return [this.bounds.width, this.bounds.height]; }
		setBounds(bounds) { this.setBoundsCalls += 1; this.bounds = { ...this.bounds, ...bounds }; }
		destroy() {}
	}
	let intervalCalls = 0;
	const sandbox = {
		exports: {},
		__dirname: "/tmp/pi-desktop-test/out/main/pet",
		setTimeout,
		clearTimeout,
		setInterval: () => { intervalCalls += 1; return 1; },
		clearInterval: () => undefined,
		process: {
			platform: "linux",
			env: {},
			argv: [],
			...mockProcess,
		},
		require: (id) => {
			if (id === "electron") {
				return {
					app: {
						commandLine: {
							getSwitchValue: () => "",
						},
						getPath: () => "/tmp/pi-desktop-test",
					},
					BrowserWindow: MockBrowserWindow,
					screen: {
						getDisplayMatching: () => ({
							workArea: { x: 0, y: 0, width: 1920, height: 1080 },
						}),
					},
				};
			}
			if (id === "@electron-toolkit/utils") return { is: { dev: true } };
			if (id === "../preloadPath") {
				return { preparePreloadPath: async (sourcePath) => sourcePath };
			}
			// 拆分后 PetWindow 会读取 Chromium 沙箱偏好；测试中固定为未开启（默认路径）。
			if (id === "../settings/SettingsStore") {
				return { readElectronChromiumSandboxPreference: () => false };
			}
			return require(id);
		},
	};
	vm.runInNewContext(outputText, sandbox, {
		filename: "PetWindow.ts",
	});
	return {
		...sandbox.exports,
		MockBrowserWindow,
		getIntervalCalls: () => intervalCalls,
	};
}

test("treats X11 ozone on Linux Wayland as freely positionable", () => {
	const { detectPetWindowCaps } = loadModule({
		platform: "linux",
		env: {
			XDG_SESSION_TYPE: "wayland",
			WAYLAND_DISPLAY: "wayland-0",
			DISPLAY: ":0",
		},
		argv: ["electron", ".", "--ozone-platform=x11"],
	});

	assert.deepEqual(JSON.parse(JSON.stringify(detectPetWindowCaps())), {
		transparent: true,
		clickThrough: true,
		freePosition: true,
	});
});

test("keeps the Wayland fallback when Electron uses native Wayland", () => {
	const { detectPetWindowCaps } = loadModule({
		platform: "linux",
		env: {
			XDG_SESSION_TYPE: "wayland",
			WAYLAND_DISPLAY: "wayland-0",
			DISPLAY: ":0",
		},
		argv: ["electron", ".", "--ozone-platform=wayland"],
	});

	assert.deepEqual(JSON.parse(JSON.stringify(detectPetWindowCaps())), {
		transparent: false,
		clickThrough: true,
		freePosition: false,
	});
});

test("keeps the Wayland fallback when Electron selects ozone automatically", () => {
	const { detectPetWindowCaps } = loadModule({
		platform: "linux",
		env: {
			XDG_SESSION_TYPE: "wayland",
			WAYLAND_DISPLAY: "wayland-0",
			DISPLAY: ":0",
		},
		argv: ["electron", ".", "--ozone-platform=auto"],
	});

	assert.deepEqual(JSON.parse(JSON.stringify(detectPetWindowCaps())), {
		transparent: false,
		clickThrough: true,
		freePosition: false,
	});
});

test("uses restricted caps when the Linux display backend is unknown", () => {
	const { detectPetWindowCaps } = loadModule({
		platform: "linux",
		env: {},
		argv: ["electron", "."],
	});

	assert.deepEqual(JSON.parse(JSON.stringify(detectPetWindowCaps())), {
		transparent: false,
		clickThrough: true,
		freePosition: false,
	});
});

test("restricted Linux windows avoid transparent backgrounds and absolute positioning", async () => {
	const { PetWindow, MockBrowserWindow, getIntervalCalls } = loadModule({
		platform: "linux",
		env: {
			XDG_SESSION_TYPE: "wayland",
			WAYLAND_DISPLAY: "wayland-0",
		},
		argv: ["electron", ".", "--ozone-platform=auto"],
	});
	const petWindow = new PetWindow();

	await petWindow.create();
	assert.equal(MockBrowserWindow.last.options.backgroundColor, "#eef0f3");
	assert.equal("x" in MockBrowserWindow.last.options, false);
	assert.equal("y" in MockBrowserWindow.last.options, false);
	assert.equal(MockBrowserWindow.last.listeners.has("moved"), false);
	assert.equal(getIntervalCalls(), 0);

	petWindow.moveTo(300, 200);
	assert.equal(MockBrowserWindow.last.setBoundsCalls, 0);
});

test("patrol is disabled when free positioning is unavailable", () => {
	const source = readFileSync("src/main/pet/index.ts", "utf8");
	assert.match(
		source,
		/petPatrolEnabled[\s\S]{0,160}detectPetWindowCaps\(\)\.freePosition/,
	);
});
