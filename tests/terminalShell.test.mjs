import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";
import vm from "node:vm";

// .mjs 没有 CJS require；vm 沙箱内的 fallback require 必须显式创建。
const require = createRequire(import.meta.url);

function plain(value) {
	return JSON.parse(JSON.stringify(value));
}

function loadTerminalSessionManagerModule() {
	const source = readFileSync(
		"src/main/terminal/TerminalSessionManager.ts",
		"utf8",
	);
	const { outputText } = ts.transpileModule(source, {
		compilerOptions: {
			module: ts.ModuleKind.CommonJS,
			target: ts.ScriptTarget.ES2022,
			esModuleInterop: true,
		},
	});
	const sandbox = {
		exports: {},
		require: (name) => {
			if (name === "node-pty") return {};
			if (name === "node:crypto") return { randomUUID: () => "id" };
			if (name === "../../shared/ipc") return { ipcChannels: {} };
			// shell 检测依赖宿主环境（git-bash 路径、wsl.exe），桩掉以保证候选列表断言可复现；
			// existsSync=false / execSync 抛错 = 宿主未安装可选 shell 的最小环境。
			if (name === "node:fs") return { existsSync: () => false };
			if (name === "node:child_process") {
				return { execSync: () => { throw new Error("not available in test sandbox"); } };
			}
			return require(name);
		},
	};
	vm.runInNewContext(outputText, sandbox, {
		filename: "TerminalSessionManager.ts",
	});
	return sandbox.exports;
}

test("uses the macOS user shell as a login shell", () => {
	const { getTerminalShellCandidates } = loadTerminalSessionManagerModule();

	const candidates = getTerminalShellCandidates("darwin", {
		SHELL: "/bin/zsh",
		PATH: "/usr/bin:/bin",
	});

	assert.deepEqual(plain(candidates[0]), {
		shell: "zsh",
		command: "/bin/zsh",
		args: ["-l"],
	});
});

test("keeps Windows shell candidates unchanged", () => {
	const { getTerminalShellCandidates } = loadTerminalSessionManagerModule();

	const candidates = getTerminalShellCandidates("win32", {});

	assert.deepEqual(
		plain(candidates.map((candidate) => candidate.command)),
		["pwsh.exe", "powershell.exe", "cmd.exe"],
	);
	assert.deepEqual(
		plain(candidates.map((candidate) => candidate.args)),
		[[], [], []],
	);
});
