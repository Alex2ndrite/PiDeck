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

const sessionId = "mock-session-" + Date.now().toString(36);
// 模型/思考级别有状态跟踪：桌面端 set_model/set_thinking_level 后会重新
// get_state 拉取（AgentManager.getRuntimeState），mock 必须返回更新后的值。
const MODELS = [
	{ provider: "mock", id: "mock-model", name: "Mock Model", contextWindow: 128000, reasoning: true },
	{ provider: "mock", id: "mock-model-pro", name: "Mock Model Pro", contextWindow: 256000, reasoning: true },
];
let currentModel = MODELS[0];
let currentThinking = "medium";
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
	const reply = `Mock 回复：「${userText.slice(0, 40)}」流式渲染验证完成。`;
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
				model: currentModel,
				thinkingLevel: currentThinking,
			});
			return;
		case "get_messages":
			respond(cmd, { messages: [] });
			return;
		case "get_entries":
			respond(cmd, { entries: [] });
			return;
		case "get_session_stats":
			respond(cmd, { tokens: 0, contextTokens: 1024 });
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
			if (streaming) {
				pendingPrompts.push(text);
			} else {
				startStream(text);
			}
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
