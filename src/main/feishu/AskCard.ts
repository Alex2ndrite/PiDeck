/**
 * AskCard — 飞书端 ask_question / confirm 等扩展 UI 请求的交互卡片。
 *
 * 背景：pi 调用 ask_question 等扩展工具时会发出 extension_ui_request 等待用户回答。
 * 桌面端用弹窗回答；飞书端此前完全无视该事件，导致 agent 一直阻塞等待直到超时。
 * 本模块把提问渲染成飞书 interactive 卡片（按钮选项/确认/取消），
 * 用户点击按钮后由 FeishuBridge 把答案经 sendUIResponse 写回 pi。
 */

import { feishuT, type FeishuLocale } from "./FeishuI18n";

const ASK_ACTION = "pideck.ask";
const BUTTONS_PER_ROW = 4;
const MAX_OPTION_BUTTONS = 20;
/** 飞书按钮 plain_text 的字符上限（含中文按字符计），超长截断仅影响展示，答案用原始值。 */
const MAX_BUTTON_TEXT = 18;

export type AskMethod = "select" | "confirm" | "input" | "editor" | "batch_ask";

export type AskUiRequest = {
	requestId: string;
	method: AskMethod;
	title: string;
	options?: AskOption[];
	batchQuestions?: Array<Record<string, unknown>>;
};

export type AskOption = string | {
	label: string;
	value?: string;
	description?: string;
};

export type AskAction =
	| { requestId: string; kind: "confirm"; confirmed: boolean }
	| { requestId: string; kind: "option"; option: string }
	| { requestId: string; kind: "cancel" };

type AskButtonValue = {
	action: string;
	requestId: string;
	kind: "confirm" | "option" | "cancel";
	confirmed?: boolean;
	option?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * 归一化 pi 扩展传来的选项。扩展协议允许 string 或带 label/value 的对象；
 * 飞书按钮展示 label，但必须把 value 原样带回，不能因对象选项被丢弃而降级成输入卡。
 */
export function normalizeAskOption(value: unknown): AskOption | undefined {
	if (typeof value === "string") return value.trim() ? value : undefined;
	if (!isRecord(value)) return undefined;
	const record = value;
	if (typeof record.label !== "string" || !record.label.trim()) return undefined;
	const label = record.label;
	return {
		label,
		value: typeof record.value === "string" && record.value ? record.value : label,
		description: typeof record.description === "string" ? record.description : undefined,
	};
}


/** 解码批量 ask 的 title envelope（与 AgentManager.tryParseBatchAskEnvelope 同构）。 */
export function tryParseBatchAskEnvelope(title: string): {
	review: boolean;
	questions: Array<Record<string, unknown>>;
} | undefined {
	const raw = title.trim();
	if (!raw.startsWith("{")) return undefined;
	try {
		const parsed = JSON.parse(raw) as Record<string, unknown>;
		if (parsed.__piDeckBatchAsk !== 1 || !Array.isArray(parsed.questions)) {
			return undefined;
		}
		const questions = parsed.questions.filter(
			(question): question is Record<string, unknown> => {
				if (!question || typeof question !== "object") return false;
				const typed = question as Record<string, unknown>;
				return (
					typeof typed.id === "string" &&
					typeof typed.question === "string" &&
					["select", "confirm", "input", "editor"].includes(String(typed.type))
				);
			},
		);
		return questions.length > 0
			? { review: parsed.review === true, questions }
			: undefined;
	} catch {
		return undefined;
	}
}

/** 构建飞书提问卡片：select 给选项按钮、confirm 给确认/取消、input/editor 提示直接回复文本。 */
export function buildAskCard(input: { request: AskUiRequest; locale?: FeishuLocale }): Record<string, unknown> {
	const { request, locale = "zh-CN" } = input;
	const elements: object[] = [];

	if (request.method === "batch_ask" && request.batchQuestions) {
		const lines = request.batchQuestions
			.slice(0, 5)
			.map((question, index) => `${index + 1}. ${String(question.question ?? "")}`)
			.join("\n");
		elements.push({ tag: "markdown", content: lines });
		elements.push({ tag: "note", elements: [{ tag: "plain_text", content: feishuT(locale, "ask.batchHint") }] });
	} else if (request.method === "select" && request.options && request.options.length > 0) {
		const descriptions = request.options
			.filter((option): option is { label: string; description: string } => (
				typeof option !== "string" && typeof option.description === "string" && option.description.trim().length > 0
			))
			.map((option) => `**${option.label}**：${option.description}`);
		if (descriptions.length > 0) {
			elements.push({ tag: "markdown", content: descriptions.join("\n") });
		}
		elements.push({ tag: "markdown", content: request.title });
		for (const row of chunk(request.options.slice(0, MAX_OPTION_BUTTONS), BUTTONS_PER_ROW)) {
			elements.push({
				tag: "action",
				layout: "flow",
				actions: row.map((option) => optionButton(option, request.requestId)),
			});
		}
		if (request.options.length > MAX_OPTION_BUTTONS) {
			elements.push({
				tag: "note",
				elements: [{ tag: "plain_text", content: feishuT(locale, "ask.optionOverflow", { shown: MAX_OPTION_BUTTONS, total: request.options.length }) }],
			});
		} else {
			elements.push({ tag: "note", elements: [{ tag: "plain_text", content: feishuT(locale, "ask.optionHint") }] });
		}
	} else {
		// input / editor / 无选项 select：直接回复文本作答
		elements.push({ tag: "markdown", content: request.title || feishuT(locale, "ask.titleInput") });
		elements.push({ tag: "note", elements: [{ tag: "plain_text", content: feishuT(locale, "ask.inputHint") }] });
	}

	const cancelRow = {
		tag: "action",
		layout: "flow",
		actions: [cancelButton(request.requestId)],
	};
	if (request.method === "confirm") {
		elements.push({
			tag: "action",
			layout: "flow",
			actions: [
				{ ...confirmButton(request.requestId, true), text: { tag: "plain_text", content: feishuT(locale, "ask.confirm") } },
				{ ...confirmButton(request.requestId, false), text: { tag: "plain_text", content: feishuT(locale, "ask.reject") }, type: "default" },
			],
		});
	} else if (request.method !== "select" || !request.options?.length) {
		elements.push(cancelRow);
	} else {
		elements.push(cancelRow);
	}

	return {
		config: { wide_screen_mode: true, update_multi: true },
		header: { title: { tag: "plain_text", content: askTitle(request, locale) }, template: "orange" },
		elements,
	};
}

/** 解析卡片按钮回传的 action value，非法/非 ask 一律 undefined。 */
export function parseAskActionValue(value: unknown): AskAction | undefined {
	if (!value || typeof value !== "object") return undefined;
	const v = value as Record<string, unknown>;
	if (v.action !== ASK_ACTION || typeof v.requestId !== "string" || !v.requestId.trim()) {
		return undefined;
	}
	if (v.kind === "confirm") {
		return { requestId: v.requestId, kind: "confirm", confirmed: v.confirmed !== false };
	}
	if (v.kind === "cancel") {
		return { requestId: v.requestId, kind: "cancel" };
	}
	if (v.kind === "option" && typeof v.option === "string" && v.option.trim()) {
		return { requestId: v.requestId, kind: "option", option: v.option };
	}
	return undefined;
}

function askTitle(request: AskUiRequest, locale: FeishuLocale): string {
	switch (request.method) {
		case "confirm": return feishuT(locale, "ask.titleConfirm");
		case "select": return feishuT(locale, "ask.titleSelect");
		case "batch_ask": return feishuT(locale, "ask.titleBatch");
		default: return feishuT(locale, "ask.titleInput");
	}
}

function optionButton(option: AskOption, requestId: string) {
	const normalized = normalizeAskOption(option);
	const label = normalized
		? typeof normalized === "string" ? normalized : normalized.label
		: "";
	const value = normalized
		? typeof normalized === "string" ? normalized : normalized.value ?? normalized.label
		: "";
	return {
		tag: "button",
		text: { tag: "plain_text", content: truncateButtonText(label) },
		type: "primary" as const,
		value: { action: ASK_ACTION, requestId, kind: "option", option: value } satisfies AskButtonValue,
	};
}

function confirmButton(requestId: string, confirmed: boolean) {
	return {
		tag: "button",
		type: (confirmed ? "primary" : "default") as "primary" | "default",
		value: { action: ASK_ACTION, requestId, kind: "confirm", confirmed } satisfies AskButtonValue,
	};
}

function cancelButton(requestId: string) {
	return {
		tag: "button",
		text: { tag: "plain_text", content: "✕ 取消" },
		type: "default" as const,
		value: { action: ASK_ACTION, requestId, kind: "cancel" } satisfies AskButtonValue,
	};
}

function truncateButtonText(text: string): string {
	return text.length > MAX_BUTTON_TEXT ? `${text.slice(0, MAX_BUTTON_TEXT - 1)}…` : text;
}

function chunk<T>(items: T[], size: number): T[][] {
	const rows: T[][] = [];
	for (let i = 0; i < items.length; i += size) rows.push(items.slice(i, i + size));
	return rows;
}
