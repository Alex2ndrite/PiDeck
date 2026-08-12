import type { ImageContent } from "./session";

/**
 * 生图请求：复用 pi 已配置的模型供应商（models.json / auth.json），
 * 不额外维护生图配置——用户在模型页配好 baseUrl/apiKey 后即可用于生图。
 */
export type ImageGenRequest = {
	/** 供应商名（对应 models.json providers 的 key） */
	provider: string;
	/** 生图模型 id（用户在下拉里选中的模型） */
	model: string;
	/** 提示词 */
	prompt: string;
};

/**
 * 生图失败错误码（主进程只回结构化错误码，文案由渲染层 i18n 映射，避免跨层硬编码）。
 */
export type ImageGenErrorCode =
	/** 供应商缺少 baseUrl/apiKey（去模型页补配） */
	| "notConfigured"
	/** API Key 无效（401/403） */
	| "invalidKey"
	/** baseUrl 不对（404/405 等） */
	| "badBaseUrl"
	/** 网络不可达/代理问题 */
	| "network"
	/** 服务端返回其他错误（detail 携带状态码） */
	| "http"
	/** 响应里没有图片数据 */
	| "empty";

/** 生图结果：ok=true 时 image 为可直接进附件栏的 base64 图片 */
export type ImageGenResult =
	| { ok: true; image: ImageContent }
	| { ok: false; error: ImageGenErrorCode; detail?: string };
