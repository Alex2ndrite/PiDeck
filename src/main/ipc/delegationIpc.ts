import { randomUUID } from "node:crypto";
import { ipcMain } from "electron";
import { ipcChannels } from "../../shared/ipc";
import type {
	CreateDelegationInput,
	CreateDelegationResult,
	DelegationRole,
	Project,
	SendSessionPromptInput,
} from "../../shared/types";
import { DelegationStore } from "../delegation/DelegationStore";
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
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isDelegationRole(value: string): value is DelegationRole {
	return ROLES.some((role) => role === value);
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
	return { parentSessionId, task, role, model, thinkingLevel };
}

function titleFromTask(task: string): string {
	const firstLine = task.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? "Delegated task";
	return firstLine.slice(0, 96);
}

function projectForSession(projectStore: ProjectStore, projectId: string): Project {
	const project = projectStore.get(projectId);
	if (!project) throw new Error("Project not found");
	return project;
}

export function registerDelegationIpc(deps: DelegationIpcDeps): void {
	const { store, projectStore, sessionCatalog, sessionRuntimeCoordinator, appLogger } = deps;
	ipcMain.handle(ipcChannels.delegationsList, async () => store.list());
	ipcMain.handle(ipcChannels.delegationsCreate, async (_event, rawInput: unknown): Promise<CreateDelegationResult> => {
		// IPC input is untrusted; normalize and bound it before touching catalog/runtime state.
		const input = parseInput(rawInput);
		const parent = sessionCatalog.getRecord(input.parentSessionId);
		if (!parent || parent.source !== "pi" || parent.noSession === true || parent.status !== "active" || !parent.filePath) {
			throw new Error("Delegation parent must be a persistent Pi session");
		}
		if (store.findByChild(parent.id)) throw new Error("Recursive delegation is not supported");
		const project = projectForSession(projectStore, parent.projectId);
		const environment = parent.environment;
		const childSession = await sessionCatalog.createDraft({
			projectId: project.id,
			title: titleFromTask(input.task),
			environment,
			source: "pi",
			model: input.model,
		});
		const delegation = await store.create({
			...input,
			childSessionId: childSession.id,
			workspacePath: project.path,
		});
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
		const promptInput: SendSessionPromptInput = {
			sessionId: childSession.id,
			requestId: randomUUID(),
			message: input.task,
		};
		const prompt = await sessionRuntimeCoordinator.send(promptInput);
		if (prompt.sessionPath) {
			await sessionCatalog.attachRuntime({
				sessionId: childSession.id,
				filePath: prompt.sessionPath,
			});
		}
		const latestChildSession = sessionCatalog.getRecord(childSession.id) ?? childSession;
		void appLogger.info("delegation", "Delegation child created", {
			delegationId: delegation.id,
			parentSessionId: parent.id,
			childSessionId: childSession.id,
			role: delegation.role,
			taskLength: input.task.length,
		});
		return { delegation, childSession: latestChildSession, prompt };
	});
}
