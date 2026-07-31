/**
 * WishRequest repository (Phase 2, PR 2.3).
 *
 * Replaces the generic `/api/db` dispatch for the tenant `WishRequest` table
 * with a dedicated module so the table name is a CONSTANT in code. WishRequest
 * is a tenant table (in TENANT_BASE_TABLES), so the generic path uses the
 * correct pool (req.db) — unlike AbsenceRequest (master table, broken generic
 * path). The frontend actively uses this surface (WishList.tsx,
 * MyDashboard.tsx, useScheduleMutations.ts).
 *
 * The approval-permission guard (can_approve_wishes) runs in dbProxy's
 * pre-action block BEFORE this repo dispatch — it 403s approval-affecting
 * writes by unauthorized users. This repo only runs for writes that passed the
 * guard, so it does NOT re-check permissions.
 *
 * The central CentralWishRequest table (master DB, cross-tenant
 * "Verbundsdienst" wishes) is a SEPARATE entity with dedicated routes in
 * groups.js — out of scope here (like QualificationCertificate was for PR 2.1).
 *
 * Behavior is PRESERVED EXACTLY from the generic dbProxy dispatch:
 *   - create: auto-inject id/dates/created_by; filter keys; insert; broadcast.
 *   - update: set updated_date; filter keys (exclude id); update; read-back;
 *     broadcast. { success: true } if no valid keys.
 *   - delete: pre-fetch for audit; delete; write SystemLog; broadcast.
 *   - list/filter/get: pass through to shared helpers + fromSqlRow.
 */

import crypto from 'crypto';
import type { Pool } from 'mysql2/promise';

import {
  insertRow,
  updateRow,
  deleteRow,
  selectRow,
  filterRows,
} from '../utils/queryHelpers.js';
import { fromSqlRow } from '../utils/sqlMarshal.js';

type SqlRow = Record<string, unknown>;

export const WISH_REQUEST_TABLE = 'WishRequest';

/**
 * Create a WishRequest row. Replicates the generic create path: auto-injects
 * id/created_date/updated_date/created_by, filters to valid columns, inserts.
 * @param {object} opts
 * @param {import('mysql2/promise').Pool} opts.dbPool
 * @param {Record<string, *>} opts.data - The row to create (mutated: id/dates injected).
 * @param {string[]} opts.validColumns - Live column list from getValidColumns.
 * @param {string} [opts.actorEmail] - created_by value.
 * @returns {Promise<Record<string, *>>} The created row (the data object).
 */
export async function createWishRequest({ dbPool, data, validColumns, actorEmail }: { dbPool: Pool; data: SqlRow; validColumns: string[]; actorEmail?: string }): Promise<SqlRow> {
  if (!data.id) data.id = crypto.randomUUID();
  data.created_date = new Date();
  data.updated_date = new Date();
  data.created_by = actorEmail || 'system';

  let keys = Object.keys(data);
  if (validColumns && validColumns.length > 0) {
    keys = keys.filter((k) => validColumns.includes(k));
  }
  if (keys.length === 0) {
    const err = new Error(`No valid columns found for table ${WISH_REQUEST_TABLE}`) as Error & { status: number };
    err.status = 500;
    throw err;
  }

  await insertRow(dbPool, WISH_REQUEST_TABLE, keys, data);
  return data;
}

/**
 * Update a WishRequest row by id. Replicates the generic update path.
 * @param {object} opts
 * @param {import('mysql2/promise').Pool} opts.dbPool
 * @param {string} opts.id
 * @param {Record<string, *>} opts.data
 * @param {string[]} [opts.validColumns]
 * @returns {Promise<Record<string, *>|null>} The updated row (fromSqlRow) or { success: true }.
 */
export async function updateWishRequest({ dbPool, id, data, validColumns }: { dbPool: Pool; id: string; data: SqlRow; validColumns?: string[] }): Promise<SqlRow | null> {
  data.updated_date = new Date();
  let keys = Object.keys(data).filter((k) => k !== 'id');
  if (validColumns) {
    keys = keys.filter((k) => validColumns.includes(k));
  }
  if (keys.length === 0) {
    return { success: true };
  }
  await updateRow(dbPool, WISH_REQUEST_TABLE, keys, data, id);
  const row = await selectRow(dbPool, WISH_REQUEST_TABLE, id);
  return row ? fromSqlRow(row) : null;
}

/**
 * Delete a WishRequest row by id. Replicates the generic delete path:
 * pre-fetches for audit, deletes, returns the deleted record (caller writes
 * the SystemLog audit entry + broadcasts).
 * @param {object} opts
 * @param {import('mysql2/promise').Pool} opts.dbPool
 * @param {string} opts.id
 * @returns {Promise<Record<string, *>|null>} The deleted row (fromSqlRow) or null.
 */
export async function deleteWishRequest({ dbPool, id }: { dbPool: Pool; id: string }): Promise<SqlRow | null> {
  const existing = await selectRow(dbPool, WISH_REQUEST_TABLE, id);
  const deletedRecord = existing ? fromSqlRow(existing) : null;
  await deleteRow(dbPool, WISH_REQUEST_TABLE, id);
  return deletedRecord;
}

/**
 * Get a single WishRequest by id.
 * @param {import('mysql2/promise').Pool} dbPool
 * @param {string} id
 * @returns {Promise<Record<string, *>|null>}
 */
export async function getWishRequest(dbPool: Pool, id: string): Promise<SqlRow | null> {
  const row = await selectRow(dbPool, WISH_REQUEST_TABLE, id);
  return row ? fromSqlRow(row) : null;
}

/**
 * List/filter WishRequests. Pass-through to the shared filterRows helper.
 * @param {import('mysql2/promise').Pool} dbPool
 * @param {{ filters?: Record<string, *>, sort?: string, limit?: *, skip?: * }} [opts]
 * @returns {Promise<Record<string, *>[]>}
 */
export async function listWishRequests(dbPool: Pool, opts: { filters?: SqlRow; sort?: string; limit?: string | number; skip?: string | number } = {}): Promise<SqlRow[]> {
  const rows = await filterRows(dbPool, WISH_REQUEST_TABLE, opts);
  return rows.map(fromSqlRow) as SqlRow[];
}
