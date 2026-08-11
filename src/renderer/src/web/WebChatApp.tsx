/**
 * WebChatApp — PiDeck Web 服务 React 前端（A2）重构后的组合根。
 *
 * 数据层保持原有架构：
 * - useChat + DefaultChatTransport 消费 /api/chat 流式（AI SDK v7 UIMessageStream）
 * - /api/state 低频轮询兜底项目/会话/运行态
 * - 历史消息按会话注入 useChat；useChat 切换 id 会重建 Chat 实例（不保留
 *   上一会话消息），因此本组件持有自己的 per-session 消息缓存，
 *   切回会话时直接从缓存恢复，避免重复拉取与闪空。
 *
 * UI 层与桌面端对齐：WebSidebar / WebHeader / WebTimeline / WebComposer，
 * 复用桌面设计 token、shadcn 组件、lucide 图标与 timeline/surfaces 样式类。
 */
import { useEffect, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import type { UIMessage } from "ai";
import type { AvailableModel } from "../../../shared/types";
import { t } from "@/i18n";
import { WebSidebar } from "./WebSidebar";
import { WebHeader, type WebHeaderStatus } from "./WebHeader";
import { WebTimeline } from "./WebTimeline";
import { WebComposer } from "./WebComposer";
import {
	chatMessagesToUiMessages,
	createProject,
	createSession,
	deleteProject,
	fetchMessagePage,
	fetchModels,
	fetchState,
	setRuntimeModel,
	setRuntimeThinking,
	updateSessionRecord,
} from "./webApi";
import type { WebProject, WebState } from "./webTypes";

/** 分页元数据：已加载消息总数 + 更早一页的游标。 */
type HistoryMeta = {
	total: number;
	nextBefore: number | null;
};

export function WebChatApp() {
	const [state, setState] = useState<WebState>({
		projects: [],
		sessions: [],
		runtimes: [],
	});
	const [activeSessionId, setActiveSessionId] = useState<string>("");
	const [creatingProjectId, setCreatingProjectId] = useState<string>("");
	const [connected, setConnected] = useState(false);
	const [loadingMore, setLoadingMore] = useState(false);
	const [models, setModels] = useState<AvailableModel[]>([]);
	const [commandError, setCommandError] = useState<string | null>(null);
	// 手机端默认把聊天作为主画面，项目树通过抽屉按需打开，避免列表占满首屏。
	const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

	// ── 本组件自持的 per-session 消息缓存（useChat 切换 id 会重建 Chat 实例） ──
	const messagesBySessionRef = useRef<Record<string, UIMessage[]>>({});
	const loadedSessionsRef = useRef<Set<string>>(new Set());
	const historyMetaRef = useRef<Record<string, HistoryMeta>>({});
	const activeSessionIdRef = useRef<string>("");

	// useChat：sessionId 作为 chat id；切会话时 id 变化重建 Chat 实例
	const { messages, sendMessage, status, stop, setMessages, error } = useChat({
		id: activeSessionId,
		transport: new DefaultChatTransport({ api: "/api/chat" }),
	});

	const streaming = status === "submitted" || status === "streaming";

	activeSessionIdRef.current = activeSessionId;

	const runtimeFor = (sessionId: string) =>
		state.runtimes.find((runtime) => runtime.sessionId === sessionId);
	const activeSession = state.sessions.find((session) => session.id === activeSessionId);
	const activeRuntime = activeSessionId ? runtimeFor(activeSessionId) : undefined;

	// 切换会话：优先从缓存恢复；未加载过则拉取历史页注入
	useEffect(() => {
		if (!activeSessionId) return;
		if (loadedSessionsRef.current.has(activeSessionId)) {
			setMessages(messagesBySessionRef.current[activeSessionId] ?? []);
			return;
		}
		void fetchMessagePage(activeSessionId)
			.then((page) => {
				const history = chatMessagesToUiMessages(page.messages);
				messagesBySessionRef.current[activeSessionId] = history;
				historyMetaRef.current[activeSessionId] = {
					total: page.total,
					nextBefore: page.nextBefore,
				};
				loadedSessionsRef.current.add(activeSessionId);
				// 仅当仍停留在该会话时才注入（避免切走后 setMessages 串台）
				if (activeSessionIdRef.current === activeSessionId) {
					setMessages(history);
				}
			})
			.catch(() => {
				// 历史加载失败：保留空时间线，不阻塞流式
			});
	}, [activeSessionId, setMessages]);

	// 流式期间同步缓存：仅 streaming 时回写（空闲时 setMessages 来自历史恢复/分页，
	// 对应逻辑已各自写缓存；这里若无条件覆盖会把刚恢复的历史再次清空）
	useEffect(() => {
		if (!activeSessionId || !streaming) return;
		messagesBySessionRef.current[activeSessionId] = messages;
		loadedSessionsRef.current.add(activeSessionId);
	}, [messages, activeSessionId, streaming]);

	// 模型列表是全局 pi 配置，草稿会话也需要先选模型再发送第一条消息。
	useEffect(() => {
		void fetchModels().then(setModels).catch(() => setModels([]));
	}, []);

	// 低频轮询项目/会话/运行态（3s；useChat 负责消息流，不参与轮询）
	useEffect(() => {
		let disposed = false;
		const refresh = async () => {
			try {
				const next = await fetchState();
				if (disposed) return;
				setState(next);
				setConnected(true);
				// 初始页面保持空会话，让用户明确选择项目/会话；外部删除当前会话时也回到空状态。
				if (activeSessionIdRef.current && !next.sessions.some((session) => session.id === activeSessionIdRef.current)) {
					setActiveSessionId("");
				}
			} catch {
				if (!disposed) setConnected(false);
			}
		};
		void refresh();
		const timer = setInterval(refresh, 3000);
		return () => {
			disposed = true;
			clearInterval(timer);
		};
		// activeSessionId 变化后下一轮轮询会补齐最新状态，不必重启轮询
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	const handleSend = (text: string) => {
		if (!activeSessionId || !text.trim()) return;
		void sendMessage({ text });
	};

	const handleCreateSession = async (projectId: string) => {
		setCreatingProjectId(projectId);
		setCommandError(null);
		try {
			const id = await createSession(projectId);
			// 新会话无历史：预标记已加载（空缓存），避免切过去时多余拉取
			loadedSessionsRef.current.add(id);
			messagesBySessionRef.current[id] = [];
			historyMetaRef.current[id] = { total: 0, nextBefore: null };
			setActiveSessionId(id);
			setMobileSidebarOpen(false);
			await refreshNow();
		} catch (error) {
			setCommandError(error instanceof Error ? error.message : String(error));
			setConnected(false);
		} finally {
			setCreatingProjectId("");
		}
	};

	const handleCreateProject = async (path: string): Promise<WebProject> => {
		setCommandError(null);
		try {
			const project = await createProject(path);
			await refreshNow();
			return project;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			setCommandError(message);
			throw error;
		}
	};

	const handleDeleteProject = async (projectId: string) => {
		setCommandError(null);
		try {
			const deletedSessions = state.sessions.filter((session) => session.projectId === projectId);
			await deleteProject(projectId);
			for (const session of deletedSessions) {
				delete messagesBySessionRef.current[session.id];
				delete historyMetaRef.current[session.id];
				loadedSessionsRef.current.delete(session.id);
			}
			setState((current) => ({
				...current,
				projects: current.projects.filter((project) => project.id !== projectId),
				sessions: current.sessions.filter((session) => session.projectId !== projectId),
				runtimes: current.runtimes.filter((runtime) => !deletedSessions.some((session) => session.id === runtime.sessionId)),
			}));
			if (deletedSessions.some((session) => session.id === activeSessionId)) {
				setActiveSessionId("");
			}
			setMobileSidebarOpen(false);
		} catch (error) {
			setCommandError(error instanceof Error ? error.message : String(error));
		}
	};

	const updateActiveSessionState = (patch: { model?: { provider: string; modelId: string }; thinkingLevel?: string }) => {
		setState((current) => ({
			...current,
			sessions: current.sessions.map((session) =>
				session.id === activeSessionId ? { ...session, ...patch } : session,
			),
		}));
	};

	const handleModelChange = async (model: AvailableModel) => {
		if (!activeSessionId) return;
		setCommandError(null);
		try {
			if (activeRuntime) {
				await setRuntimeModel(
					{
						sessionId: activeRuntime.sessionId,
						agentId: activeRuntime.agentId,
						runtimeGeneration: activeRuntime.runtimeGeneration ?? 0,
					},
					model.provider,
					model.id,
				);
			} else {
				await updateSessionRecord(activeSessionId, {
					model: { provider: model.provider, modelId: model.id },
				});
			}
			updateActiveSessionState({ model: { provider: model.provider, modelId: model.id } });
		} catch (error) {
			setCommandError(error instanceof Error ? error.message : String(error));
		}
	};

	const handleThinkingChange = async (level: string) => {
		if (!activeSessionId) return;
		setCommandError(null);
		try {
			if (activeRuntime) {
				await setRuntimeThinking(
					{
						sessionId: activeRuntime.sessionId,
						agentId: activeRuntime.agentId,
						runtimeGeneration: activeRuntime.runtimeGeneration ?? 0,
					},
					level,
				);
			} else {
				await updateSessionRecord(activeSessionId, { thinkingLevel: level });
			}
			updateActiveSessionState({ thinkingLevel: level });
		} catch (error) {
			setCommandError(error instanceof Error ? error.message : String(error));
		}
	};

	const refreshNow = async () => {
		try {
			setState(await fetchState());
			setConnected(true);
		} catch {
			setConnected(false);
		}
	};

	const handleLoadMore = async () => {
		if (!activeSessionId || streaming || loadingMore) return;
		const meta = historyMetaRef.current[activeSessionId];
		if (!meta || meta.nextBefore == null) return;
		setLoadingMore(true);
		try {
			const page = await fetchMessagePage(activeSessionId, meta.nextBefore);
			// 前插更早的消息：更新缓存与游标后，把「旧页 + 当前全部消息」重新注入
			historyMetaRef.current[activeSessionId] = {
				total: page.total,
				nextBefore: page.nextBefore,
			};
			const older = chatMessagesToUiMessages(page.messages);
			const merged = [...older, ...messagesBySessionRef.current[activeSessionId]];
			messagesBySessionRef.current[activeSessionId] = merged;
			setMessages(merged);
		} catch {
			// 分页失败保持现状
		} finally {
			setLoadingMore(false);
		}
	};

	// 头部运行态：流式优先；否则用轮询到的 runtime 状态兜底
	const headerStatus: WebHeaderStatus = (() => {
		if (streaming) return "running";
		const runtimeStatus = activeRuntime?.status;
		if (runtimeStatus === "starting") return "starting";
		if (runtimeStatus === "running") return "running";
		if (runtimeStatus === "error") return "error";
		return "idle";
	})();

	const activeMeta = activeSessionId ? historyMetaRef.current[activeSessionId] : undefined;
	const hasMoreHistory = Boolean(activeMeta && activeMeta.nextBefore != null && !streaming);
	const moreCount = activeMeta
		? Math.max(0, activeMeta.total - messagesBySessionRef.current[activeSessionId]?.length)
		: 0;

	return (
		<div className="app wechat-shell flex h-screen w-full min-w-0 overflow-hidden bg-background text-foreground">
			<WebSidebar
				state={state}
				activeSessionId={activeSessionId}
				creatingProjectId={creatingProjectId}
				connected={connected}
				mobileOpen={mobileSidebarOpen}
				onCloseMobile={() => setMobileSidebarOpen(false)}
				onSelectSession={(sessionId) => {
					setActiveSessionId(sessionId);
					setMobileSidebarOpen(false);
				}}
				onCreateSession={(projectId) => void handleCreateSession(projectId)}
				onCreateProject={handleCreateProject}
				onDeleteProject={handleDeleteProject}
			/>
			<main className="chat-pane flex h-full min-w-0 flex-1 flex-col overflow-hidden">
				<WebHeader
					title={activeSession?.title || t("web.chooseSession")}
					status={headerStatus}
					onOpenSidebar={() => setMobileSidebarOpen(true)}
					model={activeSession?.model}
					thinkingLevel={activeSession?.thinkingLevel}
					models={models}
					onModelChange={(model) => void handleModelChange(model)}
					onThinkingChange={(level) => void handleThinkingChange(level)}
				/>
				<WebTimeline
					messages={messages}
					hasActiveSession={Boolean(activeSession)}
					hasMoreHistory={hasMoreHistory}
					moreCount={moreCount}
					loadingMore={loadingMore}
					streaming={streaming}
					error={error?.message ?? commandError}
					onLoadMore={() => void handleLoadMore()}
				/>
				<WebComposer
					disabled={!activeSessionId}
					streaming={streaming}
					onSend={handleSend}
					onStop={() => stop()}
				/>
			</main>
		</div>
	);
}
