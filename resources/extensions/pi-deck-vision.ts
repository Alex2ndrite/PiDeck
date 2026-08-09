/**
 * PiDeck Vision Bridge Extension
 *
 * 给 DeepSeek 等无视觉模型"装上眼睛"：
 * - 用户粘贴/上传的图片：input 事件里直接转成文字描述（否则 pi 会在 provider 层
 *   替换成 "(image omitted...)" 占位符，模型什么都看不到）；
 * - 工具结果（如 read 读图）中的图片：tool_result 事件缓存后，在最终请求体里
 *   把"图片省略"note 替换为视觉模型描述（before_provider_request 事件）。
 *
 * 为什么不用 context 事件改消息？
 * - context 事件的返回值可能被其他扩展（如 ACP 类上下文管理扩展）基于
 *   会话文件重建覆盖；而 before_provider_request 是请求发出前的最后一环，
 *   修改的 payload 一定生效。
 * - pi 对无视觉模型本就会丢弃图片（openai-completions 只发 text 部分），
 *   本扩展在图片被丢弃前（tool_result 事件）先缓存图片，再在请求体里
 *   把"图片省略"note 替换为视觉模型描述。
 *
 * 设计要点：
 * - 自包含单文件：脱离 PiDeck 也能用（复制到 ~/.pi/agent/extensions/ 或 `pi -e` 加载），
 *   只依赖 pi 扩展 API 与 Node 内置模块。
 * - 配置外挂：读取 ~/.pi/agent/pi-deck-vision.json（与 pi 的 models.json/auth.json 同级），
 *   可用 PIDECK_VISION_CONFIG_DIR 环境变量覆盖目录（PiDeck 注入 / 测试用）。
 * - 复用已配置供应商：apiKey/baseUrl 优先从 pi 的模型注册表解析
 *   （ctx.modelRegistry.getProviderAuth），不重复填 key；配置文件里也可显式指定。
 * - 不做能力检测：是否支持视觉由用户自行判断（设置页选择视觉模型），
 *   开启后所有图片统一走视觉桥转换。
 * - 失败降级：视觉调用失败时替换为错误占位文本，绝不阻断 agent 主流程；
 *   同一图片（base64 哈希）在进程生命周期内只调用一次。
 */

import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
// 视觉请求直连：不用全局 fetch。pi 的 http-dispatcher 会把全局 dispatcher 换成
// EnvHttpProxyAgent（读 HTTPS_PROXY 环境变量），用户翻墙代理对商汤/GLM/Qwen
// 这类国内视觉 API 反而导致连接失败；undici 显式 dispatcher 不受影响。
import { Agent, fetch as undiciFetch } from "undici";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { ImageContent } from "@earendil-works/pi-ai";

/** 配置文件：~/.pi/agent/pi-deck-vision.json */
const CONFIG_FILE_NAME = "pi-deck-vision.json";
/** 单轮最多转换的图片数（防止一次读图风暴拖垮响应） */
const MAX_IMAGES_PER_TURN = 12;
/** 单张图片 base64 长度上限（≈15MB），超出跳过并提示，避免请求体过大 */
const MAX_IMAGE_BASE64_LENGTH = 15 * 1024 * 1024;
/** 图片哈希 → 描述结果缓存（含失败，避免同一张图反复调用视觉模型） */
const descriptionCache = new Map<string, { ok: boolean; text: string }>();
/** toolCallId → 该工具结果里的图片（before_provider_request 阶段消费后删除） */
const pendingToolImages = new Map<string, ImageContent[]>();

/** 视觉调用支持的 API 格式；默认 OpenAI 兼容（覆盖 GLM/Qwen/OpenRouter/DeepSeek 等） */
export type VisionApiKind = "openai-completions" | "anthropic-messages" | "google-generative-ai";

/** 响应里没有可用文本时的占位（describeImage 据此触发关闭思考重试） */
const EMPTY_RESPONSE_PLACEHOLDER = "[empty response]";

/** pi-deck-vision.json 的配置结构 */
export type VisionBridgeConfig = {
	/** 总开关；false 时扩展完全放行，保持 pi 原行为 */
	enabled: boolean;
	/** 视觉模型所在供应商名（pi 已配置的 provider id，如 openai/openrouter/glm/qwen） */
	provider: string;
	/** 视觉模型 id（如 gpt-4o-mini / glm-4v-flash / qwen-vl-plus） */
	model: string;
	/** API 格式；省略时优先取 provider 自身 api，再默认 openai-completions */
	api?: VisionApiKind;
	/** 显式 baseUrl（如 https://open.bigmodel.cn/api/paas/v4）；省略时从注册表解析 */
	baseUrl?: string;
	/** 显式 apiKey；省略时从注册表 / auth.json 解析 */
	apiKey?: string;
	/** 描述结果最大 token 数，默认 1024 */
	maxTokens?: number;
	/** 单张图片转换超时（ms），默认 30s */
	timeoutMs?: number;
	/** 单次转换并发数，默认 2（避免瞬时多请求被限流） */
	concurrency?: number;
	/** 发给视觉模型的提示词（图片作为多模态内容附带，无占位符） */
	promptTemplate?: string;
};

/** 解析后的调用端点信息 */
type ResolvedEndpoint = {
	baseUrl: string;
	/** 视觉模型 id（来自配置） */
	model: string;
	apiKey?: string;
	headers?: Record<string, string>;
	api: VisionApiKind;
};

const DEFAULT_PROMPT =
	"请详细描述这张图片的内容。如果图片中有文字（代码、报错、UI 文案、文档等），请完整准确地转录所有可见文字；如果是图表，请说明类型、坐标轴含义和关键数值；如果涉及界面，请描述布局与元素。输出使用中文。";

const DEFAULT_CONFIG: VisionBridgeConfig = {
	enabled: true,
	provider: "",
	model: "",
	maxTokens: 1024,
	timeoutMs: 30_000,
	concurrency: 2,
	promptTemplate: DEFAULT_PROMPT,
};

/**
 * pi 内置 provider 的默认端点（auth.json 里通常只有 key，没有 baseUrl）。
 * 覆盖 OpenAI / OpenRouter / Anthropic / Gemini；GLM、Qwen 等国内供应商
 * 需要用户在配置文件显式填 baseUrl。
 */
const DEFAULT_BASE_URLS: Record<string, string> = {
	openai: "https://api.openai.com/v1",
	openrouter: "https://openrouter.ai/api/v1",
	anthropic: "https://api.anthropic.com",
	"google-generative-ai": "https://generativelanguage.googleapis.com",
	gemini: "https://generativelanguage.googleapis.com",
};

/** 内置 provider 的已知 API 格式（用于自动推断，避免依赖运行时注册表查询）。 */
const PROVIDER_API_HINTS: Record<string, VisionApiKind> = {
	anthropic: "anthropic-messages",
	"google-generative-ai": "google-generative-ai",
	gemini: "google-generative-ai",
};

/** 读取配置文件；文件不存在/解析失败返回 null（此时扩展静默放行）。 */
export async function loadVisionBridgeConfig(
	configDir = resolveConfigDir(),
): Promise<VisionBridgeConfig | null> {
	try {
		const raw = await readFile(join(configDir, CONFIG_FILE_NAME), "utf8");
		const parsed = JSON.parse(raw) as Partial<VisionBridgeConfig>;
		if (typeof parsed !== "object" || parsed === null) return null;
		// 只合并已知字段，避免配置里混入未知键影响结构
		const config: VisionBridgeConfig = { ...DEFAULT_CONFIG };
		if (typeof parsed.enabled === "boolean") config.enabled = parsed.enabled;
		if (typeof parsed.provider === "string") config.provider = parsed.provider;
		if (typeof parsed.model === "string") config.model = parsed.model;
		if (typeof parsed.api === "string") config.api = parsed.api as VisionApiKind;
		if (typeof parsed.baseUrl === "string") config.baseUrl = parsed.baseUrl;
		if (typeof parsed.apiKey === "string") config.apiKey = parsed.apiKey;
		if (typeof parsed.maxTokens === "number" && parsed.maxTokens > 0) config.maxTokens = parsed.maxTokens;
		if (typeof parsed.timeoutMs === "number" && parsed.timeoutMs > 0) config.timeoutMs = parsed.timeoutMs;
		if (typeof parsed.concurrency === "number" && parsed.concurrency > 0) config.concurrency = parsed.concurrency;
		if (typeof parsed.promptTemplate === "string" && parsed.promptTemplate.trim()) {
			config.promptTemplate = parsed.promptTemplate;
		}
		return config;
	} catch {
		return null;
	}
}

/** 配置文件目录：PIDECK_VISION_CONFIG_DIR 覆盖 → ~/.pi/agent */
export function resolveConfigDir(): string {
	const override = process.env.PIDECK_VISION_CONFIG_DIR;
	if (override && override.trim()) return override.trim();
	return join(homedir(), ".pi", "agent");
}

/** 计算图片 base64 的 sha256 前缀，用于缓存去重。 */
export function imageHash(data: string): string {
	return createHash("sha256").update(data).digest("hex").slice(0, 24);
}

/**
 * 从 data URL（data:mimeType;base64,xxx）提取图片内容。
 * 格式不合法返回 null。用于替换 user 消息里的 image_url part。
 */
export function extractImageFromDataUrl(url: string): ImageContent | null {
	const match = /^data:([^;,]+);base64,([A-Za-z0-9+/=]+)$/.exec(url);
	if (!match) return null;
	return { type: "image", data: match[2], mimeType: match[1] };
}

/**
 * 替换 tool 消息 content（字符串）里的"图片省略"note。
 * 原格式："Read image file [image/png]\n[Current model does not support images. ...]\n\n<acp ...>"
 * 替换后："Read image file [image/png]\n[图片 #N（视觉桥已查看，以下为图片实际内容）]\n<描述>\n\n<acp ...>"
 * note 之后的附加内容（如 ACP 标签）原样保留。无 note 时原样返回。
 */
export function replaceNoteInToolContent(content: string, description: string): string {
	// 只处理带省略声明的 note（随 read 工具输出）；没有则不动
	if (!/does not support images|will be omitted from this request/i.test(content)) {
		return content;
	}
	return content
		.replace(
			/\n\[Current model does not support images[^\]]*\][\s\S]*$/i,
			(match) => `\n${description}${match.replace(/^\n\[Current model does not support images[^\]]*\]/, "").replace(/^\n/, "\n")}`,
		)
		.replace(/\nCurrent model does not support images[\s\S]*$/i, `\n${description}`);
}

/**
 * 解析视觉调用端点：
 * 1. 配置文件显式 apiKey/baseUrl 优先；
 * 2. 否则从 ctx.modelRegistry 解析（复用 pi 已配置的 auth.json / 环境变量）；
 * 3. 兜底内置默认 baseUrl（openai/openrouter）。
 * 返回 null 表示无法解析（扩展应放行原图）。
 */
export async function resolveEndpoint(
	config: VisionBridgeConfig,
	ctx: Pick<ExtensionContext, "modelRegistry">,
): Promise<ResolvedEndpoint | null> {
	if (!config.provider || !config.model) return null;

	let apiKey: string | undefined = config.apiKey;
	let baseUrl: string | undefined = config.baseUrl;
	let headers: Record<string, string> | undefined;

	// 从 pi 模型注册表解析供应商已配置的 auth（key 不落日志、不落配置）
	try {
		const auth = await ctx.modelRegistry.getProviderAuth(config.provider);
		if (auth) {
			apiKey = apiKey ?? auth.apiKey;
			baseUrl = baseUrl ?? auth.baseUrl;
			if (auth.headers && Object.keys(auth.headers).length > 0) {
				headers = { ...auth.headers };
			}
		}
		if (!apiKey) {
			apiKey = await ctx.modelRegistry.getApiKeyForProvider(config.provider);
		}
	} catch {
		// 注册表解析失败不致命：显式配置仍可用
	}

	// provider 自身 api 类型（如 anthropic-messages）作为默认 API 格式
	let api: VisionApiKind = "openai-completions";
	if (config.api) {
		api = config.api;
	} else {
		// 先查内置 provider 的已知 API 类型（不依赖运行时注册表，注册表可能查不到自定义/未登录 provider）
		const hint = PROVIDER_API_HINTS[config.provider];
		if (hint) {
			api = hint;
		} else {
			try {
				const provider = ctx.modelRegistry.getProvider(config.provider);
				const providerApi = String((provider as { api?: unknown } | undefined)?.api ?? "");
				if (providerApi === "anthropic-messages") api = "anthropic-messages";
				else if (providerApi === "google-generative-ai") api = "google-generative-ai";
			} catch {
				// 保持默认 openai-completions
			}
		}
	}

	if (!baseUrl) {
		// 内置 provider 已知端点；GLM/Qwen 等需要在配置文件显式填写 baseUrl
		baseUrl = DEFAULT_BASE_URLS[config.provider];
		if (!baseUrl) return null;
	}

	// 若 auth 解析到了 headers 且没有 apiKey（如 anthropic 的 x-api-key header），保留 headers 原样
	return { baseUrl: baseUrl.replace(/\/+$/, ""), model: config.model, apiKey, headers, api };
}

/**
 * 调用视觉模型描述单张图片（OpenAI 兼容 / Anthropic / Gemini 三种格式）。
 * 返回 { ok, text }；任何异常都折叠为失败结果，不向外抛。
 *
 * 重试策略：部分 openai 兼容网关的思维链模型（如商汤 6.7）非流式请求里
 * max_tokens 是「思考 + 回答」的总预算，思考会吃掉大部分额度导致回答被
 * length 截断（描述不完整，结构都没写完）。此时用 reasoning_effort:"none"
 * 重试一次强制直接给答案；content 完全为空（纯思考输出）同理。
 */
export async function describeImage(
	endpoint: ResolvedEndpoint,
	image: ImageContent,
	prompt: string,
	options: { maxTokens: number; timeoutMs: number; signal?: AbortSignal },
): Promise<{ ok: boolean; text: string }> {
	const first = await doVisionRequest(endpoint, image, prompt, options, { reasoningEffortNone: false });
	const needsRetry =
		endpoint.api === "openai-completions" &&
		first.ok &&
		(first.text === EMPTY_RESPONSE_PLACEHOLDER || first.finishReason === "length");
	if (needsRetry) {
		const retry = await doVisionRequest(endpoint, image, prompt, options, { reasoningEffortNone: true });
		if (retry.ok) return retry;
	}
	return first;
}

/** 直连 dispatcher（进程级单例）：避免走全局代理，国内视觉 API 才能稳定连通。 */
let directDispatcher: Agent | undefined;
function getDirectDispatcher(): Agent {
	if (!directDispatcher) {
		directDispatcher = new Agent({ connect: { timeout: 15_000 } });
	}
	return directDispatcher;
}

/** 已知 max_tokens 上限低的端点（如智谱 glm-4v-flash 只允许 [1,1024]），
 * 400 自愈成功后记录，后续请求直接不带 max_tokens 字段。 */
const noMaxTokensEndpoints = new Set<string>();
function endpointKey(endpoint: ResolvedEndpoint): string {
	return `${endpoint.baseUrl}|${endpoint.model}`;
}

/** 去掉 body 里的 max_tokens 字段（openai 兼容格式）。force=true 强制去掉，
 * 否则仅当该端点已被标记为低上限时去掉。其他格式（anthropic/google）不动。 */
function trimMaxTokens(endpoint: ResolvedEndpoint, body: unknown, force = false): unknown {
	if (endpoint.api !== "openai-completions" || typeof body !== "object" || body === null) {
		return body;
	}
	if (!force && !noMaxTokensEndpoints.has(endpointKey(endpoint))) {
		return body;
	}
	const next = { ...(body as Record<string, unknown>) };
	delete next.max_tokens;
	return next;
}

/** 单次视觉请求（可指定关闭思考模式重试）。返回结果附 finishReason（openai 格式），
 * 供调用方判断是否被 max_tokens 截断。 */
async function doVisionRequest(
	endpoint: ResolvedEndpoint,
	image: ImageContent,
	prompt: string,
	options: { maxTokens: number; timeoutMs: number; signal?: AbortSignal },
	flags: { reasoningEffortNone: boolean },
): Promise<{ ok: boolean; text: string; finishReason?: string }> {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), options.timeoutMs);
	const onOuterAbort = () => controller.abort();
	options.signal?.addEventListener("abort", onOuterAbort, { once: true });

	try {
		const { url, headers, body } = buildVisionRequest(endpoint, image, prompt, options.maxTokens, flags);
		// 已知低上限端点：直接不带 max_tokens（避免每次先吃一次 400）
		const trimmedBody = trimMaxTokens(endpoint, body);
		let res = await undiciFetch(url, {
			method: "POST",
			headers,
			body: JSON.stringify(trimmedBody),
			signal: controller.signal,
			dispatcher: getDirectDispatcher(),
		});
		if (res.status === 400 && endpoint.api === "openai-completions" && !noMaxTokensEndpoints.has(endpointKey(endpoint))) {
			// 兼容性自愈：部分网关（如智谱 glm-4v-flash）max_tokens 上限远低于
			// 配置值，去掉该字段重试一次；成功则记录该端点后续不再传
			const retryBody = trimMaxTokens(endpoint, body, true);
			const retry = await undiciFetch(url, {
				method: "POST",
				headers,
				body: JSON.stringify(retryBody),
				signal: controller.signal,
				dispatcher: getDirectDispatcher(),
			});
			if (retry.ok) {
				noMaxTokensEndpoints.add(endpointKey(endpoint));
				res = retry;
			}
		}
		if (!res.ok) {
			// 不打印响应体（可能回显请求中的图片或 key）；只带状态码
			return { ok: false, text: `HTTP ${res.status} ${res.statusText}` };
		}
		const payload = (await res.json()) as Record<string, unknown>;
		const finishReason = (payload.choices as Array<{ finish_reason?: unknown }> | undefined)?.[0]
			?.finish_reason as string | undefined;
		return {
			ok: true,
			text: extractVisionText(endpoint.api, payload, { fallbackToReasoning: flags.reasoningEffortNone }),
			...(finishReason ? { finishReason } : {}),
		};
	} catch (e) {
		const isTimeout = e instanceof Error && e.name === "AbortError";
		return {
			ok: false,
			text: isTimeout ? `timeout(${options.timeoutMs}ms)` : e instanceof Error ? e.message : String(e),
		};
	} finally {
		clearTimeout(timeout);
		options.signal?.removeEventListener("abort", onOuterAbort);
	}
}

/** 构造视觉请求（不同 API 格式的图片编码方式不同）。
 * baseUrl 允许带 API 版本路径（pi models.json 中 google-generative-ai 常带 /v1beta、
 * anthropic 偶见 /v1），拼接时去掉尾部版本段避免 /v1beta/v1beta 双写。 */
export function buildVisionRequest(
	endpoint: ResolvedEndpoint,
	image: ImageContent,
	prompt: string,
	maxTokens: number,
	flags: { reasoningEffortNone: boolean },
): { url: string; headers: Record<string, string>; body: unknown } {
	// 去掉 baseUrl 尾部的版本路径段（/v1、/v1beta），再按 API 格式拼回标准路径
	const apiBase = endpoint.baseUrl.replace(/\/(?:v1|v1beta)\/?$/, "");
	if (endpoint.api === "anthropic-messages") {
		return {
			url: `${apiBase}/v1/messages`,
			headers: {
				"content-type": "application/json",
				"x-api-key": endpoint.apiKey ?? "",
				"anthropic-version": "2023-06-01",
				...(endpoint.headers ?? {}),
			},
			body: {
				model: endpoint.model,
				max_tokens: maxTokens,
				messages: [
					{
						role: "user",
						content: [
							{ type: "text", text: prompt },
							{
								type: "image",
								source: {
									type: "base64",
									media_type: image.mimeType,
									data: image.data,
								},
							},
						],
					},
				],
			},
		};
	}
	if (endpoint.api === "google-generative-ai") {
		return {
			url: `${apiBase}/v1beta/models/${endpoint.model}:generateContent?key=${encodeURIComponent(endpoint.apiKey ?? "")}`,
			headers: { "content-type": "application/json", ...(endpoint.headers ?? {}) },
			body: {
				contents: [
					{
						role: "user",
						parts: [
							{ text: prompt },
							{ inline_data: { mime_type: image.mimeType, data: image.data } },
						],
					},
				],
				generationConfig: { maxOutputTokens: maxTokens },
			},
		};
	}
	// openai-completions（默认）：OpenAI / GLM / Qwen / OpenRouter / DeepSeek 兼容
	// 思维链模型（如商汤 6.7）非流式请求默认输出 reasoning 不输出 content，
	// 重试时用 reasoning_effort: "none" 强制直接给答案
	return {
		url: `${endpoint.baseUrl}/chat/completions`,
		headers: {
			"content-type": "application/json",
			...(endpoint.apiKey ? { authorization: `Bearer ${endpoint.apiKey}` } : {}),
			...(endpoint.headers ?? {}),
		},
		body: {
			model: endpoint.model,
			max_tokens: maxTokens,
			...(flags.reasoningEffortNone ? { reasoning_effort: "none" } : {}),
			messages: [
				{
					role: "user",
					content: [
						{ type: "text", text: prompt },
						{
							type: "image_url",
							image_url: { url: `data:${image.mimeType};base64,${image.data}` },
						},
					],
				},
			],
		},
	};
}

/** 从各 API 格式的响应里提取描述文本。
 * fallbackToReasoning：content 为空时回退到 message.reasoning
 * （重试后仍无 content 的兜底，避免整个桥接失败）。 */
export function extractVisionText(
	api: VisionApiKind,
	payload: Record<string, unknown>,
	options?: { fallbackToReasoning?: boolean },
): string {
	if (api === "anthropic-messages") {
		const content = payload.content as Array<Record<string, unknown>> | undefined;
		const text = content?.filter((part) => part.type === "text")
			.map((part) => String(part.text ?? ""))
			.join("\n");
		return text || "[empty response]";
	}
	if (api === "google-generative-ai") {
		const candidates = payload.candidates as Array<Record<string, unknown>> | undefined;
		const parts = candidates?.[0]?.content as Record<string, unknown> | undefined;
		const texts = (parts?.parts as Array<Record<string, unknown>> | undefined)
			?.map((part) => String(part.text ?? ""))
			.filter(Boolean);
		return texts?.join("\n") || "[empty response]";
	}
	// openai-completions
	const choices = payload.choices as Array<Record<string, unknown>> | undefined;
	const message = choices?.[0]?.message as Record<string, unknown> | undefined;
	const text = message?.content;
	if (typeof text === "string" && text.trim()) return text;
	// 部分兼容网关返回 content 数组（如 reasoning + text 混合）
	if (Array.isArray(text)) {
		const joined = text
			.map((part) => String((part as Record<string, unknown>)?.text ?? ""))
			.filter(Boolean)
			.join("\n");
		if (joined) return joined;
	}
	// 思维链模型：content 为空但 reasoning 里有观察结果，作最后兜底
	if (options?.fallbackToReasoning && typeof message?.reasoning === "string" && message.reasoning) {
		return message.reasoning;
	}
	return "[empty response]";
}

/** 简单并发池：把任务分批执行，每批最多 concurrency 个。 */
async function runWithConcurrency<T>(
	tasks: Array<() => Promise<T>>,
	concurrency: number,
): Promise<T[]> {
	const results: T[] = new Array(tasks.length);
	let cursor = 0;
	async function worker() {
		while (true) {
			const index = cursor++;
			if (index >= tasks.length) return;
			results[index] = await tasks[index]();
		}
	}
	const workers = Array.from({ length: Math.min(Math.max(concurrency, 1), tasks.length) }, () => worker());
	await Promise.all(workers);
	return results;
}

/** 截断文本到上限字符数（按 code point，避免截断代理对）。 */
function truncateText(text: string, max: number): string {
	if (text.length <= max) return text;
	return `${[...text].slice(0, max).join("")}…`;
}

/**
 * 描述一组图片（带哈希缓存 + 并发），返回拼好的描述文本块。
 * 全部失败或没有图片时返回 null。单轮图片超过上限时只处理前 N 张。
 */
async function describeImages(
	endpoint: ResolvedEndpoint,
	images: ImageContent[],
	prompt: string,
	config: VisionBridgeConfig,
	signal: AbortSignal | undefined,
): Promise<string | null> {
	const selected = images.slice(0, MAX_IMAGES_PER_TURN);
	if (selected.length === 0) return null;

	// 第一遍：去重 + 跳过超大图（结果按出现顺序编号，保证多图时模型能对号入座）
	const jobs: Array<{ hash: string; image: ImageContent }> = [];
	const results = new Map<string, { ok: boolean; text: string }>();
	for (const image of selected) {
		const hash = imageHash(image.data);
		if (results.has(hash)) continue;
		if (image.data.length > MAX_IMAGE_BASE64_LENGTH) {
			results.set(hash, { ok: false, text: `图片超过 ${MAX_IMAGE_BASE64_LENGTH} 字节上限` });
			continue;
		}
		jobs.push({ hash, image });
	}

	// 第二遍：并发调用视觉模型（命中缓存直接复用）
	await runWithConcurrency(
		jobs.map(({ hash, image }) => async () => {
			const cached = descriptionCache.get(hash);
			if (cached) {
				results.set(hash, cached);
				return;
			}
			const outcome = await describeImage(endpoint, image, prompt, {
				maxTokens: config.maxTokens ?? 1024,
				timeoutMs: config.timeoutMs ?? 30_000,
				signal,
			});
			descriptionCache.set(hash, outcome);
			results.set(hash, outcome);
		}),
		config.concurrency ?? 2,
	);

	// 第三遍：按原顺序拼装（含失败占位，模型仍能知道每张图的存在与顺序）
	let counter = 0;
	const parts: string[] = [];
	const seen = new Set<string>();
	for (const image of selected) {
		const hash = imageHash(image.data);
		if (results.get(hash) === undefined) continue;
		if (seen.has(hash)) continue;
		seen.add(hash);
		counter++;
		const result = results.get(hash);
		if (result?.ok) {
			parts.push(`[图片 #${counter}（视觉桥已查看，以下为图片实际内容）]\n${result.text}`);
		} else {
			parts.push(
				`[图片 #${counter} 视觉桥转换失败${result ? `：${truncateText(result.text, 200)}` : "（未配置视觉模型）"}，此图片内容不可见]`,
			);
		}
	}
	return parts.length > 0 ? parts.join("\n\n") : null;
}

export default function (pi: ExtensionAPI) {
	// 用户输入事件：粘贴/上传的图片在进入 agent 前直接转成描述文本。
	// 不这么做的话，pi 会在 provider 层把图片替换成
	// "(image omitted: model does not support images)" 占位符，模型什么都看不到。
	pi.on("input", async (event, ctx) => {
		try {
			const config = await loadVisionBridgeConfig();
			if (!config?.enabled || !config.provider || !config.model) return undefined;
			const typed = event as { text?: string; images?: ImageContent[] };
			const images = typed.images;
			if (!images || images.length === 0) return undefined;
			const endpoint = await resolveEndpoint(config, ctx);
			if (!endpoint) return undefined;
			const desc = await describeImages(endpoint, images, config.promptTemplate ?? DEFAULT_PROMPT, config, ctx.signal);
			if (!desc) return undefined;
			// 描述文本附到消息文本后，图片清空（已转为文字）
			const text = typed.text ? `${typed.text}\n\n${desc}` : desc;
			return { action: "transform", text, images: [] };
		} catch {
			return undefined; // 保持原样，不阻断
		}
	});

	// 工具结果事件：先缓存图片（此时 pi 还没丢弃），供 before_provider_request 消费
	pi.on("tool_result", (event) => {
		try {
			const typed = event as { toolCallId?: string; content?: unknown };
			if (!typed.toolCallId || !Array.isArray(typed.content)) return;
			const images = typed.content.filter(
				(part): part is ImageContent =>
					!!part && typeof part === "object" && (part as { type?: unknown }).type === "image" &&
					typeof (part as ImageContent).data === "string",
			);
			if (images.length > 0) {
				pendingToolImages.set(typed.toolCallId, images);
			}
		} catch {
			// 缓存失败不影响主流程
		}
	});

	// 最终请求体事件：把图片替换为视觉模型描述。
	// 这是请求发出前的最后一环，修改必然生效（context 事件的结果可能被
	// 其他扩展基于会话文件重建覆盖，因此不在这里做转换）。
	pi.on("before_provider_request", async (event, ctx) => {
		try {
			// 任何配置缺失都直接放行，保持 pi 原行为
			const config = await loadVisionBridgeConfig();
			if (!config?.enabled || !config.provider || !config.model) return undefined;

			const payload = (event as { payload?: { messages?: unknown[] } }).payload;
			if (!payload || !Array.isArray(payload.messages)) return undefined;

			const endpoint = await resolveEndpoint(config, ctx);
			if (!endpoint) return undefined;

			const prompt = config.promptTemplate ?? DEFAULT_PROMPT;
			let changed = false;

			// 第一遍：收集需要替换的位置（tool 消息按 toolCallId 匹配缓存的图片，
			// user 消息就地提取 data URL 图片）
			const replacements: Array<{
				msgIndex: number;
				kind: "tool" | "user";
				images: ImageContent[];
			}> = [];
			payload.messages.forEach((msg, msgIndex) => {
				const typed = msg as { role?: string; content?: unknown; tool_call_id?: string } | null;
				if (!typed || typeof typed !== "object") return;
				if (typed.role === "tool" && typeof typed.content === "string") {
					const images = pendingToolImages.get(String(typed.tool_call_id ?? ""));
					if (images?.length) {
						replacements.push({ msgIndex, kind: "tool", images });
						pendingToolImages.delete(String(typed.tool_call_id ?? ""));
					}
				} else if (typed.role === "user" && Array.isArray(typed.content)) {
					const images: ImageContent[] = [];
					for (const part of typed.content as Array<{ type?: string; image_url?: { url?: string } }>) {
						if (part?.type === "image_url" && typeof part.image_url?.url === "string") {
							const image = extractImageFromDataUrl(part.image_url.url);
							if (image) images.push(image);
						}
					}
					if (images.length > 0) {
						replacements.push({ msgIndex, kind: "user", images });
					}
				}
			});
			if (replacements.length === 0) return undefined;

			// 第二遍：并发描述（不同消息的图片可并行）
			const descriptions = await Promise.all(
				replacements.map(({ images }) => describeImages(endpoint, images, prompt, config, ctx.signal)),
			);

			// 第三遍：写回 payload（浅拷贝消息对象，避免污染原 payload）
			const messages = payload.messages.map((msg, msgIndex) => {
				const replacement = replacements.find((r) => r.msgIndex === msgIndex);
				if (!replacement) return msg;
				const desc = descriptions[replacements.indexOf(replacement)];
				if (!desc) return msg;
				changed = true;
				if (replacement.kind === "tool") {
					const typed = msg as { content?: unknown };
					return { ...(msg as object), content: replaceNoteInToolContent(String(typed.content), desc) };
				}
				// user 消息：image_url part 全部替换为描述文本
				const typed = msg as { content?: Array<{ type?: string; image_url?: { url?: string } }> };
				let used = 0;
				const nextContent = typed.content.map((part) => {
					if (part?.type === "image_url") {
						const texts = desc.split("\n\n");
						if (used < texts.length) {
							const text = texts[used++];
							return { type: "text", text };
						}
					}
					return part;
				});
				return { ...(msg as object), content: nextContent };
			});

			return changed ? { ...payload, messages } : undefined;
		} catch {
			// 任何异常都不能阻断请求：返回 undefined 保持原 payload
			return undefined;
		}
	});
}
