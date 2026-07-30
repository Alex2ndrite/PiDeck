import type { PiSkillSummary } from "./skills";

// ── Pi / NPM / Config ──────────────────────────────────────────────────

export type PiCommand = {
	name: string;
	description?: string;
	source?: string;
};

export type PiInstallStatus = {
	installed: boolean;
	command?: string;
	version?: string;
	searchedDirs: string[];
	error?: string;
};

/** 安装命令执行结果 */
export type PiInstallExecResult = {
	success: boolean;
	exitCode: number | null;
	stdout: string;
	stderr: string;
};

/** npm 可用性检测结果 */
export type NpmAvailabilityResult = {
	available: boolean;
	version?: string;
	error?: string;
};

export type ConfigFileDiagnostic = {
	fileName: string;
	message: string;
	line?: number;
	column?: number;
	snippet?: string;
	docsUrl: string;
};

export type ConfigFileReadResult<T> = {
	raw: string;
	parsed: T;
	diagnostic?: ConfigFileDiagnostic;
};

// ── Project Resources / Extensions ─────────────────────────────────────

export type ProjectResourceListResult = {
	skills: PiSkillSummary[];
	extensions: PiExtensionSummary[];
};

export type CreateProjectSkillInput = {
	projectId: string;
	name: string;
	description: string;
};

export type PiExtensionSummary = {
	id: string;
	source: string;
	path?: string;
	/** 非 npm/git 安装的本地文件扩展，通过文件系统自动发现 */
	scope: "user" | "project" | "unknown";
	/** PiDeck 内置扩展，不可卸载 */
	builtIn?: boolean;
	/** 是否启用（未在 disabledExtensions 列表中） */
	enabled?: boolean;
	currentVersion?: string;
	latestVersion?: string;
	hasUpdate?: boolean;
	updateError?: string;
};

export type PiPackageInfo = {
	name: string;
	description: string;
	installCmd: string;
	tags: string[];
	downloads: string;
	updated: string;
	npmUrl: string;
	repoUrl?: string;
	/** pi.dev 详情页的 name 查询参数；部分包名和扩展展示名不完全一致。 */
	piPackageName?: string;
};

export type PiExtensionListResult = {
	extensions: PiExtensionSummary[];
	raw: string;
};

export type PiCliUpdateResult = {
	command: string;
	output: string;
	updated: boolean;
};

export type PiUpdateCheckResult = {
	currentVersion?: string;
	latestVersion?: string;
	hasUpdate: boolean;
	error?: string;
};

export type PiProxyTestResult = {
	success: boolean;
	url: string;
	elapsedMs: number;
	statusCode?: number;
	message?: string;
	error?: string;
	bypassed?: boolean;
};

// ── App Info / Updates / Logging ───────────────────────────────────────

export type AppInfo = {
	version: string;
	releasesUrl: string;
	/** 当前运行平台：win32 / darwin / linux，用于 UI 中按平台条件渲染（如 WSL 选项仅在 Windows 显示） */
	platform: NodeJS.Platform;
};

export type FeedbackEnvironment = {
	appVersion: string;
	platform: NodeJS.Platform;
	arch: string;
	electronVersion: string;
	chromeVersion: string;
	nodeVersion: string;
	pi: PiInstallStatus;
};

export type AppUpdateAsset = {
	name: string;
	url: string;
	size: number;
};

export type AppUpdateInfo = {
	currentVersion: string;
	latestVersion: string;
	hasUpdate: boolean;
	releaseName: string;
	releaseNotes: string;
	releaseUrl: string;
	publishedAt?: string;
	assets: AppUpdateAsset[];
	recommendedAsset?: AppUpdateAsset;
};

export type AppUpdateDownloadProgress = {
	assetName: string;
	receivedBytes: number;
	totalBytes?: number;
	percent?: number;
	bytesPerSecond?: number;
	state: "downloading" | "completed" | "failed";
	filePath?: string;
	error?: string;
};

export type AppUpdateDownloadResult = {
	filePath: string;
	assetName: string;
};

export type AppLogLevel = "debug" | "info" | "warn" | "error";

export type AppLogEntry = {
	id: string;
	time: number;
	level: AppLogLevel;
	scope: string;
	message: string;
	detail?: unknown;
};

export type AppLogQuery = {
	level?: AppLogLevel | "all";
	search?: string;
	from?: number;
	to?: number;
	limit?: number;
};

export type PiRuntimeEvent = {
	agentId: string;
	event: unknown;
};
