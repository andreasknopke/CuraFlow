/**
 * Tests for the tenant-scoped on-demand Tisoware refresh helper.
 *
 * The route itself (`POST /api/vacation/tisoware-refresh`) depends on
 * Express + authMiddleware + JWT verification, which are out of scope for
 * vitest. The business logic lives in `refreshTenantTisowareAbsences`
 * (exported from `server/utils/tisowareTenantRefresh.ts`) and is what the
 * route actually calls — these tests cover it with a mocked mysql2 pool
 * and a mocked `executeTisowareImport`.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

// Mock the import machinery so no real Tisoware/proxy connection is made.
vi.mock('../utils/tisowareImport.js', () => ({
  executeTisowareImport: vi.fn(),
}));

import {
  refreshTenantTisowareAbsences,
  createTisowareRefreshStore,
  getTisowareRefreshCooldownSeconds,
} from '../utils/tisowareTenantRefresh.js';
import { executeTisowareImport } from '../utils/tisowareImport.js';

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

describe('getTisowareRefreshCooldownSeconds', () => {
  const originalEnv = process.env.TISOWARE_REFRESH_COOLDOWN_SECONDS;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.TISOWARE_REFRESH_COOLDOWN_SECONDS;
    } else {
      process.env.TISOWARE_REFRESH_COOLDOWN_SECONDS = originalEnv;
    }
  });

  it('defaults to 60 when the env var is unset', () => {
    delete process.env.TISOWARE_REFRESH_COOLDOWN_SECONDS;
    expect(getTisowareRefreshCooldownSeconds()).toBe(60);
  });

  it('reads a numeric value from the env var', () => {
    process.env.TISOWARE_REFRESH_COOLDOWN_SECONDS = '120';
    expect(getTisowareRefreshCooldownSeconds()).toBe(120);
  });

  it('treats "0" as "cooldown disabled"', () => {
    process.env.TISOWARE_REFRESH_COOLDOWN_SECONDS = '0';
    expect(getTisowareRefreshCooldownSeconds()).toBe(0);
  });

  it('falls back to the default for invalid values', () => {
    process.env.TISOWARE_REFRESH_COOLDOWN_SECONDS = 'abc';
    expect(getTisowareRefreshCooldownSeconds()).toBe(60);
  });

  it('falls back to the default for negative values', () => {
    process.env.TISOWARE_REFRESH_COOLDOWN_SECONDS = '-5';
    expect(getTisowareRefreshCooldownSeconds()).toBe(60);
  });
});

describe('refreshTenantTisowareAbsences', () => {
  const IMPORT_RESULT = {
    imported: 4,
    skipped_existing: 2,
    resolved_conflicts: 1,
    unresolved_conflicts: 0,
    errors_count: 0,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    executeTisowareImport.mockResolvedValue({ ...IMPORT_RESULT });
    // Default cooldown for all refresh tests unless a test overrides it.
    delete process.env.TISOWARE_REFRESH_COOLDOWN_SECONDS;
  });

  it('refreshes a single linked doctor via its payroll_id', async () => {
    const db = createMockDb([
      [
        'FROM EmployeeTenantAssignment eta',
        async () => [[{ payroll_id: '1001' }], []],
      ],
    ]);

    const result = await refreshTenantTisowareAbsences({
      db,
      tenantId: TENANT_ID,
      doctorId: DOCTOR_ID,
      createdBy: 'user-1',
      store: createTisowareRefreshStore(),
      now: 1000,
    });

    expect(executeTisowareImport).toHaveBeenCalledTimes(1);
    expect(executeTisowareImport).toHaveBeenCalledWith(
      db,
      ['1001'],
      expect.objectContaining({
        resolveConflicts: true,
        createdBy: 'user-1',
      })
    );
    expect(result).toEqual({
      skipped: false,
      scope: 'single',
      doctorId: DOCTOR_ID,
      employees: 1,
      imported: 4,
      skipped_existing: 2,
      resolved_conflicts: 1,
      unresolved_conflicts: 0,
      errors_count: 0,
    });
  });

  it('skips when the doctor has no central link or no payroll_id', async () => {
    const db = createMockDb([
      [
        'FROM EmployeeTenantAssignment eta',
        async () => [[{ payroll_id: null }], []],
      ],
    ]);

    const result = await refreshTenantTisowareAbsences({
      db,
      tenantId: TENANT_ID,
      doctorId: DOCTOR_ID,
      store: createTisowareRefreshStore(),
      now: 1000,
    });

    expect(result).toEqual({ skipped: true, reason: 'no_payroll_id', scope: `tenant:${TENANT_ID}:doctor:${DOCTOR_ID}` });
    expect(executeTisowareImport).not.toHaveBeenCalled();
  });

  it('skips when the doctor row does not exist at all', async () => {
    const db = createMockDb([
      ['FROM EmployeeTenantAssignment eta', async () => [[], []]],
    ]);

    const result = await refreshTenantTisowareAbsences({
      db,
      tenantId: TENANT_ID,
      doctorId: DOCTOR_ID,
      store: createTisowareRefreshStore(),
      now: 1000,
    });

    expect(result).toEqual({ skipped: true, reason: 'no_payroll_id', scope: `tenant:${TENANT_ID}:doctor:${DOCTOR_ID}` });
    expect(executeTisowareImport).not.toHaveBeenCalled();
  });

  it('refreshes ALL tenant employees when no doctorId is given', async () => {
    const db = createMockDb([
      [
        'SELECT DISTINCT e.payroll_id',
        async () => [[{ payroll_id: '1001' }, { payroll_id: '1002' }, { payroll_id: '' }], []],
      ],
    ]);

    const result = await refreshTenantTisowareAbsences({
      db,
      tenantId: TENANT_ID,
      store: createTisowareRefreshStore(),
      now: 1000,
    });

    expect(executeTisowareImport).toHaveBeenCalledWith(
      db,
      ['1001', '1002'], // empty payroll_id filtered out
      expect.objectContaining({ resolveConflicts: true })
    );
    expect(result).toEqual({
      skipped: false,
      scope: 'all',
      doctorId: null,
      employees: 2,
      imported: 4,
      skipped_existing: 2,
      resolved_conflicts: 1,
      unresolved_conflicts: 0,
      errors_count: 0,
    });
  });

  it('skips the all-employee refresh when the tenant has no linked payrolls', async () => {
    const db = createMockDb([
      ['SELECT DISTINCT e.payroll_id', async () => [[], []]],
    ]);

    const result = await refreshTenantTisowareAbsences({
      db,
      tenantId: TENANT_ID,
      store: createTisowareRefreshStore(),
      now: 1000,
    });

    expect(result).toEqual({ skipped: true, reason: 'no_linked_employees', scope: `tenant:${TENANT_ID}:all` });
    expect(executeTisowareImport).not.toHaveBeenCalled();
  });

  it('respects the cooldown per scope', async () => {
    const db = createMockDb([
      [
        'FROM EmployeeTenantAssignment eta',
        async () => [[{ payroll_id: '1001' }], []],
      ],
    ]);
    const store = createTisowareRefreshStore();

    const first = await refreshTenantTisowareAbsences({
      db, tenantId: TENANT_ID, doctorId: DOCTOR_ID, store, now: 1000,
    });
    expect(first.skipped).toBe(false);

    // Second call 30 s later — still within the 60 s window → skipped.
    const second = await refreshTenantTisowareAbsences({
      db, tenantId: TENANT_ID, doctorId: DOCTOR_ID, store, now: 1000 + 30_000,
    });
    expect(second).toEqual({ skipped: true, reason: 'cooldown', scope: `tenant:${TENANT_ID}:doctor:${DOCTOR_ID}` });
    expect(executeTisowareImport).toHaveBeenCalledTimes(1);

    // Third call after the window elapsed → runs again.
    const third = await refreshTenantTisowareAbsences({
      db, tenantId: TENANT_ID, doctorId: DOCTOR_ID, store, now: 1000 + 61_000,
    });
    expect(third.skipped).toBe(false);
    expect(executeTisowareImport).toHaveBeenCalledTimes(2);
  });

  it('keeps single-doctor and all-employee scopes independent', async () => {
    const db = createMockDb([
      ['FROM EmployeeTenantAssignment eta', async () => [[{ payroll_id: '1001' }], []]],
      ['SELECT DISTINCT e.payroll_id', async () => [[{ payroll_id: '1001' }], []]],
    ]);
    const store = createTisowareRefreshStore();

    const single = await refreshTenantTisowareAbsences({
      db, tenantId: TENANT_ID, doctorId: DOCTOR_ID, store, now: 1000,
    });
    expect(single.skipped).toBe(false);

    // Different scope → not throttled by the single-doctor refresh.
    const all = await refreshTenantTisowareAbsences({
      db, tenantId: TENANT_ID, store, now: 1000 + 10_000,
    });
    expect(all.skipped).toBe(false);
    expect(executeTisowareImport).toHaveBeenCalledTimes(2);
  });

  it('soft-fails when the Tisoware import throws (server unreachable)', async () => {
    const db = createMockDb([
      [
        'FROM EmployeeTenantAssignment eta',
        async () => [[{ payroll_id: '1001' }], []],
      ],
    ]);
    executeTisowareImport.mockRejectedValue(new Error('ECONNREFUSED'));

    const result = await refreshTenantTisowareAbsences({
      db,
      tenantId: TENANT_ID,
      doctorId: DOCTOR_ID,
      store: createTisowareRefreshStore(),
      now: 1000,
    });

    expect(result).toEqual({
      skipped: true,
      reason: 'tisoware_unavailable',
      scope: `tenant:${TENANT_ID}:doctor:${DOCTOR_ID}`,
      message: 'ECONNREFUSED',
    });
  });

  it('does not apply a cooldown when it is disabled via env (0)', async () => {
    process.env.TISOWARE_REFRESH_COOLDOWN_SECONDS = '0';
    const db = createMockDb([
      [
        'FROM EmployeeTenantAssignment eta',
        async () => [[{ payroll_id: '1001' }], []],
      ],
    ]);
    const store = createTisowareRefreshStore();

    await refreshTenantTisowareAbsences({ db, tenantId: TENANT_ID, doctorId: DOCTOR_ID, store, now: 1000 });
    await refreshTenantTisowareAbsences({ db, tenantId: TENANT_ID, doctorId: DOCTOR_ID, store, now: 1001 });

    expect(executeTisowareImport).toHaveBeenCalledTimes(2);
    delete process.env.TISOWARE_REFRESH_COOLDOWN_SECONDS;
  });
});
