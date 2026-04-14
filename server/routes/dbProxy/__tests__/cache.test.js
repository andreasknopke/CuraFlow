import { describe, expect, it, beforeEach } from 'vitest';
import { COLUMNS_CACHE, clearColumnsCache, getValidColumns } from '../cache.js';

describe('clearColumnsCache', () => {
  beforeEach(() => {
    // Reset cache state between tests
    for (const key in COLUMNS_CACHE) {
      delete COLUMNS_CACHE[key];
    }
  });

  it('clears all entries when called with no arguments', () => {
    COLUMNS_CACHE['conn1:Doctor'] = ['id', 'name'];
    COLUMNS_CACHE['conn1:Nurse'] = ['id'];
    clearColumnsCache();
    expect(Object.keys(COLUMNS_CACHE)).toHaveLength(0);
  });

  it('clears only matching table names', () => {
    COLUMNS_CACHE['conn1:Doctor'] = ['id'];
    COLUMNS_CACHE['conn1:Nurse'] = ['id'];
    COLUMNS_CACHE['conn2:Doctor'] = ['id'];
    clearColumnsCache(['Doctor']);
    expect(COLUMNS_CACHE['conn1:Doctor']).toBeUndefined();
    expect(COLUMNS_CACHE['conn2:Doctor']).toBeUndefined();
    expect(COLUMNS_CACHE['conn1:Nurse']).toBeDefined();
  });

  it('clears matching table+cacheKey combination only', () => {
    COLUMNS_CACHE['conn1:Doctor'] = ['id'];
    COLUMNS_CACHE['conn2:Doctor'] = ['id'];
    clearColumnsCache(['Doctor'], 'conn1');
    expect(COLUMNS_CACHE['conn1:Doctor']).toBeUndefined();
    expect(COLUMNS_CACHE['conn2:Doctor']).toBeDefined();
  });

  it('leaves unrelated entries untouched when table list does not match', () => {
    COLUMNS_CACHE['conn1:Doctor'] = ['id'];
    clearColumnsCache(['Workplace']);
    expect(COLUMNS_CACHE['conn1:Doctor']).toBeDefined();
  });
});

describe('getValidColumns', () => {
  beforeEach(() => {
    for (const key in COLUMNS_CACHE) {
      delete COLUMNS_CACHE[key];
    }
  });

  it('fetches columns from DB and caches the result', async () => {
    const mockPool = {
      execute: async () => [[{ Field: 'id' }, { Field: 'name' }]],
    };

    const result = await getValidColumns(mockPool, 'Doctor', 'conn1');
    expect(result).toEqual(['id', 'name']);
    expect(COLUMNS_CACHE['conn1:Doctor']).toEqual(['id', 'name']);
  });

  it('returns cached value without hitting DB on second call', async () => {
    let executeCount = 0;
    const mockPool = {
      execute: async () => {
        executeCount++;
        return [[{ Field: 'id' }]];
      },
    };

    await getValidColumns(mockPool, 'Doctor', 'conn1');
    await getValidColumns(mockPool, 'Doctor', 'conn1');
    expect(executeCount).toBe(1);
  });

  it('returns empty array when table does not exist', async () => {
    const mockPool = {
      execute: async () => {
        const err = new Error("Table 'app.Ghost' doesn't exist");
        err.code = 'ER_NO_SUCH_TABLE';
        throw err;
      },
    };

    const result = await getValidColumns(mockPool, 'Ghost', 'conn1');
    expect(result).toEqual([]);
  });

  it("returns null on unexpected DB errors (non-'doesn't exist')", async () => {
    const mockPool = {
      execute: async () => {
        throw new Error('connection refused');
      },
    };

    const result = await getValidColumns(mockPool, 'Doctor', 'conn1');
    expect(result).toBeNull();
  });
});
