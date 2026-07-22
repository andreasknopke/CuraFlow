import { describe, expect, it } from 'vitest';
import { computeAbsenceStats, computeMonthlyStats, averageWithoutOutliers, quartiles, outlierThresholds } from '../absenceStatsUtils';
import type { Doctor, ShiftEntry } from '@/types';

// ── Helpers ────────────────────────────────────────────────────────────────

function makeDoctor(overrides: Partial<Doctor> = {}): Doctor {
  return {
    id: overrides.id ?? 'd1',
    name: overrides.name ?? 'Dr. Test',
    initials: null,
    role: overrides.role ?? 'Oberarzt',
    color: null,
    email: null,
    google_email: null,
    fte: 1,
    target_weekly_hours: null,
    contract_end_date: null,
    exclude_from_staffing_plan: false,
    receive_email_notifications: false,
    central_employee_id: null,
    work_time_model_id: null,
    part_time_model: null,
    order: 0,
    is_active: true,
    created_date: '2026-01-01T00:00:00.000Z',
    updated_date: '2026-01-01T00:00:00.000Z',
  };
}

function makeShift(overrides: Partial<ShiftEntry> = {}): ShiftEntry {
  return {
    id: overrides.id ?? 's1',
    date: overrides.date ?? '2026-03-02',
    doctor_id: overrides.doctor_id ?? 'd1',
    position: overrides.position ?? 'Krank',
    order: 0,
    timeslot_id: null,
    start_time: null,
    end_time: null,
    break_minutes: null,
    is_free_text: false,
    free_text_value: null,
    isPreview: false,
    section: null,
    note: null,
    created_date: '2026-01-01T00:00:00.000Z',
    updated_date: '2026-01-01T00:00:00.000Z',
  };
}

/**
 * German public holidays 2026:
 * - 2026-01-01 Neujahr
 * - 2026-04-03 Karfreitag
 * - 2026-04-06 Ostermontag
 * - 2026-05-01 Tag der Arbeit
 * - 2026-05-14 Christi Himmelfahrt
 * - 2026-05-25 Pfingstmontag
 * - 2026-10-03 Tag der Deutschen Einheit
 * - 2026-12-25 1. Weihnachtstag
 * - 2026-12-26 2. Weihnachtstag
 */
function germanHolidays2026(): Set<string> {
  return new Set([
    '2026-01-01', '2026-04-03', '2026-04-06', '2026-05-01',
    '2026-05-14', '2026-05-25', '2026-10-03', '2026-12-25', '2026-12-26',
  ]);
}

function isPublicHoliday(dateStr: string): boolean {
  return germanHolidays2026().has(dateStr);
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('computeAbsenceStats', () => {
  it('counts Krank days only on Mon–Fri and not on public holidays', () => {
    const doctors = [makeDoctor({ id: 'd1', name: 'Dr. Sick' })];
    // Mar 2, 2026 = Monday, Mar 3 = Tue, Mar 4 = Wed
    // But Karfreitag 2026 is Apr 3 (Friday), not in March — let's use a March that has no holiday
    // Mar 7 = Sat, Mar 8 = Sun — excluded
    const shifts = [
      makeShift({ id: 's1', doctor_id: 'd1', position: 'Krank', date: '2026-03-02' }), // Mon ✓
      makeShift({ id: 's2', doctor_id: 'd1', position: 'Krank', date: '2026-03-03' }), // Tue ✓
      makeShift({ id: 's3', doctor_id: 'd1', position: 'krank', date: '2026-03-04' }), // Wed ✓ (lowercase)
      makeShift({ id: 's4', doctor_id: 'd1', position: 'Krank', date: '2026-03-07' }), // Sat ✗
      makeShift({ id: 's5', doctor_id: 'd1', position: 'Krank', date: '2026-03-08' }), // Sun ✗
    ];

    const stats = computeAbsenceStats({ doctors, shifts, year: 2026, month: 2, isPublicHoliday });

    expect(stats.rows).toHaveLength(1);
    expect(stats.rows[0].sickDays).toBe(3);
    expect(stats.rows[0].businessTripDays).toBe(0);
  });

  it('excludes public holidays from Krank count', () => {
    const doctors = [makeDoctor({ id: 'd1', name: 'Dr. Holiday' })];
    // Apr 3, 2026 (Karfreitag) = Friday — normally a workday, but it's a holiday
    // Jan 1, 2026 (Neujahr) = Thursday
    const shifts = [
      makeShift({ id: 's1', doctor_id: 'd1', position: 'Krank', date: '2026-04-03' }), // Fri + holiday ✗
      makeShift({ id: 's2', doctor_id: 'd1', position: 'Krank', date: '2026-04-02' }), // Thu ✓
      makeShift({ id: 's3', doctor_id: 'd1', position: 'Krank', date: '2026-01-01' }), // Thu + holiday ✗
    ];

    const stats = computeAbsenceStats({ doctors, shifts, year: 2026, month: 'all', isPublicHoliday });

    expect(stats.rows[0].sickDays).toBe(1);
  });

  it('counts Dienstreise days including weekends and public holidays', () => {
    const doctors = [makeDoctor({ id: 'd1', name: 'Dr. Travel' })];
    const shifts = [
      makeShift({ id: 's1', doctor_id: 'd1', position: 'Dienstreise', date: '2026-03-07' }), // Sat ✓
      makeShift({ id: 's2', doctor_id: 'd1', position: 'dienstreise', date: '2026-03-08' }), // Sun ✓ (lowercase)
      makeShift({ id: 's3', doctor_id: 'd1', position: 'Dienstreise', date: '2026-04-03' }), // Fri + holiday ✓
      makeShift({ id: 's4', doctor_id: 'd1', position: 'Dienstreise', date: '2026-03-02' }), // Mon ✓
    ];

    const stats = computeAbsenceStats({ doctors, shifts, year: 2026, month: 'all', isPublicHoliday });

    expect(stats.rows[0].businessTripDays).toBe(4);
    expect(stats.rows[0].sickDays).toBe(0);
  });

  it('deduplicates entries on the same day', () => {
    const doctors = [makeDoctor({ id: 'd1', name: 'Dr. Dup' })];
    const shifts = [
      makeShift({ id: 's1', doctor_id: 'd1', position: 'Krank', date: '2026-03-02' }),
      makeShift({ id: 's2', doctor_id: 'd1', position: 'Krank', date: '2026-03-02' }), // same day
      makeShift({ id: 's3', doctor_id: 'd1', position: 'Dienstreise', date: '2026-03-07' }),
      makeShift({ id: 's4', doctor_id: 'd1', position: 'Dienstreise', date: '2026-03-07' }), // same day
    ];

    const stats = computeAbsenceStats({ doctors, shifts, year: 2026, month: 2, isPublicHoliday });

    expect(stats.rows[0].sickDays).toBe(1);
    expect(stats.rows[0].businessTripDays).toBe(1); // Sat counts for Dienstreise
    expect(stats.rows[0].totalDays).toBe(2);
  });

  it('filters by month correctly', () => {
    const doctors = [makeDoctor({ id: 'd1', name: 'Dr. March' })];
    const shifts = [
      makeShift({ id: 's1', doctor_id: 'd1', position: 'Krank', date: '2026-03-02' }), // Mar
      makeShift({ id: 's2', doctor_id: 'd1', position: 'Krank', date: '2026-04-02' }), // Apr → outside
    ];

    const febStats = computeAbsenceStats({ doctors, shifts, year: 2026, month: 1, isPublicHoliday }); // Feb
    const marStats = computeAbsenceStats({ doctors, shifts, year: 2026, month: 2, isPublicHoliday }); // Mar
    const yearStats = computeAbsenceStats({ doctors, shifts, year: 2026, month: 'all', isPublicHoliday });

    expect(febStats.rows[0].sickDays).toBe(0);
    expect(marStats.rows[0].sickDays).toBe(1);
    expect(yearStats.rows[0].sickDays).toBe(2);
  });

  it('returns correct role-based averages', () => {
    const doctors = [
      makeDoctor({ id: 'd1', name: 'Ober 1', role: 'Oberarzt' }),
      makeDoctor({ id: 'd2', name: 'Ober 2', role: 'Oberarzt' }),
      makeDoctor({ id: 'd3', name: 'Assi 1', role: 'Assistenzarzt' }),
    ];
    const shifts = [
      makeShift({ id: 's1', doctor_id: 'd1', position: 'Krank', date: '2026-03-02' }),
      makeShift({ id: 's2', doctor_id: 'd1', position: 'Krank', date: '2026-03-03' }),
      // d2: 0 Krank
      makeShift({ id: 's3', doctor_id: 'd3', position: 'Krank', date: '2026-03-02' }),
      makeShift({ id: 's4', doctor_id: 'd3', position: 'Krank', date: '2026-03-03' }),
      makeShift({ id: 's5', doctor_id: 'd3', position: 'Krank', date: '2026-03-04' }),
      makeShift({ id: 's6', doctor_id: 'd3', position: 'Krank', date: '2026-03-05' }),
    ];

    const stats = computeAbsenceStats({ doctors, shifts, year: 2026, month: 2, isPublicHoliday });

    // Tenant avg: (2 + 0 + 4) / 3 = 2.0
    expect(stats.tenantAvgSick).toBe(2);
    // Oberarzt avg: (2 + 0) / 2 = 1.0
    expect(stats.roleAverages['Oberarzt'].sick).toBe(1);
    // Assistenzarzt avg: 4 / 1 = 4.0
    expect(stats.roleAverages['Assistenzarzt'].sick).toBe(4);
  });

  it('handles empty doctors array', () => {
    const stats = computeAbsenceStats({
      doctors: [],
      shifts: [makeShift()],
      year: 2026,
      month: 'all',
      isPublicHoliday,
    });

    expect(stats.rows).toHaveLength(0);
    expect(stats.tenantAvgSick).toBe(0);
    expect(stats.tenantAvgTrip).toBe(0);
    expect(stats.roleAverages).toEqual({});
  });

  it('handles empty shifts array', () => {
    const doctors = [makeDoctor()];
    const stats = computeAbsenceStats({
      doctors,
      shifts: [],
      year: 2026,
      month: 'all',
      isPublicHoliday,
    });

    expect(stats.rows).toHaveLength(1);
    expect(stats.rows[0].sickDays).toBe(0);
    expect(stats.rows[0].businessTripDays).toBe(0);
    expect(stats.tenantAvgSick).toBe(0);
  });

  it('does not count non-absence positions', () => {
    const doctors = [makeDoctor({ id: 'd1' })];
    const shifts = [
      makeShift({ id: 's1', doctor_id: 'd1', position: 'CT', date: '2026-03-02' }),
      makeShift({ id: 's2', doctor_id: 'd1', position: 'MRT', date: '2026-03-03' }),
      makeShift({ id: 's3', doctor_id: 'd1', position: 'Urlaub', date: '2026-03-04' }), // Not counted (only Krank + Dienstreise)
    ];

    const stats = computeAbsenceStats({ doctors, shifts, year: 2026, month: 2, isPublicHoliday });

    expect(stats.rows[0].sickDays).toBe(0);
    expect(stats.rows[0].businessTripDays).toBe(0);
    expect(stats.rows[0].totalDays).toBe(0);
  });

  it('handles doctors with empty roles', () => {
    // Build directly (not via makeDoctor) so role is truly undefined
    const d1: Doctor = {
      ...makeDoctor({ id: 'd1', name: 'A', role: 'Facharzt' }),
      role: undefined,
    };
    const d2 = makeDoctor({ id: 'd2', name: 'B', role: '' });
    const doctors = [d1, d2];
    const shifts = [
      makeShift({ id: 's1', doctor_id: 'd1', position: 'Krank', date: '2026-03-02' }),
      makeShift({ id: 's2', doctor_id: 'd2', position: 'Krank', date: '2026-03-02' }),
    ];

    const stats = computeAbsenceStats({ doctors, shifts, year: 2026, month: 2, isPublicHoliday });

    // Both grouped under '(ohne Funktion)' in roleAverages
    const roleAvg = stats.roleAverages['(ohne Funktion)'];
    expect(roleAvg.sick).toBe(1);
    expect(stats.rows[0].role).toBe('');
    expect(stats.rows[0].sickDays).toBe(1);
  });

  it('calculates totalDays as sum of sickDays + businessTripDays', () => {
    const doctors = [makeDoctor({ id: 'd1' })];
    const shifts = [
      makeShift({ id: 's1', doctor_id: 'd1', position: 'Krank', date: '2026-03-02' }),
      makeShift({ id: 's2', doctor_id: 'd1', position: 'Dienstreise', date: '2026-03-03' }),
      makeShift({ id: 's3', doctor_id: 'd1', position: 'Dienstreise', date: '2026-03-07' }), // Sat
    ];

    const stats = computeAbsenceStats({ doctors, shifts, year: 2026, month: 2, isPublicHoliday });

    expect(stats.rows[0].totalDays).toBe(3);
  });

  it('marks outlier doctor in sickDays when value exceeds IQR bounds', () => {
    // 6 doctors: 5 have 0-1 sick days, 1 has 10 → outlier
    const doctors = [
      makeDoctor({ id: 'd1' }), makeDoctor({ id: 'd2' }),
      makeDoctor({ id: 'd3' }), makeDoctor({ id: 'd4' }),
      makeDoctor({ id: 'd5' }), makeDoctor({ id: 'd6' }),
    ];
    const shifts = [
      // d1: 10 sick days (outlier), d2: 1, rest: 0
      ...[...Array(10)].map((_, i) =>
        makeShift({ id: `s${i}`, doctor_id: 'd1', position: 'Krank', date: `2026-03-0${i + 2}` }),
      ),
      makeShift({ id: 's99', doctor_id: 'd2', position: 'Krank', date: '2026-03-02' }),
    ];

    const stats = computeAbsenceStats({ doctors, shifts, year: 2026, month: 2, isPublicHoliday });

    const d1 = stats.rows.find((r) => r.doctorId === 'd1')!;
    const d2 = stats.rows.find((r) => r.doctorId === 'd2')!;
    expect(d1.isSickOutlier).toBe(true);
    expect(d2.isSickOutlier).toBe(false);
  });

  it('does not mark outliers when ≤2 doctors', () => {
    const doctors = [makeDoctor({ id: 'd1' }), makeDoctor({ id: 'd2' })];
    const shifts = [
      makeShift({ id: 's1', doctor_id: 'd1', position: 'Krank', date: '2026-03-02' }),
    ];

    const stats = computeAbsenceStats({ doctors, shifts, year: 2026, month: 2, isPublicHoliday });

    expect(stats.rows[0].isSickOutlier).toBe(false);
    expect(stats.rows[1].isSickOutlier).toBe(false);
  });

  it('returns outlier-excluded averages in AbsenceStats', () => {
    const doctors = [
      makeDoctor({ id: 'd1' }), makeDoctor({ id: 'd2' }),
      makeDoctor({ id: 'd3' }), makeDoctor({ id: 'd4' }),
      makeDoctor({ id: 'd5' }), makeDoctor({ id: 'd6' }),
    ];
    // d1: 10 sick days (weekdays only), d2: 1, rest: 0 → avg=11/6≈1.833, no-outliers avg=1/5=0.2
    const d1Dates: ReturnType<typeof makeShift>[] = [];
    let day = 2; // Mar 2 = Monday
    for (let i = 0; i < 10; i++) {
      // Skip Sat (6) and Sun (0/7) — but we're just counting weekdays
      // Mar 2-6 = Mon-Fri (5 days), Mar 9-13 = Mon-Fri (5 days) = 10 weekdays
      if (day === 7) day = 9; // skip weekend Mar 7-8
      const dayStr = String(day).padStart(2, '0');
      d1Dates.push(makeShift({ id: `sa${i}`, doctor_id: 'd1', position: 'Krank', date: `2026-03-${dayStr}` }));
      day++;
    }
    const shifts: ReturnType<typeof makeShift>[] = [
      ...d1Dates,
      makeShift({ id: 's99', doctor_id: 'd2', position: 'Krank', date: '2026-03-12' }),
    ];

    const stats = computeAbsenceStats({ doctors, shifts, year: 2026, month: 2, isPublicHoliday });

    expect(stats.tenantAvgSick).toBeCloseTo(1.833, 2);
    expect(stats.tenantAvgSickNoOutliers).toBeCloseTo(0.2, 2);
    expect(stats.tenantAvgTripNoOutliers).toBe(0);
  });

  it('returns same avg and avgNoOutliers when no outliers exist', () => {
    const doctors = [
      makeDoctor({ id: 'd1' }), makeDoctor({ id: 'd2' }),
      makeDoctor({ id: 'd3' }),
    ];
    const shifts = [
      makeShift({ id: 's1', doctor_id: 'd1', position: 'Krank', date: '2026-03-02' }),
      makeShift({ id: 's2', doctor_id: 'd2', position: 'Krank', date: '2026-03-03' }),
      makeShift({ id: 's3', doctor_id: 'd3', position: 'Krank', date: '2026-03-04' }),
    ];

    const stats = computeAbsenceStats({ doctors, shifts, year: 2026, month: 2, isPublicHoliday });

    expect(stats.tenantAvgSick).toBe(1);
    expect(stats.tenantAvgSickNoOutliers).toBe(1);
  });
});

// ── outlierThresholds ─────────────────────────────────────────────────────

describe('outlierThresholds', () => {
  it('returns null for ≤2 values', () => {
    expect(outlierThresholds([5])).toBeNull();
    expect(outlierThresholds([5, 15])).toBeNull();
  });

  it('returns bounds for ≥3 values', () => {
    const bounds = outlierThresholds([1, 2, 3, 4, 5]);
    expect(bounds).not.toBeNull();
    expect(bounds!.lower).toBeLessThan(2);  // Q1=2, IQR=3, lower=2-4.5=-2.5
    expect(bounds!.upper).toBeGreaterThan(4); // Q3=4, upper=4+4.5=8.5
  });

  it('detects high outlier', () => {
    const bounds = outlierThresholds([1, 2, 3, 4, 5, 100])!;
    expect(bounds.upper).toBeLessThan(100); // 100 > upper
  });

  it('detects low outlier', () => {
    const bounds = outlierThresholds([100, 101, 102, 103, 104, 1])!;
    expect(bounds.lower).toBeGreaterThan(1); // 1 is outlier
    expect(bounds.lower).toBeLessThan(100); // lower is around 95.5
  });
});

// ── quartiles ──────────────────────────────────────────────────────────────

describe('quartiles', () => {
  it('returns correct Q1 and Q3 for an odd-length sorted array', () => {
    const result = quartiles([1, 2, 3, 4, 5, 6, 7]);
    expect(result.q1).toBe(2);
    expect(result.q3).toBe(6);
    expect(result.iqr).toBe(4);
  });

  it('returns correct Q1 and Q3 for an even-length sorted array', () => {
    const result = quartiles([1, 2, 3, 4, 5, 6]);
    expect(result.q1).toBe(2);
    expect(result.q3).toBe(5);
    expect(result.iqr).toBe(3);
  });

  it('handles array with two values', () => {
    const result = quartiles([10, 20]);
    expect(result.q1).toBe(10);
    expect(result.q3).toBe(20);
    expect(result.iqr).toBe(10);
  });

  it('handles array with one value', () => {
    const result = quartiles([42]);
    expect(result.q1).toBe(42);
    expect(result.q3).toBe(42);
    expect(result.iqr).toBe(0);
  });
});

// ── averageWithoutOutliers ─────────────────────────────────────────────────

describe('averageWithoutOutliers', () => {
  it('returns the regular average when there are 2 or fewer values', () => {
    expect(averageWithoutOutliers([5])).toBe(5);
    expect(averageWithoutOutliers([5, 15])).toBe(10);
  });

  it('returns the regular average when there are no outliers', () => {
    expect(averageWithoutOutliers([1, 2, 3, 4, 5])).toBe(3);
  });

  it('excludes outlier values beyond 1.5×IQR', () => {
    // 1, 2, 3, 4, 5, 100 → Q1=2, Q3=5, IQR=3, upper=9.5 → 100 excluded
    const result = averageWithoutOutliers([1, 2, 3, 4, 5, 100]);
    expect(result).toBe(3); // avg of 1,2,3,4,5
  });

  it('handles all-identical values', () => {
    expect(averageWithoutOutliers([7, 7, 7, 7])).toBe(7);
  });

  it('handles empty array gracefully', () => {
    expect(averageWithoutOutliers([])).toBe(0);
  });
});

// ── computeMonthlyStats ────────────────────────────────────────────────────

describe('computeMonthlyStats', () => {
  const isPublicHoliday = () => false; // simplify — no holidays in test

  it('returns 12 entries (Jan–Dec)', () => {
    const doctors: Doctor[] = [makeDoctor()];
    const shifts: ShiftEntry[] = [];
    const result = computeMonthlyStats(doctors, shifts, 2026, isPublicHoliday);

    expect(result).toHaveLength(12);
    expect(result[0].label).toBe('Jan');
    expect(result[11].label).toBe('Dez');
    expect(result[0].month).toBe(0);
    expect(result[11].month).toBe(11);
  });

  it('computes correct avgSick per month', () => {
    const doctors = [makeDoctor({ id: 'd1' }), makeDoctor({ id: 'd2' })];
    const shifts = [
      // Jan: d1 has 2 Krank, d2 has 0 → avg = 1
      makeShift({ id: 's1', doctor_id: 'd1', position: 'Krank', date: '2026-01-05' }),
      makeShift({ id: 's2', doctor_id: 'd1', position: 'Krank', date: '2026-01-06' }),
      // Feb: d1 has 1 Krank, d2 has 1 → avg = 1
      makeShift({ id: 's3', doctor_id: 'd1', position: 'Krank', date: '2026-02-02' }),
      makeShift({ id: 's4', doctor_id: 'd2', position: 'Krank', date: '2026-02-03' }),
    ];

    const result = computeMonthlyStats(doctors, shifts, 2026, isPublicHoliday);

    expect(result[0].avgSick).toBe(1);   // Jan
    expect(result[1].avgSick).toBe(1);   // Feb
    expect(result[2].avgSick).toBe(0);   // Mar
  });

  it('computes correct avgTrip per month (incl. weekends)', () => {
    const doctors = [makeDoctor({ id: 'd1' })];
    const shifts = [
      makeShift({ id: 's1', doctor_id: 'd1', position: 'Dienstreise', date: '2026-03-07' }), // Sat
      makeShift({ id: 's2', doctor_id: 'd1', position: 'Dienstreise', date: '2026-03-08' }), // Sun
    ];

    const result = computeMonthlyStats(doctors, shifts, 2026, isPublicHoliday);

    expect(result[2].avgTrip).toBe(2);   // Mar (index 2); weekends count
  });

  it('excludes public holidays from Krank in monthly stats', () => {
    const isHoliday = (dateStr: string) =>
      dateStr === '2026-01-01';

    const doctors = [makeDoctor({ id: 'd1' })];
    const shifts = [
      makeShift({ id: 's1', doctor_id: 'd1', position: 'Krank', date: '2026-01-01' }), // holiday
      makeShift({ id: 's2', doctor_id: 'd1', position: 'Krank', date: '2026-01-02' }), // Fri — counts
    ];

    const result = computeMonthlyStats(doctors, shifts, 2026, isHoliday);

    expect(result[0].avgSick).toBe(1); // only Jan 2 counted
  });

  it('excludes Krank on weekends from monthly stats', () => {
    const doctors = [makeDoctor({ id: 'd1' })];
    const shifts = [
      makeShift({ id: 's1', doctor_id: 'd1', position: 'Krank', date: '2026-01-03' }), // Sat
      makeShift({ id: 's2', doctor_id: 'd1', position: 'Krank', date: '2026-01-04' }), // Sun
      makeShift({ id: 's3', doctor_id: 'd1', position: 'Krank', date: '2026-01-05' }), // Mon — counts
    ];

    const result = computeMonthlyStats(doctors, shifts, 2026, isPublicHoliday);

    expect(result[0].avgSick).toBe(1); // only Mon counted
  });

  it('avgSickNoOutliers and avgTripNoOutliers exclude outliers', () => {
    // Need ≥6 doctors for IQR outlier detection to work (Q3 omits the maximum)
    const doctors = [
      makeDoctor({ id: 'd1' }),
      makeDoctor({ id: 'd2' }),
      makeDoctor({ id: 'd3' }),
      makeDoctor({ id: 'd4' }),
      makeDoctor({ id: 'd5' }),
      makeDoctor({ id: 'd6' }),
    ];
    const shifts = [
      // Jan: all 6 have 1 Krank day → avg=1, no outliers
      makeShift({ id: 's1', doctor_id: 'd1', position: 'Krank', date: '2026-01-05' }),
      makeShift({ id: 's2', doctor_id: 'd2', position: 'Krank', date: '2026-01-06' }),
      makeShift({ id: 's3', doctor_id: 'd3', position: 'Krank', date: '2026-01-07' }),
      makeShift({ id: 's4', doctor_id: 'd4', position: 'Krank', date: '2026-01-08' }),
      makeShift({ id: 's5', doctor_id: 'd5', position: 'Krank', date: '2026-01-09' }),
      makeShift({ id: 's6', doctor_id: 'd6', position: 'Krank', date: '2026-01-12' }),
      // Feb: d1 spread high (15 Krank), others 0–1 → d1 is outlier
      makeShift({ id: 's10', doctor_id: 'd1', position: 'Krank', date: '2026-02-02' }),
      makeShift({ id: 's11', doctor_id: 'd1', position: 'Krank', date: '2026-02-03' }),
      makeShift({ id: 's12', doctor_id: 'd1', position: 'Krank', date: '2026-02-04' }),
      makeShift({ id: 's13', doctor_id: 'd1', position: 'Krank', date: '2026-02-05' }),
      makeShift({ id: 's14', doctor_id: 'd1', position: 'Krank', date: '2026-02-06' }),
      makeShift({ id: 's15', doctor_id: 'd1', position: 'Krank', date: '2026-02-09' }),
      makeShift({ id: 's16', doctor_id: 'd1', position: 'Krank', date: '2026-02-10' }),
      makeShift({ id: 's17', doctor_id: 'd1', position: 'Krank', date: '2026-02-11' }),
      makeShift({ id: 's18', doctor_id: 'd1', position: 'Krank', date: '2026-02-12' }),
      makeShift({ id: 's19', doctor_id: 'd1', position: 'Krank', date: '2026-02-13' }),
      makeShift({ id: 's20', doctor_id: 'd1', position: 'Krank', date: '2026-02-16' }),
      makeShift({ id: 's21', doctor_id: 'd1', position: 'Krank', date: '2026-02-17' }),
      makeShift({ id: 's22', doctor_id: 'd1', position: 'Krank', date: '2026-02-18' }),
      makeShift({ id: 's23', doctor_id: 'd1', position: 'Krank', date: '2026-02-19' }),
      makeShift({ id: 's24', doctor_id: 'd1', position: 'Krank', date: '2026-02-20' }),
      makeShift({ id: 's25', doctor_id: 'd2', position: 'Krank', date: '2026-02-02' }),
    ];

    const result = computeMonthlyStats(doctors, shifts, 2026, isPublicHoliday);

    // Jan: all 6 have 1 → avg=1, no outliers → same
    expect(result[0].avgSick).toBe(1);
    expect(result[0].avgSickNoOutliers).toBe(1);

    // Feb: d1=15, d2=1, d3..d6=0 → avg=16/6≈2.667, d1 is outlier
    expect(result[1].avgSick).toBeCloseTo(2.667, 2);
    expect(result[1].avgSickNoOutliers).toBeLessThan(result[1].avgSick);
    // without d1: (1+0+0+0+0)/5 = 0.2
    expect(result[1].avgSickNoOutliers).toBeCloseTo(0.2, 2);
  });

  it('returns zeros when there are no doctors', () => {
    const result = computeMonthlyStats([], [], 2026, isPublicHoliday);

    expect(result).toHaveLength(12);
    for (const point of result) {
      expect(point.avgSick).toBe(0);
      expect(point.avgTrip).toBe(0);
      expect(point.avgSickNoOutliers).toBe(0);
      expect(point.avgTripNoOutliers).toBe(0);
    }
  });

  it('deduplicates same-day entries', () => {
    const doctors = [makeDoctor({ id: 'd1' })];
    const shifts = [
      makeShift({ id: 's1', doctor_id: 'd1', position: 'Krank', date: '2026-01-05' }),
      makeShift({ id: 's2', doctor_id: 'd1', position: 'Krank', date: '2026-01-05' }), // duplicate day
    ];

    const result = computeMonthlyStats(doctors, shifts, 2026, isPublicHoliday);

    expect(result[0].avgSick).toBe(1); // only 1 day counted
  });
});
