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
