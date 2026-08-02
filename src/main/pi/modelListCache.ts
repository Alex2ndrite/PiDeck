/**
 * pi --list-models 全局缓存模块。
 *
 * 数据源：pi --list-models（pi 内部处理 auth.json/models.json/内置目录，输出「可用模型」）。
 * 加速参数：--offline --no-extensions --no-skills --no-themes（实测 2s → ~1.1s，输出一致）。
 *
 * 刷新策略：
 * - 启动时异步预加载（应用 ready 后后台 fork 一次）；
 * - 界面保存 models.json/auth.json 后失效并后台重取；
 * - 每次启动 Agent 时强制重取（防用户直接改文件不生效）。
 */

import type { AvailableModel } from "../../shared/types";
import type { PiLocator } from "./PiLocator";
import type { SettingsStore } from "../settings/SettingsStore";

/** 全局缓存：模型列表（null = 未加载/已失效） */
let cachedListModels: AvailableModel[] | null = null;
/** 在途请求去重：并发调用只 fork 一次 */
let cachedListModelsPending: Promise<AvailableModel[]> | null = null;

/** pi --list-models 加速参数：offline 跳过网络目录刷新，no-ext/skills/themes 跳过发现加载。 */
export const MODEL_LIST_FAST_ARGS = [
	"--list-models",
	"--offline",
	"--no-extensions",
	"--no-skills",
	"--no-themes",
];

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

/** fork pi --list-models 并解析（一次调用，带超时）。 */
async function runPiListModels(
	piLocator: PiLocator,
	settingsStore: SettingsStore,
): Promise<AvailableModel[]> {
	const settings = settingsStore.get();
	const command = piLocator.resolveCommand(
		settings.customPiPath,
		settings.wslEnabled,
		settings.wslDistro,
		settings.wslUser,
	);
	const invocation = piLocator.createInvocation(command, MODEL_LIST_FAST_ARGS);
	const { execFile } = await import("node:child_process");
	const result = await new Promise<{ stdout: string }>((resolve, reject) => {
		execFile(invocation.command, invocation.args, {
			env: piLocator.createProcessEnv(settings, invocation.pathPrefix, invocation.wsl),
			shell: invocation.shell,
			windowsHide: true,
			timeout: 20_000,
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
	return parsePiListModels(result.stdout);
}

/**
 * 获取模型列表（读缓存；无缓存时 fork 一次并缓存）。
 * 返回的数组会被缓存复用，调用方不应修改。
 */
export function fetchModelList(
	piLocator: PiLocator,
	settingsStore: SettingsStore,
): Promise<AvailableModel[]> {
	if (cachedListModels) return Promise.resolve(cachedListModels);
	if (cachedListModelsPending) return cachedListModelsPending;

	cachedListModelsPending = runPiListModels(piLocator, settingsStore)
		.then((models) => {
			cachedListModels = models;
			return models;
		})
		.finally(() => {
			cachedListModelsPending = null;
		});
	return cachedListModelsPending;
}

/**
 * 强制刷新模型列表（绕过缓存）：配置变更 / 启动 Agent 时调用。
 * 并发去重：同一时刻只 fork 一次，返回最新结果。
 */
export function refreshModelList(
	piLocator: PiLocator,
	settingsStore: SettingsStore,
): Promise<AvailableModel[]> {
	if (cachedListModelsPending) return cachedListModelsPending;
	cachedListModelsPending = runPiListModels(piLocator, settingsStore)
		.then((models) => {
			cachedListModels = models;
			return models;
		})
		.finally(() => {
			cachedListModelsPending = null;
		});
	return cachedListModelsPending;
}

/** 清空模型列表缓存（配置变更后调用；后续 fetch 会重新 fork）。 */
export function invalidateModelListCache(): void {
	cachedListModels = null;
	// 在途请求让其自然完成并覆盖缓存；不主动中断
}

/** 获取当前缓存的模型列表（不触发新的 fork）。 */
export function getCachedModelList(): AvailableModel[] | null {
	return cachedListModels;
}
