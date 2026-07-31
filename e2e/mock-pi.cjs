/**
 * Mock pi（#115 U6 / #113 3.2 会话路径 E2E）：
 * 实现桌面端依赖的最小 stdio JSONL RPC 子集，让 E2E 可以在不安装真实 pi、
 * 不访问网络的前提下跑「新建会话 → 发送 → 流式渲染 → 停止」完整链路。
 *
 * 协议（与 src/main/pi/PiRpcClient.ts 对齐）：
 * - 输入：每行一个 JSON 命令，带 { type, id, ... }
 * - 响应：{ type: "response", id, command, success, data?, error? }
 * - 事件：无 id 的 JSON 对象（agent_start / message_start / message_update /
 *   message_end / agent_end / agent_settled ...）
 *
 * 行为：
 * - prompt：立即 success，然后以 ~80ms 间隔流式输出 12 个 text_delta，
 *   文本为 "Mock 回复：「<消息>」"；prompt 含 "SLOW" 时放慢到 220ms×18，
 *   便于稳定地在中途点击「停止」。
 * - abort：立即 success；取消进行中的流，发 agent_end + agent_settled。
 * - 其它命令一律 success（桌面端对未知字段宽容），避免误报错误气泡。
 */
"use strict";

// 健康检查路径：桌面端环境检测会对 customPiPath 执行 `--version`（PiLocator），
// 需要可解析的版本输出，否则检测失败、应用进入安装向导而不是欢迎页。
if (process.argv.includes("--version")) {
	process.stdout.write("0.99.0-mock\n");
	process.exit(0);
}

// 模型列表：桌面端模型选择器通过 `pi --list-models` 文本表格获取候选
//（modelListCache.parsePiListModels，无需启动 agent），列序：
// provider  model  context  max-out  thinking  images
if (process.argv.includes("--list-models")) {
	process.stdout.write(
		"provider  model           context  max-out  thinking  images\n" +
		"mock      mock-model      128000   8192     yes       no\n" +
		"mock      mock-model-pro  256000   8192     yes       no\n",
	);
	process.exit(0);
}

const readline = require("node:readline");
const fs = require("node:fs");
const path = require("node:path");

// 调试：记录收到的命令/发出的响应，便于排查 E2E 状态不同步问题
const LOG_PATH = path.join(require("node:os").tmpdir(), `mock-pi-${process.pid}.log`);
function log(direction, payload) {
	try {
		fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
		fs.appendFileSync(LOG_PATH, `${direction} ${JSON.stringify(payload)}\n`);
	} catch { /* 日志失败不影响协议 */ }
}

// sessionId 按 cwd 稳定哈希：重启 Agent（杀进程重 spawn）后桌面端期望
// 同一会话文件被重新接管（#113 3.2-6 续聊语义），不能按时间乱变。
const crypto = require("node:crypto");
const sessionId =
	"mock-" + crypto.createHash("md5").update(process.cwd()).digest("hex").slice(0, 10);
// 模型/思考级别有状态跟踪：桌面端 set_model/set_thinking_level 后会重新
// get_state 拉取（AgentManager.getRuntimeState），mock 必须返回更新后的值。
const MODELS = [
	{ provider: "mock", id: "mock-model", name: "Mock Model", contextWindow: 128000, reasoning: true },
	{ provider: "mock", id: "mock-model-pro", name: "Mock Model Pro", contextWindow: 256000, reasoning: true },
];
let currentModel = MODELS[0];
let currentThinking = "medium";
// 上下文占比：初始 >30% 让 compact chip 显示（桌面端 >30% 才渲染，见
// ComposerComponents showCompact）；compact 成功后降到 12%，验证 chip 消失。
let contextPercent = 45;
// 记录收到的用户 prompt：fork 用例的 get_fork_messages 按文本匹配 entryId。
const userPrompts = [];
// 内存消息列表：get_messages 在 fork/reload 后需要返回真实对话，
// 否则 refreshRuntimeAfterSessionReplacement 会把时间线清空。
const conversationMessages = [];
/** 把 cwd 编码成 pi sessions 目录名（与 SessionScanner.decodeSessionDir 对偶） */
function encodeSessionDir(cwd) {
	const norm = path.resolve(cwd).replace(/\\/g, "/");
	if (/^[A-Za-z]:/.test(norm)) {
		const drive = norm[0].toUpperCase();
		const rest = norm.slice(2).replace(/^\//, "").replace(/\//g, "-");
		return `--${drive}--${rest}--`;
	}
	return `--${norm.replace(/^\//, "").replace(/\//g, "-")}--`;
}

// 会话文件双写：
// 1) tmp 路径作为 get_state.sessionFile（fork/reattach 原语义，不绑项目路径）
// 2) 项目 cwd/.pi/sessions 镜像，SessionScanner 扫历史（#113 3.2-9）
let sessionFile = null;
let sessionHeaderWritten = false;
const TMP_SESSION_FILE_PATH = path.join(require("node:os").tmpdir(), sessionId + ".jsonl");
const PROJECT_SESSIONS_DIR = path.join(process.cwd(), ".pi", "sessions");
const PROJECT_SESSION_FILE_PATH = path.join(PROJECT_SESSIONS_DIR, sessionId + ".jsonl");
function ensureSessionFile() {
	if (sessionFile) return;
	try {
		fs.writeFileSync(TMP_SESSION_FILE_PATH, "", { flag: "a" });
		fs.mkdirSync(PROJECT_SESSIONS_DIR, { recursive: true });
		const settingsPath = path.join(process.cwd(), ".pi", "settings.json");
		if (!fs.existsSync(settingsPath)) {
			fs.writeFileSync(settingsPath, JSON.stringify({ sessionDir: ".pi/sessions" }, null, 2));
		}
		fs.writeFileSync(PROJECT_SESSION_FILE_PATH, "", { flag: "a" });
	} catch { /* 写失败仅影响 fork/历史恢复类用例 */ }
	sessionFile = TMP_SESSION_FILE_PATH;
}
// 重启后的新进程：tmp 文件已存在则恢复 sessionFile（桌面端 reattach 语义）
if (fs.existsSync(TMP_SESSION_FILE_PATH)) {
	sessionFile = TMP_SESSION_FILE_PATH;
	try { sessionHeaderWritten = fs.statSync(TMP_SESSION_FILE_PATH).size > 0; } catch { /* ignore */ }
}
let streamTimer = null;
let streamStep = 0;
let streamChunks = [];
let streamIntervalMs = 80;
let streaming = false;
// steer/followUp 中途到达的 prompt 排队串行处理：真实 pi 也是单 run 语义，
// 桌面端排队用例依赖「先到的先答、后到的接着答」的顺序性。
const pendingPrompts = [];

function send(payload) {
	log(">", payload);
	process.stdout.write(JSON.stringify(payload) + "\n");
}

function respond(cmd, data) {
	send({ type: "response", id: cmd.id, command: cmd.type, success: true, data });
}

/** compact nothing-to-do 等失败路径：success:false + error 文案，桌面端映射友好 toast */
function respondFail(cmd, error) {
	send({ type: "response", id: cmd.id, command: cmd.type, success: false, error });
}

// SessionHistoryReader 沿 parentId 回溯活动分支；每条 entry 必须有稳定 id。
let nextEntrySeq = 1;
let lastEntryId = null;

/** 把对话写成可被 SessionHistoryReader 分页读取的真实 JSONL（#113 3.2-9） */
function appendSessionMessages(userText, assistantText) {
	ensureSessionFile();
	if (!sessionFile) return;
	const now = Date.now();
	const lines = [];
	if (!sessionHeaderWritten) {
		const headerId = `e${nextEntrySeq++}`;
		lines.push(JSON.stringify({
			type: "session_info",
			id: headerId,
			parentId: null,
			name: userText.slice(0, 40) || "mock session",
			cwd: process.cwd(),
			timestamp: new Date(now).toISOString(),
		}));
		lastEntryId = headerId;
		sessionHeaderWritten = true;
	}
	const userParent = lastEntryId;
	const userId = `e${nextEntrySeq++}`;
	lines.push(JSON.stringify({
		type: "message",
		id: userId,
		parentId: userParent,
		timestamp: new Date(now).toISOString(),
		message: { role: "user", content: [{ type: "text", text: userText }] },
	}));
	const assistantId = `e${nextEntrySeq++}`;
	lines.push(JSON.stringify({
		type: "message",
		id: assistantId,
		parentId: userId,
		timestamp: new Date(now + 1).toISOString(),
		message: { role: "assistant", content: [{ type: "text", text: assistantText }] },
	}));
	lastEntryId = assistantId;
	const payload = lines.join("\n") + "\n";
	// 双写：tmp（runtime sessionFile）+ 项目 sessions（历史扫描）
	try { fs.appendFileSync(sessionFile, payload); } catch { /* ignore */ }
	try {
		fs.mkdirSync(PROJECT_SESSIONS_DIR, { recursive: true });
		fs.appendFileSync(PROJECT_SESSION_FILE_PATH, payload);
	} catch { /* ignore */ }
}

function emit(event) {
	send(event);
}

function stopStream(settled) {
	if (streamTimer) {
		clearInterval(streamTimer);
		streamTimer = null;
	}
	if (settled) {
		emit({ type: "agent_end", messages: [] });
		emit({ type: "agent_settled" });
	}
}

function startStream(userText) {
	streaming = true;
	const slow = userText.includes("SLOW");
	streamIntervalMs = slow ? 220 : 80;
	// prompt 含 "MDEMO" 时回复富 markdown，用于截图巡检渲染元素（链接/代码/表格/引用）
	const reply = userText.includes("MDEMO")
		? [
			"以下是渲染元素巡检：",
			"",
			"修改了 src/main/index.ts 和 ./docs/ui-2.0-revamp-plan.md，详见 https://github.com/miaojingang/pi-desktop 。",
			"",
			"> 引用块：重构期间禁止静默吞掉对方改动，每个冲突都要确认能力归属。",
			"",
			"行内代码 `npm run typecheck` 必须通过。",
			"",
			"```ts",
			"const gate = await runTypecheck();",
			"if (!gate.ok) throw new Error(\"typecheck failed\");",
			"```",
			"",
			"| 批次 | 状态 | 说明 |",
			"| --- | --- | --- |",
			"| U2 | ✅ | Streamdown 渲染管线 |",
			"| U5 | ✅ | 组件清扫 |",
		].join("\n")
		: `Mock 回复：「${userText.slice(0, 40)}」流式渲染验证完成。`;
	const chunkCount = slow ? 18 : 12;
	const per = Math.max(1, Math.ceil(reply.length / chunkCount));
	streamChunks = [];
	for (let i = 0; i < reply.length; i += per) streamChunks.push(reply.slice(i, i + per));
	streamStep = 0;

	emit({ type: "agent_start" });
	emit({
		type: "message_start",
		message: { role: "assistant", content: [{ type: "text", text: "" }] },
	});

	streamTimer = setInterval(() => {
		if (streamStep >= streamChunks.length) {
			clearInterval(streamTimer);
			streamTimer = null;
			const full = {
				role: "assistant",
				content: [{ type: "text", text: reply }],
				stopReason: "stop",
			};
			emit({ type: "message_end", message: full });
			emit({ type: "agent_end", messages: [full] });
			emit({ type: "agent_settled" });
			// 落盘 + 内存同步：历史恢复扫文件；fork/reload 走 get_messages
			appendSessionMessages(userText, reply);
			conversationMessages.push(
				{ role: "user", content: [{ type: "text", text: userText }] },
				{ role: "assistant", content: [{ type: "text", text: reply }] },
			);
			streaming = false;
			// 排队 prompt 串行开下一轮
			const next = pendingPrompts.shift();
			if (next !== undefined) startStream(next);
			return;
		}
		const accumulated = streamChunks.slice(0, streamStep + 1).join("");
		emit({
			type: "message_update",
			message: { role: "assistant", content: [{ type: "text", text: accumulated }] },
			assistantMessageEvent: { type: "text_delta", delta: streamChunks[streamStep] },
		});
		streamStep += 1;
	}, streamIntervalMs);
}

function handleCommand(cmd) {
	switch (cmd.type) {
		case "get_state":
			respond(cmd, {
				sessionId,
				sessionName: "Mock Agent",
				sessionFile: sessionFile ?? undefined,
				model: currentModel,
				thinkingLevel: currentThinking,
			});
			return;
		case "get_messages":
			respond(cmd, { messages: conversationMessages.slice() });
			return;
		case "get_entries":
			respond(cmd, { entries: [] });
			return;
		case "get_session_stats":
			respond(cmd, { tokens: { input: 100, output: 50 }, contextUsage: { percent: contextPercent } });
			return;
		case "get_available_models":
			respond(cmd, { models: MODELS });
			return;
		case "set_model": {
			const found = MODELS.find((m) => m.provider === cmd.provider && m.id === cmd.modelId);
			if (found) currentModel = found;
			respond(cmd, { model: currentModel });
			return;
		}
		case "set_thinking_level":
			currentThinking = typeof cmd.level === "string" ? cmd.level : currentThinking;
			respond(cmd, {});
			return;
		case "cycle_thinking_level": {
			const levels = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
			const idx = levels.indexOf(currentThinking);
			currentThinking = levels[(idx + 1) % levels.length];
			respond(cmd, {});
			return;
		}
		case "prompt": {
			// 先回 success（桌面端据此认为已受理），再异步推流
			respond(cmd, {});
			const text = typeof cmd.message === "string" ? cmd.message : "";
			ensureSessionFile();
			if (text) userPrompts.push(text);
			if (streaming) {
				pendingPrompts.push(text);
			} else {
				startStream(text);
			}
			return;
		}
		case "compact":
			// prompt 含 NOTHING 时走失败路径：success:false + "nothing to compact"，
			// 桌面端映射 app.compactNothingToDo 友好 toast（#113 3.2-7）。
			if (typeof cmd.prompt === "string" && cmd.prompt.includes("NOTHING")) {
				respondFail(cmd, "nothing to compact");
				return;
			}
			// 模拟 pi 压缩事件序列：compaction_start → RPC success → compaction_end
			// → agent_settled。桌面端据此 running → 重载消息 → idle；
			// compaction_end 触发 emitRuntimeState，占比下降后 compact chip 应消失。
			emit({ type: "compaction_start", reason: "manual" });
			setTimeout(() => {
				respond(cmd, {});
				contextPercent = 12;
				setTimeout(() => {
					emit({ type: "compaction_end", reason: "manual" });
					emit({ type: "agent_settled" });
				}, 150);
			}, 100);
			return;
		case "get_fork_messages":
			respond(cmd, {
				messages: userPrompts.map((text, i) => ({ entryId: `entry-${i + 1}`, text })),
			});
			return;
		case "fork": {
			const found = userPrompts.find((_, i) => `entry-${i + 1}` === cmd.entryId);
			// 桌面端读取 result.text 预填回输入框；cancelled 为空对象语义
			respond(cmd, { text: found ?? "" });
			return;
		}
		case "abort":
			respond(cmd, {});
			pendingPrompts.length = 0;
			streaming = false;
			stopStream(true);
			return;
		default:
			// set_model / set_thinking_level / cycle_* / set_session_name /
			// compact / bash / export_html / clone / fork / switch_session ...
			respond(cmd, {});
	}
}

const rl = readline.createInterface({ input: process.stdin, terminal: false });
rl.on("line", (line) => {
	const trimmed = line.trim();
	if (!trimmed) return;
	let cmd;
	try {
		cmd = JSON.parse(trimmed);
	} catch {
		return; // 非 JSON 输入直接忽略（桌面端也只记录 protocol-error）
	}
	try {
		log("<", cmd);
		handleCommand(cmd);
	} catch (error) {
		// 命令处理异常不能击穿进程：桌面端依赖进程存活性判断
		send({
			type: "response",
			id: cmd.id,
			command: cmd.type,
			success: false,
			error: error instanceof Error ? error.message : String(error),
		});
	}
});

// 保持进程存活；父进程杀死时自然退出
process.stdin.on("end", () => process.exit(0));
