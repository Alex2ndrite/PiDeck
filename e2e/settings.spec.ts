import { test, expect } from "./fixtures";

/**
 * 设置弹窗：能从侧栏打开，包含 UI 2.0 三个实验开关（默认关闭、可回退）。
 */
test("settings modal opens with experimental UI 2.0 switches", async ({ window }) => {
	await expect(window.locator("#boot-overlay")).toHaveCount(0, { timeout: 20_000 });

	await window.locator(".settings-icon").click();
	const modal = window.locator(".settings-modal");
	await expect(modal).toBeVisible();

	// 实验开关在「开发设置」tab
	await modal.getByText("开发设置").click();

	// 实验开关在开发者区域；文案走 i18n，默认 zh-CN
	await expect(modal.getByText("Streamdown 渲染引擎（实验）")).toBeVisible();
	await expect(modal.getByText("内置浏览器 WebContentsView 管线（实验）")).toBeVisible();

	// 关闭（设置弹窗不响应 ESC，走显式关闭按钮；aria-label 来自 t("common.close")）
	await modal.getByRole("button", { name: "关闭" }).first().click();
	await expect(modal).toHaveCount(0);
});
