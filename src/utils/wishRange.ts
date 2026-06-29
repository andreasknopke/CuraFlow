/**
 * CuraFlow — Wish Range Utilities
 *
 * Functions for parsing and comparing date ranges on staff wishes
 * (vacation requests, absence requests, etc.).
 *
 * @module utils/wishRange
 */

import { format, parseISO, isValid } from 'date-fns';

// Type for a wish object — minimal shape for date range extraction
interface WishLike {
  range_start?: string | Date | null;
  start_date?: string | Date | null;
  date?: string | Date | null;
  range_end?: string | Date | null;
  end_date?: string | Date | null;
}

/**
 * Normalizes any date-ish value to 'yyyy-MM-dd' or null.
 * Accepts Date objects, ISO strings, or 'yyyy-MM-dd' strings.
 */
const normalizeDateString = (value: string | Date | null | undefined): string | null => {
  if (!value) return null;

  // Already a yyyy-MM-dd string
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;

  const parsed = value instanceof Date ? value : parseISO(String(value));
  if (!isValid(parsed)) return null;
  return format(parsed, 'yyyy-MM-dd');
};

/** Returns the start date of a wish, or null if unavailable. */
export const getWishStartDate = (wish: WishLike | null | undefined): string | null =>
  normalizeDateString(wish?.range_start || wish?.start_date || wish?.date);

/** Returns the end date of a wish, falling back to start if only one date exists. */
export const getWishEndDate = (wish: WishLike | null | undefined): string | null =>
  normalizeDateString(
    wish?.range_end || wish?.end_date || wish?.date || wish?.start_date || wish?.range_start,
  );

/** True if the wish spans multiple days (start ≠ end). */
export const hasWishRange = (wish: WishLike | null | undefined): boolean => {
  const start = getWishStartDate(wish);
  const end = getWishEndDate(wish);
  return !!start && !!end && start !== end;
};

/** Checks whether a given date falls within the wish's range (inclusive). */
export const isWishOnDate = (wish: WishLike | null | undefined, dateValue: string | Date): boolean => {
  const day = normalizeDateString(dateValue);
  const start = getWishStartDate(wish);
  const end = getWishEndDate(wish);

  if (!day || !start || !end) return false;
  return day >= start && day <= end;
};

/** Returns a human-readable German label for the wish's date range. */
export const getWishDateLabel = (wish: WishLike | null | undefined): string => {
  const start = getWishStartDate(wish);
  const end = getWishEndDate(wish);

  if (!start && !end) return '-';
  if (!start || !end || start === end) return start || end || '-';
  return `${start} bis ${end}`;
};
