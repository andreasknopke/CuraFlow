import { describe, expect, it, vi, beforeEach } from 'vitest';
import { writeAuditLog } from '../audit.js';

const makePool = (executeImpl) => ({ execute: vi.fn(executeImpl) });

describe('writeAuditLog', () => {
  it('inserts a SystemLog record with the correct structure', async () => {
    let insertedArgs;
    const pool = makePool(async (sql, args) => {
      if (sql.includes('CREATE TABLE')) return [{}];
      insertedArgs = args;
      return [{}];
    });

    await writeAuditLog(pool, {
      level: 'audit',
      source: 'AdminRouter',
      message: 'POST /api/admin/users by alice@example.com',
      details: { method: 'POST', path: '/api/admin/users', statusCode: 200 },
      userEmail: 'alice@example.com',
    });

    // execute called at least twice (CREATE TABLE + INSERT)
    expect(pool.execute).toHaveBeenCalledTimes(2);

    // Validate INSERT payload (positional params)
    const [id, level, source, message, details, createdDate, updatedDate, createdBy] = insertedArgs;
    expect(id).toMatch(/^[0-9a-f-]{36}$/i); // UUID
    expect(level).toBe('audit');
    expect(source).toBe('AdminRouter');
    expect(message).toContain('alice@example.com');
    expect(typeof details).toBe('string'); // serialized JSON
    const parsedDetails = JSON.parse(details);
    expect(parsedDetails.statusCode).toBe(200);
    expect(createdDate).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    expect(updatedDate).toBe(createdDate);
    expect(createdBy).toBe('alice@example.com');
  });

  it('falls back to "system" as created_by when no userEmail is provided', async () => {
    let insertedCreatedBy;
    const pool = makePool(async (sql, args) => {
      if (sql.includes('CREATE TABLE')) return [{}];
      insertedCreatedBy = args[7];
      return [{}];
    });

    await writeAuditLog(pool, { level: 'info', source: 'Cron', message: 'scheduled task' });
    expect(insertedCreatedBy).toBe('system');
  });

  it('accepts a pre-serialized string for details', async () => {
    let insertedDetails;
    const pool = makePool(async (sql, args) => {
      if (sql.includes('CREATE TABLE')) return [{}];
      insertedDetails = args[4];
      return [{}];
    });

    await writeAuditLog(pool, {
      level: 'audit',
      source: 'Test',
      message: 'test',
      details: 'already a string',
      userEmail: 'u@x.com',
    });
    expect(insertedDetails).toBe('already a string');
  });

  it('skips CREATE TABLE on repeated calls to the same pool (WeakSet caching)', async () => {
    let createCount = 0;
    const pool = makePool(async (sql) => {
      if (sql.includes('CREATE TABLE')) createCount++;
      return [{}];
    });

    await writeAuditLog(pool, { level: 'audit', source: 'A', message: 'first' });
    await writeAuditLog(pool, { level: 'audit', source: 'B', message: 'second' });
    expect(createCount).toBe(1);
  });

  it('does not throw when the DB execute fails (silent error handling)', async () => {
    const pool = makePool(async () => {
      throw new Error('DB is down');
    });
    await expect(
      writeAuditLog(pool, { level: 'audit', source: 'T', message: 'fail gracefully' }),
    ).resolves.toBeUndefined();
  });
});
