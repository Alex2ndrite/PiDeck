import { test, expect } from "./mock-pi-fixture";

/**
 * 会话路径完整流程（#113 3.2-5/6、#115 U6）：
 * 新建会话 → 发送消息 → 流式渲染 → 完成 → 再发 → 中途停止。
 * 全程走真实 spawn + stdio JSON-RPC（mock pi），不依赖网络与真实 pi。
 */
test("agent flow: prompt -> streaming -> done -> prompt -> abort", async ({ window }) => {
	test.setTimeout(120_000);
	await expect(window.locator("#boot-overlay")).toHaveCount(0, { timeout: 20_000 });

	// 1. 内置聊天项目欢迎页：启动 Agent（spawn mock pi）
	await window.getByRole("button", { name: "启动 Agent" }).click();

	// 2. agent 就绪后 composer 可用（get_state 完成前 RichInput 处于 disabled）
	const composer = window.locator(".composer .rich-input");
	await expect(composer).toHaveAttribute("aria-disabled", "false", { timeout: 30_000 });

	// 3. 发送第一条消息：流式渲染 → 完整回复
	await composer.click();
	await window.keyboard.type("你好 mock");
	await window.keyboard.press("Enter");

	const timeline = window.locator(".message-timeline");
	// 流式中间态：完整标记未出现前，部分内容应已可见
	await expect(timeline).toContainText("Mock 回复：「你好 mock」", { timeout: 15_000 });
	// 完整收尾
	await expect(timeline).toContainText("流式渲染验证完成", { timeout: 15_000 });

	// 4. 第二条消息（慢速流），中途点击「停止」
	await composer.click();
	await window.keyboard.type("SLOW 第二段");
	await window.keyboard.press("Enter");

	const stopButton = window.getByRole("button", { name: "停止" });
	await expect(stopButton).toBeVisible({ timeout: 10_000 });
	// 等到第二段开始流式输出再停止，覆盖"流式中中止"路径
	await expect(timeline).toContainText("Mock 回复：「SLOW 第二段」", { timeout: 10_000 });
	await stopButton.click();

	// 5. 停止后回到空闲：发送按钮回归；第二段不应出现完整收尾标记
	const sendButton = window.locator(".composer-bar-btn.send");
	await expect(sendButton).toBeVisible({ timeout: 10_000 });
	await window.waitForTimeout(1500); // 给残留流 1.5s 窗口，验证封印生效
	await expect(timeline).not.toContainText("SLOW 第二段」流式渲染验证完成");
});
