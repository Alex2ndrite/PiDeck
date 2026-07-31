/**
 * pi --list-models 全局缓存模块。
 * Phase 2.1: 从 index.ts 中提取，被 model IPC 和 config IPC 共享。
 * 首次调用 fork pi --list-models，之后直接读缓存。
 */

import type { AvailableModel } from "../../shared/types";
import type { PiLocator } from "./PiLocator";
import type { SettingsStore } from "../settings/SettingsStore";

/** 全局缓存：首次调用 fork pi --list-models，之后直接读缓存 */
let cachedListModels: AvailableModel[] | null = null;
let cachedListModelsPending: Promise<AvailableModel[]> | null = null;

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
 * 执行一次 pi --list-models，将结果写入模块级缓存。
 * 已有缓存或在途请求时不会重复 fork 新进程。
 */
export function fetchModelList(
	piLocator: PiLocator,
	settingsStore: SettingsStore,
): Promise<AvailableModel[]> {
	if (cachedListModels) return Promise.resolve(cachedListModels);
	if (cachedListModelsPending) return cachedListModelsPending;

	cachedListModelsPending = (async () => {
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
