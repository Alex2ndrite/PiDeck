import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { parsePsRssKb, parseTasklistMemoryKb } from "../src/main/process/pidMemoryParsers.ts";
import { formatBytes, formatMb } from "../src/shared/formatBytes.ts";

// ===== 纯函数：tasklist CSV / ps rss 解析 =====

test("parseTasklistMemoryKb: standard CSV row", () => {
	assert.equal(
		parseTasklistMemoryKb('"node.exe","12345","Console","1","32,456 K"'),
		32456,
	);
});

test("parseTasklistMemoryKb: no thousands separator", () => {
	assert.equal(parseTasklistMemoryKb('"pi.exe","99","Console","1","2048 K"'), 2048);
});

test("parseTasklistMemoryKb: rejects malformed rows", () => {
	assert.equal(parseTasklistMemoryKb(""), null);
	assert.equal(parseTasklistMemoryKb('"node.exe","1"'), null);
	assert.equal(parseTasklistMemoryKb('"node.exe","1","Console","1","not-a-size"'), null);
	// 非 K 单位（tasklist 不会出现，防御性）
	assert.equal(parseTasklistMemoryKb('"node.exe","1","Console","1","12 M"'), null);
});

test("parsePsRssKb: standard ps output", () => {
	assert.equal(parsePsRssKb("  123456\n"), 123456);
	assert.equal(parsePsRssKb("0\n"), 0);
});

test("parsePsRssKb: rejects empty/non-numeric output", () => {
	assert.equal(parsePsRssKb(""), null);
	assert.equal(parsePsRssKb("  \n"), null);
	assert.equal(parsePsRssKb("abc"), null);
	assert.equal(parsePsRssKb("-5"), null);
});

test("formatBytes: human readable units", () => {
	assert.equal(formatBytes(0), "0 B");
	assert.equal(formatBytes(512), "512 B");
	assert.equal(formatBytes(1024), "1.0 KB");
	assert.equal(formatBytes(1048576), "1.0 MB");
	assert.equal(formatBytes(1073741824), "1.00 GB");
	assert.equal(formatBytes(-1), "-");
	assert.equal(formatBytes(Number.NaN), "-");
});

test("formatMb: fixed MB unit for process monitor", () => {
	assert.equal(formatMb(0), "0.0 MB");
	assert.equal(formatMb(1048576), "1.0 MB");
	assert.equal(formatMb(524288), "0.5 MB");
	assert.equal(formatMb(123456789), "117.7 MB");
	assert.equal(formatMb(-1), "-");
	assert.equal(formatMb(Number.NaN), "-");
});

// ===== 主进程装配：进程枚举与采样链路 =====

test("ProcessMonitor uses array-form system commands with timeout", () => {
	const source = readFileSync("src/main/process/ProcessMonitor.ts", "utf8");
	// 安全规范：命令必须数组参数，禁止字符串拼接 shell
	assert.match(source, /spawn\(args\[0\], args\.slice\(1\)/);
	// Windows tasklist 与 ps 的固定参数数组
	assert.match(source, /\[\"tasklist\", \"\/FI\", `PID eq \$\{pid\}`, \"\/FO\", \"CSV\", \"\/NH\"\]/);
	assert.match(source, /\[\"ps\", \"-o\", \"rss=\", \"-p\", String\(pid\)\]/);
	// 超时兜底：采样挂死不阻塞 IPC（超时常量作为 runCollect 第二参数传入）
	assert.match(source, /timeout: timeoutMs/);
	assert.match(source, /TASKLIST_TIMEOUT_MS,/);
	assert.match(source, /PS_TIMEOUT_MS,/);
});

test("ProcessMonitor assembles electron + agent snapshot with totals", () => {
	const source = readFileSync("src/main/process/ProcessMonitor.ts", "utf8");
	assert.match(source, /app\.getAppMetrics\(\)/);
	// Electron MemoryInfo 单位是 KB，须 ×1024 转字节（否则相对任务管理器小 1024 倍）
	assert.match(source, /workingSetSize \* 1024/);
	assert.match(source, /peakWorkingSetSize \* 1024/);
	assert.match(source, /privateBytes \* 1024/);
	assert.match(source, /Promise\.all\(/);
	assert.match(source, /totalElectronBytes/);
	assert.match(source, /totalAgentBytes/);
	assert.match(source, /sampledAt: Date\.now\(\)/);
});

test("AgentManager exposes listAgentPids filtered to running processes", () => {
	const source = readFileSync("src/main/pi/AgentManager.ts", "utf8");
	assert.match(source, /listAgentPids\(\): Array<\{ agentId: string; pid: number \}>/);
	assert.match(source, /runtime\.process\.pid/);
	assert.match(source, /runtime\.process\.isRunning\(\)/);
});

test("PiProcess exposes pid accessor", () => {
	const source = readFileSync("src/main/pi/PiProcess.ts", "utf8");
	assert.match(source, /get pid\(\): number \| undefined/);
	assert.match(source, /return this\.proc\?\.pid;/);
});

// ===== IPC / preload / UI 接线 =====

test("IPC channel + systemIpc handler + preload exposure", () => {
	const ipc = readFileSync("src/shared/ipc.ts", "utf8");
	const systemIpc = readFileSync("src/main/ipc/systemIpc.ts", "utf8");
	const preload = readFileSync("src/preload/index.ts", "utf8");
	assert.match(ipc, /processMetrics: "system:process-metrics"/);
	assert.match(systemIpc, /ipcMain\.handle\(ipcChannels\.processMetrics/);
	assert.match(systemIpc, /getProcessSnapshot\(deps\.agentManager\.listAgentPids\(\)\)/);
	assert.match(preload, /getProcessMetrics: \(\) =>/);
	assert.match(preload, /ipcRenderer\.invoke\(ipcChannels\.processMetrics\)/);
});

test("stop-agent: full session stop chain (coordinator + detach)", () => {
	const ipc = readFileSync("src/shared/ipc.ts", "utf8");
	const systemIpc = readFileSync("src/main/ipc/systemIpc.ts", "utf8");
	const preload = readFileSync("src/preload/index.ts", "utf8");
	const coordinator = readFileSync("src/main/sessions/SessionRuntimeCoordinator.ts", "utf8");
	const index = readFileSync("src/main/index.ts", "utf8");
	const tab = readFileSync("src/renderer/src/config/ProcessMetricsTab.tsx", "utf8");
	// 通道 + handler：agentId 输入校验（渲染层数据不可信），走完整会话停止链路
	assert.match(ipc, /stopAgent: "system:stop-agent"/);
	assert.match(systemIpc, /ipcMain\.handle\(ipcChannels\.stopAgent/);
	assert.match(systemIpc, /typeof agentId !== "string" \|\| !agentId/);
	// 关键：不能只调 agentManager.stop（会跳过会话状态收尾 → 运行标记不熄灭）
	assert.match(systemIpc, /deps\.stopAgentFromMonitor\(agentId\)/);
	assert.doesNotMatch(systemIpc, /deps\.agentManager\.stop\(agentId\)/);
	// coordinator 按 agentId 反查会话 → 走 stopRuntime 完整收尾（无绑定时幂等直停）
	assert.match(coordinator, /async stopAgentById\(/);
	assert.match(coordinator, /const binding = this\.getRuntimeBinding\(agentId\);/);
	assert.match(coordinator, /await this\.stopRuntime\(target\);/);
	// index.ts 装配：成功后关终端 + detach 推送（渲染层运行标记熄灭的关键）
	assert.match(index, /async function stopAgentFromMonitor\(/);
	assert.match(index, /sessionRuntimeCoordinator\.stopAgentById\(agentId\)/);
	assert.match(index, /terminalManager\.closeAgent\(agentId\);/);
	assert.match(index, /emitSessionRuntimeDetach\(result\.value\);/);
	assert.match(index, /stopAgentFromMonitor,/);
	// preload 暴露
	assert.match(preload, /stopAgent: \(agentId: string\) =>/);
	assert.match(preload, /ipcRenderer\.invoke\(ipcChannels\.stopAgent, agentId\)/);
	// 渲染层：停止确认用 shadcn ConfirmDialog（AlertDialog），不用 toast 双按钮；
	// 停止后刷新快照让该行消失
	assert.match(tab, /window\.piDesktop\.system\.stopAgent\(agent\.agentId\)/);
	assert.match(tab, /setStoppingAgent\(agent\)/);
	assert.match(tab, /<ConfirmDialog\n\s*title=\{t\("config\.process\.stop"\)\}/);
	assert.match(tab, /t\("config\.process\.stopConfirm", \{ agent: stoppingAgent\.agentId \}\)/);
	assert.match(tab, /danger\n/);
	assert.match(tab, /void stopAgent\(agent\);/);
	assert.match(tab, /await refresh\(\);/);
	assert.doesNotMatch(tab, /stopConfirm.*showNotice/s);
	// 操作列：红色（destructive）带文字按钮，紧跟 agentId 而非表格最右侧
	assert.match(tab, /CircleStop/);
	assert.match(tab, /text-destructive hover:bg-destructive\/10/);
	assert.match(tab, /size="sm"/);
	// Agent 表头列序：agentId → PID → memory → action（操作列在最右侧，列内居中）
	assert.match(tab, /config\.process\.column\.agentId.*>PID<.*config\.process\.column\.memory.*config\.process\.column\.action/s);
	assert.match(tab, /<TableCell className="text-center">/);
	// 表头「操作」也居中，与列内按钮对齐（TableHead 默认 text-left 需覆盖）
	assert.match(tab, /<TableHead className="text-center">\{t\("config\.process\.column\.action"\)\}<\/TableHead>/);
});

test("ProcessMetricsTab wires table columns and refresh", () => {
	const source = readFileSync("src/renderer/src/config/ProcessMetricsTab.tsx", "utf8");
	assert.match(source, /window\.piDesktop\.system\.getProcessMetrics\(\)/);
	assert.match(source, /processTypeLabel\(metric\.type\)/);
	assert.match(source, /formatMb\(metric\.memoryBytes\)/);
	assert.match(source, /formatMb\(electronTotal\)/);
	assert.match(source, /formatMb\(agentTotal\)/);
	assert.match(source, /t\("config\.process\.refresh"\)/);
	assert.match(source, /agent\.agentId/);
	assert.match(source, /t\("config\.process\.empty"\)/);
});

test("ConfigModal registers process section nav and rendering", () => {
	const source = readFileSync("src/renderer/src/ConfigModal.tsx", "utf8");
	// 左侧导航已迁移为 Vertical Tabs：ConfigSection 类型含 process，TabsTrigger/TabsContent 成对注册
	assert.match(source, /type ConfigSection =[\s\S]*\| "process";/);
	assert.match(source, /<TabsTrigger[^>]*value="process"/);
	assert.match(source, /<TabsContent value="process"/);
	assert.match(source, /t\("config\.nav\.process"\)/);
	assert.match(source, /<ProcessMetricsTab \/>/);
});

test("process monitor i18n keys exist in zh-CN and en-US", () => {
	const zh = readFileSync("src/renderer/src/i18n/rendererCopy.zh-CN.ts", "utf8");
	const en = readFileSync("src/renderer/src/i18n/rendererCopy.en-US.ts", "utf8");
	const keys = [
		"config.nav.process",
		"config.process.title",
		"config.process.refresh",
		"config.process.electronTotal",
		"config.process.agentCount",
		"config.process.agentTotal",
		"config.process.sampledAt",
		"config.process.electronSection",
		"config.process.agentSection",
		"config.process.empty",
		"config.process.loadFailed",
		"config.process.column.type",
		"config.process.column.memory",
		"config.process.column.cpu",
		"config.process.column.agentId",
		"config.process.column.action",
		"config.process.stop",
		"config.process.stopConfirm",
		"config.process.stopped",
		"config.process.stopFailed",
		"config.process.type.main",
		"config.process.type.renderer",
		"config.process.type.gpu",
		"config.process.type.utility",
		"config.process.type.zygote",
	];
	for (const key of keys) {
		assert.match(zh, new RegExp(`"${key}":`), `zh-CN missing ${key}`);
		assert.match(en, new RegExp(`"${key}":`), `en-US missing ${key}`);
	}
});
