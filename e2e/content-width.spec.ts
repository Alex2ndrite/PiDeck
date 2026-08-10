import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";

/**
 * 聊天内容宽度（百分比体系）E2E：
 * 1. 设置滑块 60–100 并存留白显示；
 * 2. 保存 80% 后，消息区与输入框共享同一宽度（≈80% chat-pane），消除「一边最大一边最小」；
 * 3. 窗口收窄（模拟分屏窄栏）→ 容器查询自动收敛到 100% 全宽，仅保留最小边距。
 */
test("content width: 80% shared margin, composer aligns with message list", async ({ window, app }) => {
	await expect(window.locator("#boot-overlay")).toHaveCount(0, { timeout: 20_000 });

	// ── 打开设置，滑块设为 80% ──
	await window.locator(".settings-icon").click();
	const modal = window.locator(".settings-modal");
	await expect(modal).toBeVisible();

	const slider = modal.locator('input[type="range"][aria-label="聊天内容宽度"]');
	await expect(slider).toBeVisible();
	await expect(slider).toHaveAttribute("min", "60");
	await expect(slider).toHaveAttribute("max", "100");
	await slider.fill("80");
	// 留白副显示：左右各 10%
	await expect(modal.getByText("左右留白各 10%")).toBeVisible();
	// 示意图内容区标注 80%
	await expect(modal.getByText("80%").first()).toBeVisible();

	// 保存按钮常驻可用（非 dirty 时禁用——刚改过所以可点）
	await modal.getByRole("button", { name: "保存" }).click();
	await modal.getByRole("button", { name: "关闭" }).first().click();
	await expect(modal).toHaveCount(0);

	// ── 新建会话，进入聊天视图 ──
	await window.getByRole("button", { name: "新建" }).first().click();
	const chatPane = window.locator(".chat-pane");
	await expect(chatPane).toBeVisible();
	const composer = window.locator(".composer-box");
	await expect(composer).toBeVisible({ timeout: 20_000 });
	// 空会话也有空消息列表容器（留白锚点）
	const messageList = window.locator(".message-list");
	await expect(messageList).toBeVisible({ timeout: 20_000 });

	// ── 断言：消息区与输入框同宽，且约为面板的 80% ──
	const paneBox = await chatPane.boundingBox();
	const msgBox = await messageList.boundingBox();
	const composerBox = await composer.boundingBox();
	expect(paneBox).not.toBeNull();
	expect(msgBox).not.toBeNull();
	expect(composerBox).not.toBeNull();

	const paneW = paneBox!.width;
	const msgW = msgBox!.width;
	const composerW = composerBox!.width;
	// 消息区 ≈ 输入框（共享同一留白，±2px 容差）
	expect(Math.abs(msgW - composerW)).toBeLessThanOrEqual(2);
	// 内容区 ≈ 80% 面板宽度（±3% 容差：含 24px 最小边距与边框）
	expect(msgW / paneW).toBeGreaterThan(0.76);
	expect(msgW / paneW).toBeLessThan(0.84);

	// ── 窗口收窄（模拟分屏窄栏）→ 容器查询收敛到 100% 全宽 ──
	await app.evaluate(({ BrowserWindow }) => {
		BrowserWindow.getAllWindows()[0]?.setSize(900, 720);
	});
	await window.waitForTimeout(400); // 容器查询 + padding 过渡
	const narrowMsgBox = await messageList.boundingBox();
	const narrowPaneBox = await chatPane.boundingBox();
	expect(narrowMsgBox).not.toBeNull();
	expect(narrowPaneBox).not.toBeNull();
	// 窄栏下不再留白：消息区 ≈ 面板（24px 最小边距以内）
	expect(narrowMsgBox!.width / narrowPaneBox!.width).toBeGreaterThan(0.92);
});
