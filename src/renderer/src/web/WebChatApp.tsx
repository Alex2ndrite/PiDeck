/**
 * WebChatApp — PiDeck Web 服务 React 前端（A2）。
 *
 * 用 AI SDK v7 的 useChat + DefaultChatTransport 消费主进程 /api/chat 端点：
 * - 发送消息 → POST /api/chat → 主进程转发给 pi agent → 流式返回 AI SDK UIMessageStream
 * - useChat 自带状态机（submitted/streaming/ready/error）、stop() 停止、parts 渲染
 * - 项目/会话列表走 /api/state 低频轮询（兜底），消息区由 useChat 接管
 */
import { useEffect, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import type { UIMessage } from "ai";

type WebState = {
	projects: Array<{ id: string; name: string; path: string }>;
	sessions: Array<{
		id: string;
		projectId: string;
		title: string;
		status: string;
		projectPath?: string;
	}>;
	runtimes: Array<{
		sessionId: string;
		agentId: string;
		status: string;
		cwd?: string;
		runtimeGeneration?: number;
	}>;
	messagesBySession: Record<string, unknown[]>;
};

/** 轮询 /api/state 拿项目/会话/运行态（低频兜底，主数据流走 useChat）。 */
async function fetchState(): Promise<WebState> {
	const res = await fetch("/api/state");
	if (!res.ok) throw new Error(`state ${res.status}`);
	return res.json();
}

/** 拉会话历史消息，转成 useChat 的 UIMessage 结构供 setMessages 注入。 */
async function fetchHistory(sessionId: string): Promise<UIMessage[]> {
	const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/messages/page`);
	if (!res.ok) return [];
	const page = await res.json();
	const raw = (page.messages ?? []) as Array<{
		id?: string;
		role?: string;
		text?: string;
		timestamp?: number;
	}>;
	return raw.map((message) => ({
		id: message.id ?? `hist-${message.timestamp ?? Math.random()}`,
		role: message.role === "assistant" ? "assistant" : message.role === "user" ? "user" : "assistant",
		parts: [
			{ type: "text" as const, text: message.text ?? "" },
		],
	}));
}

/** 简易 i18n：与后端 WebI18n 同 key，前端内置中英双语。 */
const DICTIONARIES: Record<string, Record<string, string>> = {
	"zh-CN": {
		"web.projects": "项目",
		"web.sessions": "会话",
		"web.chooseSession": "选择或创建会话",
		"web.connected": "已连接",
		"web.send": "发送",
		"web.promptPlaceholder": "发送消息到当前会话",
		"web.composerHint": "Enter 发送，Shift/Ctrl + Enter 换行",
		"web.emptySelection": "从左侧选择项目创建会话，或选择现有会话。",
		"web.noMessages": "暂无消息",
		"web.stopResponse": "停止响应",
		"web.role.assistant": "助手",
		"web.role.user": "用户",
		"web.status.running": "运行中",
		"web.status.idle": "空闲",
		"web.status.draft": "草稿",
		"web.streamFailed": "流式连接失败",
		"web.opening": "正在打开...",
		"web.newSession": "新建会话",
	},
	"en-US": {
		"web.projects": "Projects",
		"web.sessions": "Sessions",
		"web.chooseSession": "Select or create a session",
		"web.connected": "Connected",
		"web.send": "Send",
		"web.promptPlaceholder": "Send a message to the current session",
		"web.composerHint": "Enter to send, Shift/Ctrl + Enter for a new line",
		"web.emptySelection": "Select a project to create a session, or select an existing session.",
		"web.noMessages": "No messages",
		"web.stopResponse": "Stop response",
		"web.role.assistant": "Assistant",
		"web.role.user": "User",
		"web.status.running": "Running",
		"web.status.idle": "Idle",
		"web.status.draft": "Draft",
		"web.streamFailed": "Stream failed",
		"web.opening": "Opening...",
		"web.newSession": "New session",
	},
};

function detectLocale(): string {
	const lang = navigator.languages?.[0] ?? navigator.language ?? "";
	return /^zh(?:-|$)/i.test(lang) ? "zh-CN" : "en-US";
}

export function WebChatApp() {
	const [locale] = useState(detectLocale);
	const t = DICTIONARIES[locale] ?? DICTIONARIES["en-US"];

	const [state, setState] = useState<WebState>({
		projects: [],
		sessions: [],
		runtimes: [],
		messagesBySession: {},
	});
	const [activeSessionId, setActiveSessionId] = useState<string>("");
	const [creatingProjectId, setCreatingProjectId] = useState<string>("");
	const [statusText, setStatusText] = useState(t["web.connected"]);
	const loadedHistoryRef = useRef<Set<string>>(new Set());

	const runtimeFor = (sessionId: string) =>
		state.runtimes.find((runtime) => runtime.sessionId === sessionId);

	// useChat：sessionId 作为 chat id；切会话时 id 变化自动重建上下文。
	const { messages, sendMessage, status, stop, setMessages, error } = useChat({
		id: activeSessionId,
		transport: new DefaultChatTransport({ api: "/api/chat" }),
	});

	// 低频轮询项目/会话/运行态（3s；useChat 负责消息流，不参与轮询）
	useEffect(() => {
		let disposed = false;
		const refresh = async () => {
			try {
				const next = await fetchState();
				if (disposed) return;
				setState(next);
				setStatusText(t["web.connected"]);
				if (!next.sessions.some((session) => session.id === activeSessionId)) {
					setActiveSessionId(next.sessions[0]?.id ?? "");
				}
			} catch {
				if (!disposed) setStatusText(t["web.streamFailed"]);
			}
		};
		void refresh();
		const timer = setInterval(refresh, 3000);
		return () => {
			disposed = true;
			clearInterval(timer);
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [activeSessionId, t]);

	// 切换会话时注入历史消息（只注入一次，避免覆盖流式新内容）
	useEffect(() => {
		if (!activeSessionId) return;
		if (loadedHistoryRef.current.has(activeSessionId)) return;
		loadedHistoryRef.current.add(activeSessionId);
		void fetchHistory(activeSessionId).then((history) => {
			if (history.length > 0) setMessages(history);
		});
	}, [activeSessionId, setMessages]);

	const activeSession = state.sessions.find((session) => session.id === activeSessionId);
	const activeRuntime = activeSessionId ? runtimeFor(activeSessionId) : undefined;

	const handleSend = (text: string) => {
		if (!activeSessionId || !text.trim()) return;
		void sendMessage({ text });
	};

	const handleCreateSession = async (projectId: string) => {
		setCreatingProjectId(projectId);
		try {
			const res = await fetch("/api/sessions", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ projectId }),
			});
			const result = await res.json();
			setActiveSessionId(result.session.id);
			loadedHistoryRef.current.delete(result.session.id);
			await refreshNow();
		} finally {
			setCreatingProjectId("");
		}
	};

	// 供 handleCreateSession 复用：直接再拉一次 state
	const refreshNow = async () => {
		try {
			setState(await fetchState());
		} catch {
			// 忽略
		}
	};

	return (
		<div className="app">
			<aside>
				<h1>PiDeck</h1>
				<div className="section-title">{t["web.projects"]}</div>
				<div className="list">
					{state.projects.map((project) => (
						<button
							key={project.id}
							className={`item ${creatingProjectId === project.id ? "loading" : ""}`}
							disabled={Boolean(creatingProjectId)}
							onClick={() => handleCreateSession(project.id)}
						>
							<strong>{project.name}</strong>
							<small>{project.path}</small>
						</button>
					))}
				</div>
				<div className="section-title">{t["web.sessions"]}</div>
				<div className="list">
					{state.sessions.map((session) => {
						const runtime = runtimeFor(session.id);
						return (
							<button
								key={session.id}
								className={`item ${session.id === activeSessionId ? "active" : ""}`}
								onClick={() => setActiveSessionId(session.id)}
							>
								<strong>{session.title || "(untitled)"}</strong>
								<small>
									{runtime?.status === "running" ? <span className="pulse" /> : null}
									{runtime?.status ?? session.status}
								</small>
							</button>
						);
					})}
				</div>
			</aside>
			<main>
				<header>
					<h1 id="title">{activeSession?.title ?? t["web.chooseSession"]}</h1>
					<div className="header-actions">
						<span className="status">
							{status === "streaming" || status === "submitted" ? (
								<>
									<span className="pulse" />
									{t["web.status.running"]}
								</>
							) : (
								statusText
							)}
						</span>
						{status === "streaming" || status === "submitted" ? (
							<button className="danger" type="button" onClick={() => stop()}>
								{t["web.stopResponse"]}
							</button>
						) : null}
					</div>
				</header>
				<div className="messages">
					{messages.length === 0 ? (
						<div className="empty">{t["web.emptySelection"]}</div>
					) : (
						messages.map((message) => (
							<div key={message.id} className={`message ${message.role}`}>
								<span className="role">{t[`web.role.${message.role}`] ?? message.role}</span>
								{message.parts.map((part, index) => {
									if (part.type === "text") return <span key={index}>{part.text}</span>;
									if (part.type === "reasoning") {
										return (
											<details key={index} className="streaming-thinking">
												<summary>thinking</summary>
												{part.text}
											</details>
										);
									}
									if (part.type === "tool-invocation") {
										// v7：toolName 与 toolCallId 直接挂在 part 上（toolInvocation 已扁平化）
										const toolName = "toolName" in part && typeof (part as { toolName?: unknown }).toolName === "string"
											? (part as { toolName: string }).toolName
											: "tool";
										return (
											<div key={index} className="streaming-tool">
												<span className="tool-name">{toolName}</span>
											</div>
										);
									}
									return null;
								})}
							</div>
						))
					)}
					{error ? <div className="message error">{error.message}</div> : null}
				</div>
				<form
					className="composer"
					onSubmit={(event) => {
						event.preventDefault();
						const input = event.currentTarget.elements.namedItem("prompt") as HTMLTextAreaElement;
						handleSend(input.value);
						input.value = "";
					}}
				>
					<div className="composer-box">
						<textarea
							id="prompt"
							name="prompt"
							placeholder={t["web.promptPlaceholder"]}
							disabled={!activeSessionId}
							onKeyDown={(event) => {
								if (event.key === "Enter" && !event.shiftKey && !event.ctrlKey && !event.metaKey) {
									event.preventDefault();
									(event.currentTarget.form as HTMLFormElement).requestSubmit();
								}
							}}
						/>
						<div className="composer-actions">
							<button className="primary" type="submit" disabled={!activeSessionId}>
								{t["web.send"]}
							</button>
						</div>
					</div>
					<div className="composer-hint">{t["web.composerHint"]}</div>
				</form>
			</main>
		</div>
	);
}
