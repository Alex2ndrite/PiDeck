import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * 低成本体验包（借鉴 Vercel AI Elements）：
 * 1. Shimmer 微光文本——RespondingIndicator 进行态标签用渐变扫光提示活动进行中；
 * 2. 思考耗时人性化——ThinkingBlock 展示「思考了 Xs / Thought for Xs」，不再裸显工程化数字。
 */

const shimmerSource = readFileSync(
	"src/renderer/src/components/session/ShimmerText.tsx",
	"utf8",
);
const cardsSource = readFileSync(
	"src/renderer/src/components/session/TimelineEventCards.tsx",
	"utf8",
);
const timelineCss = readFileSync("src/renderer/src/styles/timeline.css", "utf8");
const zhCN = readFileSync("src/renderer/src/i18n/rendererCopy.zh-CN.ts", "utf8");
const enUS = readFileSync("src/renderer/src/i18n/rendererCopy.en-US.ts", "utf8");

test("ShimmerText 零依赖 CSS 实现：bg-clip-text + Tailwind 动画，不新增手写 CSS class", () => {
	assert.match(shimmerSource, /export function ShimmerText/);
	assert.match(shimmerSource, /bg-clip-text text-transparent/);
	// 动画走 Tailwind 工具类 + motion-safe（reduced-motion 退化为静态文本）
	assert.match(shimmerSource, /motion-safe:animate-\[shimmer-sweep/);
	// 明暗取语义 token，暗色模式自适应
	assert.match(shimmerSource, /--color-text-tertiary/);
	assert.match(shimmerSource, /--color-text-primary/);
	assert.match(shimmerSource, /--color-warning/);
	// 不引第三方动画库（零依赖约束）
	assert.doesNotMatch(shimmerSource, /from "(framer-motion|motion|gsap)/);
});

test("shimmer-sweep keyframes 定义在 timeline.css（规则允许 keyframes）", () => {
	assert.match(timelineCss, /@keyframes shimmer-sweep/);
});

test("RespondingIndicator 进行态标签使用微光，waiting 态保留静态隐藏标签", () => {
	// 以「下一个顶层导出」为边界截取函数体，避免函数内部嵌套花括号导致正则过早截断
	const start = cardsSource.indexOf("export function RespondingIndicator");
	const indicator = cardsSource.slice(
		start,
		cardsSource.indexOf("\nexport ", start + 10) || undefined,
	);
	assert.ok(indicator, "RespondingIndicator must exist");
	assert.match(indicator, /ShimmerText/);
	// 启动中/工具执行中保持琥珀色状态位，回应中用普通明暗
	assert.match(indicator, /tone=\{kind === "responding" \? "muted" : "warning"\}/);
	// waiting 态不走微光（CSS visibility 隐藏，保持容器宽度稳定）
	assert.match(indicator, /kind === "waiting"/);
	// 标签布局类保留（min-width 稳定宽度）
	assert.match(indicator, /responding-indicator-label/);
});

test("ThinkingBlock 耗时改人性化 i18n 文案，不再裸显数字", () => {
	const block = cardsSource.match(
		/function ThinkingBlock[\s\S]*?\n\t\},\n/,
	)?.[0] ?? "";
	assert.ok(block, "ThinkingBlock must exist");
	assert.match(block, /thinking\.duration/);
	// 耗时仍由 startedAt/endedAt 计算
	assert.match(block, /formatDuration\(durationMs\)/);
});

test("thinking.duration 文案中英同步", () => {
	assert.match(zhCN, /"thinking\.duration": "思考了 \{duration\}"/);
	assert.match(enUS, /"thinking\.duration": "Thought for \{duration\}"/);
});
