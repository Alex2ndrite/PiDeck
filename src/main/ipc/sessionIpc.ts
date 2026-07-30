/**
 * Session IPC handlers: session list, catalog, runtime management, importers.
 * Phase 3.7: extracted from src/main/index.ts registerIpc().
 */

import { ipcMain, type BrowserWindow } from "electron";
import { ipcChannels } from "../../shared/ipc";
import { canonicalizeSessionPath } from "../../shared/sessionIdentity";
import type {
	CreateSessionDraftInput,
	CreateAnonymousSessionInput,
	CreateAnonymousSessionResult,
	UpdateSessionRecordInput,
	SendSessionPromptInput,
	SessionUiResponseInput,
	SessionRuntimeTarget,
	SessionRuntimeInfo,
	SessionRuntimeReplacement,
	SessionRuntimeEvent,
	SessionCommandError,
	SessionCommandResult,
	SendPromptInput,
	SendPromptResult,
} from "../../shared/types";
import type { ProjectStore } from "../projects/ProjectStore";
import type { SettingsStore } from "../settings/SettingsStore";
import type { SessionScanner } from "../sessions/SessionScanner";
import type { SessionCatalog } from "../sessions/SessionCatalog";
import type { SessionRuntimeCoordinator } from "../sessions/SessionRuntimeCoordinator";
import { SessionCommandIpcError } from "../sessions/SessionCommandIpcError";
import type { AgentManager } from "../pi/AgentManager";
import type { ConfigManager } from "../config/ConfigManager";
import type { TerminalSessionManager } from "../terminal/TerminalSessionManager";
import type { CodexSessionImporter } from "../sessions/CodexSessionImporter";
import type { ClaudeSessionImporter } from "../sessions/ClaudeSessionImporter";
import type { OpenCodeSessionImporter } from "../sessions/OpenCodeSessionImporter";
import type { AppLogger } from "../logging/AppLogger";

export type SessionIpcDeps = {
	projectStore: ProjectStore;
	settingsStore: SettingsStore;
	sessionScanner: SessionScanner;
	sessionCatalog: SessionCatalog;
	sessionRuntimeCoordinator: SessionRuntimeCoordinator;
	agentManager: AgentManager;
	configManager: ConfigManager;
	codexSessionImporter: CodexSessionImporter;
	claudeSessionImporter: ClaudeSessionImporter;
	openCodeSessionImporter: OpenCodeSessionImporter;
	appLogger: AppLogger;
	terminalManager: TerminalSessionManager;
	mainCopy: (key: string, params?: Record<string, string | number>) => string;
	getMainWindow: () => BrowserWindow | null;
	emitSessionRuntimeEvent: (agentId: string, channel: string, payload: unknown) => boolean;
	emitSessionRuntimeDetach: (target: SessionRuntimeTarget) => void;
	createAnonymousSession: (input: CreateAnonymousSessionInput) => Promise<CreateAnonymousSessionResult>;
	stopSessionRuntime: (target: SessionRuntimeTarget) => void;
	emitReplacementState: (runtime: SessionRuntimeInfo, includeMessages: boolean) => void;
	readCatalogSessionReferenceMessages: (sessionId: string) => Promise<unknown[]>;
	copyCatalogSession: (sessionId: string) => Promise<unknown>;
	exportCatalogSessionHtml: (sessionId: string) => Promise<Record<string, unknown> & { path: string }>;
	replaceAgentSession: (agentId: string, fn: () => Promise<any>) => Promise<any>;
};

function sessionCommandIpcError(
	error: SessionCommandError,
	appLogger: Pick<AppLogger, "warn">,
	mainCopy: (key: string, params?: Record<string, string | number>) => string,
): SessionCommandIpcError {
	if (error.debugDetails) {
		void appLogger.warn("session-command", "Session command failed", {
			code: error.code,
			debugDetails: error.debugDetails,
		});
	}
	return new SessionCommandIpcError(error, mainCopy);
}

export function registerSessionIpc(deps: SessionIpcDeps): void {
	const {
		projectStore,
		settingsStore,
		sessionScanner,
		sessionCatalog,
		sessionRuntimeCoordinator,
		agentManager,
		configManager,
		codexSessionImporter,
		claudeSessionImporter,
		openCodeSessionImporter,
		appLogger,
		terminalManager,
		mainCopy,
		getMainWindow,
		emitSessionRuntimeEvent,
		emitSessionRuntimeDetach,
		createAnonymousSession,
		stopSessionRuntime,
		emitReplacementState,
		readCatalogSessionReferenceMessages,
		copyCatalogSession,
		exportCatalogSessionHtml,
		replaceAgentSession,
	} = deps;

	ipcMain.handle(
		ipcChannels.sessionsList,
		async (_event, projectId?: string) => {
			const project = projectId ? projectStore.get(projectId) : undefined;
			let projectPath = project?.path;
			// WSL 模式：将 Windows 项目路径转为 WSL /mnt/ 格式，
			// 使 WSL 会话（CWD = /mnt/c/...）能正确匹配到项目。
			if (projectPath && settingsStore.get().wslEnabled && settingsStore.get().wslDistro) {
				projectPath = projectPath
					.replace(/^([A-Za-z]):\\/, (_: string, d: string) => `/mnt/${d.toLowerCase()}/`)
					.replace(/\\/g, '/');
			}
			return sessionScanner.list(projectPath);
		},
	);
	ipcMain.handle(
		ipcChannels.sessionsCatalogList,
		async (_event, projectId: string) => {
			const project = projectStore.get(projectId);
			if (!project) throw new Error(mainCopy("project.notFound"));
			let projectPath = project.path;
			const settings = settingsStore.get();
			if (settings.wslEnabled && settings.wslDistro) {
				projectPath = projectPath
					.replace(/^([A-Za-z]):\\/, (_: string, drive: string) => `/mnt/${drive.toLowerCase()}/`)
					.replace(/\\/g, "/");
			}
			const summaries = await sessionScanner.list(projectPath);
			const { wslEnabled, wslDistro, wslUser } = settings;
			const records = await sessionCatalog.mergeScanned(
				projectId,
				summaries,
				wslEnabled ? { wslDistro, wslUser } : {},
			);
			const bindings = sessionRuntimeCoordinator.attachCatalogRuntimes(records);
			for (const binding of bindings) {
				const tab = agentManager.list().find((candidate) => candidate.id === binding.agentId);
				if (tab) emitSessionRuntimeEvent(tab.id, ipcChannels.agentsState, tab);
			}
			return records;
		},
	);
	ipcMain.handle(
		ipcChannels.sessionsCatalogCreateDraft,
		async (_event, input: CreateSessionDraftInput) => {
			const project = projectStore.get(input.projectId);
			if (!project) throw new Error(mainCopy("project.notFound"));
			// Auto-fill model / thinkingLevel from pi config when the caller hasn't
			// provided them, so the composer bar shows the effective default.
			let model = input.model;
			let thinkingLevel = input.thinkingLevel;
			if (!model || !thinkingLevel) {
				try {
					const [settingsResult, modelsResult] = await Promise.all([
						configManager.getSettingsConfig(),
						configManager.getModelsConfig(),
					]);
					const settings = settingsResult.parsed;
					const defaultProvider = typeof settings.defaultProvider === "string"
						? settings.defaultProvider
						: undefined;
					const defaultModelId = typeof settings.defaultModel === "string"
						? settings.defaultModel
						: undefined;
					if (!model && defaultProvider && defaultModelId) {
						model = { provider: defaultProvider, modelId: defaultModelId };
					} else if (!model) {
						// Fallback: first provider's first model from models.json
						const providers = modelsResult.parsed?.providers;
						if (providers) {
							const firstProviderName = Object.keys(providers)[0];
							const firstProvider = firstProviderName ? providers[firstProviderName] : undefined;
							const firstModel = firstProvider?.models?.[0];
							if (firstProviderName && firstModel?.id) {
								model = { provider: firstProviderName, modelId: firstModel.id };
							}
						}
					}
					if (!thinkingLevel) {
						const level = typeof settings.defaultThinkingLevel === "string"
							? settings.defaultThinkingLevel
							: undefined;
						// pi's schema uses underscore; the runtime and UI use camelCase.
						thinkingLevel = level;
					}
				} catch {
					// Config read is best-effort; draft creation must never block.
				}
			}
			return sessionCatalog.createDraft({
				projectId: input.projectId,
				title: input.title?.trim() || mainCopy("session.newTitle"),
				environment: settingsStore.get().wslEnabled ? "wsl" : "native",
				model,
				thinkingLevel,
			});
		},
	);
	ipcMain.handle(
		ipcChannels.sessionsCreateAnonymous,
		(_event, input: CreateAnonymousSessionInput) => createAnonymousSession(input),
	);
	ipcMain.handle(
		ipcChannels.sessionsCatalogUpdate,
		async (_event, sessionId: string, patch: UpdateSessionRecordInput) => {
			const entry = sessionCatalog.get(sessionId);
			if (!entry) throw new Error(mainCopy("session.notFound"));
			const title = patch.title?.trim();
			if (title && title !== entry.title) {
				const target = sessionRuntimeCoordinator.getTarget(sessionId);
				if (target) {
					const renamed = await sessionRuntimeCoordinator.renameRuntime(target, title);
					if (!renamed.ok) throw sessionCommandIpcError(renamed.error, appLogger, mainCopy);
				} else if (entry.filePath) {
					await sessionScanner.rename(entry.filePath, title);
				}
			}
			return sessionCatalog.update(sessionId, {
				...patch,
				title: title || undefined,
			});
		},
	);
	ipcMain.handle(
		ipcChannels.sessionsCatalogDelete,
		async (_event, sessionId: string) => {
			const entry = sessionCatalog.get(sessionId);
			if (!entry) return false;
			// A draft may be promoted while a renderer click is in flight. Never delete
			// a catalog record that has acquired, or is acquiring, a Session runtime.
			if (
				sessionRuntimeCoordinator.getTarget(sessionId) ||
				sessionRuntimeCoordinator.isActivating(sessionId)
			) {
				throw new Error(mainCopy("session.stopBeforeDelete"));
			}
			if (entry.filePath) {
				const normalizedTarget = canonicalizeSessionPath(
					entry.filePath,
					entry.environment,
				);
				const usingAgent = agentManager.list().find((agent) => (
					agent.sessionPath &&
					agent.sessionEnvironment === entry.environment &&
					(entry.environment !== "wsl" || (
						agent.wslDistro === entry.wslDistro &&
						agent.wslUser === entry.wslUser
					)) &&
					canonicalizeSessionPath(agent.sessionPath, entry.environment) === normalizedTarget
				));
				if (usingAgent) {
					throw new Error(mainCopy("session.inUseDeleteBlocked", { title: usingAgent.title }));
				}
				await sessionScanner.delete(entry.filePath);
			}
			await sessionCatalog.remove(sessionId);
			void appLogger.info("session", "Catalog session deleted", { sessionId, filePath: entry.filePath });
			return true;
		},
	);
	ipcMain.handle(
		ipcChannels.sessionsCatalogReadMessages,
		async (_event, sessionId: string) => {
			const entry = sessionCatalog.get(sessionId);
			if (!entry?.filePath) return [];
			const content = await sessionScanner.readSessionRawText(entry.filePath);
			return agentManager.readSessionDisplayMessages(entry.filePath, sessionId, content);
		},
	);
	ipcMain.handle(
		ipcChannels.sessionsCatalogReadMessagePage,
		async (_event, sessionId: string, before?: number, pageSize?: number) => {
			const entry = sessionCatalog.get(sessionId);
			if (!entry?.filePath) return { messages: [], total: 0, nextBefore: null };
			return agentManager.readSessionDisplayMessagePage(entry.filePath, sessionId, before, pageSize);
		},
	);
	ipcMain.handle(
		ipcChannels.sessionsCatalogReadReferenceMessages,
		(_event, sessionId: string) => readCatalogSessionReferenceMessages(sessionId),
	);
	ipcMain.handle(
		ipcChannels.sessionsCatalogCopy,
		(_event, sessionId: string) => copyCatalogSession(sessionId),
	);
	ipcMain.handle(
		ipcChannels.sessionsCatalogExportHtml,
		(_event, sessionId: string) => exportCatalogSessionHtml(sessionId),
	);
	ipcMain.handle(
		ipcChannels.sessionsSendPrompt,
		async (_event, input: SendSessionPromptInput) => {
			void appLogger.info("session", "Session prompt IPC received", {
				sessionId: input.sessionId,
				requestId: input.requestId,
				messageLength: input.message.length,
				imageCount: input.images?.length ?? 0,
			});
			try {
				const result = await sessionRuntimeCoordinator.send(input);
				if (result.agentId) {
					const tab = agentManager.list().find((candidate) => candidate.id === result.agentId);
					if (tab) emitSessionRuntimeEvent(tab.id, ipcChannels.agentsState, tab);
				}
				void appLogger.info("session", "Session prompt IPC completed", {
					sessionId: input.sessionId,
					requestId: input.requestId,
					agentId: result.agentId,
					accepted: result.accepted,
					delivery: "delivery" in result ? result.delivery : undefined,
				});
				return result;
			} catch (error) {
				void appLogger.warn("session", "Session prompt IPC failed", {
					sessionId: input.sessionId,
					requestId: input.requestId,
					error: error instanceof Error ? error.message : String(error),
				});
				throw error;
			}
		},
	);
	ipcMain.handle(
		ipcChannels.sessionsUiResponse,
		(_event, input: SessionUiResponseInput) => sessionRuntimeCoordinator.respondToUi(input),
	);
	ipcMain.handle(
		ipcChannels.sessionsRuntimeList,
		() => sessionRuntimeCoordinator.listRuntimes(),
	);
	ipcMain.handle(
		ipcChannels.sessionsRuntimeStop,
		(_event, target: SessionRuntimeTarget) => stopSessionRuntime(target),
	);
	ipcMain.handle(
		ipcChannels.sessionsRuntimeAbort,
		(_event, target: SessionRuntimeTarget) => sessionRuntimeCoordinator.abortRuntime(target),
	);
	ipcMain.handle(
		ipcChannels.sessionsRuntimeRestart,
		async (_event, target: SessionRuntimeTarget) => {
			terminalManager.closeAgent(target.agentId);
			const result = await sessionRuntimeCoordinator.restartRuntime(target);
			if (result.ok) {
				// A --no-session restart is a binding replacement, not a close. Its
				// higher generation state event clears old runtime UI without deleting
				// the transient SessionRecord from the renderer.
				if (!result.value.session.noSession) emitSessionRuntimeDetach(target);
				emitReplacementState(result.value.runtime, false);
			}
			return result;
		},
	);
	ipcMain.handle(
		ipcChannels.sessionsRuntimeCompact,
		(_event, target: SessionRuntimeTarget, prompt?: string) =>
			sessionRuntimeCoordinator.compactRuntime(target, prompt),
	);
	ipcMain.handle(
		ipcChannels.sessionsRuntimeState,
		(_event, target: SessionRuntimeTarget) =>
			sessionRuntimeCoordinator.getRuntimeState(target),
	);
	ipcMain.handle(
		ipcChannels.sessionsRuntimeCommands,
		(_event, target: SessionRuntimeTarget) =>
			sessionRuntimeCoordinator.listRuntimeCommands(target),
	);
	ipcMain.handle(
		ipcChannels.sessionsRuntimeExportHtml,
		(_event, target: SessionRuntimeTarget) =>
			sessionRuntimeCoordinator.exportRuntimeHtml(target),
	);
	ipcMain.handle(
		ipcChannels.sessionsRuntimeEditMessage,
		(_event, target: SessionRuntimeTarget, messageId: string, newText: string) =>
			sessionRuntimeCoordinator.editRuntimeMessage(target, messageId, newText),
	);
	ipcMain.handle(
		ipcChannels.sessionsRuntimeDeleteMessage,
		(_event, target: SessionRuntimeTarget, messageId: string) =>
			sessionRuntimeCoordinator.deleteRuntimeMessage(target, messageId),
	);
	ipcMain.handle(
		ipcChannels.sessionsRuntimePrepareResend,
		(_event, target: SessionRuntimeTarget, messageId: string) =>
			sessionRuntimeCoordinator.prepareRuntimeResend(target, messageId),
	);
	ipcMain.handle(
		ipcChannels.sessionsRuntimeSetModel,
		(
			_event,
			target: SessionRuntimeTarget,
			provider: string,
			modelId: string,
		) => sessionRuntimeCoordinator.setRuntimeModel(target, provider, modelId),
	);
	ipcMain.handle(
		ipcChannels.sessionsRuntimeSetThinking,
		(_event, target: SessionRuntimeTarget, level: string) =>
				sessionRuntimeCoordinator.setRuntimeThinking(target, level),
	);
	ipcMain.handle(
		ipcChannels.sessionsRuntimeClone,
		async (_event, target: SessionRuntimeTarget) => {
			const validated = sessionRuntimeCoordinator.validateTarget(target);
			if (!validated.ok) return validated;
			try {
				return {
					ok: true as const,
					value: await replaceAgentSession(
						target.agentId,
						() => agentManager.cloneSession(target.agentId),
					),
				};
			} catch (error) {
				return {
					ok: false as const,
					error: {
						code: "SESSION_COMMAND_FAILED" as const,
						debugDetails: error instanceof Error ? error.message : String(error),
					},
				};
			}
		},
	);
	// fork 与 clone 共用 replaceAgentSession：RPC 成功后刷新 sessionPath / 消息投影
	ipcMain.handle(
		ipcChannels.sessionsRuntimeGetForkMessages,
		(_event, target: SessionRuntimeTarget) =>
			sessionRuntimeCoordinator.getRuntimeForkMessages(target),
	);
	ipcMain.handle(
		ipcChannels.sessionsRuntimeFork,
		async (_event, target: SessionRuntimeTarget, entryId: string) => {
			const validated = sessionRuntimeCoordinator.validateTarget(target);
			if (!validated.ok) return validated;
			try {
				return {
					ok: true as const,
					value: await replaceAgentSession(
						target.agentId,
						() => agentManager.forkSession(target.agentId, entryId),
					),
				};
			} catch (error) {
				return {
					ok: false as const,
					error: {
						code: "SESSION_COMMAND_FAILED" as const,
						debugDetails: error instanceof Error ? error.message : String(error),
					},
				};
			}
		},
	);
	ipcMain.handle(
		ipcChannels.codexSessionsScan,
		async (_event, projectId: string) => {
			const project = projectStore.get(projectId);
			if (!project) throw new Error(`Project not found: ${projectId}`);
			return codexSessionImporter.scan(project.path);
		},
	);
	ipcMain.handle(
		ipcChannels.codexSessionsImport,
		async (_event, projectId: string, sourcePaths: string[]) => {
			const project = projectStore.get(projectId);
			if (!project) throw new Error(`Project not found: ${projectId}`);
			return codexSessionImporter.import(project.path, sourcePaths);
		},
	);
	ipcMain.handle(
		ipcChannels.claudeSessionsScan,
		async (_event, projectId: string) => {
			const project = projectStore.get(projectId);
			if (!project) throw new Error(`Project not found: ${projectId}`);
			return claudeSessionImporter.scan(project.path);
		},
	);
	ipcMain.handle(
		ipcChannels.claudeSessionsImport,
		async (_event, projectId: string, sourcePaths: string[]) => {
			const project = projectStore.get(projectId);
			if (!project) throw new Error(`Project not found: ${projectId}`);
			return claudeSessionImporter.import(project.path, sourcePaths);
		},
	);
	ipcMain.handle(
		ipcChannels.openCodeSessionsScan,
		async (_event, projectId: string) => {
			const project = projectStore.get(projectId);
			if (!project) throw new Error(`Project not found: ${projectId}`);
			return openCodeSessionImporter.scan(project.path);
		},
	);
	ipcMain.handle(
		ipcChannels.openCodeSessionsImport,
		async (_event, projectId: string, sourcePaths: string[]) => {
			const project = projectStore.get(projectId);
			if (!project) throw new Error(`Project not found: ${projectId}`);
			return openCodeSessionImporter.import(project.path, sourcePaths);
		},
	);
}
