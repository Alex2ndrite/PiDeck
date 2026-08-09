/**
 * 视觉桥配置管理（主进程侧）。
 *
 * 配置文件 ~/.pi/agent/pi-deck-vision.json 与 resources/extensions/pi-deck-vision.ts
 * 扩展读取的是同一份文件：PiDeck 只负责「界面化编辑」，扩展负责「运行时消费」，
 * 所以脱离 PiDeck 单独使用 pi + 该扩展时，手动编辑同一配置文件即可生效。
 *
 * 安全约束：IPC 入参不可信，saveConfig 逐字段白名单校验后再落盘；
 * apiKey 允许写入配置文件（与 auth.json 同级信任域），但不进日志。
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type {
	VisionBridgeConfig,
	VisionBridgeState,
	VisionSaveResult,
} from "../../shared/types";
import type { ConfigManager } from "../config/ConfigManager";

const CONFIG_FILE_NAME = "pi-deck-vision.json";

/** 与扩展 DEFAULT_BASE_URLS 对应的已知端点提示（仅 UI 展示用，解析以扩展为准）。 */
export const KNOWN_PROVIDER_BASE_URLS: Record<string, string> = {
	openai: "https://api.openai.com/v1",
	openrouter: "https://openrouter.ai/api/v1",
	anthropic: "https://api.anthropic.com",
	"google-generative-ai": "https://generativelanguage.googleapis.com",
	gemini: "https://generativelanguage.googleapis.com",
};

/** 视觉桥默认值（与扩展 DEFAULT_CONFIG 保持一致）。 */
export const VISION_DEFAULT_CONFIG: VisionBridgeConfig = {
	enabled: true,
	provider: "",
	model: "",
	maxTokens: 1024,
	timeoutMs: 30_000,
	concurrency: 2,
};

/** 配置文件所在目录：环境变量覆盖优先（测试/自定义），否则 ~/.pi/agent/。 */
export function visionConfigDir(): string {
	return process.env.PIDECK_VISION_CONFIG_DIR ?? join(homedir(), ".pi", "agent");
}

/** 输入白名单校验：只允许写入已知字段，长度/枚举/范围限制。 */
function sanitizeConfig(input: unknown): VisionBridgeConfig | null {
	if (typeof input !== "object" || input === null) return null;
	const raw = input as Record<string, unknown>;

	const provider = typeof raw.provider === "string" ? raw.provider.trim().slice(0, 128) : "";
	const model = typeof raw.model === "string" ? raw.model.trim().slice(0, 128) : "";
	// 未配置 provider/model 时允许保存（相当于关闭桥），但写空值无意义，直接拒绝
	if (!provider || !model) return null;

	const next: VisionBridgeConfig = {
		enabled: raw.enabled === false ? false : true,
		provider,
		model,
	};

	// api 枚举白名单，非法值忽略（由扩展按 provider 推断）
	if (raw.api === "openai-completions" || raw.api === "anthropic-messages" || raw.api === "google-generative-ai") {
		next.api = raw.api;
	}
	// baseUrl 必须 http(s)，防止写入任意协议路径
	if (typeof raw.baseUrl === "string" && /^https?:\/\/[^\s]+$/i.test(raw.baseUrl.trim())) {
		next.baseUrl = raw.baseUrl.trim().slice(0, 512);
	}
	// apiKey 允许留空（复用 pi auth）；有值则限长防爆文件
	if (typeof raw.apiKey === "string" && raw.apiKey.trim()) {
		next.apiKey = raw.apiKey.trim().slice(0, 512);
	}

	// 数值字段：正整数 + 上限，防恶意大值写坏配置
	const intField = (value: unknown, max: number): number | undefined => {
		if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
		const n = Math.trunc(value);
		return n > 0 && n <= max ? n : undefined;
	};
	const maxTokens = intField(raw.maxTokens, 32_768);
	if (maxTokens !== undefined) next.maxTokens = maxTokens;
	const timeoutMs = intField(raw.timeoutMs, 300_000);
	if (timeoutMs !== undefined) next.timeoutMs = timeoutMs;
	const concurrency = intField(raw.concurrency, 16);
	if (concurrency !== undefined) next.concurrency = concurrency;

	if (typeof raw.promptTemplate === "string" && raw.promptTemplate.trim()) {
		next.promptTemplate = raw.promptTemplate.slice(0, 4_000);
	}
	return next;
}

export class VisionBridgeConfigManager {
	constructor(private readonly configManager: ConfigManager) {}

	/** 读取当前配置；文件缺失或非法返回 null（与扩展的静默放行语义一致）。 */
	async getConfig(): Promise<VisionBridgeConfig | null> {
		try {
			const filePath = join(visionConfigDir(), CONFIG_FILE_NAME);
			const raw = await readFile(filePath, "utf8");
			const parsed: unknown = JSON.parse(raw);
			if (typeof parsed !== "object" || parsed === null) return null;
			// 直接返回文件内容（已由保存路径校验过），不做二次裁剪，避免 UI 显示与文件不一致
			return sanitizeConfig(parsed);
		} catch {
			return null;
		}
	}

	/** 保存配置：白名单校验后写回 ~/.pi/agent/pi-deck-vision.json。
	 * 用户未显式填 apiKey/baseUrl 时，从 pi models.json 解析该 provider 的 inline 配置
	 * （PiDeck「配置模型」页把 key 存在 models.json 的 provider.apiKey，auth.json 里没有），
	 * 保证扩展脱离 PiDeck 单独跑也能直接读取，无需用户重复填写。
	 */
	async saveConfig(input: unknown): Promise<VisionSaveResult> {
		const next = sanitizeConfig(input);
		if (!next) {
			return { ok: false, error: "provider/model 必填，或字段非法" };
		}
		// 未显式填写的 key/baseUrl 从 models.json 的 provider 配置补齐（仅当缺失时）
		if (!next.apiKey || !next.baseUrl) {
			try {
				const modelsResult = await this.configManager.getModelsConfig();
				const provider = (modelsResult.parsed as { providers?: Record<string, { apiKey?: string; baseUrl?: string }> } | undefined)
					?.providers?.[next.provider];
				if (provider) {
					if (!next.apiKey && provider.apiKey) next.apiKey = provider.apiKey;
					if (!next.baseUrl && provider.baseUrl) next.baseUrl = provider.baseUrl;
				}
			} catch {
				// models.json 解析失败不影响保存：用户手动填的字段仍会写入
			}
		}
		try {
			const dir = visionConfigDir();
			await mkdir(dir, { recursive: true });
			await writeFile(join(dir, CONFIG_FILE_NAME), JSON.stringify(next, null, 2), "utf8");
			return { ok: true };
		} catch (error) {
			return { ok: false, error: error instanceof Error ? error.message : String(error) };
		}
	}

	/** 组装设置页初始数据：当前配置 + 配置文件目录（模型列表由 UI 经 listModels 拉全量）。 */
	async getState(): Promise<VisionBridgeState> {
		return {
			config: await this.getConfig(),
			configDir: visionConfigDir(),
		};
	}
}
