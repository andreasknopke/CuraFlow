import { describe, expect, it } from 'vitest';
import { runTenantMigrations, setUnavailableAbsenceBlocking } from '../utils/tenantMigrations.js';

describe('runTenantMigrations', () => {
  it('aborts immediately on fatal pool errors instead of continuing with a closed pool', async () => {
    const fatalError = new Error('Pool is closed.');
    const tenantPool = {
      execute: async () => {
        throw fatalError;
      },
    };

    await expect(runTenantMigrations(tenantPool, 'tenant-token')).rejects.toThrow('Pool is closed.');
  });
});

describe('setUnavailableAbsenceBlocking', () => {
  function mockPool({ settingValue, updateError }) {
    const calls = [];
    const pool = {
      calls,
      execute: async (sql, params) => {
        calls.push({ sql: String(sql), params });
        if (String(sql).startsWith('SELECT id')) {
          if (settingValue === undefined) return [[]];
          return [[{ id: 7, value: settingValue }]];
        }
        if (String(sql).startsWith('UPDATE SystemSetting')) {
          if (updateError) throw updateError;
          return [];
        }
        return [[]];
      },
    };
    return pool;
  }

  it('sets "Nicht verfügbar" to true in a stored setting (like Frei)', async () => {
    const pool = mockPool({ settingValue: '{"Urlaub":true,"Krank":true,"Frei":true,"Nicht verfügbar":false}' });

    const result = await setUnavailableAbsenceBlocking(pool);

    expect(result.updated).toBe(true);
    const updateCall = pool.calls.find((c) => c.sql.startsWith('UPDATE SystemSetting'));
    expect(updateCall).toBeTruthy();
    expect(updateCall.params[0]).toContain('"Nicht verfügbar":true');
    expect(updateCall.params[1]).toBe(7);
  });

  it('is idempotent — skips when "Nicht verfügbar" is already true', async () => {
    const pool = mockPool({ settingValue: '{"Urlaub":true,"Nicht verfügbar":true}' });

    const result = await setUnavailableAbsenceBlocking(pool);

    expect(result).toEqual({ updated: false, skipped: 'Already blocking' });
    expect(pool.calls.some((c) => c.sql.startsWith('UPDATE SystemSetting'))).toBe(false);
  });

  it('skips when no setting is stored (code default already blocks)', async () => {
    const pool = mockPool({ settingValue: undefined });

    const result = await setUnavailableAbsenceBlocking(pool);

    expect(result).toEqual({ updated: false, skipped: 'No stored setting' });
  });

  it('propagates fatal pool errors', async () => {
    const fatalError = new Error('Pool is closed.');
    const pool = {
      execute: async () => {
        throw fatalError;
      },
    };

    await expect(setUnavailableAbsenceBlocking(pool)).rejects.toThrow('Pool is closed.');
  });
});