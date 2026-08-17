import type { SupportedLocale } from "../i18n";

/** 上游字段是已使用百分比；界面按产品语义统一转换为剩余额度。 */
export function remainingQuotaPercent(usedPercent: number): number {
	if (!Number.isFinite(usedPercent)) return 0;
	const normalizedUsed = Math.max(0, Math.min(100, usedPercent));
	return 100 - normalizedUsed;
}

/** 将绝对重置时间格式化到分钟；不再用“约 N 天”隐藏实际的时间点。 */
export function formatQuotaResetAt(
	resetsAt: number | null,
	locale: SupportedLocale,
	timeZone?: string,
): string | null {
	if (resetsAt === null || !Number.isFinite(resetsAt)) return null;
	const date = new Date(resetsAt);
	if (Number.isNaN(date.getTime())) return null;
	return new Intl.DateTimeFormat(locale === "pseudo" ? "en-US" : locale, {
		year: "numeric",
		month: "long",
		day: "numeric",
		hour: "2-digit",
		minute: "2-digit",
		...(timeZone ? { timeZone } : {}),
	}).format(date);
}
