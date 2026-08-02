import assert from "node:assert/strict";
import test from "node:test";
import { collectSessionFileChanges } from "../src/renderer/src/components/session/TimelineFormat.ts";

/**
 * 会话文件修改汇总收集逻辑测试：
 * write/edit 工具消息 → 文件列表（去重 + 次数累计 + 最后一次 diff 内容）。
 */
function toolMessage(overrides = {}) {
	return {
		id: overrides.id ?? `m-${Math.random().toString(36).slice(2)}`,
		agentId: "a",
		role: "assistant",
		text: "",
		timestamp: Date.now(),
		meta: {
			toolName: overrides.toolName ?? "write",
			args: overrides.args ?? {},
		},
	};
}

test("collectSessionFileChanges: write tool yields the file with full content", () => {
	const messages = [
		toolMessage({ path: "src/a.ts", args: { file_path: "src/a.ts", content: "export const a = 1;" } }),
	];
	const files = collectSessionFileChanges(messages);
	assert.equal(files.length, 1);
	assert.equal(files[0].path, "src/a.ts");
	assert.equal(files[0].content, "export const a = 1;");
	assert.equal(files[0].count, 1);
});

test("collectSessionFileChanges: same file written twice counts twice and keeps the last content", () => {
	const messages = [
		toolMessage({ path: "src/a.ts", args: { file_path: "src/a.ts", content: "v1" } }),
		toolMessage({ path: "src/a.ts", args: { file_path: "src/a.ts", content: "v2" } }),
	];
	const files = collectSessionFileChanges(messages);
	assert.equal(files.length, 1);
	assert.equal(files[0].count, 2);
	assert.equal(files[0].content, "v2");
});

test("collectSessionFileChanges: edit tool captures the changed region", () => {
	const messages = [
		toolMessage({
			path: "src/b.ts",
			toolName: "edit",
			args: {
				file_path: "src/b.ts",
				old_string: "const x = 1;",
				new_string: "const x = 2;",
			},
		}),
	];
	const files = collectSessionFileChanges(messages);
	assert.equal(files.length, 1);
	assert.equal(files[0].path, "src/b.ts");
	assert.equal(files[0].originalContent, "const x = 1;");
	assert.equal(files[0].content, "const x = 2;");
});

test("collectSessionFileChanges: non-file tools and file-less args are ignored", () => {
	const messages = [
		toolMessage({ toolName: "bash", args: { command: "ls" } }),
		toolMessage({ toolName: "read", args: { file_path: "README.md" } }),
		toolMessage({ toolName: "write", args: {} }),
	];
	assert.deepEqual(collectSessionFileChanges(messages), []);
});

test("collectSessionFileChanges: different files are kept separately", () => {
	const messages = [
		toolMessage({ path: "src/a.ts", args: { file_path: "src/a.ts", content: "a" } }),
		toolMessage({ path: "src/b.ts", args: { file_path: "src/b.ts", content: "b" } }),
	];
	const files = collectSessionFileChanges(messages);
	assert.equal(files.length, 2);
	assert.deepEqual(
		files.map((f) => f.path).sort(),
		["src/a.ts", "src/b.ts"],
	);
});
