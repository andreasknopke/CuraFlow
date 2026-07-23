/**
 * Master absence chart utilities.
 *
 * Pure functions that transform the yearly absence-stats payload
 * (GET /api/master/absence-stats) into Recharts data sets.
 * No React, no side effects — testable in isolation.
 *
 * @module master/utils/absenceChartUtils
 */

import type { AbsenceMonthlyPoint } from '@/types/master';

// ── Types ──────────────────────────────────────────────────────────────────

/** One bar in the monthly stacked chart: total days per absence type. */
export interface MonthlyTypePoint {
  month: number;
  label: string;
  [absenceType: string]: number | string;
}

/** One slice in the yearly distribution chart. */
export interface TypeSharePoint {
  type: string;
  days: number;
  /** Percentage of all counted absence days (0–100, rounded). */
  share: number;
}

// ── Transformers ───────────────────────────────────────────────────────────

/**
 * Maps the per-month `{ days: { type: count } }` payload to flat rows
 * (`{ month, label, [type]: count }`) consumable by a stacked BarChart.
 * Months missing from the payload are filled with zeros so the chart
 * always spans the full year.
 */
export function toMonthlyTypeData(
  monthly: AbsenceMonthlyPoint[],
  types: readonly string[],
): MonthlyTypePoint[] {
  const byMonth = new Map(monthly.map((p) => [p.month, p]));
  return Array.from({ length: 12 }, (_, i) => {
    const month = i + 1;
    const source = byMonth.get(month);
    const point: MonthlyTypePoint = {
      month,
      label: source?.label ?? String(month),
    };
    for (const type of types) {
      point[type] = source?.days[type] ?? 0;
    }
    return point;
  });
}

/**
 * Computes the yearly distribution per absence type (for the donut chart),
 * dropping types with zero days. Shares are rounded percentages relative
 * to the sum of the given `types` (not necessarily all types in `byType`).
 */
export function toTypeShareData(
  byType: Record<string, number>,
  types: readonly string[],
): TypeSharePoint[] {
  const total = types.reduce((sum, t) => sum + (byType[t] ?? 0), 0);
  return types
    .map((type) => ({
      type,
      days: byType[type] ?? 0,
      share: total > 0 ? Math.round(((byType[type] ?? 0) / total) * 100) : 0,
    }))
    .filter((p) => p.days > 0);
}
