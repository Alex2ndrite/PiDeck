/**
 * webApi — Web 端与主进程 WebServiceManager 的 HTTP 数据访问层。
 *
 * 覆盖范围（与桌面端对齐但收窄）：
 * - /api/state：项目/会话/运行态轮询
 * - /api/sessions（POST）：按项目新建会话
 * - /api/sessions/:id/messages/page：历史消息分页
 * - 发送消息走 useChat（/api/chat 流式），不在此处重复实现
 */
import type { UIMessage } from "ai";
import type { ChatMessage, SessionMessagePage } from "../../../shared/types";
import type { WebState } from "./webTypes";

/** 轮询 /api/state 拿项目/会话/运行态（低频兜底，主数据流走 useChat）。 */
export async function fetchState(): Promise<WebState> {
	const res = await fetch("/api/state");
	if (!res.ok) throw new Error(`state ${res.status}`);
	return res.json();
}

/** 按项目新建会话（对应桌面端「新建 Agent」入口）。返回新会话 id。 */
export async function createSession(projectId: string): Promise<string> {
	const res = await fetch("/api/sessions", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ projectId }),
	});
	if (!res.ok) throw new Error(`create session ${res.status}`);
	const result = (await res.json()) as { session?: { id?: string } };
	const id = result.session?.id;
	if (!id) throw new Error("create session: missing session id");
	return id;
}

/** 拉历史消息页（分页），供注入 useChat / 展示。 */
export async function fetchMessagePage(
	sessionId: string,
	before?: number,
	pageSize?: number,
): Promise<SessionMessagePage> {
	const params = new URLSearchParams();
	if (before != null) params.set("before", String(before));
	if (pageSize != null) params.set("pageSize", String(pageSize));
	const qs = params.toString();
	const res = await fetch(
		`/api/sessions/${encodeURIComponent(sessionId)}/messages/page${qs ? `?${qs}` : ""}`,
	);
	if (!res.ok) throw new Error(`messages ${res.status}`);
	return (await res.json()) as SessionMessagePage;
}

/**
 * 历史 ChatMessage 列表 → useChat 的 UIMessage[]（text-only parts）。
 * 历史消息仅注入正文；流式思考/工具由 useChat 从 SSE 实时构建，避免与
 * 静态历史重复。ChatMessage.thinking 存在时一并注入 reasoning part，
 * 让历史会话也能折叠查看思考过程。
 */
export function chatMessagesToUiMessages(messages: ChatMessage[]): UIMessage[] {
	return messages.map((message) => {
		const role =
			message.role === "user"
				? "user"
				: message.role === "assistant"
					? "assistant"
					: "assistant";
		const parts: UIMessage["parts"] = [];
		if (message.thinking) {
			parts.push({ type: "reasoning", text: message.thinking });
		}
		if (message.text) {
			parts.push({ type: "text", text: message.text });
		}
		return {
			id: message.id ?? `hist-${message.timestamp ?? Math.random()}`,
			role,
			parts,
		};
	});
}
