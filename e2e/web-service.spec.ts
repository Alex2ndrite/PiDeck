import { test, expect } from "./mock-pi-fixture";

/**
 * Web 服务 React 前端（A2）端到端：
 * fixture 预置 webServiceEnabled=true + webServicePort=8765（见 mock-pi-fixture）。
 * 1) GET / 返回 React 版 web.html（A2 入口，含 /api/chat 接线）
 * 2) 点击内置聊天项目 → 创建会话 → 发消息 → mock pi 流式 text_delta → useChat 渲染完整回复
 */
test.use({
	seedSettings: {
		webServiceEnabled: true,
		webServiceHost: "127.0.0.1",
		webServicePort: 8765,
	},
});

async function waitForHealthy(baseUrl: string): Promise<boolean> {
	for (let attempt = 0; attempt < 40; attempt += 1) {
		await new Promise((resolve) => setTimeout(resolve, 500));
		const health = await fetch(`${baseUrl}/api/health`).catch(() => null);
		if (health?.ok) return true;
	}
	return false;
}

test("web service: React chat loads and streams via /api/chat", async ({ app }) => {
	test.setTimeout(120_000);

	const baseUrl = "http://127.0.0.1:8765";
	expect(await waitForHealthy(baseUrl)).toBe(true);

	// 主窗口导航到 Web 服务根路径（Electron context 不支持 newPage）
	const page = await app.firstWindow();
	await page.goto(baseUrl);
	await expect(page.locator(".app")).toBeVisible({ timeout: 20_000 });
	await expect(page.locator("textarea#prompt")).toBeVisible();
	// 项目列表由 /api/state 轮询填充（内置聊天项目）
	await expect(page.locator(".section-title").first()).toContainText(/项目|Projects/);

	// 点击项目创建会话（内置聊天项目 → POST /api/sessions）
	const projectItem = page.locator(".item").first();
	await projectItem.click();
	// 会话列表出现一项（active）
	await expect(page.locator(".item.active")).toHaveCount(1, { timeout: 20_000 });

	// 发送消息 → useChat 走 /api/chat → mock pi 流式 text_delta → 打字机渲染
	const textarea = page.locator("textarea#prompt");
	await textarea.fill("你好 web");
	await page.keyboard.press("Enter");

	// 流式中间态 + 完整收尾（mock pi 回复含固定文案）；用 getByText 避免多消息 strict 冲突
	const assistantText = page.locator(".message.assistant");
	await expect(assistantText).toContainText("Mock 回复：「你好 web」", { timeout: 30_000 });
	await expect(assistantText).toContainText("流式渲染验证完成", { timeout: 30_000 });
});
