/**
 * pi --list-models 全局缓存模块。
 * Phase 2.1: 从 index.ts 中提取，被 model IPC 和 config IPC 共享。
 * 首次调用 fork pi --list-models，之后直接读缓存。
 */

import type { AvailableModel } from "../../shared/types";
import type { PiLocator } from "./PiLocator";
import type { SettingsStore } from "../settings/SettingsStore";
import type { PiModelsFile } from "../config/ConfigManager";

/** 全局缓存：首次调用 fork pi --list-models，之后直接读缓存 */
let cachedListModels: AvailableModel[] | null = null;
let cachedListModelsPending: Promise<AvailableModel[]> | null = null;

/**
 * 把本地 models.json（嵌套 providers 结构）转换为 AvailableModel[]。
 * 相比 pi --list-models 表格解析，能保留 contextWindow/maxTokens/input 等完整字段。
 */
export function parsePiModelsFile(modelsFile: PiModelsFile | undefined): AvailableModel[] {
	const providers = modelsFile?.providers ?? {};
	const models: AvailableModel[] = [];
	for (const [provider, config] of Object.entries(providers)) {
		for (const model of config?.models ?? []) {
			models.push({
				id: model.id,
				name: model.name ?? `${provider}/${model.id}`,
				provider,
				contextWindow: model.contextWindow,
				reasoning: model.reasoning,
			});
		}
	}
	return models;
}

/**
 * 解析 pi --list-models 的文本表格输出。
 * 表格格式：provider  model  context  max-out  thinking  images
 */
export function parsePiListModels(stdout: string): AvailableModel[] {
	const lines = stdout.split(/\r?\n/).filter(Boolean);
	if (lines.length < 2) return [];
	// 跳过表头
	const dataLines = lines.slice(1);
	const models: AvailableModel[] = [];
	for (const line of dataLines) {
		const parts = line.trim().split(/\s+/);
		if (parts.length < 3) continue;
		const provider = parts[0];
		const modelId = parts[1];
		// thinking 和 images 在倒数第二列和最后一列
		const thinking = parts[parts.length - 2]?.toLowerCase() === "yes";
		models.push({
			provider,
			id: modelId,
			name: `${provider}/${modelId}`,
			reasoning: thinking,
		});
	}
	return models;
}

/**
 * 执行一次模型列表获取：
 * - 优先使用本地 models.json（modelsFromConfig 提供，实时且字段完整）；
 * - models.json 缺失/解析失败/未提供时，回退 fork pi --list-models。
 * 已有缓存或在途请求时不会重复执行。
 */
export function fetchModelList(
	piLocator: PiLocator,
	settingsStore: SettingsStore,
	modelsFromConfig?: () => Promise<PiModelsFile | undefined>,
): Promise<AvailableModel[]> {
	if (cachedListModels) return Promise.resolve(cachedListModels);
	if (cachedListModelsPending) return cachedListModelsPending;

	cachedListModelsPending = (async () => {
		// 优先本地 models.json：实时反映用户编辑，字段更完整，且不依赖 fork 子进程。
		if (modelsFromConfig) {
			const parsed = await modelsFromConfig().catch(() => undefined);
			const fromConfig = parsePiModelsFile(parsed);
			if (fromConfig.length > 0) {
				cachedListModels = fromConfig;
				return fromConfig;
			}
			// models.json 为空时继续尝试 --list-models（可能是纯 builtin provider 场景）
		}

		const settings = settingsStore.get();
		const command = piLocator.resolveCommand(
			settings.customPiPath,
			settings.wslEnabled,
			settings.wslDistro,
			settings.wslUser,
		);
		const invocation = piLocator.createInvocation(command, ["--list-models"]);
		const { execFile } = await import("node:child_process");
		const result = await new Promise<{ stdout: string }>((resolve, reject) => {
			execFile(invocation.command, invocation.args, {
				env: piLocator.createProcessEnv(settings, invocation.pathPrefix, invocation.wsl),
				shell: invocation.shell,
				windowsHide: true,
				timeout: 15_000,
				encoding: "utf8",
				windowsVerbatimArguments: invocation.windowsVerbatimArguments,
			}, (error, stdout, stderr) => {
				if (error) {
					const message = (stderr || error.message).slice(0, 300);
					reject(new Error(message));
				} else {
					resolve({ stdout });
				}
			});
		});
		const models = parsePiListModels(result.stdout);
		cachedListModels = models;
		return models;
	})();

	return cachedListModelsPending;
}

/** 清空模型列表缓存（配置变更后调用）。 */
export function invalidateModelListCache(): void {
	cachedListModels = null;
	cachedListModelsPending = null;
}

/** 获取当前缓存的模型列表（不触发新的 fork）。 */
export function getCachedModelList(): AvailableModel[] | null {
	return cachedListModels;
}
