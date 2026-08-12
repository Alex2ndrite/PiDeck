/**
 * 模型规格索引与匹配（纯函数，无 IO，可单测）。
 *
 * 匹配语义：按「模型 id」匹配，与用户走什么中转站 baseUrl 无关。
 * 两源互补：OpenRouter 提供 context window / max tokens；models.dev 提供
 * 推理 / 工具调用 / 视觉等能力（models.dev 无 context window）。
 */

import type { ModelSpec } from "../../shared/types/modelSpecs";

/** 内置已知厂商前缀：剥离 model id 的厂商前缀时只认这些名字，防止误剥用户自定义 id */
const KNOWN_PROVIDER_ALIASES = new Set([
	"anthropic", "openai", "google", "deepseek", "zhipuai", "moonshotai", "moonshot",
	"minimax", "alibaba", "qwen", "meta", "mistralai", "mistral", "xai", "grok",
	"groq", "cerebras", "togetherai", "together", "cohere", "perplexity", "amazon",
	"bedrock", "azure", "baidu", "ernie", "tencent", "doubao", "volcengine",
	"kimi", "glm", "01-ai", "deepinfra", "fireworks", "novita", "siliconflow",
	"huggingface", "ollama", "lmstudio", "openrouter", "nvidia", "sakana",
	"upstage", "yi", "stepfun", "lingyi", "internlm", "baichuan", "spark",
]);

/** OpenRouter 条目（裁剪后的最小字段集） */
export type OpenRouterSpecEntry = {
	id: string;
	contextWindow: number;
	maxTokens?: number;
	inputModalities: string[];
};

/** models.dev 条目（按 provider 展开） */
export type ModelsDevSpecEntry = {
	provider: string;
	id: string;
	reasoning?: boolean;
	toolCall?: boolean;
	attachment?: boolean;
	inputModalities: string[];
};

export type ModelSpecIndex = {
	openrouterById: Map<string, OpenRouterSpecEntry>;
	/** openrouter id 尾段（去厂商前缀，如 gpt-4o）→ 条目列表 */
	openrouterByTail: Map<string, OpenRouterSpecEntry[]>;
	/** models.dev 模型 id → 合并条目（跨厂商同名 OR 合并能力） */
	modelsDevById: Map<string, ModelsDevSpecEntry>;
	/** 已知厂商名（内置别名 ∪ models.dev providers ∪ openrouter 前缀），剥前缀用 */
	knownProviders: Set<string>;
};

/** 构建查询索引（纯函数，可单测） */
export function buildSpecIndex(
	openrouter: OpenRouterSpecEntry[],
	modelsDev: ModelsDevSpecEntry[],
): ModelSpecIndex {
	const openrouterById = new Map<string, OpenRouterSpecEntry>();
	const openrouterByTail = new Map<string, OpenRouterSpecEntry[]>();
	for (const entry of openrouter) {
		openrouterById.set(entry.id, entry);
		const slash = entry.id.lastIndexOf("/");
		const tail = slash >= 0 ? entry.id.slice(slash + 1) : entry.id;
		const list = openrouterByTail.get(tail) ?? [];
		list.push(entry);
		openrouterByTail.set(tail, list);
	}
	const modelsDevById = new Map<string, ModelsDevSpecEntry>();
	for (const entry of modelsDev) {
		const merged = modelsDevById.get(entry.id);
		if (!merged) {
			modelsDevById.set(entry.id, { ...entry });
			continue;
		}
		// 跨厂商同名（如多家托管 deepseek-r1）：能力取 OR，输入模态取并集
		merged.reasoning = merged.reasoning || entry.reasoning;
		merged.toolCall = merged.toolCall || entry.toolCall;
		merged.attachment = merged.attachment || entry.attachment;
		merged.inputModalities = [...new Set([...merged.inputModalities, ...entry.inputModalities])];
	}
	const knownProviders = new Set(KNOWN_PROVIDER_ALIASES);
	for (const entry of modelsDev) knownProviders.add(entry.provider);
	for (const id of openrouterById.keys()) {
		const slash = id.indexOf("/");
		if (slash > 0) knownProviders.add(id.slice(0, slash));
	}
	return { openrouterById, openrouterByTail, modelsDevById, knownProviders };
}

/** 剥离厂商前缀：仅当前缀是已知厂商名才剥（防止误剥 "myrelay/model" 这类自定义前缀） */
export function stripProviderPrefix(id: string, knownProviders: Set<string>): string {
	const slash = id.indexOf("/");
	if (slash <= 0) return id;
	const prefix = id.slice(0, slash);
	return knownProviders.has(prefix) ? id.slice(slash + 1) : id;
}

/**
 * 查询模型规格（纯函数）。匹配顺序：
 * 1. openrouter 完整 id（provider/model 或裸 id）
 * 2. openrouter 尾段（用户填 gpt-4o → openai/gpt-4o；中转站场景的核心路径）
 * 3. models.dev 裸 id（先剥已知厂商前缀，再试原样）
 * 两源命中任一即合并返回（openrouter 提供 context/maxTokens，models.dev 补能力）。
 */
export function lookupModelSpec(
	index: ModelSpecIndex,
	providerName: string,
	modelId: string,
): ModelSpec | undefined {
	const trimmed = modelId.trim();
	if (!trimmed) return undefined;
	const orEntry =
		index.openrouterById.get(`${providerName}/${trimmed}`) ?? index.openrouterById.get(trimmed);
	let orTailEntry: OpenRouterSpecEntry | undefined;
	if (!orEntry && !trimmed.includes("/")) {
		// 尾段匹配取第一个；同尾段多条目通常只是厂商前缀不同，模型相同
		orTailEntry = index.openrouterByTail.get(trimmed)?.[0];
	}
	const mdId = stripProviderPrefix(trimmed, index.knownProviders);
	const mdEntry = index.modelsDevById.get(mdId) ?? index.modelsDevById.get(trimmed);
	const or = orEntry ?? orTailEntry;
	if (!or && !mdEntry) return undefined;
	const spec: ModelSpec = {
		source: or ? "openrouter" : "models-dev",
		// 走到这里 or/mdEntry 至少一个非空（前面已提前 return），但 TS 收窄跨不过 ??，用可选链兜底
		matchedId: or?.id ?? mdEntry?.id ?? "",
	};
	if (or?.contextWindow) spec.contextWindow = or.contextWindow;
	if (or?.maxTokens) spec.maxTokens = or.maxTokens;
	// 图片能力：任一源声明 image 输入（models.dev 的 attachment 即图片附件）即支持
	const images =
		or?.inputModalities.includes("image") ||
		mdEntry?.inputModalities.includes("image") ||
		mdEntry?.attachment === true;
	if (images) spec.images = true;
	if (mdEntry?.reasoning === true) spec.reasoning = true;
	return spec;
}
