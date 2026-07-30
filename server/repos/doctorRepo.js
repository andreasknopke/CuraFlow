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

import {
  insertRow,
  updateRow,
  deleteRow,
  selectRow,
  filterRows,
} from '../utils/queryHelpers.js';
import { fromSqlRow } from '../utils/sqlMarshal.js';

export const DOCTOR_TABLE = 'Doctor';

// ─── Conflict detection (moved verbatim from dbProxy.js) ────────────────────

/**
 * Find Doctor rows conflicting on name or initials.
 * @param {import('mysql2/promise').Pool} dbPool
 * @param {Record<string, *>} data
 * @param {string|null} [excludeId] - On update, the id being updated (excluded).
 * @returns {Promise<{nameConflict: object|null, initialsConflict: object|null}|null>}
 */
export const findDoctorConflicts = async (dbPool, data, excludeId = null) => {
  const name = data?.name?.trim();
  const initials = data?.initials?.trim();

  if (!name && !initials) {
    return null;
  }

  const conditions = [];
  const params = [];

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

  const [rows] = await dbPool.execute(sql, params);
  const nameConflict = name ? rows.find((row) => row.name === name) : null;
  const initialsConflict = initials ? rows.find((row) => row.initials === initials) : null;

  return {
    nameConflict,
    initialsConflict,
  };
};

/**
 * Build a 409 conflict response if name/initials collide, else null.
 * @param {import('mysql2/promise').Pool} dbPool
 * @param {Record<string, *>} data
 * @param {string|null} [excludeId]
 * @returns {Promise<{status: number, payload: {error: string, field: string}}|null>}
 */
export const buildDoctorConflictResponse = async (dbPool, data, excludeId = null) => {
  const conflicts = await findDoctorConflicts(dbPool, data, excludeId);
  if (!conflicts) {
    return null;
  }

  if (conflicts.nameConflict) {
    return {
      status: 409,
      payload: {
        error: `Ein Mitarbeiter mit dem Namen "${data.name.trim()}" existiert bereits. Bitte wählen Sie einen anderen Namen.`,
        field: 'name'
      }
    };
  }

  if (conflicts.initialsConflict) {
    return {
      status: 409,
      payload: {
        error: `Das Kürzel "${data.initials.trim()}" wird bereits verwendet. Bitte wählen Sie ein anderes Kürzel.`,
        field: 'initials'
      }
    };
  }

  return null;
};

// ─── CRUD ───────────────────────────────────────────────────────────────────

/**
 * Create a Doctor row. Runs name/initials conflict detection as a pre-check
 * (returns a 409 conflict response if found), then auto-injects
 * id/dates/created_by, filters to valid columns, inserts.
 * @param {object} opts
 * @param {import('mysql2/promise').Pool} opts.dbPool
 * @param {Record<string, *>} opts.data
 * @param {string[]} opts.validColumns
 * @param {string} [opts.actorEmail]
 * @returns {Promise<Record<string, *>>} The created row (the data object).
 * @throws {{status: 409, payload: object}} On name/initials conflict.
 */
export async function createDoctor({ dbPool, data, validColumns, actorEmail }) {
  const conflict = await buildDoctorConflictResponse(dbPool, data);
  if (conflict) {
    const err = new Error(conflict.payload.error);
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
    const err = new Error(`No valid columns found for table ${DOCTOR_TABLE}`);
    err.status = 500;
    throw err;
  }

  await insertRow(dbPool, DOCTOR_TABLE, keys, data);
  return data;
}

/**
 * Update a Doctor row by id. Runs conflict detection (excluding self), then
 * updates. { success: true } if no valid keys.
 * @param {object} opts
 * @param {import('mysql2/promise').Pool} opts.dbPool
 * @param {string} opts.id
 * @param {Record<string, *>} opts.data
 * @param {string[]} [opts.validColumns]
 * @returns {Promise<Record<string, *>|null>}
 * @throws {{status: 409, conflictPayload: object}} On name/initials conflict.
 */
export async function updateDoctor({ dbPool, id, data, validColumns }) {
  const conflict = await buildDoctorConflictResponse(dbPool, data, id);
  if (conflict) {
    const err = new Error(conflict.payload.error);
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
  return row ? fromSqlRow(row) : null;
}

/**
 * Delete a Doctor row by id. Pre-fetches for audit, deletes, returns the
 * deleted record (caller writes the SystemLog audit entry + broadcasts).
 * @param {object} opts
 * @param {import('mysql2/promise').Pool} opts.dbPool
 * @param {string} opts.id
 * @returns {Promise<Record<string, *>|null>}
 */
export async function deleteDoctor({ dbPool, id }) {
  const existing = await selectRow(dbPool, DOCTOR_TABLE, id);
  const deletedRecord = existing ? fromSqlRow(existing) : null;
  await deleteRow(dbPool, DOCTOR_TABLE, id);
  return deletedRecord;
}

/**
 * Get a single Doctor by id.
 * @param {import('mysql2/promise').Pool} dbPool
 * @param {string} id
 * @returns {Promise<Record<string, *>|null>}
 */
export async function getDoctor(dbPool, id) {
  const row = await selectRow(dbPool, DOCTOR_TABLE, id);
  return row ? fromSqlRow(row) : null;
}

/**
 * List/filter Doctors. Pass-through to the shared filterRows helper.
 * @param {import('mysql2/promise').Pool} dbPool
 * @param {{ filters?: Record<string, *>, sort?: string, limit?: *, skip?: * }} [opts]
 * @returns {Promise<Record<string, *>[]>}
 */
export async function listDoctors(dbPool, opts = {}) {
  const rows = await filterRows(dbPool, DOCTOR_TABLE, opts);
  return rows.map(fromSqlRow);
}
