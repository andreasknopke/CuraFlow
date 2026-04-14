import { format, parseISO, isValid } from 'date-fns';

interface WishLike {
  range_start?: string | Date | null;
  range_end?: string | Date | null;
  date?: string | Date | null;
}

const normalizeDateString = (value: string | Date | null | undefined): string | null => {
  if (!value) return null;
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;

  const parsed = value instanceof Date ? value : parseISO(String(value));
  if (!isValid(parsed)) return null;
  return format(parsed, 'yyyy-MM-dd');
};

export const getWishStartDate = (wish: WishLike | null | undefined): string | null =>
  normalizeDateString(wish?.range_start || wish?.date);

export const getWishEndDate = (wish: WishLike | null | undefined): string | null =>
  normalizeDateString(wish?.range_end || wish?.date || wish?.range_start);

export const hasWishRange = (wish: WishLike | null | undefined): boolean => {
  const start = getWishStartDate(wish);
  const end = getWishEndDate(wish);
  return !!start && !!end && start !== end;
};

export const isWishOnDate = (
  wish: WishLike | null | undefined,
  dateValue: string | Date | null | undefined,
): boolean => {
  const day = normalizeDateString(dateValue);
  const start = getWishStartDate(wish);
  const end = getWishEndDate(wish);

  if (!day || !start || !end) return false;
  return day >= start && day <= end;
};

export const getWishDateLabel = (wish: WishLike | null | undefined): string => {
  const start = getWishStartDate(wish);
  const end = getWishEndDate(wish);

  if (!start && !end) return '-';
  if (!start || !end || start === end) return start || end || '-';
  return `${start} bis ${end}`;
};
