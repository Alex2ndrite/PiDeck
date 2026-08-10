import { test, expect } from "./fixtures";

/**
 * 设置弹窗：能从侧栏打开，开发设置 tab 含 Web 服务配置区。
 * 注：Streamdown 开关与「内置浏览器 WebContentsView 管线（实验）」开关
 * 已随 UI 2.0 设置弹窗重构移除（实验开关无字段/无文案残留），
 * 这里改断言仍保留的「Web 服务」配置区（含启用开关）。
 */
test("settings modal opens with web service dev section", async ({ window }) => {
	await expect(window.locator("#boot-overlay")).toHaveCount(0, { timeout: 20_000 });

	await window.locator(".settings-icon").click();
	const modal = window.locator(".settings-modal");
	await expect(modal).toBeVisible();

	// 实验开关在「开发设置」tab
	await modal.getByText("开发设置").click();

	// Web 服务配置区在开发设置内；文案走 i18n，默认 zh-CN
	await expect(modal.getByText("局域网 Web 服务")).toBeVisible();
	await expect(modal.getByText("启用 Web 服务")).toBeVisible();

	// 关闭（设置弹窗不响应 ESC，走显式关闭按钮；aria-label 来自 t("common.close")）
	await modal.getByRole("button", { name: "关闭" }).first().click();
	await expect(modal).toHaveCount(0);
});

/**
 * 主题色切换回归（issue #115 收尾时修复）：设置里改主题色必须立即生效——
 * 曾因 App.tsx applyTheme effect 依赖缺 settings.accent 导致 data-accent 不更新。
 * 注：UI 2.0 重构后皮肤（skin）已合并进外观主题（accent）选择器，
 * 不再有独立皮肤 Select，data-skin 由 settings.themeSkin 驱动（无 UI 可改），
 * 这里只验证 accent 即时生效。
 */
test("accent switch applies data-accent immediately", async ({ window }) => {
	await expect(window.locator("#boot-overlay")).toHaveCount(0, { timeout: 20_000 });
	await expect(window.locator("html")).toHaveAttribute("data-accent", "default");

	await window.locator(".settings-icon").click();
	const modal = window.locator(".settings-modal");
	await expect(modal).toBeVisible();

	// 外观设置 tab：主题 Select（系统/浅色/深色）→ 主题色（外观主题）
	await modal.getByText("外观设置").click();
	// 背景图字段渲染（选图/清除按钮存在；弹系统对话框不在 e2e 范围）
	await expect(modal.getByText("背景图片")).toBeVisible();
	await expect(modal.getByRole("button", { name: "选择图片…" })).toBeVisible();
	// 主题色 Select（显示当前值「黑白灰（默认）」）
	await modal.getByRole("combobox").filter({ hasText: "黑白灰（默认）" }).click();
	await window.getByRole("option", { name: "天空蓝" }).click();

	// 保存后即时生效：html[data-accent] 变为 blue（修复前停留在 green）
	await modal.getByRole("button", { name: "保存" }).click();
	await expect(window.locator("html")).toHaveAttribute("data-accent", "blue");

	// 关闭弹窗后保持
	await modal.getByRole("button", { name: "关闭" }).first().click();
	await expect(modal).toHaveCount(0);
	await expect(window.locator("html")).toHaveAttribute("data-accent", "blue");
});
