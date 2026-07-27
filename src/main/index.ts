import {
	app,
	BrowserWindow,
	dialog,
	ipcMain,
	Menu,
	nativeImage,
	nativeTheme,
	net,
	session,
	shell,
	Tray,
} from "electron";
import { randomUUID } from "node:crypto";
import { basename, join } from "node:path";
import { createWriteStream, existsSync } from "node:fs";
import { copyFile, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { is } from "@electron-toolkit/utils";
import { PetSystem, type PetSystemDeps } from "./pet";
import {
	applyLinuxDisplayBackendWorkaround,
	isUsingLinuxXWaylandWorkaround,
} from "./linuxDisplayBackend";
// 使用 ?asset 后缀导入图标，electron-vite 会在构建时将其复制到输出目录并提供正确的运行时路径
// 这解决了打包后 build/ 目录不在 asar 中导致托盘图标丢失的问题
import iconPath from "../../build/icon.png?asset";

applyLinuxDisplayBackendWorkaround();

// 开发模式下 stdout 管道可能断开导致 EPIPE 崩溃，全局静默处理
process.stdout.on("error", (err: NodeJS.ErrnoException) => {
	if (err.code === "EPIPE") return;
	throw err;
});
process.stderr.on("error", (err: NodeJS.ErrnoException) => {
	if (err.code === "EPIPE") return;
	throw err;
});

process.on("uncaughtException", (error) => {
	void appLogger?.error("process", "Uncaught exception", error);
	console.error("Uncaught exception:", error);
});
process.on("unhandledRejection", (reason) => {
	void appLogger?.error("process", "Unhandled rejection", reason);
	console.error("Unhandled rejection:", reason);
});
import { ipcChannels } from "../shared/ipc";
import {
	mainProcessT,
	normalizeMainProcessLocale,
	type MainProcessLocale,
	type MainProcessTranslationKey,
} from "../shared/i18n/mainProcessCopy";
import {
	buildSessionOriginKey,
	canonicalizeSessionPath,
} from "../shared/sessionIdentity";
import type {
	AgentTab,
	AgentUiRequest,
	AppSettings,
	AppUpdateAsset,
	AppUpdateDownloadProgress,
	AppLogLevel,
	AppLogQuery,
	AppUpdateDownloadResult,
	ExternalEditor,
	ExternalEditorId,
	ExternalEditorSetting,
	AppUpdateInfo,
	CreateSessionDraftInput,
	UpdateSessionRecordInput,
	FeishuBotConfig,
	FeishuBridgeStatus,
	FeishuConnectInput,
	FeishuTestResult,
	SendPromptInput,
	SendPromptResult,
	SendSessionPromptInput,
	SessionRecord,
	SessionCommandError,
	SessionRuntimeEvent,
	SessionRuntimeTarget,
	SessionUiResponseInput,
	CreatePiPromptTemplateInput,
	CreatePiSkillInput,
	PiPromptTemplateSummary,
	PromptStoreSearchResult,
	PromptStoreSearchResponse,
	PromptStoreRawItem,
	PromptStoreItem,
	YaoPromptListResult,
	YaoPromptDetailResult,
} from "../shared/types";
import { ProjectStore } from "./projects/ProjectStore";
import { FileSystemService } from "./fs/FileSystemService";
import { AgentManager } from "./pi/AgentManager";
import { PiLocator } from "./pi/PiLocator";
import { testPiProxy } from "./pi/PiProxyTester";
import { SessionScanner } from "./sessions/SessionScanner";
import {
	SessionCatalog,
	canAttachRuntimeMetadata,
} from "./sessions/SessionCatalog";
import {
	SessionRuntimeCoordinator,
	type SessionRuntimeBinding,
} from "./sessions/SessionRuntimeCoordinator";
import { SessionCommandIpcError } from "./sessions/SessionCommandIpcError";
import { CodexSessionImporter } from "./sessions/CodexSessionImporter";
import { ClaudeSessionImporter } from "./sessions/ClaudeSessionImporter";
import { OpenCodeSessionImporter } from "./sessions/OpenCodeSessionImporter";
import { SettingsStore } from "./settings/SettingsStore";
import { applyDesktopProxy } from "./settings/DesktopProxy";
import { GitService } from "./git/GitService";
import { WorktreeService } from "./git/WorktreeService";
import { ConfigManager } from "./config/ConfigManager";
import { TerminalSessionManager } from "./terminal/TerminalSessionManager";
import { TelemetryService } from "./telemetry/TelemetryService";
import { PromptManager } from "./prompts/PromptManager";
import { XuePromptManager } from "./prompts/XuePromptManager";
import { SkillManager } from "./skills/SkillManager";
import { ExtensionManager } from "./extensions/ExtensionManager";
import { ProjectResourceManager } from "./projects/ProjectResourceManager";
import { registerProjectResourceIpc } from "./ipc/projectResourceIpc";
import { registerGitIpc } from "./ipc/gitIpc";
import { registerTerminalIpc } from "./ipc/terminalIpc";
import { WebServiceManager } from "./web/WebServiceManager";
import { preparePreloadPath } from "./preloadPath";
import { AppLogger } from "./logging/AppLogger";
import { RpcLogger } from "./logging/RpcLogger";
import {
	detectExternalEditors,
	listConfiguredExternalEditors,
	mergeDetectedExternalEditors,
	openProjectInEditor,
	validateExternalEditorCommand,
} from "./editors/EditorDetector";
import {
	FeishuBridge,
	type SessionRuntimeBindingGateway,
} from "./feishu/FeishuBridge";
import {
	feishuT,
	normalizeFeishuLocale,
	type FeishuLocale,
} from "./feishu/FeishuI18n";
import { wantsFeishuDoc } from "./feishu/docActions";
import { resolveFeishuFileSendIntent } from "./feishu/fileIntent";
import {
	listBots,
	getBot,
	addBot as addFeishuBot,
	removeBot as removeFeishuBot,
	updateBot as updateFeishuBot,
	getDecryptedBotAppSecret,
	getSessionBotId,
	setSessionBotId,
	setFeishuConfigDefaultBotName,
} from "./feishu/FeishuConfig";
import type { FeishuChatBinding } from "../shared/types";

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
/** 标记是否由用户主动退出（托盘菜单「退出」），区别于窗口关闭隐藏到托盘 */
let isQuitting = false;
let projectStore: ProjectStore;
let fileSystemService: FileSystemService;
let sessionScanner: SessionScanner;
let sessionCatalog: SessionCatalog;
let sessionRuntimeCoordinator: SessionRuntimeCoordinator;
let codexSessionImporter: CodexSessionImporter;
let claudeSessionImporter: ClaudeSessionImporter;
let openCodeSessionImporter: OpenCodeSessionImporter;
let settingsStore: SettingsStore;
let worktreeService: WorktreeService;
let gitService: GitService;
let piLocator: PiLocator;
let agentManager: AgentManager;
let configManager: ConfigManager;
let promptManager: PromptManager;
let xuePromptManager: XuePromptManager;
let skillManager: SkillManager;
let extensionManager: ExtensionManager;
let projectResourceManager: ProjectResourceManager;
let webServiceManager: WebServiceManager;
let terminalManager: TerminalSessionManager;
let petSystem: PetSystem | null = null;
let appLogger: AppLogger;
let rpcLogger: RpcLogger;
let feishuBridge: FeishuBridge | null = null;


function sendSessionRuntimeEnvelope(event: SessionRuntimeEvent): void {
	const window = mainWindow;
	if (window && !window.isDestroyed()) {
		window.webContents.send(ipcChannels.sessionsRuntimeEvent, event);
	}
}

function emitSessionRuntimeEvent(
	agentId: string,
	sourceChannel: string,
	payload: unknown,
): boolean {
	const runtimeBinding = sessionRuntimeCoordinator.getRuntimeBinding(agentId);
	if (!runtimeBinding) return false;
	const event: SessionRuntimeEvent = {
		kind: "event",
		sessionId: runtimeBinding.sessionId,
		agentId,
		runtimeGeneration: runtimeBinding.runtimeGeneration,
		sourceChannel,
		payload,
	};
	sessionRuntimeCoordinator.observeRuntimeEvent(event);
	if (payload && typeof payload === "object" && !Array.isArray(payload)) {
		const tab = payload as Partial<AgentTab>;
		if (typeof tab.sessionPath === "string" && tab.sessionPath) {
			const entry = sessionCatalog.get(runtimeBinding.sessionId);
			if (
				canAttachRuntimeMetadata(entry, tab) &&
				(entry?.filePath !== tab.sessionPath || entry.piSessionId !== tab.sessionId)
			) {
				void sessionCatalog.attachRuntime({
					sessionId: runtimeBinding.sessionId,
					filePath: tab.sessionPath,
					piSessionId: tab.sessionId,
				}).catch(() => undefined);
			}
		}
	}
	sendSessionRuntimeEnvelope(event);
	return true;
}

function emitSessionRuntimeDetach(binding: SessionRuntimeBinding): void {
	sendSessionRuntimeEnvelope({
		kind: "detach",
		sessionId: binding.sessionId,
		agentId: binding.agentId,
		runtimeGeneration: binding.runtimeGeneration,
		sourceChannel: "sessions:runtime-detach",
		payload: null,
	});
}

function emitReplacementState(binding: SessionRuntimeBinding, includeMessages: boolean): void {
	const tab = agentManager.list().find((candidate) => candidate.id === binding.agentId);
	if (!tab) return;
	emitSessionRuntimeEvent(binding.agentId, ipcChannels.agentsState, tab);
	if (includeMessages) {
		emitSessionRuntimeEvent(binding.agentId, ipcChannels.agentsMessage, {
			agentId: binding.agentId,
			messages: agentManager.getMessages(binding.agentId),
		});
	}
}

async function readCatalogSessionReferenceMessages(sessionId: string) {
	const entry = sessionCatalog.get(sessionId);
	if (!entry?.filePath) return [];
	return sessionScanner.readMessages(entry.filePath);
}

async function copyCatalogSession(sessionId: string) {
	const entry = sessionCatalog.get(sessionId);
	if (!entry?.filePath) throw new Error(mainCopy("session.fileNotFound"));
	const result = await agentManager.cloneSessionFile(entry.projectId, entry.filePath) as {
		cancelled?: boolean;
		sessionPath?: string;
	};
	if (result.cancelled || !result.sessionPath) return { cancelled: true };
	const copied = await sessionCatalog.ensureRuntimeTarget({
		projectId: entry.projectId,
		title: entry.title,
		source: entry.source,
		environment: entry.environment,
		filePath: result.sessionPath,
		wslDistro: entry.wslDistro,
		wslUser: entry.wslUser,
		importedSourceId: entry.importedSourceId,
	});
	return { cancelled: false, targetSessionId: copied.id };
}

async function exportCatalogSessionHtml(sessionId: string): Promise<{ path: string }> {
	const entry = sessionCatalog.get(sessionId);
	if (!entry?.filePath) throw new Error(mainCopy("session.fileNotFound"));
	const result = await agentManager.exportSessionHtml(entry.projectId, entry.filePath);
	if (!result || typeof result !== "object" || !("path" in result) || typeof result.path !== "string") {
		throw new Error(mainCopy("session.exportFailed"));
	}
	return { path: result.path };
}

type AgentSessionReplacementResult = {
	cancelled?: boolean;
	[key: string]: unknown;
};

async function replaceAgentSession(
	agentId: string,
	replace: () => Promise<unknown>,
): Promise<AgentSessionReplacementResult & { targetSessionId?: string }> {
	const originBinding = sessionRuntimeCoordinator.getRuntimeBinding(agentId);
	const originEntry = originBinding
		? sessionCatalog.get(originBinding.sessionId)
		: undefined;
	const originKey = originEntry?.filePath
		? buildSessionOriginKey({
			source: originEntry.source,
			environment: originEntry.environment,
			filePath: originEntry.filePath,
			wslDistro: originEntry.wslDistro,
			wslUser: originEntry.wslUser,
			importedSourceId: originEntry.importedSourceId,
		})
		: undefined;
	return sessionRuntimeCoordinator.replaceBoundRuntime({
		agentId,
		replace: async () => {
			const result = await replace();
			return result && typeof result === "object" && !Array.isArray(result)
				? result as AgentSessionReplacementResult
				: {};
		},
		resolveTargetSessionId: async () => {
			const tab = agentManager.list().find((candidate) => candidate.id === agentId);
			if (!tab?.sessionPath) {
				throw new Error(`Replacement runtime has no session path: ${agentId}`);
			}
			const environment = tab.sessionEnvironment ?? originEntry?.environment ?? "native";
			const target = await sessionCatalog.ensureRuntimeTarget({
				projectId: tab.projectId,
				title: tab.title,
				source: tab.sessionSource ?? originEntry?.source ?? "pi",
				environment,
				filePath: tab.sessionPath,
				wslDistro: tab.wslDistro ?? (environment === "wsl" ? originEntry?.wslDistro : undefined),
				wslUser: tab.wslUser ?? (environment === "wsl" ? originEntry?.wslUser : undefined),
				importedSourceId: tab.importedSourceId ?? originEntry?.importedSourceId,
				piSessionId: tab.sessionId,
			});
			return target.id;
		},
		canRestoreOrigin: () => {
			const tab = agentManager.list().find((candidate) => candidate.id === agentId);
			if (!originKey || !tab?.sessionPath) return false;
			return buildSessionOriginKey({
				source: tab.sessionSource ?? "pi",
				environment: tab.sessionEnvironment ?? "native",
				filePath: tab.sessionPath,
				wslDistro: tab.wslDistro,
				wslUser: tab.wslUser,
				importedSourceId: tab.importedSourceId,
			}) === originKey;
		},
		onDetached: emitSessionRuntimeDetach,
		onAttached: (binding) => emitReplacementState(binding, true),
		onRestored: (binding) => emitReplacementState(binding, false),
	});
}

function cancelUnboundUiRequest(payload: unknown): void {
	if (!payload || typeof payload !== "object" || Array.isArray(payload)) return;
	const request = payload as Partial<AgentUiRequest>;
	if (
		typeof request.agentId !== "string" ||
		typeof request.requestId !== "string" ||
		request.completed === true ||
		!(["select", "confirm", "input", "editor"] as const).some(
			(method) => method === request.method,
		)
	) {
		return;
	}
	void appLogger.warn("session", "Cancelled unbound runtime UI request", {
		agentId: request.agentId,
		requestId: request.requestId,
		method: request.method,
	});
	void agentManager.sendUIResponse(request.agentId, request.requestId, { cancelled: true });
}

const feishuSessionRuntimeBindings: SessionRuntimeBindingGateway = {
	async ensureSession(input) {
		if (input.existingSessionId) {
			const existing = sessionCatalog.get(input.existingSessionId);
			if (existing) return { sessionId: existing.id };
		}
		const environment = settingsStore.get().wslEnabled ? "wsl" : "native";
		if (input.sessionPath) {
			const existing = sessionCatalog.findByFilePath(input.sessionPath, environment);
			if (existing) return { sessionId: existing.id };
			const restored = await sessionCatalog.ensureRuntimeTarget({
				projectId: input.projectId,
				title: input.title,
				source: "pi",
				environment,
				filePath: input.sessionPath,
				wslDistro: environment === "wsl" ? settingsStore.get().wslDistro : undefined,
				wslUser: environment === "wsl" ? settingsStore.get().wslUser : undefined,
			});
			return { sessionId: restored.id };
		}
		const draft = await sessionCatalog.createDraft({
			projectId: input.projectId,
			title: input.title,
			environment,
			source: "pi",
		});
		return { sessionId: draft.id };
	},
	async activateRuntime(sessionId) {
		const activated = await sessionRuntimeCoordinator.activateRuntime(sessionId);
		if (!activated.ok) throw sessionCommandIpcError(activated.error);
		const tab = agentManager.list().find((candidate) => candidate.id === activated.value.agentId);
		if (!tab) throw sessionCommandIpcError({
			code: "SESSION_COMMAND_FAILED",
			debugDetails: `Activated runtime not found: ${activated.value.agentId}`,
		});
		tab.runtimeGeneration = activated.value.runtimeGeneration;
		emitSessionRuntimeEvent(tab.id, ipcChannels.agentsState, tab);
		return tab;
	},
	async bindRuntime(input) {
		if (input.agent.status === "error" || input.agent.status === "closed") {
			throw new Error(`Cannot bind terminal Feishu runtime: ${input.agent.id}`);
		}
		const environment = input.agent.sessionEnvironment ?? (
			settingsStore.get().wslEnabled ? "wsl" : "native"
		);
		const source = input.agent.sessionSource ?? "pi";
		let sessionId: string | undefined;
		if (input.existingSessionId) {
			const existing = sessionCatalog.get(input.existingSessionId);
			if (existing) {
				const currentBinding = sessionRuntimeCoordinator.getRuntimeBinding(input.agent.id);
				if (currentBinding && currentBinding.sessionId !== existing.id) {
					throw new Error(`Runtime is already bound to a different Session: ${currentBinding.sessionId}`);
				}
				if (input.agent.sessionPath && !canAttachRuntimeMetadata(existing, input.agent)) {
					throw new Error(`Existing Session origin does not match runtime: ${existing.id}`);
				}
				sessionId = existing.id;
			}
		}
		if (!sessionId && input.agent.sessionPath) {
			const targetOrigin = buildSessionOriginKey({
				source,
				environment,
				filePath: input.agent.sessionPath,
				wslDistro: input.agent.wslDistro,
				wslUser: input.agent.wslUser,
				importedSourceId: input.agent.importedSourceId,
			});
			sessionId = sessionCatalog.listEntries().find((candidate) => (
				candidate.filePath &&
				buildSessionOriginKey({
					source: candidate.source,
					environment: candidate.environment,
					filePath: candidate.filePath,
					wslDistro: candidate.wslDistro,
					wslUser: candidate.wslUser,
					importedSourceId: candidate.importedSourceId,
				}) === targetOrigin
			))?.id;
		}
		if (!sessionId) {
			const draft = await sessionCatalog.createDraft({
				projectId: input.projectId,
				title: input.agent.title || "Feishu session",
				environment,
				source,
			});
			sessionId = draft.id;
		}
		await sessionCatalog.attachRuntime(input.agent.sessionPath ? {
			sessionId,
			filePath: input.agent.sessionPath,
			piSessionId: input.agent.sessionId,
		} : {
			sessionId,
			piSessionId: input.agent.sessionId,
		});
		const runtimeGeneration = sessionRuntimeCoordinator.bindExistingAgent(
			sessionId,
			input.agent.id,
		);
		input.agent.runtimeGeneration = runtimeGeneration;
		emitSessionRuntimeEvent(input.agent.id, ipcChannels.agentsState, input.agent);
		return { sessionId };
	},
	async sendPrompt(input) {
		const result = await sessionRuntimeCoordinator.send({
			...input,
			requestId: randomUUID(),
		});
		if (!result.accepted) throw new Error(result.error);
	},
	async abortRuntime(sessionId) {
		const target = sessionRuntimeCoordinator.getTarget(sessionId);
		if (!target) throw sessionCommandIpcError({ code: "SESSION_RUNTIME_UNAVAILABLE" });
		const result = await sessionRuntimeCoordinator.abortRuntime(target);
		if (!result.ok) throw sessionCommandIpcError(result.error);
	},
	async listRuntimeModels(sessionId) {
		const target = sessionRuntimeCoordinator.getTarget(sessionId);
		if (!target) throw sessionCommandIpcError({ code: "SESSION_RUNTIME_UNAVAILABLE" });
		const result = await sessionRuntimeCoordinator.listRuntimeModels(target);
		if (!result.ok) throw sessionCommandIpcError(result.error);
		return result.value.value;
	},
	async getRuntimeState(sessionId) {
		const target = sessionRuntimeCoordinator.getTarget(sessionId);
		if (!target) return undefined;
		const result = await sessionRuntimeCoordinator.getRuntimeState(target);
		if (!result.ok) throw sessionCommandIpcError(result.error);
		return result.value.value;
	},
	async setRuntimeModel(sessionId, provider, modelId) {
		const target = sessionRuntimeCoordinator.getTarget(sessionId);
		if (!target) throw sessionCommandIpcError({ code: "SESSION_RUNTIME_UNAVAILABLE" });
		const result = await sessionRuntimeCoordinator.setRuntimeModel(target, provider, modelId);
		if (!result.ok) throw sessionCommandIpcError(result.error);
	},
};

function applyNativeThemeSource(settings: AppSettings) {
	// 原生标题栏不受 renderer CSS 影响；跟随应用主题，避免暗色界面顶部仍是系统浅色栏。
	nativeTheme.themeSource = settings.theme === "system" ? "system" : settings.theme;
}

const RELEASES_URL = "https://github.com/ayuayue/pi-desktop/releases";
const LATEST_RELEASE_API =
	"https://api.github.com/repos/ayuayue/pi-desktop/releases/latest";
const POSTHOG_PROJECT_KEY =
	process.env.POSTHOG_PROJECT_KEY ??
	"phc_xgJ8gFUMgExZEEPzZ7VRa7698ENcaDRquWZVGYb2dCFK";
const POSTHOG_HOST = process.env.POSTHOG_HOST ?? "https://us.i.posthog.com";

type GitHubReleaseAsset = {
	name: string;
	browser_download_url: string;
	size: number;
};

type GitHubRelease = {
	tag_name?: string;
	name?: string;
	body?: string;
	html_url?: string;
	published_at?: string;
	assets?: GitHubReleaseAsset[];
};

function normalizeVersion(version: string) {
	return version.trim().replace(/^v/i, "");
}

function compareVersions(left: string, right: string) {
	const leftParts = normalizeVersion(left)
		.split(/[.-]/)
		.map((part) => Number(part) || 0);
	const rightParts = normalizeVersion(right)
		.split(/[.-]/)
		.map((part) => Number(part) || 0);
	const length = Math.max(leftParts.length, rightParts.length);
	for (let index = 0; index < length; index += 1) {
		const diff = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
		if (diff !== 0) return diff;
	}
	return 0;
}

function selectRecommendedAsset(
	assets: AppUpdateAsset[],
	installationType?: "portable" | "installed",
) {
	const platform = process.platform;
	const arch = process.arch;
	// Windows 便携版以 electron-builder 注入的运行时环境变量为准；旧 settings 可能残留 installed。
	const isPortable =
		platform === "win32"
			? process.env.PORTABLE_EXECUTABLE_DIR !== undefined || installationType === "portable"
			: installationType === "portable";

	// 映射资产以便匹配
	const candidates = assets.map((asset) => ({
		...asset,
		lowerName: asset.name.toLowerCase(),
	}));

	// 根据架构确定关键词，严格匹配
	const archKeywords =
		arch === "arm64" ? ["arm64", "aarch64"] : ["x64", "amd64", "x86_64"];
	const matchesArch = (name: string) =>
		archKeywords.some((keyword) => name.includes(keyword));

	// 检查是否为非目标架构（用于排除不匹配的资产）
	const isWrongArch = (name: string) => {
		if (arch === "arm64") {
			// 当前是 ARM64，排除 x64 相关的
			return /\b(x64|amd64|x86_64)\b/i.test(name);
		} else {
			// 当前是 x64，排除 arm64 相关的
			return /\b(arm64|aarch64)\b/i.test(name);
		}
	};

	const isWindowsAsset = (name: string) =>
		/\.(exe|msi)$/i.test(name) || (name.endsWith(".zip") && !/(mac|darwin|osx|linux|appimage|deb|tar\.gz)/i.test(name));
	const isMacAsset = (name: string) => /\.(dmg)$/i.test(name) || /(mac|darwin|osx)/i.test(name);
	const isLinuxAsset = (name: string) => /(appimage|\.deb$|\.tar\.gz$|linux)/i.test(name);

	if (platform === "win32") {
		// Windows 只能在 Windows 资产里挑选；Release 同时包含 macOS zip，不能用全局 zip 回退。
		const platformCandidates = candidates.filter((asset) => isWindowsAsset(asset.lowerName));
		// Windows: 优先匹配当前安装形态（便携版 vs 安装版）和架构
		if (isPortable) {
			// 便携版 exe 是单文件绿色版，无需安装；优先推荐非 Setup 的便携 exe，其次 .zip
			return (
				platformCandidates.find(
					(asset) => !asset.lowerName.includes("setup") && asset.lowerName.endsWith(".exe") && matchesArch(asset.lowerName),
				) ??
				platformCandidates.find(
					(asset) => !asset.lowerName.includes("setup") && asset.lowerName.endsWith(".exe") && !isWrongArch(asset.lowerName),
				) ??
				platformCandidates.find(
					(asset) => asset.lowerName.endsWith(".zip") && matchesArch(asset.lowerName),
				) ??
				platformCandidates.find(
					(asset) => asset.lowerName.endsWith(".zip") && !isWrongArch(asset.lowerName),
				)
			);
		} else {
			// 安装版：优先推荐带 Setup 的安装 exe，其次普通 exe，最后 zip
			return (
				platformCandidates.find(
					(asset) => asset.lowerName.includes("setup") && asset.lowerName.endsWith(".exe") && matchesArch(asset.lowerName),
				) ??
				platformCandidates.find(
					(asset) => asset.lowerName.includes("setup") && asset.lowerName.endsWith(".exe") && !isWrongArch(asset.lowerName),
				) ??
				platformCandidates.find(
					(asset) => asset.lowerName.endsWith(".exe") && matchesArch(asset.lowerName),
				) ??
				platformCandidates.find(
					(asset) => asset.lowerName.endsWith(".exe") && !isWrongArch(asset.lowerName),
				) ??
				platformCandidates.find(
					(asset) => asset.lowerName.endsWith(".zip") && matchesArch(asset.lowerName),
				) ??
				platformCandidates.find(
					(asset) => asset.lowerName.endsWith(".zip") && !isWrongArch(asset.lowerName),
				)
			);
		}
	}

	if (platform === "darwin") {
		// macOS 只在 macOS 资产中选择，避免 x64 zip 回退到 Windows/Linux 包。
		const platformCandidates = candidates.filter((asset) => isMacAsset(asset.lowerName));
		return (
			platformCandidates.find(
				(asset) => asset.lowerName.endsWith(".dmg") && matchesArch(asset.lowerName),
			) ??
			platformCandidates.find(
				(asset) => asset.lowerName.endsWith(".dmg") && !isWrongArch(asset.lowerName),
			) ??
			platformCandidates.find(
				(asset) => asset.lowerName.endsWith(".zip") && matchesArch(asset.lowerName),
			) ??
			platformCandidates.find(
				(asset) => asset.lowerName.endsWith(".zip") && !isWrongArch(asset.lowerName),
			)
		);
	}

	if (platform === "linux") {
		// Linux 只在 Linux 资产中选择，避免跨平台 zip/exe 被误推荐。
		const platformCandidates = candidates.filter((asset) => isLinuxAsset(asset.lowerName));
		return (
			platformCandidates.find(
				(asset) => asset.lowerName.includes("appimage") && matchesArch(asset.lowerName),
			) ??
			platformCandidates.find(
				(asset) =>
					asset.lowerName.includes("appimage") && !isWrongArch(asset.lowerName),
			) ??
			platformCandidates.find(
				(asset) => asset.lowerName.endsWith(".deb") && matchesArch(asset.lowerName),
			) ??
			platformCandidates.find(
				(asset) => asset.lowerName.endsWith(".deb") && !isWrongArch(asset.lowerName),
			) ??
			platformCandidates.find(
				(asset) => asset.lowerName.endsWith(".tar.gz") && matchesArch(asset.lowerName),
			) ??
			platformCandidates.find(
				(asset) => asset.lowerName.endsWith(".tar.gz") && !isWrongArch(asset.lowerName),
			)
		);
	}

	// 回退：返回第一个匹配架构的资产
	return candidates.find((asset) => matchesArch(asset.lowerName)) ?? candidates[0];
}

async function checkForAppUpdate(
	installationType?: "portable" | "installed",
): Promise<AppUpdateInfo> {
	const currentVersion = app.getVersion();
	void appLogger.info("update", "Check for app update", { currentVersion, installationType });
	const response = await fetch(LATEST_RELEASE_API, {
		headers: {
			Accept: "application/vnd.github+json",
			"User-Agent": `pi-desktop/${currentVersion}`,
		},
	});
	if (!response.ok) {
		void appLogger.warn("update", "GitHub release check failed", { status: response.status });
		throw new Error(mainCopy("update.checkFailed"));
	}
	const release = (await response.json()) as GitHubRelease;
	const latestVersion = normalizeVersion(release.tag_name || currentVersion);
	const assets = (release.assets ?? []).map((asset) => ({
		name: asset.name,
		url: asset.browser_download_url,
		size: asset.size,
	}));
	const recommendedAsset = selectRecommendedAsset(assets, installationType);
	void appLogger.info("update", "App update check completed", {
		currentVersion,
		latestVersion,
		hasUpdate: compareVersions(latestVersion, currentVersion) > 0,
		recommendedAsset: recommendedAsset?.name,
	});
	return {
		currentVersion,
		latestVersion,
		hasUpdate: compareVersions(latestVersion, currentVersion) > 0,
		releaseName: release.name || `v${latestVersion}`,
		releaseNotes: release.body || "",
		releaseUrl: release.html_url || RELEASES_URL,
		publishedAt: release.published_at,
		assets,
		recommendedAsset,
	};
}

function emitUpdateProgress(progress: AppUpdateDownloadProgress) {
	if (!mainWindow || mainWindow.isDestroyed()) return;
	mainWindow.webContents.send(ipcChannels.appUpdateProgress, progress);
}

async function downloadUpdateAsset(asset: AppUpdateAsset): Promise<AppUpdateDownloadResult> {
	if (!asset.url || !/^https:\/\//i.test(asset.url)) {
		void appLogger.warn("update", "Rejected invalid update download URL", {
			assetName: asset.name,
			url: asset.url,
		});
		throw new Error(mainCopy("update.invalidDownloadUrl"));
	}

	const safeName = basename(asset.name).replace(/[<>:"/\\|?*]+/g, "-");
	const downloadDir = join(app.getPath("userData"), "updates");
	await mkdir(downloadDir, { recursive: true });
	const filePath = join(downloadDir, safeName);
	const startedAt = Date.now();
	let receivedBytes = 0;
	let totalBytes = asset.size > 0 ? asset.size : undefined;

	// 使用 Electron net 下载可继承 Chromium 的 TLS/代理能力；进度通过 IPC 推送给 renderer。
	return new Promise((resolve, reject) => {
			void appLogger.info("update", "Download update asset started", { assetName: asset.name, url: asset.url });
		const request = net.request({ method: "GET", url: asset.url });
		request.setHeader("User-Agent", `pi-desktop/${app.getVersion()}`);
		request.on("redirect", (_statusCode, _method, redirectUrl) => {
			// GitHub browser_download_url 通常会 302 到对象存储,必须显式跟随重定向。
			request.followRedirect();
			void appLogger.debug("update", "Follow update download redirect", { redirectUrl });
		});
		request.on("response", (response) => {
			if (response.statusCode < 200 || response.statusCode >= 300) {
				const publicError = new Error(mainCopy("update.downloadFailed"));
				void appLogger.warn("update", "Update download returned an error status", {
					assetName: asset.name,
					statusCode: response.statusCode,
				});
				emitUpdateProgress({ assetName: asset.name, receivedBytes, totalBytes, state: "failed", error: publicError.message });
				reject(publicError);
				return;
			}

			const contentLength = Number(response.headers["content-length"]);
			if (Number.isFinite(contentLength) && contentLength > 0) totalBytes = contentLength;
			const output = createWriteStream(filePath);
			response.on("data", (chunk: Buffer) => {
				receivedBytes += chunk.length;
				output.write(chunk);
				const elapsedSeconds = Math.max(0.001, (Date.now() - startedAt) / 1000);
				emitUpdateProgress({
					assetName: asset.name,
					receivedBytes,
					totalBytes,
					percent: totalBytes ? Math.min(100, (receivedBytes / totalBytes) * 100) : undefined,
					bytesPerSecond: receivedBytes / elapsedSeconds,
					state: "downloading",
				});
			});
			response.on("end", () => output.end());
			output.on("finish", () => {
				output.close(() => {
					emitUpdateProgress({ assetName: asset.name, receivedBytes, totalBytes, percent: 100, state: "completed", filePath });
					void appLogger.info("update", "Download update asset completed", { assetName: asset.name, filePath, receivedBytes });
					resolve({ filePath, assetName: asset.name });
				});
			});
			output.on("error", (error) => {
				void appLogger.warn("update", "Failed to write update package", {
					assetName: asset.name,
					error: error.message,
				});
				const publicError = new Error(mainCopy("update.downloadFailed"));
				emitUpdateProgress({ assetName: asset.name, receivedBytes, totalBytes, state: "failed", error: publicError.message });
				reject(publicError);
			});
		});
		request.on("error", (error) => {
			void appLogger.warn("update", "Update download request failed", {
				assetName: asset.name,
				error: error.message,
			});
			const publicError = new Error(mainCopy("update.downloadFailed"));
			emitUpdateProgress({ assetName: asset.name, receivedBytes, totalBytes, state: "failed", error: publicError.message });
			reject(publicError);
		});
		request.end();
	});
}

async function installDownloadedUpdate(filePath: string) {
	// Windows/Linux 不同包类型的真正静默自更新风险较高；这里交给系统打开安装包或文件位置。
	// 便携版用户通常下载 zip/AppImage/tar.gz 后需要替换当前目录,避免在运行中覆盖自身可执行文件。
	await appLogger.info("update", "Open downloaded update package", { filePath });
	const openError = await shell.openPath(filePath);
	if (openError) {
		await appLogger.warn("update", "Failed to open downloaded update package", {
			filePath,
			error: openError,
		});
		throw new Error(mainCopy("update.openFailed"));
	}
}

function refreshTrayContextMenu(): void {
	if (!tray) return;
	tray.setContextMenu(Menu.buildFromTemplate([
		{
			label: mainCopy("tray.showWindow"),
			click: () => {
				if (mainWindow && !mainWindow.isDestroyed()) {
					mainWindow.show();
					mainWindow.focus();
				}
			},
		},
		{ type: "separator" },
		{
			label: mainCopy("tray.quit"),
			click: () => {
				isQuitting = true;
				app.quit();
			},
		},
	]));
}

function setupTray() {
	// iconPath 由 electron-vite 的 ?asset 后缀自动解析，打包后也能正确定位
	const icon = nativeImage.createFromPath(iconPath);
	tray = new Tray(icon.resize({ width: 16, height: 16 }));
	tray.setToolTip("PiDeck");

	// 双击托盘图标恢复窗口（Windows 常见交互）
	tray.on("double-click", () => {
		if (mainWindow && !mainWindow.isDestroyed()) {
			mainWindow.show();
			mainWindow.focus();
		}
	});

	refreshTrayContextMenu();
}

async function openExternalUrl(url: string, forceSystem = false) {
	if (!url.startsWith("http:") && !url.startsWith("https:")) return;
	// 更新页的发行说明和安装包必须离开内置浏览器，避免下载被 webview 的导航策略拦截。
	if (forceSystem) {
		await shell.openExternal(url);
		return;
	}
	const settings = settingsStore.get();
	if (settings.linkOpenMode === "internal") {
		openInternalLinkInBrowserPanel(url);
		return;
	}
	await shell.openExternal(url);
}

function openInternalLinkInBrowserPanel(url: string) {
	// 内部打开：将 URL 发送到渲染进程，由 BrowserPanel 在侧栏/弹框中加载，
	// 替代之前的独立 BrowserWindow 方案，保持一致的浏览体验。
	if (!mainWindow || mainWindow.isDestroyed()) {
		void shell.openExternal(url);
		return;
	}
	mainWindow.webContents.send(ipcChannels.appOpenInBrowser, url);
}

function printStartupInfo() {
	if (!mainWindow || mainWindow.isDestroyed()) return;

	const settings = settingsStore.get();
	const appVersion = app.getVersion();
	const electronVersion = process.versions.electron;
	const chromeVersion = process.versions.chrome;
	const nodeVersion = process.versions.node;
	const platform = process.platform;
	const arch = process.arch;
	const persistentInstallationType = settings.installationType || "unknown";
	const isPortableEnv = process.env.PORTABLE_EXECUTABLE_DIR !== undefined;
	// Debug 中展示实际生效类型,便于发现持久化值和运行时便携信号不一致的问题。
	const effectiveInstallationType =
		process.platform === "win32" && isPortableEnv ? "portable" : persistentInstallationType;

	// 执行 console.log 输出到开发者工具
	mainWindow.webContents.executeJavaScript(`
		console.log(
			"%c╭──────────────────────────────────────────────────────────╮",
			"color: #8b5cf6; font-weight: bold;"
		);
		console.log(
			"%c│                      PiDeck Desktop                      │",
			"color: #8b5cf6; font-weight: bold; font-size: 16px;"
		);
		console.log(
			"%c╰──────────────────────────────────────────────────────────╯",
			"color: #8b5cf6; font-weight: bold;"
		);
		console.log("");
		console.log("%c📦 Application Info", "color: #3b82f6; font-weight: bold; font-size: 14px;");
		console.log("%c  Version:         %c${appVersion}", "color: #6b7280;", "color: #10b981; font-weight: bold;");
		console.log("%c  Installation:    %c${effectiveInstallationType}", "color: #6b7280;", "color: #f59e0b; font-weight: bold;");
		console.log("%c  Platform:        %c${platform} (${arch})", "color: #6b7280;", "color: #8b5cf6;");
		console.log("");
		console.log("%c⚡ Runtime Info", "color: #3b82f6; font-weight: bold; font-size: 14px;");
		console.log("%c  Electron:        %c${electronVersion}", "color: #6b7280;", "color: #06b6d4;");
		console.log("%c  Chrome:          %c${chromeVersion}", "color: #6b7280;", "color: #06b6d4;");
		console.log("%c  Node:            %c${nodeVersion}", "color: #6b7280;", "color: #06b6d4;");
		console.log("");
		console.log("%c🔧 Debug Info", "color: #3b82f6; font-weight: bold; font-size: 14px;");
		console.log("%c  PORTABLE_EXECUTABLE_DIR: %c${isPortableEnv ? '✅ Set' : '❌ Not set'}", "color: #6b7280;", "color: ${isPortableEnv ? '#10b981' : '#ef4444'};");
		console.log("%c  Persistent installationType: %c${persistentInstallationType}", "color: #6b7280;", "color: #8b5cf6; font-weight: bold;");
		console.log("");
		console.log("%c🐛 Found a bug? Report at:", "color: #6b7280;");
		console.log("%c  https://github.com/ayuayue/PiDeck/issues", "color: #3b82f6; text-decoration: underline;");
		console.log("");
		console.log("%c🎉 Easter egg: You found it! Thanks for exploring.", "color: #ec4899; font-weight: bold;");
		console.log("");
	`);
}

async function prepareMainPreloadPath() {
	const sourcePath = join(__dirname, "../preload/index.js");
	return preparePreloadPath(sourcePath, "main-preload.js");
}

const BROWSER_PANEL_PARTITION = "persist:pideck-browser-panel";

function isAllowedBrowserPanelUrl(targetUrl: string): boolean {
	if (targetUrl === "about:blank") return true;
	try {
		const protocol = new URL(targetUrl).protocol;
		return protocol === "http:" || protocol === "https:";
	} catch {
		return false;
	}
}

function configureBrowserPanelWebviewHost(window: BrowserWindow): void {
	const browserPanelSession = session.fromPartition(BROWSER_PANEL_PARTITION);
	browserPanelSession.setPermissionCheckHandler(() => false);
	browserPanelSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
	browserPanelSession.setDevicePermissionHandler(() => false);
	browserPanelSession.webRequest.onBeforeRequest((details, callback) => {
		const isFrameNavigation = details.resourceType === "mainFrame" || details.resourceType === "subFrame";
		if (isFrameNavigation && !isAllowedBrowserPanelUrl(details.url)) {
			void appLogger.warn("browser", "Blocked unsafe webview frame request", {
				resourceType: details.resourceType,
				url: details.url,
			});
			callback({ cancel: true });
			return;
		}
		callback({});
	});

	window.webContents.on("will-attach-webview", (event, webPreferences, params) => {
		const sourceUrl = params.src || "about:blank";
		if ((params.partition && params.partition !== BROWSER_PANEL_PARTITION) || !isAllowedBrowserPanelUrl(sourceUrl)) {
			event.preventDefault();
			void appLogger.warn("browser", "Blocked unsafe webview attachment", {
				sourceUrl,
				partition: params.partition,
			});
			return;
		}

		params.src = sourceUrl;
		params.partition = BROWSER_PANEL_PARTITION;
		delete params.preload;
		delete params.preloadURL;
		delete params.allowfileaccess;
		delete params.allowpopups;

		webPreferences.partition = BROWSER_PANEL_PARTITION;
		webPreferences.sandbox = true;
		webPreferences.nodeIntegration = false;
		webPreferences.nodeIntegrationInWorker = false;
		webPreferences.nodeIntegrationInSubFrames = false;
		webPreferences.contextIsolation = true;
		webPreferences.webSecurity = true;
		webPreferences.allowRunningInsecureContent = false;
		webPreferences.webviewTag = false;
		delete webPreferences.preload;
		delete (webPreferences as Record<string, unknown>).preloadURL;
	});

	window.webContents.on("did-attach-webview", (_event, guest) => {
		if (guest.session !== browserPanelSession) {
			void appLogger.warn("browser", "Closed webview with unexpected session");
			guest.close();
			return;
		}

		const blockUnsafeNavigation = (event: { url: string; preventDefault(): void }, phase: string) => {
			if (isAllowedBrowserPanelUrl(event.url)) return;
			event.preventDefault();
			void appLogger.warn("browser", "Blocked unsafe webview navigation", {
				phase,
				url: event.url,
			});
		};

		guest.on("will-frame-navigate", (event) => blockUnsafeNavigation(event, "navigate"));
		guest.on("will-redirect", (event) => blockUnsafeNavigation(event, "redirect"));
		guest.setWindowOpenHandler(({ url }) => {
			if (url !== "about:blank" && isAllowedBrowserPanelUrl(url)) {
				void openExternalUrl(url);
			} else if (!isAllowedBrowserPanelUrl(url)) {
				void appLogger.warn("browser", "Blocked unsafe webview window open", { url });
			}
			return { action: "deny" };
		});
	});
}

async function createWindow() {
	applyNativeThemeSource(settingsStore.get());
	const windowOptions = settingsStore.createWindowOptions();
	const showMainWindowImmediately = shouldShowMainWindowImmediately();
	const sourcePreloadPath = join(__dirname, "../preload/index.js");
	const mainPreloadPath = await prepareMainPreloadPath();
	void appLogger.info("app", "Main window preload configured", {
		sourcePreloadPath,
		preloadPath: mainPreloadPath,
		sourceExists: existsSync(sourcePreloadPath),
		exists: existsSync(mainPreloadPath),
		appPath: app.getAppPath(),
		userDataPath: app.getPath("userData"),
		packaged: app.isPackaged,
		isDev: is.dev,
		electronRendererUrl: process.env.ELECTRON_RENDERER_URL ? "set" : "unset",
	});

	// 根据用户的主题设置选择窗口背景色，避免系统标题栏与暗色主题间出现浅色条带。
	const theme = settingsStore.get().theme;
	const lightBg = settingsStore.get().lightBackground;
	const isDark =
		theme === "dark" ||
		(theme === "system" && nativeTheme.shouldUseDarkColors);
	const lightBgColors: Record<string, string> = {
		white: "#ffffff",
		warm: "#f3f4f1",
		paper: "#f7f6f1",
		blue: "#f4f8ff",
		green: "#f4fbf6",
	};
	const backgroundColor = isDark
		? "#111315"
		: (lightBgColors[lightBg] ?? "#f3f4f1");

	mainWindow = new BrowserWindow({
		show: showMainWindowImmediately,
		backgroundColor,
		width: 1480,
		height: 960,
		minWidth: 880,
		minHeight: 640,
		title: "",
		icon: iconPath,
		frame: windowOptions.frame,
		titleBarStyle: windowOptions.titleBarStyle,
		...(windowOptions.trafficLightPosition ? { trafficLightPosition: windowOptions.trafficLightPosition } : {}),
		webPreferences: {
			preload: mainPreloadPath,
			sandbox: false,
			contextIsolation: true,
			nodeIntegration: false,
			webviewTag: true,
		},
	});
	const createdWindow = mainWindow;
	configureBrowserPanelWebviewHost(createdWindow);
	let hasShownMainWindow = false;
	function showMainWindowOnce() {
		if (createdWindow.isDestroyed() || hasShownMainWindow) return;
		hasShownMainWindow = true;
		createdWindow.show();
		createdWindow.focus();
		// 向开发者工具输出启动信息
		printStartupInfo();
	}

	// 窗口保持隐藏时先最大化，再加载页面；避免 ready-to-show 后再最大化造成首帧布局跳变。
	if (!showMainWindowImmediately) {
		mainWindow.maximize();
	}

	// 所有 target="_blank" 或 window.open 的链接统一经同一入口处理，遵守用户设置的打开方式。
	mainWindow.webContents.setWindowOpenHandler(({ url }) => {
		void openExternalUrl(url);
		return { action: "deny" };
	});
	mainWindow.webContents.on("did-start-loading", () => {
		void appLogger.info("app", "Main window load started", {
			url: mainWindow?.webContents.getURL(),
		});
	});
	mainWindow.webContents.on("did-finish-load", () => {
		void appLogger.info("app", "Main window load finished", {
			url: mainWindow?.webContents.getURL(),
		});
		// 恢复用户设置的窗口缩放；在 did-finish-load 后应用，避免早期设置被覆盖。
		mainWindow?.webContents.setZoomFactor(settingsStore.get().zoomFactor);
	});
	mainWindow.webContents.on(
		"did-fail-load",
		(_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
			void appLogger.error("app", "Main window load failed", {
				errorCode,
				errorDescription,
				validatedURL,
				isMainFrame,
			});
		},
	);
	mainWindow.webContents.on("render-process-gone", (_event, details) => {
		const level: AppLogLevel = details.reason === "clean-exit" ? "info" : "error";
		void appLogger.log(level, "app", "Main window renderer process gone", details);
	});
	mainWindow.webContents.on("preload-error", (_event, preloadPath, error) => {
		void appLogger.error("app", "Main window preload failed", {
			preloadPath,
			message: error.message,
			stack: error.stack,
		});
	});
	mainWindow.webContents.on("dom-ready", () => {
		void mainWindow?.webContents
			.executeJavaScript("Boolean(window.piDesktop)", true)
			.then((hasPiDesktop) => {
				void appLogger.info("app", "Main window preload API availability", {
					hasPiDesktop,
					url: mainWindow?.webContents.getURL(),
				});
			})
			.catch((error) => {
				void appLogger.warn("app", "Main window preload API check failed", error);
			});
	});
	mainWindow.webContents.on(
		"console-message",
		(event) => {
			if (!["warning", "error"].includes(event.level)) return;
			void appLogger.warn("app", "Main window renderer console error", {
				level: event.level,
				message: event.message,
				line: event.lineNumber,
				sourceId: event.sourceId,
			});
		},
	);

	mainWindow.once("ready-to-show", showMainWindowOnce);
	mainWindow.webContents.once("did-finish-load", showMainWindowOnce);
	setTimeout(showMainWindowOnce, 3000);
	if (showMainWindowImmediately) {
		showMainWindowOnce();
	}

	// 关闭窗口时根据设置决定：隐藏到托盘还是正常退出
	mainWindow.on("close", (event) => {
		if (!isQuitting && settingsStore.get().closeToTray) {
			event.preventDefault();
			mainWindow?.hide();
		} else if (!isQuitting) {
			// 如果没有启用托盘，关闭窗口时直接退出应用
			isQuitting = true;
			app.quit();
		}
	});

	// 监听浏览器标准快捷键打开开发者工具
	mainWindow.webContents.on("before-input-event", (event, input) => {
		if (!mainWindow || mainWindow.isDestroyed()) return;

		// F12
		if (input.key === "F12" && input.type === "keyDown") {
			event.preventDefault();
			if (mainWindow.webContents.isDevToolsOpened()) {
				mainWindow.webContents.closeDevTools();
			} else {
				mainWindow.webContents.openDevTools({ mode: "detach" });
			}
		}

		// Ctrl+Shift+I (Windows/Linux) 或 Cmd+Option+I (macOS)
		const isMac = process.platform === "darwin";
		const ctrlOrCmd = isMac ? input.meta : input.control;
		const shiftOrOption = input.shift || (isMac && input.alt);

		if (
			ctrlOrCmd &&
			shiftOrOption &&
			input.key.toLowerCase() === "i" &&
			input.type === "keyDown"
		) {
			event.preventDefault();
			if (mainWindow.webContents.isDevToolsOpened()) {
				mainWindow.webContents.closeDevTools();
			} else {
				mainWindow.webContents.openDevTools({ mode: "detach" });
			}
		}

		// Ctrl+Shift+J (Windows/Linux) 或 Cmd+Option+J (macOS) - 直接打开 Console
		if (
			ctrlOrCmd &&
			shiftOrOption &&
			input.key.toLowerCase() === "j" &&
			input.type === "keyDown"
		) {
			event.preventDefault();
			if (mainWindow.webContents.isDevToolsOpened()) {
				mainWindow.webContents.closeDevTools();
			} else {
				mainWindow.webContents.openDevTools({ mode: "detach", activate: true });
			}
		}
	});

	const devRendererUrl = shouldUseDevRendererUrl()
		? process.env.ELECTRON_RENDERER_URL
		: undefined;
	if (devRendererUrl) {
		mainWindow.loadURL(devRendererUrl);
	} else {
		mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
	}
}

function shouldUseDevRendererUrl() {
	return is.dev && !app.isPackaged && Boolean(process.env.ELECTRON_RENDERER_URL);
}

function shouldShowMainWindowImmediately() {
	return isUsingLinuxXWaylandWorkaround();
}

// ===== 飞书桥接 IPC =====

/** 自动连接：启动时检查已保存的 Bot 配置，自动连接 */
async function autoConnectFeishu() {
	const bots = listBots();
	if (bots.length === 0) return;
	const bot = bots.find((b) => b.enabled);
	if (!bot) return;
	// 不再自动连接，由用户手动在配置页点击连接
	// 避免应用重启后静默恢复连接导致用户困惑
	console.log("[飞书] 检测到已保存的 Bot 配置:", bot.name, "(跳过自动连接，需手动连接)");
}

function currentMainProcessLocale(): MainProcessLocale {
	const language = settingsStore.get().language;
	if (language === "pseudo") return "en-US";
	return normalizeMainProcessLocale(language === "system" ? app.getLocale() : language);
}

function mainCopy(
	key: MainProcessTranslationKey,
	params?: Record<string, string | number>,
): string {
	return mainProcessT(currentMainProcessLocale(), key, params);
}

function sessionCommandIpcError(error: SessionCommandError): SessionCommandIpcError {
	if (error.debugDetails) {
		void appLogger?.warn("session-command", "Session command failed", {
			code: error.code,
			debugDetails: error.debugDetails,
		});
	}
	return new SessionCommandIpcError(error, mainCopy);
}

function currentFeishuLocale(): FeishuLocale {
	return normalizeFeishuLocale(currentMainProcessLocale());
}

function registerFeishuIpc() {
	/** Bot 配置变更后主动推送给 renderer，保证多个页面/弹窗中的 Bot 列表实时同步。 */
	function broadcastBotsChanged() {
		if (!mainWindow || mainWindow.isDestroyed()) return;
		mainWindow.webContents.send(ipcChannels.feishuBotsChanged, listBots());
	}

	// 临时连接（不保存 bot 配置），用于添加 Bot 时先验证凭证可用性
	ipcMain.handle(ipcChannels.feishuConnectTemp, async (_event, input: FeishuConnectInput) => {
		const appId = input.appId?.trim() ?? "";
		const appSecret = input.appSecret?.trim() ?? "";
		console.log("[Feishu] 收到临时连接请求", JSON.stringify({ appId: appId ? appId.slice(0, 8) + "..." : "", name: input.name, hasSecret: Boolean(appSecret) }));
		try {
			if (!appId || !appSecret) {
				return { success: false, message: feishuT(currentFeishuLocale(), "bridge.configRequired") };
			}
			if (feishuBridge) {
				feishuBridge.stop();
			}
			// 临时构造 botConfig，不做持久化；明文 secret 只传给当前 bridge，不写入磁盘。
			const botConfig: FeishuBotConfig = {
				id: "temp-" + randomUUID(),
				name: input.name?.trim() || feishuT(currentFeishuLocale(), "bridge.tempBotName"),
				enabled: true,
				appId,
				appSecret,
				defaultUserOpenId: input.defaultUserOpenId,
			};
			feishuBridge = new FeishuBridge(
				botConfig,
				agentManager,
				() => mainWindow,
				() => projectStore.list(),
				feishuSessionRuntimeBindings,
				appSecret,
				currentFeishuLocale(),
			);
			await feishuBridge.start();
			const status = feishuBridge.getStatus();
			console.log("[Feishu] 临时连接成功，状态:", JSON.stringify(status));
			return {
				success: true,
				message: feishuT(currentFeishuLocale(), "connection.success"),
				botInfo: { id: botConfig.id, name: botConfig.name },
			};
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			console.error("[Feishu] 临时连接失败:", message);
			return { success: false, message };
		}
	});

	// 连接飞书（保存 bot）
	ipcMain.handle(ipcChannels.feishuConnect, async (_event, input: FeishuConnectInput) => {
		console.log("[Feishu] 收到连接请求", JSON.stringify({ appId: input.appId?.slice(0, 8) + "...", name: input.name }));
		try {
			if (feishuBridge) {
				console.log("[Feishu] 停止旧 bridge 状态:", JSON.stringify(feishuBridge.getStatus()));
				feishuBridge.stop();
			}

			const botConfig = addFeishuBot({
				name: input.name || feishuT(currentFeishuLocale(), "bridge.defaultBotName"),
				appId: input.appId,
				appSecret: input.appSecret,
				defaultUserOpenId: input.defaultUserOpenId,
			});

			feishuBridge = new FeishuBridge(
				botConfig,
				agentManager,
				() => mainWindow,
				() => projectStore.list(),
				feishuSessionRuntimeBindings,
				undefined,
				currentFeishuLocale(),
			);
			await feishuBridge.start();
			console.log("[Feishu] 连接成功，状态:", JSON.stringify(feishuBridge.getStatus()));
			void appLogger.info("feishu", "Feishu connected", { botId: botConfig.id, name: botConfig.name });
			broadcastBotsChanged();
			return { success: true, message: feishuT(currentFeishuLocale(), "connection.success") };
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			console.error("[Feishu] 连接失败:", message);
			void appLogger.error("feishu", "Feishu connect failed", error);
			return { success: false, message };
		}
	});

	// 断开连接
	ipcMain.handle(ipcChannels.feishuDisconnect, async () => {
		console.log("[Feishu] 收到断开请求");
		if (feishuBridge) {
			console.log("[Feishu] 停止 bridge，此前状态:", JSON.stringify(feishuBridge.getStatus()));
			feishuBridge.stop();
			feishuBridge = null;
			console.log("[Feishu] bridge 已置 null");
		}
		void appLogger.info("feishu", "Feishu disconnected");
		return { success: true };
	});

	// 查询状态
	ipcMain.handle(ipcChannels.feishuStatusRequest, async () => {
		if (feishuBridge) {
			const s = feishuBridge.getStatus();
			console.log("[Feishu] 状态查询:", JSON.stringify(s));
			return s;
		}
		console.log("[Feishu] 状态查询: bridge 为 null，返回 disconnected");
		return { status: "disconnected", activeBindings: 0 } as FeishuBridgeStatus;
	});

	// Bot 列表
	ipcMain.handle(ipcChannels.feishuBotsList, async () => {
		return listBots();
	});

	// 添加 Bot
	ipcMain.handle(ipcChannels.feishuBotAdd, async (_event, input: FeishuConnectInput) => {
		// 同 feishuConnect，但可以添加多个 Bot
		try {
			const botConfig = addFeishuBot({
				name: input.name || feishuT(currentFeishuLocale(), "bridge.defaultBotName"),
				appId: input.appId,
				appSecret: input.appSecret,
				defaultUserOpenId: input.defaultUserOpenId,
			});
			void appLogger.info("feishu", "Feishu bot added", { botId: botConfig.id, name: botConfig.name });
			broadcastBotsChanged();
			return { success: true, bot: { ...botConfig, appSecret: "" } };
		} catch (error) {
			void appLogger.warn("feishu", "Failed to add Feishu bot", {
				error: error instanceof Error ? error.message : String(error),
			});
			return { success: false, error: feishuT(currentFeishuLocale(), "bridge.botAddFailed") };
		}
	});

	// 删除 Bot
	ipcMain.handle(ipcChannels.feishuBotRemove, async (_event, botId: string) => {
		if (feishuBridge) {
			feishuBridge.stop();
			feishuBridge = null;
		}
		const result = removeFeishuBot(botId);
		if (result) {
			broadcastBotsChanged();
		}
		void appLogger.info("feishu", "Feishu bot removed", { botId });
		return result;
	});

	// 更新 Bot 配置
	ipcMain.handle(ipcChannels.feishuBotConfig, async (_event, botId: string, patch: Partial<FeishuBotConfig>) => {
		const updated = updateFeishuBot(botId, patch);
		void appLogger.info("feishu", "Feishu bot config updated", { botId, keys: Object.keys(patch) });
		// 只热更新当前在线 Bot；修改其它 Bot 配置不应污染正在运行的 bridge。
		if (feishuBridge && feishuBridge.getStatus().status === "connected" && feishuBridge.getStatus().botId === botId) {
			feishuBridge.updateBotConfig(patch);
			console.log("[飞书] 配置已热更新:", Object.keys(patch).join(", "));
		}
		if (updated) {
			broadcastBotsChanged();
		}
		return updated ? { ...updated, appSecret: "" } : undefined;
	});

	// 返回解密后的 Secret，仅用于用户主动复制/查看凭证。
	ipcMain.handle(ipcChannels.feishuBotSecret, async (_event, botId: string) => {
		return getDecryptedBotAppSecret(botId);
	});

	// 测试连接
	ipcMain.handle(ipcChannels.feishuTestConnection, async (_event, appId: string, appSecret: string) => {
		// 创建临时 bridge 实例来测试连接
		const testBridge = new FeishuBridge(
			{
				id: "test",
				name: "测试",
				enabled: true,
				appId,
				appSecret: "", // 将在 testConnection 中传入
			},
			agentManager,
			() => mainWindow,
			() => projectStore.list(),
			feishuSessionRuntimeBindings,
			undefined,
			currentFeishuLocale(),
		);
		return testBridge.testConnection(appId, appSecret);
	});

	// 绑定列表
	ipcMain.handle(ipcChannels.feishuBindingsList, async () => {
		if (feishuBridge) {
			return feishuBridge.listBindings();
		}
		return [];
	});

	// 移除绑定
	ipcMain.handle(ipcChannels.feishuBindingRemove, async (_event, chatId: string) => {
		if (feishuBridge) {
			// 先查 binding 拿到 sessionId，移除后清理 session-bot 映射，
			// 使 FeishuLinkIndicator 等 UI 同步更新断开状态。
			const bindings = feishuBridge.listBindings();
			const binding = bindings.find((b) => b.chatId === chatId);
			const result = feishuBridge.removeBinding(chatId);
			if (result && binding) {
				setSessionBotId(binding.sessionId, undefined);
			}
			return result;
		}
		return false;
	});

	// 更新绑定
	ipcMain.handle(ipcChannels.feishuBindingUpdate, async (_event, chatId: string, patch: Partial<FeishuChatBinding>) => {
		if (feishuBridge) {
			return feishuBridge.updateBinding(chatId, patch);
		}
		return undefined;
	});

	// 通过已保存的 Bot ID 连接（自动解密 Secret）
	ipcMain.handle(ipcChannels.feishuConnectByBot, async (_event, botId: string) => {
		try {
			if (feishuBridge) {
				feishuBridge.stop();
			}
			const botConfig = getBot(botId);
			if (!botConfig) {
				return { success: false, message: feishuT(currentFeishuLocale(), "bridge.botMissing") };
			}
			feishuBridge = new FeishuBridge(
				botConfig,
				agentManager,
				() => mainWindow,
				() => projectStore.list(),
				feishuSessionRuntimeBindings,
				undefined,
				currentFeishuLocale(),
			);
			await feishuBridge.start();
			void appLogger.info("feishu", "Feishu connected by saved bot", { botId, name: botConfig.name });
			return { success: true, message: feishuT(currentFeishuLocale(), "connection.success") };
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return { success: false, message };
		}
	});

	// 获取稳定 Session 绑定的飞书 Bot ID，并一次性迁移旧 runtime agentId 键。
	ipcMain.handle(ipcChannels.feishuSessionBotGet, async (_event, sessionId: string) => {
		const current = getSessionBotId(sessionId);
		if (current) return current;
		const target = sessionRuntimeCoordinator.getTarget(sessionId);
		if (!target || target.agentId === sessionId) return null;
		const legacy = getSessionBotId(target.agentId);
		if (!legacy) return null;
		setSessionBotId(sessionId, legacy);
		setSessionBotId(target.agentId, undefined);
		return legacy;
	});

	// 设置稳定 Session 使用的飞书 Bot ID。主进程始终重新解析当前 runtime，避免旧 agentId 操作替换后的会话。
	ipcMain.handle(ipcChannels.feishuSessionBotSet, async (_event, sessionId: string, botId: string | null) => {
		const target = sessionRuntimeCoordinator.getTarget(sessionId);
		if (!botId) {
			setSessionBotId(sessionId, undefined);
			if (target && target.agentId !== sessionId) setSessionBotId(target.agentId, undefined);
			// 取消当前会话的飞书关联：移除绑定但不停止 Agent 进程
			if (feishuBridge && feishuBridge.getStatus().status === "connected") {
				feishuBridge.removeBindingBySessionId(sessionId);
			}
			return { success: true };
		}
		const status = feishuBridge?.getStatus();
		if (!feishuBridge || status?.status !== "connected") {
			return { success: false, message: feishuT(currentFeishuLocale(), "session.bridgeUnavailable") };
		}
		if (status.botId !== botId) {
			return { success: false, message: feishuT(currentFeishuLocale(), "session.botMismatch") };
		}
		if (!target) {
			return { success: false, message: feishuT(currentFeishuLocale(), "session.runtimeUnavailable") };
		}
		const tab = agentManager.list().find((item) => item.id === target.agentId);
		if (!tab) {
			return { success: false, message: feishuT(currentFeishuLocale(), "session.runtimeUnavailable") };
		}
		const chatId = await feishuBridge.ensureSessionMirrorForSession(
			sessionId,
			target.agentId,
			tab.title,
			tab.sessionPath,
		);
		if (!chatId) {
			return { success: false, message: feishuT(currentFeishuLocale(), "session.bindFailed") };
		}
		setSessionBotId(sessionId, botId);
		if (target.agentId !== sessionId) setSessionBotId(target.agentId, undefined);
		return { success: true, chatId };
	});
}

async function sendAgentPromptWithIntegrations(
	input: SendPromptInput,
): Promise<SendPromptResult> {
	const bridge = feishuBridge;
	const bridgeConnected = bridge?.getStatus().status === "connected";
	const hasFeishuBinding = bridgeConnected && bridge.hasSessionBinding(input.agentId);
	const docTitle = bridgeConnected ? wantsFeishuDoc(input.message) : undefined;
	const sessionChatId = bridgeConnected ? bridge.getSessionChatId(input.agentId) : undefined;
	let agentInstruction: string | undefined;
	const buildFeishuActionInstruction = (chatId?: string) => [
		"当前会话已连接飞书聊天。严禁调用 lark-cli、飞书 IM API 或搜索群聊来发送文件；不要询问 chat_id。需要把本地文件发到当前飞书聊天时，最终回答末尾独立一行写 [SEND_FILE:本地文件路径]，PiDeck 会按当前会话绑定自动上传。",
		chatId ? `当前绑定的飞书 chat_id: ${chatId}。这是只读上下文，用于确认当前会话绑定；发送文件仍必须用 [SEND_FILE:本地文件路径]。` : undefined,
	].filter(Boolean).join("\n");

	if (bridgeConnected && hasFeishuBinding) {
		const filePath = resolveFeishuFileSendIntent(input.message, agentManager.getCwd(input.agentId));
		if (filePath) {
			const result = await bridge.sendFileForSession(input.agentId, filePath);
			agentManager.recordHostExchange(input.agentId, input.message, result);
			void appLogger.info("feishu", "File sent through current session binding", {
				agentId: input.agentId,
				filePath,
				success: result.startsWith("✅"),
			});
			return { accepted: true };
		}
	}

	if (bridgeConnected && docTitle && !hasFeishuBinding) {
		const tab = agentManager.list().find((item) => item.id === input.agentId);
		if (tab) {
			await bridge.ensureSessionMirror(tab.id, tab.title, tab.sessionPath).catch((error) => {
				console.error("[Feishu] auto-bind session mirror failed:", error);
			});
			bridge.trackDocRequest(tab.id, docTitle);
			void bridge.forwardUserMessageToFeishu(tab.id, input.message).catch((error) => {
				console.error("[Feishu] forward PiDeck message failed:", error);
			});
			agentInstruction = `${buildFeishuActionInstruction(bridge.getSessionChatId(tab.id))}\n创建飞书文档时，先输出完整正文，最后独立一行写 [CREATE_DOC:文档标题]。`;
		}
	} else if (hasFeishuBinding) {
		agentInstruction = buildFeishuActionInstruction(sessionChatId);
		const tab = agentManager.list().find((item) => item.id === input.agentId);
		if (tab) {
			void bridge.startSessionMirrorRun(tab.id, tab.title, tab.sessionPath).catch((error) => {
				console.error("[Feishu] session mirror card init failed:", error);
			});
			if (input.message.trim()) {
				void bridge.forwardUserMessageToFeishu(tab.id, input.message).catch((error) => {
					console.error("[Feishu] forward PiDeck message failed:", error);
				});
			}
		}
	}
	const result = await agentManager.sendPrompt(
		agentInstruction
			? { ...input, agentMessage: `${agentInstruction}\n\n${input.message}` }
			: input,
	);
	void appLogger.info("agent", "Prompt sent", {
		agentId: input.agentId,
		messageLength: input.message.length,
		imageCount: input.images?.length ?? 0,
		streamingBehavior: input.streamingBehavior,
	});
	return result;
}

function registerIpc() {
	// 获取当前环境过滤后的项目列表（WSL 模式只显示 WSL 项目，Chat 始终显示）
	const getVisibleProjects = () => {
		const settings = settingsStore.get();
		const all = projectStore.list();
		if (settings.wslEnabled) {
			return all.filter((p) => p.kind === "chat" || p.environment === "wsl");
		}
		return all.filter((p) => p.kind === "chat" || !p.environment || p.environment === "windows");
	};

	const scanProjectSessions = async (projectId: string) => {
		const project = projectStore.get(projectId);
		if (!project) throw new Error(mainCopy("project.notFound"));
		let projectPath = project.path;
		const settings = settingsStore.get();
		if (settings.wslEnabled && settings.wslDistro) {
			projectPath = projectPath
				.replace(/^([A-Za-z]):\\/, (_: string, drive: string) => `/mnt/${drive.toLowerCase()}/`)
				.replace(/\\/g, "/");
		}
		return sessionScanner.list(projectPath);
	};

	const catalogIdentityContext = () => {
		const { wslEnabled, wslDistro, wslUser } = settingsStore.get();
		return wslEnabled ? { wslDistro, wslUser } : {};
	};

	ipcMain.handle(ipcChannels.projectsList, () => getVisibleProjects());
	ipcMain.handle(ipcChannels.editorsList, async () => listConfiguredExternalEditors(settingsStore.get()));
	ipcMain.handle(ipcChannels.editorsChooseExecutable, async () => {
		const options = {
			properties: ["openFile"],
			filters: process.platform === "win32"
				? [
						{ name: "Applications", extensions: ["exe", "cmd", "bat"] },
						{ name: "All Files", extensions: ["*"] },
					]
				: [{ name: "All Files", extensions: ["*"] }],
		} satisfies Electron.OpenDialogOptions;
		const result = mainWindow
			? await dialog.showOpenDialog(mainWindow, options)
			: await dialog.showOpenDialog(options);
		return result.canceled ? null : result.filePaths[0] ?? null;
	});
	ipcMain.handle(ipcChannels.editorsRedetect, async () => {
		const detected = await detectExternalEditors();
		const settings = await settingsStore.update({
			externalEditors: mergeDetectedExternalEditors(settingsStore.get().externalEditors, detected),
		});
		void appLogger.info("editor", "External editors redetected", { count: detected.length });
		return settings;
	});
	ipcMain.handle(
		ipcChannels.editorsUpdate,
		async (_event, editorId: ExternalEditorId, patch: Partial<ExternalEditorSetting>) => {
			const current = settingsStore.get().externalEditors;
			const existing = current[editorId];
			if (!existing) throw new Error(`Unsupported editor: ${editorId}`);
			const command = typeof patch.command === "string" ? patch.command.trim() : existing.command;
			if (command) {
				const validation = await validateExternalEditorCommand(command);
				if (!validation.valid) throw new Error(`Editor path does not exist: ${command}`);
			}
			const settings = await settingsStore.update({
				externalEditors: {
					...current,
					[editorId]: {
						...existing,
						...patch,
						command,
						detectedFrom: patch.command !== undefined ? "manual" : (patch.detectedFrom ?? existing.detectedFrom),
						updatedAt: Date.now(),
					},
				},
			});
			void appLogger.info("editor", "External editor settings updated", { editorId, keys: Object.keys(patch) });
			return settings;
		},
	);
	ipcMain.handle(
		ipcChannels.editorsOpenProject,
		async (_event, editor: ExternalEditor, projectPath: string) => {
			// 只接收已检测到的编辑器配置；打开项目不经过 shell 拼接命令,降低路径含空格时失败的概率。
			await openProjectInEditor(editor, projectPath);
			void appLogger.info("editor", "Project opened in external editor", {
				editorId: editor.id,
				editorName: editor.name,
				command: editor.command,
				args: editor.args,
				projectPath,
			});
		},
	);
	ipcMain.handle(ipcChannels.projectsAdd, async () => {
		const settings = settingsStore.get();
		const env = settings.wslEnabled ? "wsl" as const : "windows" as const;
		const project = await projectStore.chooseAndAdd(env);
		void appLogger.info("project", "Project added", { projectId: project?.id, path: project?.path, environment: env });
		return project;
	});
	ipcMain.handle(ipcChannels.projectsRemove, async (_event, id: string) => {
		// 删除前拦截：项目仍有运行中的 Agent（pi 子进程）时禁止删除，避免进程悬挂后台继续占用资源。
		if (agentManager.hasAgentForProject(id)) {
			throw new Error("PROJECT_HAS_RUNNING_AGENT");
		}
		await projectStore.remove(id);
		void appLogger.info("project", "Project removed", { projectId: id });
		return getVisibleProjects();
	});
	ipcMain.handle(
		ipcChannels.projectsReorder,
		async (_event, projectIds: string[]) => {
			const result = await projectStore.reorder(projectIds);
			void appLogger.info("project", "Projects reordered", { count: projectIds.length });
			return getVisibleProjects();
		},
	);
	registerProjectResourceIpc({
		appLogger,
		projectResourceManager,
	});

	// ── Worktree 项目管理 ──

	ipcMain.handle(ipcChannels.projectsListRoot, () => {
		return projectStore.listRoot();
	});

	ipcMain.handle(
		ipcChannels.projectsListWorktreeChildren,
		async (_event, parentId: string) => {
			return projectStore.listWorktreeChildren(parentId);
		},
	);

	ipcMain.handle(
		ipcChannels.projectsToggleWorktreeEnabled,
		async (_event, projectId: string) => {
			const existing = projectStore.get(projectId);
			if (!existing) throw new Error(`Project not found: ${projectId}`);
			// 即将启用时先校验是否 git 仓库；非 git 项目开启工作区模式没有意义，
			// 只会看到空列表并在创建时报错，这里提前给出明确错误让前端提示用户。
			if (!existing.worktreeEnabled) {
				const isRepo = await gitService.isGitRepo(existing.path);
				if (!isRepo) {
					throw new Error("NOT_A_GIT_REPO");
				}
			}
			const project = await projectStore.toggleWorktreeEnabled(projectId);
			if (!project) throw new Error(`Project not found: ${projectId}`);
			// 开启 worktree 模式时，自动注册已有的 git worktree
			if (project.worktreeEnabled) {
				try {
					const entries = await worktreeService.list(project.path);
					for (const wt of entries) {
						// findByPath 返回 null 表示未注册
						if (!projectStore.findByPath(wt.path)) {
							await projectStore.add(wt.path, projectId);
						}
					}
				} catch {
					// worktree 查询失败不阻塞 toggle
				}
			}
			return project;
		},
	);

	// ── 聊天项目目录设置 ──

	ipcMain.handle(ipcChannels.projectsChooseChatPath, async () => {
		// 系统文件选择器，默认定位到当前聊天目录，便于用户就地切换。
		const result = await dialog.showOpenDialog({
			title: mainCopy("dialog.chooseChatHistoryFolder"),
			defaultPath: projectStore.getChatProjectPath(),
			properties: ["openDirectory"],
		});
		if (result.canceled || result.filePaths.length === 0) return null;
		return result.filePaths[0];
	});

	ipcMain.handle(ipcChannels.dialogPickFiles, async (_event, options?: { title?: string }) => {
		const result = await dialog.showOpenDialog({
			// 调用方传入经过 i18n 的标题；缺省时交由系统使用平台默认文案。
			title: options?.title,
			properties: ["openFile", "openDirectory", "multiSelections"],
		});
		return result.canceled ? [] : result.filePaths;
	});

	ipcMain.handle(
		ipcChannels.projectsSetChatPath,
		async (_event, path: string) => {
			if (typeof path !== "string" || path.length === 0) throw new Error("Invalid chat path");
			const project = await projectStore.setChatProjectPath(path);
			// 路径变更后广播项目列表变化，渲染端据此刷新聊天项目的会话。
			mainWindow?.webContents.send(ipcChannels.projectsChanged, getVisibleProjects());
			void appLogger.info("project", "Chat project path updated", { path });
			return project;
		},
	);

	ipcMain.handle(ipcChannels.filesList, async (_event, projectId: string) => {
		const project = projectStore.get(projectId);
		if (!project) throw new Error(`Project not found: ${projectId}`);
		return fileSystemService.listTree(project.path);
	});

	// 将 WSL Linux 路径转为 Windows 可访问的路径（/mnt/c → C:\，/home/... → \\wsl$\<distro>\...）
	const toWindowsPath = (linuxPath: string): string => {
		if (!linuxPath || /^[A-Za-z]:/.test(linuxPath)) return linuxPath; // 已是 Windows 路径
		// /mnt/c/Users/... → C:\Users\...
		const mntMatch = linuxPath.match(/^\/mnt\/([a-z])\/(.*)/);
		if (mntMatch) {
			return `${mntMatch[1].toUpperCase()}:\\${mntMatch[2].replace(/\//g, '\\')}`;
		}
		// /home/user/... → \\wsl$\<distro>\home\user\...
		const settings = settingsStore.get();
		if (settings.wslEnabled && settings.wslDistro) {
			return `\\\\wsl$\\${settings.wslDistro}\\${linuxPath.replace(/^\//, '').replace(/\//g, '\\')}`;
		}
		return linuxPath;
	};

	ipcMain.handle(ipcChannels.filesOpen, async (_event, path: string) => {
		const error = await shell.openPath(toWindowsPath(path));
		// Electron 通过返回字符串报告打开失败；显式抛出后前端才能提示路径不存在或系统无法打开。
		if (error) throw new Error(error);
	});

	ipcMain.handle(ipcChannels.browserOpenExternal, async (_event, url: string) => {
		// This IPC is renderer-callable, so it must share the protocol gate used by
		// every other external-link path instead of passing arbitrary schemes to the OS.
		await openExternalUrl(url, true);
	});

	ipcMain.handle(ipcChannels.filesReadContent, async (_event, path: string) => {
		try {
			return await readFile(toWindowsPath(path), "utf8");
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") {
				return "";
			}
			throw error;
		}
	});

	ipcMain.handle(ipcChannels.filesWriteContent, async (_event, path: string, content: string) => {
		await writeFile(path, content, "utf8");
		void appLogger.info("file", "File written", { path, bytes: Buffer.byteLength(content, "utf8") });
	});


	ipcMain.handle(
		ipcChannels.filesCreate,
		async (_event, parentDir: string, name: string, type: "file" | "directory") => {
			const result = await fileSystemService.create(parentDir, name, type);
			void appLogger.info("file", "File/folder created", { parentDir, name, type, result });
			return result;
		},
	);
	ipcMain.handle(ipcChannels.filesDelete, async (_event, path: string, recursive?: boolean) => {
		await fileSystemService.delete(path, recursive);
		void appLogger.info("file", "File deleted", { path, recursive: Boolean(recursive) });
	});

	ipcMain.handle(ipcChannels.filesRename, async (_event, path: string, newName: string) => {
		const result = await fileSystemService.rename(path, newName);
		void appLogger.info("file", "File renamed", { path, newName, result });
		return result;
	});

	// Scratch Pad（草稿本）：多草稿支持，每份草稿为 drafts/ 下的独立 .md 文件
	const draftsDir = join(app.getPath("userData"), "drafts");

	/** 确保 drafts 目录存在，首次访问时如果旧 scratch-pad.md 存在则迁移为草稿 */
	async function ensureDraftsDir(): Promise<void> {
		try {
			await mkdir(draftsDir, { recursive: true });
		} catch {
			// 忽略目录已存在错误
		}
		// 迁移旧 scratch-pad.md：如果存在且有内容，移入 drafts 目录
		const oldPath = join(app.getPath("userData"), "scratch-pad.md");
		try {
			const oldStat = await stat(oldPath);
			if (oldStat.size > 0) {
				const ts = new Date(oldStat.mtimeMs);
				const name = `${ts.getFullYear()}-${String(ts.getMonth() + 1).padStart(2, "0")}-${String(ts.getDate()).padStart(2, "0")} ${String(ts.getHours()).padStart(2, "0")}-${String(ts.getMinutes()).padStart(2, "0")}-${String(ts.getSeconds()).padStart(2, "0")}.md`;
				await copyFile(oldPath, join(draftsDir, name));
			}
			await rm(oldPath);
		} catch {
			// 旧文件不存在则忽略
		}
	}

	/** 生成以当前时间命名的默认文件名：YYYY-MM-DD HH-mm-ss.md */
	function generateDraftName(): string {
		const now = new Date();
		return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")} ${String(now.getHours()).padStart(2, "0")}-${String(now.getMinutes()).padStart(2, "0")}-${String(now.getSeconds()).padStart(2, "0")}.md`;
	}

	/** 列出所有草稿，按更新时间降序排列 */
	ipcMain.handle(ipcChannels.scratchPadList, async (): Promise<import("../shared/types").DraftMeta[]> => {
		await ensureDraftsDir();
		const files = await readdir(draftsDir);
		const mdFiles = files.filter(f => f.endsWith(".md"));
		const drafts = await Promise.all(
			mdFiles.map(async (f) => {
				const fullPath = join(draftsDir, f);
				try {
					const s = await stat(fullPath);
					return {
						id: f.replace(/\.md$/, ""),
						name: f.replace(/\.md$/, ""),
						path: fullPath,
						createdAt: s.birthtimeMs,
						updatedAt: s.mtimeMs,
					};
				} catch {
					return null;
				}
			}),
		);
		return drafts
			.filter((d): d is NonNullable<typeof d> => d !== null)
			.sort((a, b) => b.updatedAt - a.updatedAt);
	});

	/** 创建新草稿，默认文件名为当前时间 */
	ipcMain.handle(ipcChannels.scratchPadCreate, async (): Promise<import("../shared/types").DraftMeta> => {
		await ensureDraftsDir();
		const name = generateDraftName();
		const fullPath = join(draftsDir, name);
		await writeFile(fullPath, "", "utf8");
		const s = await stat(fullPath);
		void appLogger.info("scratchPad", "draft created", { path: fullPath });
		return {
			id: name.replace(/\.md$/, ""),
			name: name.replace(/\.md$/, ""),
			path: fullPath,
			createdAt: s.birthtimeMs,
			updatedAt: s.mtimeMs,
		};
	});

	/** 删除指定草稿 */
	ipcMain.handle(ipcChannels.scratchPadDelete, async (_event, draftPath: string): Promise<void> => {
		await rm(draftPath);
		void appLogger.info("scratchPad", "draft deleted", { path: draftPath });
	});

	/** 加载指定草稿内容，path 为空时返回空内容 */
	ipcMain.handle(ipcChannels.scratchPadLoad, async (_event, draftPath?: string): Promise<import("../shared/types").ScratchPadData> => {
		if (!draftPath) return { content: "", lastEditedAt: 0, cursorPosition: 0 };
		try {
			const content = await readFile(draftPath, "utf8");
			const fileStat = await stat(draftPath);
			return { content, lastEditedAt: fileStat.mtimeMs, cursorPosition: 0 };
		} catch {
			return { content: "", lastEditedAt: 0, cursorPosition: 0 };
		}
	});

	/** 保存内容到指定草稿 */
	ipcMain.handle(ipcChannels.scratchPadSave, async (_event, draftPath: string, content: string, cursorPosition: number) => {
		await ensureDraftsDir();
		await writeFile(draftPath, content, "utf8");
		void appLogger.info("scratchPad", "saved", { path: draftPath, bytes: Buffer.byteLength(content, "utf8"), cursorPosition });
	});

	/** 导出指定草稿到用户选择的路径 */
	ipcMain.handle(ipcChannels.scratchPadExport, async (_event, draftPath?: string) => {
		if (!draftPath) return false;
		const suggestedName = basename(draftPath);
		const { canceled, filePath } = await dialog.showSaveDialog({
			defaultPath: suggestedName,
			filters: [{ name: "Markdown", extensions: ["md"] }],
		});
		if (canceled || !filePath) return false;
		const content = await readFile(draftPath, "utf8");
		await writeFile(filePath, content, "utf8");
		return true;
	});

	ipcMain.handle(
		ipcChannels.filesShowInFolder,
		async (_event, path: string) => {
			shell.showItemInFolder(toWindowsPath(path));
		},
	);

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
			return sessionCatalog.createDraft({
				projectId: input.projectId,
				title: input.title?.trim() || mainCopy("session.newTitle"),
				environment: settingsStore.get().wslEnabled ? "wsl" : "native",
				model: input.model,
				thinkingLevel: input.thinkingLevel,
			});
		},
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
					if (!renamed.ok) throw sessionCommandIpcError(renamed.error);
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
		async (_event, target: SessionRuntimeTarget) => {
			const result = await sessionRuntimeCoordinator.stopRuntime(target);
			if (result.ok) {
				terminalManager.closeAgent(target.agentId);
				emitSessionRuntimeDetach(target);
			}
			return result;
		},
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
				emitSessionRuntimeDetach(target);
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

	registerGitIpc({
		appLogger,
		gitService,
		piLocator,
		projectStore,
		settingsStore,
		worktreeService,
	});

	ipcMain.handle(ipcChannels.piCheck, async () => {
		// 用户手动指定的路径优先于自动检测
		const settings = settingsStore.get();
		const status = await piLocator.check(settings.customPiPath, settings.wslEnabled, settings.wslDistro, settings.wslUser);
		void appLogger.info("pi", "Pi check completed", {
			installed: status.installed,
			version: status.version,
			command: status.command,
			error: status.error,
		});
		return status;
	});
	// 直接从 models.json 读取模型列表，无需启动 agent，无缓存（实时反映文件变化）
	ipcMain.handle(ipcChannels.projectsListModels, async (_event, _projectId?: string) => {
		try {
			const result = await configManager.getModelsConfig();
			const models: { provider: string; id: string; name?: string; reasoning?: boolean }[] = [];
			for (const [providerName, providerConfig] of Object.entries(result.parsed.providers)) {
				for (const model of (providerConfig.models ?? [])) {
					models.push({
						provider: providerName,
						id: model.id,
						name: model.name || model.id,
						reasoning: model.reasoning,
					});
				}
			}
			return models;
		} catch (error) {
			void appLogger.warn("pi", "Failed to read models config", {
				error: error instanceof Error ? error.message : String(error),
			});
			return [];
		}
	});
	// 智能查找 wsl.exe：优先绝对路径（含 32-bit Sysnative 绕过），全部不存在时回退到 PATH
	const wslExeResolved = (() => {
		const root = process.env.SystemRoot || "C:\\Windows";
		const candidates = process.arch === "ia32"
			? [join(root, "Sysnative", "wsl.exe"), join(root, "System32", "wsl.exe")]
			: [join(root, "System32", "wsl.exe")];
		for (const candidate of candidates) {
			if (existsSync(candidate)) return { command: candidate, shell: false };
		}
		return { command: "wsl", shell: true };
	})();
	const wslExePath = wslExeResolved.command;
	const wslShell = wslExeResolved.shell;
	// WSL: 列出已安装的发行版（仅 Windows 有效，其他平台返回空数组）
	ipcMain.handle(ipcChannels.wslListDistros, async () => {
		if (process.platform !== "win32") return [] as string[];
		try {
			const { execFile } = await import("node:child_process");
			return new Promise<string[]>((resolve) => {
				execFile(wslExePath, ["-l", "-q"], { encoding: "utf8", timeout: 10_000, windowsHide: true, shell: wslShell },
					(err, stdout) => {
						if (err) { resolve([]); return; }
						// 过滤空行、\0 字符、Windows 文件后缀等非法发行版名
						const distros = stdout.split(/\r?\n/)
							.map((s) => s.trim())
							.filter((s) => s.length > 0 && !s.includes("\\") && !s.includes("\x00"));
						resolve(distros);
					});
			});
		} catch { return [] as string[]; }
	});
	// WSL: 验证连接性 — 分步检查 distro+user 可达性 和 pi 可用性
	ipcMain.handle(ipcChannels.wslValidateConnection, async (_event, distro: string, user: string) => {
		if (process.platform !== "win32") {
			return { ok: false, whoami: "", piVersion: "", error: mainCopy("wsl.windowsOnly") };
		}
		try {
			const { execFile } = await import("node:child_process");
			// Step 1: 验证 distro + user 可达
			const whoami = await new Promise<string>((resolve, reject) => {
				execFile(wslExePath, ["-d", distro, "-u", user, "whoami"],
					{ encoding: "utf8", timeout: 10_000, windowsHide: true, shell: wslShell },
					(err, stdout) => {
						if (err) { reject(err); return; }
						resolve(stdout.trim());
					});
			});
			// Step 2: 检查 pi 是否已安装
			let piVersion = "";
			try {
				piVersion = await new Promise<string>((resolve, reject) => {
					execFile(wslExePath, ["-d", distro, "-u", user, "pi", "--version"],
						{ encoding: "utf8", timeout: 10_000, windowsHide: true, shell: wslShell },
						(err, stdout) => {
							if (err) { reject(err); return; }
							resolve(stdout.trim());
						});
				});
			} catch { /* pi 未安装，piVersion 保持空 */ }
			return {
				ok: true,
				whoami,
				piVersion,
				error: piVersion ? "" : mainCopy("wsl.piNotInstalled"),
			};
		} catch (err) {
			void appLogger.warn("wsl", "WSL connection validation failed", {
				distro,
				user,
				error: err instanceof Error ? err.message : String(err),
			});
			return {
				ok: false,
				whoami: "",
				piVersion: "",
				error: mainCopy("wsl.connectionFailed"),
			};
		}
	});
	ipcMain.handle(ipcChannels.piUpdateCheck, async () => {
		const result = await extensionManager.checkPiUpdate();
		void appLogger.info("pi", "Pi update check completed", { currentVersion: result.currentVersion, latestVersion: result.latestVersion, hasUpdate: result.hasUpdate, error: result.error });
		return result;
	});
	ipcMain.handle(ipcChannels.piUpdate, async () => {
		const result = await extensionManager.updatePi();
		void appLogger.info("pi", "Pi update command completed", { updated: result.updated, bytes: result.output.length });
		return result;
	});
	ipcMain.handle(
		ipcChannels.piCheckCustom,
		async (_event, customPath: string) => {
			const status = await piLocator.validateCustomPath(customPath);
			// 校验通过后持久化归一化后的路径，后续启动 agent 时 PiProcess 会从 settings 读取。
			// 例如用户粘贴 "D:\\foo\\pi" 时，PiLocator 会返回可执行的 D:\foo\pi.cmd。
			if (status.installed && status.command) {
				await settingsStore.update({ customPiPath: status.command });
			}
			void appLogger.info("pi", "Custom pi path checked", {
				installed: status.installed,
				version: status.version,
				command: status.command,
				error: status.error,
			});
			return status;
		},
	);

	/**
	 * 执行 npm install 安装命令，返回 stdout/stderr/exitCode。
	 * 用于首次安装向导中让用户一键安装 pi CLI。
	 * 使用 execFile 而非 spawn 以确保命令执行完毕后一次性返回完整输出。
	 */
	ipcMain.handle(
		ipcChannels.piExecInstall,
		async (_event, command: string): Promise<import("../shared/types").PiInstallExecResult> => {
			void appLogger.info("pi", "Executing install command", { command });
			try {
				const { execFile } = await import("node:child_process");
				const result = await new Promise<import("../shared/types").PiInstallExecResult>((resolve) => {
					// Windows 下通过 cmd /c 执行命令，确保 npm.cmd shim 能被正确调用。
					// Unix 直接使用 shell:true 兼容通过 nvm/n 等版本管理器安装的 npm。
					const isWin = process.platform === "win32";
					if (isWin) {
						const child = execFile(
							process.env.ComSpec || "cmd.exe",
							["/d", "/s", "/c", command],
							{
								cwd: app.getPath("home"),
								timeout: 120_000, // npm install 最长 2 分钟
								env: { ...process.env, npm_config_fund: "false", npm_config_audit: "false" },
								windowsHide: true,
								encoding: "utf8",
								shell: false,
							},
							(error: unknown, stdout: string, stderr: string) => {
								const execError = error as { code?: number | string } | null;
								resolve({
									success: !error,
									exitCode: typeof execError?.code === "number" ? execError.code : execError ? -1 : 0,
									stdout: stdout || "",
									stderr: stderr || "",
								});
							},
						);
					} else {
						execFile(
							"/bin/sh",
							["-c", command],
							{
								cwd: app.getPath("home"),
								timeout: 120_000,
								env: { ...process.env, npm_config_fund: "false", npm_config_audit: "false" },
								encoding: "utf8",
							},
							(error: unknown, stdout: string, stderr: string) => {
								const execError = error as { code?: number | string } | null;
								resolve({
									success: !error,
									exitCode: typeof execError?.code === "number" ? execError.code : execError ? -1 : 0,
									stdout: stdout || "",
									stderr: stderr || "",
								});
							},
						);
					}
				});
				void appLogger.info("pi", "Install command completed", {
					success: result.success,
					exitCode: result.exitCode,
					stdoutLength: result.stdout.length,
					stderrLength: result.stderr.length,
				});
				return result;
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				void appLogger.error("pi", "Install command threw", { error: message });
				return { success: false, exitCode: -1, stdout: "", stderr: message };
			}
		},
	);

	/**
	 * 检查 npm 是否可在系统中执行。
	 * 通过执行 npm --version 判断，返回版本号或错误信息。
	 * 用于首次安装向导中判断是否应显示 npm install 按钮或引导安装 Node.js。
	 */
	ipcMain.handle(
		ipcChannels.piCheckNpm,
		async (): Promise<import("../shared/types").NpmAvailabilityResult> => {
			try {
				const { execFile } = await import("node:child_process");
				const result = await new Promise<import("../shared/types").NpmAvailabilityResult>((resolve) => {
					const isWin = process.platform === "win32";
					if (isWin) {
						execFile(
							process.env.ComSpec || "cmd.exe",
							["/d", "/s", "/c", "npm --version"],
							{ timeout: 10_000, encoding: "utf8", windowsHide: true, shell: false },
							(error, stdout) => {
								if (error) {
									resolve({ available: false, error: error.message });
								} else {
									resolve({ available: true, version: stdout.trim() });
								}
							},
						);
					} else {
						execFile(
							"npm",
							["--version"],
							{ timeout: 10_000, encoding: "utf8" },
							(error, stdout) => {
								if (error) {
									resolve({ available: false, error: error.message });
								} else {
									resolve({ available: true, version: stdout.trim() });
								}
							},
						);
					}
				});
				return result;
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return { available: false, error: message };
			}
		},
	);
	ipcMain.handle(ipcChannels.appInfo, () => ({
		version: app.getVersion(),
		releasesUrl: RELEASES_URL,
		platform: process.platform,
	}));
	ipcMain.handle(ipcChannels.appPreferredSystemLanguages, () => {
		// Renderer navigator.language can reflect Chromium launch flags or a stale browser locale.
		// Electron exposes the OS preference order directly; use it for the "follow system" setting.
		try {
			return app.getPreferredSystemLanguages();
		} catch {
			return [];
		}
	});
	ipcMain.handle(ipcChannels.appCheckUpdate, () =>
		checkForAppUpdate(settingsStore.get().installationType),
	);
	ipcMain.handle(
		ipcChannels.appDownloadUpdate,
		async (_event, asset: AppUpdateAsset) => downloadUpdateAsset(asset),
	);
	ipcMain.handle(
		ipcChannels.appInstallUpdate,
		async (_event, filePath: string) => installDownloadedUpdate(filePath),
	);
	ipcMain.handle(ipcChannels.logsList, async (_event, query: AppLogQuery) =>
		appLogger.list(query),
	);
	ipcMain.handle(
		ipcChannels.rendererLog,
		async (
			_event,
			level: AppLogLevel,
			scope: string,
			message: string,
			detail?: unknown,
		) => {
			const safeLevel = ["debug", "info", "warn", "error"].includes(level)
				? level
				: "info";
			await appLogger.log(safeLevel as AppLogLevel, scope, message, detail);
		},
	);
	ipcMain.on(ipcChannels.preloadReady, (event) => {
		void appLogger.info("app", "Preload API exposed", {
			url: event.sender.getURL(),
		});
	});
	ipcMain.on(ipcChannels.preloadError, (event, detail) => {
		void appLogger.error("app", "Preload API expose failed", {
			url: event.sender.getURL(),
			detail,
		});
	});
	ipcMain.handle(ipcChannels.logsClear, async () => appLogger.clear());
	ipcMain.handle(ipcChannels.logsOpenFolder, async () => appLogger.openFolder());
	/** 获取 app 日志文件总大小 */
	ipcMain.handle(ipcChannels.logsSize, async () => appLogger.getSize());
	const resolveRpcRuntimeAgent = (target?: SessionRuntimeTarget) => {
		if (!target) return undefined;
		const validated = sessionRuntimeCoordinator.validateTarget(target);
		if (!validated.ok) throw sessionCommandIpcError(validated.error);
		return target.agentId;
	};
	/** 获取 RPC 日志文件总大小，可选按 Session runtime 过滤 */
	ipcMain.handle(ipcChannels.rpcLogsGetSize, async (_event, target?: SessionRuntimeTarget) =>
		rpcLogger.getSize(resolveRpcRuntimeAgent(target)),
	);
	/** 从文件读取 RPC 日志，可选按 Session runtime/日期范围过滤 */
	ipcMain.handle(
		ipcChannels.rpcLogsGet,
		async (_event, options?: { target?: SessionRuntimeTarget; days?: number; limit?: number }) =>
			rpcLogger.getFromFile({
				agentId: resolveRpcRuntimeAgent(options?.target),
				days: options?.days,
				limit: options?.limit,
			}),
	);
	/** 清空 RPC 日志文件，可选按 Session runtime 过滤 */
	ipcMain.handle(ipcChannels.rpcLogsClear, async (_event, target?: SessionRuntimeTarget) =>
		rpcLogger.clear(resolveRpcRuntimeAgent(target)),
	);
	/** 开关某 Session runtime 的 RPC 日志记录 */
	ipcMain.handle(ipcChannels.rpcLoggingSet, async (_event, target: SessionRuntimeTarget, enabled: boolean) => {
		agentManager.setRpcLogging(resolveRpcRuntimeAgent(target)!, enabled);
		return enabled;
	});
	/** 查询某 Session runtime 的 RPC 日志记录状态 */
	ipcMain.handle(ipcChannels.rpcLoggingGet, async (_event, target: SessionRuntimeTarget) =>
		agentManager.isRpcLogging(resolveRpcRuntimeAgent(target)!),
	);
	/** 用默认编辑器打开当前 Session runtime 的 RPC 日志目录 */
	ipcMain.handle(ipcChannels.rpcLogsOpenFile, async (_event, target: SessionRuntimeTarget) => {
		resolveRpcRuntimeAgent(target);
		const { shell } = require("electron");
		const { join } = require("path");
		const dir = join(app.getPath("userData"), "logs", "rpc");
		await shell.openPath(dir);
	});
	ipcMain.handle(ipcChannels.appFeedbackEnvironment, async () => {
		// 反馈报告只包含诊断必需的运行时版本与 pi 检测结果，不读取配置密钥或会话内容。
		const pi = await piLocator.check();
		return {
			appVersion: app.getVersion(),
			platform: process.platform,
			arch: process.arch,
			electronVersion: process.versions.electron ?? "",
			chromeVersion: process.versions.chrome ?? "",
			nodeVersion: process.versions.node,
			pi,
		};
	});
	ipcMain.handle(ipcChannels.appOpenExternal, async (_event, url: string, forceSystem?: boolean) => {
		// 外部链接统一经主进程打开，避免 renderer 直接依赖 shell 权限，并遵守用户设置的打开方式。
		await openExternalUrl(url, forceSystem);
	});
	ipcMain.handle(ipcChannels.appRestart, async () => {
		// 标记为退出状态，避免 closeToTray 阻止重启
		isQuitting = true;
		// 停止所有 Agent 和服务
		await webServiceManager?.stop();
		terminalManager?.closeAll();
		agentManager?.stopAll();
		// 重启应用
		app.relaunch();
		app.quit();
	});
	ipcMain.handle(ipcChannels.appWindowMinimize, () => {
		if (!mainWindow || mainWindow.isDestroyed()) return;
		mainWindow.minimize();
	});
	ipcMain.handle(ipcChannels.appWindowToggleMaximize, () => {
		if (!mainWindow || mainWindow.isDestroyed()) return;
		if (mainWindow.isMaximized()) mainWindow.unmaximize();
		else mainWindow.maximize();
	});
	ipcMain.handle(ipcChannels.appWindowToggleAlwaysOnTop, () => {
		if (!mainWindow || mainWindow.isDestroyed()) return false;
		const next = !mainWindow.isAlwaysOnTop();
		// floating 适合工具型桌面窗口；跨平台由 Electron 映射到各系统的置顶层级。
		mainWindow.setAlwaysOnTop(next, "floating");
		return next;
	});
	ipcMain.handle(ipcChannels.appWindowClose, () => {
		if (!mainWindow || mainWindow.isDestroyed()) return;
		mainWindow.close();
	});

	ipcMain.handle(ipcChannels.settingsGet, () => settingsStore.get());
	ipcMain.handle(
		ipcChannels.settingsUpdate,
		async (_event, patch: Partial<AppSettings>) => {
			// 记录更新前的设置，用于驱动桌面宠物对 pet 字段变化的反应
			const prevSettings = settingsStore.get();
			const settings = await settingsStore.update(patch);
			void appLogger.info("settings", "Settings updated", { keys: Object.keys(patch) });
			// 桌面宠物：设置面板走 settings.update，这里统一驱动开窗/切换/置顶
			await petSystem?.reactToSettings(prevSettings, settings);
			if (
				"desktopProxyEnabled" in patch ||
				"desktopProxyUrl" in patch ||
				"desktopProxyBypass" in patch
			) {
				await applyDesktopProxy(settings);
			}
			if ("theme" in patch) {
				applyNativeThemeSource(settings);
			}
			if ("language" in patch) {
				feishuBridge?.setLocale(currentFeishuLocale());
				setFeishuConfigDefaultBotName(feishuT(currentFeishuLocale(), "bridge.defaultBotName"));
				refreshTrayContextMenu();
			}
			if ("useNativeTitleBar" in patch) {
				settingsStore.notifyTitleBarChange(mainWindow);
			}
			if ("zoomFactor" in patch) {
				mainWindow?.webContents.setZoomFactor(settings.zoomFactor);
			}
			if (
				"webServiceEnabled" in patch ||
				"webServiceHost" in patch ||
				"webServicePort" in patch
			) {
				try {
					await webServiceManager.applySettings(settings);
				} catch (error) {
					const debugDetails = error instanceof Error ? error.message : String(error);
					void appLogger.warn("web", "Failed to apply web service settings", {
						error: debugDetails,
					});
					if (settings.webServiceEnabled) {
						await settingsStore.update({ webServiceEnabled: false });
					}
					throw new Error(mainCopy(
						debugDetails === "WEB_SERVICE_INVALID_PORT"
							? "webService.invalidPort"
							: "webService.startFailed",
					));
				}
			}
			// WSL 设置变更时同步更新会话扫描器和配置管理器
			if ("wslEnabled" in patch || "wslDistro" in patch || "wslUser" in patch) {
				sessionCatalog.setIdentityContext(
					settings.wslEnabled
						? { wslDistro: settings.wslDistro, wslUser: settings.wslUser }
						: {},
				);
				if (settings.wslEnabled && settings.wslDistro && settings.wslUser) {
					const { resolveWslEnvironment: resolveWsl } = await import("./wsl/WslEnvironment");
					const environment = await resolveWsl(settings.wslDistro, settings.wslUser, {
						warn: (msg: string, detail: unknown) => console.warn("[PiDeck] " + String(msg), detail),
					});
					await sessionScanner.configureWsl(environment);
					skillManager.configureWsl(environment);
					promptManager.configureWsl(environment);
					extensionManager.configureWsl(environment);
					if (configManager) configManager.configureWsl(environment);
					if (xuePromptManager) xuePromptManager.configureWsl(environment);
				} else {
					sessionScanner.clearWsl();
					skillManager.configureWsl(null);
					promptManager.configureWsl(null);
					extensionManager.configureWsl(null);
					if (configManager) configManager.configureWsl(null);
					if (xuePromptManager) xuePromptManager.configureWsl(null);
				}
			}
			return settings;
		},
	);
	ipcMain.handle(
		ipcChannels.settingsTestPiProxy,
		async () => {
			const result = await testPiProxy(settingsStore.get(), undefined, mainCopy);
			void appLogger.info("settings", "Pi proxy tested", {
				success: result.success,
				elapsedMs: result.elapsedMs,
				statusCode: result.statusCode,
				error: result.error,
			});
			return result;
		},
	);

	ipcMain.handle(ipcChannels.skillsList, () => skillManager.list());
	ipcMain.handle(ipcChannels.skillsCreate, async (_event, input: CreatePiSkillInput) => {
		const result = await skillManager.create(input);
		void appLogger.info("skill", "Skill created", { name: input.name, locationId: input.locationId });
		return result;
	});
	ipcMain.handle(ipcChannels.skillsToggle, async (_event, path: string, enabled: boolean) => {
		const result = await skillManager.toggle(path, enabled);
		void appLogger.info("skill", "Skill toggled", { path, enabled });
		return result;
	});
	ipcMain.handle(ipcChannels.skillsDelete, async (_event, path: string) => {
		const result = await skillManager.delete(path);
		void appLogger.info("skill", "Skill deleted", { path });
		return result;
	});
	ipcMain.handle(ipcChannels.skillsOpenFolder, (_event, path?: string) =>
		skillManager.openFolder(path),
	);

	// ── Prompt Templates ──
	ipcMain.handle(ipcChannels.promptsList, () => promptManager.list());
	ipcMain.handle(ipcChannels.promptsCreate, async (_event, input: CreatePiPromptTemplateInput) => {
		const result = await promptManager.create(input);
		void appLogger.info("prompt", "Prompt template created", { name: input.name });
		return result;
	});
	ipcMain.handle(ipcChannels.promptsDelete, async (_event, filePath: string) => {
		await promptManager.delete(filePath);
		void appLogger.info("prompt", "Prompt template deleted", { filePath });
	});
	ipcMain.handle(ipcChannels.promptsOpenFolder, () => promptManager.openFolder());
	ipcMain.handle(ipcChannels.promptsEdit, async (_event, filePath: string, content?: string) => {
		if (content !== undefined) {
			await promptManager.writeContent(filePath, content);
			return;
		}
		return promptManager.readContent(filePath);
	});
	ipcMain.handle(ipcChannels.promptsListByProject, async (_event, projectPath: string) => {
		return promptManager.listByProject(projectPath);
	});
	ipcMain.handle(ipcChannels.promptsCreateInProject, async (_event, projectPath: string, input: CreatePiPromptTemplateInput) => {
		const result = await promptManager.createInProject(projectPath, input);
		void appLogger.info("prompt", "Project prompt template created", {
			projectPath,
			name: input.name,
		});
		return result;
	});
	ipcMain.handle(ipcChannels.promptsDeleteInProject, async (_event, projectPath: string, fileName: string) => {
		await promptManager.deleteFromProject(projectPath, fileName);
		void appLogger.info("prompt", "Project prompt template deleted", { projectPath, fileName });
	});
	ipcMain.handle(ipcChannels.promptsRename, async (_event, oldName: string, newName: string) => {
		const result = await promptManager.rename(oldName, newName);
		void appLogger.info("prompt", "Prompt template renamed", { oldName, newName });
		return result;
	});
	ipcMain.handle(ipcChannels.promptsRenameInProject, async (_event, projectPath: string, oldName: string, newName: string) => {
		const result = await promptManager.renameInProject(projectPath, oldName, newName);
		void appLogger.info("prompt", "Project prompt template renamed", { projectPath, oldName, newName });
		return result;
	});

	// ── Prompt Store (prompts.chat) ──────────────────────────────────────
	/** prompts.chat REST API 端点 */
	const PROMPT_STORE_BASE = "https://prompts.chat/api";

	/**
	 * 搜索 prompts.chat 公开 prompt 市场。
	 * 使用 REST API 搜索，返回结构化结果供用户浏览和选择导入。
	 */
	ipcMain.handle(ipcChannels.promptStoreSearch, async (_event, query: string, options?: {
		limit?: number;
		type?: string;
		category?: string;
		tag?: string;
	}) => {
		try {
			const params = new URLSearchParams({ q: query });
			if (options?.limit) params.set("perPage", String(options.limit));
			if (options?.type) params.set("type", options.type);
			if (options?.category) params.set("category", options.category);
			if (options?.tag) params.set("tag", options.tag);

			const url = `${PROMPT_STORE_BASE}/prompts?${params.toString()}`;
			const response = await fetch(url, {
				signal: AbortSignal.timeout(10_000),
			});
			if (!response.ok) {
				throw new Error(`prompts.chat API 返回 ${response.status}`);
			}
			// API 返回原始结构，扁平化为 UI 消费的格式
			const raw = (await response.json()) as PromptStoreSearchResponse;
			const result: PromptStoreSearchResult = {
				query,
				count: raw.total,
				prompts: raw.prompts.map(flattenPromptItem),
			};
			return result;
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			void appLogger.warn("prompt-store", "Search failed", { query, error: message });
			throw new Error(mainCopy("store.promptSearchFailed"));
		}
	});

	/** 通过 ID 获取 prompts.chat 单个 prompt 的完整内容 */
	ipcMain.handle(ipcChannels.promptStoreGet, async (_event, id: string) => {
		try {
			const url = `${PROMPT_STORE_BASE}/prompts/${encodeURIComponent(id)}`;
			const response = await fetch(url, {
				signal: AbortSignal.timeout(10_000),
			});
			if (!response.ok) {
				throw new Error(`prompts.chat API 返回 ${response.status}`);
			}
			const raw = (await response.json()) as PromptStoreRawItem;
			return flattenPromptItem(raw);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			void appLogger.warn("prompt-store", "Get prompt failed", { id, error: message });
			throw new Error(mainCopy("store.promptDetailFailed"));
		}
	});

	/** 将 prompts.chat 原始 prompt 条目扁平化为 UI 消费的格式 */
	function flattenPromptItem(raw: PromptStoreRawItem): PromptStoreItem {
		return {
			id: raw.id,
			title: raw.title,
			description: raw.description,
			content: raw.content,
			type: raw.type,
			author: raw.author?.name ?? "",
			category: raw.category?.name ?? "",
			tags: raw.tags?.map((t) => t.tag?.name).filter(Boolean) ?? [],
			votes: raw.voteCount ?? 0,
			createdAt: raw.createdAt,
		};
	}

	/**
	 * 将 prompts.chat 的命名变量（${name} / ${name:default}）
	 * 转换为 pi 的位置参数（$N / ${N:-default}）。
	 * 同时生成 argument-hint。
	 */
	function convertStoreVarsToPiVars(content: string): { converted: string; argumentHint: string; varCount: number } {
		// 收集所有 ${name} 和 ${name:default}，保留出现顺序
		const varMap = new Map<string, { index: number; hasDefault: boolean; defaultVal?: string }>();
		let nextIndex = 1;
		// 先扫描所有变量并分配序号
		const scanRegex = /\$\{([a-zA-Z_]\w*)(?::(.*?))?\}/g;
		let scanMatch: RegExpExecArray | null;
		while ((scanMatch = scanRegex.exec(content)) !== null) {
			const varName = scanMatch[1];
			if (!varMap.has(varName)) {
				varMap.set(varName, {
					index: nextIndex++,
					hasDefault: scanMatch[2] !== undefined,
					defaultVal: scanMatch[2],
				});
			}
		}

		// 如果没有变量，直接返回原文
		if (varMap.size === 0) {
			return { converted: content, argumentHint: "", varCount: 0 };
		}

		// 替换变量
		let converted = content.replace(
			/\$\{([a-zA-Z_]\w*)(?::(.*?))?\}/g,
			(_match, varName: string, defaultVal?: string) => {
				const info = varMap.get(varName)!;
				if (defaultVal !== undefined) {
					return `\${${info.index}:-${defaultVal}}`;
				}
				return `$${info.index}`;
			},
		);

		// 生成 argument-hint：无默认值的用 <>, 有默认值的用 []
		const hints: string[] = [];
		for (let i = 1; i < nextIndex; i++) {
			const entry = Array.from(varMap.entries()).find(([, v]) => v.index === i);
			if (!entry) continue;
			const [varName, info] = entry;
			if (info.hasDefault) {
				hints.push(`[${varName}:${info.defaultVal}]`);
			} else {
				hints.push(`<${varName}>`);
			}
		}
		const argumentHint = hints.length > 0 ? hints.join(" ") : "";

		return { converted, argumentHint, varCount: varMap.size };
	}

	/** 从 prompts.chat 导入 prompt 到本地 ~/.pi/agent/prompts/ */
	ipcMain.handle(ipcChannels.promptStoreImport, async (_event, {
		title,
		description,
		content,
	}: {
		title: string;
		description: string;
		content: string;
	}) => {
		try {
			const name = title
				.trim()
				.toLowerCase()
				.replace(/[^\p{L}\p{N}-]+/gu, "-")
				.replace(/-+/g, "-")
				.replace(/^-|-$/g, "");
			if (!name) throw new Error(mainCopy("store.invalidItemTitle"));

			// 转换变量格式：prompts.chat 的 ${name} → pi 的 $N
			const { converted, argumentHint, varCount } = convertStoreVarsToPiVars(content);

			// 使用 PromptManager.create 来创建，统一命名规范
			// 但如果 create 失败（模板已存在名），加后缀
			const tryCreate = async (tryName: string): Promise<PiPromptTemplateSummary> => {
				try {
					return await promptManager.create({ name: tryName, description });
				} catch {
					// 名称冲突，加数字后缀重试
					const match = tryName.match(/-(\d+)$/);
					const nextNum = match ? parseInt(match[1], 10) + 1 : 2;
					const suffixName = tryName.replace(/-\d+$/, "") + "-" + nextNum;
					return tryCreate(suffixName);
				}
			};

			// 如果有 argument-hint，在 frontmatter 中标注
			const hintLine = argumentHint ? `\nargument-hint: ${argumentHint}` : "";
			const frontmatter = `---\ndescription: ${description.replace(/\n/g, " ")}\nsource: prompts.chat${hintLine}\n---\n\n`;
			const summary = await tryCreate(name);
			await promptManager.writeContent(summary.path, frontmatter + converted);

			void appLogger.info("prompt-store", "Imported prompt from store", {
				title,
				localName: summary.name,
				variables: varCount,
			});
			return summary;
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			void appLogger.warn("prompt-store", "Import failed", { title, error: message });
			throw new Error(mainCopy("store.promptImportFailed"));
		}
	});

	// ── Skill Store（prompts.chat skills） ─────────────────────────────
	/** 搜索 prompts.chat 的公开 skill。复用 prompts 搜索，按 skill 关键词过滤 */
	ipcMain.handle(ipcChannels.skillStoreSearch, async (_event, query: string) => {
		try {
			const params = new URLSearchParams({ q: query, perPage: "20" });
			const url = `https://prompts.chat/api/prompts?${params.toString()}`;
			const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
			if (!response.ok) throw new Error(`prompts.chat API 返回 ${response.status}`);
			const raw = (await response.json()) as PromptStoreSearchResponse;
			const result: PromptStoreSearchResult = {
				query,
				count: raw.total,
				prompts: raw.prompts.map(flattenPromptItem),
			};
			return result;
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			void appLogger.warn("skill-store", "Search failed", { query, error: message });
			throw new Error(mainCopy("store.skillSearchFailed"));
		}
	});

	/** 从 prompts.chat 导入为本地 skill */
	ipcMain.handle(ipcChannels.skillStoreImport, async (_event, item: PromptStoreItem, locationId: "pi-global" | "agents-global" = "pi-global") => {
		try {
			const name = item.title
				.trim()
				.toLowerCase()
				.replace(/[^\p{L}\p{N}-]+/gu, "-")
				.replace(/-+/g, "-")
				.replace(/^-|-$/g, "");
			if (!name) throw new Error(mainCopy("store.invalidItemTitle"));

			const { writeFile } = await import("node:fs/promises");

			// 用 SkillManager 创建 skill（默认 pi-global，用户可通过 dropdown 切换）
			const summary = await skillManager.create({
				name,
				description: item.description || item.title,
				locationId: locationId ?? "pi-global",
			});

			// 覆盖 SKILL.md 为实际内容
			const skillContent = `---\nname: ${name}\ndescription: ${(item.description || item.title).replace(/\n/g, " ")}\nsource: prompts.chat\n---\n\n# ${item.title}\n\n${item.content}`;
			await writeFile(summary.path, skillContent, "utf8");

			void appLogger.info("skill-store", "Imported skill from store", { title: item.title, localName: name });
			return summary;
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			void appLogger.warn("skill-store", "Import failed", { title: item.title, error: message });
			throw new Error(mainCopy("store.skillImportFailed"));
		}
	});

	// ── SkillHub（skill.xfyun.cn / skillhub CLI） ────────────────────

	// ── Skills.sh（https://www.skills.sh） ─────────────────────────
	/** 搜索 Skills.sh 注册中心 */
	ipcMain.handle(ipcChannels.skillHubSearch, async (_event, opts: { query: string; limit?: number }) => {
		const { query, limit = 50 } = opts;
		try {
			const response = await fetch(
				`https://www.skills.sh/api/search?q=${encodeURIComponent(query)}&limit=${limit}`,
				{ signal: AbortSignal.timeout(15_000) },
			);
			if (!response.ok) throw new Error(`API returned ${response.status}`);
			const json = (await response.json()) as {
				skills?: Array<{ id: string; skillId: string; name: string; installs: number; source: string }>;
			};
			const skills = json.skills ?? [];
			const items = skills.map((item) => ({
				slug: item.id,
				name: item.name,
				description: "",
				description_zh: "",
				iconUrl: undefined,
				stars: 0,
				downloads: item.installs,
				installs: item.installs,
				category: "",
				version: "",
				ownerName: item.source,
				source: "skills.sh",
			}));
			items.sort((a, b) => b.installs - a.installs);
			return { query, total: items.length, items };
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			void appLogger.warn("skill-hub", "Search failed", { query, error: message });
			throw new Error(mainCopy("store.skillsShSearchFailed"));
		}
	});

	/** 获取 Skills.sh skill 详情（不展示详情页，返回 null） */
	ipcMain.handle(ipcChannels.skillHubDetail, async () => null);

	/** 安装 Skills.sh skill：npx skills add <package> -g -s <name> -y */
	ipcMain.handle(ipcChannels.skillHubInstall, async (_event, slug: string) => {
		const lastSlash = slug.lastIndexOf("/");
		const pkg = lastSlash > 0 ? slug.slice(0, lastSlash) : slug;
		const skillName = lastSlash > 0 ? slug.slice(lastSlash + 1) : "";
		// P0 security: whitelist shell-safe characters only
		const SAFE_SLUG_RE = /^[a-zA-Z0-9@/\-_.]+$/;
		if (!SAFE_SLUG_RE.test(pkg) || (skillName && !SAFE_SLUG_RE.test(skillName))) {
			return { success: false, slug, installDir: "", error: mainCopy("store.skillsShInvalidSlug") };
		}
		try {
			const { exec } = await import("node:child_process");
			const { promisify } = await import("node:util");
			const execAsync = promisify(exec);
			const cmd = `npx skills add "${pkg}" -g -s "${skillName}" -y`;
			await execAsync(cmd, { encoding: "utf8", timeout: 120_000, maxBuffer: 10 * 1024 * 1024 });
			void appLogger.info("skill-hub", "Installed skill", { slug, pkg, skillName });
			return { success: true, slug, installDir: "" };
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			void appLogger.warn("skill-hub", "Install failed", { slug, error: message });
			return { success: false, slug, installDir: "", error: mainCopy("store.skillsShInstallFailed") };
		}
	});


	// ── Xue Prompts（中文提示词精选，xueprompt.com） ─────────────────────────────
	ipcMain.handle(ipcChannels.yaoPromptsList, async (_event, opts?: {
		category?: string;
		search?: string;
		page?: number;
		pageSize?: number;
	}) => {
		try {
			const result = await xuePromptManager.list(opts);
			return result;
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			void appLogger.warn("yao-prompts", "List failed", { error: message });
			throw new Error(mainCopy("store.yaoListFailed"));
		}
	});

	ipcMain.handle(ipcChannels.yaoPromptsDetail, async (_event, slug: string, category: string) => {
		try {
			const result = await xuePromptManager.detail(slug, category);
			if (!result) throw new Error(`未找到提示词: ${slug}`);
			return result;
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			void appLogger.warn("yao-prompts", "Detail failed", { slug, category, error: message });
			throw new Error(mainCopy("store.yaoDetailFailed"));
		}
	});

	ipcMain.handle(ipcChannels.yaoPromptsImport, async (_event, slug: string, category: string) => {
		try {
			const result = await xuePromptManager.importToPi(slug, category);
			void appLogger.info("yao-prompts", "Imported to pi templates", { slug, localName: result.name });
			return result;
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			void appLogger.warn("yao-prompts", "Import failed", { slug, category, error: message });
			throw new Error(mainCopy("store.yaoImportFailed"));
		}
	});

	ipcMain.handle(ipcChannels.extensionsList, () => extensionManager.list());
	ipcMain.handle(ipcChannels.extensionsUninstall, async (_event, source: string, scope?: "user" | "project" | "unknown") => {
		const result = await extensionManager.uninstall(source, scope);
		void appLogger.info("extension", "Extension uninstalled", { source, scope });
		return result;
	});
	ipcMain.handle(ipcChannels.extensionsInstall, async (_event, source: string) => {
		const result = await extensionManager.install(source);
		void appLogger.info("extension", "Extension installed", { source });
		return result;
	});
	ipcMain.handle(ipcChannels.extensionsToggle, async (_event, source: string, enabled: boolean) => {
		if (source.startsWith("pi-deck-") && source.endsWith(".ts")) {
			if (enabled) {
				// 启用：确保 .ts 文件存在（处理老版本误删文件的恢复场景）
				await ensurePiDeckExtension(source);
			}
			// 禁用时不删除 .ts 文件：通过 settings.json 的 disabledExtensions 控制 pi 加载即可
		}
		await extensionManager.setEnabled(source, enabled);
		void appLogger.info("extension", "Extension toggled", { source, enabled });
	});
	ipcMain.handle(ipcChannels.extensionsUpdate, async () => {
		const result = await extensionManager.updateExtensions();
		void appLogger.info("extension", "Extensions update command completed", { updated: result.updated, bytes: result.output.length });
		return result;
	});

	registerTerminalIpc({
		appLogger,
		sessionRuntimeCoordinator,
		terminalManager,
		toSessionCommandIpcError: sessionCommandIpcError,
	});

	// ── 配置管理 ──────────────────────────────────────
	ipcMain.handle(ipcChannels.configGetModels, () =>
		configManager.getModelsConfig(),
	);
	ipcMain.handle(ipcChannels.configGetAuth, () =>
		configManager.getAuthConfig(),
	);
	ipcMain.handle(ipcChannels.configGetSettings, () =>
		configManager.getSettingsConfig(),
	);
	ipcMain.handle(ipcChannels.configGetTrust, () =>
		configManager.getTrustConfig(),
	);
	// 项目信任确认：渲染进程回传用户选择，唤醒等待中的 Agent 创建流程（见 AgentManager.ensureProjectTrust）
	ipcMain.handle(
		ipcChannels.projectsTrustResponse,
		(_event, requestId: string, choice: "trust-remember" | "trust-session" | "deny") =>
			agentManager.respondTrustRequest(requestId, choice),
	);
	ipcMain.handle(ipcChannels.configSaveModels, async (_event, data) => {
		const result = await configManager.saveModelsConfig(data);
		void appLogger.info("config", "Models config saved", { providerCount: Object.keys(data?.providers ?? {}).length });
		return result;
	});
	ipcMain.handle(ipcChannels.configSaveAuth, async (_event, data) => {
		const result = await configManager.saveAuthConfig(data);
		void appLogger.info("config", "Auth config saved", { authCount: Object.keys(data ?? {}).length });
		return result;
	});
	ipcMain.handle(ipcChannels.configSaveSettings, async (_event, settings) => {
		const result = await configManager.saveSettingsConfig(settings);
		void appLogger.info("config", "Pi settings config saved", { keys: Object.keys(settings ?? {}) });
		return result;
	});
	ipcMain.handle(ipcChannels.configSaveRaw, async (_event, fileName, rawJson) => {
		const result = await configManager.saveRawConfig(fileName, rawJson);
		void appLogger.info("config", "Raw config saved", { fileName, bytes: Buffer.byteLength(rawJson, "utf8") });
		return result;
	});
	ipcMain.handle(ipcChannels.configExport, () =>
		configManager.exportConfig(),
	);
	ipcMain.handle(ipcChannels.configImport, async (_event, packageJson: string) => {
		const result = await configManager.importConfig(packageJson);
		void appLogger.info("config", "Config imported", { bytes: Buffer.byteLength(packageJson, "utf8"), valid: result.valid });
		return result;
	});
	// 远程拉取 provider 模型列表
	ipcMain.handle(
		ipcChannels.configFetchModels,
		async (
			_event,
			payload: { baseUrl: string; apiKey: string; apiType?: string },
		) => {
			const result = await configManager.fetchProviderModels(
				payload.baseUrl,
				payload.apiKey,
				payload.apiType,
			);
			void appLogger.info("config", "Provider models fetched", {
				baseUrl: payload.baseUrl,
				apiType: payload.apiType,
				modelCount: Array.isArray(result) ? result.length : undefined,
			});
			return result;
		},
	);
	// 快速测试 provider 连接
	ipcMain.handle(
		ipcChannels.configTestProvider,
		async (
			_event,
			payload: {
				baseUrl: string;
				apiKey: string;
				modelId: string;
				apiType?: string;
				headers?: Record<string, string>;
			},
		) => {
			const result = await configManager.testProviderConnection(
				payload.baseUrl,
				payload.apiKey,
				payload.modelId,
				payload.apiType,
				payload.headers,
			);
			void appLogger.info("config", "Provider connection tested", {
				baseUrl: payload.baseUrl,
				apiType: payload.apiType,
				modelId: payload.modelId,
				success: result.success,
				error: result.error,
			});
			return result;
		},
	);

	// 切换开发者控制台
	ipcMain.handle(ipcChannels.appToggleDevTools, () => {
		if (!mainWindow || mainWindow.isDestroyed()) return false;
		if (mainWindow.webContents.isDevToolsOpened()) {
			mainWindow.webContents.closeDevTools();
			return false;
		}
		mainWindow.webContents.openDevTools({ mode: "detach" });
		return true;
	});
}

function sendTelemetryHeartbeat() {
	const telemetry = new TelemetryService({
		settingsStore,
		config: {
			projectKey: POSTHOG_PROJECT_KEY,
			host: POSTHOG_HOST,
		},
		metadata: {
			appVersion: app.getVersion(),
			platform: process.platform,
			arch: process.arch,
			packaged: app.isPackaged,
		},
		capture: async (request) => {
			const response = await net.fetch(request.url, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(request.body),
			});
			if (!response.ok) {
				throw new Error(`Telemetry request failed: ${response.status}`);
			}
		},
	});

	void telemetry.sendHeartbeat().catch(() => undefined);
}

async function detectExternalEditorsOnFirstLaunch() {
	const current = settingsStore.get().externalEditors;
	if (Object.values(current).some((editor) => editor.command)) return;
	const detected = await detectExternalEditors();
	if (detected.length === 0) return;
	await settingsStore.update({
		externalEditors: mergeDetectedExternalEditors(current, detected),
	});
	void appLogger.info("editor", "External editors detected on first launch", { count: detected.length });
}

app.whenReady().then(async () => {
	projectStore = new ProjectStore(() => mainCopy("dialog.chooseProjectFolder"));
	fileSystemService = new FileSystemService();
	sessionScanner = new SessionScanner(mainCopy);
	codexSessionImporter = new CodexSessionImporter(mainCopy);
	claudeSessionImporter = new ClaudeSessionImporter(mainCopy);
	openCodeSessionImporter = new OpenCodeSessionImporter(mainCopy);
	settingsStore = new SettingsStore();
	appLogger = new AppLogger();
	rpcLogger = new RpcLogger();
	gitService = new GitService();
	worktreeService = new WorktreeService(mainCopy);
	piLocator = new PiLocator(mainCopy);
	configManager = new ConfigManager(undefined, mainCopy);
	promptManager = new PromptManager(undefined, mainCopy);
	xuePromptManager = new XuePromptManager();
	skillManager = new SkillManager(undefined, mainCopy);
	extensionManager = new ExtensionManager(piLocator, () => settingsStore.get(), mainCopy);
	projectResourceManager = new ProjectResourceManager(
		(projectId) => projectStore.get(projectId),
		mainCopy,
	);
	agentManager = new AgentManager(
		(id) => projectStore.get(id),
		() => mainWindow,
		settingsStore,
		configManager,
		rpcLogger,
		appLogger,
		undefined,
		mainCopy,
	);
	webServiceManager = new WebServiceManager({
		listProjects: () => projectStore.list(),
		listSessions: (projectId) => {
			const project = projectStore.get(projectId);
			return sessionScanner.list(project?.path);
		},
		getSessionRuntimeMessages: (sessionId) =>
			sessionRuntimeCoordinator.getRuntimeMessages(sessionId),
		listCatalogSessions: async (projectId) => {
			if (!projectId) {
				return sessionCatalog.listEntries()
					.map((entry) => sessionCatalog.getRecord(entry.id))
					.filter((record): record is SessionRecord => Boolean(record));
			}
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
		createSessionDraft: async (input) => {
			const project = projectStore.get(input.projectId);
			if (!project) throw new Error(mainCopy("project.notFound"));
			return sessionCatalog.createDraft({
				projectId: input.projectId,
				title: input.title?.trim() || mainCopy("session.newTitle"),
				environment: settingsStore.get().wslEnabled ? "wsl" : "native",
				model: input.model,
				thinkingLevel: input.thinkingLevel,
			});
		},
		updateSessionRecord: async (sessionId, patch) => {
			const entry = sessionCatalog.get(sessionId);
			if (!entry) throw new Error(mainCopy("session.notFound"));
			const title = patch.title?.trim();
			if (title && title !== entry.title) {
				const target = sessionRuntimeCoordinator.getTarget(sessionId);
				if (target) {
					const renamed = await sessionRuntimeCoordinator.renameRuntime(target, title);
					if (!renamed.ok) throw sessionCommandIpcError(renamed.error);
				} else if (entry.filePath) {
					await sessionScanner.rename(entry.filePath, title);
				}
			}
			return sessionCatalog.update(sessionId, {
				...patch,
				title: title || undefined,
			});
		},
		deleteSessionRecord: async (sessionId) => {
			const entry = sessionCatalog.get(sessionId);
			if (!entry) return false;
			if (sessionRuntimeCoordinator.getTarget(sessionId)) {
				throw new Error(mainCopy("session.stopBeforeDelete"));
			}
			if (entry.filePath) await sessionScanner.delete(entry.filePath);
			await sessionCatalog.remove(sessionId);
			return true;
		},
		copySessionRecord: (sessionId) => copyCatalogSession(sessionId),
		exportSessionRecordHtml: (sessionId) => exportCatalogSessionHtml(sessionId),
		readSessionReferenceMessages: (sessionId) =>
			readCatalogSessionReferenceMessages(sessionId),
		readSessionMessages: async (sessionId) => {
			const entry = sessionCatalog.get(sessionId);
			if (!entry?.filePath) return [];
			const content = await sessionScanner.readSessionRawText(entry.filePath);
			return agentManager.readSessionDisplayMessages(entry.filePath, sessionId, content);
		},
		readSessionMessagePage: async (sessionId, before, pageSize) => {
			const entry = sessionCatalog.get(sessionId);
			if (!entry?.filePath) return { messages: [], total: 0, nextBefore: null };
			return agentManager.readSessionDisplayMessagePage(entry.filePath, sessionId, before, pageSize);
		},
		sendSessionPrompt: async (input) => {
			const result = await sessionRuntimeCoordinator.send(input);
			if (result.agentId) {
				const tab = agentManager.list().find((candidate) => candidate.id === result.agentId);
				if (tab) emitSessionRuntimeEvent(tab.id, ipcChannels.agentsState, tab);
			}
			return result;
		},
		listSessionRuntimes: () => sessionRuntimeCoordinator.listRuntimes(),
		stopSessionRuntime: async (target) => {
			const result = await sessionRuntimeCoordinator.stopRuntime(target);
			if (result.ok) {
				terminalManager.closeAgent(target.agentId);
				emitSessionRuntimeDetach(target);
			}
			return result;
		},
		abortSessionRuntime: (target) => sessionRuntimeCoordinator.abortRuntime(target),
		restartSessionRuntime: async (target) => {
			terminalManager.closeAgent(target.agentId);
			const result = await sessionRuntimeCoordinator.restartRuntime(target);
			if (result.ok) {
				emitSessionRuntimeDetach(target);
				emitReplacementState(result.value.runtime, false);
			}
			return result;
		},
		compactSessionRuntime: (target, prompt) =>
			sessionRuntimeCoordinator.compactRuntime(target, prompt),
		getSessionRuntimeState: (target) =>
			sessionRuntimeCoordinator.getRuntimeState(target),
		listSessionRuntimeCommands: (target) =>
			sessionRuntimeCoordinator.listRuntimeCommands(target),
		exportSessionRuntimeHtml: (target) =>
			sessionRuntimeCoordinator.exportRuntimeHtml(target),
		editSessionRuntimeMessage: (target, messageId, newText) =>
			sessionRuntimeCoordinator.editRuntimeMessage(target, messageId, newText),
		deleteSessionRuntimeMessage: (target, messageId) =>
			sessionRuntimeCoordinator.deleteRuntimeMessage(target, messageId),
		prepareSessionRuntimeResend: (target, messageId) =>
			sessionRuntimeCoordinator.prepareRuntimeResend(target, messageId),
		setSessionRuntimeModel: (target, provider, modelId) =>
			sessionRuntimeCoordinator.setRuntimeModel(target, provider, modelId),
		setSessionRuntimeThinking: (target, level) =>
			sessionRuntimeCoordinator.setRuntimeThinking(target, level),
		cloneSessionRuntime: async (target) => {
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
	});
	terminalManager = new TerminalSessionManager(
		(agentId) => agentManager.getCwd(agentId),
		(channel, payload) => mainWindow?.webContents.send(channel, payload),
	);

	await settingsStore.load();
	setFeishuConfigDefaultBotName(feishuT(currentFeishuLocale(), "bridge.defaultBotName"));
	const initialSessionSettings = settingsStore.get();
	sessionCatalog = new SessionCatalog(
		join(app.getPath("userData"), "session-catalog.json"),
		initialSessionSettings.wslEnabled
			? { wslDistro: initialSessionSettings.wslDistro, wslUser: initialSessionSettings.wslUser }
			: {},
	);
	await sessionCatalog.load();
	sessionRuntimeCoordinator = new SessionRuntimeCoordinator(
		sessionCatalog,
		agentManager,
		sendAgentPromptWithIntegrations,
	);
	agentManager.onOutput((sourceChannel, payload) => {
		if (sourceChannel === ipcChannels.agentsState && Array.isArray(payload)) {
			for (const tab of payload) {
				if (tab && typeof tab === "object" && typeof tab.id === "string") {
					emitSessionRuntimeEvent(tab.id, sourceChannel, tab);
				}
			}
			return;
		}
		if (payload && typeof payload === "object" && "agentId" in payload) {
			const agentId = (payload as { agentId?: unknown }).agentId;
			if (typeof agentId !== "string") return;
			const forwarded = emitSessionRuntimeEvent(agentId, sourceChannel, payload);
			if (!forwarded && sourceChannel === ipcChannels.agentsUiRequest) {
				cancelUnboundUiRequest(payload);
			}
		}
	});

	// 根据已加载的 WSL 设置配置会话扫描器，使其能同时扫描 WSL 中的 pi 会话目录
	const syncWslConfig = async () => {
		const { wslEnabled, wslDistro, wslUser } = settingsStore.get();
		if (wslEnabled && wslDistro && wslUser) {
			const { resolveWslEnvironment: resolveWsl2 } = await import("./wsl/WslEnvironment");
			const wslEnv = await resolveWsl2(wslDistro, wslUser, {
				warn: (msg: string, detail: unknown) => console.warn("[PiDeck] " + String(msg), detail),
			});
			await sessionScanner.configureWsl(wslEnv);
			skillManager.configureWsl(wslEnv);
			promptManager.configureWsl(wslEnv);
			extensionManager.configureWsl(wslEnv);
			if (configManager) configManager.configureWsl(wslEnv);
			if (xuePromptManager) xuePromptManager.configureWsl(wslEnv);
		} else {
			sessionScanner.clearWsl();
			skillManager.configureWsl(null);
			promptManager.configureWsl(null);
			extensionManager.configureWsl(null);
			if (configManager) configManager.configureWsl(null);
			if (xuePromptManager) xuePromptManager.configureWsl(null);
		}
	};
	await syncWslConfig();

	// 自动部署 PiDeck 内置扩展：这些扩展提供桌面端差异预览、提问卡片和 Plan Mode。
	// Windows 和 WSL 环境各自部署一份，保证切换 pi 来源后扩展仍然可用。
	const deployExtensionsTo = async (homeDir: string) => {
		const extDisabledPath = join(homeDir, ".pi", "agent", "settings.json");
		const disabledExtList: string[] = await readFile(extDisabledPath, "utf-8")
			.then((raw: string) => JSON.parse(raw).disabledExtensions ?? [])
			.catch(() => [] as string[]);
		const disabledBuiltIn = new Set<string>(disabledExtList);
		for (const extensionName of ["pi-deck-ask-question.ts", "pi-deck-nul-redirect-fix.ts", "pi-deck-plan-mode.ts", "pi-deck-todo.ts"]) {
			if (disabledBuiltIn.has(extensionName)) continue;
			await ensurePiDeckExtension(extensionName, homeDir).catch((error) => {
				console.error(`Failed to install ${extensionName}:`, error);
			});
		}
	};
	// 始终部署到 Windows 本地 home
	await deployExtensionsTo(app.getPath("home"));
	// WSL 启用时额外部署到 WSL 目录（通过 \\wsl$ UNC）
	const wslSettings = settingsStore.get();
	if (wslSettings.wslEnabled && wslSettings.wslDistro && wslSettings.wslUser) {
		const wslUncHome = `\\\\wsl$\\${wslSettings.wslDistro}\\home\\${wslSettings.wslUser}`;
		await deployExtensionsTo(wslUncHome).catch(() => {
			console.warn('[PiDeck] Failed to deploy extensions to WSL, skipping');
		});
	}

	// 补齐 pi settings.json 缺失的默认配置项，新安装或精简配置的用户无需手动添加。
	await ensureAllPiSettingsDefaults().catch((error) => {
		console.error("Failed to ensure pi settings defaults:", error);
	});

	// 清理已废弃的 pi-deck-project-trust 扩展：RPC 模式下 pi 的 project_trust 事件 hasUI 恒为 false，
	// 该扩展无法弹窗，信任确认改由桌面端 AgentManager.ensureProjectTrust 自行处理，删除残留避免用户误解。
	await removeStalePiDeckExtension("pi-deck-project-trust.ts").catch((error) => {
		console.error("Failed to remove stale pi-deck-project-trust extension:", error);
	});

	// 清理已废弃的 pi-deck-file-capture 扩展：该扩展的功能已被 renderer 端的直接工具参数解析取代。
	await removeStalePiDeckExtension("pi-deck-file-capture.ts").catch((error) => {
		console.error("Failed to remove stale pi-deck-file-capture extension:", error);
	});

	await appLogger.info("app", "Application started", {
		version: app.getVersion(),
		platform: process.platform,
		arch: process.arch,
		installationType: settingsStore.get().installationType,
	});
	await applyDesktopProxy(settingsStore.get());
	await webServiceManager.applySettings(settingsStore.get()).catch((error) => {
		console.error("Failed to start web service:", error);
		void settingsStore.update({ webServiceEnabled: false });
	});
	registerIpc();
	registerFeishuIpc();

	// 🆕 自动连接：如果已有 Bot 配置，自动启动飞书连接
	autoConnectFeishu();

	sendTelemetryHeartbeat();
	await createWindow();
	setupTray();
	void detectExternalEditorsOnFirstLaunch().catch((error) => {
		void appLogger.warn("editor", "External editor first launch detection failed", error);
	});

	// 桌面宠物系统：新增模块，默认关闭（petEnabled=false），不触碰现有 IPC 与主窗逻辑
	petSystem = new PetSystem({
		agentManager,
		settingsStore,
		getMainWindow: () => mainWindow,
		resolveSessionId: (agentId) => sessionRuntimeCoordinator.getSessionId(agentId),
		translate: (key, params) => mainCopy(key, params),
		recreateMainWindow: async () => {
			await createWindow();
			return mainWindow!;
		},
	});
	void petSystem.start().catch((error) => {
		void appLogger.warn("pet", "Pet system start failed", error);
	});

	// 项目列表可能位于杀软/同步盘较慢的 userData；窗口先显示，随后异步加载，避免 packaged app 打开时白屏等待。
	void projectStore
		.load()
		.then(() => {
			const s = settingsStore.get();
			const visible = s.wslEnabled
				? projectStore.list().filter((p) => p.kind === "chat" || p.environment === "wsl")
				: projectStore.list().filter((p) => p.kind === "chat" || !p.environment || p.environment === "windows");
			mainWindow?.webContents.send("projects:changed", visible);
		})
		.catch(() => undefined);

	// 启动后异步检查 RPC 超时时间，如果小于 600 秒则自动修正为 600 秒
	// 避免用户配置的过小超时（如 30 秒）导致启动或命令执行频繁超时
	setTimeout(() => {
		void settingsStore.ensureRpcTimeoutMinimum().catch((error) => {
			void appLogger.warn("settings", "Failed to ensure rpcTimeout minimum", error);
		});
	}, 0);

	// macOS dock 点击或任务栏点击时恢复窗口
	app.on("activate", () => {
		if (mainWindow) {
			mainWindow.show();
			mainWindow.focus();
		} else {
			void createWindow().catch((error) => {
				void appLogger.error("app", "Failed to create window on activate", error);
			});
		}
	});
});

/**
 * 将 PiDeck 内置的 pi 扩展部署到用户扩展目录，使 pi 自动加载。
 * 仅在目标文件不存在或内容不一致时覆盖写入，避免不必要的磁盘操作。
 */
async function ensurePiDeckExtension(extensionName: string, wslHome?: string): Promise<void> {
	const home = wslHome ?? app.getPath("home");
	const extensionsDir = join(home, ".pi", "agent", "extensions");
	const targetPath = join(extensionsDir, extensionName);

	// 获取源文件路径：开发模式下在 resources/ 目录，打包后通过 process.resourcesPath 访问
	const sourcePath = is.dev
		? join(app.getAppPath(), "resources", "extensions", extensionName)
		: join(process.resourcesPath, "extensions", extensionName);

	// 检查源文件是否存在
	const sourceContent = await readFile(sourcePath, "utf-8").catch(() => null);
	if (!sourceContent) {
		console.warn(`[PiDeck] Extension source not found: ${sourcePath}`);
		return;
	}

	// 读取目标文件，只在内容不一致时覆盖（兼顾首次安装和版本更新）
	const existingContent = await readFile(targetPath, "utf-8").catch(() => null);
	if (existingContent === sourceContent) return;

	await mkdir(extensionsDir, { recursive: true });
	await writeFile(targetPath, sourceContent, "utf-8");
	console.log(`[PiDeck] Installed extension: ${targetPath}`);
}

/**
 * 删除已下线的 PiDeck 内置扩展残留文件（如 pi-deck-project-trust.ts）。
 * 用于扩展废弃后清理用户扩展目录，避免 pi 仍加载无效扩展造成误解。
 * rm 的 force 选项会在文件不存在时静默忽略。
 */
async function removeStalePiDeckExtension(extensionName: string): Promise<void> {
	const targetPath = join(app.getPath("home"), ".pi", "agent", "extensions", extensionName);
	await rm(targetPath, { force: true });
	console.log(`[PiDeck] Removed stale extension: ${targetPath}`);
}

/**
 * 补齐 pi 全局 settings.json 的推荐默认项。
 * 仅添加缺失的 key，不覆盖用户已有配置。
 * 适用于新安装 pi 或配置精简的用户。
 */
/** 补齐指定 configDir 下 settings.json 的缺失默认项 */
async function ensurePiSettingsDefaults(configDir: string, piVersionHint?: string): Promise<void> {
	const filePath = join(configDir, "settings.json");
	let current: Record<string, unknown> = {};
	try {
		const raw = await readFile(filePath, "utf8");
		current = JSON.parse(raw) as Record<string, unknown>;
	} catch { /* 文件不存在或解析失败，使用空对象 */ }

	let changed = false;
	const defaults: Record<string, unknown> = {
		theme: "dark",
		hideThinkingBlock: false,
		defaultProjectTrust: "ask",
		compaction: { enabled: true, reserveTokens: 16384, keepRecentTokens: 20000 },
		retry: { enabled: true, maxRetries: 3 },
	};

	if (piVersionHint && !current.lastChangelogVersion) {
		current.lastChangelogVersion = piVersionHint;
		changed = true;
	}

	for (const [key, defaultValue] of Object.entries(defaults)) {
		if (!(key in current)) {
			current[key] = defaultValue;
			changed = true;
		}
	}

	if (changed) {
		await mkdir(configDir, { recursive: true });
		await writeFile(filePath, JSON.stringify(current, null, 2), "utf8");
		console.log('[PiDeck] Ensured pi settings defaults at:', filePath);
	}
}

/** 对当前环境和 WSL 环境（如果启用）都补齐 settings.json 默认项 */
async function ensureAllPiSettingsDefaults(): Promise<void> {
	const s = settingsStore.get();
	let piVersion = "";
	if (piLocator) {
		piVersion = (await piLocator.check(undefined, s.wslEnabled, s.wslDistro, s.wslUser).catch(() => null))?.version ?? "";
	}

	// Windows 本地
	const winDir = join(app.getPath("home"), ".pi", "agent");
	await ensurePiSettingsDefaults(winDir, piVersion).catch(() => {});

	// WSL（如果已配置）
	if (s.wslEnabled && s.wslDistro && s.wslUser) {
		const wslDir = join(`\\\\wsl$\\${s.wslDistro}\\home\\${s.wslUser}`, ".pi", "agent");
		await ensurePiSettingsDefaults(wslDir, piVersion).catch(() => {});
	}
}

app.on("before-quit", () => {
	isQuitting = true;
	tray?.destroy();
	tray = null;
	void webServiceManager?.stop();
	terminalManager?.closeAll();
	agentManager?.stopAll();
	petSystem?.stop();
	petSystem = null;
});

app.on("window-all-closed", () => {
	// macOS 关闭所有窗口不退出；其他平台如果启用 closeToTray 也不退出
	if (process.platform === "darwin") return;
	if (!isQuitting) return;
	app.quit();
});
