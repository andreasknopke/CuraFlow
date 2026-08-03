import { describe, expect, it, vi } from 'vitest';

// Mock the master pool and tenant helpers before importing the route module —
// importing dbProxy.ts pulls in server/index.ts, which resolves MySQL config
// at module load time and throws without env vars.
vi.mock('../index.js', () => ({
  db: {},
  getTenantDb: () => ({}),
  removeTenantPool: () => {},
}));

import { resolveShiftEntryPositionsForGuard } from '../routes/dbProxy.js';

/**
 * Build a mock mysql2/promise pool whose execute() returns the configured rows.
 */
function mockPool(rows) {
  return {
    execute: async () => [rows, []],
  };
}

function mockPoolThatThrows() {
  return {
    execute: async () => {
      throw new Error('DB unavailable');
    },
  };
}

describe('resolveShiftEntryPositionsForGuard — ShiftEntry permission guard (F5)', () => {
  it('create: returns the position from the payload', async () => {
    const positions = await resolveShiftEntryPositionsForGuard(mockPool([]), {
      action: 'create',
      entity: 'ShiftEntry',
      data: { position: 'CT-Dienst' },
    });
    expect(positions).toEqual(['CT-Dienst']);
  });

  it('create without position: returns empty (no DB lookup)', async () => {
    const positions = await resolveShiftEntryPositionsForGuard(mockPool([]), {
      action: 'create',
      entity: 'ShiftEntry',
      data: { doctor_id: 'd-1' },
    });
    expect(positions).toEqual([]);
  });

  it('update with position: returns payload position and does not lookup record', async () => {
    let lookupCalled = false;
    const pool = {
      execute: async (sql) => {
        if (String(sql).includes('SELECT position FROM ShiftEntry')) {
          lookupCalled = true;
        }
        return [[], []];
      },
    };
    const positions = await resolveShiftEntryPositionsForGuard(pool, {
      action: 'update',
      entity: 'ShiftEntry',
      id: 'shift-1',
      data: { position: 'MRI-Dienst' },
    });
    expect(positions).toEqual(['MRI-Dienst']);
    expect(lookupCalled).toBe(false);
  });

  it('update without position: looks up the existing record and returns its position (F5 fix)', async () => {
    const positions = await resolveShiftEntryPositionsForGuard(
      mockPool([{ position: 'CT-Dienst' }]),
      {
        action: 'update',
        entity: 'ShiftEntry',
        id: 'shift-1',
        data: { order: 2 },
      },
    );
    expect(positions).toEqual(['CT-Dienst']);
  });

  it('update without position and no existing record: returns empty', async () => {
    const positions = await resolveShiftEntryPositionsForGuard(mockPool([]), {
      action: 'update',
      entity: 'ShiftEntry',
      id: 'shift-missing',
      data: { order: 2 },
    });
    expect(positions).toEqual([]);
  });

  it('delete: looks up the existing record and returns its position', async () => {
    const positions = await resolveShiftEntryPositionsForGuard(
      mockPool([{ position: 'CT-Dienst' }]),
      {
        action: 'delete',
        entity: 'ShiftEntry',
        id: 'shift-1',
      },
    );
    expect(positions).toEqual(['CT-Dienst']);
  });

  it('bulkCreate: returns all positions present in the payload', async () => {
    const positions = await resolveShiftEntryPositionsForGuard(mockPool([]), {
      action: 'bulkCreate',
      entity: 'ShiftEntry',
      data: [{ position: 'CT-Dienst' }, { position: 'MRI-Dienst' }],
    });
    expect(positions).toEqual(['CT-Dienst', 'MRI-Dienst']);
  });

  it('bulkCreate with missing positions: returns only present ones', async () => {
    const positions = await resolveShiftEntryPositionsForGuard(mockPool([]), {
      action: 'bulkCreate',
      entity: 'ShiftEntry',
      data: [{ position: 'CT-Dienst' }, { doctor_id: 'd-1' }],
    });
    expect(positions).toEqual(['CT-Dienst']);
  });

  it('non-ShiftEntry table: returns empty regardless of action', async () => {
    const positions = await resolveShiftEntryPositionsForGuard(mockPool([]), {
      action: 'update',
      entity: 'Doctor',
      id: 'doc-1',
      data: { position: 'CT-Dienst' },
    });
    expect(positions).toEqual([]);
  });

  it('update lookup failure: returns empty and does not throw', async () => {
    const positions = await resolveShiftEntryPositionsForGuard(mockPoolThatThrows(), {
      action: 'update',
      entity: 'ShiftEntry',
      id: 'shift-1',
      data: { order: 2 },
    });
    expect(positions).toEqual([]);
  });
});
