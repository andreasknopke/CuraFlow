import { describe, expect, it } from 'vitest';
import { computeAbsenceStats } from '../absenceStatsUtils';
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
});
