/**
 * CuraFlow — Timeslot Utilities (Zeitfenster-Berechnungen)
 *
 * Feature: Zeitfenster-Besetzung (Timeslots) for workplaces.
 * Converts between time strings and minutes, computes overlaps, formats labels.
 *
 * @module utils/timeslotUtils
 */

import { isNonWorkingShiftPosition } from './shiftPositionUtils';

// ─── Types ───────────────────────────────────────────────────────────────────

interface TimeslotLike {
  id?: string | number | null;
  label?: string | null;
  start_time?: string | null;
  end_time?: string | null;
  spans_midnight?: boolean | null;
  overlap_tolerance_minutes?: number | null;
}

interface ShiftEntry {
  date?: string;
  position?: string;
  doctor_id?: string;
  timeslot_id?: string | number | null;
}

interface DateRange {
  start: string;
  end: string;
}

interface ExpandedSlot {
  start: number;
  end: number;
}

// ─── Time Conversion ─────────────────────────────────────────────────────────

/** Converts "HH:MM" or "HH:MM:SS" to minutes since midnight. */
export function timeToMinutes(time: string | null | undefined): number {
  if (!time) return 0;
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

/** Converts minutes since midnight back to "HH:MM". Wraps at 24h. */
export function minutesToTime(minutes: number): string {
  const normalizedMinutes = ((minutes % 1440) + 1440) % 1440;
  const h = Math.floor(normalizedMinutes / 60);
  const m = normalizedMinutes % 60;
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
}

// ─── Midnight & Duration ─────────────────────────────────────────────────────

/** Returns true if end_time ≤ start_time (spans midnight). */
export function spansMidnight(startTime: string, endTime: string): boolean {
  return timeToMinutes(endTime) <= timeToMinutes(startTime);
}

/** Calculates duration in minutes. Handles midnight-spanning slots. */
export function calculateDurationMinutes(startTime: string, endTime: string): number {
  const startMinutes = timeToMinutes(startTime);
  let endMinutes = timeToMinutes(endTime);

  if (endMinutes <= startMinutes) {
    endMinutes += 24 * 60;
  }

  return endMinutes - startMinutes;
}

// ─── Shift Hours ─────────────────────────────────────────────────────────────

/**
 * Calculates working hours for a shift entry, considering its timeslot.
 * Falls back to `defaultHours` (8h) if no timeslot is assigned.
 */
export function calculateShiftHours(
  shift: ShiftEntry,
  timeslot: TimeslotLike | null | undefined,
  defaultHours = 8,
): number {
  if (!timeslot) {
    return defaultHours;
  }

  const durationMinutes = calculateDurationMinutes(
    timeslot.start_time ?? '00:00',
    timeslot.end_time ?? '00:00',
  );

  return durationMinutes / 60;
}

// ─── Overlap Detection ───────────────────────────────────────────────────────

/**
 * Checks whether two timeslots overlap, with a tolerance in minutes.
 * Supports midnight-spanning slots by checking shifted variants.
 */
export function timeslotsOverlap(
  slot1: TimeslotLike | null | undefined,
  slot2: TimeslotLike | null | undefined,
  toleranceMinutes = 0,
): boolean {
  if (!slot1 || !slot2) return false;

  const expandSlot = (slot: TimeslotLike): ExpandedSlot => {
    const start = timeToMinutes(slot.start_time ?? '00:00');
    let end = timeToMinutes(slot.end_time ?? '00:00');

    if (end <= start) {
      end += 24 * 60;
    }

    return {
      start: start + toleranceMinutes,
      end: end - toleranceMinutes,
    };
  };

  const s1 = expandSlot(slot1);
  const s2 = expandSlot(slot2);

  // Standard overlap check
  if (s1.start < s2.end && s2.start < s1.end) {
    return true;
  }

  // Shift slot2 by one day
  const s2NextDay: ExpandedSlot = { start: s2.start + 1440, end: s2.end + 1440 };
  if (s1.start < s2NextDay.end && s2NextDay.start < s1.end) {
    return true;
  }

  // Shift slot1 by one day
  const s1NextDay: ExpandedSlot = { start: s1.start + 1440, end: s1.end + 1440 };
  if (s1NextDay.start < s2.end && s2.start < s1NextDay.end) {
    return true;
  }

  return false;
}

// ─── Formatting ──────────────────────────────────────────────────────────────

/** Formats a timeslot as a human-readable label with midnight indicator. */
export function formatTimeslotLabel(timeslot: TimeslotLike | null | undefined): string {
  if (!timeslot) return '';

  const start = (timeslot.start_time ?? '00:00').substring(0, 5);
  const end = (timeslot.end_time ?? '00:00').substring(0, 5);
  const midnight = spansMidnight(start, end);

  if (timeslot.label) {
    return `${timeslot.label} (${start}-${end}${midnight ? ' +1' : ''})`;
  }

  return `${start}-${end}${midnight ? ' +1' : ''}`;
}

/** Returns a short "HH:MM-HH:MM" label for grid display. */
export function formatTimeslotShort(timeslot: TimeslotLike | null | undefined): string {
  if (!timeslot) return '';

  const start = (timeslot.start_time ?? '').substring(0, 5);
  const end = (timeslot.end_time ?? '').substring(0, 5);

  return `${start}-${end}`;
}

// ─── Full-Day Pseudo-Timeslot ────────────────────────────────────────────────

/** Creates a "full day" pseudo-timeslot for calculations. */
export function createFullDayTimeslot(): TimeslotLike {
  return {
    id: null,
    label: 'Ganztägig',
    start_time: '00:00',
    end_time: '23:59',
    spans_midnight: false,
    overlap_tolerance_minutes: 0,
  };
}

// ─── Working Hours Aggregation ───────────────────────────────────────────────

/**
 * Aggregates total working hours per doctor within a date range.
 * Non-working shift positions (vacation, sick, etc.) are excluded.
 */
export function aggregateWorkingHours(
  shifts: ShiftEntry[],
  timeslots: TimeslotLike[],
  dateRange: DateRange | null,
): Record<string, number> {
  const hoursPerDoctor: Record<string, number> = {};

  for (const shift of shifts) {
    if (isNonWorkingShiftPosition(shift.position)) {
      continue;
    }

    // Date filter
    if (dateRange) {
      if (shift.date! < dateRange.start || shift.date! > dateRange.end) {
        continue;
      }
    }

    // Find matching timeslot
    const timeslot = shift.timeslot_id
      ? timeslots.find((t) => t.id === shift.timeslot_id)
      : null;

    const hours = calculateShiftHours(shift, timeslot);

    const doctorId = shift.doctor_id ?? 'unknown';
    hoursPerDoctor[doctorId] = (hoursPerDoctor[doctorId] || 0) + hours;
  }

  return hoursPerDoctor;
}

// ─── Droppable IDs ───────────────────────────────────────────────────────────

/**
 * Parses a drag-and-drop droppable ID into its components.
 * Format: "date__position" or "date__position__timeslotId"
 */
export function parseDroppableId(droppableId: string | null | undefined): {
  date: string | null;
  position: string | null;
  timeslotId: string | null;
} {
  if (!droppableId) return { date: null, position: null, timeslotId: null };

  const parts = droppableId.split('__');

  return {
    date: parts[0] || null,
    position: parts[1] || null,
    timeslotId: parts[2] === 'null' || parts[2] === undefined ? null : parts[2],
  };
}

/**
 * Builds a drag-and-drop droppable ID.
 * @param date — "YYYY-MM-DD"
 * @param position — workplace/position name
 * @param timeslotId — optional timeslot ID
 */
export function createDroppableId(
  date: string,
  position: string,
  timeslotId: string | null = null,
): string {
  if (timeslotId) {
    return `${date}__${position}__${timeslotId}`;
  }
  return `${date}__${position}`;
}
