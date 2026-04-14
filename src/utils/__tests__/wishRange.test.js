import { describe, expect, it } from 'vitest';
import {
  getWishDateLabel,
  getWishEndDate,
  getWishStartDate,
  hasWishRange,
  isWishOnDate,
} from '../wishRange.js';

describe('wishRange utilities', () => {
  it('normalizes wish start and end dates from range fields', () => {
    const wish = {
      range_start: '2026-04-10T08:00:00.000Z',
      range_end: '2026-04-12T08:00:00.000Z',
    };

    expect(getWishStartDate(wish)).toBe('2026-04-10');
    expect(getWishEndDate(wish)).toBe('2026-04-12');
    expect(hasWishRange(wish)).toBe(true);
  });

  it('falls back to single-date wishes', () => {
    const wish = { date: '2026-04-15' };

    expect(getWishStartDate(wish)).toBe('2026-04-15');
    expect(getWishEndDate(wish)).toBe('2026-04-15');
    expect(hasWishRange(wish)).toBe(false);
    expect(getWishDateLabel(wish)).toBe('2026-04-15');
  });

  it('matches dates inclusively within a wish range', () => {
    const wish = {
      range_start: '2026-04-10',
      range_end: '2026-04-12',
    };

    expect(isWishOnDate(wish, '2026-04-10')).toBe(true);
    expect(isWishOnDate(wish, '2026-04-11')).toBe(true);
    expect(isWishOnDate(wish, '2026-04-12')).toBe(true);
    expect(isWishOnDate(wish, '2026-04-13')).toBe(false);
  });

  it('returns a placeholder for invalid wishes', () => {
    expect(getWishDateLabel({})).toBe('-');
    expect(isWishOnDate({}, '2026-04-10')).toBe(false);
  });

  it('returns the single date label when a range starts and ends on the same day', () => {
    const wish = { range_start: '2026-04-10', range_end: '2026-04-10' };

    expect(getWishDateLabel(wish)).toBe('2026-04-10');
  });

  it('returns a range label when start and end differ', () => {
    const wish = { range_start: '2026-04-10', range_end: '2026-04-15' };

    expect(getWishDateLabel(wish)).toBe('2026-04-10 bis 2026-04-15');
  });

  it('normalizes Date objects and ignores null lookup dates', () => {
    const wish = {
      range_start: new Date('2026-05-01T00:00:00Z'),
      range_end: new Date('2026-05-03T00:00:00Z'),
    };

    expect(getWishStartDate(wish)).toBe('2026-05-01');
    expect(getWishEndDate(wish)).toBe('2026-05-03');
    expect(isWishOnDate(wish, null)).toBe(false);
  });

  it('returns start date when start equals end (single-day range)', () => {
    const wish = { range_start: '2026-04-10', range_end: '2026-04-10' };
    expect(getWishDateLabel(wish)).toBe('2026-04-10');
  });

  it('returns "start bis end" label for a proper multi-day range', () => {
    const wish = { range_start: '2026-04-10', range_end: '2026-04-15' };
    expect(getWishDateLabel(wish)).toBe('2026-04-10 bis 2026-04-15');
  });

  it('handles Date objects in wish fields', () => {
    const wish = {
      range_start: new Date('2026-05-01T00:00:00Z'),
      range_end: new Date('2026-05-03T00:00:00Z'),
    };
    expect(getWishStartDate(wish)).toBe('2026-05-01');
    expect(getWishEndDate(wish)).toBe('2026-05-03');
    expect(hasWishRange(wish)).toBe(true);
  });

  it('isWishOnDate returns false when dateValue is null', () => {
    const wish = { range_start: '2026-04-10', range_end: '2026-04-12' };
    expect(isWishOnDate(wish, null)).toBe(false);
  });
});
