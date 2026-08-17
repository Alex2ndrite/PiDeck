import type { SessionRecord, SendSessionPromptResult } from "./session";

export type DelegationRole = "explore" | "implement" | "review" | "consult";

/** Durable relationship metadata; conversation content remains in the child session JSONL. */
export type DelegationRecord = {
	id: string;
	parentSessionId: string;
	childSessionId: string;
	task: string;
	role: DelegationRole;
	model?: { provider: string; modelId: string };
	contextMode: "fresh";
	workspace: { mode: "shared"; path: string };
	createdAt: number;
};

export type CreateDelegationInput = {
	parentSessionId: string;
	task: string;
	role: DelegationRole;
	model?: { provider: string; modelId: string };
	thinkingLevel?: string;
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
