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
