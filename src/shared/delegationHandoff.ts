import type { DelegationHandoffFields } from "./types/delegation";

export const DELEGATION_HANDOFF_LIMITS = {
	task: 20_000,
	result: 20_000,
	changedFiles: 8_000,
	validation: 8_000,
	childSessionId: 256,
} as const;

export type DelegationHandoffLabels = {
	title: string;
	task: string;
	result: string;
	changedFiles: string;
	validation: string;
	childSession: string;
};

function bounded(value: string | undefined, limit: number): string {
	return (value ?? "").trim().slice(0, limit);
}

/** Formats only the explicit handoff fields, never the child transcript or hidden runtime state. */
export function formatDelegationHandoff(
	fields: DelegationHandoffFields,
	childSessionIdInput: string,
	labels: DelegationHandoffLabels,
): string {
	const task = bounded(fields.task, DELEGATION_HANDOFF_LIMITS.task);
	const result = bounded(fields.result, DELEGATION_HANDOFF_LIMITS.result);
	const changedFiles = bounded(fields.changedFiles, DELEGATION_HANDOFF_LIMITS.changedFiles);
	const validation = bounded(fields.validation, DELEGATION_HANDOFF_LIMITS.validation);
	const childSessionId = bounded(childSessionIdInput, DELEGATION_HANDOFF_LIMITS.childSessionId);
	const sections = [
		labels.title,
		`${labels.task}:\n${task}`,
		`${labels.result}:\n${result}`,
	];
	if (changedFiles) sections.push(`${labels.changedFiles}:\n${changedFiles}`);
	if (validation) sections.push(`${labels.validation}:\n${validation}`);
	sections.push(`${labels.childSession}:\n${childSessionId}`);
	return sections.join("\n\n");
}
