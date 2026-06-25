/**
 * Tests for the new tenant-side vacation endpoint helper.
 *
 * The route itself depends on Express + authMiddleware + JWT verification,
 * which are out of scope for vitest. The business logic is concentrated in
 * `fetchCentralAbsencesForDoctor`, exported from `server/routes/vacation.js`,
 * and is what the frontend actually relies on. These tests cover that helper
 * with a mocked mysql2 pool.
 */
import { describe, expect, it, vi } from 'vitest';

// Mock the cross-tenant helpers so the test never opens a real DB
// connection. The mocks are intentionally simple — they only need to
// accept the well-known SQL strings used by the helper.
vi.mock('../utils/centralAbsences.js', () => ({
  ensureCentralAbsenceTables: vi.fn().mockResolvedValue(undefined),
  isCentralAbsencePosition: (position) => {
    if (!position) return false;
    const normalized = String(position).trim().toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    return [
      'urlaub', 'schichturlaub', 'krank', 'frei', 'dienstreise', 'nicht verfugbar',
      'fortbildung', 'kongress', 'elternzeit', 'mutterschutz',
    ].includes(normalized);
  },
}));

import {
  fetchCentralAbsencesForDoctor,
  VACATION_ABSENCE_POSITIONS,
} from '../utils/vacationCentralAbsences.js';

/**
 * Builds a minimal mysql2-pool-shaped mock that dispatches `execute(sql)`
 * calls to the provided handler map. Anything unrecognised throws — the
 * tests should never hit unknown SQL.
 */
function createMockDb(handlers) {
  const calls = [];
  return {
    calls,
    async execute(sql, params = []) {
      calls.push({ sql: String(sql).trim().replace(/\s+/g, ' '), params });
      for (const [matcher, fn] of handlers) {
        if (typeof matcher === 'string' ? sql.includes(matcher) : matcher.test(sql)) {
          return fn(sql, params);
        }
      }
      throw new Error(`Unmocked SQL: ${sql}`);
    },
  };
}

const TENANT_ID = 'tenant-1';
const DOCTOR_ID = 'doc-42';
const EMPLOYEE_ID = 'emp-7';
const YEAR = 2026;

describe('fetchCentralAbsencesForDoctor', () => {
  it('returns an empty list when the doctor has no central link', async () => {
    const db = createMockDb([
      [ 'FROM EmployeeTenantAssignment', async () => [[], []] ],
    ]);

    const result = await fetchCentralAbsencesForDoctor({
      db,
      tenantId: TENANT_ID,
      doctorId: DOCTOR_ID,
      year: YEAR,
    });

    expect(result).toEqual({ employee_id: null, absences: [], vacation_days_annual: null });
    // Must NOT have hit the central table when there is no link.
    const centralCalls = db.calls.filter((c) => c.sql.includes('FROM CentralAbsenceEntry'));
    expect(centralCalls).toHaveLength(0);
  });

  it('returns the central absences for a linked doctor, ordered by date', async () => {
    const db = createMockDb([
      [
        'FROM EmployeeTenantAssignment',
        async () => [[{ employee_id: EMPLOYEE_ID }], []],
      ],
      [
        'FROM CentralAbsenceEntry',
        async () => [[
          { id: 'central-1', date: '2026-03-10', position: 'Urlaub', note: null },
          { id: 'central-2', date: '2026-06-10', position: 'Urlaub', note: 'Sommer' },
        ], []],
      ],
    ]);

    const result = await fetchCentralAbsencesForDoctor({
      db,
      tenantId: TENANT_ID,
      doctorId: DOCTOR_ID,
      year: YEAR,
    });

    expect(result.employee_id).toBe(EMPLOYEE_ID);
    expect(result.absences).toEqual([
      { id: 'central-1', date: '2026-03-10', position: 'Urlaub', note: null, source: 'central' },
      { id: 'central-2', date: '2026-06-10', position: 'Urlaub', note: 'Sommer', source: 'central' },
    ]);
  });

  it('normalises mysql2 Date objects into YYYY-MM-DD strings', async () => {
    const db = createMockDb([
      [ 'FROM EmployeeTenantAssignment', async () => [[{ employee_id: EMPLOYEE_ID }], []] ],
      [
        'FROM CentralAbsenceEntry',
        async () => [[
          // mysql2 hands back JS Date for DATE columns; we must not leak that.
          { id: 'c-1', date: new Date('2026-05-12T00:00:00Z'), position: 'Krank', note: null },
        ], []],
      ],
    ]);

    const result = await fetchCentralAbsencesForDoctor({
      db, tenantId: TENANT_ID, doctorId: DOCTOR_ID, year: YEAR,
    });
    // Note: toISOString yields a UTC date — we don't assert on the exact
    // string because that depends on the runtime timezone, but we do
    // assert the shape (10 chars, dash-separated, starts with the year).
    expect(result.absences[0].date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(result.absences[0].date.startsWith('2026')).toBe(true);
  });

  it('filters out rows whose position is not a central-absence position', async () => {
    const db = createMockDb([
      [ 'FROM EmployeeTenantAssignment', async () => [[{ employee_id: EMPLOYEE_ID }], []] ],
      [
        'FROM CentralAbsenceEntry',
        async () => [[
          { id: 'c-1', date: '2026-05-12', position: 'Urlaub', note: null },
          { id: 'c-2', date: '2026-05-13', position: 'CT Spätschicht', note: null },
          { id: 'c-3', date: '2026-05-14', position: 'Krank', note: null },
        ], []],
      ],
    ]);

    const result = await fetchCentralAbsencesForDoctor({
      db, tenantId: TENANT_ID, doctorId: DOCTOR_ID, year: YEAR,
    });
    expect(result.absences.map((a) => a.position)).toEqual(['Urlaub', 'Krank']);
  });

  it('passes the year into the CentralAbsenceEntry WHERE clause', async () => {
    const db = createMockDb([
      [ 'FROM EmployeeTenantAssignment', async () => [[{ employee_id: EMPLOYEE_ID }], []] ],
      [
        'FROM CentralAbsenceEntry',
        async () => [[], []],
      ],
    ]);

    await fetchCentralAbsencesForDoctor({
      db, tenantId: TENANT_ID, doctorId: DOCTOR_ID, year: 2030,
    });

    const centralCall = db.calls.find((c) => c.sql.includes('FROM CentralAbsenceEntry'));
    expect(centralCall).toBeDefined();
    expect(centralCall.params).toEqual(
      expect.arrayContaining([EMPLOYEE_ID, 2030])
    );
  });

  it('returns an empty list immediately when tenantId is null', async () => {
    const db = createMockDb([]);
    const result = await fetchCentralAbsencesForDoctor({
      db, tenantId: null, doctorId: DOCTOR_ID, year: YEAR,
    });
    expect(result).toEqual({ employee_id: null, absences: [] });
    // No SQL should be issued.
    expect(db.calls).toHaveLength(0);
  });

  it('exposes the supported absence position constant', () => {
    expect(VACATION_ABSENCE_POSITIONS).toEqual(
      expect.arrayContaining(['Urlaub', 'Krank', 'Frei'])
    );
  });
});
