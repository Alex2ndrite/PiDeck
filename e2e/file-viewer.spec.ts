import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, expect } from "./mock-pi-fixture";

/**
 * 右侧抽屉文件查看回归（修复三个问题）：
 * 1. 点文件查看 → 抽屉模式必须有返回键（此前 modal 模式下点文件开 modal 且无返回键）；
 * 2. 展开到 modal → 最小化回抽屉必须生效（此前 updater 内嵌套 setDrawer 被丢弃）；
 * 3. Monaco 首次加载空白由 loading fallback 覆盖（视觉项，此处验证渲染链路）。
 */

// 预置带文件的项目目录
const projectDir = mkdtempSync(join(tmpdir(), "pideck-fv-"));
writeFileSync(join(projectDir, "hello.ts"), "export const hello = 1;\n");

test.use({
	seedProjects: [{ id: "p1", name: "file-viewer", path: projectDir }],
});

test("drawer file viewer: back button + modal minimize roundtrip", async ({ window }) => {
	await expect(window.locator("#boot-overlay")).toHaveCount(0, { timeout: 20_000 });

	// 进入预置项目：侧栏项目显示目录名（pideck-fv-*）
	const projectItem = window.locator(".conversation", { hasText: "pideck-fv-" }).first();
	await expect(projectItem).toBeVisible({ timeout: 20_000 });
	await projectItem.click();
	// 项目 select 后：点项目行的「新建 Agent」进入会话视图（main 无会话时空）
	const projectRow = window.locator(".conversation", { hasText: "pideck-fv-" }).first();
	await projectRow.hover();
	await projectRow.locator(".project-action").nth(1).click().catch(async () => {
		await projectRow.locator(".project-action").last().click();
	});
	// 打开右侧抽屉（files 面板）
	const toggle = window.locator(".header-drawer-toggle").first();
	await expect(toggle).toBeVisible();
	await toggle.click();
	const drawer = window.locator(".detail-drawer");
	await expect(drawer).toHaveAttribute("data-open", "true");

	// 刷新文件树后点击文件 → 抽屉模式打开查看器
	const refreshButton = drawer.getByRole("button", { name: /刷新/ }).first();
	await refreshButton.click().catch(() => undefined);
	const fileRow = drawer.locator(".file-node-row", { hasText: "hello.ts" }).first();
	await expect(fileRow).toBeVisible({ timeout: 15_000 });
	await fileRow.click();

	// 查看器出现（drawer 模式）+ 返回键存在（修复 2）
	await expect(drawer.locator(".file-diff-title")).toHaveText("hello.ts", { timeout: 15_000 });
	const backButton = drawer.getByRole("button", { name: "返回" });
	await expect(backButton).toBeVisible();

	// 展开到 modal（最大化）→ 最小化回抽屉必须重新出现（修复 1）
	await drawer.getByRole("button", { name: "弹出窗口" }).click().catch(async () => {
		await drawer.locator(".file-diff-toggle-btn").last().click();
	});
	const modalMinimize = window.getByRole("button", { name: "最小化到侧栏" });
	await expect(modalMinimize).toBeVisible({ timeout: 10_000 });
	await modalMinimize.click();
	// 抽屉重新显示查看器
	await expect(drawer.locator(".file-diff-title")).toHaveText("hello.ts", { timeout: 15_000 });
	await expect(drawer).toHaveAttribute("data-open", "true");
});
