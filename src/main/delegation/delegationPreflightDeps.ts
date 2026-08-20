import { stat } from "node:fs/promises";
import type { AvailableModel, Project } from "../../shared/types";
import type { DelegationPreflightDeps } from "./delegationPreflight";

/** pi 可执行性检查每次都会 fork `pi --version`；对话框里反复预检时用短 TTL 复用结果。 */
const PI_CHECK_TTL_MS = 30_000;

type PiInstallProbe = {
	check(
		customPath?: string,
		wslEnabled?: boolean,
		wslDistro?: string,
		wslUser?: string,
	): Promise<{ installed: boolean; version?: string; error?: string }>;
};

type ConfigProbe = {
	getAuthConfig(): Promise<{ parsed: Record<string, unknown> }>;
	getModelsConfig(): Promise<{ parsed: { providers?: Record<string, { apiKey?: unknown }> } }>;
};

export type DelegationPreflightDepsOptions = {
	getProject: (projectId: string) => Project | undefined;
	getSettings: () => {
		customPiPath?: string;
		wslEnabled?: boolean;
		wslDistro?: string;
		wslUser?: string;
	};
	piLocator: PiInstallProbe;
	configManager: ConfigProbe;
	isGitRepo: (path: string) => Promise<boolean>;
	listModels: () => Promise<AvailableModel[]>;
};

/**
 * 把既有主进程服务适配成 Delegation 预检依赖。
 *
 * 放在 delegation 域而不是 main/index.ts：装配层只做依赖注入，
 * 「凭据从哪几个文件读」「pi 检查缓存多久」这类规则属于本域行为。
 */
export function createDelegationPreflightDeps(
	options: DelegationPreflightDepsOptions,
): DelegationPreflightDeps {
	let piCheckCache: { at: number; value: { installed: boolean; version?: string; error?: string } } | undefined;
	return {
		resolveProject: (projectId) => options.getProject(projectId),
		directoryExists: async (path) => {
			try {
				return (await stat(path)).isDirectory();
			} catch {
				return false;
			}
		},
		checkPiInstalled: async () => {
			const now = Date.now();
			if (piCheckCache && now - piCheckCache.at < PI_CHECK_TTL_MS) return piCheckCache.value;
			const settings = options.getSettings();
			const status = await options.piLocator.check(
				settings.customPiPath,
				settings.wslEnabled,
				settings.wslDistro,
				settings.wslUser,
			);
			const value = { installed: status.installed, version: status.version, error: status.error };
			piCheckCache = { at: now, value };
			return value;
		},
		listAvailableModels: () => options.listModels(),
		listAuthenticatedProviders: async () => {
			// pi 的凭据可能在 auth.json（API key / OAuth），也可能是 models.json 里 provider 自带 apiKey；
			// 两处都不命中只作为 warn，因为环境变量与本地免鉴权 provider 仍可用。
			const [auth, models] = await Promise.all([
				options.configManager.getAuthConfig(),
				options.configManager.getModelsConfig(),
			]);
			const providers = new Set<string>(Object.keys(auth.parsed ?? {}));
			for (const [name, provider] of Object.entries(models.parsed?.providers ?? {})) {
				if (typeof provider?.apiKey === "string" && provider.apiKey.trim()) providers.add(name);
			}
			return [...providers];
		},
		isGitRepository: (path) => options.isGitRepo(path),
	};
}
