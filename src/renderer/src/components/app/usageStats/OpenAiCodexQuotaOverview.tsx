import { CalendarDays, Clock3, Gauge, LoaderCircle } from "lucide-react";
import type { OpenAiCodexQuotaResult, OpenAiCodexQuotaSnapshot, OpenAiCodexQuotaWindow } from "../../../../../shared/types";
import { getI18nLocale, t } from "../../../i18n";
import { formatQuotaResetAt, remainingQuotaPercent } from "../../../utils/openAiCodexQuotaDisplay";
import { Progress } from "../../ui-shadcn/progress";

function windowTitle(window: OpenAiCodexQuotaWindow): string {
	return window.limitWindowSeconds === 18_000 ? t("usageStats.quota.fiveHour") : t("usageStats.quota.weekly");
}

function QuotaWindowRow(props: { window: OpenAiCodexQuotaWindow; compact: boolean }) {
	const { window } = props;
	const remainingPercent = remainingQuotaPercent(window.usedPercent);
	const resetAt = formatQuotaResetAt(window.resetsAt, getI18nLocale());
	return (
		<div className={props.compact ? "space-y-1.5" : "space-y-2"}>
			<div className="flex items-center justify-between gap-2 text-xs">
				<div className="flex min-w-0 items-center gap-1.5 text-foreground">
					{window.limitWindowSeconds === 18_000 ? <Clock3 size={props.compact ? 13 : 15} aria-hidden="true" /> : <CalendarDays size={props.compact ? 13 : 15} aria-hidden="true" />}
					<span className="truncate">{windowTitle(window)}</span>
				</div>
				<span className="shrink-0 tabular-nums text-muted-foreground">{t("usageStats.quota.remainingPercent", { percentage: remainingPercent.toFixed(0) })}</span>
			</div>
			<Progress value={remainingPercent} aria-label={t("usageStats.quota.remainingPercent", { percentage: remainingPercent.toFixed(0) })} />
			<div className="flex justify-between gap-2 text-[11px] text-muted-foreground">
				<span>{t("usageStats.quota.resetsAt")}</span>
				<span className="tabular-nums">{resetAt ?? t("usageStats.quota.resetUnknown")}</span>
			</div>
		</div>
	);
}

function ErrorState(props: { result: Extract<OpenAiCodexQuotaResult, { status: "unavailable" | "stale" }> }) {
	const message = props.result.reason === "not-configured"
		? t("usageStats.quota.notConfigured")
		: props.result.reason === "expired"
			? t("usageStats.quota.expired")
			: props.result.reason === "unauthorized"
				? t("usageStats.quota.unauthorized")
				: props.result.reason === "forbidden"
					? t("usageStats.quota.forbidden")
				: props.result.reason === "invalid-response"
						? t("usageStats.quota.invalidResponse")
						: props.result.reason === "disabled"
							? t("usageStats.quota.disabled")
							: t("usageStats.quota.network");
	return <p className="text-xs leading-5 text-muted-foreground">{message}</p>;
}

function SnapshotBody(props: { snapshot: OpenAiCodexQuotaSnapshot; compact: boolean }) {
	const windows = [props.snapshot.fiveHour, props.snapshot.weekly].filter((window): window is OpenAiCodexQuotaWindow => window !== null);
	const accountAvailable = props.snapshot.allowed && !props.snapshot.limitReached;
	return (
		<div className={props.compact ? "space-y-3" : "space-y-4"}>
			<div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
				<span>{t("usageStats.quota.plan", { plan: props.snapshot.planType ?? t("usageStats.quota.planUnknown") })}</span>
				<span className={accountAvailable ? "text-muted-foreground" : "text-destructive"}>
					{props.snapshot.limitReached
						? t("usageStats.quota.limitReached")
						: props.snapshot.allowed
							? t("usageStats.quota.allowed")
							: t("usageStats.quota.unavailable")}
				</span>
			</div>
			{windows.length === 0 ? <p className="text-xs text-muted-foreground">{t("usageStats.quota.noWindows")}</p> : windows.map((window) => <QuotaWindowRow key={window.limitWindowSeconds} window={window} compact={props.compact} />)}
		</div>
	);
}

export function OpenAiCodexQuotaOverview(props: { result: OpenAiCodexQuotaResult | null; loading?: boolean; compact?: boolean }) {
	const compact = props.compact ?? false;
	return (
		<section className={compact ? "w-72 space-y-3" : "space-y-3 rounded-xl border border-border-subtle bg-bg-panel p-4 shadow-xs sm:p-5"} aria-label={t("usageStats.quota.title")}>
			<div className="flex items-center gap-2">
				<Gauge size={compact ? 15 : 17} className="text-primary" aria-hidden="true" />
				<h2 className="text-sm font-semibold text-foreground">{t("usageStats.quota.title")}</h2>
			</div>
			{props.loading && !props.result ? <div className="flex items-center gap-2 text-xs text-muted-foreground"><LoaderCircle size={13} className="animate-spin" aria-hidden="true" />{t("usageStats.quota.loading")}</div> : props.result?.status === "ready" ? <SnapshotBody snapshot={props.result.snapshot} compact={compact} /> : props.result?.status === "stale" ? <><SnapshotBody snapshot={props.result.snapshot} compact={compact} /><p className="text-xs text-warning">{t("usageStats.quota.stale")}</p><ErrorState result={props.result} /></> : props.result?.status === "unavailable" ? <ErrorState result={props.result} /> : <p className="text-xs text-muted-foreground">{t("usageStats.quota.loading")}</p>}
		</section>
	);
}
