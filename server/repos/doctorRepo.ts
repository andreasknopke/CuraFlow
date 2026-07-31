/**
 * Doctor repository (Phase 2, PR 2.4).
 *
 * Replaces the generic `/api/db` dispatch for the tenant `Doctor` table with a
 * dedicated module so the table name is a CONSTANT in code. Doctor is a tenant
 * table (in TENANT_BASE_TABLES) with a correct, actively-used generic path.
 *
 * Doctor-specific behavior preserved EXACTLY from the generic dispatch:
 *   - create/update: name + initials conflict detection (pre-check returns
 *     409 with a German error + `field`; the dispatch also keeps the
 *     ER_DUP_ENTRY fallback for races). `findDoctorConflicts` +
 *     `buildDoctorConflictResponse` are moved here verbatim from dbProxy.
 *   - create: auto-inject id/dates/created_by; filter keys; insert; broadcast.
 *   - update: set updated_date; filter keys (exclude id); update; read-back;
 *     broadcast. { success: true } if no valid keys.
 *   - delete: pre-fetch for audit; delete; write SystemLog; broadcast.
 *   - list/filter/get: pass through to shared helpers + fromSqlRow.
 *
 * Out of scope (different layer): the ~30 direct-SQL sites on Doctor in
 * staff.js / master.js / schedule.js / centralAbsences.js / groups.js — those
 * are `central_employee_id` link management (master-DB coordination) and read
 * projections, not tenant Doctor CRUD. `loadDoctorLink` stays in dbProxy (it
 * serves the ShiftEntry central-absence router).
 */

import crypto from 'crypto';
import type { Pool, RowDataPacket } from 'mysql2/promise';

import {
  insertRow,
  updateRow,
  deleteRow,
  selectRow,
  filterRows,
} from '../utils/queryHelpers.js';
import { fromSqlRow } from '../utils/sqlMarshal.js';

export const DOCTOR_TABLE = 'Doctor';

type SqlRow = Record<string, unknown>;

interface DoctorConflictRow extends RowDataPacket {
  id: string;
  name: string;
  initials: string;
}

interface DoctorConflict {
  status: number;
  payload: {
    error: string;
    field: string;
  };
}

// ─── Conflict detection (moved verbatim from dbProxy.js) ────────────────────

/**
 * Find Doctor rows conflicting on name or initials.
 */
export const findDoctorConflicts = async (
  dbPool: Pool,
  data: SqlRow,
  excludeId: string | null = null
): Promise<{ nameConflict: DoctorConflictRow | null; initialsConflict: DoctorConflictRow | null } | null> => {
  const name = typeof data?.name === 'string' ? data.name.trim() : '';
  const initials = typeof data?.initials === 'string' ? data.initials.trim() : '';

  if (!name && !initials) {
    return null;
  }

  const conditions: string[] = [];
  const params: string[] = [];

  if (name) {
    conditions.push('name = ?');
    params.push(name);
  }

  if (initials) {
    conditions.push('initials = ?');
    params.push(initials);
  }

  let sql = `SELECT id, name, initials FROM Doctor WHERE (${conditions.join(' OR ')})`;
  if (excludeId) {
    sql += ' AND id != ?';
    params.push(excludeId);
  }
  sql += ' LIMIT 20';

  const [rows] = await dbPool.execute<DoctorConflictRow[]>(sql, params);
  const nameConflict = name ? rows.find((row) => row.name === name) || null : null;
  const initialsConflict = initials ? rows.find((row) => row.initials === initials) || null : null;

  return {
    nameConflict,
    initialsConflict,
  };
};

/**
 * Build a 409 conflict response if name/initials collide, else null.
 */
export const buildDoctorConflictResponse = async (
  dbPool: Pool,
  data: SqlRow,
  excludeId: string | null = null
): Promise<DoctorConflict | null> => {
  const conflicts = await findDoctorConflicts(dbPool, data, excludeId);
  if (!conflicts) {
    return null;
  }

  if (conflicts.nameConflict) {
    return {
      status: 409,
      payload: {
        error: `Ein Mitarbeiter mit dem Namen "${String(data.name).trim()}" existiert bereits. Bitte wählen Sie einen anderen Namen.`,
        field: 'name'
      }
    };
  }

  if (conflicts.initialsConflict) {
    return {
      status: 409,
      payload: {
        error: `Das Kürzel "${String(data.initials).trim()}" wird bereits verwendet. Bitte wählen Sie ein anderes Kürzel.`,
        field: 'initials'
      }
    };
  }

  return null;
};

// ─── CRUD ───────────────────────────────────────────────────────────────────

interface CreateDoctorOptions {
  dbPool: Pool;
  data: SqlRow;
  validColumns: string[];
  actorEmail?: string;
}

/**
 * Create a Doctor row. Runs name/initials conflict detection as a pre-check
 * (throws a 409 conflict if found), then auto-injects
 * id/dates/created_by, filters to valid columns, inserts.
 */
export async function createDoctor({ dbPool, data, validColumns, actorEmail }: CreateDoctorOptions): Promise<SqlRow> {
  const conflict = await buildDoctorConflictResponse(dbPool, data);
  if (conflict) {
    const err = new Error(conflict.payload.error) as Error & { status: number; conflictPayload: DoctorConflict['payload'] };
    err.status = conflict.status;
    err.conflictPayload = conflict.payload;
    throw err;
  }

  if (!data.id) data.id = crypto.randomUUID();
  data.created_date = new Date();
  data.updated_date = new Date();
  data.created_by = actorEmail || 'system';

  let keys = Object.keys(data);
  if (validColumns && validColumns.length > 0) {
    keys = keys.filter((k) => validColumns.includes(k));
  }
  if (keys.length === 0) {
    const err = new Error(`No valid columns found for table ${DOCTOR_TABLE}`) as Error & { status: number };
    err.status = 500;
    throw err;
  }

  await insertRow(dbPool, DOCTOR_TABLE, keys, data);
  return data;
}

interface UpdateDoctorOptions {
  dbPool: Pool;
  id: string;
  data: SqlRow;
  validColumns?: string[];
}

/**
 * Update a Doctor row by id. Runs conflict detection (excluding self), then
 * updates. { success: true } if no valid keys.
 */
export async function updateDoctor({ dbPool, id, data, validColumns }: UpdateDoctorOptions): Promise<SqlRow | null> {
  const conflict = await buildDoctorConflictResponse(dbPool, data, id);
  if (conflict) {
    const err = new Error(conflict.payload.error) as Error & { status: number; conflictPayload: DoctorConflict['payload'] };
    err.status = conflict.status;
    err.conflictPayload = conflict.payload;
    throw err;
  }

  data.updated_date = new Date();
  let keys = Object.keys(data).filter((k) => k !== 'id');
  if (validColumns) {
    keys = keys.filter((k) => validColumns.includes(k));
  }
  if (keys.length === 0) {
    return { success: true };
  }
  await updateRow(dbPool, DOCTOR_TABLE, keys, data, id);
  const row = await selectRow(dbPool, DOCTOR_TABLE, id);
  return row ? (fromSqlRow(row) as SqlRow) : null;
}

interface DeleteDoctorOptions {
  dbPool: Pool;
  id: string;
}

/**
 * Delete a Doctor row by id. Pre-fetches for audit, deletes, returns the
 * deleted record (caller writes the SystemLog audit entry + broadcasts).
 */
export async function deleteDoctor({ dbPool, id }: DeleteDoctorOptions): Promise<SqlRow | null> {
  const existing = await selectRow(dbPool, DOCTOR_TABLE, id);
  const deletedRecord = existing ? (fromSqlRow(existing) as SqlRow) : null;
  await deleteRow(dbPool, DOCTOR_TABLE, id);
  return deletedRecord;
}

/**
 * Get a single Doctor by id.
 */
export async function getDoctor(dbPool: Pool, id: string): Promise<SqlRow | null> {
  const row = await selectRow(dbPool, DOCTOR_TABLE, id);
  return row ? (fromSqlRow(row) as SqlRow) : null;
}

/**
 * List/filter Doctors. Pass-through to the shared filterRows helper.
 */
export async function listDoctors(
  dbPool: Pool,
  opts: { filters?: SqlRow; sort?: string; limit?: string | number; skip?: string | number } = {}
): Promise<SqlRow[]> {
  const rows = await filterRows(dbPool, DOCTOR_TABLE, opts);
  return rows.map(fromSqlRow) as SqlRow[];
}
