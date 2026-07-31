/**
 * ShiftEntry repository (Phase 2, PR 2.5).
 *
 * Consolidates the ShiftEntry-specific logic that was scattered across dbProxy.js
 * (helpers + inline create/update/delete/list/get branches) into one module.
 * The table name is now the constant SHIFT_ENTRY_TABLE. `centralAbsences.js`
 * stays as the central-store engine — this repo calls it. `atomic.js` is
 * untouched. The `can_edit_schedule` permission guard stays in dbProxy's
 * pre-action block (runs BEFORE this repo).
 *
 * Behavior is PRESERVED EXACTLY — including the known S5 partial-position
 * bypass (update without `position` skips the guard). Do NOT "fix" S5 here.
 *
 * Helpers moved from dbProxy: checkShiftConflict (sentinel), resolveCentralShiftRouting,
 * loadDoctorLink. The auto-time (ShiftTimeRule lookup) and ScheduleBlock lock check
 * move from the inline create branch into createShiftEntry.
 */

import crypto from 'crypto';
import type { Pool, RowDataPacket } from 'mysql2/promise';

import {
  deleteCentralAbsenceById,
  getShiftEntryWithCentralAbsence,
  isCentralAbsencePosition,
  listShiftEntriesWithCentralAbsences,
  writeShiftEntryToCentralAbsence,
} from '../utils/centralAbsences.js';
import {
  insertRow,
  updateRow,
  deleteRow,
  selectRow,
} from '../utils/queryHelpers.js';
import { fromSqlRow } from '../utils/sqlMarshal.js';

export const SHIFT_ENTRY_TABLE = 'ShiftEntry';

type SqlRow = Record<string, unknown>;

export interface DbRow extends RowDataPacket {
  [key: string]: unknown;
}

type GetValidColumns = (dbPool: Pool, tableName: string, cacheKey: string) => Promise<string[]>;
type EnsureScheduleBlockTable = (dbPool: Pool, cacheKey: string) => Promise<void>;

interface RepoRequest {
  db?: Pool;
  dbToken?: string;
  user?: { email?: string };
}

interface DoctorLink {
  doctorId: string;
  employeeId: string;
}

interface SentinelError extends Error {
  status: number;
  body: SqlRow;
}

// ─── Helpers moved verbatim from dbProxy.js ─────────────────────────────────

const loadDoctorLink = async (dbPool: Pool, doctorId: string | null | undefined): Promise<DoctorLink | null> => {
  if (!doctorId) return null;
  const [rows] = await dbPool.execute<DbRow[]>(
    'SELECT id, central_employee_id FROM Doctor WHERE id = ? LIMIT 1',
    [doctorId]
  );
  if (rows.length === 0 || !rows[0].central_employee_id) {
    return null;
  }
  return {
    doctorId: String(rows[0].id),
    employeeId: String(rows[0].central_employee_id),
  };
};

interface CentralRoutingResult {
  tenantId: string | null;
  doctorLink?: DoctorLink | null;
  mode?: 'central' | 'tenant';
  existing?: SqlRow | null;
}

interface ResolveRoutingOptions {
  dbPool: Pool;
  masterDb: Pool;
  req: RepoRequest;
  action: string;
  id?: string;
  data?: SqlRow;
}

const resolveCentralShiftRouting = async ({ dbPool, masterDb, req, action, id, data }: ResolveRoutingOptions): Promise<CentralRoutingResult> => {
  const { resolveTenantIdFromToken } = await import('../utils/tenantGroups.js');
  const tenantId = req.dbToken ? await resolveTenantIdFromToken(masterDb, req.dbToken) : null;

  if (['list', 'filter'].includes(action)) {
    return { tenantId };
  }

  if (action === 'create') {
    const doctorId = data && typeof data.doctor_id === 'string' ? data.doctor_id : null;
    const doctorLink = await loadDoctorLink(dbPool, doctorId);
    if (doctorLink && isCentralAbsencePosition(data?.position)) {
      return { tenantId, doctorLink, mode: 'central' };
    }
    return { tenantId, doctorLink, mode: 'tenant' };
  }

  if (action === 'bulkCreate') {
    return { tenantId };
  }

  if (action === 'get' || action === 'delete' || action === 'update') {
    const existing = id ? await getShiftEntryWithCentralAbsence({ tenantDb: dbPool, masterDb, id }) : null;
    if (!existing) {
      return { tenantId, existing: null, mode: 'tenant' };
    }
    const typedExisting = existing as SqlRow;
    const existingDoctorId = typeof typedExisting.doctor_id === 'string' ? typedExisting.doctor_id : null;
    const doctorLink = await loadDoctorLink(dbPool, existingDoctorId);
    const isCentral = !!doctorLink && isCentralAbsencePosition(typedExisting.position);
    return { tenantId, existing: typedExisting, doctorLink, mode: isCentral ? 'central' : 'tenant' };
  }

  return { tenantId };
};

/**
 * Sentinel: check for duplicate shifts on single-assignment positions.
 * Moved verbatim from dbProxy. Uses the WORKPLACE_CACHE + getValidColumns
 * passed from dbProxy (the cache is shared).
 */
const checkShiftConflict = async (
  dbPool: Pool,
  shiftData: SqlRow,
  cacheKey: string,
  getValidColumns: GetValidColumns,
  WORKPLACE_CACHE: Record<string, { data: DbRow | null; ts: number }>,
  WORKPLACE_CACHE_TTL: number
): Promise<DbRow | null> => {
  const date = shiftData.date;
  const position = shiftData.position;
  const timeslot_id = shiftData.timeslot_id;
  if (!date || !position) return null;

  const positionStr = String(position);
  const wpCacheKey = `${cacheKey}:wp:${positionStr}`;
  let wpEntry = WORKPLACE_CACHE[wpCacheKey];
  if (!wpEntry || Date.now() - wpEntry.ts > WORKPLACE_CACHE_TTL) {
    try {
      const workplaceColumns = await getValidColumns(dbPool, 'Workplace', cacheKey);
      const hasAllowsMultiple = Array.isArray(workplaceColumns) && workplaceColumns.includes('allows_multiple');
      const selectColumns = hasAllowsMultiple ? 'allows_multiple, category' : 'category';
      const [rows] = await dbPool.execute<DbRow[]>(
        `SELECT ${selectColumns} FROM Workplace WHERE name = ? LIMIT 1`,
        [positionStr]
      );
      const wp = rows[0] || null;
      WORKPLACE_CACHE[wpCacheKey] = { data: wp, ts: Date.now() };
      wpEntry = WORKPLACE_CACHE[wpCacheKey];
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.warn('[Sentinel] Workplace lookup failed:', message);
      return null;
    }
  }

  const wp = wpEntry.data;
  if (!wp) return null;

  let allowsMultiple: boolean;
  if (wp.allows_multiple !== undefined && wp.allows_multiple !== null) {
    allowsMultiple = !!wp.allows_multiple;
  } else {
    if (wp.category === 'Rotationen') allowsMultiple = true;
    else if (wp.category === 'Dienste' || wp.category === 'Demonstrationen & Konsile') allowsMultiple = false;
    else allowsMultiple = true;
  }

  if (allowsMultiple) return null;

  let sql: string;
  let params: unknown[];
  if (timeslot_id) {
    sql = 'SELECT id, doctor_id FROM ShiftEntry WHERE date = ? AND position = ? AND timeslot_id = ? LIMIT 1';
    params = [date, positionStr, timeslot_id];
  } else {
    sql = 'SELECT id, doctor_id FROM ShiftEntry WHERE date = ? AND position = ? LIMIT 1';
    params = [date, positionStr];
  }

  try {
    const [existing] = await dbPool.execute<DbRow[]>(sql, params);
    return existing.length > 0 ? existing[0] : null;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.warn('[Sentinel] Conflict check failed:', message);
    return null;
  }
};

// ─── CRUD ───────────────────────────────────────────────────────────────────

interface ListShiftEntriesOptions {
  tenantDb: Pool;
  masterDb: Pool;
  filters?: SqlRow;
  sort?: string;
  limit?: string | number;
  skip?: string | number;
}

/**
 * List/filter ShiftEntries (routes through centralAbsences for the central/tenant merge).
 */
export async function listShiftEntries({ tenantDb, masterDb, filters, sort, limit, skip }: ListShiftEntriesOptions): Promise<SqlRow[]> {
  return listShiftEntriesWithCentralAbsences({ tenantDb, masterDb, filters, sort, limit, skip });
}

interface GetShiftEntryOptions {
  tenantDb: Pool;
  masterDb: Pool;
  id: string;
}

/**
 * Get a single ShiftEntry by id (routes through centralAbsences).
 */
export async function getShiftEntry({ tenantDb, masterDb, id }: GetShiftEntryOptions): Promise<SqlRow | null> {
  return getShiftEntryWithCentralAbsence({ tenantDb, masterDb, id }) as Promise<SqlRow | null>;
}

interface CreateShiftEntryOptions {
  dbPool: Pool;
  masterDb: Pool;
  req: RepoRequest;
  data: SqlRow;
  cacheKey: string;
  getValidColumns: GetValidColumns;
  WORKPLACE_CACHE: Record<string, { data: DbRow | null; ts: number }>;
  WORKPLACE_CACHE_TTL: number;
  ensureScheduleBlockTable: EnsureScheduleBlockTable;
}

interface CreateShiftEntryResult {
  result: SqlRow;
  central: boolean;
}

/**
 * Create a ShiftEntry. Encapsulates: central routing, ScheduleBlock sentinel,
 * auto-time (ShiftTimeRule lookup), and the generic insert fallback.
 *
 * @throws SentinelError On sentinel/ScheduleBlock conflict (409).
 */
export async function createShiftEntry({
  dbPool,
  masterDb,
  req,
  data,
  cacheKey,
  getValidColumns,
  WORKPLACE_CACHE,
  WORKPLACE_CACHE_TTL,
  ensureScheduleBlockTable,
}: CreateShiftEntryOptions): Promise<CreateShiftEntryResult> {
  const centralRouting = await resolveCentralShiftRouting({ dbPool, masterDb, req, action: 'create', data });

  if (!data.id) data.id = crypto.randomUUID();
  data.created_date = new Date();
  data.updated_date = new Date();
  data.created_by = req.user?.email || 'system';

  // Central-mode write
  if (req.db && centralRouting?.mode === 'central' && centralRouting.doctorLink) {
    const created = await writeShiftEntryToCentralAbsence({
      tenantDb: dbPool,
      masterDb,
      tenantId: centralRouting.tenantId as string,
      shiftEntry: data,
      doctorId: centralRouting.doctorLink.doctorId,
      preserveId: true,
    });
    return { result: (created as SqlRow) || data, central: true };
  }

  // ScheduleBlock sentinel
  if (data.date && data.position) {
    await ensureScheduleBlockTable(dbPool, cacheKey);
    try {
      let blockSql: string;
      let blockParams: unknown[];
      if (data.timeslot_id) {
        blockSql = 'SELECT id, reason FROM ScheduleBlock WHERE date = ? AND position = ? AND (timeslot_id = ? OR timeslot_id IS NULL) LIMIT 1';
        blockParams = [data.date, data.position, data.timeslot_id];
      } else {
        blockSql = 'SELECT id, reason FROM ScheduleBlock WHERE date = ? AND position = ? AND timeslot_id IS NULL LIMIT 1';
        blockParams = [data.date, data.position];
      }
      const [blockRows] = await dbPool.execute<DbRow[]>(blockSql, blockParams);
      if (blockRows.length > 0) {
        const reason = String(blockRows[0].reason ?? '');
        console.warn(`[Sentinel] Blocked ShiftEntry on locked cell: ${data.position} on ${data.date} (reason: ${reason})`);
        const err = new Error('Zelle gesperrt') as SentinelError;
        err.status = 409;
        err.body = {
          error: 'Zelle gesperrt' + (reason ? `: ${reason}` : ''),
          blocked: true,
          block_id: blockRows[0].id,
          reason: blockRows[0].reason
        };
        throw err;
      }
    } catch (e) {
      if (e && typeof e === 'object' && 'status' in e && (e as SentinelError).status === 409) throw e;
      // ScheduleBlock table may not exist yet — skip silently
    }

    const conflict = await checkShiftConflict(dbPool, data, cacheKey, getValidColumns, WORKPLACE_CACHE, WORKPLACE_CACHE_TTL);
    if (conflict) {
      console.warn(`[Sentinel] Blocked duplicate ShiftEntry: ${data.position} on ${data.date} (existing: ${conflict.id})`);
      const err = new Error('Position bereits besetzt') as SentinelError;
      err.status = 409;
      err.body = {
        error: 'Position bereits besetzt',
        conflict: true,
        existing_id: conflict.id,
        existing_doctor_id: conflict.doctor_id
      };
      throw err;
    }
  }

  // Auto-time from ShiftTimeRule
  if (data.doctor_id && data.position && !data.start_time) {
    try {
      const [docRows] = await dbPool.execute<DbRow[]>(
        `SELECT work_time_model_id FROM Doctor WHERE id = ? LIMIT 1`,
        [data.doctor_id]
      );
      const modelId = docRows[0]?.work_time_model_id;

      if (modelId) {
        const [wpRows] = await dbPool.execute<DbRow[]>(
          `SELECT id FROM Workplace WHERE name = ? LIMIT 1`,
          [data.position]
        );
        const workplaceId = wpRows[0]?.id;

        if (workplaceId) {
          const [ruleRows] = await dbPool.execute<DbRow[]>(
            `SELECT start_time, end_time, break_minutes FROM ShiftTimeRule WHERE workplace_id = ? AND work_time_model_id = ? LIMIT 1`,
            [workplaceId, modelId]
          );

          if (ruleRows[0]) {
            data.start_time = ruleRows[0].start_time;
            data.end_time = ruleRows[0].end_time;
            if (ruleRows[0].break_minutes) {
              data.break_minutes = ruleRows[0].break_minutes;
            }
          }
        }
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.warn(`[AutoTime] Failed to calculate shift times: ${message}`);
    }
  }

  // Generic insert (tenant)
  const validColumns = await getValidColumns(dbPool, SHIFT_ENTRY_TABLE, cacheKey);
  let keys = Object.keys(data);
  if (validColumns && validColumns.length > 0) {
    keys = keys.filter((k) => validColumns.includes(k));
  }
  if (keys.length === 0) {
    const err = new Error(`No valid columns found for table ${SHIFT_ENTRY_TABLE}`) as Error & { status: number };
    err.status = 500;
    throw err;
  }

  await insertRow(dbPool, SHIFT_ENTRY_TABLE, keys, data);
  return { result: data, central: false };
}

interface UpdateShiftEntryOptions {
  dbPool: Pool;
  masterDb: Pool;
  req: RepoRequest;
  id: string;
  data: SqlRow;
  cacheKey: string;
  getValidColumns: GetValidColumns;
}

interface UpdateShiftEntryResult {
  result: SqlRow | null;
  central: boolean;
}

/**
 * Update a ShiftEntry by id. Encapsulates: central routing, central→tenant and
 * tenant→central transitions, and the generic update fallback.
 */
export async function updateShiftEntry({
  dbPool,
  masterDb,
  req,
  id,
  data,
  cacheKey,
  getValidColumns,
}: UpdateShiftEntryOptions): Promise<UpdateShiftEntryResult> {
  const centralRouting = await resolveCentralShiftRouting({ dbPool, masterDb, req, action: 'update', id });

  data.updated_date = new Date();

  if (req.db && centralRouting?.existing) {
    const nextDoctorIdRaw = data.doctor_id || centralRouting.existing.doctor_id;
    const nextDoctorId = typeof nextDoctorIdRaw === 'string' ? nextDoctorIdRaw : null;
    const nextDoctorLink = await loadDoctorLink(dbPool, nextDoctorId);
    const nextPositionRaw = data.position || centralRouting.existing.position;
    const nextPosition = typeof nextPositionRaw === 'string' ? nextPositionRaw : null;
    const nextPayload: SqlRow = { ...centralRouting.existing, ...data, id, doctor_id: nextDoctorId };

    // tenant→central or central→central
    if (nextDoctorLink && isCentralAbsencePosition(nextPosition)) {
      if (centralRouting.mode !== 'central') {
        await dbPool.execute('DELETE FROM ShiftEntry WHERE id = ?', [id]);
      }
      const updated = await writeShiftEntryToCentralAbsence({
        tenantDb: dbPool,
        masterDb,
      tenantId: centralRouting.tenantId as string,
        shiftEntry: nextPayload,
        doctorId: nextDoctorLink.doctorId,
        preserveId: true,
      });
      return { result: updated as SqlRow, central: true };
    }

    // central→tenant transition
    if (centralRouting.mode === 'central') {
      await deleteCentralAbsenceById(masterDb, id);
      const localPayload: SqlRow = { ...nextPayload, doctor_id: nextDoctorId, id };
      const validColumns = await getValidColumns(dbPool, SHIFT_ENTRY_TABLE, cacheKey);
      let keys = Object.keys(localPayload).filter((key) => key !== 'id');
      if (validColumns) {
        keys = keys.filter((k) => validColumns.includes(k));
      }
      if (keys.length === 0) {
        return { result: { success: true }, central: false };
      }
      await insertRow(dbPool, SHIFT_ENTRY_TABLE, ['id', ...keys], localPayload);
      const row = await selectRow(dbPool, SHIFT_ENTRY_TABLE, id);
      return { result: row ? (fromSqlRow(row) as SqlRow) : null, central: false };
    }
  }

  // Generic update (tenant)
  const validColumns = await getValidColumns(dbPool, SHIFT_ENTRY_TABLE, cacheKey);
  let keys = Object.keys(data).filter((k) => k !== 'id');
  if (validColumns) {
    keys = keys.filter((k) => validColumns.includes(k));
  }
  if (keys.length === 0) {
    return { result: { success: true }, central: false };
  }
  await updateRow(dbPool, SHIFT_ENTRY_TABLE, keys, data, id);
  const row = await selectRow(dbPool, SHIFT_ENTRY_TABLE, id);
  return { result: row ? (fromSqlRow(row) as SqlRow) : null, central: false };
}

interface DeleteShiftEntryOptions {
  dbPool: Pool;
  masterDb: Pool;
  req: RepoRequest;
  id: string;
}

interface DeleteShiftEntryResult {
  central: boolean;
  deletedRecord?: SqlRow | null;
}

/**
 * Delete a ShiftEntry by id. Central-mode deletes from centralAbsences;
 * otherwise falls through to the tenant delete.
 */
export async function deleteShiftEntry({ dbPool, masterDb, req, id }: DeleteShiftEntryOptions): Promise<DeleteShiftEntryResult> {
  if (req.db) {
    const centralRouting = await resolveCentralShiftRouting({ dbPool, masterDb, req, action: 'delete', id });
    if (centralRouting?.mode === 'central') {
      await deleteCentralAbsenceById(masterDb, id);
      return { central: true };
    }
  }

  // Tenant delete (caller handles audit + broadcast)
  const existing = await selectRow(dbPool, SHIFT_ENTRY_TABLE, id);
  const deletedRecord = existing ? (fromSqlRow(existing) as SqlRow) : null;
  await deleteRow(dbPool, SHIFT_ENTRY_TABLE, id);
  return { central: false, deletedRecord };
}
