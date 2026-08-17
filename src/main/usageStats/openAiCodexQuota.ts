import type {
	OpenAiCodexQuotaSnapshot,
	OpenAiCodexQuotaWindow,
} from "../../shared/types/usageStats";

const FIVE_HOUR_SECONDS = 18_000;
const WEEKLY_SECONDS = 604_800;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value);
}

function parseWindow(value: unknown, fetchedAt: number): OpenAiCodexQuotaWindow | null {
	if (!isRecord(value)) return null;
	const used = value.used_percent;
	const seconds = value.limit_window_seconds;
	if (!finiteNumber(used) || !finiteNumber(seconds) || !Number.isInteger(seconds) || seconds <= 0) return null;
	const resetAt = finiteNumber(value.reset_at) && value.reset_at > 0
		? Math.round(value.reset_at * 1000)
		: finiteNumber(value.reset_after_seconds) && value.reset_after_seconds >= 0
			? fetchedAt + Math.round(value.reset_after_seconds * 1000)
			: null;
	return {
		usedPercent: Math.min(100, Math.max(0, used)),
		limitWindowSeconds: seconds,
		resetsAt: resetAt,
	};
}

/** 将 wham/usage 的位置无关窗口归一化为 UI 使用的五小时/周字段。 */
export function parseOpenAiCodexQuota(value: unknown, fetchedAt = Date.now()): OpenAiCodexQuotaSnapshot | null {
	if (!isRecord(value)) return null;
	const rateLimit = value.rate_limit;
	if (!isRecord(rateLimit) || typeof rateLimit.allowed !== "boolean" || typeof rateLimit.limit_reached !== "boolean") {
		return null;
	}
	const candidates = [
		parseWindow(rateLimit.primary_window, fetchedAt),
		parseWindow(rateLimit.secondary_window, fetchedAt),
	];
	let fiveHour: OpenAiCodexQuotaWindow | null = null;
	let weekly: OpenAiCodexQuotaWindow | null = null;
	for (const candidate of candidates) {
		if (!candidate) continue;
		if (candidate.limitWindowSeconds === FIVE_HOUR_SECONDS) fiveHour = candidate;
		if (candidate.limitWindowSeconds === WEEKLY_SECONDS) weekly = candidate;
	}
	return {
		planType: typeof value.plan_type === "string" && value.plan_type.trim()
			? value.plan_type.trim()
			: null,
		allowed: rateLimit.allowed,
		limitReached: rateLimit.limit_reached,
		fiveHour,
		weekly,
		fetchedAt,
	};
}
