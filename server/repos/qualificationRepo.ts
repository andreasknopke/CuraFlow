/**
 * Qualification repository (Phase 2, PR 2.1).
 *
 * Replaces the generic `/api/db` dispatch for the `Qualification` table with a
 * dedicated module so the table name is a CONSTANT in code, not user input.
 * This is the simplest entity (plain CRUD, no central routing, no write
 * permission guard, public read), chosen as the first repo-ification target.
 *
 * Behavior is PRESERVED EXACTLY from the generic dbProxy dispatch:
 *   - create: auto-inject id (if absent), created_date, updated_date, created_by;
 *     filter keys to valid columns; insert; broadcast plan-update.
 *   - update: set updated_date; filter keys (exclude id); insert; read-back;
 *     broadcast.
 *   - delete: pre-fetch for audit; delete; write SystemLog audit; broadcast.
 *   - list/filter/get: pass through to the shared query helpers + fromSqlRow.
 *
 * Sibling tables (DoctorQualification, WorkplaceQualification) remain on the
 * generic dispatch for now — they have cross-table coordination
 * (rotationQualificationSync, certificates recompute) that warrants separate
 * per-entity repos.
 *
 * @typedef {import('../utils/sqlMarshal.js').SqlRow} SqlRow
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
import type { Pool } from 'mysql2/promise';

type SqlRow = Record<string, unknown>;

export const QUALIFICATION_TABLE = 'Qualification';

/**
 * Create a Qualification row. Replicates the generic create path: auto-injects
 * id/created_date/updated_date/created_by, filters to valid columns, inserts,
 * and notifies the caller to broadcast (the caller owns the realtime scope).
 *
 * @param {object} opts
 * @param {import('mysql2/promise').Pool} opts.dbPool
 * @param {Record<string, *>} opts.data - The row to create (mutated: id/dates injected).
 * @param {string[]} opts.validColumns - Live column list from getValidColumns.
 * @param {string} [opts.actorEmail] - created_by value (req.user.email or 'system').
 * @returns {Promise<Record<string, *>>} The created row (the data object).
 */
export async function createQualification({ dbPool, data, validColumns, actorEmail }: { dbPool: Pool; data: SqlRow; validColumns: string[]; actorEmail?: string }): Promise<SqlRow> {
  if (!data.id) data.id = crypto.randomUUID();
  data.created_date = new Date();
  data.updated_date = new Date();
  data.created_by = actorEmail || 'system';

  let keys = Object.keys(data);
  if (validColumns && validColumns.length > 0) {
    keys = keys.filter((k) => validColumns.includes(k));
  }
  if (keys.length === 0) {
    const err = new Error(`No valid columns found for table ${QUALIFICATION_TABLE}`) as Error & { status: number };
    err.status = 500;
    throw err;
  }

  await insertRow(dbPool, QUALIFICATION_TABLE, keys, data);
  return data;
}

/**
 * Update a Qualification row by id. Replicates the generic update path: sets
 * updated_date, filters keys (excludes id), updates, and returns the read-back
 * row. Returns { success: true } if no valid keys remain (matches generic).
 *
 * @param {object} opts
 * @param {import('mysql2/promise').Pool} opts.dbPool
 * @param {string} opts.id
 * @param {Record<string, *>} opts.data - The fields to update.
 * @param {string[]} [opts.validColumns]
 * @returns {Promise<Record<string, *>|null>} The updated row (fromSqlRow) or { success: true }.
 */
export async function updateQualification({ dbPool, id, data, validColumns }: { dbPool: Pool; id: string; data: SqlRow; validColumns?: string[] }): Promise<SqlRow | null> {
  data.updated_date = new Date();
  let keys = Object.keys(data).filter((k) => k !== 'id');
  if (validColumns) {
    keys = keys.filter((k) => validColumns.includes(k));
  }
  if (keys.length === 0) {
    return { success: true };
  }
  await updateRow(dbPool, QUALIFICATION_TABLE, keys, data, id);
  const row = await selectRow(dbPool, QUALIFICATION_TABLE, id);
  return row ? fromSqlRow(row) : null;
}

/**
 * Delete a Qualification row by id. Replicates the generic delete path:
 * pre-fetches for audit, deletes, returns the deleted record (caller writes
 * the SystemLog audit entry + broadcasts).
 *
 * @param {object} opts
 * @param {import('mysql2/promise').Pool} opts.dbPool
 * @param {string} opts.id
 * @returns {Promise<Record<string, *>|null>} The deleted row (fromSqlRow) or null.
 */
export async function deleteQualification({ dbPool, id }: { dbPool: Pool; id: string }): Promise<SqlRow | null> {
  const existing = await selectRow(dbPool, QUALIFICATION_TABLE, id);
  const deletedRecord = existing ? fromSqlRow(existing) : null;
  await deleteRow(dbPool, QUALIFICATION_TABLE, id);
  return deletedRecord;
}

/**
 * Get a single Qualification by id.
 * @param {import('mysql2/promise').Pool} dbPool
 * @param {string} id
 * @returns {Promise<Record<string, *>|null>}
 */
export async function getQualification(dbPool: Pool, id: string): Promise<SqlRow | null> {
  const row = await selectRow(dbPool, QUALIFICATION_TABLE, id);
  return row ? fromSqlRow(row) : null;
}

/**
 * List/filter Qualifications. Pass-through to the shared filterRows helper +
 * fromSqlRow mapping.
 * @param {import('mysql2/promise').Pool} dbPool
 * @param {{ filters?: Record<string, *>, sort?: string, limit?: *, skip?: * }} [opts]
 * @returns {Promise<Record<string, *>[]>}
 */
export async function listQualifications(dbPool: Pool, opts: { filters?: SqlRow; sort?: string; limit?: string | number; skip?: string | number } = {}): Promise<SqlRow[]> {
  const rows = await filterRows(dbPool, QUALIFICATION_TABLE, opts);
  return rows.map(fromSqlRow) as SqlRow[];
}
