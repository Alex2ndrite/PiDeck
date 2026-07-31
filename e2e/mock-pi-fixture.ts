import { test as base, expect, _electron as electron, type ElectronApplication, type Page } from "@playwright/test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

/**
 * Mock pi fixture（#115 U6）：在隔离 userData 中预置 settings.json，
 * 把 customPiPath 指向 e2e/mock-pi.cjs 的 .cmd shim，让应用走真实
 * spawn + stdio JSON-RPC 链路，但不需要安装真实 pi / 不访问网络。
 */
export type MockPiFixture = {
	app: ElectronApplication;
	window: Page;
};

const repoRoot = resolve(__dirname, "..");

export const test = base.extend<MockPiFixture>({
	app: async ({}, use) => {
		const userDataRoot = mkdtempSync(join(tmpdir(), "pideck-mockpi-"));
		try {
			// Windows 桌面端通过 cmd shim 调起自定义 pi（见 PiLocator.createInvocation），
			// 这里生成一个指向本仓库 mock-pi.cjs 的 shim；node 用当前进程的解释器绝对路径。
			const shimPath = join(userDataRoot, "mock-pi.cmd");
			const scriptPath = join(repoRoot, "e2e", "mock-pi.cjs");
			writeFileSync(
				shimPath,
				`@echo off\r\n"${process.execPath}" "${scriptPath}" %*\r\n`,
			);
			// 预置设置：customPiPath 指向 shim；piEnvironmentChecked=true 跳过启动
			// 环境检测弹窗（否则会盖住欢迎页按钮造成点击竞态）。其余字段缺省。
			// 注意：未打包运行时 main/index.ts 会把 userData 追加 "-dev" 后缀，
			// 真实 userData 是 <root>/profile-dev（与 fixtures.ts 的隔离机制一致）。
			mkdirSync(join(userDataRoot, "profile-dev"), { recursive: true });
			writeFileSync(
				join(userDataRoot, "profile-dev", "settings.json"),
				JSON.stringify({ customPiPath: shimPath, piEnvironmentChecked: true }),
			);

			const env = {
				...process.env,
				CI: "1",
				...(process.platform === "win32"
					? { APPDATA: userDataRoot }
					: process.platform === "darwin"
						? { HOME: userDataRoot }
						: { XDG_CONFIG_HOME: userDataRoot, HOME: userDataRoot }),
			};
			delete env.ELECTRON_RENDERER_URL;
			const app = await electron.launch({
				args: [join(repoRoot, "out", "main", "index.js"), `--user-data-dir=${join(userDataRoot, "profile")}`],
				env,
			});
			await use(app);
			await app.close();
		} finally {
			// 调试可用 PIDECK_E2E_KEEP=1 保留 userData（含主进程日志），排查 spawn/状态问题
			if (!process.env.PIDECK_E2E_KEEP) {
				try { rmSync(userDataRoot, { recursive: true, force: true }); } catch { /* Windows 文件锁，忽略 */ }
			} else {
				console.log("[mock-pi-fixture] kept userDataRoot:", userDataRoot);
			}
		}
	},
	window: async ({ app }, use) => {
		const window = await app.firstWindow();
		await window.waitForLoadState("domcontentloaded");
		await use(window);
	},
});

export { expect } from "@playwright/test";
