/**
 * Web 端（A2 React）状态类型。
 *
 * 与后端 /api/state 返回结构对齐（WebServiceManager.getState），
 * 由 webApi.ts 轮询填充。会话/运行态只读展示用，不持有桌面端 atoms。
 */

export type WebProject = {
	id: string;
	name: string;
	path: string;
	kind?: "chat";
};

export type WebSession = {
	id: string;
	projectId: string;
	title: string;
	status: string;
	projectPath?: string;
	model?: { provider: string; modelId: string };
	thinkingLevel?: string;
};

export type WebRuntime = {
	sessionId: string;
	agentId: string;
	status: string;
	cwd?: string;
	runtimeGeneration?: number;
};

export type WebState = {
	projects: WebProject[];
	sessions: WebSession[];
	runtimes: WebRuntime[];
};
