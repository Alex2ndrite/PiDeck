/**
 * 每日用量堆叠柱状图（自绘 SVG）。
 *
 * 视图切换：日（近 30 天）/ 周（近 12 周聚合）/ 月（近 12 月聚合）。
 * 每根柱按 provider 堆叠，provider 颜色来自固定色板（不足时循环）。
 * hover 显示当日总量（SVG <title>）。
 */

import { useMemo, useState } from "react";
import type { UsageAggregated, UsageDayRow } from "../../../../../shared/types";
import { t } from "../../../i18n";
import { Button } from "../../ui-shadcn/button";
import { colorForProvider } from "./providerColors";
import { formatTokens } from "./format";

type RangeMode = "day" | "week" | "month";

/** 近 N 天/周/月聚合桶：label + 总量 + provider 分解。 */
type Bucket = {
  label: string;
  tokens: number;
  byProvider: Array<{ provider: string; tokens: number }>;
};

const DAY_MS = 24 * 3600 * 1000;

function buildBuckets(rows: UsageDayRow[], mode: RangeMode, now: Date): Bucket[] {
  if (rows.length === 0) return [];
  const last = new Date(rows[rows.length - 1].day + "T00:00:00");
  if (Number.isNaN(last.getTime())) return [];
  const end = Math.min(now.getTime(), last.getTime() + DAY_MS);

  if (mode === "day") {
    const start = end - 30 * DAY_MS;
    return rows
      .filter((r) => new Date(r.day + "T00:00:00").getTime() >= start)
      .map((r) => ({
        label: r.day.slice(5),
        tokens: r.totals.tokens,
        byProvider: r.byProvider.map((p) => ({ provider: p.provider, tokens: p.tokens })),
      }));
  }

  // 周 / 月：按本地周一起始 / 月起始聚合成桶（升序）
  const buckets = new Map<string, Bucket>();
  for (const r of rows) {
    const d = new Date(r.day + "T00:00:00");
    let key: string;
    let label: string;
    if (mode === "week") {
      const monday = new Date(d);
      monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
      // 本地日期键（不用 toISOString，避免 UTC 偏移导致标签错位一天）
      const m = String(monday.getMonth() + 1).padStart(2, "0");
      const day = String(monday.getDate()).padStart(2, "0");
      key = `${monday.getFullYear()}-${m}-${day}`;
      label = key.slice(5);
    } else {
      key = r.day.slice(0, 7);
      label = key;
    }
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { label, tokens: 0, byProvider: [] };
      buckets.set(key, bucket);
    }
    bucket.tokens += r.totals.tokens;
    for (const p of r.byProvider) {
      const existing = bucket.byProvider.find((b) => b.provider === p.provider);
      if (existing) {
        existing.tokens += p.tokens;
      } else {
        bucket.byProvider.push({ provider: p.provider, tokens: p.tokens });
      }
    }
  }
  const sorted = [...buckets.values()];
  const limit = mode === "week" ? 12 : 12;
  return sorted.slice(Math.max(0, sorted.length - limit));
}

const RANGE_LABELS: Record<RangeMode, string> = {
  day: t("usageStats.daily.rangeDay"),
  week: t("usageStats.daily.rangeWeek"),
  month: t("usageStats.daily.rangeMonth"),
};

const CHART_HEIGHT = 140;
const BAR_MIN_HEIGHT = 1;

export function UsageDailyChart(props: { data: UsageAggregated }) {
  const [mode, setMode] = useState<RangeMode>("day");
  const { data } = props;

  const buckets = useMemo(
    () => buildBuckets(data.daily, mode, new Date()),
    [data.daily, mode],
  );
  const maxTokens = useMemo(
    () => Math.max(1, ...buckets.map((b) => b.tokens)),
    [buckets],
  );

  const width = Math.max(320, buckets.length * 22);
  const barWidth = 14;

  return (
    <div className="usage-stats-chart">
      <div className="usage-stats-chart-toolbar">
        {(["day", "week", "month"] as RangeMode[]).map((m) => (
          <Button
            key={m}
            variant={mode === m ? "default" : "ghost"}
            size="sm"
            onClick={() => setMode(m)}
          >
            {RANGE_LABELS[m]}
          </Button>
        ))}
      </div>
      {buckets.length === 0 ? (
        <div className="usage-stats-hint">{t("usageStats.table.empty")}</div>
      ) : (
        <svg
          width={width}
          height={CHART_HEIGHT}
          viewBox={`0 0 ${width} ${CHART_HEIGHT}`}
          role="img"
          aria-label={t("usageStats.daily.title")}
        >
          {buckets.map((bucket, index) => {
            const x = index * 22 + 4;
            const barHeight = Math.max(
              BAR_MIN_HEIGHT,
              (bucket.tokens / maxTokens) * (CHART_HEIGHT - 20),
            );
            const y = CHART_HEIGHT - 16 - barHeight;
            let cursor = y;
            const segments = bucket.byProvider
              .slice()
              .sort((a, b) => b.tokens - a.tokens)
              .map((p) => {
                const h = Math.max(
                  BAR_MIN_HEIGHT,
                  (p.tokens / maxTokens) * (CHART_HEIGHT - 20),
                );
                const seg = { ...p, y: cursor, h };
                cursor += h;
                return seg;
              });
            return (
              <g key={index}>
                <title>
                  {t("usageStats.daily.tooltip", { label: bucket.label, tokens: formatTokens(bucket.tokens) })}
                </title>
                {segments.map((seg, si) => (
                  <rect
                    key={si}
                    x={x}
                    y={seg.y}
                    width={barWidth}
                    height={seg.h}
                    fill={colorForProvider(seg.provider)}
                    rx={1}
                  >
                    <title>
                      {t("usageStats.daily.providerTooltip", { provider: seg.provider, tokens: formatTokens(seg.tokens) })}
                    </title>
                  </rect>
                ))}
                <text
                  x={x + barWidth / 2}
                  y={CHART_HEIGHT - 4}
                  fontSize={8}
                  fill="rgba(127,127,127,0.8)"
                  textAnchor="middle"
                >
                  {bucket.label}
                </text>
              </g>
            );
          })}
        </svg>
      )}
    </div>
  );
}
