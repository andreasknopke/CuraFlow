import { describe, it, expect } from 'vitest';
import { getAutoFreiDate } from '../autoFrei';

// Monday 2024-03-11  → next day is Tuesday 2024-03-12 (working day)
// Friday  2024-03-15 → next day is Saturday (weekend) → null
// Thursday 2024-03-14 → next day is Friday 2024-03-15 (working day)

describe('getAutoFreiDate', () => {
  it('returns the next calendar day when it is a regular working day', () => {
    expect(getAutoFreiDate('2024-03-11', () => false)).toBe('2024-03-12'); // Mon → Tue
    expect(getAutoFreiDate('2024-03-14', () => false)).toBe('2024-03-15'); // Thu → Fri
  });

  it('returns null when the next day is a Saturday', () => {
    expect(getAutoFreiDate('2024-03-15', () => false)).toBe(null); // Fri → Sat
  });

  it('returns null when the next day is a Sunday', () => {
    expect(getAutoFreiDate('2024-03-16', () => false)).toBe(null); // Sat → Sun
  });

  it('returns null when the next day is a public holiday', () => {
    // Use local date parts (getFullYear/Month/Date) to avoid UTC offset issues with toISOString
    const isHoliday = (date: Date) =>
      date.getFullYear() === 2024 && date.getMonth() === 2 && date.getDate() === 12;
    expect(getAutoFreiDate('2024-03-11', isHoliday)).toBe(null);
  });

  it('handles undefined isPublicHoliday gracefully (no holiday check)', () => {
    expect(getAutoFreiDate('2024-03-11', undefined)).toBe('2024-03-12');
  });

  it('returns null for next day being Sunday even without holidays', () => {
    expect(getAutoFreiDate('2024-03-09', () => false)).toBe(null); // Sat → Sun
  });
});
