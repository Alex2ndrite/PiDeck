import type { ModelItem } from "./configTypes";

type FetchedModel = { id: string; name?: string };

/**
 * 根据从 API 拉取的模型列表和用户选中项，生成待新增的 ModelItem 列表。
 * 过滤规则：
 * - 只保留用户在弹层中勾选的模型（selectedModelIds）
 * - 排除 provider 中已存在的模型（existingModels），避免重复添加
 *
 * 规格字段（contextWindow/maxTokens/reasoning/input）一律留空：
 * 历史上硬编码 1M/128K 默认值，对大多数模型是错的，且「只填空字段」的补全规则
 * 永远不会覆盖非空值——真实规格由保存所选模型时的内置规格表补全（ModelsTab）。
 */
export function buildModelsFromFetchedSelection(
	fetchedModels: FetchedModel[],
	selectedModelIds: string[],
	existingModels: ModelItem[],
): ModelItem[] {
	const existingIds = new Set(existingModels.map((model) => model.id));
	const selectedIds = new Set(selectedModelIds);
	return fetchedModels
		.filter((model) => selectedIds.has(model.id) && !existingIds.has(model.id))
		.map((model) => ({
			id: model.id,
			name: model.name ?? model.id,
			// 规格字段留空，等内置规格表补全（见文件头注释）
			contextWindow: undefined,
			maxTokens: undefined,
			reasoning: undefined,
		}));
}
