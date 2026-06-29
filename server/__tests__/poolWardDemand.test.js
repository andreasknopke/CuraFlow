import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  ensurePoolWardDemandTables,
  POOL_WARD_DEMAND_WRITABLE_COLUMNS,
  assertNoOpenDemandForCell,
  markDemandFulfilledForCell,
  reopenDemandOnShiftDelete,
} from '../utils/poolWardDemand.js';

describe('POOL_WARD_DEMAND_WRITABLE_COLUMNS', () => {
  it('contains all expected column names', () => {
    const expected = [
      'shared_workplace_id',
      'group_id',
      'ward_tenant_id',
      'date',
      'timeslot_id',
      'note',
      'status',
      'fulfilled_by_shift_id',
      'created_by',
    ];
    for (const col of expected) {
      expect(POOL_WARD_DEMAND_WRITABLE_COLUMNS.has(col)).toBe(true);
    }
  });

  it('does NOT contain id, created_at, updated_at (auto-managed)', () => {
    expect(POOL_WARD_DEMAND_WRITABLE_COLUMNS.has('id')).toBe(false);
    expect(POOL_WARD_DEMAND_WRITABLE_COLUMNS.has('created_at')).toBe(false);
    expect(POOL_WARD_DEMAND_WRITABLE_COLUMNS.has('updated_at')).toBe(false);
  });
});

describe('ensurePoolWardDemandTables', () => {
  it('calls CREATE TABLE IF NOT EXISTS and sets guarded flag', async () => {
    const execute = vi.fn().mockResolvedValue([[], []]);
    const masterDb = { execute };

    await ensurePoolWardDemandTables(masterDb);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0][0]).toContain('CREATE TABLE IF NOT EXISTS pool_ward_demand');

    // Second call should be a no-op (module-level guard)
    await ensurePoolWardDemandTables(masterDb);
    expect(execute).toHaveBeenCalledTimes(1); // still 1
  });
});

describe('assertNoOpenDemandForCell', () => {
  let masterDb;

  beforeEach(() => {
    masterDb = {
      execute: vi.fn(),
    };
  });

  it('resolves when no open demand exists', async () => {
    masterDb.execute.mockResolvedValue([[], []]);
    await expect(
      assertNoOpenDemandForCell(masterDb, {
        sharedWorkplaceId: 'wp-1',
        wardTenantId: 'tenant-1',
        date: '2026-07-15',
        timeslotId: null,
      })
    ).resolves.toBeUndefined();
    expect(masterDb.execute).toHaveBeenCalledWith(
      expect.stringContaining('SELECT id FROM pool_ward_demand'),
      expect.arrayContaining(['wp-1', 'tenant-1', '2026-07-15'])
    );
  });

  it('rejects with 409 when an open demand exists', async () => {
    masterDb.execute.mockResolvedValue([[{ id: 'demand-1' }], []]);
    await expect(
      assertNoOpenDemandForCell(masterDb, {
        sharedWorkplaceId: 'wp-1',
        wardTenantId: 'tenant-1',
        date: '2026-07-15',
        timeslotId: 'ts-1',
      })
    ).rejects.toMatchObject({ status: 409, existingId: 'demand-1' });
  });

  it('treats empty string timeslotId the same as null', async () => {
    masterDb.execute.mockResolvedValue([[], []]);
    masterDb.execute.mockReset();
    masterDb.execute.mockResolvedValue([[], []]);
    // With explicit null
    await assertNoOpenDemandForCell(masterDb, {
      sharedWorkplaceId: 'wp-1', wardTenantId: 'tenant-1',
      date: '2026-07-15', timeslotId: null,
    });
    // With empty string → should be coerced to null
    await assertNoOpenDemandForCell(masterDb, {
      sharedWorkplaceId: 'wp-1', wardTenantId: 'tenant-1',
      date: '2026-07-15', timeslotId: '',
    });
    const calls = masterDb.execute.mock.calls;
    expect(calls[0][1][3]).toBeNull();
    expect(calls[1][1][3]).toBeNull();
  });
});

describe('markDemandFulfilledForCell', () => {
  let masterDb;

  beforeEach(() => {
    masterDb = {
      execute: vi.fn(),
    };
  });

  it('returns the demand id when a matching open demand is updated', async () => {
    masterDb.execute
      .mockResolvedValueOnce([{ affectedRows: 1 }, []]) // UPDATE
      .mockResolvedValueOnce([[{ id: 'demand-1' }], []]); // SELECT

    const result = await markDemandFulfilledForCell(masterDb, {
      sharedWorkplaceId: 'wp-1',
      wardTenantId: 'tenant-1',
      date: '2026-07-15',
      timeslotId: 'ts-1',
      shiftId: 'shift-1',
    });

    expect(result).toBe('demand-1');
    expect(masterDb.execute.mock.calls[0][0]).toContain('UPDATE pool_ward_demand');
    expect(masterDb.execute.mock.calls[0][0]).toContain('status = \'fulfilled\'');
    expect(masterDb.execute.mock.calls[0][1]).toContain('shift-1');
  });

  it('returns null when no open demand matches', async () => {
    masterDb.execute
      .mockResolvedValueOnce([{ affectedRows: 0 }, []]) // UPDATE
      .mockResolvedValueOnce([[], []]); // SELECT (no-op)

    const result = await markDemandFulfilledForCell(masterDb, {
      sharedWorkplaceId: 'wp-1',
      wardTenantId: 'tenant-1',
      date: '2026-07-15',
      timeslotId: null,
      shiftId: 'shift-1',
    });

    expect(result).toBeNull();
  });

  it('matches on ward_tenant_id = billing_tenant_id pattern', async () => {
    masterDb.execute
      .mockResolvedValueOnce([{ affectedRows: 1 }, []]) // UPDATE
      .mockResolvedValueOnce([[{ id: 'demand-2' }], []]); // SELECT

    const result = await markDemandFulfilledForCell(masterDb, {
      sharedWorkplaceId: 'wp-2',
      wardTenantId: 'tenant-gyn1',  // ← this is the billing_tenant_id from the shift
      date: '2026-07-20',
      timeslotId: null,
      shiftId: 'shift-42',
    });

    expect(result).toBe('demand-2');
    // Verify the WHERE clause includes ward_tenant_id = ?
    const updateCall = masterDb.execute.mock.calls[0];
    expect(updateCall[1]).toContain('shift-42');
    expect(updateCall[1]).toContain('tenant-gyn1');
  });
});

describe('reopenDemandOnShiftDelete', () => {
  let masterDb;

  beforeEach(() => {
    masterDb = {
      execute: vi.fn(),
    };
  });

  it('reopens demands fulfilled by the deleted shift', async () => {
    masterDb.execute.mockResolvedValue([{ affectedRows: 2 }, []]);

    const count = await reopenDemandOnShiftDelete(masterDb, 'shift-1');
    expect(count).toBe(2);
    expect(masterDb.execute.mock.calls[0][0]).toContain('UPDATE pool_ward_demand');
    expect(masterDb.execute.mock.calls[0][0]).toContain("status = 'open'");
    expect(masterDb.execute.mock.calls[0][0]).toContain('fulfilled_by_shift_id = ?');
    expect(masterDb.execute.mock.calls[0][1]).toEqual(['shift-1']);
  });

  it('returns 0 when no demands were fulfilled by that shift', async () => {
    masterDb.execute.mockResolvedValue([{ affectedRows: 0 }, []]);

    const count = await reopenDemandOnShiftDelete(masterDb, 'shift-nonexistent');
    expect(count).toBe(0);
  });
});

describe('whitelist security', () => {
  it('rejects columns not in the whitelist', () => {
    // Simulating the pattern used in groups.js: only whitelisted keys are used
    const body = {
      shared_workplace_id: 'wp-1',
      ward_tenant_id: 'tenant-1',
      date: '2026-07-15',
      status: 'open',
      malicious_sql: "'; DROP TABLE pool_ward_demand; --",
    };

    const row = {};
    for (const key of POOL_WARD_DEMAND_WRITABLE_COLUMNS) {
      if (body[key] !== undefined) row[key] = body[key];
    }

    expect(row.shared_workplace_id).toBe('wp-1');
    expect(row.ward_tenant_id).toBe('tenant-1');
    expect(row.date).toBe('2026-07-15');
    expect(row.status).toBe('open');
    expect(row.malicious_sql).toBeUndefined();
  });
});
