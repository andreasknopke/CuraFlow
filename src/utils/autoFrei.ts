/**
 * CuraFlow — Auto-Frei (Auto-Free) Date Calculator
 *
 * For a given date and a set of holidays, determines the next valid working day.
 * If the next day is a weekend or public holiday, returns null (no "frei" marker needed).
 *
 * @module utils/autoFrei
 */

import { addDays, format, parseISO } from 'date-fns';

/**
 * Returns the next working day after `dateStr` as 'yyyy-MM-dd',
 * or null if the next day is a weekend or public holiday.
 *
 * @param dateStr — ISO date string (e.g. "2026-06-29")
 * @param isPublicHoliday — Function that returns true for a given Date if it's a holiday
 */
export function getAutoFreiDate(
  dateStr: string,
  isPublicHoliday?: (date: Date) => unknown,
): string | null {
  const nextDay = addDays(parseISO(dateStr), 1);
  const dayOfWeek = nextDay.getDay();
  const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
  // The callback may return a boolean, a PublicHolidayResult, or null — only
  // truthiness matters here, so `unknown` keeps every caller type-compatible
  // without casts. The callback MUST be a function: wrapping a value (or
  // another function) in `() => …` here would make every day look like a
  // holiday and silently disable auto-frei (regression 2026-08).
  const isHoliday = Boolean(isPublicHoliday?.(nextDay));

  if (isWeekend || isHoliday) {
    return null;
  }

  return format(nextDay, 'yyyy-MM-dd');
}
