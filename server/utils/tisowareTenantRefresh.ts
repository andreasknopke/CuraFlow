/**
 * Tenant-scoped on-demand Tisoware absence refresh.
 *
 * The nightly cron (`tisowareCron.ts`) imports absences for ALL active
 * employees once per day at 01:30. This helper powers the tenant-side
 * on-demand variant:
 *
 *   - single doctor  → refresh only that employee (absence module open /
 *                      employee switch via dropdown)
 *   - all doctors    → refresh ALL of the tenant's linked employees
 *                      (yearly overview)
 *
 * The refresh is scoped strictly to the calling tenant: payroll_ids are
 * resolved via `EmployeeTenantAssignment` rows for the tenant, so a tenant
 * can never trigger an import for employees of another tenant.
 *
 * A small cooldown (default 60 s, env `TISOWARE_REFRESH_COOLDOWN_SECONDS`,
 * 0 disables) prevents the UI from hammering the Tisoware MSSQL server when
 * views are toggled or the module is re-opened repeatedly.
 */

import type { Pool, RowDataPacket } from 'mysql2/promise';
import { executeTisowareImport } from './tisowareImport.js';

const DEFAULT_COOLDOWN_SECONDS = 60;

export type TisowareRefreshResult =
  | {
      skipped: false;
      scope: 'single' | 'all';
      doctorId: string | null;
      employees: number;
      imported: number;
      skipped_existing: number;
      resolved_conflicts: number;
      unresolved_conflicts: number;
      errors_count: number;
    }
  | {
      skipped: true;
      reason: 'cooldown' | 'no_payroll_id' | 'no_linked_employees' | 'tisoware_unavailable';
      scope?: string;
      message?: string;
    };

interface RefreshDeps {
  /** MasterDB pool */
  db: Pool;
  /** Resolved tenant id (db_tokens.id), already validated by the route */
  tenantId: string;
  /** Tenant-local Doctor.id; `null`/omitted refreshes all tenant employees */
  doctorId?: string | null;
  /** Who triggered the refresh (user sub/email) for the import audit trail */
  createdBy?: string | null;
  /** Cooldown store (per server process). Passed in so tests stay isolated */
  store: Map<string, number>;
  /** Injectable clock for deterministic tests */
  now?: number;
}

/**
 * Cooldown in seconds between two on-demand refreshes of the same scope.
 * Read from `TISOWARE_REFRESH_COOLDOWN_SECONDS`; `0` disables the cooldown.
 * Invalid/missing values fall back to the default (60 s).
 */
export function getTisowareRefreshCooldownSeconds(): number {
  const raw = process.env.TISOWARE_REFRESH_COOLDOWN_SECONDS;
  if (raw === undefined || raw === null || String(raw).trim() === '') {
    return DEFAULT_COOLDOWN_SECONDS;
  }
  const parsed = Number(String(raw).trim());
  if (Number.isFinite(parsed) && parsed >= 0) {
    return Math.floor(parsed);
  }
  return DEFAULT_COOLDOWN_SECONDS;
}

/** Create an empty cooldown store. One store per route module instance. */
export function createTisowareRefreshStore(): Map<string, number> {
  return new Map();
}

function scopeKey(tenantId: string, doctorId: string | null): string {
  return doctorId ? `tenant:${tenantId}:doctor:${doctorId}` : `tenant:${tenantId}:all`;
}

/**
 * Refresh Tisoware absences for one tenant employee (or all tenant
 * employees when `doctorId` is omitted) into `CentralAbsenceEntry`.
 *
 * Returns `{ skipped: true }` instead of throwing when the employee has no
 * payroll link, the cooldown is active, or Tisoware is unreachable — the
 * nightly cron remains the safety net, so an on-demand refresh must never
 * fail the caller's request.
 */
export async function refreshTenantTisowareAbsences({
  db,
  tenantId,
  doctorId = null,
  createdBy = null,
  store,
  now = Date.now(),
}: RefreshDeps): Promise<TisowareRefreshResult> {
  const cooldownSeconds = getTisowareRefreshCooldownSeconds();
  const scope = scopeKey(tenantId, doctorId);

  if (cooldownSeconds > 0) {
    const last = store.get(scope);
    if (last !== undefined && now - last < cooldownSeconds * 1000) {
      return { skipped: true, reason: 'cooldown', scope };
    }
  }

  let payrollIds: string[];
  if (doctorId) {
    const [rows] = await db.execute(
      `SELECT e.payroll_id
         FROM EmployeeTenantAssignment eta
         JOIN Employee e ON e.id = eta.employee_id
        WHERE eta.tenant_id = ?
          AND eta.tenant_doctor_id = ?
        LIMIT 1`,
      [tenantId, String(doctorId)]
    ) as [RowDataPacket[], unknown];

    if (rows.length === 0 || !rows[0].payroll_id) {
      return { skipped: true, reason: 'no_payroll_id', scope };
    }
    payrollIds = [String(rows[0].payroll_id).trim()];
  } else {
    const [rows] = await db.execute(
      `SELECT DISTINCT e.payroll_id
         FROM EmployeeTenantAssignment eta
         JOIN Employee e ON e.id = eta.employee_id
        WHERE eta.tenant_id = ?
          AND e.payroll_id IS NOT NULL
          AND e.payroll_id != ''`,
      [tenantId]
    ) as [RowDataPacket[], unknown];

    payrollIds = rows
      .map((r: RowDataPacket) => String(r.payroll_id).trim())
      .filter(Boolean);

    if (payrollIds.length === 0) {
      return { skipped: true, reason: 'no_linked_employees', scope };
    }
  }

  store.set(scope, now);

  let result: Record<string, unknown>;
  try {
    result = await executeTisowareImport(db, payrollIds, {
      resolveConflicts: true,
      createdBy: createdBy ?? 'tenant:on-demand',
    });
  } catch (err) {
    // Tisoware is unreachable (network/proxy/credentials). Log for
    // diagnosis and tell the caller softly — never fail the request.
    console.warn(
      `[Tisoware refresh] tenant=${tenantId} scope=${scope} import failed:`,
      (err as Error).message
    );
    return {
      skipped: true,
      reason: 'tisoware_unavailable',
      scope,
      message: (err as Error).message,
    };
  }

  return {
    skipped: false,
    scope: doctorId ? 'single' : 'all',
    doctorId: doctorId ?? null,
    employees: payrollIds.length,
    imported: Number(result.imported ?? 0),
    skipped_existing: Number(result.skipped_existing ?? 0),
    resolved_conflicts: Number(result.resolved_conflicts ?? 0),
    unresolved_conflicts: Number(result.unresolved_conflicts ?? 0),
    errors_count: Number(result.errors_count ?? 0),
  };
}
