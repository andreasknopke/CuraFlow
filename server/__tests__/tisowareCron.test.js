import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import { msUntilNextRun, isAutoImportEnabled, runNightlyTisowareImport } from '../utils/tisowareCron.js';

// Mock the tisowareImport module to avoid real DB/proxy calls
vi.mock('../utils/tisowareImport.js', () => ({
  executeTisowareImport: vi.fn(),
}));

import { executeTisowareImport } from '../utils/tisowareImport.js';

describe('msUntilNextRun', () => {
  it('returns ms until next 01:30 when current time is before 01:30', () => {
    // 2026-07-23 00:00:00 local
    const now = new Date(2026, 6, 23, 0, 0, 0, 0);
    const ms = msUntilNextRun(1, 30, now);
    // Should be 1.5 hours = 5400000 ms
    expect(ms).toBe(90 * 60 * 1000);
  });

  it('returns ms until tomorrow 01:30 when current time is after 01:30', () => {
    // 2026-07-23 02:00:00 local
    const now = new Date(2026, 6, 23, 2, 0, 0, 0);
    const ms = msUntilNextRun(1, 30, now);
    // Should be 23.5 hours = 84600000 ms
    expect(ms).toBe(23.5 * 60 * 60 * 1000);
  });

  it('returns ms until tomorrow when current time is exactly 01:30', () => {
    const now = new Date(2026, 6, 23, 1, 30, 0, 0);
    const ms = msUntilNextRun(1, 30, now);
    // Exactly at target → next day
    expect(ms).toBe(24 * 60 * 60 * 1000);
  });
});

describe('isAutoImportEnabled', () => {
  const originalEnv = process.env.TISOWARE_AUTO_IMPORT;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.TISOWARE_AUTO_IMPORT;
    } else {
      process.env.TISOWARE_AUTO_IMPORT = originalEnv;
    }
  });

  it('returns true when env var is not set (default)', () => {
    delete process.env.TISOWARE_AUTO_IMPORT;
    expect(isAutoImportEnabled()).toBe(true);
  });

  it('returns true when env var is "true"', () => {
    process.env.TISOWARE_AUTO_IMPORT = 'true';
    expect(isAutoImportEnabled()).toBe(true);
  });

  it('returns false when env var is "false"', () => {
    process.env.TISOWARE_AUTO_IMPORT = 'false';
    expect(isAutoImportEnabled()).toBe(false);
  });

  it('returns false when env var is "0"', () => {
    process.env.TISOWARE_AUTO_IMPORT = '0';
    expect(isAutoImportEnabled()).toBe(false);
  });

  it('is case-insensitive', () => {
    process.env.TISOWARE_AUTO_IMPORT = 'FALSE';
    expect(isAutoImportEnabled()).toBe(false);
  });
});

describe('runNightlyTisowareImport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('skips when no active employees have payroll_id', async () => {
    const mockPool = { execute: vi.fn().mockResolvedValue([[]]) };
    const result = await runNightlyTisowareImport(mockPool);
    expect(result).toEqual({ skipped: true, reason: 'no_active_employees' });
    expect(executeTisowareImport).not.toHaveBeenCalled();
  });

  it('calls executeTisowareImport with all active payroll_ids and resolveConflicts=true', async () => {
    const mockPool = {
      execute: vi.fn().mockResolvedValue([[
        { payroll_id: '1001' },
        { payroll_id: '1002' },
        { payroll_id: '1001' }, // duplicate
        { payroll_id: '' },     // empty
      ]]),
    };
    executeTisowareImport.mockResolvedValue({
      imported: 5,
      skipped_existing: 10,
      resolved_conflicts: 2,
      unresolved_conflicts: 0,
      errors_count: 0,
      errors: [],
    });

    const result = await runNightlyTisowareImport(mockPool);

    expect(executeTisowareImport).toHaveBeenCalledWith(
      mockPool,
      ['1001', '1002'],
      expect.objectContaining({
        resolveConflicts: true,
        createdBy: 'system:tisoware-cron',
      })
    );
    expect(result.skipped).toBe(false);
    expect(result.imported).toBe(5);
    expect(result.elapsed_seconds).toBeGreaterThanOrEqual(0);
  });
});
