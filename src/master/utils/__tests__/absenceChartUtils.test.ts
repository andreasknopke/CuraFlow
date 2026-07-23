import { describe, expect, it } from 'vitest';
import {
  toMonthlyTypeData,
  toTypeShareData,
} from '@/master/utils/absenceChartUtils';
import type { AbsenceMonthlyPoint } from '@/types/master';

const TYPES = ['Urlaub', 'Krank', 'Dienstreise'] as const;

function makeMonthlyPoint(month: number, days: Record<string, number>): AbsenceMonthlyPoint {
  return { month, label: `M${month}`, days };
}

describe('toMonthlyTypeData', () => {
  it('flattens per-type day counts into chart rows', () => {
    const monthly = [
      makeMonthlyPoint(1, { Urlaub: 3, Krank: 2, Dienstreise: 1 }),
      makeMonthlyPoint(2, { Urlaub: 0, Krank: 5, Dienstreise: 0 }),
    ];

    const result = toMonthlyTypeData(monthly, TYPES);

    expect(result).toHaveLength(12);
    expect(result[0]).toEqual({ month: 1, label: 'M1', Urlaub: 3, Krank: 2, Dienstreise: 1 });
    expect(result[1]).toEqual({ month: 2, label: 'M2', Urlaub: 0, Krank: 5, Dienstreise: 0 });
  });

  it('fills missing months with zeros so the chart spans the full year', () => {
    const monthly = [makeMonthlyPoint(12, { Urlaub: 1 })];

    const result = toMonthlyTypeData(monthly, TYPES);

    expect(result).toHaveLength(12);
    expect(result[11]).toEqual({ month: 12, label: 'M12', Urlaub: 1, Krank: 0, Dienstreise: 0 });
    expect(result[0]).toEqual({ month: 1, label: '1', Urlaub: 0, Krank: 0, Dienstreise: 0 });
  });

  it('returns an empty-shaped year for empty input', () => {
    const result = toMonthlyTypeData([], TYPES);

    expect(result).toHaveLength(12);
    expect(result.every((p) => p.Urlaub === 0 && p.Krank === 0 && p.Dienstreise === 0)).toBe(true);
  });
});

describe('toTypeShareData', () => {
  it('computes shares relative to the given types and drops zero types', () => {
    const byType = { Urlaub: 6, Krank: 3, Dienstreise: 1, Kongress: 4 };

    const result = toTypeShareData(byType, TYPES);

    expect(result).toEqual([
      { type: 'Urlaub', days: 6, share: 60 },
      { type: 'Krank', days: 3, share: 30 },
      { type: 'Dienstreise', days: 1, share: 10 },
    ]);
  });

  it('returns an empty array when there are no absence days', () => {
    expect(toTypeShareData({ Urlaub: 0, Krank: 0 }, TYPES)).toEqual([]);
    expect(toTypeShareData({}, TYPES)).toEqual([]);
  });

  it('treats missing types as zero days', () => {
    const result = toTypeShareData({ Krank: 4 }, TYPES);

    expect(result).toEqual([{ type: 'Krank', days: 4, share: 100 }]);
  });
});
