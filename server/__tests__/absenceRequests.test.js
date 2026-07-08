/**
 * Unit tests for AbsenceRequest pure helpers.
 *
 * The helpers in `server/utils/absenceRequests.js` are pure with respect
 * to Express/auth — they take a `mysql2/promise`-shaped pool and return
 * values. We mock the pool with a tiny dispatcher.
 */
import { describe, expect, it, vi, beforeAll } from 'vitest';

import {
  createAbsenceRequest,
  listAbsenceRequests,
  updateAbsenceRequestStatus,
  deleteAbsenceRequest,
  ensureAbsenceRequestTables,
  isRequestableAbsencePosition,
  isFutureDate,
  REQUEST_ABSENCE_POSITIONS,
  REQUEST_ABSENCE_POSITIONS_SET,
} from '../utils/absenceRequests.js';

// ─── Mock helpers ────────────────────────────────────────────────────────────

function createMockDb(handlers) {
  const calls = [];
  // Shared execute function used by both pool and connection
  const sharedExecute = async (sql, params = []) => {
    const norm = String(sql).trim().replace(/\s+/g, ' ');
    calls.push({ sql: norm, params });
    for (const [matcher, fn] of handlers) {
      if (typeof matcher === 'string' ? norm.includes(matcher) : matcher.test(norm)) {
        return fn(sql, params);
      }
    }
    return [[], []];
  };
  const db = {
    calls,
    execute: sharedExecute,
    async getConnection() {
      const conn = {
        async beginTransaction() {},
        async commit() {},
        async rollback() {},
        execute: sharedExecute,
        release() {},
      };
      return conn;
    },
  };
  return { db, calls };
}

const TENANT_ID = 'tenant-1';
const DOCTOR_ID = 'doctor-1';
const EMPLOYEE_ID = 'emp-1';
const USER_ID = 'user-1';
const FUTURE_DATE = '2027-06-15'; // well in the future
const PAST_DATE = '2025-01-01';

// ─── Helpers ─────────────────────────────────────────────────────────────────

describe('isRequestableAbsencePosition', () => {
  it('returns true for Urlaub, Frei, Dienstreise', () => {
    expect(isRequestableAbsencePosition('Urlaub')).toBe(true);
    expect(isRequestableAbsencePosition('Frei')).toBe(true);
    expect(isRequestableAbsencePosition('Dienstreise')).toBe(true);
  });

  it('returns false for Krank, Fortbildung, undefined, null', () => {
    expect(isRequestableAbsencePosition('Krank')).toBe(false);
    expect(isRequestableAbsencePosition('Fortbildung')).toBe(false);
    expect(isRequestableAbsencePosition(null)).toBe(false);
    expect(isRequestableAbsencePosition(undefined)).toBe(false);
    expect(isRequestableAbsencePosition('')).toBe(false);
  });
});

describe('isFutureDate', () => {
  it('returns true for a date in the future', () => {
    expect(isFutureDate('2099-12-31')).toBe(true);
  });

  it('returns false for today (now)', () => {
    const today = new Date();
    const yyyymmdd = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    expect(isFutureDate(yyyymmdd)).toBe(false);
  });

  it('returns false for a past date', () => {
    expect(isFutureDate('2020-01-01')).toBe(false);
  });

  it('returns false for malformed strings', () => {
    expect(isFutureDate('abc')).toBe(false);
    expect(isFutureDate('2025-13-40')).toBe(false);
    expect(isFutureDate(null)).toBe(false);
    expect(isFutureDate(undefined)).toBe(false);
  });
});

describe('createAbsenceRequest', () => {
  it('creates a pending request for Urlaub', async () => {
    const { db } = createMockDb([
      [
        'INSERT INTO AbsenceRequest',
        async () => [[], []],
      ],
      [
        'SELECT * FROM AbsenceRequest',
        async () => {
          return [[{
            id: 'req-1',
            employee_id: EMPLOYEE_ID,
            source_tenant_id: TENANT_ID,
            source_tenant_doctor_id: DOCTOR_ID,
            date: FUTURE_DATE,
            position: 'Urlaub',
            status: 'pending',
            reason: 'Erholungsurlaub',
            admin_comment: null,
            user_viewed: 0,
            approved_by: null,
            approved_date: null,
            created_by: USER_ID,
          }]];
        },
      ],
    ]);

    const result = await createAbsenceRequest({
      masterDb: db,
      tenantId: TENANT_ID,
      tenantDoctorId: DOCTOR_ID,
      employeeId: EMPLOYEE_ID,
      date: FUTURE_DATE,
      position: 'Urlaub',
      reason: 'Erholungsurlaub',
      createdBy: USER_ID,
    });

    expect(result.employee_id).toBe(EMPLOYEE_ID);
    expect(result.position).toBe('Urlaub');
    expect(result.status).toBe('pending');
  });

  it('rejects a past date with 422', async () => {
    const { db } = createMockDb([]);
    await expect(
      createAbsenceRequest({
        masterDb: db,
        tenantId: TENANT_ID,
        tenantDoctorId: DOCTOR_ID,
        employeeId: EMPLOYEE_ID,
        date: PAST_DATE,
        position: 'Urlaub',
        createdBy: USER_ID,
      })
    ).rejects.toMatchObject({ statusCode: 422 });
  });

  it('rejects a non-whitelist position with 422', async () => {
    const { db } = createMockDb([]);
    await expect(
      createAbsenceRequest({
        masterDb: db,
        tenantId: TENANT_ID,
        tenantDoctorId: DOCTOR_ID,
        employeeId: EMPLOYEE_ID,
        date: FUTURE_DATE,
        position: 'Krank',
        createdBy: USER_ID,
      })
    ).rejects.toMatchObject({ statusCode: 422 });
  });

  it('rejects a missing employee_id with 422', async () => {
    const { db } = createMockDb([]);
    await expect(
      createAbsenceRequest({
        masterDb: db,
        tenantId: TENANT_ID,
        tenantDoctorId: DOCTOR_ID,
        employeeId: null,
        date: FUTURE_DATE,
        position: 'Urlaub',
        createdBy: USER_ID,
      })
    ).rejects.toMatchObject({ statusCode: 422 });
  });

  it('returns 409 when duplicate date + employee exists', async () => {
    const { db } = createMockDb([
      [
        'INSERT INTO AbsenceRequest',
        async () => { throw Object.assign(new Error('Duplicate entry'), { code: 'ER_DUP_ENTRY' }); },
      ],
    ]);

    await expect(
      createAbsenceRequest({
        masterDb: db,
        tenantId: TENANT_ID,
        tenantDoctorId: DOCTOR_ID,
        employeeId: EMPLOYEE_ID,
        date: FUTURE_DATE,
        position: 'Urlaub',
        createdBy: USER_ID,
      })
    ).rejects.toMatchObject({ statusCode: 409 });
  });
});

describe('listAbsenceRequests', () => {
  it('returns empty array when no tenantId', async () => {
    const { db } = createMockDb([]);
    const results = await listAbsenceRequests({
      masterDb: db,
      tenantId: null,
    });
    expect(results).toEqual([]);
  });

  it('filters by tenant', async () => {
    const { db, calls } = createMockDb([
      [
        'SELECT * FROM AbsenceRequest',
        async () => {
          return [[
            { id: 'req-1', employee_id: EMPLOYEE_ID, source_tenant_id: TENANT_ID, date: FUTURE_DATE, position: 'Urlaub', status: 'pending' },
          ]];
        },
      ],
    ]);

    const results = await listAbsenceRequests({
      masterDb: db,
      tenantId: TENANT_ID,
    });

    expect(results).toHaveLength(1);
    expect(calls.some(c => c.sql.includes('source_tenant_id = ?'))).toBe(true);
  });

  it('filters by doctorId', async () => {
    const { db, calls } = createMockDb([
      [
        'SELECT * FROM AbsenceRequest',
        async () => [[{ id: 'req-1', source_tenant_doctor_id: DOCTOR_ID }]],
      ],
    ]);

    await listAbsenceRequests({
      masterDb: db,
      tenantId: TENANT_ID,
      doctorId: DOCTOR_ID,
    });

    expect(calls.some(c => c.sql.includes('source_tenant_doctor_id = ?'))).toBe(true);
  });

  it('filters by status', async () => {
    const { db, calls } = createMockDb([
      [
        'SELECT * FROM AbsenceRequest',
        async () => [[{ id: 'req-1', status: 'pending' }]],
      ],
    ]);

    await listAbsenceRequests({
      masterDb: db,
      tenantId: TENANT_ID,
      status: 'pending',
    });

    expect(calls.some(c => c.sql.includes("status = ?"))).toBe(true);
  });
});

describe('updateAbsenceRequestStatus', () => {
  const FUTURE_DATE_STR = '2027-06-15';

  it('approves a pending request and writes CentralAbsenceEntry', async () => {
    let centralEntryInserted = false;
    let updateCalled = false;
    const { db } = createMockDb([
      [
        'SELECT * FROM AbsenceRequest WHERE id = ?',
        async () => {
          if (!updateCalled) {
            // Before update: returns pending
            return [[
              { id: 'req-1', employee_id: EMPLOYEE_ID, date: FUTURE_DATE_STR, position: 'Urlaub', status: 'pending', reason: 'Erholung', source_tenant_id: TENANT_ID, source_tenant_doctor_id: DOCTOR_ID },
            ]];
          }
          // After update: returns approved
          return [[
            { id: 'req-1', employee_id: EMPLOYEE_ID, date: FUTURE_DATE_STR, position: 'Urlaub', status: 'approved', approved_by: 'admin-1' },
          ]];
        },
      ],
      [
        'UPDATE AbsenceRequest',
        async () => { updateCalled = true; return [[], []]; },
      ],
      [
        'INSERT INTO CentralAbsenceEntry',
        async () => { centralEntryInserted = true; return [[], []]; },
      ],
    ]);

    const result = await updateAbsenceRequestStatus({
      masterDb: db,
      requestId: 'req-1',
      status: 'approved',
      adminUserId: 'admin-1',
      adminComment: 'Genehmigt',
    });

    expect(result.status).toBe('approved');
    expect(centralEntryInserted).toBe(true);
  });

  it('rejects a pending request without writing CentralAbsenceEntry', async () => {
    let centralEntryInserted = false;
    let updateCalled = false;
    const { db } = createMockDb([
      [
        'SELECT * FROM AbsenceRequest WHERE id = ?',
        async () => {
          if (!updateCalled) {
            return [[
              { id: 'req-2', employee_id: EMPLOYEE_ID, date: FUTURE_DATE_STR, position: 'Frei', status: 'pending' },
            ]];
          }
          return [[
            { id: 'req-2', employee_id: EMPLOYEE_ID, date: FUTURE_DATE_STR, position: 'Frei', status: 'rejected', approved_by: 'admin-1' },
          ]];
        },
      ],
      [
        'UPDATE AbsenceRequest',
        async () => { updateCalled = true; return [[], []]; },
      ],
      [
        'INSERT INTO CentralAbsenceEntry',
        async () => { centralEntryInserted = true; return [[], []]; },
      ],
    ]);

    const result = await updateAbsenceRequestStatus({
      masterDb: db,
      requestId: 'req-2',
      status: 'rejected',
      adminUserId: 'admin-1',
    });

    expect(result.status).toBe('rejected');
    expect(centralEntryInserted).toBe(false);
  });

  it('returns 404 for a missing request', async () => {
    const { db } = createMockDb([
      [
        'SELECT * FROM AbsenceRequest WHERE id = ?',
        async () => [[], []],
      ],
    ]);

    await expect(
      updateAbsenceRequestStatus({
        masterDb: db,
        requestId: 'nonexistent',
        status: 'approved',
        adminUserId: 'admin-1',
      })
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('returns 409 when request is already processed', async () => {
    const { db } = createMockDb([
      [
        'SELECT * FROM AbsenceRequest WHERE id = ?',
        async () => {
          return [[
            { id: 'req-1', employee_id: EMPLOYEE_ID, status: 'approved' },
          ]];
        },
      ],
    ]);

    await expect(
      updateAbsenceRequestStatus({
        masterDb: db,
        requestId: 'req-1',
        status: 'approved',
        adminUserId: 'admin-1',
      })
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it('overwrites existing CentralAbsenceEntry via ON DUPLICATE KEY', async () => {
    let updateCalled = false;
    const { db } = createMockDb([
      [
        'SELECT * FROM AbsenceRequest WHERE id = ?',
        async () => {
          if (!updateCalled) {
            return [[
              { id: 'req-3', employee_id: EMPLOYEE_ID, date: FUTURE_DATE_STR, position: 'Dienstreise', status: 'pending', reason: null, source_tenant_id: TENANT_ID, source_tenant_doctor_id: DOCTOR_ID },
            ]];
          }
          return [[
            { id: 'req-3', status: 'approved' },
          ]];
        },
      ],
      [
        'UPDATE AbsenceRequest',
        async () => { updateCalled = true; return [[], []]; },
      ],
      [
        'ON DUPLICATE KEY UPDATE',
        async () => [[], []],
      ],
    ]);

    const result = await updateAbsenceRequestStatus({
      masterDb: db,
      requestId: 'req-3',
      status: 'approved',
      adminUserId: 'admin-1',
    });

    expect(result.status).toBe('approved');
  });
});

describe('deleteAbsenceRequest', () => {
  it('deletes a pending request', async () => {
    const { db } = createMockDb([
      [
        'SELECT id, status FROM AbsenceRequest',
        async () => [[{ id: 'req-1', status: 'pending' }]],
      ],
      [
        'DELETE FROM AbsenceRequest',
        async () => [[], []],
      ],
    ]);

    const result = await deleteAbsenceRequest({ masterDb: db, requestId: 'req-1' });
    expect(result).toBe(true);
  });

  it('rejects deletion of an approved request', async () => {
    const { db } = createMockDb([
      [
        'SELECT id, status FROM AbsenceRequest',
        async () => [[{ id: 'req-1', status: 'approved' }]],
      ],
    ]);

    await expect(
      deleteAbsenceRequest({ masterDb: db, requestId: 'req-1' })
    ).rejects.toMatchObject({ statusCode: 422 });
  });

  it('returns false for a missing request', async () => {
    const { db } = createMockDb([
      [
        'SELECT id, status FROM AbsenceRequest',
        async () => [[], []],
      ],
    ]);

    const result = await deleteAbsenceRequest({ masterDb: db, requestId: 'nonexistent' });
    expect(result).toBe(false);
  });
});
