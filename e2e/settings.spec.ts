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
	await expect(modal.getByText("Streamdown 渲染引擎")).toBeVisible();
	await expect(modal.getByText("内置浏览器 WebContentsView 管线（实验）")).toBeVisible();

	// 关闭（设置弹窗不响应 ESC，走显式关闭按钮；aria-label 来自 t("common.close")）
	await modal.getByRole("button", { name: "关闭" }).first().click();
	await expect(modal).toHaveCount(0);
});

/**
 * 主题色切换回归（issue #115 收尾时修复）：设置里改主题色必须立即生效——
 * 曾因 App.tsx applyTheme effect 依赖缺 settings.accent 导致 data-accent 不更新。
 */
test("accent switch applies data-accent immediately", async ({ window }) => {
	await expect(window.locator("#boot-overlay")).toHaveCount(0, { timeout: 20_000 });
	await expect(window.locator("html")).toHaveAttribute("data-accent", "default");

	await window.locator(".settings-icon").click();
	const modal = window.locator(".settings-modal");
	await expect(modal).toBeVisible();

	// 外观设置 tab：主题 Select（移入）→ 皮肤 → 主题色
	await modal.getByText("外观设置").click();
	// 皮肤切到石墨灰：data-skin 立即更新
	// 背景图字段渲染（选图/清除按钮存在；弹系统对话框不在 e2e 范围）
	await expect(modal.getByText("背景图片")).toBeVisible();
	await expect(modal.getByRole("button", { name: "选择图片…" })).toBeVisible();
	await modal.getByRole("combobox").filter({ hasText: "经典绿（出厂）" }).click();
	await window.getByRole("option", { name: "石墨灰" }).click();
	// 主题色 Select（显示当前值「清新绿」）
	await modal.getByRole("combobox").filter({ hasText: "默认" }).click();
	await window.getByRole("option", { name: "天空蓝" }).click();

	// 保存后即时生效：html[data-accent] 变为 blue（修复前停留在 green）
	await modal.getByRole("button", { name: "保存" }).click();
	await expect(window.locator("html")).toHaveAttribute("data-accent", "blue");
	await expect(window.locator("html")).toHaveAttribute("data-skin", "graphite");

	// 关闭弹窗后保持
	await modal.getByRole("button", { name: "关闭" }).first().click();
	await expect(modal).toHaveCount(0);
	await expect(window.locator("html")).toHaveAttribute("data-accent", "blue");
});
