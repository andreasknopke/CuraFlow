import { describe, it, expect } from 'vitest';
import { addDays, isWeekend, format } from 'date-fns';
import { computeVacationBalance, decidePositionsForUrlaubsDays, parseAnnualVacationDays } from '../vacationBalance';

/**
 * Build `count` consecutive weekday dates (Mon–Fri) starting from
 * `start`, formatted as `yyyy-MM-dd`. Skips weekends while counting.
 */
function buildWeekdays(start, count) {
  const dates = [];
  let cursor = new Date(start);
  while (dates.length < count) {
    if (!isWeekend(cursor)) {
      dates.push(format(cursor, 'yyyy-MM-dd'));
    }
    cursor = addDays(cursor, 1);
  }
  return dates;
}

const YEAR = 2026;
const TODAY = new Date(`${YEAR}-06-15T12:00:00`);

describe('computeVacationBalance', () => {
  it('returns the annual entitlement as remaining when there are no shifts', () => {
    const result = computeVacationBalance({
      shifts: [],
      year: YEAR,
      annualVacationDays: 30,
      today: TODAY,
    });
    expect(result).toEqual({
      total: 30,
      taken: 0,
      planned: 0,
      remaining: 30,
      overshoot: false,
    });
  });

  it('counts a past workday Urlaub shift as taken', () => {
    // 2026-06-10 is a Wednesday
    const result = computeVacationBalance({
      shifts: [{ date: `${YEAR}-06-10`, position: 'Urlaub' }],
      year: YEAR,
      annualVacationDays: 30,
      today: TODAY,
    });
    expect(result.taken).toBe(1);
    expect(result.planned).toBe(0);
    expect(result.remaining).toBe(29);
  });

  it('counts a future workday Urlaub shift as planned', () => {
    // 2026-06-20 is a Saturday → not counted as planned (weekend).
    // 2026-06-22 is a Monday → counted as planned.
    const result = computeVacationBalance({
      shifts: [
        { date: `${YEAR}-06-22`, position: 'Urlaub' },
        { date: `${YEAR}-06-20`, position: 'Urlaub' },
      ],
      year: YEAR,
      annualVacationDays: 30,
      today: TODAY,
    });
    expect(result.taken).toBe(0);
    expect(result.planned).toBe(1);
    expect(result.remaining).toBe(29);
  });

  it('skips weekends (Sat/Sun) even when marked as Urlaub', () => {
    // 2026-06-13 Saturday, 2026-06-14 Sunday
    const result = computeVacationBalance({
      shifts: [
        { date: `${YEAR}-06-13`, position: 'Urlaub' },
        { date: `${YEAR}-06-14`, position: 'Urlaub' },
      ],
      year: YEAR,
      annualVacationDays: 30,
      today: TODAY,
    });
    expect(result.taken).toBe(0);
    expect(result.planned).toBe(0);
    expect(result.remaining).toBe(30);
  });

  it('skips dates on the public-holiday set', () => {
    // 2026-06-10 is a Wednesday — counted unless on holiday list.
    const holidays = new Set([`${YEAR}-06-10`]);
    const result = computeVacationBalance({
      shifts: [{ date: `${YEAR}-06-10`, position: 'Urlaub' }],
      year: YEAR,
      annualVacationDays: 30,
      today: TODAY,
      publicHolidayDates: holidays,
    });
    expect(result.taken).toBe(0);
    expect(result.remaining).toBe(30);
  });

  it('ignores shifts of positions other than Urlaub', () => {
    const result = computeVacationBalance({
      shifts: [
        { date: `${YEAR}-06-10`, position: 'Krank' },
        { date: `${YEAR}-06-11`, position: 'Frei' },
        { date: `${YEAR}-06-12`, position: 'Dienstreise' },
      ],
      year: YEAR,
      annualVacationDays: 30,
      today: TODAY,
    });
    expect(result.taken).toBe(0);
    expect(result.planned).toBe(0);
    expect(result.remaining).toBe(30);
  });

  it('only counts shifts of the requested year', () => {
    const result = computeVacationBalance({
      shifts: [
        { date: '2025-06-10', position: 'Urlaub' },
        { date: `${YEAR}-06-10`, position: 'Urlaub' },
      ],
      year: YEAR,
      annualVacationDays: 30,
      today: TODAY,
    });
    expect(result.taken).toBe(1);
  });

  it('falls back to 30 days when annualVacationDays is null/undefined/empty string', () => {
    for (const falsy of [null, undefined, '']) {
      const result = computeVacationBalance({
        shifts: [],
        year: YEAR,
        annualVacationDays: falsy,
        today: TODAY,
      });
      expect(result.total).toBe(30);
    }
  });

  it('accepts 0 as a valid (legitimate zero) annual entitlement', () => {
    const result = computeVacationBalance({
      shifts: [],
      year: YEAR,
      annualVacationDays: 0,
      today: TODAY,
    });
    expect(result.total).toBe(0);
  });

  it('flags overshoot when remaining goes below zero', () => {
    // Build exactly 5 past weekdays and 26 future weekdays (Mon–Fri only),
    // starting from known-anchored dates so the test is deterministic.
    const pastDates = buildWeekdays(new Date(`${YEAR}-05-04T12:00:00`), 5);
    const futureDates = buildWeekdays(new Date(`${YEAR}-07-01T12:00:00`), 26);
    const shifts = [...pastDates, ...futureDates].map((d) => ({ date: d, position: 'Urlaub' }));
    const result = computeVacationBalance({
      shifts,
      year: YEAR,
      annualVacationDays: 30,
      today: TODAY,
    });
    expect(result.taken).toBe(5);
    expect(result.planned).toBe(26);
    expect(result.remaining).toBe(-1);
    expect(result.overshoot).toBe(true);
  });

  it('includes the candidateDate in the planned count (UI in-progress)', () => {
    // 2026-06-16 is a Tuesday — future relative to today.
    const result = computeVacationBalance({
      shifts: [],
      year: YEAR,
      annualVacationDays: 30,
      today: TODAY,
      candidateDate: `${YEAR}-06-16`,
    });
    expect(result.planned).toBe(1);
    expect(result.remaining).toBe(29);
  });

  it('skips candidateDate when it falls on a weekend', () => {
    // 2026-06-20 is a Saturday
    const result = computeVacationBalance({
      shifts: [],
      year: YEAR,
      annualVacationDays: 30,
      today: TODAY,
      candidateDate: `${YEAR}-06-20`,
    });
    expect(result.planned).toBe(0);
    expect(result.remaining).toBe(30);
  });

  it('accepts Date objects in shifts[].date', () => {
    const d = new Date(`${YEAR}-06-10T00:00:00`);
    const result = computeVacationBalance({
      shifts: [{ date: d, position: 'Urlaub' }],
      year: YEAR,
      annualVacationDays: 30,
      today: TODAY,
    });
    expect(result.taken).toBe(1);
  });

  it('accepts an array for publicHolidayDates (in addition to Set)', () => {
    const result = computeVacationBalance({
      shifts: [{ date: `${YEAR}-06-10`, position: 'Urlaub' }],
      year: YEAR,
      annualVacationDays: 30,
      today: TODAY,
      publicHolidayDates: [`${YEAR}-06-10`],
    });
    expect(result.taken).toBe(0);
  });

  it('ignores malformed shift entries without crashing', () => {
    const result = computeVacationBalance({
      shifts: [
        null,
        undefined,
        {},
        { date: 'not-a-date', position: 'Urlaub' },
        { date: `${YEAR}-06-10`, position: 'Urlaub' },
      ],
      year: YEAR,
      annualVacationDays: 30,
      today: TODAY,
    });
    expect(result.taken).toBe(1);
  });
});

describe('computeVacationBalance — Schichturlaub', () => {
  it('only counts Schichturlaub shifts when position is passed', () => {
    // Same date: one Urlaub, one Schichturlaub. Urlaub must be ignored.
    const result = computeVacationBalance({
      shifts: [
        { date: `${YEAR}-06-10`, position: 'Urlaub' },
        { date: `${YEAR}-06-11`, position: 'Schichturlaub' },
      ],
      year: YEAR,
      position: 'Schichturlaub',
      annualVacationDays: 3,
      today: TODAY,
    });
    expect(result.taken).toBe(1);
    expect(result.planned).toBe(0);
    expect(result.remaining).toBe(2);
  });

  it('uses the actual 0 entitlement without falling back to 30', () => {
    const result = computeVacationBalance({
      shifts: [],
      year: YEAR,
      position: 'Schichturlaub',
      annualVacationDays: 0,
      today: TODAY,
    });
    expect(result.total).toBe(0);
    expect(result.remaining).toBe(0);
  });

  it('flags overshoot when more Schichturlaub is booked than granted', () => {
    const result = computeVacationBalance({
      shifts: [
        { date: `${YEAR}-06-10`, position: 'Schichturlaub' },
        { date: `${YEAR}-06-11`, position: 'Schichturlaub' },
        { date: `${YEAR}-06-12`, position: 'Schichturlaub' },
      ],
      year: YEAR,
      position: 'Schichturlaub',
      annualVacationDays: 2,
      today: TODAY,
    });
    expect(result.taken).toBe(3);
    expect(result.remaining).toBe(-1);
    expect(result.overshoot).toBe(true);
  });
});

describe('parseAnnualVacationDays', () => {
  it('returns the numeric value for finite numbers', () => {
    expect(parseAnnualVacationDays(30)).toBe(30);
    expect(parseAnnualVacationDays(0)).toBe(0);
    expect(parseAnnualVacationDays('26')).toBe(26);
  });

  it('falls back to 30 for null/undefined/empty string/non-numeric', () => {
    expect(parseAnnualVacationDays(null)).toBe(30);
    expect(parseAnnualVacationDays(undefined)).toBe(30);
    expect(parseAnnualVacationDays('')).toBe(30);
    expect(parseAnnualVacationDays('n/a')).toBe(30);
  });
});

describe('decidePositionsForUrlaubsDays', () => {
  it('returns Urlaub for all days when regular quota is sufficient', () => {
    const result = decidePositionsForUrlaubsDays({
      newDays: ['2026-06-10', '2026-06-11'],
      regularVacationBalance: { total: 30, remaining: 20 },
      shiftVacationBalance: { total: 3, remaining: 3 },
    });
    expect(result.positions).toEqual(['Urlaub', 'Urlaub']);
    expect(result.shiftedToSchichturlaub).toBe(0);
    expect(result.regularOvershoot).toBe(0);
  });

  it('falls back to Schichturlaub for over-quota days when shift balance is positive', () => {
    // Regular quota fully used (remaining 0), 3 shift-vacation days
    // available. 5 new days → first 3 use Schichturlaub, last 2 overshoot.
    const result = decidePositionsForUrlaubsDays({
      newDays: ['2026-06-10', '2026-06-11', '2026-06-12', '2026-06-15', '2026-06-16'],
      regularVacationBalance: { total: 30, remaining: 0 },
      shiftVacationBalance: { total: 3, remaining: 3 },
    });
    expect(result.positions).toEqual([
      'Schichturlaub', 'Schichturlaub', 'Schichturlaub',
      'Urlaub', 'Urlaub',
    ]);
    expect(result.shiftedToSchichturlaub).toBe(3);
    expect(result.regularOvershoot).toBe(2);
  });

  it('expects only overshoot once Schichturlaub is also exhausted', () => {
    // The user\'s scenario: regular is already at -2 (overshoot), 3
    // Schichturlaub are available. New days should consume Schichturlaub
    // first because regular is exhausted.
    const result = decidePositionsForUrlaubsDays({
      newDays: ['2026-06-10', '2026-06-11'],
      regularVacationBalance: { total: 30, remaining: -2 },
      shiftVacationBalance: { total: 3, remaining: 3 },
    });
    // remaining -2 means already 32 of 30 used. So all new days prefer
    // Schichturlaub (still has 3 free).
    expect(result.positions).toEqual(['Schichturlaub', 'Schichturlaub']);
    expect(result.shiftedToSchichturlaub).toBe(2);
    expect(result.regularOvershoot).toBe(0);
  });

  it('preserves existing Urlaub/Schichturlaub days (no double-counting)', () => {
    const result = decidePositionsForUrlaubsDays({
      newDays: ['2026-06-10', '2026-06-11'],
      regularVacationBalance: { total: 30, remaining: 10 },
      shiftVacationBalance: { total: 3, remaining: 3 },
      existingByDate: { '2026-06-10': 'Urlaub' },
    });
    // 2026-06-10 already Urlaub → kept as-is (not counted against quota).
    expect(result.positions).toEqual(['Urlaub', 'Urlaub']);
    expect(result.shiftedToSchichturlaub).toBe(0);
  });

  it('processes days chronologically even when input is unordered', () => {
    // Later dates first — helper should still consume quota in date order.
    const result = decidePositionsForUrlaubsDays({
      newDays: ['2026-06-15', '2026-06-10'],
      regularVacationBalance: { total: 30, remaining: 0 },
      shiftVacationBalance: { total: 1, remaining: 1 },
    });
    // Chronological: 06-10 first → Schichturlaub (only 1 left), 06-15 → Urlaub overshoot
    expect(result.positions).toEqual(['Urlaub', 'Schichturlaub']);
    expect(result.shiftedToSchichturlaub).toBe(1);
    expect(result.regularOvershoot).toBe(1);
  });

  it('returns Urlaub for all when no shift balance is provided', () => {
    const result = decidePositionsForUrlaubsDays({
      newDays: ['2026-06-10'],
      regularVacationBalance: { total: 30, remaining: 0 },
    });
    expect(result.positions).toEqual(['Urlaub']);
    expect(result.shiftedToSchichturlaub).toBe(0);
    expect(result.regularOvershoot).toBe(1);
  });

  it('returns Urlaub for all when regularVacationBalance is missing', () => {
    const result = decidePositionsForUrlaubsDays({
      newDays: ['2026-06-10', '2026-06-11'],
    });
    expect(result.positions).toEqual(['Urlaub', 'Urlaub']);
    expect(result.shiftedToSchichturlaub).toBe(0);
  });
});
