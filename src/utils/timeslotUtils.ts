/**
 * Utility-Funktionen für Timeslot-Berechnungen
 * Feature: Zeitfenster-Besetzung (Timeslots) für Arbeitsplätze
 */

import { isNonWorkingShiftPosition } from './shiftPositionUtils';

export interface TimeslotLike {
  id?: string | null;
  label?: string;
  start_time: string;
  end_time: string;
  spans_midnight?: boolean;
  overlap_tolerance_minutes?: number;
}

interface ShiftLike {
  doctor_id: string;
  date: string;
  position?: string | null;
  timeslot_id?: string | null;
}

interface DateRange {
  start: string;
  end: string;
}

interface DroppableIdParts {
  date: string | null;
  position: string | null;
  timeslotId: string | null;
}

export function timeToMinutes(time: string | null | undefined): number {
  if (!time) return 0;
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

export function minutesToTime(minutes: number): string {
  const normalizedMinutes = ((minutes % 1440) + 1440) % 1440;
  const h = Math.floor(normalizedMinutes / 60);
  const m = normalizedMinutes % 60;
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
}

export function spansMidnight(startTime: string, endTime: string): boolean {
  const startMinutes = timeToMinutes(startTime);
  const endMinutes = timeToMinutes(endTime);
  return endMinutes <= startMinutes;
}

export function calculateDurationMinutes(startTime: string, endTime: string): number {
  const startMinutes = timeToMinutes(startTime);
  let endMinutes = timeToMinutes(endTime);

  if (endMinutes <= startMinutes) {
    endMinutes += 24 * 60;
  }

  return endMinutes - startMinutes;
}

export function calculateShiftHours(
  _shift: ShiftLike,
  timeslot: TimeslotLike | null,
  defaultHours: number = 8,
): number {
  if (!timeslot) {
    return defaultHours;
  }

  const durationMinutes = calculateDurationMinutes(timeslot.start_time, timeslot.end_time);
  return durationMinutes / 60;
}

export function timeslotsOverlap(
  slot1: TimeslotLike | null | undefined,
  slot2: TimeslotLike | null | undefined,
  toleranceMinutes: number = 0,
): boolean {
  if (!slot1 || !slot2) return false;

  const expandSlot = (slot: TimeslotLike) => {
    const start = timeToMinutes(slot.start_time);
    let end = timeToMinutes(slot.end_time);

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

  if (s1.start < s2.end && s2.start < s1.end) {
    return true;
  }

  const s2NextDay = { start: s2.start + 1440, end: s2.end + 1440 };
  if (s1.start < s2NextDay.end && s2NextDay.start < s1.end) {
    return true;
  }

  const s1NextDay = { start: s1.start + 1440, end: s1.end + 1440 };
  if (s1NextDay.start < s2.end && s2.start < s1NextDay.end) {
    return true;
  }

  return false;
}

export function formatTimeslotLabel(timeslot: TimeslotLike | null | undefined): string {
  if (!timeslot) return '';

  const start = timeslot.start_time?.substring(0, 5) || '00:00';
  const end = timeslot.end_time?.substring(0, 5) || '00:00';
  const midnight = spansMidnight(start, end);

  if (timeslot.label) {
    return `${timeslot.label} (${start}-${end}${midnight ? ' +1' : ''})`;
  }

  return `${start}-${end}${midnight ? ' +1' : ''}`;
}

export function formatTimeslotShort(timeslot: TimeslotLike | null | undefined): string {
  if (!timeslot) return '';

  const start = timeslot.start_time?.substring(0, 5) || '';
  const end = timeslot.end_time?.substring(0, 5) || '';

  return `${start}-${end}`;
}

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

export function aggregateWorkingHours(
  shifts: ShiftLike[],
  timeslots: TimeslotLike[],
  dateRange?: DateRange | null,
): Record<string, number> {
  const hoursPerDoctor: Record<string, number> = {};

  for (const shift of shifts) {
    if (isNonWorkingShiftPosition(shift.position)) {
      continue;
    }

    if (dateRange) {
      if (shift.date < dateRange.start || shift.date > dateRange.end) {
        continue;
      }
    }

    const timeslot = shift.timeslot_id ? timeslots.find((t) => t.id === shift.timeslot_id) : null;
    const hours = calculateShiftHours(shift, timeslot ?? null);

    hoursPerDoctor[shift.doctor_id] = (hoursPerDoctor[shift.doctor_id] || 0) + hours;
  }

  return hoursPerDoctor;
}

export function parseDroppableId(droppableId: string | null | undefined): DroppableIdParts {
  if (!droppableId) return { date: null, position: null, timeslotId: null };

  const parts = droppableId.split('__');

  return {
    date: parts[0] || null,
    position: parts[1] || null,
    timeslotId: parts[2] === 'null' || parts[2] === undefined ? null : parts[2],
  };
}

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
