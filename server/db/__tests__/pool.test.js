import { describe, expect, it, vi, beforeEach } from 'vitest';

// Set required env vars before any imports that load config
process.env.JWT_SECRET = 'test-pool-secret-32bytes-padding!!';
process.env.MYSQL_HOST = 'localhost';
process.env.MYSQL_USER = 'test';
process.env.MYSQL_PASSWORD = 'test';
process.env.MYSQL_DATABASE = 'testdb';

vi.mock('mysql2/promise', () => ({
  createPool: vi.fn(() => ({
    execute: vi.fn().mockResolvedValue([[], []]),
    query: vi.fn().mockResolvedValue([[], []]),
    end: vi.fn(),
  })),
}));

vi.mock('../../utils/tenantAccess.js', () => ({
  authorizeTenantToken: vi
    .fn()
    .mockResolvedValue({ allowed: true, tokenRecord: { id: 't1' }, access: {} }),
}));

import { createPool } from 'mysql2/promise';
import { db, isTransientDbError, isDatabaseError, getTenantDb, removeTenantPool } from '../pool.js';
import { encryptToken } from '../../utils/crypto.js';

describe('isTransientDbError', () => {
  it('recognizes standard transient error codes', () => {
    expect(isTransientDbError({ code: 'PROTOCOL_CONNECTION_LOST', message: '' })).toBe(true);
    expect(isTransientDbError({ code: 'ECONNREFUSED', message: '' })).toBe(true);
    expect(isTransientDbError({ code: 'ER_LOCK_DEADLOCK', message: '' })).toBe(true);
  });

  it('recognizes transient error messages without error codes', () => {
    expect(isTransientDbError({ message: 'server has gone away' })).toBe(true);
    expect(isTransientDbError({ message: 'Lost connection to MySQL server' })).toBe(true);
  });

  it('returns false for non-transient errors', () => {
    expect(isTransientDbError({ code: 'ER_NO_SUCH_TABLE', message: '' })).toBe(false);
    expect(isTransientDbError(null)).toBe(false);
    expect(isTransientDbError(undefined)).toBe(false);
  });
});

describe('isDatabaseError', () => {
  it('detects errors explicitly annotated as database errors', () => {
    expect(isDatabaseError({ isDatabaseError: true, message: '' })).toBe(true);
  });

  it('detects MySQL error codes (ER_ prefix)', () => {
    expect(isDatabaseError({ code: 'ER_ACCESS_DENIED_ERROR', message: '' })).toBe(true);
  });

  it('detects sql-related properties', () => {
    expect(isDatabaseError({ message: 'error', sql: 'SELECT 1', sqlMessage: 'fail' })).toBe(true);
  });

  it('returns false for generic application errors', () => {
    expect(isDatabaseError(new Error('Something went wrong'))).toBe(false);
    expect(isDatabaseError(null)).toBe(false);
  });
});

describe('getTenantDb / removeTenantPool', () => {
  beforeEach(() => {
    createPool.mockClear();
  });

  it('returns the master db pool when no token is provided', () => {
    const result = getTenantDb(null);
    expect(result).toBe(db);
  });

  it('creates a new pool for a valid encrypted tenant token', () => {
    const config = {
      host: 'tenant-db.example.com',
      user: 'app',
      password: 'pass',
      database: 'tenantdb',
    };
    const token = encryptToken(JSON.stringify(config));

    const pool = getTenantDb(token);
    expect(createPool).toHaveBeenCalledWith(
      expect.objectContaining({ host: 'tenant-db.example.com', database: 'tenantdb' }),
    );
    expect(pool).toBeDefined();

    const pool2 = getTenantDb(token);
    expect(createPool).toHaveBeenCalledTimes(1);
    expect(pool2).toBe(pool);

    removeTenantPool(token);
  });

  it('removes a tenant pool and evicts it from the cache', () => {
    const config = { host: 'evict.example.com', user: 'a', password: 'b', database: 'c' };
    const token = encryptToken(JSON.stringify(config));

    // Create the pool
    getTenantDb(token);
    const callsBefore = createPool.mock.calls.length;

    // Remove it from the cache
    removeTenantPool(token);

    // Next call must create a fresh pool
    getTenantDb(token);
    expect(createPool.mock.calls.length).toBeGreaterThan(callsBefore);

    removeTenantPool(token);
  });

  it('falls back to master db for an invalid token', () => {
    const result = getTenantDb('not-a-valid-token');
    expect(result).toBe(db);
  });
});
