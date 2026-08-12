import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import vm from "node:vm";

// 官方 BeUI Todo List 迁移后：组件源码在 agents/todo-list.tsx（官方结构忠实拷贝），
// widget 行→TodoItem 的解析器移入 session/agentTodoParser.ts（纯函数）。
// 本测试验证官方组件结构/行为要点 + 解析器映射行为，不挂载真实 React。

function compile(filePath, stubs = {}) {
	const source = readFileSync(filePath, "utf8");
	const output = ts.transpileModule(source, {
		compilerOptions: {
			module: ts.ModuleKind.CommonJS,
			target: ts.ScriptTarget.ES2022,
			esModuleInterop: true,
			jsx: ts.JsxEmit.ReactJSX,
		},
		fileName: filePath,
	}).outputText;
	const module = { exports: {} };
	const localRequire = (specifier) => stubs[specifier] ?? {};
	vm.runInNewContext(output, {
		module,
		exports: module.exports,
		require: localRequire,
		console,
	}, { filename: filePath });
	return module.exports;
}

const todoListPath = "src/renderer/src/components/agents/todo-list.tsx";
const parserPath = "src/renderer/src/components/session/agentTodoParser.ts";
const source = (path) => readFileSync(path, "utf8");
const todoListSource = () => source(todoListPath);

test("official BeUI TodoList source is placed in agents/ with official structure", () => {
	const src = todoListSource();
	// 官方导出与 API
	assert.match(src, /export function TodoList\(/);
	assert.match(src, /export type TodoItemStatus/);
	for (const status of ["pending", "in-progress", "completed", "cancelled"]) {
		assert.ok(src.includes(`"${status}"`), `status ${status} must exist in TodoItemStatus`);
	}
	assert.match(src, /export interface TodoItem/);
	assert.match(src, /export interface TodoListProps/);
	assert.match(src, /collapseOnComplete\?: boolean/);
	assert.match(src, /maxHeight\?: number/);
	// 官方依赖的 sibling 源码与共享运动常量
	assert.match(src, /from "@\/components\/agents\/agent-disclosure"/);
	assert.match(src, /from "@\/components\/motion\/action-swap-roll"/);
	assert.match(src, /from "@\/lib\/ease"/);
	assert.match(src, /EASE_OUT/);
	assert.match(src, /SPRING_LAYOUT/);
	assert.match(src, /SPRING_SWAP/);
	// 官方行为要点：完成计数 / 全部完成自动折叠 + 新工作重新展开 / 状态图标动画 / reduced-motion
	assert.match(src, /ActionSwapRollText value=\{String\(completed\)\}/);
	assert.match(src, /previousComplete\.current && !allComplete/);
	assert.match(src, /collapseOnComplete\)\s*\{\s*setOpen\(false\)/);
	assert.match(src, /useReducedMotion/);
	// 产品取舍（2026-12 用户要求）：已完成项去掉官方删除线，对勾标记已足够；
	// 与文件头部适配注释同步，防止 CLI 覆盖/误删时把这条偏离当意外改动
	assert.doesNotMatch(src, /scaleX: status === "completed" \? 1 : 0/);
	assert.match(src, /AnimatePresence initial=\{false\} mode="popLayout"/);
	// 无障碍：disclosure 语义（trigger/content id、aria-expanded、aria-labelledby）
	assert.match(src, /aria-expanded=\{currentOpen\}/);
	assert.match(src, /aria-controls=\{contentId\}/);
	// 用户可见文案必须走 i18n，不允许英文硬编码
	assert.match(src, /t\("app\.todoListTitle"\)/);
	assert.match(src, /t\("app\.todoListEmpty"\)/);
	assert.match(src, /t\("app\.todoListAriaLabel"\)/);
	assert.doesNotMatch(src, />No tasks yet</);
	assert.doesNotMatch(src, />To-dos</);
});

test("compact variant is optional, defaults to official classes, and uses PiDeck tokens", () => {
	const src = todoListSource();
	// compact 是可选开关：接口声明 + 默认 false → 不传时官方类/行为完全不变
	assert.match(src, /compact\?: boolean/);
	assert.match(src, /compact = false/);

	// 抽出所有 `compact ? "紧凑类" : "官方类"` 变体对，逐一校验
	const pairs = [...src.matchAll(/compact \? "([^"]*)" : "([^"]*)"/g)];
	assert.ok(pairs.length >= 7, `expected >= 7 compact ternaries, got ${pairs.length}`);

	// 官方默认分支保留官方原始类（h-11 / text-sm / text-xs / min-h-9 等）
	const official = pairs.map(([, , o]) => o).join(" ");
	assert.match(official, /h-11 gap-2\.5 px-3\.5/);
	assert.match(official, /text-sm/);
	assert.match(official, /text-xs/);
	assert.match(official, /min-h-9 gap-2\.5/);
	assert.match(official, /size-3\.5/);

	// compact 分支禁止使用 raw text-sm/text-xs，必须走 PiDeck 语义字号 token
	for (const [, compactCls] of pairs) {
		assert.ok(
			!/text-(sm|xs)/.test(compactCls),
			`compact variant must not use raw text-sm/text-xs: "${compactCls}"`,
		);
	}
	const compact = pairs.map(([c]) => c).join(" ");
	assert.match(compact, /text-control/); // 标题/条目正文
	assert.match(compact, /text-caption/); // 计数/详情/空态
	assert.match(compact, /h-9 gap-2 pl-3 pr-8/); // 头部收紧 + 宿主关闭按钮预留角
	assert.match(compact, /min-h-8 gap-2/); // 行距收紧

	// 动画 / 自动折叠 / 无障碍语义不受 compact 影响
	assert.match(src, /useReducedMotion/);
	assert.match(src, /previousComplete\.current && !allComplete/);
	assert.match(src, /aria-expanded=\{currentOpen\}/);
	// 已完成项无删除线（2026-12 产品取舍，见文件头部适配注释）
	assert.doesNotMatch(src, /scaleX: status === "completed" \? 1 : 0/);
});

test("official sibling helpers exist with required exports", () => {
	const disclosure = source("src/renderer/src/components/agents/agent-disclosure.tsx");
	assert.match(disclosure, /export function AgentDisclosure/);
	assert.match(disclosure, /inert=\{!open\}/);

	const swap = source("src/renderer/src/components/motion/action-swap.tsx");
	assert.match(swap, /export function ActionSwapButton/);
	assert.match(swap, /export function ActionSwapText/);
	assert.match(swap, /export function ActionSwapIcon/);

	const roll = source("src/renderer/src/components/motion/action-swap-roll.tsx");
	assert.match(roll, /export function ActionSwapRollText/);
	assert.match(roll, /animation="roll"/);

	const ease = source("src/renderer/src/lib/ease.ts");
	assert.match(ease, /export const SPRING_SWAP/);
	assert.match(ease, /export const SPRING_PRESS/);
	assert.match(ease, /export const EASE_OUT_CSS/);
});

// 与 sessionWidgetChips.test.mjs 相同的 TSX 编译替身模式：只测公开 parser 行为。
// agentTodoParser.ts 只 import type（编译期擦除），vm 运行时无外部依赖。
function loadParser() {
	return compile(parserPath, {});
}

test("parser maps widget lines to official TodoItem status shape", () => {
	const { parseAgentTodoItems } = loadParser();
	// 真实 pi-deck-todo 扩展输出：分组标题 + 带 #id 的条目
	const items = parseAgentTodoItems([
		"── 待办 ──",
		"☐ #1 修复登录页样式",
		"◐ #2 重构请求层",
		"── 已完成 ──",
		"☑ #3 审查 PR",
	]);
	assert.equal(items.length, 3);
	assert.equal(items[0].title, "修复登录页样式");
	assert.equal(items[0].status, "pending");
	assert.equal(items[1].title, "重构请求层");
	assert.equal(items[1].status, "in-progress");
	assert.equal(items[2].title, "审查 PR");
	assert.equal(items[2].status, "completed");
});

test("parser skips collapsed summaries, plan progress lines and section headers", () => {
	const { parseAgentTodoItems } = loadParser();
	// todo 折叠态只回一行 "2/4"
	assert.equal(parseAgentTodoItems(["2/4"]).length, 0);
	// plan 扩展首行 "计划进度 1/3" 不是列表项
	const plan = parseAgentTodoItems([
		"计划进度 1/3",
		"☑ 1. 设计 schema",
		"☐ 2. 实现迁移",
	]);
	assert.equal(plan.length, 2);
	// 标题行与空行不产生 pending 项（旧实现会误解析成列表项）
	assert.equal(parseAgentTodoItems(["── 待办 ──", "   ", ""]).length, 0);
});

test("parser strips todo #ids and plan numbering from titles", () => {
	const { parseAgentTodoItems } = loadParser();
	const todo = parseAgentTodoItems(["☐ #7 写文档"]);
	assert.equal(todo[0].title, "写文档");
	const plan = parseAgentTodoItems(["☐ 12. 发版"]);
	assert.equal(plan[0].title, "发版");
	// 只有标记没有正文的行不产生列表项
	assert.equal(parseAgentTodoItems(["☑"]).length, 0);
});

test("parser ids are stable across status toggles and line insertions", () => {
	const { parseAgentTodoItems } = loadParser();
	const pending = parseAgentTodoItems(["☐ #1 修复登录页样式", "☐ #2 补测试"]);
	const completed = parseAgentTodoItems(["☑ #1 修复登录页样式", "☐ #2 补测试"]);
	// 状态切换：id 不变（状态图标动画依赖同 key 元素）
	assert.equal(completed[0].id, pending[0].id);
	// 行插入（新任务置顶）：既有项 id 不变
	const inserted = parseAgentTodoItems(["☐ #3 新任务", "☑ #1 修复登录页样式", "☐ #2 补测试"]);
	assert.equal(inserted[1].id, completed[0].id);
	// 同标题消歧：出现两次时第二个 id 带序号，不会 key 冲突
	const dup = parseAgentTodoItems(["☐ 写文档", "☐ 写文档"]);
	assert.notEqual(dup[0].id, dup[1].id);
});

test("parser is a pure module without runtime imports (import type only)", () => {
	const compiled = ts.transpileModule(source(parserPath), {
		compilerOptions: {
			module: ts.ModuleKind.CommonJS,
			target: ts.ScriptTarget.ES2022,
			esModuleInterop: true,
			jsx: ts.JsxEmit.ReactJSX,
		},
		fileName: parserPath,
	}).outputText;
	assert.doesNotMatch(compiled, /require\(/);
});
