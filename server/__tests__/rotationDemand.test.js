import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  ROTATION_DEMAND_WRITABLE_COLUMNS,
  assertNoOpenDemandForCell,
  markDemandFulfilledForCell,
  reopenDemandOnAssignmentDelete,
} from '../../server/utils/rotationDemand.js';

// Mock master DB pool — each test configures the returned rows/affectedRows.
function makeMockDb({ selectRows = [], affectedRows = 0, updateRows = [] } = {}) {
  const calls = [];
  const db = {
    async execute(sql, params = []) {
      calls.push({ sql, params });
      if (sql.trim().toUpperCase().startsWith('SELECT')) {
        // Return different rows based on call index for SELECT queries
        const idx = calls.filter((c) => c.sql.trim().toUpperCase().startsWith('SELECT')).length - 1;
        const rows = Array.isArray(selectRows[idx]) ? selectRows[idx] : selectRows;
        return [rows];
      }
      if (sql.trim().toUpperCase().startsWith('UPDATE')) {
        return [{ affectedRows }];
      }
      return [{ affectedRows: 0 }];
    },
  };
  db._calls = calls;
  return db;
}

describe('ROTATION_DEMAND_WRITABLE_COLUMNS', () => {
  it('contains the expected writable columns', () => {
    expect(ROTATION_DEMAND_WRITABLE_COLUMNS.has('rotation_workplace_id')).toBe(true);
    expect(ROTATION_DEMAND_WRITABLE_COLUMNS.has('group_id')).toBe(true);
    expect(ROTATION_DEMAND_WRITABLE_COLUMNS.has('ward_tenant_id')).toBe(true);
    expect(ROTATION_DEMAND_WRITABLE_COLUMNS.has('date')).toBe(true);
    expect(ROTATION_DEMAND_WRITABLE_COLUMNS.has('timeslot_id')).toBe(true);
    expect(ROTATION_DEMAND_WRITABLE_COLUMNS.has('note')).toBe(true);
    expect(ROTATION_DEMAND_WRITABLE_COLUMNS.has('status')).toBe(true);
    expect(ROTATION_DEMAND_WRITABLE_COLUMNS.has('fulfilled_by_assignment_id')).toBe(true);
    expect(ROTATION_DEMAND_WRITABLE_COLUMNS.has('created_by')).toBe(true);
  });

  it('rejects columns not in the whitelist (security boundary)', () => {
    expect(ROTATION_DEMAND_WRITABLE_COLUMNS.has('id')).toBe(false);
    expect(ROTATION_DEMAND_WRITABLE_COLUMNS.has('created_at')).toBe(false);
    expect(ROTATION_DEMAND_WRITABLE_COLUMNS.has('updated_at')).toBe(false);
    expect(ROTATION_DEMAND_WRITABLE_COLUMNS.has('random_injected_column')).toBe(false);
  });
});

describe('assertNoOpenDemandForCell', () => {
  it('resolves when no open demand exists', async () => {
    const db = makeMockDb({ selectRows: [[]] });
    await expect(
      assertNoOpenDemandForCell(db, {
        rotationWorkplaceId: 'wp-1',
        date: '2026-07-01',
        timeslotId: null,
      })
    ).resolves.toBeUndefined();
  });

  it('rejects with 409 when an open demand exists', async () => {
    const db = makeMockDb({ selectRows: [[{ id: 'demand-1' }]] });
    await expect(
      assertNoOpenDemandForCell(db, {
        rotationWorkplaceId: 'wp-1',
        date: '2026-07-01',
        timeslotId: 'ts-1',
      })
    ).rejects.toMatchObject({ status: 409, existingId: 'demand-1' });
  });

  it('treats empty string timeslotId the same as null', async () => {
    const db = makeMockDb({ selectRows: [[]] });
    await expect(
      assertNoOpenDemandForCell(db, {
        rotationWorkplaceId: 'wp-1',
        date: '2026-07-01',
        timeslotId: '',
      })
    ).resolves.toBeUndefined();
    // Verify the SQL received null, not empty string
    const call = db._calls[0];
    expect(call.params).toContain(null);
  });
});

describe('markDemandFulfilledForCell', () => {
  it('returns the demand id when a matching open demand is updated', async () => {
    // First call: UPDATE → affectedRows=1. Second call: SELECT → returns id.
    const db = makeMockDb({ affectedRows: 1, selectRows: [[{ id: 'demand-42' }]] });
    const result = await markDemandFulfilledForCell(db, {
      rotationWorkplaceId: 'wp-1',
      date: '2026-07-01',
      timeslotId: 'ts-1',
      assignmentId: 'assign-1',
    });
    expect(result).toBe('demand-42');
  });

  it('returns null when no open demand matches', async () => {
    const db = makeMockDb({ affectedRows: 0, selectRows: [[]] });
    const result = await markDemandFulfilledForCell(db, {
      rotationWorkplaceId: 'wp-1',
      date: '2026-07-01',
      timeslotId: null,
      assignmentId: 'assign-1',
    });
    expect(result).toBeNull();
  });
});

describe('reopenDemandOnAssignmentDelete', () => {
  it('reopens demands fulfilled by the deleted assignment', async () => {
    const db = makeMockDb({ affectedRows: 2 });
    const count = await reopenDemandOnAssignmentDelete(db, 'assign-1');
    expect(count).toBe(2);
  });

  it('returns 0 when no demands were fulfilled by that assignment', async () => {
    const db = makeMockDb({ affectedRows: 0 });
    const count = await reopenDemandOnAssignmentDelete(db, 'assign-nonexistent');
    expect(count).toBe(0);
  });
});

describe('rotationDemand SQL injection prevention', () => {
  it('uses parameterized queries (no string interpolation of user input)', () => {
    const db = makeMockDb({ selectRows: [[]] });
    assertNoOpenDemandForCell(db, {
      rotationWorkplaceId: "wp-1'; DROP TABLE rotation_demand; --",
      date: '2026-07-01',
      timeslotId: null,
    });
    // The malicious string must be a parameter, not interpolated into SQL
    const call = db._calls[0];
    expect(call.params).toContain("wp-1'; DROP TABLE rotation_demand; --");
    expect(call.sql).not.toContain("DROP TABLE");
  });
});
