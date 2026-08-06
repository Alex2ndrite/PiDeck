import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import vm from "node:vm";

function transpile(filePath) {
	return ts.transpileModule(readFileSync(filePath, "utf8"), {
		compilerOptions: {
			module: ts.ModuleKind.CommonJS,
			target: ts.ScriptTarget.ES2022,
		},
	}).outputText;
}

// 纯常量用 VM 加载：hook 的运行时 import（react/i18n/notice）用桩替换，只验证导出常量
function loadModule() {
	const sandbox = {
		exports: {},
		require: (specifier) => {
			if (specifier === "react") return { useEffect: () => undefined };
			if (specifier === "../i18n") return { t: (key) => key };
			if (specifier === "../utils/notice") return { showNotice: () => undefined };
			throw new Error(`Unexpected import: ${specifier}`);
		},
	};
	vm.runInNewContext(transpile("src/renderer/src/hooks/useWorkBreakReminder.ts"), sandbox, {
		filename: "useWorkBreakReminder.ts",
	});
	return sandbox.exports;
}

test("break reminder interval is exactly 1 hour", () => {
	const { WORK_BREAK_INTERVAL_MS } = loadModule();
	assert.equal(WORK_BREAK_INTERVAL_MS, 60 * 60 * 1000);
});

test("useWorkBreakReminder schedules an hourly chained timer with cleanup", () => {
	const source = readFileSync("src/renderer/src/hooks/useWorkBreakReminder.ts", "utf8");
	// 打开 PiDeck 即开始计时：定时器以 WORK_BREAK_INTERVAL_MS 为间隔，触发后继续排队下一个整点
	assert.match(source, /setTimeout\([\s\S]*WORK_BREAK_INTERVAL_MS\)/);
	assert.match(source, /schedule\(\); \/\/ 继续排队下一个整点/);
	// 卸载时清理定时器，计时随本次启动结束而重置
	assert.match(source, /clearTimeout\(timer\)/);
	assert.match(source, /let hours = 0/);
});

test("useWorkBreakReminder only runs when the setting is enabled", () => {
	const source = readFileSync("src/renderer/src/hooks/useWorkBreakReminder.ts", "utf8");
	// 设置关闭时整段 effect 直接返回（不启动计时）；重新开启时 effect 重跑、从开启时刻重新计时
	assert.match(source, /useWorkBreakReminder\(enabled: boolean\): void/);
	assert.match(source, /if \(!enabled\) return; \/\/ 设置关闭：本周期不启动计时/);
});

test("break reminder copy switches at the first hour and carries the hour count", () => {
	const source = readFileSync("src/renderer/src/hooks/useWorkBreakReminder.ts", "utf8");
	assert.match(source, /t\("app\.breakReminderTitleOne"\)/);
	assert.match(source, /t\("app\.breakReminderBodyOne"\)/);
	assert.match(source, /t\("app\.breakReminderTitleMany",\s*\{\s*hours\s*\}\)/);
	assert.match(source, /t\("app\.breakReminderBodyMany",\s*\{\s*hours\s*\}\)/);
	// 只提供「知道了」次按钮：关闭当前提醒，下个整点照常提醒
	assert.match(source, /cancel:\s*\{\s*label: t\("app\.projectRemoveBlockedAck"\)\s*\}/);
});

test("break reminder i18n copy exists in zh-CN and en-US with hours placeholder", () => {
	const zh = readFileSync("src/renderer/src/i18n/rendererCopy.zh-CN.ts", "utf8");
	const en = readFileSync("src/renderer/src/i18n/rendererCopy.en-US.ts", "utf8");
	for (const key of [
		"app.breakReminderTitleOne",
		"app.breakReminderTitleMany",
		"app.breakReminderBodyOne",
		"app.breakReminderBodyMany",
	]) {
		assert.match(zh, new RegExp(`"${key}":`), `zh-CN missing ${key}`);
		assert.match(en, new RegExp(`"${key}":`), `en-US missing ${key}`);
	}
	// 复数字段带 {hours} 占位符，双语同步
	assert.match(zh, /"app\.breakReminderTitleMany": "连续专注 \{hours\} 小时/);
	assert.match(en, /"app\.breakReminderTitleMany": "\{hours\} hours in/);
});
