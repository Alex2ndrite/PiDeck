import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * 聊天内容宽度（百分比体系）E2E：
 * 1. 设置滑块 60–100；
 * 2. 保存 85% 后，消息区与输入框共享当前会话栏宽度（≈85%），消除「一边最大一边最小」；
 * 3. 将 solo 会话栏约束为窄栏（模拟分屏）→ 容器查询自动收敛到 100% 全宽，仅保留最小边距。
 *
 * 注意：Windows 上 app.getPath("appData") 不随 APPDATA 环境变量变化，fixtures 的
 * 临时目录隔离对 main/index.ts:50 的显式 setPath 无效 → E2E 直接读写真实 userData。
 * 因此本测试在开始前备份真实 settings.json，结束后原样恢复，绝不污染用户设置。
 */
const settingsPath = join(process.env.APPDATA!, "pi-desktop-dev", "settings.json");

test("content width: 85% shared margin, composer aligns with message list", async ({ window }) => {
	const backup = readFileSync(settingsPath, "utf8");
	try {
		await expect(window.locator("#boot-overlay")).toHaveCount(0, { timeout: 20_000 });

		// ── 打开设置，切到外观设置 tab，滑块设为 85% ──
		await window.locator(".settings-icon").click();
		const modal = window.locator(".settings-modal");
		await expect(modal).toBeVisible();
		await modal.getByText("外观设置").click();

		const slider = modal.locator('input[type="range"][aria-label="聊天内容宽度"]');
		await expect(slider).toBeVisible();
		await expect(slider).toHaveAttribute("min", "60");
		await expect(slider).toHaveAttribute("max", "100");
		// fill() 对 range input 不触发 React onChange，用原生 value setter + 事件派发
		await slider.evaluate((el) => {
			const setter = Object.getOwnPropertyDescriptor(
				window.HTMLInputElement.prototype,
				"value",
			)!.set!;
			setter.call(el, "85");
			el.dispatchEvent(new Event("input", { bubbles: true }));
			el.dispatchEvent(new Event("change", { bubbles: true }));
		});
		// 滑块右侧显示当前百分比（85 为非默认值，验证 onChange 生效）
		await expect(modal.getByText("85%", { exact: true })).toBeVisible();

		// 保存按钮常驻可用（非 dirty 时禁用——刚改过所以可点）
		await modal.getByRole("button", { name: "保存" }).click();
		await modal.getByRole("button", { name: "关闭" }).first().click();
		await expect(modal).toHaveCount(0);

		// ── 展开项目树（新窗口默认折叠），打开历史会话（只读，不发送不写盘）──
		const expandAll = window.getByRole("button", { name: "展开全部项目" });
		if (await expandAll.count()) await expandAll.click();
		const historyRow = window.locator(".conversation.agent-row").first();
		await expect(historyRow).toBeVisible({ timeout: 20_000 });
		await historyRow.click();
		const sessionPane = window.locator(".session-split-solo, .session-split-pane").first();
		await expect(sessionPane).toBeVisible();
		const composer = window.locator(".composer-box");
		await expect(composer).toBeVisible({ timeout: 20_000 });
		// 历史会话有消息 → 消息列表容器（留白锚点）
		const messageList = window.locator(".message-list");
		await expect(messageList).toBeVisible({ timeout: 20_000 });

		// ── 断言：消息区与输入框同宽，且约为当前会话栏的 85% ──
		const paneBox = await sessionPane.boundingBox();
		const msgBox = await messageList.boundingBox();
		const composerBox = await composer.boundingBox();
		expect(paneBox).not.toBeNull();
		expect(msgBox).not.toBeNull();
		expect(composerBox).not.toBeNull();

		const paneW = paneBox!.width;
		const msgW = msgBox!.width;
		// composer 含左右留白 padding，取 content-box 与消息区对比
		const composerPad = await composer.evaluate((el) => {
			const cs = getComputedStyle(el);
			return parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
		});
		const composerContentW = composerBox!.width - composerPad;
		// 消息区 ≈ 输入框内容区（共享同一留白；timeline 滚动条约 10px，容差 14px）
		expect(Math.abs(msgW - composerContentW)).toBeLessThanOrEqual(14);
		// 内容区 ≈ 85% 面板宽度（±4% 容差：含 24px 最小边距与边框）
		expect(msgW / paneW).toBeGreaterThan(0.81);
		expect(msgW / paneW).toBeLessThan(0.89);

		// ── 约束当前会话栏（模拟分屏）→ 栏级容器查询收敛到 100% ──
		await sessionPane.evaluate((element) => {
			const pane = element as HTMLElement;
			pane.style.flex = "0 0 900px";
			pane.style.width = "900px";
		});
		await window.waitForTimeout(400); // 容器查询 + padding 过渡
		const narrowMsgBox = await messageList.boundingBox();
		const narrowPaneBox = await sessionPane.boundingBox();
		expect(narrowMsgBox).not.toBeNull();
		expect(narrowPaneBox).not.toBeNull();
		// 窄栏下不再留白：消息区 ≈ 面板（24px 最小边距以内）
		expect(narrowMsgBox!.width / narrowPaneBox!.width).toBeGreaterThan(0.92);
	} finally {
		// 原样恢复用户设置（应用关闭后 SettingsStore 不会再写盘）
		writeFileSync(settingsPath, backup, "utf8");
	}
});
