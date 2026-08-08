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
			if (specifier === "react") return { useEffect: () => undefined, useRef: () => ({ current: undefined }) };
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

test("break reminder interval is exactly 2 hours", () => {
	const { WORK_BREAK_INTERVAL_MS } = loadModule();
	assert.equal(WORK_BREAK_INTERVAL_MS, 2 * 60 * 60 * 1000);
});

test("useWorkBreakReminder schedules a chained timer with cleanup", () => {
	const source = readFileSync("src/renderer/src/hooks/useWorkBreakReminder.ts", "utf8");
	// 打开 PiDeck 即开始计时：定时器以 WORK_BREAK_INTERVAL_MS 为间隔，触发后继续排队下一个周期
	assert.match(source, /setTimeout\([\s\S]*WORK_BREAK_INTERVAL_MS\)/);
	assert.match(source, /schedule\(\); \/\/ 继续排队下一个整点/);
	// 卸载时清理定时器，计时随本次启动结束而重置
	assert.match(source, /clearTimeout\(timer\)/);
	assert.match(source, /let cycles = 0/);
});

test("useWorkBreakReminder only runs when the setting is enabled", () => {
	const source = readFileSync("src/renderer/src/hooks/useWorkBreakReminder.ts", "utf8");
	// 设置关闭时整段 effect 直接返回（不启动计时）；重新开启时 effect 重跑、从开启时刻重新计时
	assert.match(source, /useWorkBreakReminder\(\s*enabled: boolean,\s*onPermanentlyDisable\?: \(\) => void,\s*\): void/);
	assert.match(source, /if \(!enabled\) return; \/\/ 设置关闭：本周期不启动计时/);
	// 本启动内已静音时同样不启动计时
	assert.match(source, /if \(mutedForSession\) return;/);
});

test("break reminder copy switches at the first cycle and carries the hour count", () => {
	const source = readFileSync("src/renderer/src/hooks/useWorkBreakReminder.ts", "utf8");
	assert.match(source, /t\("app\.breakReminderTitleOne"\)/);
	assert.match(source, /t\("app\.breakReminderBodyOne"\)/);
	assert.match(source, /t\("app\.breakReminderTitleMany",\s*\{\s*hours: cycles \* 2\s*\}\)/);
	assert.match(source, /t\("app\.breakReminderBodyMany",\s*\{\s*hours: cycles \* 2\s*\}\)/);
	// 主按钮：本次启动不再提醒（重启后恢复）；次按钮：永久不再提醒（写回设置）
	assert.match(source, /action:\s*\{\s*label: t\("app\.breakReminderMuteSession"\)/);
	assert.match(source, /cancel:\s*\{\s*label: t\("app\.breakReminderDisableForever"\)/);
	// 永久关闭通过 ref 回调交给调用方（App）写设置
	assert.match(source, /onClick: \(\) => onPermanentlyDisableRef\.current\?\.\(\)/);
});

test("break reminder i18n copy exists in zh-CN and en-US with hours placeholder", () => {
	const zh = readFileSync("src/renderer/src/i18n/rendererCopy.zh-CN.ts", "utf8");
	const en = readFileSync("src/renderer/src/i18n/rendererCopy.en-US.ts", "utf8");
	for (const key of [
		"app.breakReminderTitleOne",
		"app.breakReminderTitleMany",
		"app.breakReminderBodyOne",
		"app.breakReminderBodyMany",
		"app.breakReminderMuteSession",
		"app.breakReminderDisableForever",
	]) {
		assert.match(zh, new RegExp(`"${key}":`), `zh-CN missing ${key}`);
		assert.match(en, new RegExp(`"${key}":`), `en-US missing ${key}`);
	}
	// 复数字段带 {hours} 占位符，双语同步
	assert.match(zh, /"app\.breakReminderTitleMany": "连续专注 \{hours\} 小时/);
	assert.match(en, /"app\.breakReminderTitleMany": "\{hours\} hours in/);
});
