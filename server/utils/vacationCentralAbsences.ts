/**
 * Pure (no-Express) helper for the tenant-side vacation endpoint.
 *
 * Lives in `utils/` (not `routes/`) so it can be imported by tests
 * without pulling in `auth.js` → `index.js` → mysql2 connection init.
 * The route in `routes/vacation.js` is a thin wrapper around this
 * helper; vitest targets this file directly.
 */

import type { Pool, RowDataPacket } from 'mysql2/promise';
import { ensureCentralAbsenceTables, isCentralAbsencePosition } from './centralAbsences.js';

export const VACATION_ABSENCE_POSITIONS = [
  'Urlaub', 'Schichturlaub', 'Krank', 'Frei', 'Dienstreise', 'Nicht verfügbar',
  'Fortbildung', 'Kongress', 'Elternzeit', 'Mutterschutz',
];

const VACATION_ABSENCE_POSITIONS_SET = new Set(VACATION_ABSENCE_POSITIONS);

export { VACATION_ABSENCE_POSITIONS_SET };

interface AssignmentRow extends RowDataPacket {
  employee_id: string;
}

interface EmployeeRow extends RowDataPacket {
  vacation_days_annual: number | string | null;
}

interface CentralAbsenceRow extends RowDataPacket {
  id: string;
  date: Date | string;
  position: string;
  note: string | null;
}

interface PendingRequestRow extends RowDataPacket {
  id: string;
  date: Date | string;
  position: string;
  note: string | null;
}

interface AbsenceRecord {
  id: string;
  date: string;
  position: string;
  note: string | null;
  source: 'central' | 'request_pending';
}

interface FetchCentralAbsencesResult {
  employee_id: string | null;
  absences: AbsenceRecord[];
  vacation_days_annual?: number | null;
}

interface FetchDeps {
  db: Pool;
  tenantId: string | null | undefined;
  doctorId: string;
  year: number;
}

function toDateString(value: Date | string): string {
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
}

/**
 * Resolves the central `employee_id` for a tenant doctor and returns the
 * central absence rows for the given year. Empty list (not 404) when
 * the doctor has no central link, so the frontend can render uniformly.
 */
export async function fetchCentralAbsencesForDoctor({ db: masterDb, tenantId, doctorId, year }: FetchDeps): Promise<FetchCentralAbsencesResult> {
  if (!tenantId) {
    return { employee_id: null, absences: [] };
  }

  // 1) Resolve central employee_id from the tenant assignment table.
  //    This is the ONLY source of truth we trust for the link — we
  //    intentionally do NOT fall back to Doctor.central_employee_id,
  //    because the master-frontend path is the only place that column
  //    is authoritative, and a stale value there would leak data.
  const [assignmentRows] = await masterDb.execute<AssignmentRow[]>(
    `SELECT employee_id
       FROM EmployeeTenantAssignment
      WHERE tenant_id = ?
        AND tenant_doctor_id = ?
      LIMIT 1`,
    [tenantId, String(doctorId)]
  );

  if (assignmentRows.length === 0) {
    return { employee_id: null, absences: [], vacation_days_annual: null };
  }
  const employeeId = String(assignmentRows[0].employee_id);

  // 2) Fetch the central employee's vacation entitlement.
  let vacationDaysAnnual: number | null = null;
  try {
    const [empRows] = await masterDb.execute<EmployeeRow[]>(
      `SELECT vacation_days_annual FROM Employee WHERE id = ? LIMIT 1`,
      [employeeId]
    );
    if (empRows.length > 0) {
      vacationDaysAnnual = Number(empRows[0].vacation_days_annual);
    }
  } catch {
    // Graceful: if the Employee table or column doesn't exist yet,
    // we just don't provide the value; the frontend falls back.
    vacationDaysAnnual = null;
  }

  // 3) Ensure the central table exists, then read the rows.
  await ensureCentralAbsenceTables(masterDb);

  const placeholders = VACATION_ABSENCE_POSITIONS.map(() => '?').join(',');
  const [rows] = await masterDb.execute<CentralAbsenceRow[]>(
    `SELECT id, date, position, note
       FROM CentralAbsenceEntry
      WHERE employee_id = ?
        AND YEAR(date) = ?
        AND position IN (${placeholders})
      ORDER BY date ASC`,
    [employeeId, year, ...VACATION_ABSENCE_POSITIONS]
  );

  const absences: AbsenceRecord[] = rows
    // Defensive: even if the DB contains a non-tracked position string
    // (legacy data, manual edits), filter it out instead of leaking it.
    .filter((row) => isCentralAbsencePosition(row.position))
    .map((row) => {
      // Date comes back from mysql2 as a JS Date in local TZ; we want
      // the canonical YYYY-MM-DD string the rest of the app uses.
      const dateStr = toDateString(row.date);
      return {
        id: String(row.id),
        date: dateStr,
        position: row.position,
        note: row.note ?? null,
        source: 'central' as const,
      };
    });

  // 4) Include pending AbsenceRequest rows for this employee (same tenant).
  //    These are requests submitted by Read-Only-Users that have NOT yet been
  //    approved — they are NOT counted as real absences in the vacation balance
  //    but SHOULD be visually displayed as pending overlays in the UI.
  try {
    const [pendingRows] = await masterDb.execute<PendingRequestRow[]>(
      `SELECT id, date, position, reason AS note
         FROM AbsenceRequest
        WHERE employee_id = ?
          AND YEAR(date) = ?
          AND source_tenant_id = ?
          AND status = 'pending'
        ORDER BY date ASC`,
      [employeeId, year, tenantId]
    );

    for (const row of pendingRows) {
      const dateStr = toDateString(row.date);
      absences.push({
        id: `req_${row.id}`,
        date: dateStr,
        position: row.position,
        note: row.note ? `Antrag: ${row.note}` : 'Antrag ausstehend',
        source: 'request_pending' as const,
      });
    }
  } catch (err) {
    // Graceful: if the AbsenceRequest table doesn't exist yet (no migration
    // has run), we just skip pending overlay — no error thrown to tenant.
    const code = typeof err === 'object' && err !== null && 'code' in err
      ? String((err as { code?: unknown }).code)
      : '';
    if (code !== 'ER_NO_SUCH_TABLE') {
      const message = err instanceof Error ? err.message : String(err);
      console.warn('[vacationCentralAbsences] Failed to fetch pending requests:', message);
    }
  }

  return { employee_id: employeeId, absences, vacation_days_annual: vacationDaysAnnual };
}
