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

// ─── Helpers moved verbatim from dbProxy.js ─────────────────────────────────

const loadDoctorLink = async (dbPool, doctorId) => {
  if (!doctorId) return null;
  const [rows] = await dbPool.execute(
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

const resolveCentralShiftRouting = async ({ dbPool, masterDb, req, action, id, data }) => {
  const { resolveTenantIdFromToken } = await import('../utils/tenantGroups.js');
  const tenantId = req.dbToken ? await resolveTenantIdFromToken(masterDb, req.dbToken) : null;

  if (['list', 'filter'].includes(action)) {
    return { tenantId };
  }

  if (action === 'create') {
    const doctorLink = await loadDoctorLink(dbPool, data?.doctor_id);
    if (doctorLink && isCentralAbsencePosition(data?.position)) {
      return { tenantId, doctorLink, mode: 'central' };
    }
    return { tenantId, doctorLink, mode: 'tenant' };
  }

  if (action === 'bulkCreate') {
    return { tenantId };
  }

  if (action === 'get' || action === 'delete' || action === 'update') {
    const existing = await getShiftEntryWithCentralAbsence({ tenantDb: dbPool, masterDb, id });
    if (!existing) {
      return { tenantId, existing: null, mode: 'tenant' };
    }
    const doctorLink = await loadDoctorLink(dbPool, existing.doctor_id);
    const isCentral = !!doctorLink && isCentralAbsencePosition(existing.position);
    return { tenantId, existing, doctorLink, mode: isCentral ? 'central' : 'tenant' };
  }

  return { tenantId };
};

/**
 * Sentinel: check for duplicate shifts on single-assignment positions.
 * Moved verbatim from dbProxy. Uses the WORKPLACE_CACHE + getValidColumns
 * passed from dbProxy (the cache is shared).
 */
const checkShiftConflict = async (dbPool, shiftData, cacheKey, getValidColumns, WORKPLACE_CACHE, WORKPLACE_CACHE_TTL) => {
  const { date, position, timeslot_id } = shiftData;
  if (!date || !position) return null;

  const wpCacheKey = `${cacheKey}:wp:${position}`;
  let wpEntry = WORKPLACE_CACHE[wpCacheKey];
  if (!wpEntry || Date.now() - wpEntry.ts > WORKPLACE_CACHE_TTL) {
    try {
      const workplaceColumns = await getValidColumns(dbPool, 'Workplace', cacheKey);
      const hasAllowsMultiple = Array.isArray(workplaceColumns) && workplaceColumns.includes('allows_multiple');
      const selectColumns = hasAllowsMultiple ? 'allows_multiple, category' : 'category';
      const [rows] = await dbPool.execute(
        `SELECT ${selectColumns} FROM Workplace WHERE name = ? LIMIT 1`,
        [position]
      );
      const wp = rows[0] || null;
      WORKPLACE_CACHE[wpCacheKey] = { data: wp, ts: Date.now() };
      wpEntry = WORKPLACE_CACHE[wpCacheKey];
    } catch (e) {
      console.warn('[Sentinel] Workplace lookup failed:', e.message);
      return null;
    }
  }

  const wp = wpEntry.data;
  if (!wp) return null;

  let allowsMultiple;
  if (wp.allows_multiple !== undefined && wp.allows_multiple !== null) {
    allowsMultiple = !!wp.allows_multiple;
  } else {
    if (wp.category === 'Rotationen') allowsMultiple = true;
    else if (wp.category === 'Dienste' || wp.category === 'Demonstrationen & Konsile') allowsMultiple = false;
    else allowsMultiple = true;
  }

  if (allowsMultiple) return null;

  let sql, params;
  if (timeslot_id) {
    sql = 'SELECT id, doctor_id FROM ShiftEntry WHERE date = ? AND position = ? AND timeslot_id = ? LIMIT 1';
    params = [date, position, timeslot_id];
  } else {
    sql = 'SELECT id, doctor_id FROM ShiftEntry WHERE date = ? AND position = ? LIMIT 1';
    params = [date, position];
  }

  try {
    const [existing] = await dbPool.execute(sql, params);
    return existing.length > 0 ? existing[0] : null;
  } catch (e) {
    console.warn('[Sentinel] Conflict check failed:', e.message);
    return null;
  }
};

// ─── CRUD ───────────────────────────────────────────────────────────────────

/**
 * List/filter ShiftEntries (routes through centralAbsences for the central/tenant merge).
 * @returns {Promise<object[]>} Array of shift entries.
 */
export async function listShiftEntries({ tenantDb, masterDb, filters, sort, limit, skip }) {
  return listShiftEntriesWithCentralAbsences({ tenantDb, masterDb, filters, sort, limit, skip });
}

/**
 * Get a single ShiftEntry by id (routes through centralAbsences).
 */
export async function getShiftEntry({ tenantDb, masterDb, id }) {
  return getShiftEntryWithCentralAbsence({ tenantDb, masterDb, id });
}

/**
 * Create a ShiftEntry. Encapsulates: central routing, ScheduleBlock sentinel,
 * auto-time (ShiftTimeRule lookup), and the generic insert fallback.
 * @returns {Promise<{result: object, central: boolean}>} The created row + whether it was central.
 * @throws {{status:number, body:object}} On sentinel/ScheduleBlock conflict (409).
 */
export async function createShiftEntry({ dbPool, masterDb, req, data, cacheKey, getValidColumns, WORKPLACE_CACHE, WORKPLACE_CACHE_TTL, ensureScheduleBlockTable }) {
  const centralRouting = await resolveCentralShiftRouting({ dbPool, masterDb, req, action: 'create', data });

  if (!data.id) data.id = crypto.randomUUID();
  data.created_date = new Date();
  data.updated_date = new Date();
  data.created_by = req.user?.email || 'system';

  // Central-mode write
  if (req.db && centralRouting?.mode === 'central') {
    const created = await writeShiftEntryToCentralAbsence({
      tenantDb: dbPool,
      masterDb,
      tenantId: centralRouting.tenantId,
      shiftEntry: data,
      doctorId: centralRouting.doctorLink.doctorId,
      preserveId: true,
    });
    return { result: created || data, central: true };
  }

  // ScheduleBlock sentinel
  if (data.date && data.position) {
    await ensureScheduleBlockTable(dbPool, cacheKey);
    try {
      let blockSql, blockParams;
      if (data.timeslot_id) {
        blockSql = 'SELECT id, reason FROM ScheduleBlock WHERE date = ? AND position = ? AND (timeslot_id = ? OR timeslot_id IS NULL) LIMIT 1';
        blockParams = [data.date, data.position, data.timeslot_id];
      } else {
        blockSql = 'SELECT id, reason FROM ScheduleBlock WHERE date = ? AND position = ? AND timeslot_id IS NULL LIMIT 1';
        blockParams = [data.date, data.position];
      }
      const [blockRows] = await dbPool.execute(blockSql, blockParams);
      if (blockRows.length > 0) {
        console.warn(`[Sentinel] Blocked ShiftEntry on locked cell: ${data.position} on ${data.date} (reason: ${blockRows[0].reason})`);
        const err = new Error('Zelle gesperrt');
        err.status = 409;
        err.body = {
          error: 'Zelle gesperrt' + (blockRows[0].reason ? `: ${blockRows[0].reason}` : ''),
          blocked: true,
          block_id: blockRows[0].id,
          reason: blockRows[0].reason
        };
        throw err;
      }
    } catch (e) {
      if (e.status === 409) throw e;
      // ScheduleBlock table may not exist yet — skip silently
    }

    const conflict = await checkShiftConflict(dbPool, data, cacheKey, getValidColumns, WORKPLACE_CACHE, WORKPLACE_CACHE_TTL);
    if (conflict) {
      console.warn(`[Sentinel] Blocked duplicate ShiftEntry: ${data.position} on ${data.date} (existing: ${conflict.id})`);
      const err = new Error('Position bereits besetzt');
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
      const [docRows] = await dbPool.execute(
        `SELECT work_time_model_id FROM Doctor WHERE id = ? LIMIT 1`,
        [data.doctor_id]
      );
      const modelId = docRows[0]?.work_time_model_id;

      if (modelId) {
        const [wpRows] = await dbPool.execute(
          `SELECT id FROM Workplace WHERE name = ? LIMIT 1`,
          [data.position]
        );
        const workplaceId = wpRows[0]?.id;

        if (workplaceId) {
          const [ruleRows] = await dbPool.execute(
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
      console.warn(`[AutoTime] Failed to calculate shift times: ${e.message}`);
    }
  }

  // Generic insert (tenant)
  const validColumns = await getValidColumns(dbPool, SHIFT_ENTRY_TABLE, cacheKey);
  let keys = Object.keys(data);
  if (validColumns && validColumns.length > 0) {
    keys = keys.filter((k) => validColumns.includes(k));
  }
  if (keys.length === 0) {
    const err = new Error(`No valid columns found for table ${SHIFT_ENTRY_TABLE}`);
    err.status = 500;
    throw err;
  }

  await insertRow(dbPool, SHIFT_ENTRY_TABLE, keys, data);
  return { result: data, central: false };
}

/**
 * Update a ShiftEntry by id. Encapsulates: central routing, central→tenant and
 * tenant→central transitions, and the generic update fallback.
 * @returns {Promise<{result: object, central: boolean}>}
 */
export async function updateShiftEntry({ dbPool, masterDb, req, id, data, cacheKey, getValidColumns }) {
  const centralRouting = await resolveCentralShiftRouting({ dbPool, masterDb, req, action: 'update', id });

  data.updated_date = new Date();

  if (req.db && centralRouting?.existing) {
    const nextDoctorId = data.doctor_id || centralRouting.existing.doctor_id;
    const nextDoctorLink = await loadDoctorLink(dbPool, nextDoctorId);
    const nextPosition = data.position || centralRouting.existing.position;
    const nextPayload = { ...centralRouting.existing, ...data, id, doctor_id: nextDoctorId };

    // tenant→central or central→central
    if (nextDoctorLink && isCentralAbsencePosition(nextPosition)) {
      if (centralRouting.mode !== 'central') {
        await dbPool.execute('DELETE FROM ShiftEntry WHERE id = ?', [id]);
      }
      const updated = await writeShiftEntryToCentralAbsence({
        tenantDb: dbPool,
        masterDb,
        tenantId: centralRouting.tenantId,
        shiftEntry: nextPayload,
        doctorId: nextDoctorLink.doctorId,
        preserveId: true,
      });
      return { result: updated, central: true };
    }

    // central→tenant transition
    if (centralRouting.mode === 'central') {
      await deleteCentralAbsenceById(masterDb, id);
      const localPayload = { ...nextPayload, doctor_id: nextDoctorId, id };
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
      return { result: row ? fromSqlRow(row) : null, central: false };
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
  return { result: row ? fromSqlRow(row) : null, central: false };
}

/**
 * Delete a ShiftEntry by id. Central-mode deletes from centralAbsences;
 * otherwise falls through to the tenant delete.
 * @returns {Promise<{central: boolean}>}
 */
export async function deleteShiftEntry({ dbPool, masterDb, req, id }) {
  if (req.db) {
    const centralRouting = await resolveCentralShiftRouting({ dbPool, masterDb, req, action: 'delete', id });
    if (centralRouting?.mode === 'central') {
      await deleteCentralAbsenceById(masterDb, id);
      return { central: true };
    }
  }

  // Tenant delete (caller handles audit + broadcast)
  const existing = await selectRow(dbPool, SHIFT_ENTRY_TABLE, id);
  const deletedRecord = existing ? fromSqlRow(existing) : null;
  await deleteRow(dbPool, SHIFT_ENTRY_TABLE, id);
  return { central: false, deletedRecord };
}
