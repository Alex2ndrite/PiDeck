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
 * context/max-out 为人类可读 token 数（如 1M / 65.5K / 272K），解析为数字；
 * thinking/images 为 yes/no。从右往左取后 4 列，避免 provider/model 列含空格时错位。
 */
export function parsePiListModels(stdout: string): AvailableModel[] {
	const lines = stdout.split(/\r?\n/).filter(Boolean);
	if (lines.length < 2) return [];
	// 跳过表头
	const dataLines = lines.slice(1);
	const models: AvailableModel[] = [];
	for (const line of dataLines) {
		const parts = line.trim().split(/\s+/).filter(Boolean);
		if (parts.length < 3) continue;
		if (parts.length >= 6) {
			// 完整 6 列表格：后 4 列固定为 context/max-out/thinking/images
			const tail = parts.slice(-4);
			const provider = parts[0];
			const modelId = parts[1];
			models.push({
				provider,
				id: modelId,
				name: `${provider}/${modelId}`,
				contextWindow: parseTokenSize(tail[0] ?? ""),
				maxTokens: parseTokenSize(tail[1] ?? ""),
				reasoning: tail[2]?.toLowerCase() === "yes",
				images: tail[3]?.toLowerCase() === "yes",
			});
		} else {
			// 兼容旧格式（provider/model/thinking），仅解析可确认字段
			models.push({
				provider: parts[0],
				id: parts[1],
				name: `${parts[0]}/${parts[1]}`,
				reasoning: parts[parts.length - 1]?.toLowerCase() === "yes",
			});
		}
	}
	return models;
}

/** 解析 pi 表格里的 token 数："1M"→1048576，"65.5K"→67109，"200K"→204800；解析失败返回 undefined。 */
export function parseTokenSize(value: string): number | undefined {
	const trimmed = value.trim();
	if (!trimmed) return undefined;
	const match = /^([\d.]+)([KkMm])?$/.exec(trimmed);
	if (!match) return undefined;
	const num = Number(match[1]);
	if (!Number.isFinite(num) || num <= 0) return undefined;
	const unit = match[2]?.toLowerCase();
	if (unit === "k") return Math.round(num * 1024);
	if (unit === "m") return Math.round(num * 1024 * 1024);
	return Math.round(num);
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
 * 获取模型列表（读缓存；无缓存时 fork 一次）。
 * 关键：空结果不写缓存——启动早期 pi 可能尚未就绪导致 fork 返回空，
 * 若把空数组缓存下来会永久显示「没有匹配的模型」。
 * 首次 fork 返回空时自动重试一次（间隔 500ms），覆盖 pi 冷启动慢的场景。
 * 返回的数组由调用方消费，不应修改。
 */
export function fetchModelList(
	piLocator: PiLocator,
	settingsStore: SettingsStore,
): Promise<AvailableModel[]> {
	if (cachedListModels) return Promise.resolve(cachedListModels);
	if (cachedListModelsPending) return cachedListModelsPending;

	cachedListModelsPending = runPiListModels(piLocator, settingsStore)
		.then(async (models) => {
			// 空结果重试一次：启动早期 pi 冷启动/环境未就绪时可能返回空表头。
			if (models.length === 0) {
				await new Promise((resolve) => setTimeout(resolve, 500));
				models = await runPiListModels(piLocator, settingsStore).catch(() => models);
			}
			// 仅非空结果入缓存；空结果（pi 未就绪/无可用模型）保持 null，下次重试。
			if (models.length > 0) cachedListModels = models;
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
		.then(async (models) => {
			if (models.length === 0) {
				await new Promise((resolve) => setTimeout(resolve, 500));
				models = await runPiListModels(piLocator, settingsStore).catch(() => models);
			}
			if (models.length > 0) cachedListModels = models;
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
