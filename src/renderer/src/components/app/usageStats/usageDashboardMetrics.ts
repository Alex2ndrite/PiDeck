import type { DayTotals, UsageAggregated } from "../../../../../shared/types";

export type UsagePeriodKey = "today" | "thisWeek" | "thisMonth" | "total";

export type UsagePeriodRow = {
  key: UsagePeriodKey;
  tokens: number;
  cost: number;
  turns: number;
  sessions: number;
  activeDays: number;
  costKnown: boolean;
};

export type TokenBreakdownKey = "input" | "output" | "cacheRead" | "cacheWrite";

export type TokenBreakdownRow = {
  key: TokenBreakdownKey;
  tokens: number;
  percentage: number;
};

function finiteNonNegative(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function periodRow(
  key: UsagePeriodKey,
  totals: DayTotals,
  costKnown: boolean,
  activeDays = 0,
): UsagePeriodRow {
  return {
    key,
    tokens: finiteNonNegative(totals.tokens),
    cost: finiteNonNegative(totals.cost),
    turns: Math.max(0, Math.trunc(finiteNonNegative(totals.turns))),
    sessions: totals.sessions.length,
    activeDays,
    costKnown,
  };
}

/** Map the existing aggregate DTO into the four compact dashboard rows. */
export function buildUsagePeriodRows(data: UsageAggregated): UsagePeriodRow[] {
  return [
    periodRow("today", data.today, data.costKnown),
    periodRow("thisWeek", data.thisWeek, data.costKnown),
    periodRow("thisMonth", data.thisMonth, data.costKnown),
    periodRow("total", data.totals, data.costKnown, data.activeDays),
  ];
}

/** Build safe token composition percentages without mutating the aggregate DTO. */
export function buildTokenBreakdown(totals: DayTotals): TokenBreakdownRow[] {
  const values: Array<[TokenBreakdownKey, number]> = [
    ["input", finiteNonNegative(totals.input)],
    ["output", finiteNonNegative(totals.output)],
    ["cacheRead", finiteNonNegative(totals.cacheRead)],
    ["cacheWrite", finiteNonNegative(totals.cacheWrite)],
  ];
  const denominator = values.reduce((sum, [, value]) => sum + value, 0);
  return values.map(([key, tokens]) => ({
    key,
    tokens,
    percentage: denominator > 0 ? Math.min(100, Math.max(0, (tokens / denominator) * 100)) : 0,
  }));
}
