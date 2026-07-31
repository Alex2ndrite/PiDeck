import { test, expect } from "./fixtures";

/**
 * 布局手动项自动化（#113 3.3-11）：
 * 左侧栏折叠/展开；右侧抽屉开关、切换 files/git/browser、钉住。
 * （3.3-12 终端 Dock 见 layout-terminal.spec.ts，需要 mock pi agent。）
 */

test("layout: sidebar collapse/expand", async ({ window }) => {
	await expect(window.locator("#boot-overlay")).toHaveCount(0, { timeout: 20_000 });
	const sidebar = window.locator(".shell-panel-list");
	await expect(sidebar).toBeVisible();
	const widthBefore = (await sidebar.boundingBox())!.width;

	// 折叠
	await window.getByRole("button", { name: "折叠列表" }).click();
	const expandButton = window.getByRole("button", { name: "展开列表" });
	await expect(expandButton).toBeVisible({ timeout: 3000 });
	const widthCollapsed = (await sidebar.boundingBox())!.width;
	expect(widthCollapsed).toBeLessThan(widthBefore);

	// 展开还原
	await expandButton.click();
	await expect(window.getByRole("button", { name: "折叠列表" })).toBeVisible({ timeout: 3000 });
	const widthRestored = (await sidebar.boundingBox())!.width;
	expect(widthRestored).toBeGreaterThan(widthCollapsed);
});

test("layout: drawer open/switch/pin", async ({ window }) => {
	await expect(window.locator("#boot-overlay")).toHaveCount(0, { timeout: 20_000 });
	await window.locator(".conversation.chat-project").first().click();
	await window.locator(".header-drawer-toggle").first().click();

	const drawer = window.locator(".detail-drawer");
	await expect(drawer).toHaveAttribute("data-open", "true", { timeout: 5000 });

	// 钉住：data-pinned 翻转，取消后还原（pin 按钮在 files 面板头部，
	// 切到其他 tab 后不渲染，必须在切换 tab 之前验证）
	const pinButton = window.getByRole("button", { name: "固定当前 Agent 的抽屉" });
	await pinButton.click();
	await expect(drawer).toHaveAttribute("data-pinned", "true", { timeout: 3000 });
	const unpinButton = window.getByRole("button", { name: "取消固定抽屉" });
	await unpinButton.click();
	await expect(drawer).toHaveAttribute("data-pinned", "false", { timeout: 3000 });

	// 切换 tab：点击当前未选中的 tab，aria-selected 随之移动；
	// 注意点击已激活 tab 会折叠抽屉（toggle 语义），不能乱点。
	const rail = window.locator(".drawer-activity-rail");
	const tabs = rail.locator("[role='tab']");
	const count = await tabs.count();
	expect(count).toBeGreaterThanOrEqual(2);
	const activeIndex = await tabs.evaluateAll(
		(list) => list.findIndex((el) => el.getAttribute("aria-selected") === "true"),
	);
	const nextIndex = activeIndex === 0 ? 1 : 0;
	await tabs.nth(nextIndex).click();
	await expect(tabs.nth(nextIndex)).toHaveAttribute("aria-selected", "true", { timeout: 3000 });
});
