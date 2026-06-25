/**
 * Unit tests for the year-specific Schichturlaub/Sonderurlaub helpers.
 *
 * The helpers in `server/utils/shiftVacationEntitlement.js` are pure with
 * respect to Express/auth — they take a `mysql2/promise`-shaped pool and
 * return values. We mock the pool with a tiny dispatcher.
 */
import { describe, expect, it, vi } from 'vitest';

import {
  getShiftVacationEntitlement,
  setShiftVacationEntitlement,
  computeShiftVacationRemaining,
  carryOverShiftVacation,
} from '../utils/shiftVacationEntitlement.js';

function createMockDb(handlers) {
  const calls = [];
  return {
    calls,
    async execute(sql, params = []) {
      const norm = String(sql).trim().replace(/\s+/g, ' ');
      calls.push({ sql: norm, params });
      for (const [matcher, fn] of handlers) {
        if (typeof matcher === 'string' ? sql.includes(matcher) : matcher.test(sql)) {
          return fn(sql, params);
        }
      }
      throw new Error(`Unmocked SQL: ${sql}`);
    },
  };
}

const EMPLOYEE_ID = 'emp-1';
const YEAR = 2026;

describe('getShiftVacationEntitlement', () => {
  it('returns the 0-default when no row exists', async () => {
    const db = createMockDb([
      ['FROM EmployeeVacationYear', async () => [[], []]],
    ]);
    const result = await getShiftVacationEntitlement(db, EMPLOYEE_ID, YEAR);
    expect(result).toEqual({
      shift_vacation_days: 0,
      carried_over: false,
      carried_over_from_year: null,
      note: null,
    });
  });

  it('returns the stored value, including carry-over flags, and dynamically adjusts from source', async () => {
    // When the row has carried_over=true, the helper re-computes the source
    // year's remaining. This mock simulates a source year (2025) that still
    // has all 3 days available → effective carry stays 3.
    const db = createMockDb([
      [
        'FROM EmployeeVacationYear',
        async (sql, params) => {
          if (params[1] === 2026) {
            // Target year: carried from 2025, originally 3 days.
            return [[{
              shift_vacation_days: 3,
              carried_over: 1,
              carried_over_from_year: 2025,
              note: 'Übertrag',
            }]];
          }
          // Source year (2025): entitlement 3, not carried_over itself.
          return [[{
            shift_vacation_days: 3,
            carried_over: 0,
            carried_over_from_year: null,
            note: null,
          }]];
        },
      ],
      // Source year: no additional Schichturlaub booked in 2025
      ['FROM CentralAbsenceEntry', async () => [[], []]],
    ]);
    const result = await getShiftVacationEntitlement(db, EMPLOYEE_ID, YEAR);
    expect(result).toEqual({
      shift_vacation_days: 3,
      carried_over: true,
      carried_over_from_year: 2025,
      note: 'Übertrag',
    });
  });

  it('dynamically reduces a carried-over value when the source year has consumed more Schichturlaub', async () => {
    // Source year (2025): only 2 of 3 entitlement days remaining because
    // 1 day has been taken. Effective carry → min(3, 2) = 2.
    const db = createMockDb([
      [
        'FROM EmployeeVacationYear',
        async (sql, params) => {
          if (params[1] === 2026) {
            return [[{
              shift_vacation_days: 3,
              carried_over: 1,
              carried_over_from_year: 2025,
              note: 'Übertrag',
            }]];
          }
          return [[{
            shift_vacation_days: 3,
            carried_over: 0,
            carried_over_from_year: null,
            note: null,
          }]];
        },
      ],
      // Source year: 1 Schichturlaub day already taken → only 2 remaining
      ['FROM CentralAbsenceEntry', async () => [[
        { date: new Date('2025-06-10') },
      ]]],
    ]);
    const result = await getShiftVacationEntitlement(db, EMPLOYEE_ID, YEAR);
    expect(result.shift_vacation_days).toBe(2);
    expect(result.carried_over).toBe(true);
    expect(result.carried_over_from_year).toBe(2025);
    // Verify the DB was updated with the new value
    const updateCalls = db.calls.filter((c) => c.sql.includes('UPDATE EmployeeVacationYear'));
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0].params[0]).toBe(2); // the updated value
  });

  it('clamps carry to zero when the source year has no remaining Schichturlaub', async () => {
    const db = createMockDb([
      [
        'FROM EmployeeVacationYear',
        async (sql, params) => {
          if (params[1] === 2026) {
            return [[{
              shift_vacation_days: 3,
              carried_over: 1,
              carried_over_from_year: 2025,
              note: 'Übertrag',
            }]];
          }
          return [[{
            shift_vacation_days: 3,
            carried_over: 0,
            carried_over_from_year: null,
            note: null,
          }]];
        },
      ],
      // Source year: all 3 days consumed + 1 overshoot → remaining -1
      ['FROM CentralAbsenceEntry', async () => [[
        { date: new Date('2025-01-13') }, // Mon
        { date: new Date('2025-01-14') }, // Tue
        { date: new Date('2025-01-15') }, // Wed
        { date: new Date('2025-01-16') }, // Thu
      ]]],
    ]);
    const result = await getShiftVacationEntitlement(db, EMPLOYEE_ID, YEAR);
    expect(result.shift_vacation_days).toBe(0);
    expect(result.carried_over).toBe(true);
    expect(result.carried_over_from_year).toBe(2025);
  });

  it('returns the fallback when the table does not exist yet (idempotent bootstrap)', async () => {
    const db = createMockDb([
      [
        'FROM EmployeeVacationYear',
        async () => {
          const err = new Error("Unknown table 'EmployeeVacationYear'");
          err.code = 'ER_NO_SUCH_TABLE';
          throw err;
        },
      ],
    ]);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = await getShiftVacationEntitlement(db, EMPLOYEE_ID, YEAR);
    expect(result.shift_vacation_days).toBe(0);
    // Missing-table errors must NOT be logged (deliberate graceful path).
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('setShiftVacationEntitlement', () => {
  it('rejects negative or non-integer shift vacation days', async () => {
    const db = createMockDb([]);
    await expect(
      setShiftVacationEntitlement(db, EMPLOYEE_ID, YEAR, { shift_vacation_days: -1 })
    ).rejects.toThrow(/nicht-negativ/);
    await expect(
      setShiftVacationEntitlement(db, EMPLOYEE_ID, YEAR, { shift_vacation_days: 2.5 })
    ).rejects.toThrow(/nicht-negativ/);
  });

  it('issues an UPSERT so first write and subsequent edit both succeed', async () => {
    const db = createMockDb([
      [
        'INSERT INTO EmployeeVacationYear',
        async () => [[], []],
      ],
      [
        'FROM EmployeeVacationYear',
        async () => [[{
          shift_vacation_days: 4,
          carried_over: 0,
          carried_over_from_year: null,
          note: null,
        }]],
      ],
    ]);
    const result = await setShiftVacationEntitlement(db, EMPLOYEE_ID, YEAR, { shift_vacation_days: 4 });
    expect(result.shift_vacation_days).toBe(4);
    // The UPSERT is recognisable by the ON DUPLICATE KEY UPDATE clause.
    expect(db.calls[0].sql).toContain('ON DUPLICATE KEY UPDATE');
  });
});

describe('computeShiftVacationRemaining', () => {
  function buildDb({ entitlementDays, dates }) {
    return createMockDb([
      [
        'FROM EmployeeVacationYear',
        async () => [[{
          shift_vacation_days: entitlementDays,
          carried_over: 0,
          carried_over_from_year: null,
          note: null,
        }]],
      ],
      [
        'FROM CentralAbsenceEntry',
        async () => [dates.map((d) => ({ date: d })), []],
      ],
    ]);
  }

  it('counts weekdays as taken/planned and computes a positive remainder', async () => {
    // Three weekdays in 2026 all in the past relative to TODAY.
    const db = buildDb({
      entitlementDays: 3,
      dates: ['2026-06-08', '2026-06-09', '2026-06-10'],
    });
    const result = await computeShiftVacationRemaining(db, EMPLOYEE_ID, YEAR, {
      today: '2026-06-15',
    });
    expect(result).toEqual({
      shift_vacation_total: 3,
      shift_vacation_taken: 3,
      shift_vacation_planned: 0,
      remaining_shift_vacation: 0,
    });
  });

  it('ignores weekends and public holidays', async () => {
    const db = buildDb({
      entitlementDays: 5,
      dates: ['2026-06-13', '2026-06-14', '2026-06-15'], // Sat, Sun, Mon
    });
    const holidays = new Set(['2026-06-15']);
    const result = await computeShiftVacationRemaining(db, EMPLOYEE_ID, YEAR, {
      today: '2026-06-01',
      publicHolidayDates: holidays,
    });
    expect(result.shift_vacation_taken).toBe(0);
    expect(result.shift_vacation_planned).toBe(0);
    expect(result.remaining_shift_vacation).toBe(5);
  });
});

describe('carryOverShiftVacation', () => {
  it('refuses to carry into a non-adjacent year', async () => {
    const db = createMockDb([]);
    const result = await carryOverShiftVacation(db, EMPLOYEE_ID, {
      fromYear: 2026,
      toYear: 2028,
    });
    expect(result.error).toMatch(/Folgejahr/);
  });

  it('refuses when the target year row is already marked carried_over', async () => {
    const db = createMockDb([
      [
        'FROM EmployeeVacationYear',
        async (sql, params) => {
          // Target year (2026): already carried from 2025.
          if (params[1] === 2026) {
            return [[{
              shift_vacation_days: 2,
              carried_over: 1,
              carried_over_from_year: 2025,
              note: null,
            }]];
          }
          // Source year (2025): normal row (not carried) so the dynamic
          // adjustment doesn't cascade infinitely.
          return [[{
            shift_vacation_days: 5,
            carried_over: 0,
            carried_over_from_year: null,
            note: null,
          }]];
        },
      ],
      // Source year: some Schichturlaub already taken → remaining is
      // used for the dynamic carry adjustment, but the carry-over check
      // uses the target's carried_over flag BEFORE the adjustment runs.
      ['FROM CentralAbsenceEntry', async () => [[], []]],
    ]);
    const result = await carryOverShiftVacation(db, EMPLOYEE_ID, {
      fromYear: 2025,
      toYear: 2026,
    });
    expect(result.error).toMatch(/bereits/);
  });

  it('refuses when the source year has no positive remainder', async () => {
    const db = createMockDb([
      // 1st: target-year lookup (no existing carried_over row).
      [
        'FROM EmployeeVacationYear',
        async (sql, params) => {
          // Target year (2027) has no row yet.
          if (params[1] === 2027) return [[], []];
          // Source year (2026): entitlement fully consumed.
          return [[{
            shift_vacation_days: 2,
            carried_over: 0,
            carried_over_from_year: null,
            note: null,
          }]];
        },
      ],
      [
        'FROM CentralAbsenceEntry',
        async () => [['2026-06-08', '2026-06-09'].map((d) => ({ date: d }))],
      ],
    ]);
    const result = await carryOverShiftVacation(db, EMPLOYEE_ID, {
      fromYear: 2026,
      toYear: 2027,
    });
    expect(result.error).toMatch(/kein Rest/);
  });

  it('writes carried days as a fresh carried_over row when remainder > 0', async () => {
    let upsertParams = null;
    const db = createMockDb([
      [
        'FROM EmployeeVacationYear',
        async (sql, params) => {
          if (params[1] === 2027) return [[], []];
          return [[{
            shift_vacation_days: 5,
            carried_over: 0,
            carried_over_from_year: null,
            note: null,
          }]];
        },
      ],
      [
        'FROM CentralAbsenceEntry',
        async () => [['2026-06-08'].map((d) => ({ date: d }))], // 1 taken
      ],
      [
        'INSERT INTO EmployeeVacationYear',
        async (sql, params) => {
          upsertParams = params;
          return [[], []];
        },
      ],
    ]);
    const result = await carryOverShiftVacation(db, EMPLOYEE_ID, {
      fromYear: 2026,
      toYear: 2027,
      today: '2026-12-31',
    });
    expect(result.carried_days).toBe(4); // 5 - 1 taken - 0 planned
    expect(result.fromYear).toBe(2026);
    expect(result.toYear).toBe(2027);
    // The UPSERT must flag the new row as carried_over and remember the
    // source year so the UI can show the "Übertrag aus 2026" badge.
    // INSERT column order: (employee_id, year, shift_vacation_days,
    // carried_over, carried_over_from_year, note, updated_by).
    expect(upsertParams[0]).toBe(EMPLOYEE_ID);
    expect(upsertParams[1]).toBe(2027);
    expect(upsertParams[2]).toBe(4);          // shift_vacation_days
    expect(upsertParams[3]).toBe(1);          // carried_over = TRUE
    expect(upsertParams[4]).toBe(2026);       // carried_over_from_year
  });
});
