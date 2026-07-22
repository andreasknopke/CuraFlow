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
}

export interface AbsenceStats {
  rows: AbsenceRow[];
  tenantAvgSick: number;
  tenantAvgTrip: number;
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

  // Build rows
  const rows: AbsenceRow[] = doctors.map((doctor) => {
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

  // Averages across all doctors (including zeros)
  const tenantAvgSick = rows.length > 0
    ? rows.reduce((sum, r) => sum + r.sickDays, 0) / rows.length
    : 0;
  const tenantAvgTrip = rows.length > 0
    ? rows.reduce((sum, r) => sum + r.businessTripDays, 0) / rows.length
    : 0;

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

  return { rows, tenantAvgSick, tenantAvgTrip, roleAverages };
}
