import { randomUUID } from "node:crypto";
import { ipcMain } from "electron";
import { ipcChannels } from "../../shared/ipc";
import type {
	CreateDelegationInput,
	CreateDelegationResult,
	DelegationContextMode,
	DelegationRole,
	DelegationSelectedContextMessage,
	DelegationWorkspaceMode,
	ReturnDelegationInput,
	ReturnDelegationResult,
	Project,
	SessionEnvironment,
	SendSessionPromptInput,
	SendSessionPromptResult,
} from "../../shared/types";
import { DELEGATION_BRIEF_LIMITS, buildDelegationBrief } from "../../shared/delegationBrief";
import { DELEGATION_HANDOFF_LIMITS, formatDelegationHandoff } from "../../shared/delegationHandoff";
import type { MainProcessTranslationKey } from "../../shared/i18n/mainProcessCopy";
import { DelegationStore } from "../delegation/DelegationStore";
import type { DelegationStoreCreateInput } from "../delegation/DelegationStore";
import type { DelegationWorktreeManager, DelegationWorktreeResult } from "../delegation/DelegationWorktreeManager";
import type { ProjectStore } from "../projects/ProjectStore";
import type { SessionCatalog } from "../sessions/SessionCatalog";
import type { SessionRuntimeCoordinator } from "../sessions/SessionRuntimeCoordinator";
import type { AppLogger } from "../logging/AppLogger";

const ROLES: readonly DelegationRole[] = ["explore", "implement", "review", "consult"];
const MAX_TASK_LENGTH = 20_000;
const MAX_MODEL_FIELD_LENGTH = 256;
const MAX_THINKING_LEVEL_LENGTH = 64;

export type DelegationIpcDeps = {
	store: DelegationStore;
	projectStore: ProjectStore;
	sessionCatalog: SessionCatalog;
	sessionRuntimeCoordinator: SessionRuntimeCoordinator;
	appLogger: Pick<AppLogger, "info">;
	translate: (key: MainProcessTranslationKey) => string;
	worktreeManager: DelegationWorktreeManager;
	cloneSessionFile: (projectId: string, filePath: string, environment: SessionEnvironment) => Promise<unknown>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isDelegationRole(value: string): value is DelegationRole {
	return ROLES.some((role) => role === value);
}

function isContextMode(value: string): value is DelegationContextMode {
	return value === "fresh" || value === "selected" || value === "fork";
}

function isWorkspaceMode(value: string): value is DelegationWorkspaceMode {
	return value === "shared" || value === "worktree";
}

function parseOptionalBoundedText(value: Record<string, unknown>, key: string, limit: number): string | undefined {
	const raw = value[key];
	if (raw === undefined) return undefined;
	if (typeof raw !== "string") throw new Error("Invalid delegation input");
	const text = raw.trim();
	if (text.length > limit) throw new Error("Invalid delegation input");
	return text || undefined;
}

function parseInput(value: unknown): CreateDelegationInput {
	if (!isRecord(value)) throw new Error("Invalid delegation input");
	const parentSessionId = typeof value.parentSessionId === "string" ? value.parentSessionId.trim() : "";
	const task = typeof value.task === "string" ? value.task.trim() : "";
	const role = typeof value.role === "string" ? value.role.trim() : "";
	if (!parentSessionId || !task || task.length > MAX_TASK_LENGTH || !isDelegationRole(role)) {
		throw new Error("Invalid delegation input");
	}
	let model: CreateDelegationInput["model"];
	if (value.model !== undefined) {
		if (!isRecord(value.model)) throw new Error("Invalid delegation model");
		const provider = typeof value.model.provider === "string" ? value.model.provider.trim() : "";
		const modelId = typeof value.model.modelId === "string" ? value.model.modelId.trim() : "";
		if (!provider || !modelId || provider.length > MAX_MODEL_FIELD_LENGTH || modelId.length > MAX_MODEL_FIELD_LENGTH) {
			throw new Error("Invalid delegation model");
		}
		model = { provider, modelId };
	}
	let thinkingLevel: string | undefined;
	if (value.thinkingLevel !== undefined) {
		if (typeof value.thinkingLevel !== "string") throw new Error("Invalid delegation thinking level");
		thinkingLevel = value.thinkingLevel.trim();
		if (!thinkingLevel || thinkingLevel.length > MAX_THINKING_LEVEL_LENGTH) throw new Error("Invalid delegation thinking level");
	}
	const contextMode = value.contextMode === undefined ? "fresh" : typeof value.contextMode === "string" ? value.contextMode.trim() : "";
	const workspaceMode = value.workspaceMode === undefined ? "shared" : typeof value.workspaceMode === "string" ? value.workspaceMode.trim() : "";
	if (!isContextMode(contextMode) || !isWorkspaceMode(workspaceMode)) throw new Error("Invalid delegation context or workspace mode");
	if (workspaceMode === "worktree" && role !== "implement") throw new Error("Worktree delegation requires implement role");
	const constraints = parseOptionalBoundedText(value, "constraints", DELEGATION_BRIEF_LIMITS.constraints);
	const acceptanceCriteria = parseOptionalBoundedText(value, "acceptanceCriteria", DELEGATION_BRIEF_LIMITS.acceptanceCriteria);
	const relevantFiles = parseOptionalBoundedText(value, "relevantFiles", DELEGATION_BRIEF_LIMITS.relevantFiles);
	let selectedContext: DelegationSelectedContextMessage[] | undefined;
	if (contextMode === "selected") {
		if (!Array.isArray(value.selectedContext) || value.selectedContext.length < 1 || value.selectedContext.length > DELEGATION_BRIEF_LIMITS.selectedMessages) {
			throw new Error("Invalid selected delegation context");
		}
		let totalLength = 0;
		selectedContext = [];
		for (const item of value.selectedContext) {
			if (!isRecord(item) || (item.role !== "user" && item.role !== "assistant") || typeof item.content !== "string") {
				throw new Error("Invalid selected delegation context");
			}
			const content = item.content.trim();
			if (!content || content.length > DELEGATION_BRIEF_LIMITS.selectedMessage) throw new Error("Invalid selected delegation context");
			totalLength += content.length;
			if (totalLength > DELEGATION_BRIEF_LIMITS.selectedContext) throw new Error("Invalid selected delegation context");
			selectedContext.push({ role: item.role, content });
		}
	} else if (value.selectedContext !== undefined) {
		// Non-selected modes never accept transcript-like renderer payloads.
		throw new Error("Selected context requires selected mode");
	}
	return {
		parentSessionId,
		task,
		role,
		model,
		thinkingLevel,
		contextMode,
		workspaceMode,
		selectedContext,
		constraints,
		acceptanceCriteria,
		relevantFiles,
	};
}

function parseReturnInput(value: unknown): ReturnDelegationInput {
	if (!isRecord(value)) throw new Error("Invalid delegation handoff input");
	const childSessionId = typeof value.childSessionId === "string" ? value.childSessionId.trim() : "";
	const task = typeof value.task === "string" ? value.task.trim() : "";
	const result = typeof value.result === "string" ? value.result.trim() : "";
	if (!childSessionId || childSessionId.length > DELEGATION_HANDOFF_LIMITS.childSessionId || !task || !result) {
		throw new Error("Invalid delegation handoff input");
	}
	if (task.length > DELEGATION_HANDOFF_LIMITS.task || result.length > DELEGATION_HANDOFF_LIMITS.result) {
		throw new Error("Invalid delegation handoff input");
	}
	const parseOptional = (key: "changedFiles" | "validation", limit: number): string | undefined => {
		const raw = value[key];
		if (raw === undefined) return undefined;
		if (typeof raw !== "string") throw new Error("Invalid delegation handoff input");
		const trimmed = raw.trim();
		if (trimmed.length > limit) throw new Error("Invalid delegation handoff input");
		return trimmed || undefined;
	};
	return {
		childSessionId,
		task,
		result,
		changedFiles: parseOptional("changedFiles", DELEGATION_HANDOFF_LIMITS.changedFiles),
		validation: parseOptional("validation", DELEGATION_HANDOFF_LIMITS.validation),
	};
}

function titleFromTask(task: string): string {
	const firstLine = task.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? "Delegated task";
	return firstLine.slice(0, 96);
}

function cloneResultToSessionPath(value: unknown): string {
	if (!isRecord(value) || typeof value.sessionPath !== "string" || !value.sessionPath.trim()) {
		throw new Error("Pi clone did not return a session path");
	}
	return value.sessionPath.trim();
}

function taskPromptFailure(sessionId: string, requestId: string, error: unknown): SendSessionPromptResult {
	return {
		accepted: false,
		error: "DELEGATION_TASK_DELIVERY_FAILED",
		delivery: "rejected",
		sessionId,
		requestId,
		debugDetails: error instanceof Error ? error.message : String(error),
	};
}

function briefLabels(translate: (key: MainProcessTranslationKey) => string) {
	return {
		task: translate("mainDelegation.briefTask"),
		selectedContext: translate("mainDelegation.briefSelectedContext"),
		constraints: translate("mainDelegation.briefConstraints"),
		acceptanceCriteria: translate("mainDelegation.briefAcceptanceCriteria"),
		relevantFiles: translate("mainDelegation.briefRelevantFiles"),
		user: translate("mainDelegation.briefUser"),
		assistant: translate("mainDelegation.briefAssistant"),
	};
}

function projectForSession(projectStore: ProjectStore, projectId: string): Project {
	const project = projectStore.get(projectId);
	if (!project) throw new Error("Project not found");
	return project;
}

export function registerDelegationIpc(deps: DelegationIpcDeps): void {
	const { store, projectStore, sessionCatalog, sessionRuntimeCoordinator, appLogger, translate, worktreeManager, cloneSessionFile } = deps;
	ipcMain.handle(ipcChannels.delegationsList, async () => store.list());
	ipcMain.handle(ipcChannels.delegationsCreate, async (_event, rawInput: unknown): Promise<CreateDelegationResult> => {
		// IPC input is untrusted; normalize and bound it before touching catalog/runtime state.
		const input = parseInput(rawInput);
		const parent = sessionCatalog.getRecord(input.parentSessionId);
		if (!parent || parent.source !== "pi" || parent.noSession === true || parent.status !== "active" || !parent.filePath) {
			throw new Error("Delegation parent must be a persistent Pi session");
		}
		if (store.findByChild(parent.id)) throw new Error("Recursive delegation is not supported");
		const parentProject = projectForSession(projectStore, parent.projectId);
		const environment = parent.environment;
		let worktreeResult: DelegationWorktreeResult | undefined;
		let childSession: ReturnType<SessionCatalog["getRecord"]>;
		let relationPersisted = false;
		try {
			let targetProject = parentProject;
			if (input.workspaceMode === "worktree") {
				worktreeResult = await worktreeManager.create(parentProject);
				targetProject = worktreeResult.childProject;
			}
			const title = titleFromTask(input.task);
			if (input.contextMode === "fork") {
				const cloneResult = await cloneSessionFile(targetProject.id, parent.filePath, environment);
				const sessionPath = cloneResultToSessionPath(cloneResult);
				const entry = await sessionCatalog.ensureRuntimeTarget({
					projectId: targetProject.id,
					title,
					source: "pi",
					environment,
					filePath: sessionPath,
				});
				childSession = sessionCatalog.getRecord(entry.id);
				if (!childSession) throw new Error("Cloned delegation session was not registered");
				if (input.model) {
					childSession = await sessionCatalog.update(childSession.id, { model: input.model });
				}
			} else {
				childSession = await sessionCatalog.createDraft({
					projectId: targetProject.id,
					title,
					environment,
					source: "pi",
					model: input.model,
				});
			}
			if (!childSession) throw new Error("Delegation child session was not created");
			const storeInput: DelegationStoreCreateInput = {
				parentSessionId: parent.id,
				childSessionId: childSession.id,
				task: input.task,
				role: input.role,
				model: input.model,
				contextMode: input.contextMode ?? "fresh",
				workspace: { mode: input.workspaceMode ?? "shared", path: targetProject.path },
			};
			const delegation = await store.create(storeInput);
			relationPersisted = true;
			const promptInput: SendSessionPromptInput = {
				sessionId: childSession.id,
				requestId: randomUUID(),
				message: input.contextMode === "selected"
					? buildDelegationBrief({
						task: input.task,
						selectedContext: input.selectedContext ?? [],
						constraints: input.constraints,
						acceptanceCriteria: input.acceptanceCriteria,
						relevantFiles: input.relevantFiles,
					}, briefLabels(translate))
					: input.task,
			};
			let prompt: SendSessionPromptResult;
			try {
				if (input.thinkingLevel) {
					const activated = await sessionRuntimeCoordinator.activateRuntime(childSession.id);
					if (!activated.ok) throw new Error(activated.error.debugDetails || activated.error.code);
					const levels = await sessionRuntimeCoordinator.listRuntimeThinkingLevels(activated.value);
					if (!levels.ok) throw new Error(levels.error.debugDetails || levels.error.code);
					if (levels.value.value.includes(input.thinkingLevel)) {
						const applied = await sessionRuntimeCoordinator.setRuntimeThinking(levels.value.target, input.thinkingLevel);
						if (!applied.ok) throw new Error(applied.error.debugDetails || applied.error.code);
					}
				}
				prompt = await sessionRuntimeCoordinator.send(promptInput);
			} catch (error) {
				prompt = taskPromptFailure(childSession.id, promptInput.requestId, error);
			}
			if (prompt.sessionPath) {
				try {
					await sessionCatalog.attachRuntime({ sessionId: childSession.id, filePath: prompt.sessionPath });
				} catch (error) {
					void appLogger.info("delegation", "Delegation runtime attach failed", {
						childSessionId: childSession.id,
						debugDetails: error instanceof Error ? error.message : String(error),
					});
				}
			}
			const latestChildSession = sessionCatalog.getRecord(childSession.id) ?? childSession;
			void appLogger.info("delegation", "Delegation child created", {
				delegationId: delegation.id,
				parentSessionId: parent.id,
				childSessionId: childSession.id,
				role: delegation.role,
				contextMode: delegation.contextMode,
				workspaceMode: delegation.workspace.mode,
				targetProjectId: latestChildSession.projectId,
				taskLength: input.task.length,
				accepted: prompt.accepted,
			});
			return { delegation, childSession: latestChildSession, prompt };
		} catch (error) {
			if (!relationPersisted) {
				let canRollbackWorktree = !childSession;
				if (childSession) {
					const removed = await sessionCatalog.remove(childSession.id).catch(() => false);
					canRollbackWorktree = removed || !sessionCatalog.getRecord(childSession.id);
				}
				// Never remove a worktree while an uncertain catalog record still points at it.
				if (worktreeResult && canRollbackWorktree) await worktreeManager.rollback(worktreeResult).catch(() => false);
			}
			throw error;
		}
	});
	ipcMain.handle(ipcChannels.delegationsReturnToParent, async (_event, rawInput: unknown): Promise<ReturnDelegationResult> => {
		const input = parseReturnInput(rawInput);
		const child = sessionCatalog.getRecord(input.childSessionId);
		const relation = store.findByChild(input.childSessionId);
		if (!child || !relation) throw new Error("Delegation child or relation not found");
		const parent = sessionCatalog.getRecord(relation.parentSessionId);
		if (!parent || parent.source !== "pi" || parent.noSession === true || parent.status !== "active" || !parent.filePath) {
			throw new Error("Delegation parent must be a persistent Pi session");
		}
		const message = formatDelegationHandoff(input, child.id, {
			title: translate("mainDelegation.handoffTitle"),
			task: translate("mainDelegation.handoffTask"),
			result: translate("mainDelegation.handoffResult"),
			changedFiles: translate("mainDelegation.handoffChangedFiles"),
			validation: translate("mainDelegation.handoffValidation"),
			childSession: translate("mainDelegation.handoffChildSession"),
		});
		const prompt = await sessionRuntimeCoordinator.send({
			sessionId: parent.id,
			requestId: randomUUID(),
			message,
		});
		const latestParent = sessionCatalog.getRecord(parent.id) ?? parent;
		void appLogger.info("delegation", "Delegation result returned", {
			parentSessionId: parent.id,
			childSessionId: child.id,
			taskLength: input.task.length,
			resultLength: input.result.length,
			changedFilesLength: input.changedFiles?.length ?? 0,
			validationLength: input.validation?.length ?? 0,
			accepted: prompt.accepted,
		});
		return { parentSession: latestParent, prompt };
	});
}
