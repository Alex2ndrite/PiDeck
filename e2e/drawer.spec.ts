import { test, expect } from "./fixtures";

/**
 * 右侧抽屉 + 活动栏（#113 parity 修复的回归守卫）：
 * 打开抽屉默认 files；活动栏可切 browser 并切回。
 * 注：全新 userData 无项目，git 入口需要项目上下文，这里只断言 files/browser。
 */
test("right drawer opens on files and the activity rail switches panels", async ({ window }) => {
	await expect(window.locator("#boot-overlay")).toHaveCount(0, { timeout: 20_000 });

	// 全新 profile 无会话：先点侧栏内置「聊天」项目进入 Chat 面，头部抽屉开关才出现
	await window.locator(".conversation.chat-project").first().click();
	const toggle = window.locator(".header-drawer-toggle").first();
	await expect(toggle).toBeVisible();
	await toggle.click();

	const drawer = window.locator(".detail-drawer");
	await expect(drawer).toHaveAttribute("data-open", "true");
	// 活动栏常驻：files/browser 两个入口
	const filesTab = window.getByTestId("drawer-rail-files");
	const browserTab = window.getByTestId("drawer-rail-browser");
	await expect(filesTab).toBeVisible();
	await expect(browserTab).toBeVisible();
	await expect(filesTab).toHaveAttribute("aria-selected", "true");

	// 切到浏览器面板
	await browserTab.click();
	await expect(browserTab).toHaveAttribute("aria-selected", "true");

	// 切回文件面板
	await filesTab.click();
	await expect(filesTab).toHaveAttribute("aria-selected", "true");
});
