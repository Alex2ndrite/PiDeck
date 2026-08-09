/**
 * 用量统计设置页 Tab。
 *
 * 数据源：pi-tracker 扩展日志（主进程聚合后整体下发，渲染层不接触原始日志）。
 * 三态：未安装（引导卡）/ 加载中 / 数据视图（空数据有专门空态）。
 * 图表为自绘 SVG（UsageHeatmap / UsageDailyChart），不引入图表库。
 */

import { useCallback, useEffect, useState } from "react";
import type {
  UsageAggregated,
  UsageStatsDetectResult,
} from "../../../../../shared/types";
import { t } from "../../../i18n";
import { Button } from "../../ui-shadcn/button";
import { UsageHeatmap } from "../usageStats/UsageHeatmap";
import { UsageDailyChart } from "../usageStats/UsageDailyChart";
import { formatCost, formatTokens } from "../usageStats/format";

type Phase = "loading" | "missing" | "ready" | "error";

/** 日期戳（ms）→ "YYYY-MM-DD" 本地格式。 */
function dateKey(ts: number): string {
  const d = new Date(ts);
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

function SummaryCard(props: { label: string; value: React.ReactNode; sub?: string }) {
  return (
    <div className="usage-stats-card">
      <div className="usage-stats-card-label">{props.label}</div>
      <div className="usage-stats-card-value">{props.value}</div>
      {props.sub && <div className="usage-stats-card-sub">{props.sub}</div>}
    </div>
  );
}

function CostValue(props: { cost: number; costKnown: boolean }) {
  return (
    <span title={props.costKnown ? undefined : t("usageStats.cards.costUnknown")}>
      {formatCost(props.cost)}
      {!props.costKnown && <span className="usage-stats-unknown"> *</span>}
    </span>
  );
}

function NotInstalledCard(props: { onRefresh: () => void }) {
  return (
    <section className="settings-section">
      <div className="settings-section-header">
        <strong>{t("usageStats.notInstalled.title")}</strong>
      </div>
      <div className="settings-section-body usage-stats-not-installed">
        <p>{t("usageStats.notInstalled.desc")}</p>
        <code className="usage-stats-code">pi install npm:pi-tracker</code>
        <p className="usage-stats-hint">{t("usageStats.notInstalled.installHint")}</p>
        <p className="usage-stats-hint">{t("usageStats.notInstalled.backfill")}</p>
        <Button variant="secondary" size="sm" onClick={props.onRefresh}>
          {t("usageStats.refresh")}
        </Button>
      </div>
    </section>
  );
}

function UsageRows(props: { data: UsageAggregated }) {
  const { data } = props;
  const days = Math.max(
    1,
    Math.round((data.window.to - data.window.since) / 86400000) + 1,
  );
  return (
    <>
      <div className="usage-stats-cards">
        <SummaryCard
          label={t("usageStats.cards.totalTokens")}
          value={formatTokens(data.totals.tokens)}
          sub={t("usageStats.cards.today") + " " + formatTokens(data.today.tokens)}
        />
        <SummaryCard
          label={t("usageStats.cards.totalCost")}
          value={<CostValue cost={data.totals.cost} costKnown={data.costKnown} />}
          sub={t("usageStats.cards.month") + " " + formatCost(data.thisMonth.cost)}
        />
        <SummaryCard
          label={t("usageStats.cards.turns")}
          value={String(data.totals.turns)}
          sub={t("usageStats.cards.week") + " " + data.thisWeek.turns}
        />
        <SummaryCard
          label={t("usageStats.cards.activeDays")}
          value={String(data.activeDays)}
          sub={t("usageStats.window", { since: dateKey(data.window.since), days })}
        />
      </div>
      <section className="settings-section">
        <div className="settings-section-header">
          <strong>{t("usageStats.heatmap.title")}</strong>
        </div>
        <div className="settings-section-body">
          <UsageHeatmap data={data} />
        </div>
      </section>
      <section className="settings-section">
        <div className="settings-section-header">
          <strong>{t("usageStats.daily.title")}</strong>
        </div>
        <div className="settings-section-body">
          <UsageDailyChart data={data} />
        </div>
      </section>
      <section className="settings-section">
        <div className="settings-section-header">
          <strong>{t("usageStats.models.title")}</strong>
        </div>
        <div className="settings-section-body">
          <UsageTable
            headers={[
              t("usageStats.models.col.model"),
              t("usageStats.models.col.tokens"),
              t("usageStats.models.col.cost"),
              t("usageStats.models.col.turns"),
              t("usageStats.models.col.sessions"),
            ]}
            rows={data.byModel.map((m) => [
              m.model,
              formatTokens(m.tokens),
              formatCost(m.cost),
              String(m.turns),
              String(m.sessions),
            ])}
          />
        </div>
      </section>
      <section className="settings-section">
        <div className="settings-section-header">
          <strong>{t("usageStats.projects.title")}</strong>
        </div>
        <div className="settings-section-body">
          <UsageTable
            headers={[
              t("usageStats.projects.col.project"),
              t("usageStats.models.col.tokens"),
              t("usageStats.models.col.cost"),
              t("usageStats.models.col.turns"),
            ]}
            rows={data.byProject.map((p) => [
              p.project,
              formatTokens(p.tokens),
              formatCost(p.cost),
              String(p.turns),
            ])}
          />
        </div>
      </section>
    </>
  );
}

function UsageTable(props: { headers: string[]; rows: string[][] }) {
  if (props.rows.length === 0) {
    return <div className="usage-stats-hint">{t("usageStats.table.empty")}</div>;
  }
  return (
    <table className="usage-stats-table">
      <thead>
        <tr>
          {props.headers.map((h, i) => (
            <th key={i}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {props.rows.slice(0, 12).map((row, ri) => (
          <tr key={ri}>
            {row.map((cell, ci) => (
              <td key={ci} title={ci === 0 ? cell : undefined}>
                {cell}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function UsageStatsTab() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [data, setData] = useState<UsageAggregated | null>(null);
  const [detect, setDetect] = useState<UsageStatsDetectResult | null>(null);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const detectResult = await window.piDesktop.usageStats.detect();
      setDetect(detectResult);
      if (!detectResult.installed) {
        setPhase("missing");
        return;
      }
      setRefreshing(true);
      const aggregated = await window.piDesktop.usageStats.get();
      setData(aggregated);
      setPhase("ready");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase("error");
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await window.piDesktop.usageStats.refresh();
      const aggregated = await window.piDesktop.usageStats.get();
      setData(aggregated);
      setPhase((prev) => (prev === "missing" && aggregated ? "ready" : prev));
      // 重试探测：可能刚装上插件
      const detectResult = await window.piDesktop.usageStats.detect();
      setDetect(detectResult);
      if (!aggregated && detectResult.installed) {
        // 已安装但没数据：切到 ready 显示空态
        setPhase("ready");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase("error");
    } finally {
      setRefreshing(false);
    }
  }, []);

  return (
    <div className="settings-section">
      <div className="settings-section-header">
        <strong>{t("settings.tabs.usage")}</strong>
        {detect?.logPath && <small className="usage-stats-path">{detect.logPath}</small>}
      </div>
      <div className="settings-section-body">
        {phase === "loading" && <div className="usage-stats-hint">{t("usageStats.loading")}</div>}
        {phase === "missing" && <NotInstalledCard onRefresh={refresh} />}
        {phase === "error" && (
          <div className="usage-stats-hint">
            {t("usageStats.error")}
            <br />
            <small>{t("usageStats.errorHint", { message: error })}</small>
          </div>
        )}
        {phase === "ready" && data && data.recordCount > 0 && <UsageRows data={data} />}
        {phase === "ready" && (!data || data.recordCount === 0) && (
          <div className="usage-stats-hint">
            {t("usageStats.empty.title")}
            <br />
            <small>{t("usageStats.empty.desc")}</small>
          </div>
        )}
        {(phase === "ready" || phase === "missing") && (
          <Button
            variant="secondary"
            size="sm"
            className="usage-stats-refresh"
            onClick={refresh}
            disabled={refreshing}
            loading={refreshing}
          >
            {refreshing ? t("usageStats.refreshing") : t("usageStats.refresh")}
          </Button>
        )}
      </div>
    </div>
  );
}
