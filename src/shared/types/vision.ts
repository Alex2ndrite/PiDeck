/**
 * 视觉桥（Vision Bridge）共享契约。
 *
 * 用途：给 DeepSeek 等无视觉模型“装眼睛”——pi 收到图片时，由
 * pi-deck-vision 扩展调用用户配置的视觉模型生成文字描述，再替换进上下文。
 *
 * 注意：扩展 resources/extensions/pi-deck-vision.ts 是自包含单文件（打包后
 * 无法 import src/shared），内部同名类型需与此处保持字段一致；改字段时两处同步。
 */

/** 视觉模型 API 格式（与 pi models.json 的 provider.api 约定一致）。 */
export type VisionApiKind =
	| "openai-completions"
	| "anthropic-messages"
	| "google-generative-ai";

/** 视觉桥配置（写入 ~/.pi/agent/pi-deck-vision.json，与扩展读取的字段一一对应）。 */
export type VisionBridgeConfig = {
	/** 总开关，false 时扩展放行原图 */
	enabled: boolean;
	/** 视觉模型所属 provider（必须与 pi 已配置的 provider 同名，用于复用 key） */
	provider: string;
	/** 视觉模型 id，如 glm-4v-flash / gpt-4o-mini */
	model: string;
	/** 显式指定 API 格式；缺省按 provider.api 推断，再缺省 openai-completions */
	api?: VisionApiKind;
	/** 覆盖 baseUrl；缺省用 provider auth 或内置默认端点 */
	baseUrl?: string;
	/** 覆盖 apiKey；缺省复用 pi 已配置的 provider key（不落日志） */
	apiKey?: string;
	/** 单次描述最大输出 token（默认 1024） */
	maxTokens?: number;
	/** 单次视觉请求超时 ms（默认 30000） */
	timeoutMs?: number;
	/** 并发描述数（默认 2） */
	concurrency?: number;
	/** 描述提示词模板，{{instruction}} 为原指令占位 */
	promptTemplate?: string;
};

/** 视觉桥配置保存结果（IPC 边界返回结构化错误，不抛裸异常）。 */
export type VisionSaveResult = {
	ok: boolean;
	error?: string;
};

/** 视觉桥设置页初始数据：当前配置 + 配置文件目录。
 * 可选模型列表由设置页经 projects.listModels 获取（全量：models.json + auth.json + 内置目录）。 */
export type VisionBridgeState = {
	config: VisionBridgeConfig | null;
	/** 配置文件所在目录（~/.pi/agent/ 或环境变量覆盖），UI 展示用 */
	configDir: string;
};
