import type {
	DelegationSelectedContextMessage,
} from "./types/delegation";

export const DELEGATION_BRIEF_LIMITS = {
	task: 20_000,
	selectedMessages: 12,
	selectedMessage: 4_000,
	selectedContext: 20_000,
	constraints: 8_000,
	acceptanceCriteria: 8_000,
	relevantFiles: 8_000,
} as const;

export type DelegationBriefLabels = {
	task: string;
	selectedContext: string;
	constraints: string;
	acceptanceCriteria: string;
	relevantFiles: string;
	user: string;
	assistant: string;
};

export type DelegationBriefInput = {
	task: string;
	selectedContext: readonly DelegationSelectedContextMessage[];
	constraints?: string;
	acceptanceCriteria?: string;
	relevantFiles?: string;
};

function bounded(value: string | undefined, limit: number): string {
	return (value ?? "").trim().slice(0, limit);
}

/** Builds a bounded selected-context brief; unknown transcript/runtime fields never enter the output. */
export function buildDelegationBrief(
	input: DelegationBriefInput,
	labels: DelegationBriefLabels,
): string {
	const task = bounded(input.task, DELEGATION_BRIEF_LIMITS.task);
	const selected = input.selectedContext
		.filter((message) => message.role === "user" || message.role === "assistant")
		.slice(0, DELEGATION_BRIEF_LIMITS.selectedMessages)
		.map((message) => {
			const label = message.role === "user" ? labels.user : labels.assistant;
			return `[${label}] ${bounded(message.content, DELEGATION_BRIEF_LIMITS.selectedMessage)}`;
		})
		.join("\n")
		.slice(0, DELEGATION_BRIEF_LIMITS.selectedContext);
	const constraints = bounded(input.constraints, DELEGATION_BRIEF_LIMITS.constraints);
	const acceptanceCriteria = bounded(input.acceptanceCriteria, DELEGATION_BRIEF_LIMITS.acceptanceCriteria);
	const relevantFiles = bounded(input.relevantFiles, DELEGATION_BRIEF_LIMITS.relevantFiles);
	const sections = [
		`${labels.task}\n${task}`,
		`${labels.selectedContext}\n${selected}`,
		`${labels.constraints}\n${constraints}`,
		`${labels.acceptanceCriteria}\n${acceptanceCriteria}`,
	];
	if (relevantFiles) sections.push(`${labels.relevantFiles}\n${relevantFiles}`);
	return sections.join("\n\n");
}
