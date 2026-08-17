import { useEffect, useState, type ReactNode } from "react";
import type { OpenAiCodexQuotaResult, UsageAggregated, UsageStatsDetectResult } from "../../../../../shared/types";
import { t, type TranslationKey } from "../../../i18n";
import { Button } from "../../ui-shadcn/button";
import { Progress } from "../../ui-shadcn/progress";
import { UsageDailyChart } from "./UsageDailyChart";
import { UsageDayDetail } from "./UsageDayDetail";
import { UsageHeatmap } from "./UsageHeatmap";
import { UsageTable } from "./UsageTable";
import { OpenAiCodexQuotaOverview } from "./OpenAiCodexQuotaOverview";
import { formatCost, formatTokens } from "./format";
import {
  buildTokenBreakdown,
  buildUsagePeriodRows,
  type TokenBreakdownKey,
  type UsagePeriodKey,
} from "./usageDashboardMetrics";

type DashboardPhase = "loading" | "missing" | "ready" | "error";

type Props = {
  phase: DashboardPhase;
  data: UsageAggregated | null;
  detect: UsageStatsDetectResult | null;
  error: string;
  refreshing: boolean;
  onRefresh: () => Promise<void>;
  quotaResult: OpenAiCodexQuotaResult | null;
  quotaLoading: boolean;
};

function DashboardCard(props: { title: string; description?: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-border-subtle bg-bg-panel p-4 shadow-xs sm:p-5">
      <div className="mb-3">
        <h2 className="text-sm font-semibold text-foreground">{props.title}</h2>
        {props.description && <p className="mt-1 text-xs leading-5 text-muted-foreground">{props.description}</p>}
      </div>
      {props.children}
    </section>
  );
}

function StatusNotice(props: { tone: "error" | "muted"; children: ReactNode }) {
  return (
    <div
      role={props.tone === "error" ? "alert" : undefined}
      className={props.tone === "error"
        ? "rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-sm text-destructive"
        : "rounded-lg border border-border-subtle bg-bg-muted px-3 py-3 text-sm text-muted-foreground"}
    >
      {props.children}
    </div>
  );
}

function CostValue(props: { cost: number; costKnown: boolean }) {
  return (
    <span title={props.costKnown ? undefined : t("usageStats.cards.costUnknown")} className="tabular-nums">
      {formatCost(props.cost)}
      {!props.costKnown && <span className="ml-0.5 text-warning" aria-label={t("usageStats.cards.costUnknown")}>*</span>}
    </span>
  );
}

function NotInstalledCard(props: { onRefresh: () => Promise<void> }) {
  const [installing, setInstalling] = useState(false);
  const [installed, setInstalled] = useState(false);
  const [copied, setCopied] = useState(false);
  const [installError, setInstallError] = useState("");
  const installCmd = "pi install npm:pi-tracker";

  useEffect(() => {
    if (!copied) return undefined;
    const timeoutId = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timeoutId);
  }, [copied]);

  const install = async () => {
    setInstalling(true);
    setInstallError("");
    try {
      await window.piDesktop.extensions.install("npm:pi-tracker");
      setInstalled(true);
      await props.onRefresh();
    } catch (error) {
      setInstallError(error instanceof Error ? error.message : String(error));
    } finally {
      setInstalling(false);
    }
  };

  const copyCommand = async () => {
    try {
      await navigator.clipboard.writeText(installCmd);
      setCopied(true);
    } catch {
      setInstallError(t("usageStats.notInstalled.copyFailed"));
    }
  };

  return (
    <DashboardCard title={t("usageStats.notInstalled.title")} description={t("usageStats.notInstalled.desc")}>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="default" size="sm" onClick={install} disabled={installing || installed} loading={installing}>
          {installing ? t("usageStats.notInstalled.installing") : installed ? t("usageStats.notInstalled.installed") : t("usageStats.notInstalled.install")}
        </Button>
        <code className="max-w-full break-all rounded-md border border-border-subtle bg-bg-muted px-2 py-1 text-xs text-muted-foreground">{installCmd}</code>
        <Button variant="ghost" size="sm" onClick={copyCommand}>
          {copied ? t("usageStats.notInstalled.copied") : t("usageStats.notInstalled.copyCmd")}
        </Button>
      </div>
      {installError && <p className="mt-3 text-sm text-destructive">{t("usageStats.notInstalled.installError", { message: installError })}</p>}
      {installed && <p className="mt-3 text-xs leading-5 text-muted-foreground">{t("usageStats.notInstalled.installDone")}</p>}
      <p className="mt-2 text-xs leading-5 text-muted-foreground">{t("usageStats.notInstalled.restartHint")}</p>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">{t("usageStats.notInstalled.backfill")}</p>
    </DashboardCard>
  );
}

function periodLabel(key: UsagePeriodKey): string {
  switch (key) {
    case "today": return t("usageStats.period.today");
    case "thisWeek": return t("usageStats.period.week");
    case "thisMonth": return t("usageStats.period.month");
    default: return t("usageStats.period.total");
  }
}

const TOKEN_LABELS: Record<TokenBreakdownKey, TranslationKey> = {
  input: "usageStats.token.input",
  output: "usageStats.token.output",
  cacheRead: "usageStats.token.cacheRead",
  cacheWrite: "usageStats.token.cacheWrite",
};

function ReadyDashboard(props: { data: UsageAggregated }) {
  const { data } = props;
  const periodRows = buildUsagePeriodRows(data);
  const tokenRows = buildTokenBreakdown(data.totals);
  const days = Math.max(1, Math.round((data.window.to - data.window.since) / 86400000) + 1);

  return (
    <div className="space-y-4">
      <DashboardCard title={t("usageStats.sections.current")} description={t("usageStats.sections.currentDesc")}>
        <div className="divide-y divide-border-subtle">
          {periodRows.map((row) => (
            <div key={row.key} className="grid gap-2 py-3 first:pt-0 last:pb-0 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
              <div>
                <div className="text-sm font-medium text-foreground">{periodLabel(row.key)}</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {t("usageStats.metric.turns", { count: row.turns })} · {t("usageStats.metric.sessions", { count: row.sessions })}{row.key === "total" && ` · ${t("usageStats.metric.activeDays", { count: row.activeDays })}`}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-right text-sm">
                <span className="font-semibold tabular-nums text-foreground">{formatTokens(row.tokens)} {t("usageStats.metric.tokensShort")}</span>
                <CostValue cost={row.cost} costKnown={row.costKnown} />
              </div>
            </div>
          ))}
        </div>
      </DashboardCard>

      <DashboardCard title={t("usageStats.sections.tokens")} description={t("usageStats.sections.tokensDesc")}>
        <div className="divide-y divide-border-subtle">
          {tokenRows.map((row) => (
            <div key={row.key} className="grid gap-2 py-3 first:pt-0 last:pb-0 sm:grid-cols-[minmax(0,1fr)_minmax(180px,2fr)] sm:items-center">
              <div className="flex min-w-0 items-center justify-between gap-3 sm:block">
                <span className="text-sm text-foreground">{t(TOKEN_LABELS[row.key])}</span>
                <span className="text-xs tabular-nums text-muted-foreground sm:mt-1 sm:block">{formatTokens(row.tokens)}</span>
              </div>
              <div className="flex items-center gap-3">
                <Progress value={row.percentage} aria-label={t("usageStats.token.percentage", { name: t(TOKEN_LABELS[row.key]), percentage: row.percentage.toFixed(1) })} aria-valuenow={row.percentage} aria-valuemin={0} aria-valuemax={100} />
                <span className="w-12 shrink-0 text-right text-xs tabular-nums text-muted-foreground">{row.percentage.toFixed(1)}%</span>
              </div>
            </div>
          ))}
        </div>
      </DashboardCard>

      <DashboardCard title={t("usageStats.sections.activity")} description={`${t("usageStats.metric.activeDays", { count: data.activeDays })} · ${t("usageStats.window", { since: new Date(data.window.since).toLocaleDateString(), days })}`}>
        <div className="grid gap-4 xl:grid-cols-2">
          <div className="min-w-0 overflow-x-auto rounded-lg border border-border-subtle p-3"><h3 className="mb-2 text-xs font-medium text-muted-foreground">{t("usageStats.heatmap.title")}</h3><UsageHeatmap data={data} /></div>
          <div className="min-w-0 overflow-x-auto rounded-lg border border-border-subtle p-3"><h3 className="mb-2 text-xs font-medium text-muted-foreground">{t("usageStats.daily.title")}</h3><UsageDailyChart data={data} /></div>
        </div>
      </DashboardCard>

      <UsageDayDetail rows={data.daily} costKnown={data.costKnown} />
      <DashboardCard title={t("usageStats.models.title")}>
        <div className="overflow-x-auto">
          <UsageTable headers={[t("usageStats.models.col.model"), t("usageStats.models.col.tokens"), t("usageStats.models.col.cost"), t("usageStats.models.col.turns"), t("usageStats.models.col.sessions")]} rows={data.byModel.map((m) => [m.model, formatTokens(m.tokens), formatCost(m.cost), String(m.turns), String(m.sessions)])} />
        </div>
      </DashboardCard>
      <DashboardCard title={t("usageStats.projects.title")}>
        <div className="overflow-x-auto">
          <UsageTable headers={[t("usageStats.projects.col.project"), t("usageStats.models.col.tokens"), t("usageStats.models.col.cost"), t("usageStats.models.col.turns")]} rows={data.byProject.map((p) => [p.project, formatTokens(p.tokens), formatCost(p.cost), String(p.turns)])} />
        </div>
      </DashboardCard>
    </div>
  );
}

export function UsageDashboardSection(props: Props) {
  const { phase, data, detect, error, refreshing, onRefresh, quotaResult, quotaLoading } = props;
  const hasData = data != null && data.recordCount > 0;
  const showError = phase === "error" || Boolean(error);

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold tracking-tight text-foreground">{t("usageStats.page.title")}</h1>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">{t("usageStats.page.description")}</p>
          {detect?.logPath && <p className="mt-2 break-all text-xs text-muted-foreground">{t("usageStats.page.source", { path: detect.logPath })}</p>}
        </div>
        <Button variant="secondary" size="sm" onClick={onRefresh} disabled={refreshing || phase === "loading"} loading={refreshing}>
          {refreshing ? t("usageStats.refreshing") : t("usageStats.refresh")}
        </Button>
      </header>

      <OpenAiCodexQuotaOverview result={quotaResult} loading={quotaLoading} />

      {phase === "loading" && <StatusNotice tone="muted">{t("usageStats.loading")}</StatusNotice>}
      {phase === "missing" && <NotInstalledCard onRefresh={onRefresh} />}
      {showError && (
        <StatusNotice tone="error">
          <div>{t("usageStats.error")}</div>
          {error && <div className="mt-1 break-words text-xs opacity-80">{t("usageStats.errorHint", { message: error })}</div>}
          <Button className="mt-2" variant="outline" size="sm" onClick={onRefresh} disabled={refreshing} loading={refreshing}>{t("usageStats.retry")}</Button>
        </StatusNotice>
      )}
      {phase === "ready" && hasData && data && <ReadyDashboard data={data} />}
      {phase === "ready" && !hasData && (
        <DashboardCard title={t("usageStats.empty.title")}>
          <p className="text-sm leading-6 text-muted-foreground">{t("usageStats.empty.desc")}</p>
          <p className="mt-2 text-xs leading-5 text-muted-foreground">{t("usageStats.empty.backfill")}</p>
        </DashboardCard>
      )}
    </div>
  );
}
