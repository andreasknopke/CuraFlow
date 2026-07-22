/**
 * Absence Statistics Utilities
 *
 * Pure functions for computing absence stats per doctor.
 * No React, no side effects — testable in isolation.
 *
 * @module components/statistics/absenceStatsUtils
 */

import type { Doctor, ShiftEntry } from '@/types';
import { normalizeShiftPosition } from '@/utils/shiftPositionUtils';

// ── Types ──────────────────────────────────────────────────────────────────

export interface AbsenceRow {
  doctorId: string;
  name: string;
  role: string;
  sickDays: number;
  businessTripDays: number;
  totalDays: number;
  /** True when this doctor's sickDays is an IQR outlier among all doctors. */
  isSickOutlier: boolean;
  /** True when this doctor's businessTripDays is an IQR outlier among all doctors. */
  isTripOutlier: boolean;
}

export interface AbsenceStats {
  rows: AbsenceRow[];
  tenantAvgSick: number;
  tenantAvgTrip: number;
  tenantAvgSickNoOutliers: number;
  tenantAvgTripNoOutliers: number;
  roleAverages: Record<string, { sick: number; trip: number }>;
}

export interface AbsenceStatsInput {
  doctors: Doctor[];
  shifts: ShiftEntry[];
  year: number;
  month: number | 'all';
  /** Returns truthy if the given date (ISO string YYYY-MM-DD) is a public holiday. */
  isPublicHoliday: (dateStr: string) => boolean;
}

/** A single data point on the monthly-line chart. */
export interface MonthlyStatsPoint {
  month: number;        // 0–11
  label: string;        // "Jan", "Feb", ...
  avgSick: number;
  avgTrip: number;
  avgSickNoOutliers: number;
  avgTripNoOutliers: number;
}

// ── Helpers ────────────────────────────────────────────────────────────────

/** Inclusive start/end ISO dates for a year or month filter. */
function dateRange(year: number, month: number | 'all'): { from: string; to: string } {
  if (month === 'all') {
    return { from: `${year}-01-01`, to: `${year}-12-31` };
  }
  const m = String(month + 1).padStart(2, '0');
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  return { from: `${year}-${m}-01`, to: `${year}-${m}-${String(daysInMonth).padStart(2, '0')}` };
}

/** true if the date string represents a Saturday (6) or Sunday (0). */
function isWeekend(dateStr: string): boolean {
  const d = new Date(dateStr + 'T12:00:00');
  const dow = d.getDay(); // 0=Sun, 6=Sat
  return dow === 0 || dow === 6;
}

// ── Core ───────────────────────────────────────────────────────────────────

/**
 * Computes per-doctor absence statistics for Krank (sick, only working days)
 * and Dienstreise (business trip, all calendar days).
 */
export function computeAbsenceStats(input: AbsenceStatsInput): AbsenceStats {
  const { doctors, shifts, year, month, isPublicHoliday } = input;
  const { from, to } = dateRange(year, month);

  // Build a map of doctor_id → Doctor for quick lookup
  const doctorMap = new Map(doctors.map((d) => [d.id, d]));

  // Per-doctor distinct-date sets for Krank and Dienstreise
  const sickByDoctor = new Map<string, Set<string>>();
  const tripByDoctor = new Map<string, Set<string>>();

  for (const doctor of doctors) {
    sickByDoctor.set(doctor.id, new Set());
    tripByDoctor.set(doctor.id, new Set());
  }

  for (const shift of shifts) {
    // Keep only shifts within the requested date range
    if (shift.date < from || shift.date > to) continue;

    const norm = normalizeShiftPosition(shift.position);
    const doctorId = shift.doctor_id ?? '';

    // Skip shifts not tied to a doctor in our list
    if (!sickByDoctor.has(doctorId)) continue;

    if (norm === 'krank') {
      // Krank: count only working days (Mon–Fri and not a public holiday)
      if (!isWeekend(shift.date) && !isPublicHoliday(shift.date)) {
        sickByDoctor.get(doctorId)!.add(shift.date);
      }
    } else if (norm === 'dienstreise') {
      // Dienstreise: count every calendar day
      tripByDoctor.get(doctorId)!.add(shift.date);
    }
  }

  // Build rows (without outlier flags yet)
  const baseRows = doctors.map((doctor) => {
    const sickDays = sickByDoctor.get(doctor.id)?.size ?? 0;
    const businessTripDays = tripByDoctor.get(doctor.id)?.size ?? 0;
    return {
      doctorId: doctor.id,
      name: doctor.name,
      role: doctor.role || '',
      sickDays,
      businessTripDays,
      totalDays: sickDays + businessTripDays,
    };
  });

  // Outlier detection (IQR method) — only when >2 doctors
  const sickValues = baseRows.map((r) => r.sickDays);
  const tripValues = baseRows.map((r) => r.businessTripDays);
  const sickOutlier = outlierThresholds(sickValues);
  const tripOutlier = outlierThresholds(tripValues);

  const rows: AbsenceRow[] = baseRows.map((r) => ({
    ...r,
    isSickOutlier: sickOutlier !== null && (r.sickDays < sickOutlier.lower || r.sickDays > sickOutlier.upper),
    isTripOutlier: tripOutlier !== null && (r.businessTripDays < tripOutlier.lower || r.businessTripDays > tripOutlier.upper),
  }));

  // Averages across all doctors (including zeros)
  const tenantAvgSick = rows.length > 0
    ? rows.reduce((sum, r) => sum + r.sickDays, 0) / rows.length
    : 0;
  const tenantAvgTrip = rows.length > 0
    ? rows.reduce((sum, r) => sum + r.businessTripDays, 0) / rows.length
    : 0;

  // Outlier-excluded averages
  const tenantAvgSickNoOutliers = averageWithoutOutliers(sickValues);
  const tenantAvgTripNoOutliers = averageWithoutOutliers(tripValues);

  // Averages per role
  const roleBuckets = new Map<string, AbsenceRow[]>();
  for (const row of rows) {
    const role = row.role || '(ohne Funktion)';
    if (!roleBuckets.has(role)) roleBuckets.set(role, []);
    roleBuckets.get(role)!.push(row);
  }

  const roleAverages: Record<string, { sick: number; trip: number }> = {};
  for (const [role, roleRows] of roleBuckets) {
    const count = roleRows.length;
    roleAverages[role] = {
      sick: count > 0 ? roleRows.reduce((s, r) => s + r.sickDays, 0) / count : 0,
      trip: count > 0 ? roleRows.reduce((s, r) => s + r.businessTripDays, 0) / count : 0,
    };
  }

  return { rows, tenantAvgSick, tenantAvgTrip, tenantAvgSickNoOutliers, tenantAvgTripNoOutliers, roleAverages };
}

// ── Outlier helpers (IQR method) ──────────────────────────────────────────

/**
 * Returns the IQR outlier bounds for a set of values, or null if ≤2 values
 * (outlier detection is meaningless with so few data points).
 */
export function outlierThresholds(values: number[]): { lower: number; upper: number } | null {
  if (values.length <= 2) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const { q1, q3, iqr } = quartiles(sorted);
  return { lower: q1 - 1.5 * iqr, upper: q3 + 1.5 * iqr };
}

// ── Outlier helpers (IQR method) ──────────────────────────────────────────

/** Compute Q1, median, Q3 from a sorted numeric array. */
export function quartiles(sorted: number[]): { q1: number; q3: number; iqr: number } {
  if (sorted.length === 0) return { q1: 0, q3: 0, iqr: 0 };
  if (sorted.length === 1) return { q1: sorted[0], q3: sorted[0], iqr: 0 };
  const mid = Math.floor(sorted.length / 2);
  const lowerHalf = sorted.slice(0, mid);
  const upperHalf = sorted.length % 2 === 0 ? sorted.slice(mid) : sorted.slice(mid + 1);
  const medianOf = (arr: number[]) => {
    if (arr.length === 0) return 0;
    const m = Math.floor(arr.length / 2);
    return arr.length % 2 === 0 ? (arr[m - 1] + arr[m]) / 2 : arr[m];
  };
  const q1 = medianOf(lowerHalf);
  const q3 = medianOf(upperHalf);
  return { q1, q3, iqr: q3 - q1 };
}

/**
 * Returns the average of `values` after removing outliers via the IQR rule
 * (< Q1 − 1.5×IQR or > Q3 + 1.5×IQR). Returns the original average if there are ≤ 2 values.
 */
export function averageWithoutOutliers(values: number[]): number {
  if (values.length <= 2) {
    return values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const { q1, q3, iqr } = quartiles(sorted);
  const lower = q1 - 1.5 * iqr;
  const upper = q3 + 1.5 * iqr;
  const kept = sorted.filter((v) => v >= lower && v <= upper);
  return kept.length > 0 ? kept.reduce((a, b) => a + b, 0) / kept.length : 0;
}

// ── Monthly stats ─────────────────────────────────────────────────────────

const MONTH_LABELS = [
  'Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun',
  'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez',
];

/**
 * Computes per-month average sick & trip days across all doctors,
 * both with and without outlier exclusion (IQR).
 *
 * Returns 12 entries (months 0–11) — even months with zero data.
 */
export function computeMonthlyStats(
  doctors: Doctor[],
  shifts: ShiftEntry[],
  year: number,
  isPublicHoliday: (dateStr: string) => boolean,
): MonthlyStatsPoint[] {
  // Pre-group shifts by month
  const shiftsByMonth = new Map<number, ShiftEntry[]>();
  for (let m = 0; m < 12; m++) shiftsByMonth.set(m, []);

  for (const shift of shifts) {
    if (!shift.date.startsWith(String(year))) continue;
    const m = parseInt(shift.date.slice(5, 7), 10) - 1; // month 0–11
    if (m >= 0 && m < 12) shiftsByMonth.get(m)!.push(shift);
  }

  return Array.from({ length: 12 }, (_, month) => {
    // Reuse computeAbsenceStats per month
    const stats = computeAbsenceStats({ doctors, shifts, year, month: month as number, isPublicHoliday });
    const sickValues = stats.rows.map((r) => r.sickDays);
    const tripValues = stats.rows.map((r) => r.businessTripDays);

    return {
      month,
      label: MONTH_LABELS[month],
      avgSick: stats.tenantAvgSick,
      avgTrip: stats.tenantAvgTrip,
      avgSickNoOutliers: averageWithoutOutliers(sickValues),
      avgTripNoOutliers: averageWithoutOutliers(tripValues),
    };
  });
}
