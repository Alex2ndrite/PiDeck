import type { SessionRecord, SendSessionPromptResult } from "./session";

export type DelegationRole = "explore" | "implement" | "review" | "consult";

export type DelegationContextMode = "fresh" | "selected" | "fork";
export type DelegationWorkspaceMode = "shared" | "worktree";

export type DelegationSelectedContextMessage = {
	role: "user" | "assistant";
	content: string;
};

export function isDelegationContextMode(value: string): value is DelegationContextMode {
	return value === "fresh" || value === "selected" || value === "fork";
}

export function isDelegationWorkspaceMode(value: string): value is DelegationWorkspaceMode {
	return value === "shared" || value === "worktree";
}

/**
 * 角色对应的能力档（P4）。`allowedTools` 为空表示不下发 pi 工具白名单，
 * 即继承 pi 默认工具集（writer 档）；非空表示只读档的能力上限。
 */
export type DelegationCapabilityProfile = {
	role: DelegationRole;
	writable: boolean;
	allowedTools: readonly string[];
};

export type DelegationPreflightCheckId =
	| "cwd"
	| "pi"
	| "model"
	| "provider"
	| "capability"
	| "worktree";

/** fail 阻断 spawn；warn 只提示（例如免鉴权的本地 provider）；skip 表示本次不涉及该检查。 */
export type DelegationPreflightStatus = "pass" | "warn" | "fail" | "skip";

/** `detail` 只放标识符（provider/model/path 等），用户可见文案由渲染层按 id + status 组装。 */
export type DelegationPreflightCheck = {
	id: DelegationPreflightCheckId;
	status: DelegationPreflightStatus;
	detail?: string;
};

export type DelegationPreflightReport = {
	ok: boolean;
	checks: DelegationPreflightCheck[];
};

/** Spawn 前预检输入：只描述「要创建什么样的 child」，不含 task/上下文。 */
export type DelegationPreflightInput = {
	parentSessionId: string;
	role: DelegationRole;
	model?: { provider: string; modelId: string };
	workspaceMode?: DelegationWorkspaceMode;
};

/** Durable relationship metadata; conversation content remains in the child session JSONL. */
export type DelegationRecord = {
	id: string;
	parentSessionId: string;
	childSessionId: string;
	task: string;
	role: DelegationRole;
	model?: { provider: string; modelId: string };
	contextMode: DelegationContextMode;
	workspace: { mode: DelegationWorkspaceMode; path: string };
	createdAt: number;
};

export type CreateDelegationInput = {
	parentSessionId: string;
	task: string;
	role: DelegationRole;
	model?: { provider: string; modelId: string };
	thinkingLevel?: string;
	contextMode?: DelegationContextMode;
	workspaceMode?: DelegationWorkspaceMode;
	selectedContext?: DelegationSelectedContextMessage[];
	constraints?: string;
	acceptanceCriteria?: string;
	relevantFiles?: string;
};

export type CreateDelegationResult = {
	delegation: DelegationRecord;
	childSession: SessionRecord;
	prompt: SendSessionPromptResult;
};

/** Editable handoff payload; transcript content is deliberately not part of this contract. */
export type DelegationHandoffFields = {
	task: string;
	result: string;
	changedFiles?: string;
	validation?: string;
};

/** Renderer input for returning a child result to its durable parent relation. */
export type ReturnDelegationInput = DelegationHandoffFields & {
	childSessionId: string;
};

export type ReturnDelegationResult = {
	parentSession: SessionRecord;
	prompt: SendSessionPromptResult;
};
