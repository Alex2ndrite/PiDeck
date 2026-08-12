/**
 * 模型规格（context window / 输出上限 / 推理 / 视觉能力）云端匹配结果。
 *
 * 数据按「模型 id」匹配（与用户走什么中转站 baseUrl 无关）：
 * - OpenRouter：context_length + top_provider.max_completion_tokens + 多模态
 * - models.dev（Anthropic 官方）：reasoning / attachment（视觉）/ modalities
 * 两源互补（models.dev 无 context window，OpenRouter 覆盖 406 个主流 id）。
 */

export type ModelSpec = {
	/** 上下文窗口（token 数） */
	contextWindow?: number;
	/** 建议单次输出上限（token 数，OpenRouter top_provider.max_completion_tokens） */
	maxTokens?: number;
	/** 推理模型（models.dev reasoning，仅当明确支持时置 true） */
	reasoning?: boolean;
	/** 支持图片输入（任一源声明 image 模态即 true） */
	images?: boolean;
	/** 命中的线上数据源 */
	source: "openrouter" | "models-dev";
	/** 线上匹配到的规范模型 id（如 openai/gpt-4o、claude-sonnet-4-5） */
	matchedId?: string;
};

export type ModelSpecsRefreshResult = {
	ok: boolean;
	/** 最近一次成功拉取时间（ms epoch；失败时保留旧值） */
	fetchedAt?: number;
	/** 失败原因（"network" = 双源均不可达/解析失败） */
	error?: string;
};
