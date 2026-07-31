/**
 * Tisoware Nightly Import Cron
 *
 * Runs the Tisoware absence import for all active employees every night
 * at 01:30 (server local time) with automatic conflict resolution enabled.
 *
 * Can be disabled via env var TISOWARE_AUTO_IMPORT=false (Coolify).
 * Default is "true" (enabled).
 */

import type { Pool, RowDataPacket } from 'mysql2/promise';
import { executeTisowareImport } from './tisowareImport.js';

const CRON_HOUR = 1;
const CRON_MINUTE = 30;
const CRON_LABEL = '[Tisoware Cron]';

interface TisowareImportResult {
  imported: number;
  skipped_existing: number;
  resolved_conflicts: number;
  unresolved_conflicts: number;
  errors_count?: number;
}

interface EmployeePayrollRow extends RowDataPacket {
  payroll_id: string;
}

type CronRunResult =
  | { skipped: true; reason: string }
  | {
      skipped: false;
      imported: number;
      skipped_existing: number;
      resolved_conflicts: number;
      unresolved_conflicts: number;
      errors_count: number;
      elapsed_seconds: number;
    };

interface CronHandle {
  stop(): void;
}

/**
 * Calculate milliseconds until the next occurrence of HH:MM (local time).
 */
export function msUntilNextRun(hour: number, minute: number, now = new Date()): number {
  const next = new Date(now);
  next.setHours(hour, minute, 0, 0);
  if (next <= now) {
    next.setDate(next.getDate() + 1);
  }
  return next.getTime() - now.getTime();
}

/**
 * Check whether the auto-import is enabled via env var TISOWARE_AUTO_IMPORT.
 * Defaults to enabled ("true") if the env var is not set.
 */
export function isAutoImportEnabled(): boolean {
  const value = (process.env.TISOWARE_AUTO_IMPORT ?? 'true').trim().toLowerCase();
  return value !== 'false' && value !== '0';
}

/**
 * Execute the nightly Tisoware import for all active employees.
 *
 * @param dbPool - MasterDB pool
 * @returns Import result summary
 */
export async function runNightlyTisowareImport(dbPool: Pool): Promise<CronRunResult> {
  const startTime = Date.now();
  console.log(`${CRON_LABEL} Starting nightly import (all active, resolveConflicts=true)`);

  // 1. Gather all active employees with a payroll_id
  const [activeEmployees] = await dbPool.execute<EmployeePayrollRow[]>(
    `SELECT payroll_id FROM Employee WHERE is_active = 1 AND payroll_id IS NOT NULL AND payroll_id != ''`
  );
  const allPayrollIds = [...new Set(
    activeEmployees.map((e) => String(e.payroll_id).trim()).filter(Boolean)
  )];

  if (allPayrollIds.length === 0) {
    console.log(`${CRON_LABEL} No active employees with payroll_id found — skipping`);
    return { skipped: true, reason: 'no_active_employees' };
  }

  console.log(`${CRON_LABEL} Found ${allPayrollIds.length} active employee(s) with payroll_id`);

  // 2. Execute import with conflict resolution
  const result = await executeTisowareImport(dbPool, allPayrollIds, {
    resolveConflicts: true,
    createdBy: 'system:tisoware-cron',
  }) as unknown as TisowareImportResult;

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(
    `${CRON_LABEL} Completed in ${elapsed}s — ` +
    `imported: ${result.imported}, skipped: ${result.skipped_existing}, ` +
    `resolved: ${result.resolved_conflicts}, unresolved: ${result.unresolved_conflicts}, ` +
    `errors: ${result.errors_count || 0}`
  );

  return {
    skipped: false,
    ...result,
    errors_count: result.errors_count || 0,
    elapsed_seconds: Number(elapsed),
  };
}

/**
 * Start the nightly Tisoware import cron scheduler.
 * Uses recursive setTimeout to fire at exactly 01:30 local time each day.
 *
 * @param dbPool - MasterDB pool
 * @returns Handle to stop the scheduler
 */
export function startTisowareCron(dbPool: Pool): CronHandle {
  if (!isAutoImportEnabled()) {
    console.log(`${CRON_LABEL} Disabled via TISOWARE_AUTO_IMPORT env — scheduler not started`);
    return { stop() {} };
  }

  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  const scheduleNext = () => {
    if (stopped) return;
    const delay = msUntilNextRun(CRON_HOUR, CRON_MINUTE);
    const nextRun = new Date(Date.now() + delay);
    console.log(`${CRON_LABEL} Next run scheduled at ${nextRun.toLocaleString('de-DE')}`);

    timer = setTimeout(async () => {
      if (stopped) return;
      try {
        if (!isAutoImportEnabled()) {
          console.log(`${CRON_LABEL} Auto-import disabled via TISOWARE_AUTO_IMPORT env — skipping`);
        } else {
          await runNightlyTisowareImport(dbPool);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`${CRON_LABEL} Nightly import failed:`, message);
      } finally {
        scheduleNext();
      }
    }, delay);

    // Allow the process to exit even if the timer is pending
    if (timer && typeof timer.unref === 'function') {
      timer.unref();
    }
  };

  scheduleNext();

  return {
    stop() {
      stopped = true;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      console.log(`${CRON_LABEL} Scheduler stopped`);
    },
  };
}
