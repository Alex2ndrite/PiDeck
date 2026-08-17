import test from "node:test";
import assert from "node:assert/strict";
import { buildTokenBreakdown, buildUsagePeriodRows } from "../src/renderer/src/components/app/usageStats/usageDashboardMetrics.ts";

function totals(overrides = {}) {
  return {
    tokens: 100,
    input: 40,
    output: 30,
    cacheRead: 20,
    cacheWrite: 10,
    cost: 1.5,
    turns: 4,
    sessions: ["session-1"],
    ...overrides,
  };
}

function data(overrides = {}) {
  const base = totals();
  return {
    window: { since: 1, to: 2 },
    totals: base,
    today: totals({ tokens: 1, turns: 2, sessions: ["today"] }),
    thisWeek: totals({ tokens: 2, turns: 3, sessions: ["week"] }),
    thisMonth: totals({ tokens: 3, turns: 4, sessions: ["month"] }),
    activeDays: 1,
    daily: [],
    heatmap: [],
    heatmapStart: "2026-01-01",
    byModel: [],
    byProject: [],
    costKnown: true,
    recordCount: 4,
    ...overrides,
  };
}

test("maps today, week, month, and total without mutating the DTO", () => {
  const input = data();
  const snapshot = JSON.stringify(input);
  const rows = buildUsagePeriodRows(input);
  assert.deepEqual(rows.map((row) => row.key), ["today", "thisWeek", "thisMonth", "total"]);
  assert.deepEqual(rows.map((row) => row.tokens), [1, 2, 3, 100]);
  assert.equal(rows[3].sessions, 1);
  assert.equal(rows[3].activeDays, 1);
  assert.equal(JSON.stringify(input), snapshot);
});

test("calculates four token composition percentages", () => {
  const rows = buildTokenBreakdown(totals());
  assert.deepEqual(rows.map((row) => row.percentage), [40, 30, 20, 10]);
  assert.equal(rows.reduce((sum, row) => sum + row.percentage, 0), 100);
});

test("returns zero percentages for all-zero input without NaN or Infinity", () => {
  const rows = buildTokenBreakdown(totals({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }));
  assert.deepEqual(rows.map((row) => row.percentage), [0, 0, 0, 0]);
  assert.ok(rows.every((row) => Number.isFinite(row.percentage)));
});

test("clamps invalid negative token values to a safe progress range", () => {
  const rows = buildTokenBreakdown(totals({ input: -10, output: 30, cacheRead: 0, cacheWrite: 0 }));
  assert.equal(rows[0].tokens, 0);
  assert.ok(rows.every((row) => row.percentage >= 0 && row.percentage <= 100));
});

test("passes costKnown through each period row", () => {
  const rows = buildUsagePeriodRows(data({ costKnown: false }));
  assert.ok(rows.every((row) => row.costKnown === false));
});
