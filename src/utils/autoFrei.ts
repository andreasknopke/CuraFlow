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
  isPublicHoliday?: (date: Date) => boolean,
): string | null {
  const nextDay = addDays(parseISO(dateStr), 1);
  const nextDayStr = format(nextDay, 'yyyy-MM-dd');
  const dayOfWeek = nextDay.getDay();
  const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
  // The resolved value is logged to expose wrong argument types: if a function
  // is passed instead of a boolean, holidayValue becomes a function (truthy).
  const holidayValue = isPublicHoliday?.(nextDay);
  const isHoliday = Boolean(holidayValue);

  const result = isWeekend || isHoliday ? null : nextDayStr;
  console.log('[AUTOFREI] getAutoFreiDate:', {
    dateStr,
    nextDay: nextDayStr,
    dayOfWeek,
    isWeekend,
    holidayValueType: typeof holidayValue,
    isHoliday,
    result,
  });
  return result;
}
