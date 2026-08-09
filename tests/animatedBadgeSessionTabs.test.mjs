import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// ===== beui AnimatedBadge 组件拷贝 =====

test("animated-badge component copied with official markers", () => {
	const source = readFileSync(
		"src/renderer/src/components/motion/animated-badge.tsx",
		"utf8",
	);
	assert.match(source, /beui\.dev[\s\S]*animated-badge/);
	assert.match(source, /export type AnimatedBadgeStatus =[\s\S]*?\| "loading";/);
	assert.match(source, /export type AnimatedBadgeSize = "sm" \| "md"/);
	// 依赖：motion/react + 项目既有 @/lib/ease + @/lib/utils
	assert.match(source, /from "motion\/react"/);
	assert.match(source, /from "@\/lib\/ease"/);
	assert.match(source, /from "@\/lib\/utils"/);
	// 关键行为：loading 旋转、状态图标滚动、脉冲层
	assert.match(source, /animate=\{\{ rotate: 360 \}\}/);
	assert.match(source, /ICON_ROLL_VARIANTS/);
	assert.match(source, /pulse = status === "loading"/);
	// 与官方 API 对齐：showIcon / contentKey / size + PiDeck bare 扩展
	assert.match(source, /showIcon = true/);
	assert.match(source, /contentKey/);
	assert.match(source, /bare\?: boolean;/);
	assert.match(source, /bare && "h-auto gap-0 rounded-none border-0 bg-transparent p-0"/);
});

test("motion dependency and ease helpers available", () => {
	const pkg = readFileSync("package.json", "utf8");
	assert.match(pkg, /"motion": "\^13\.0\.0"/);
	const ease = readFileSync("src/renderer/src/lib/ease.ts", "utf8");
	assert.match(ease, /export const EASE_OUT/);
});

// ===== 会话 Tab 栏接入 =====

test("session tab uses AnimatedBadge instead of raw pulse dot", () => {
	const source = readFileSync(
		"src/renderer/src/components/session/SessionTabsBar.tsx",
		"utf8",
	);
	assert.match(source, /import \{ AnimatedBadge, type AnimatedBadgeStatus \} from "\.\.\/motion\/animated-badge";/);
	// 旧的裸圆点渲染已移除
	assert.doesNotMatch(source, /size-1\.5 shrink-0 rounded-full/);
	assert.doesNotMatch(source, /animate-pulse/);
	// 新渲染：bare 裸图标模式（无胶囊）+ [&_svg] 缩图标 + 运行中黄色覆盖
	assert.match(source, /<AnimatedBadge/);
	assert.match(source, /size="sm"/);
	assert.match(source, /bare/);
	assert.match(source, /pulse=\{false\}/);
	assert.match(source, /\[&_svg\]:h-2\.5 \[&_svg\]:w-2\.5/);
	assert.match(source, /text-amber-500 dark:text-amber-400/);
	// 状态映射（颜色语义：启动蓝旋转 / 运行黄旋转 / 未启动白 / 失败红）
	assert.match(source, /function sessionStatusBadge\(/);
	assert.match(source, /case "error":\s*\n\s*return \{ status: "danger" \};/);
	assert.match(source, /case "idle":\s*\n\s*return \{ status: "neutral" \};/);
	assert.match(source, /case "starting":\s*\n\s*return \{ status: "loading" \};/);
	assert.match(source, /case "running":\s*\n\s*case "pending":\s*\n\s*case "waiting":\s*\n\s*return \{\s*\n\s*status: "loading",/);
	assert.match(source, /if \(!status \|\| status === "detached"\) return undefined;/);
	// 激活指示条（tab 下方弧形横条）已移除
	assert.doesNotMatch(source, /session-tabs-indicator/);
	assert.doesNotMatch(source, /measureIndicator/);
	assert.doesNotMatch(source, /INDICATOR_BASE_WIDTH/);
});

test("sidebar SessionTree still uses its own status dot (unchanged)", () => {
	const source = readFileSync("src/renderer/src/components/sidebar/SessionTree.tsx", "utf8");
	assert.match(source, /sessionStatusDotClass/);
});
