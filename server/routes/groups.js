/**
 * Routes for cross-department pool scheduling (tenant_group).
 *
 * Lives in the master DB. See docs/features/TENANT_GROUPS.md for the
 * overall design.
 *
 * Permission model:
 *  - read access  → user.allowed_groups includes :groupId, OR user.role = 'admin'
 *  - write access → user.group_admin_groups includes :groupId, OR user.role = 'admin'
 *  - group CRUD (create/delete) → master admin only
 */
import express from 'express';
import crypto from 'crypto';
import { createPool } from 'mysql2/promise';
import { db } from '../index.js';
import { authMiddleware } from './auth.js';
import { requirePermission } from '../utils/permissions.js';
import { requirePermission } from '../utils/permissions.js';
import { parseDbToken } from '../utils/crypto.js';
import {
  loadUserGroupContext,
  listUserGroups,
  loadGroupTenantIds,
  requireGroupReadAccess,
  requireGroupWriteAccess,
  resolveTenantIdFromToken,
  loadVisibleGroupIdsForTenant,
  canWriteShiftInGroup,
} from '../utils/tenantGroups.js';
import { validateProposedShift } from '../utils/poolConstraints.js';
import {
  buildSharedShiftAutoFreiMarker,
  validateSharedShiftTenantRules,
} from '../utils/sharedShiftTenantRules.js';
import { getPublicHolidayDatesForYear } from './holidays.js';
import { ensureCentralAbsenceTables, isCentralAbsencePosition, loadLinkedDoctors } from '../utils/centralAbsences.js';
import {
  ensureCentralWishTables,
  CENTRAL_WISH_WRITABLE_COLUMNS,
} from '../utils/centralWishes.js';

const router = express.Router();

router.use(authMiddleware);

// All routes below require an authenticated user. They operate exclusively
// on the master DB, so we ignore any x-db-token header.

function handleError(res, error) {
  if (error && error.status) {
    return res.status(error.status).json({ error: error.message });
  }
  console.error('[groups]', error);
  return res.status(500).json({ error: 'Interner Fehler' });
}

function createHttpError(status, message, details) {
  const error = new Error(message);
  error.status = status;
  if (details !== undefined) {
    error.details = details;
  }
  return error;
}

/**
 * Prüft, ob der vorgeschlagene Mitarbeiter eine Beziehung mit aktiviertem
 * Dienstkonflikt zu einem anderen Mitarbeiter hat, der bereits am selben Tag
 * für denselben Pool-Dienst eingeteilt ist.
 *
 * @param {import('mysql2/promise').Pool} db - Master-DB-Pool
 * @param {object} params
 * @param {string} params.employeeId - Central employee ID des vorgeschlagenen Mitarbeiters
 * @param {string} params.dateStr - Datum als YYYY-MM-DD
 * @param {Array} params.existingSharedShiftsForWorkplace - Bestehende Pool-Dienste
 * @returns {Promise<Array<{rule: string, message: string}>>}
 */
async function checkRelationshipConflictsForPoolShift(db, { employeeId, dateStr, existingSharedShiftsForWorkplace }) {
  try {
    // Alle Beziehungen mit shift_conflict abfragen, die diesen Mitarbeiter betreffen
    const [relationships] = await db.execute(
      `SELECT er.*,
              e1.last_name AS emp1_last, e1.first_name AS emp1_first,
              e2.last_name AS emp2_last, e2.first_name AS emp2_first
         FROM EmployeeRelationship er
         JOIN Employee e1 ON er.employee_id = e1.id
         JOIN Employee e2 ON er.related_employee_id = e2.id
        WHERE er.shift_conflict = TRUE
          AND (er.employee_id = ? OR er.related_employee_id = ?)`,
      [employeeId, employeeId]
    );

    if (relationships.length === 0) return [];

    // Bidirektionale Map: employee_id → Set von related employee IDs
    const relatedIds = new Set();
    for (const rel of relationships) {
      if (String(rel.employee_id) === String(employeeId)) {
        relatedIds.add(String(rel.related_employee_id));
      }
      if (String(rel.related_employee_id) === String(employeeId)) {
        relatedIds.add(String(rel.employee_id));
      }
    }

    if (relatedIds.size === 0) return [];

    // Prüfen, ob einer der related employees bereits einen Pool-Dienst am selben Tag hat
    const blockers = [];
    const normalizedDate = String(dateStr).slice(0, 10);

    for (const existingShift of existingSharedShiftsForWorkplace) {
      const shiftDate = String(existingShift.date || '').slice(0, 10);
      if (shiftDate !== normalizedDate) continue;
      if (String(existingShift.employee_id) === String(employeeId)) continue; // Selbst ignorieren

      if (relatedIds.has(String(existingShift.employee_id))) {
        // Name des Partners ermitteln
        const rel = relationships.find(
          (r) => String(r.employee_id) === String(existingShift.employee_id)
             || String(r.related_employee_id) === String(existingShift.employee_id)
        );
        const partnerName = rel
          ? [rel.emp1_first, rel.emp1_last].filter(Boolean).join(' ')
          : existingShift.employee_name || 'Unbekannt';

        blockers.push({
          rule: 'employee_relationship_conflict',
          message: `Dienstkonflikt: „${partnerName}" hat eine Beziehung mit aktiviertem Dienstkonflikt und ist am selben Tag ebenfalls für diesen Pool-Dienst eingeteilt.`,
        });
      }
    }

    return blockers;
  } catch (error) {
    console.error('[groups] Relationship conflict check error:', error);
    return []; // Bei Fehler nicht blocken, nur loggen
  }
}

async function loadTenantTokenById(tenantId) {
  const [rows] = await db.execute('SELECT * FROM db_tokens WHERE id = ? LIMIT 1', [String(tenantId)]);
  return rows[0] || null;
}

async function withTenantDb(token, callback) {
  let pool = null;
  try {
    const config = parseDbToken(token.token);
    if (!config || !config.host || !config.database) {
      throw createHttpError(422, `Ungültige Mandanten-Konfiguration für ${token.name || token.id}`);
    }

    pool = createPool({
      host: config.host,
      port: parseInt(config.port || '3306', 10),
      user: config.user,
      password: config.password,
      database: config.database,
      ssl: config.ssl || undefined,
      waitForConnections: true,
      connectionLimit: 2,
      queueLimit: 0,
      dateStrings: true,
      timezone: '+00:00',
      connectTimeout: 10000,
    });

    return await callback(pool, token);
  } finally {
    if (pool) {
      await pool.end().catch(() => {});
    }
  }
}

async function loadTenantDoctorAssignment(employeeId, tenantId) {
  const [rows] = await db.execute(
    'SELECT tenant_doctor_id FROM EmployeeTenantAssignment WHERE employee_id = ? AND tenant_id = ? LIMIT 1',
    [String(employeeId), String(tenantId)]
  );
  return rows[0]?.tenant_doctor_id || null;
}

async function loadEligibleAbsences(masterDb, eligibleStaffRows) {
  try {
    await ensureCentralAbsenceTables(masterDb);
    const empIds = eligibleStaffRows.map(r => String(r.id)).filter(Boolean);
    if (empIds.length === 0) return {};
    const placeholders = empIds.map(() => '?').join(',');
    const [rows] = await masterDb.execute(
      `SELECT employee_id, date, position FROM CentralAbsenceEntry
        WHERE employee_id IN (${placeholders})
        ORDER BY employee_id, date`,
      empIds
    );
    const byEmp = {};
    for (const r of rows) {
      const pos = String(r.position || '').trim();
      if (!isCentralAbsencePosition(pos)) continue;
      const eid = String(r.employee_id);
      if (!byEmp[eid]) byEmp[eid] = [];
      byEmp[eid].push({
        date: String(r.date).slice(0, 10),
        position: pos,
      });
    }
    return byEmp;
  } catch (err) {
    console.error('[groups] loadEligibleAbsences error:', err.message);
    return {};
  }
}

async function loadHolidayDatesAround(dateStr) {
  const currentYear = Number(String(dateStr).slice(0, 4));
  const nextDate = new Date(`${dateStr}T00:00:00Z`);
  nextDate.setUTCDate(nextDate.getUTCDate() + 1);
  const nextYear = nextDate.getUTCFullYear();

  const dates = new Set(await getPublicHolidayDatesForYear(currentYear));
  if (nextYear !== currentYear) {
    const nextYearDates = await getPublicHolidayDatesForYear(nextYear);
    nextYearDates.forEach((date) => dates.add(date));
  }
  return dates;
}

async function loadTenantRuleContext({ employeeId, billingTenantId, dateStr }) {
  const tenantToken = await loadTenantTokenById(billingTenantId);
  if (!tenantToken) {
    throw createHttpError(422, 'Abrechnungsmandant nicht gefunden');
  }

  const tenantDoctorId = await loadTenantDoctorAssignment(employeeId, billingTenantId);
  if (!tenantDoctorId) {
    throw createHttpError(422, 'Mitarbeiter ist im Abrechnungsmandanten nicht verknüpft');
  }

  const holidayDates = await loadHolidayDatesAround(dateStr);
  const nextDate = new Date(`${dateStr}T00:00:00Z`);
  nextDate.setUTCDate(nextDate.getUTCDate() + 1);
  const nextDateStr = nextDate.toISOString().slice(0, 10);

  const tenantData = await withTenantDb(tenantToken, async (pool) => {
    const [shiftRows] = await pool.execute(
      `SELECT id, date, doctor_id, position, created_by
         FROM ShiftEntry
        WHERE doctor_id = ? AND date BETWEEN ? AND ?`,
      [String(tenantDoctorId), dateStr, nextDateStr]
    );

    const [workplaceRows] = await pool.execute(
      `SELECT name, category, affects_availability
         FROM Workplace`
    ).catch(() => [[[]]]);

    return {
      tenantShifts: Array.isArray(shiftRows) ? shiftRows : [],
      tenantWorkplaces: Array.isArray(workplaceRows) ? workplaceRows : [],
    };
  });

  return {
    tenantToken,
    tenantDoctorId,
    holidayDates,
    tenantShifts: tenantData.tenantShifts,
    tenantWorkplaces: tenantData.tenantWorkplaces,
  };
}

async function ensureTenantAutoFreiEntry({ shiftId, workplace, tenantToken, tenantDoctorId, autoFreiDate, tenantShifts }) {
  if (!workplace?.auto_off || !autoFreiDate) {
    return;
  }

  const existingNextDayShift = tenantShifts.find(
    (shift) => String(shift.doctor_id) === String(tenantDoctorId) && String(shift.date).slice(0, 10) === autoFreiDate
  );
  if (existingNextDayShift) {
    return;
  }

  const marker = buildSharedShiftAutoFreiMarker(shiftId);
  await withTenantDb(tenantToken, async (pool) => {
    await pool.execute(
      `INSERT INTO ShiftEntry (id, date, doctor_id, position, created_by)
       VALUES (?, ?, ?, ?, ?)`,
      [crypto.randomUUID(), autoFreiDate, String(tenantDoctorId), 'Frei', marker]
    );
  });
}

async function cleanupTenantAutoFreiEntry({ shiftId, tenantId }) {
  if (!tenantId) {
    return;
  }
  const tenantToken = await loadTenantTokenById(tenantId);
  if (!tenantToken) {
    return;
  }
  const marker = buildSharedShiftAutoFreiMarker(shiftId);
  await withTenantDb(tenantToken, async (pool) => {
    await pool.execute('DELETE FROM ShiftEntry WHERE created_by = ?', [marker]);
  });
}

async function loadCtx(req, res) {
  const ctx = await loadUserGroupContext(db, req.user.sub);
  if (!ctx) {
    res.status(401).json({ error: 'Benutzer nicht gefunden' });
    return null;
  }
  return ctx;
}

// ============ GROUPS ============

router.get('/', async (req, res) => {
  try {
    const ctx = await loadCtx(req, res);
    if (!ctx) return;
    const groups = await listUserGroups(db, ctx);
    res.json({ groups });
  } catch (err) {
    handleError(res, err);
  }
});

// ============ VISIBLE SHIFTS (read-only feed for department schedule) ============
// Returns all shared shift entries that should appear in the active tenant's
// schedule view. The active tenant is resolved from the x-db-token header.
// Every shift carries a `canWrite` flag derived from the user's group admin rights.
router.get('/visible-shifts', async (req, res) => {
  try {
    const ctx = await loadCtx(req, res);
    if (!ctx) return;

    const activeTenantId = await resolveTenantIdFromToken(db, req.headers['x-db-token']);
    if (!activeTenantId) {
      // No tenant context → nothing to show. This is not an error: pool view works
      // only when a tenant is active in the switcher.
      return res.json({ shifts: [], tenantId: null, groupIds: [] });
    }

    const accessibleGroupIds = await loadVisibleGroupIdsForTenant(db, ctx, activeTenantId);
    if (accessibleGroupIds.length === 0) {
      return res.json({ shifts: [], workplaces: [], tenantId: activeTenantId, groupIds: [] });
    }

    const { from, to } = req.query;
    const dateFilter = [];
    const dateParams = [];
    if (from) {
      dateFilter.push('s.date >= ?');
      dateParams.push(from);
    }
    if (to) {
      dateFilter.push('s.date <= ?');
      dateParams.push(to);
    }
    const dateWhere = dateFilter.length > 0 ? `AND ${dateFilter.join(' AND ')}` : '';

    const placeholders = accessibleGroupIds.map(() => '?').join(',');

    // Load all active workplaces in the accessible groups (independent of shift presence)
    const [workplaceRows] = await db.execute(
      `SELECT id, group_id, name, category, start_time, end_time, affects_availability,
              allows_rotation_concurrently, auto_off,
              min_staff, optimal_staff
         FROM shared_workplace
        WHERE group_id IN (${placeholders})
          AND is_active = 1
        ORDER BY name ASC`,
      accessibleGroupIds
    );
    const workplaces = workplaceRows.map((r) => ({
      id: r.id,
      group_id: Number(r.group_id),
      name: r.name,
      category: r.category,
      start_time: r.start_time,
      end_time: r.end_time,
      affects_availability: Boolean(r.affects_availability),
      allows_rotation_concurrently: Boolean(r.allows_rotation_concurrently),
      auto_off: Boolean(r.auto_off),
      min_staff: r.min_staff,
      optimal_staff: r.optimal_staff,
      canWrite: canWriteShiftInGroup(ctx, r.group_id),
    }));

    const [shiftRows] = await db.execute(
      `SELECT s.id,
              s.shared_workplace_id,
              s.date,
              s.employee_id,
              s.billing_tenant_id,
              s.start_time,
              s.end_time,
              s.note,
              w.group_id,
              w.name AS workplace_name,
              w.category AS workplace_category,
                w.allows_rotation_concurrently,
              w.affects_availability,
              w.auto_off,
              e.first_name,
                  e.last_name,
              eta.tenant_doctor_id AS local_doctor_id
         FROM shared_shift_entry s
         JOIN shared_workplace w ON w.id = s.shared_workplace_id
          LEFT JOIN Employee e
            ON e.id COLLATE utf8mb4_general_ci = s.employee_id COLLATE utf8mb4_general_ci
          LEFT JOIN EmployeeTenantAssignment eta
            ON eta.employee_id COLLATE utf8mb4_general_ci = s.employee_id COLLATE utf8mb4_general_ci
           AND eta.tenant_id = ?
        WHERE w.group_id IN (${placeholders})
          AND w.is_active = 1
          ${dateWhere}
        ORDER BY s.date ASC, w.name ASC`,
      [activeTenantId, ...accessibleGroupIds, ...dateParams]
    );

    const shifts = shiftRows.map((r) => {
      const employeeName = [r.first_name, r.last_name].filter(Boolean).join(' ')
        || `#${r.employee_id}`;
      return {
        id: r.id,
        shared_workplace_id: r.shared_workplace_id,
        group_id: Number(r.group_id),
        date: r.date,
        employee_id: r.employee_id,
        employee_name: employeeName,
        local_doctor_id: r.local_doctor_id != null ? Number(r.local_doctor_id) : null,
        billing_tenant_id: r.billing_tenant_id ? String(r.billing_tenant_id) : null,
        belongs_to_active_tenant: r.billing_tenant_id != null && String(r.billing_tenant_id) === activeTenantId,
        workplace_name: r.workplace_name,
        workplace_category: r.workplace_category,
        allows_rotation_concurrently: Boolean(r.allows_rotation_concurrently),
        affects_availability: Boolean(r.affects_availability),
        auto_off: Boolean(r.auto_off),
        start_time: r.start_time,
        end_time: r.end_time,
        note: r.note,
        canWrite: canWriteShiftInGroup(ctx, r.group_id),
      };
    });

    res.json({
      shifts,
      workplaces,
      tenantId: activeTenantId,
      groupIds: accessibleGroupIds,
    });
  } catch (err) {
    handleError(res, err);
  }
});

// ============ CENTRAL ABSENCES FOR VISIBLE GROUPS ============
// Returns CentralAbsenceEntry rows for every employee assigned to any
// tenant of the user's accessible groups, within the given date range.
// Used by the frontend to build a cross-tenant absence filter in the
// pool shift dialog — absences from all group tenants are included,
// not just the active tenant's.
router.get('/central-absences', async (req, res) => {
  console.log('🔥🔥🔥 [central-absences] CALLED by ' + req.user?.sub + ' url=' + req.originalUrl);
  try {
    const ctx = await loadCtx(req, res);
    if (!ctx) return;

    const activeTenantId = await resolveTenantIdFromToken(db, req.headers['x-db-token']);
    if (!activeTenantId) {
      console.log('[central-absences] NO ACTIVE TENANT');
      return res.json({ absences: [] });
    }

    const accessibleGroupIds = await loadVisibleGroupIdsForTenant(db, ctx, activeTenantId);
    if (accessibleGroupIds.length === 0) {
      console.log('[central-absences] NO ACCESSIBLE GROUPS for tenant ' + activeTenantId);
      return res.json({ absences: [] });
    }
    console.log('[central-absences] accessibleGroupIds=' + JSON.stringify(accessibleGroupIds) + ' tenant=' + activeTenantId);

    // Ensure the CentralAbsenceEntry table exists (safety net for fresh deploys)
    try {
      await ensureCentralAbsenceTables(db);
      console.log('[central-absences] table CentralAbsenceEntry ensured');
    } catch (tableErr) {
      console.error('[central-absences] ensureCentralAbsenceTables ERROR:', tableErr.message);
    }

    const { from, to } = req.query;

    // 1) Count total in CentralAbsenceEntry — to know if table has ANY data
    let totalCount = -1;
    try {
      const [cnt] = await db.execute('SELECT COUNT(*) AS c FROM CentralAbsenceEntry');
      totalCount = cnt[0]?.c ?? -1;
      console.log('[central-absences] total entries in CentralAbsenceEntry: ' + totalCount);
    } catch (cntErr) {
      console.error('[central-absences] COUNT query failed:', cntErr.message);
    }

    // 2) Alle tenant_ids der zugänglichen Gruppen sammeln
    const allTenantIds = new Set();
    for (const gid of accessibleGroupIds) {
      const ids = await loadGroupTenantIds(db, gid);
      for (const tid of ids) allTenantIds.add(tid);
    }
    const tenantIds = [...allTenantIds];
    console.log('[central-absences] tenantIds count=' + tenantIds.length);

    if (tenantIds.length === 0) {
      console.log('[central-absences] NO TENANTS IN GROUPS');
      return res.json({ absences: [] });
    }

    // 3) Alle EmployeeTenantAssignment-Einträge für diese Tenants laden
    const placeholders = tenantIds.map(() => '?').join(',');
    const [etaRows] = await db.execute(
      `SELECT DISTINCT employee_id FROM EmployeeTenantAssignment WHERE tenant_id IN (${placeholders}) AND employee_id IS NOT NULL`,
      tenantIds
    );
    const groupEmployeeIds = new Set(etaRows.map(r => String(r.employee_id)));
    console.log('[central-absences] groupEmployeeIds from ETA: ' + groupEmployeeIds.size);

    // 3b) Fallback: auch in den Tenant-Doctor-Tabellen nach central_employee_id suchen,
    //     falls EmployeeTenantAssignment nicht alle Verknüpfungen enthält
    let tenantDoctorCount = 0;
    for (const tid of tenantIds) {
      try {
        const token = await loadTenantTokenById(tid);
        if (!token) continue;
        const config = parseDbToken(token.token);
        if (!config || !config.host || !config.database) continue;

        let pool = null;
        try {
          pool = createPool({
            host: config.host,
            port: parseInt(config.port || '3306', 10),
            user: config.user,
            password: config.password,
            database: config.database,
            ssl: config.ssl || undefined,
            waitForConnections: true,
            connectionLimit: 1,
            queueLimit: 0,
            dateStrings: true,
            timezone: '+00:00',
            connectTimeout: 5000,
          });
          const linked = await loadLinkedDoctors(pool);
          for (const doc of linked) {
            if (!groupEmployeeIds.has(doc.employee_id)) {
              groupEmployeeIds.add(doc.employee_id);
              tenantDoctorCount++;
            }
          }
        } finally {
          if (pool) await pool.end();
        }
      } catch (err) {
        console.error('[central-absences] Error scanning tenant ' + tid + ' Doctor table:', err.message);
      }
    }
    console.log('[central-absences] added ' + tenantDoctorCount + ' employee_ids from tenant Doctor tables, total unique=' + groupEmployeeIds.size);

    const allEmployeeIds = [...groupEmployeeIds];

    // Find specific employee 2f7d3d63-48d8-4f25-9ec4-af973800fc50
    const targetId = '2f7d3d63-48d8-4f25-9ec4-af973800fc50';
    const hasTarget = allEmployeeIds.some(id => id === targetId);
    console.log('[central-absences] target employee ' + targetId + ' in combined set: ' + hasTarget);

    if (allEmployeeIds.length === 0) {
      console.log('[central-absences] NO EMPLOYEES IN GROUP TENANTS');
      return res.json({ absences: [] });
    }

    // 4) CentralAbsenceEntry für diese employee_ids abfragen
    const empPlaceholders = allEmployeeIds.map(() => '?').join(',');
    let sql = `SELECT employee_id, date, position FROM CentralAbsenceEntry WHERE employee_id IN (${empPlaceholders})`;
    const sqlParams = [...allEmployeeIds];

    if (from) { sql += ' AND date >= ?'; sqlParams.push(from); }
    if (to) { sql += ' AND date <= ?'; sqlParams.push(to); }
    sql += ' ORDER BY employee_id, date ASC';

    let rows = [];
    try {
      [rows] = await db.execute(sql, sqlParams);
    } catch (err) {
      console.error('[central-absences] QUERY FAILED: ' + err.message + ' code=' + err.code);
    }

    // Check if target employee has absences in result
    const targetRows = rows.filter(r => String(r.employee_id) === targetId);
    console.log('[central-absences] target employee absences found: ' + targetRows.length);

    const absences = rows.map((r) => ({
      employee_id: String(r.employee_id),
      date: typeof r.date === 'string' ? r.date.slice(0, 10) : String(r.date).slice(0, 10),
      position: String(r.position || '').trim(),
    }));

    // Log summary
    const uniqueEmployees = new Set(absences.map(a => a.employee_id));
    console.log('[central-absences] DONE — ' + absences.length + ' absences for ' + uniqueEmployees.size + ' employees');

    res.json({ absences });
  } catch (err) {
    console.error('[central-absences] UNCAUGHT ERROR:', err.message, err.stack);
    handleError(res, err);
  }
});

// ============ CENTRAL WISHES (cross-tenant Dienstwünsche for Verbundsdienste) ============
//
// IMPORTANT: These routes MUST be registered BEFORE the generic /:groupId
// routes below. Express matches in registration order, and /:groupId would
// otherwise swallow /central-wishes (groupId="central-wishes" → 404).
//
// Mirrors the central-absences pattern: wishes for shared_workplaces are
// stored in the master DB so they follow the employee across tenants.
// Reads are scoped to the user's accessible groups; writes additionally
// require write access to the group that owns the target shared_workplace.

// Helper: confirm the caller has write access to the group that owns the
// given shared_workplace_id, and return the group_id. Throws 403/404 on
// failure. Used by POST/PATCH/DELETE below.
async function requireWriteAccessByWorkplace(ctx, sharedWorkplaceId) {
  const [rows] = await db.execute(
    'SELECT id, group_id FROM shared_workplace WHERE id = ? LIMIT 1',
    [String(sharedWorkplaceId)]
  );
  if (rows.length === 0) {
    throw createHttpError(404, 'Verbundsdienst nicht gefunden');
  }
  const groupId = Number(rows[0].group_id);
  requireGroupWriteAccess(ctx, groupId);
  return groupId;
}

// Helper: confirm the employee_id is linked to one of the group's tenants,
// so a caller cannot create wishes for arbitrary employees.
async function assertEmployeeBelongsToGroupGroup(employeeId, groupId) {
  const tenantIds = await loadGroupTenantIds(db, groupId);
  if (tenantIds.length === 0) {
    throw createHttpError(422, 'Verbund hat keine Mandanten');
  }
  const placeholders = tenantIds.map(() => '?').join(',');
  const [etaRows] = await db.execute(
    `SELECT 1 FROM EmployeeTenantAssignment
      WHERE employee_id = ?
        AND tenant_id IN (${placeholders})
      LIMIT 1`,
    [String(employeeId), ...tenantIds]
  );
  if (etaRows.length === 0) {
    // Fallback: Doctor.central_employee_id link
    let linked = false;
    for (const tid of tenantIds) {
      try {
        const token = await loadTenantTokenById(tid);
        if (!token) continue;
        const config = parseDbToken(token.token);
        if (!config || !config.host || !config.database) continue;
        let pool = null;
        try {
          pool = createPool({
            host: config.host,
            port: parseInt(config.port || '3306', 10),
            user: config.user,
            password: config.password,
            database: config.database,
            ssl: config.ssl || undefined,
            waitForConnections: true,
            connectionLimit: 1,
            queueLimit: 0,
            dateStrings: true,
            timezone: '+00:00',
            connectTimeout: 5000,
          });
          const linkedDoctors = await loadLinkedDoctors(pool);
          if (linkedDoctors.some((d) => String(d.employee_id) === String(employeeId))) {
            linked = true;
            break;
          }
        } finally {
          if (pool) await pool.end().catch(() => {});
        }
      } catch (err) {
        console.error('[central-wishes] assertEmployee scan tenant ' + tid + ':', err.message);
      }
    }
    if (!linked) {
      throw createHttpError(403, 'Mitarbeiter ist keinem Mandanten dieser Gruppe zugeordnet');
    }
  }
}

// GET /central-wishes?from=&to=
// Returns wishes for all employees in the user's accessible groups within
// the optional date range. Shape mirrors /central-absences but richer.
router.get('/central-wishes', async (req, res) => {
  try {
    const ctx = await loadCtx(req, res);
    if (!ctx) return;

    const activeTenantId = await resolveTenantIdFromToken(db, req.headers['x-db-token']);
    if (!activeTenantId) return res.json({ wishes: [] });

    const accessibleGroupIds = await loadVisibleGroupIdsForTenant(db, ctx, activeTenantId);
    if (accessibleGroupIds.length === 0) return res.json({ wishes: [] });

    try {
      await ensureCentralWishTables(db);
    } catch (tableErr) {
      console.error('[central-wishes] ensureCentralWishTables ERROR:', tableErr.message);
    }

    const { from, to } = req.query;

    // 1) Collect tenant_ids of all accessible groups
    const allTenantIds = new Set();
    for (const gid of accessibleGroupIds) {
      const ids = await loadGroupTenantIds(db, gid);
      for (const tid of ids) allTenantIds.add(tid);
    }
    const tenantIds = [...allTenantIds];
    if (tenantIds.length === 0) return res.json({ wishes: [] });

    // 2) Collect employee_ids (ETA rows + Doctor.central_employee_id fallback)
    const placeholders = tenantIds.map(() => '?').join(',');
    const [etaRows] = await db.execute(
      `SELECT DISTINCT employee_id FROM EmployeeTenantAssignment
        WHERE tenant_id IN (${placeholders}) AND employee_id IS NOT NULL`,
      tenantIds
    );
    const groupEmployeeIds = new Set(etaRows.map((r) => String(r.employee_id)));

    for (const tid of tenantIds) {
      try {
        const token = await loadTenantTokenById(tid);
        if (!token) continue;
        const config = parseDbToken(token.token);
        if (!config || !config.host || !config.database) continue;
        let pool = null;
        try {
          pool = createPool({
            host: config.host,
            port: parseInt(config.port || '3306', 10),
            user: config.user,
            password: config.password,
            database: config.database,
            ssl: config.ssl || undefined,
            waitForConnections: true,
            connectionLimit: 1,
            queueLimit: 0,
            dateStrings: true,
            timezone: '+00:00',
            connectTimeout: 5000,
          });
          const linked = await loadLinkedDoctors(pool);
          for (const doc of linked) {
            groupEmployeeIds.add(String(doc.employee_id));
          }
        } finally {
          if (pool) await pool.end().catch(() => {});
        }
      } catch (err) {
        console.error('[central-wishes] Error scanning tenant ' + tid + ' Doctor table:', err.message);
      }
    }

    const allEmployeeIds = [...groupEmployeeIds];
    if (allEmployeeIds.length === 0) return res.json({ wishes: [] });

    // 3) Load CentralWishRequest rows for these employees
    const empPlaceholders = allEmployeeIds.map(() => '?').join(',');
    let sql = `SELECT id, employee_id, shared_workplace_id, group_id, date,
                      target_month, start_date, end_date, range_start, range_end,
                      \`position\`, type, status, priority, reason, admin_comment,
                      comment, user_viewed, approved_by, approved_date,
                      source_tenant_id, source_tenant_doctor_id
                 FROM CentralWishRequest
                WHERE employee_id IN (${empPlaceholders})`;
    const sqlParams = [...allEmployeeIds];
    if (from) { sql += ' AND date >= ?'; sqlParams.push(from); }
    if (to) { sql += ' AND date <= ?'; sqlParams.push(to); }
    sql += ' ORDER BY employee_id, date ASC';

    let rows = [];
    try {
      [rows] = await db.execute(sql, sqlParams);
    } catch (err) {
      console.error('[central-wishes] QUERY FAILED: ' + err.message + ' code=' + err.code);
    }

    const toDateString = (value) => {
      if (!value) return null;
      if (typeof value === 'string') return value.slice(0, 10);
      if (value instanceof Date) return value.toISOString().slice(0, 10);
      return String(value).slice(0, 10);
    };

    const wishes = rows.map((r) => ({
      id: String(r.id),
      employee_id: String(r.employee_id),
      shared_workplace_id: r.shared_workplace_id ? String(r.shared_workplace_id) : null,
      group_id: r.group_id != null ? Number(r.group_id) : null,
      date: toDateString(r.date),
      target_month: r.target_month || null,
      start_date: toDateString(r.start_date),
      end_date: toDateString(r.end_date),
      range_start: toDateString(r.range_start),
      range_end: toDateString(r.range_end),
      position: r.position || null,
      type: r.type || 'service',
      status: r.status || 'pending',
      priority: r.priority || 'medium',
      reason: r.reason || null,
      admin_comment: r.admin_comment || null,
      comment: r.comment || null,
      user_viewed: !!r.user_viewed,
      approved_by: r.approved_by || null,
      approved_date: r.approved_date || null,
      source_tenant_id: r.source_tenant_id ? String(r.source_tenant_id) : null,
      source_tenant_doctor_id: r.source_tenant_doctor_id != null ? String(r.source_tenant_doctor_id) : null,
    }));

    res.json({ wishes });
  } catch (err) {
    console.error('[central-wishes] UNCAUGHT ERROR:', err.message, err.stack);
    handleError(res, err);
  }
});

// POST /central-wishes
// Create a new cross-tenant wish. Body must include employee_id, date, type,
// and shared_workplace_id (or null for a global no_service wish).
router.post('/central-wishes', async (req, res) => {
  try {
    const ctx = await loadCtx(req, res);
    if (!ctx) return;

    const body = req.body || {};
    const { employee_id, date, shared_workplace_id } = body;

    if (!employee_id || typeof employee_id !== 'string') {
      return res.status(400).json({ error: 'employee_id ist erforderlich' });
    }
    if (!date || typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'date (YYYY-MM-DD) ist erforderlich' });
    }
    if (!['service', 'no_service'].includes(body.type)) {
      return res.status(400).json({ error: "type muss 'service' oder 'no_service' sein" });
    }
    if (!shared_workplace_id && body.type === 'service') {
      return res.status(400).json({ error: 'shared_workplace_id ist fuer Dienstwuensche erforderlich' });
    }

    await ensureCentralWishTables(db);

    const groupId = shared_workplace_id
      ? await requireWriteAccessByWorkplace(ctx, shared_workplace_id)
      : null;

    // If the wish targets a specific workplace, ensure the employee belongs to
    // that group. For global no_service wishes (shared_workplace_id = null) we
    // cannot resolve a single group, so we accept any employee id; the caller
    // is an authenticated tenant admin and the read endpoint filters by
    // accessible groups anyway.
    if (shared_workplace_id) {
      await assertEmployeeBelongsToGroupGroup(employee_id, groupId);
    }

    // Build the row from a strict whitelist only.
    const id = crypto.randomUUID();
    const row = { id, group_id: groupId };
    for (const key of CENTRAL_WISH_WRITABLE_COLUMNS) {
      if (key === 'group_id' || key === 'created_by') continue;
      if (body[key] !== undefined) row[key] = body[key];
    }
    // Force integrity-critical fields from the validated path.
    row.employee_id = String(employee_id);
    row.date = date;
    if (shared_workplace_id) row.shared_workplace_id = String(shared_workplace_id);

    // Defaults — only set when missing so callers can override.
    if (row.type === undefined) row.type = 'service';
    if (row.status === undefined) row.status = 'pending';
    if (row.priority === undefined) row.priority = 'medium';
    if (row.user_viewed === undefined) row.user_viewed = 0;
    row.created_by = req.user?.sub || null;

    // source_tenant_id: stamp with the caller's active tenant so we can trace
    // where a wish originated, mirroring CentralAbsenceEntry usage.
    if (!row.source_tenant_id) {
      const activeTenantId = await resolveTenantIdFromToken(db, req.headers['x-db-token']);
      if (activeTenantId) row.source_tenant_id = String(activeTenantId);
    }

    const columns = Object.keys(row);
    const values = columns.map((k) => row[k]);
    const colList = columns.map((c) => (c === 'position' ? '`position`' : c)).join(', ');
    const placeholders = columns.map(() => '?').join(', ');

    try {
      await db.execute(
        `INSERT INTO CentralWishRequest (${colList}) VALUES (${placeholders})`,
        values
      );
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') {
        return res.status(409).json({
          error: 'Für diesen Mitarbeiter und Verbundsdienst existiert an diesem Datum bereits ein Wunsch',
        });
      }
      throw err;
    }

    const [rows] = await db.execute(
      'SELECT * FROM CentralWishRequest WHERE id = ? LIMIT 1',
      [id]
    );
    res.status(201).json({ wish: rows[0] });
  } catch (err) {
    handleError(res, err);
  }
});

// PATCH /central-wishes/:id
// Update an existing wish. Only whitelisted columns from the body are applied.
router.patch('/central-wishes/:id', async (req, res) => {
  try {
    const ctx = await loadCtx(req, res);
    if (!ctx) return;

    await ensureCentralWishTables(db);

    const [existing] = await db.execute(
      'SELECT id, shared_workplace_id, group_id, employee_id FROM CentralWishRequest WHERE id = ? LIMIT 1',
      [String(req.params.id)]
    );
    if (existing.length === 0) {
      return res.status(404).json({ error: 'Wunsch nicht gefunden' });
    }
    const current = existing[0];

    // Resolve write access: target workplace if present, else the stored group.
    const wpId = current.shared_workplace_id || req.body?.shared_workplace_id;
    if (wpId) {
      await requireWriteAccessByWorkplace(ctx, wpId);
    } else if (current.group_id != null) {
      requireGroupWriteAccess(ctx, Number(current.group_id));
    } else {
      // Without a workplace anchor we cannot prove group ownership; refuse.
      return res.status(403).json({ error: 'Wunsch ohne Workplace-Zuordnung kann nicht aktualisiert werden' });
    }

    const body = req.body || {};
    const fields = [];
    const values = [];
    for (const key of CENTRAL_WISH_WRITABLE_COLUMNS) {
      if (body[key] === undefined) continue;
      if (key === 'employee_id') continue; // immutable on update
      fields.push(`${key === 'position' ? '`position`' : key} = ?`);
      values.push(body[key]);
    }
    if (fields.length === 0) {
      return res.status(400).json({ error: 'Keine änderbaren Felder übergeben' });
    }

    // If shared_workplace_id is being changed, re-validate ownership + employee.
    if (body.shared_workplace_id !== undefined && body.shared_workplace_id !== current.shared_workplace_id) {
      const newGroupId = await requireWriteAccessByWorkplace(ctx, body.shared_workplace_id);
      await assertEmployeeBelongsToGroupGroup(current.employee_id, newGroupId);
    }

    values.push(String(req.params.id));
    await db.execute(
      `UPDATE CentralWishRequest SET ${fields.join(', ')} WHERE id = ?`,
      values
    );

    const [rows] = await db.execute(
      'SELECT * FROM CentralWishRequest WHERE id = ? LIMIT 1',
      [String(req.params.id)]
    );
    res.json({ wish: rows[0] });
  } catch (err) {
    handleError(res, err);
  }
});

// DELETE /central-wishes/:id
router.delete('/central-wishes/:id', async (req, res) => {
  try {
    const ctx = await loadCtx(req, res);
    if (!ctx) return;

    await ensureCentralWishTables(db);

    const [existing] = await db.execute(
      'SELECT id, shared_workplace_id, group_id FROM CentralWishRequest WHERE id = ? LIMIT 1',
      [String(req.params.id)]
    );
    if (existing.length === 0) {
      return res.status(404).json({ error: 'Wunsch nicht gefunden' });
    }
    const current = existing[0];

    const wpId = current.shared_workplace_id;
    if (wpId) {
      await requireWriteAccessByWorkplace(ctx, wpId);
    } else if (current.group_id != null) {
      requireGroupWriteAccess(ctx, Number(current.group_id));
    } else {
      return res.status(403).json({ error: 'Wunsch ohne Workplace-Zuordnung kann nicht gelöscht werden' });
    }

    await db.execute('DELETE FROM CentralWishRequest WHERE id = ?', [String(req.params.id)]);
    res.status(204).end();
  } catch (err) {
    handleError(res, err);
  }
});

router.get('/:groupId', async (req, res) => {
  try {
    const ctx = await loadCtx(req, res);
    if (!ctx) return;
    const group = await requireGroupReadAccess(db, ctx, req.params.groupId);
    res.json({ group });
  } catch (err) {
    handleError(res, err);
  }
});

router.post('/', requirePermission('can_manage_groups'), async (req, res) => {
  try {
    const { name, description } = req.body || {};
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return res.status(400).json({ error: 'Name ist erforderlich' });
    }
    const [result] = await db.execute(
      'INSERT INTO tenant_group (name, description) VALUES (?, ?)',
      [name.trim(), description || null]
    );
    const [rows] = await db.execute('SELECT id, name, description, is_active FROM tenant_group WHERE id = ?', [result.insertId]);
    res.status(201).json({ group: rows[0] });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'Verbund mit diesem Namen existiert bereits' });
    }
    handleError(res, err);
  }
});

router.patch('/:groupId', requirePermission('can_manage_groups'), async (req, res) => {
  try {
    const { name, description, is_active } = req.body || {};
    const fields = [];
    const values = [];
    if (typeof name === 'string' && name.trim().length > 0) {
      fields.push('name = ?');
      values.push(name.trim());
    }
    if (description !== undefined) {
      fields.push('description = ?');
      values.push(description || null);
    }
    if (typeof is_active === 'boolean') {
      fields.push('is_active = ?');
      values.push(is_active ? 1 : 0);
    }
    if (fields.length === 0) {
      return res.status(400).json({ error: 'Keine Änderungen' });
    }
    values.push(Number(req.params.groupId));
    await db.execute(`UPDATE tenant_group SET ${fields.join(', ')} WHERE id = ?`, values);
    const [rows] = await db.execute('SELECT id, name, description, is_active FROM tenant_group WHERE id = ?', [req.params.groupId]);
    if (rows.length === 0) return res.status(404).json({ error: 'Verbund nicht gefunden' });
    res.json({ group: rows[0] });
  } catch (err) {
    handleError(res, err);
  }
});

router.delete('/:groupId', requirePermission('can_manage_groups'), async (req, res) => {
  try {
    await db.execute('DELETE FROM tenant_group WHERE id = ?', [req.params.groupId]);
    res.status(204).end();
  } catch (err) {
    handleError(res, err);
  }
});

// ============ MEMBERS ============

router.get('/:groupId/members', async (req, res) => {
  try {
    const ctx = await loadCtx(req, res);
    if (!ctx) return;
    await requireGroupReadAccess(db, ctx, req.params.groupId);
    const [rows] = await db.execute(
      `SELECT m.tenant_id, m.role, t.name, t.host, t.db_name
         FROM tenant_group_member m
         JOIN db_tokens t ON t.id = m.tenant_id
        WHERE m.group_id = ?
        ORDER BY t.name ASC`,
      [req.params.groupId]
    );
    res.json({ members: rows });
  } catch (err) {
    handleError(res, err);
  }
});

router.post('/:groupId/members', requirePermission('can_manage_groups'), async (req, res) => {
  try {
    const { tenant_id, role } = req.body || {};
    if (!tenant_id) return res.status(400).json({ error: 'tenant_id ist erforderlich' });
    const tenantRole = role === 'observer' ? 'observer' : 'member';
    await db.execute(
      'INSERT IGNORE INTO tenant_group_member (group_id, tenant_id, role) VALUES (?, ?, ?)',
      [req.params.groupId, tenant_id, tenantRole]
    );
    res.status(201).json({ success: true });
  } catch (err) {
    handleError(res, err);
  }
});

router.delete('/:groupId/members/:tenantId', requirePermission('can_manage_groups'), async (req, res) => {
  try {
    await db.execute(
      'DELETE FROM tenant_group_member WHERE group_id = ? AND tenant_id = ?',
      [req.params.groupId, req.params.tenantId]
    );
    res.status(204).end();
  } catch (err) {
    handleError(res, err);
  }
});

// ============ WORKPLACES ============

router.get('/:groupId/workplaces', async (req, res) => {
  try {
    const ctx = await loadCtx(req, res);
    if (!ctx) return;
    await requireGroupReadAccess(db, ctx, req.params.groupId);
    const [rows] = await db.execute(
      `SELECT id, name, category, start_time, end_time, active_days,
              allows_multiple, min_staff, optimal_staff, default_overlap_tolerance_minutes,
              work_time_percentage, service_type, auto_off, allows_rotation_concurrently,
              affects_availability, allows_absence_overlap, timeslots_enabled,
              consecutive_days_mode, constraints_json, is_active
         FROM shared_workplace
        WHERE group_id = ?
        ORDER BY name ASC`,
      [req.params.groupId]
    );
    res.json({
      workplaces: rows.map((row) => ({
        ...row,
        allows_multiple: row.allows_multiple == null ? null : Boolean(row.allows_multiple),
        auto_off: Boolean(row.auto_off),
        allows_rotation_concurrently: Boolean(row.allows_rotation_concurrently),
        affects_availability: Boolean(row.affects_availability),
        allows_absence_overlap: Boolean(row.allows_absence_overlap),
        timeslots_enabled: Boolean(row.timeslots_enabled),
        is_active: Boolean(row.is_active),
        active_days: typeof row.active_days === 'string'
          ? (() => {
              try {
                return JSON.parse(row.active_days);
              } catch {
                return null;
              }
            })()
          : row.active_days,
      })),
    });
  } catch (err) {
    handleError(res, err);
  }
});

router.post('/:groupId/workplaces', async (req, res) => {
  try {
    const ctx = await loadCtx(req, res);
    if (!ctx) return;
    requireGroupWriteAccess(ctx, req.params.groupId);
    const {
      name, start_time, end_time,
      active_days, allows_multiple, min_staff, optimal_staff, default_overlap_tolerance_minutes,
      work_time_percentage, service_type, auto_off, allows_rotation_concurrently,
      affects_availability, allows_absence_overlap, timeslots_enabled,
      consecutive_days_mode, constraints_json,
    } = req.body || {};
    if (!name) return res.status(400).json({ error: 'name ist erforderlich' });
    const id = crypto.randomUUID();
    await db.execute(
      `INSERT INTO shared_workplace
         (id, group_id, name, category, start_time, end_time, active_days, allows_multiple,
          min_staff, optimal_staff, default_overlap_tolerance_minutes, work_time_percentage,
          service_type, auto_off, allows_rotation_concurrently, affects_availability,
          allows_absence_overlap, timeslots_enabled, consecutive_days_mode, constraints_json, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id, Number(req.params.groupId), name, 'Dienste',
        start_time || null, end_time || null,
        Array.isArray(active_days) ? JSON.stringify(active_days) : null,
        typeof allows_multiple === 'boolean' ? (allows_multiple ? 1 : 0) : 0,
        Number.isInteger(min_staff) ? min_staff : 1,
        Number.isInteger(optimal_staff) ? optimal_staff : 1,
        Number.isInteger(default_overlap_tolerance_minutes) ? default_overlap_tolerance_minutes : 15,
        typeof work_time_percentage === 'number' ? work_time_percentage : 100,
        Number.isInteger(service_type) ? service_type : null,
        auto_off ? 1 : 0,
        allows_rotation_concurrently ? 1 : 0,
        affects_availability === false ? 0 : 1,
        allows_absence_overlap ? 1 : 0,
        timeslots_enabled ? 1 : 0,
        consecutive_days_mode || 'allowed',
        constraints_json ? JSON.stringify(constraints_json) : null,
        req.user.email || req.user.sub,
      ]
    );
    res.status(201).json({ id });
  } catch (err) {
    handleError(res, err);
  }
});

router.patch('/:groupId/workplaces/:workplaceId', async (req, res) => {
  try {
    const ctx = await loadCtx(req, res);
    if (!ctx) return;
    requireGroupWriteAccess(ctx, req.params.groupId);
    const allowed = ['name', 'start_time', 'end_time',
      'active_days', 'allows_multiple', 'min_staff', 'optimal_staff', 'default_overlap_tolerance_minutes',
      'work_time_percentage', 'service_type', 'auto_off', 'allows_rotation_concurrently',
      'affects_availability', 'allows_absence_overlap', 'timeslots_enabled',
      'consecutive_days_mode', 'constraints_json', 'is_active'];
    const fields = [];
    const values = [];
    for (const key of allowed) {
      if (req.body[key] === undefined) continue;
      let val = req.body[key];
      if (key === 'active_days' && Array.isArray(val)) {
        val = JSON.stringify(val);
      }
      if (key === 'constraints_json' && val && typeof val !== 'string') {
        val = JSON.stringify(val);
      }
      if (['allows_multiple', 'auto_off', 'allows_rotation_concurrently', 'affects_availability', 'allows_absence_overlap', 'timeslots_enabled', 'is_active'].includes(key)) {
        val = val ? 1 : 0;
      }
      fields.push(`${key} = ?`);
      values.push(val);
    }
    if (fields.length === 0) return res.status(400).json({ error: 'Keine Änderungen' });
    values.push(req.params.workplaceId, Number(req.params.groupId));
    await db.execute(
      `UPDATE shared_workplace SET ${fields.join(', ')} WHERE id = ? AND group_id = ?`,
      values
    );
    res.json({ success: true });
  } catch (err) {
    handleError(res, err);
  }
});

router.delete('/:groupId/workplaces/:workplaceId', async (req, res) => {
  try {
    const ctx = await loadCtx(req, res);
    if (!ctx) return;
    requireGroupWriteAccess(ctx, req.params.groupId);
    await db.execute(
      'DELETE FROM shared_workplace WHERE id = ? AND group_id = ?',
      [req.params.workplaceId, req.params.groupId]
    );
    res.status(204).end();
  } catch (err) {
    handleError(res, err);
  }
});

// ============ REQUIRED QUALIFICATIONS PER SHARED WORKPLACE ============
// Stored as plain qualification names (cross-tenant taxonomy by name).
// A central employee is "eligible" for a workplace when, in any of his/her
// tenants of the group, the union of Qualification.name held via
// DoctorQualification contains every required name (and none of the excluded).

router.get('/:groupId/workplaces/:workplaceId/qualifications', async (req, res) => {
  try {
    const ctx = await loadCtx(req, res);
    if (!ctx) return;
    await requireGroupReadAccess(db, ctx, req.params.groupId);
    const [rows] = await db.execute(
      `SELECT id, qualification_name, is_excluded
         FROM shared_workplace_qualification
        WHERE shared_workplace_id = ?
        ORDER BY qualification_name ASC`,
      [req.params.workplaceId]
    );
    res.json({
      qualifications: rows.map((r) => ({
        id: r.id,
        qualification_name: r.qualification_name,
        is_excluded: !!r.is_excluded,
      })),
    });
  } catch (err) {
    handleError(res, err);
  }
});

router.put('/:groupId/workplaces/:workplaceId/qualifications', async (req, res) => {
  try {
    const ctx = await loadCtx(req, res);
    if (!ctx) return;
    requireGroupWriteAccess(ctx, req.params.groupId);
    const list = Array.isArray(req.body?.qualifications) ? req.body.qualifications : [];
    const cleaned = list
      .map((item) => ({
        name: String(item?.qualification_name || item?.name || '').trim(),
        excluded: !!(item?.is_excluded ?? item?.excluded),
      }))
      .filter((item) => item.name.length > 0 && item.name.length <= 255);

    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();
      await conn.execute(
        'DELETE FROM shared_workplace_qualification WHERE shared_workplace_id = ?',
        [req.params.workplaceId]
      );
      for (const item of cleaned) {
        await conn.execute(
          `INSERT IGNORE INTO shared_workplace_qualification
             (shared_workplace_id, qualification_name, is_excluded)
           VALUES (?, ?, ?)`,
          [req.params.workplaceId, item.name, item.excluded ? 1 : 0]
        );
      }
      await conn.commit();
    } catch (err) {
      await conn.rollback().catch(() => {});
      throw err;
    } finally {
      conn.release();
    }
    res.status(204).end();
  } catch (err) {
    handleError(res, err);
  }
});

// Distinct qualification names found in any tenant of the group.
// Used by the admin form as a picker so the operator does not need to type
// names by hand. Order: alphabetical.
router.get('/:groupId/qualifications', async (req, res) => {
  try {
    const ctx = await loadCtx(req, res);
    if (!ctx) return;
    await requireGroupReadAccess(db, ctx, req.params.groupId);
    const tenantIds = await loadGroupTenantIds(db, req.params.groupId);
    if (tenantIds.length === 0) return res.json({ qualifications: [] });

    const allNames = new Set();
    for (const tenantId of tenantIds) {
      const token = await loadTenantTokenById(tenantId);
      if (!token) continue;
      try {
        await withTenantDb(token, async (pool) => {
          const [rows] = await pool.execute('SELECT DISTINCT name FROM Qualification WHERE name IS NOT NULL');
          for (const row of rows) {
            const name = String(row.name || '').trim();
            if (name) allNames.add(name);
          }
        });
      } catch (err) {
        console.warn(`[groups] qualifications scan failed for tenant ${tenantId}:`, err.message);
      }
    }
    res.json({ qualifications: Array.from(allNames).sort((a, b) => a.localeCompare(b, 'de')) });
  } catch (err) {
    handleError(res, err);
  }
});

// Returns central employees eligible to staff the given shared workplace.
// "Eligible" = the union of qualification names this employee holds across
// his/her assigned tenants in the group covers every required name and
// includes none of the excluded names. If the workplace has no qualification
// rules, all group staff are returned (same as /staff).
router.get('/:groupId/workplaces/:workplaceId/eligible-staff', async (req, res) => {
  try {
    const ctx = await loadCtx(req, res);
    if (!ctx) return;
    await requireGroupReadAccess(db, ctx, req.params.groupId);
    const tenantIds = await loadGroupTenantIds(db, req.params.groupId);
    if (tenantIds.length === 0) return res.json({ staff: [], required: [], excluded: [] });

    const [qualRows] = await db.execute(
      `SELECT qualification_name, is_excluded
         FROM shared_workplace_qualification
        WHERE shared_workplace_id = ?`,
      [req.params.workplaceId]
    );
    // Trim qualification names from the master DB for robust comparison
    // with names coming from tenant DBs (which are trimmed on read).
    const required = qualRows
      .filter((r) => !r.is_excluded)
      .map((r) => String(r.qualification_name || '').trim())
      .filter(Boolean);
    const excluded = qualRows
      .filter((r) => r.is_excluded)
      .map((r) => String(r.qualification_name || '').trim())
      .filter(Boolean);

    // Load all group staff (same shape as /staff)
    const placeholders = tenantIds.map(() => '?').join(',');
    const [staffRows] = await db.execute(
      `SELECT e.id, e.last_name, e.first_name, e.payroll_id, e.is_active,
              GROUP_CONCAT(DISTINCT eta.tenant_id) AS tenant_ids,
              MAX(CASE WHEN eta.is_primary THEN eta.tenant_id END) AS primary_tenant_id
         FROM Employee e
         JOIN EmployeeTenantAssignment eta
           ON eta.employee_id COLLATE utf8mb4_general_ci = e.id COLLATE utf8mb4_general_ci
        WHERE eta.tenant_id IN (${placeholders})
          AND e.is_active = 1
        GROUP BY e.id
        ORDER BY e.last_name, e.first_name`,
      tenantIds.map(String)
    );

    // If no rules, return everyone (cheap path)
    if (required.length === 0 && excluded.length === 0) {
      const allIds = staffRows.map(r => String(r.id));
      return res.json({
        staff: staffRows.map((r) => ({
          id: r.id,
          last_name: r.last_name,
          first_name: r.first_name,
          payroll_id: r.payroll_id,
          is_active: !!r.is_active,
          tenant_ids: r.tenant_ids ? String(r.tenant_ids).split(',') : [],
          primary_tenant_id: r.primary_tenant_id ? String(r.primary_tenant_id) : null,
          qualifications: [],
        })),
        required, excluded,
        absences_by_employee: await loadEligibleAbsences(db, staffRows),
      });
    }

    // Build a mapping from tenant doctor ID → employee ID via EmployeeTenantAssignment,
    // so that doctors without central_employee_id can still be matched to a central employee.
    const doctorToEmployee = new Map(); // key: `${tenantId}:${doctorId}` → employeeId
    const [etaRows] = await db.execute(
      `SELECT tenant_id, tenant_doctor_id, employee_id
         FROM EmployeeTenantAssignment
        WHERE tenant_id IN (${placeholders})
          AND tenant_doctor_id IS NOT NULL`,
      tenantIds.map(String)
    );
    for (const eta of etaRows) {
      const key = `${eta.tenant_id}:${eta.tenant_doctor_id}`;
      doctorToEmployee.set(key, String(eta.employee_id));
    }

    // Build employee → set of qualification names by scanning each tenant DB.
    // Resolves the employee ID first via Doctor.central_employee_id, and falls
    // back to the EmployeeTenantAssignment mapping for doctors that only have
    // a tenant_doctor_id link (no central_employee_id).
    const employeeQuals = new Map(); // employee_id (string) → Set<string>
    for (const tenantId of tenantIds) {
      const token = await loadTenantTokenById(tenantId);
      if (!token) continue;
      try {
        await withTenantDb(token, async (pool) => {
          // Doctor uses utf8mb4_unicode_ci (explicit), but DoctorQualification
          // and Qualification use the database default (utf8mb4_uca1400_ai_ci
          // on MySQL 8.4+). Add COLLATE to avoid "Illegal mix of collations".
          const [rows] = await pool.execute(
            `SELECT d.id AS doctor_id, d.central_employee_id AS emp_id, q.name AS qname
               FROM Doctor d
               JOIN DoctorQualification dq ON dq.doctor_id COLLATE utf8mb4_unicode_ci = d.id
               JOIN Qualification q ON q.id = dq.qualification_id`
          );
          for (const row of rows) {
            let empId = row.emp_id ? String(row.emp_id) : null;
            // Fallback: resolve via EmployeeTenantAssignment.tenant_doctor_id
            if (!empId) {
              const mapKey = `${tenantId}:${row.doctor_id}`;
              empId = doctorToEmployee.get(mapKey) || null;
            }
            if (!empId) continue;
            const qname = String(row.qname || '').trim();
            if (!qname) continue;
            if (!employeeQuals.has(empId)) employeeQuals.set(empId, new Set());
            employeeQuals.get(empId).add(qname);
          }
        });
      } catch (err) {
        console.warn(`[groups] eligible-staff scan failed for tenant ${tenantId}:`, err.message);
      }
    }

    // Case-insensitive qualification name matching.
    // MySQL VARCHAR UNIQUE uses a case-insensitive collation (utf8mb4_unicode_ci),
    // so "Facharzt" and "facharzt" cannot co-exist in the same tenant — but the
    // stored casing depends on which value was inserted first. Since JavaScript
    // Set.has() is case-sensitive, we normalize to lowercase for matching.
    const hasQual = (set, name) => {
      if (set.has(name)) return true;
      const lower = name.toLowerCase();
      if (lower === name) return false;
      for (const q of set) {
        if (q.toLowerCase() === lower) return true;
      }
      return false;
    };

    const eligible = staffRows.filter((r) => {
      const have = employeeQuals.get(String(r.id)) || new Set();
      for (const req of required) {
        if (!hasQual(have, req)) return false;
      }
      for (const ex of excluded) {
        if (hasQual(have, ex)) return false;
      }
      return true;
    });

    // Diagnostic: log when qualifications are required but no one matched
    if (required.length > 0 && eligible.length === 0) {
      const totalStaff = staffRows.length;
      const lowerRequired = required.map((r) => r.toLowerCase());
      const staffWithQuals = [...employeeQuals.entries()]
        .filter(([_, quals]) => lowerRequired.every((lr) => {
          for (const q of quals) {
            if (q.toLowerCase() === lr) return true;
          }
          return false;
        }))
        .length;
      const qualsSummary = [...employeeQuals.entries()].slice(0, 5)
        .map(([eid, quals]) => `${eid}:[${[...quals].join(',')}]`)
        .join('; ');
      console.warn(
        `[groups] eligible-staff: workplace=${req.params.workplaceId} ` +
        `required=[${required.join(', ')}] ` +
        `totalStaff=${totalStaff} staffWithAllRequiredQuals=${staffWithQuals} ` +
        `tenantsWithQualData=${[...employeeQuals.keys()].length} ` +
        `employeeQuals=${qualsSummary}`
      );
    }

    res.json({
      staff: eligible.map((r) => ({
        id: r.id,
        last_name: r.last_name,
        first_name: r.first_name,
        payroll_id: r.payroll_id,
        is_active: !!r.is_active,
        tenant_ids: r.tenant_ids ? String(r.tenant_ids).split(',') : [],
        primary_tenant_id: r.primary_tenant_id ? String(r.primary_tenant_id) : null,
        qualifications: Array.from(employeeQuals.get(String(r.id)) || []),
      })),
      required,
      excluded,
      absences_by_employee: await loadEligibleAbsences(db, eligible),
    });
  } catch (err) {
    handleError(res, err);
  }
});

router.get('/:groupId/workplaces/:workplaceId/timeslots', async (req, res) => {
  try {
    const ctx = await loadCtx(req, res);
    if (!ctx) return;
    await requireGroupReadAccess(db, ctx, req.params.groupId);
    const [rows] = await db.execute(
      `SELECT id, shared_workplace_id, label, start_time, end_time,
              \`order\` AS sort_order, overlap_tolerance_minutes, spans_midnight
         FROM shared_workplace_timeslot
        WHERE shared_workplace_id = ?
        ORDER BY COALESCE(\`order\`, 0) ASC, start_time ASC`,
      [req.params.workplaceId]
    );
    res.json({
      timeslots: rows.map((row) => ({
        ...row,
        order: row.sort_order ?? 0,
        spans_midnight: Boolean(row.spans_midnight),
      })),
    });
  } catch (err) {
    handleError(res, err);
  }
});

router.post('/:groupId/workplaces/:workplaceId/timeslots', async (req, res) => {
  try {
    const ctx = await loadCtx(req, res);
    if (!ctx) return;
    requireGroupWriteAccess(ctx, req.params.groupId);
    const { label, start_time, end_time, order, overlap_tolerance_minutes, spans_midnight } = req.body || {};
    if (!label || !start_time || !end_time) {
      return res.status(400).json({ error: 'label, start_time und end_time sind erforderlich' });
    }
    const id = crypto.randomUUID();
    await db.execute(
      `INSERT INTO shared_workplace_timeslot
        (id, shared_workplace_id, label, start_time, end_time,
         \`order\`, overlap_tolerance_minutes, spans_midnight, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        req.params.workplaceId,
        label,
        start_time,
        end_time,
        Number.isInteger(order) ? order : 0,
        Number.isInteger(overlap_tolerance_minutes) ? overlap_tolerance_minutes : 0,
        spans_midnight ? 1 : 0,
        req.user.email || req.user.sub,
      ]
    );
    res.status(201).json({ id });
  } catch (err) {
    handleError(res, err);
  }
});

router.patch('/:groupId/workplaces/:workplaceId/timeslots/:timeslotId', async (req, res) => {
  try {
    const ctx = await loadCtx(req, res);
    if (!ctx) return;
    requireGroupWriteAccess(ctx, req.params.groupId);
    const allowed = ['label', 'start_time', 'end_time', 'order', 'overlap_tolerance_minutes', 'spans_midnight'];
    const fields = [];
    const values = [];
    for (const key of allowed) {
      if (req.body[key] === undefined) continue;
      let val = req.body[key];
      if (key === 'spans_midnight') {
        val = val ? 1 : 0;
      }
      const columnName = key === 'order' ? '\`order\`' : key;
      fields.push(`${columnName} = ?`);
      values.push(val);
    }
    if (fields.length === 0) return res.status(400).json({ error: 'Keine Änderungen' });
    values.push(req.params.timeslotId, req.params.workplaceId);
    await db.execute(
      `UPDATE shared_workplace_timeslot SET ${fields.join(', ')}
        WHERE id = ? AND shared_workplace_id = ?`,
      values
    );
    res.json({ success: true });
  } catch (err) {
    handleError(res, err);
  }
});

router.delete('/:groupId/workplaces/:workplaceId/timeslots/:timeslotId', async (req, res) => {
  try {
    const ctx = await loadCtx(req, res);
    if (!ctx) return;
    requireGroupWriteAccess(ctx, req.params.groupId);
    await db.execute(
      'DELETE FROM shared_workplace_timeslot WHERE id = ? AND shared_workplace_id = ?',
      [req.params.timeslotId, req.params.workplaceId]
    );
    res.status(204).end();
  } catch (err) {
    handleError(res, err);
  }
});

// ============ QUOTAS ============

router.get('/:groupId/workplaces/:workplaceId/quotas', async (req, res) => {
  try {
    const ctx = await loadCtx(req, res);
    if (!ctx) return;
    await requireGroupReadAccess(db, ctx, req.params.groupId);
    const [rows] = await db.execute(
      `SELECT q.shared_workplace_id, q.scope, q.scope_key, q.period,
              q.max_count, q.target_count, q.weight
         FROM shared_workplace_quota q
         JOIN shared_workplace w ON w.id = q.shared_workplace_id
        WHERE w.group_id = ? AND w.id = ?`,
      [req.params.groupId, req.params.workplaceId]
    );
    res.json({ quotas: rows });
  } catch (err) {
    handleError(res, err);
  }
});

router.put('/:groupId/workplaces/:workplaceId/quotas', async (req, res) => {
  try {
    const ctx = await loadCtx(req, res);
    if (!ctx) return;
    requireGroupWriteAccess(ctx, req.params.groupId);
    const quotas = Array.isArray(req.body?.quotas) ? req.body.quotas : null;
    if (!quotas) return res.status(400).json({ error: 'quotas[] erforderlich' });

    // Replace-strategy: delete all for this workplace, then insert fresh.
    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();
      await conn.execute('DELETE FROM shared_workplace_quota WHERE shared_workplace_id = ?', [req.params.workplaceId]);
      for (const q of quotas) {
        if (!['person', 'tenant', 'role'].includes(q.scope)) continue;
        if (!q.scope_key) continue;
        const period = ['month', 'quarter', 'year'].includes(q.period) ? q.period : 'month';
        await conn.execute(
          `INSERT INTO shared_workplace_quota
             (shared_workplace_id, scope, scope_key, period, max_count, target_count, weight)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            req.params.workplaceId, q.scope, String(q.scope_key), period,
            q.max_count ?? null, q.target_count ?? null,
            q.weight ?? 1.0,
          ]
        );
      }
      await conn.commit();
    } catch (txErr) {
      await conn.rollback();
      throw txErr;
    } finally {
      conn.release();
    }
    res.json({ success: true });
  } catch (err) {
    handleError(res, err);
  }
});

// ============ STAFF (aggregated employees in the group) ============

router.get('/:groupId/staff', async (req, res) => {
  try {
    const ctx = await loadCtx(req, res);
    if (!ctx) return;
    await requireGroupReadAccess(db, ctx, req.params.groupId);
    const tenantIds = await loadGroupTenantIds(db, req.params.groupId);
    if (tenantIds.length === 0) return res.json({ staff: [] });

    // Employees assigned to any tenant in the group, with their primary
    // tenant and an aggregated tenant list. Names come from Employee
    // (central identity); roles come from the per-tenant Doctor row but
    // those live in tenant DBs — for now we return central data only and
    // let the frontend optionally fetch per-tenant role via existing routes.
    const placeholders = tenantIds.map(() => '?').join(',');
    const [rows] = await db.execute(
      `SELECT e.id, e.last_name, e.first_name, e.payroll_id, e.is_active,
              GROUP_CONCAT(DISTINCT eta.tenant_id) AS tenant_ids,
              MAX(CASE WHEN eta.is_primary THEN eta.tenant_id END) AS primary_tenant_id
         FROM Employee e
         JOIN EmployeeTenantAssignment eta
           ON eta.employee_id COLLATE utf8mb4_general_ci = e.id COLLATE utf8mb4_general_ci
        WHERE eta.tenant_id IN (${placeholders})
          AND e.is_active = 1
        GROUP BY e.id
        ORDER BY e.last_name, e.first_name`,
      tenantIds.map(String)
    );

    const staff = rows.map((r) => ({
      id: r.id,
      last_name: r.last_name,
      first_name: r.first_name,
      payroll_id: r.payroll_id,
      is_active: !!r.is_active,
      tenant_ids: r.tenant_ids ? String(r.tenant_ids).split(',') : [],
      primary_tenant_id: r.primary_tenant_id ? String(r.primary_tenant_id) : null,
    }));

    res.json({ staff });
  } catch (err) {
    handleError(res, err);
  }
});

// ============ SCHEDULE (pool shifts only) ============

router.get('/:groupId/schedule', async (req, res) => {
  try {
    const ctx = await loadCtx(req, res);
    if (!ctx) return;
    await requireGroupReadAccess(db, ctx, req.params.groupId);
    const from = String(req.query.from || '').slice(0, 10);
    const to = String(req.query.to || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      return res.status(400).json({ error: 'from/to (YYYY-MM-DD) erforderlich' });
    }
    const [rows] = await db.execute(
      `SELECT s.id, s.shared_workplace_id, s.date, s.employee_id, s.billing_tenant_id,
              s.start_time, s.end_time, s.note,
              w.name AS workplace_name, w.category AS workplace_category
         FROM shared_shift_entry s
         JOIN shared_workplace w ON w.id = s.shared_workplace_id
        WHERE w.group_id = ?
          AND s.date BETWEEN ? AND ?
        ORDER BY s.date ASC, w.name ASC`,
      [req.params.groupId, from, to]
    );
    res.json({ shifts: rows });
  } catch (err) {
    handleError(res, err);
  }
});

// ============ SHIFTS (write) ============

/**
 * Load existing shifts for a workplace covering the relevant window for
 * constraint evaluation.
 */
async function loadShiftsWindow(workplaceId, dateStr) {
  const date = new Date(`${dateStr}T00:00:00Z`);
  const start = new Date(date);
  start.setUTCDate(start.getUTCDate() - 7);
  const end = new Date(date);
  end.setUTCDate(end.getUTCDate() + 7);
  // also cover the whole calendar month for max_per_person_month
  const monthStart = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
  const monthEnd = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0));
  const lo = (start < monthStart ? start : monthStart).toISOString().slice(0, 10);
  const hi = (end > monthEnd ? end : monthEnd).toISOString().slice(0, 10);
  const [rows] = await db.execute(
    `SELECT id, date, employee_id FROM shared_shift_entry
       WHERE shared_workplace_id = ? AND date BETWEEN ? AND ?`,
    [workplaceId, lo, hi]
  );
  return rows.map((r) => ({ ...r, date: String(r.date).slice(0, 10) }));
}

router.post('/:groupId/shifts', async (req, res) => {
  try {
    const ctx = await loadCtx(req, res);
    if (!ctx) return;
    requireGroupWriteAccess(ctx, req.params.groupId);
    const { shared_workplace_id, date, employee_id, billing_tenant_id, start_time, end_time, note } = req.body || {};
    if (!shared_workplace_id || !date || !employee_id || !billing_tenant_id) {
      return res.status(400).json({ error: 'shared_workplace_id, date, employee_id, billing_tenant_id erforderlich' });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'date muss YYYY-MM-DD sein' });
    }

    // Verify workplace belongs to the group
    const [wpRows] = await db.execute(
      `SELECT id, name, category, min_staff, optimal_staff, constraints_json,
              auto_off, allows_rotation_concurrently, allows_absence_overlap,
              affects_availability, consecutive_days_mode
         FROM shared_workplace
        WHERE id = ? AND group_id = ? AND is_active = 1`,
      [shared_workplace_id, req.params.groupId]
    );
    if (wpRows.length === 0) return res.status(404).json({ error: 'Workplace nicht gefunden' });
    const workplace = wpRows[0];

    // Constraint check
    const existing = await loadShiftsWindow(shared_workplace_id, date);
    const violations = validateProposedShift({
      workplace,
      proposed: { date, employee_id, employee_role: req.body.employee_role || null },
      existingForWorkplace: existing,
    });
    const tenantRuleContext = await loadTenantRuleContext({
      employeeId: employee_id,
      billingTenantId: billing_tenant_id,
      dateStr: date,
    });
    const tenantRuleResult = validateSharedShiftTenantRules({
      workplace,
      dateStr: date,
      centralEmployeeId: employee_id,
      tenantDoctorId: tenantRuleContext.tenantDoctorId,
      tenantShifts: tenantRuleContext.tenantShifts,
      tenantWorkplaces: tenantRuleContext.tenantWorkplaces,
      existingSharedShiftsForWorkplace: existing,
      holidayDates: tenantRuleContext.holidayDates,
    });

    // Employee relationship conflict check for pool shifts
    const relationshipBlockers = req.query.force === '1' ? [] : await checkRelationshipConflictsForPoolShift(db, {
      employeeId: employee_id,
      dateStr: date,
      existingSharedShiftsForWorkplace: existing,
    });

    // Hard violations (max_per_person_month, max_consecutive, rest_after) block the save.
    const hardRules = new Set(['max_per_person_month', 'max_consecutive', 'rest_after']);
    const hard = violations.filter((v) => hardRules.has(v.rule));
    // Tenant-level blockers (rotation_conflict, auto_off_conflict, etc.) are
    // overridable via force=1 – the user gets a dialog asking whether to
    // remove the employee from the conflicting rotation.
    const tenantHard = req.query.force === '1' ? [] : tenantRuleResult.blockers;
    const allBlockers = [...tenantHard, ...relationshipBlockers];
    if (allBlockers.length > 0) {
      return res.status(422).json({ error: 'constraint_violation', details: allBlockers });
    }
    if (hard.length > 0 && req.query.force !== '1') {
      return res.status(422).json({ error: 'constraint_violation', details: hard });
    }

    // When force=1 with rotation_conflict blockers: delete the conflicting
    // rotation entries from the tenant DB before saving the new Dienst.
    if (req.query.force === '1') {
      const rotationConflicts = (tenantRuleResult.blockers || []).filter(
        (b) => b.rule === 'rotation_conflict' && b.rotationShiftId
      );
      if (rotationConflicts.length > 0) {
        await withTenantDb(tenantRuleContext.tenantToken, async (pool) => {
          const ids = rotationConflicts.map((b) => b.rotationShiftId).filter(Boolean);
          if (ids.length > 0) {
            const placeholders = ids.map(() => '?').join(',');
            await pool.execute(
              `DELETE FROM ShiftEntry WHERE id IN (${placeholders})`,
              ids
            );
          }
        });
      }
    }

    const id = crypto.randomUUID();
    await db.execute(
      `INSERT INTO shared_shift_entry
         (id, shared_workplace_id, date, employee_id, billing_tenant_id, start_time, end_time, note, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, shared_workplace_id, date, employee_id, String(billing_tenant_id),
       start_time || null, end_time || null, note || null,
       req.user.email || req.user.sub]
    );
    await ensureTenantAutoFreiEntry({
      shiftId: id,
      workplace,
      tenantToken: tenantRuleContext.tenantToken,
      tenantDoctorId: tenantRuleContext.tenantDoctorId,
      autoFreiDate: tenantRuleResult.autoFreiDate,
      tenantShifts: tenantRuleContext.tenantShifts,
    });
    res.status(201).json({
      id,
      warnings: [
        ...violations.filter((v) => !hardRules.has(v.rule)),
        ...tenantRuleResult.warnings,
      ],
    });
  } catch (err) {
    handleError(res, err);
  }
});

router.patch('/:groupId/shifts/:shiftId', async (req, res) => {
  try {
    const ctx = await loadCtx(req, res);
    if (!ctx) return;
    requireGroupWriteAccess(ctx, req.params.groupId);
    const allowed = ['date', 'employee_id', 'billing_tenant_id', 'start_time', 'end_time', 'note'];
    const fields = [];
    const values = [];
    for (const key of allowed) {
      if (req.body[key] === undefined) continue;
      let value = req.body[key];
      if (key === 'billing_tenant_id' && value != null) {
        value = String(value);
      }
      fields.push(`${key} = ?`);
      values.push(value);
    }
    if (fields.length === 0) return res.status(400).json({ error: 'Keine Änderungen' });

    // Verify shift belongs to a workplace in this group
    const [rows] = await db.execute(
      `SELECT s.id, s.shared_workplace_id, s.date, s.employee_id, s.billing_tenant_id,
              w.name, w.category, w.auto_off, w.allows_rotation_concurrently,
              w.allows_absence_overlap, w.affects_availability, w.consecutive_days_mode,
              w.min_staff, w.optimal_staff, w.constraints_json
         FROM shared_shift_entry s
         JOIN shared_workplace w ON w.id = s.shared_workplace_id
        WHERE s.id = ? AND w.group_id = ?`,
      [req.params.shiftId, req.params.groupId]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Schicht nicht gefunden' });

    const currentShift = rows[0];
    const nextState = {
      date: req.body.date ?? String(currentShift.date).slice(0, 10),
      employee_id: req.body.employee_id ?? currentShift.employee_id,
      billing_tenant_id: req.body.billing_tenant_id ?? currentShift.billing_tenant_id,
      start_time: req.body.start_time ?? currentShift.start_time,
      end_time: req.body.end_time ?? currentShift.end_time,
      note: req.body.note ?? currentShift.note,
    };

    const existingForWorkplace = (await loadShiftsWindow(currentShift.shared_workplace_id, nextState.date))
      .filter((shift) => String(shift.id) !== String(req.params.shiftId));
    const poolViolations = validateProposedShift({
      workplace: currentShift,
      proposed: { date: nextState.date, employee_id: nextState.employee_id, employee_role: req.body.employee_role || null },
      existingForWorkplace,
    });
    const poolHardRules = new Set(['max_per_person_month', 'max_consecutive', 'rest_after']);
    const poolHard = poolViolations.filter((violation) => poolHardRules.has(violation.rule));
    if (poolHard.length > 0 && req.query.force !== '1') {
      return res.status(422).json({ error: 'constraint_violation', details: poolHard });
    }

    const tenantRuleContext = await loadTenantRuleContext({
      employeeId: nextState.employee_id,
      billingTenantId: nextState.billing_tenant_id,
      dateStr: nextState.date,
    });
    const tenantRuleResult = validateSharedShiftTenantRules({
      workplace: currentShift,
      dateStr: nextState.date,
      centralEmployeeId: nextState.employee_id,
      tenantDoctorId: tenantRuleContext.tenantDoctorId,
      tenantShifts: tenantRuleContext.tenantShifts,
      tenantWorkplaces: tenantRuleContext.tenantWorkplaces,
      existingSharedShiftsForWorkplace: existingForWorkplace,
      holidayDates: tenantRuleContext.holidayDates,
    });

    // Employee relationship conflict check for pool shifts
    const relationshipBlockers = req.query.force === '1' ? [] : await checkRelationshipConflictsForPoolShift(db, {
      employeeId: nextState.employee_id,
      dateStr: nextState.date,
      existingSharedShiftsForWorkplace: existingForWorkplace,
    });

    // Tenant-level blockers (rotation_conflict, auto_off_conflict, etc.) are
    // overridable via force=1 – the user gets a dialog asking whether to
    // remove the employee from the conflicting rotation.
    const tenantPatchBlockers = req.query.force === '1' ? [] : tenantRuleResult.blockers;
    const allPatchBlockers = [...tenantPatchBlockers, ...relationshipBlockers];
    if (allPatchBlockers.length > 0) {
      return res.status(422).json({ error: 'constraint_violation', details: allPatchBlockers });
    }

    // When force=1 with rotation_conflict blockers: delete the conflicting
    // rotation entries from the tenant DB before updating the Dienst.
    if (req.query.force === '1') {
      const rotationConflicts = (tenantRuleResult.blockers || []).filter(
        (b) => b.rule === 'rotation_conflict' && b.rotationShiftId
      );
      if (rotationConflicts.length > 0) {
        await withTenantDb(tenantRuleContext.tenantToken, async (pool) => {
          const ids = rotationConflicts.map((b) => b.rotationShiftId).filter(Boolean);
          if (ids.length > 0) {
            const placeholders = ids.map(() => '?').join(',');
            await pool.execute(
              `DELETE FROM ShiftEntry WHERE id IN (${placeholders})`,
              ids
            );
          }
        });
      }
    }

    values.push(req.params.shiftId);
    await db.execute(`UPDATE shared_shift_entry SET ${fields.join(', ')} WHERE id = ?`, values);
    await cleanupTenantAutoFreiEntry({ shiftId: req.params.shiftId, tenantId: currentShift.billing_tenant_id });
    if (String(nextState.billing_tenant_id) !== String(currentShift.billing_tenant_id)) {
      await cleanupTenantAutoFreiEntry({ shiftId: req.params.shiftId, tenantId: nextState.billing_tenant_id });
    }
    await ensureTenantAutoFreiEntry({
      shiftId: req.params.shiftId,
      workplace: currentShift,
      tenantToken: tenantRuleContext.tenantToken,
      tenantDoctorId: tenantRuleContext.tenantDoctorId,
      autoFreiDate: tenantRuleResult.autoFreiDate,
      tenantShifts: tenantRuleContext.tenantShifts,
    });
    res.json({
      success: true,
      warnings: [
        ...poolViolations.filter((violation) => !poolHardRules.has(violation.rule)),
        ...tenantRuleResult.warnings,
      ],
    });
  } catch (err) {
    handleError(res, err);
  }
});

router.delete('/:groupId/shifts/:shiftId', async (req, res) => {
  try {
    const ctx = await loadCtx(req, res);
    if (!ctx) return;
    requireGroupWriteAccess(ctx, req.params.groupId);
    const [rows] = await db.execute(
      `SELECT s.id, s.billing_tenant_id
         FROM shared_shift_entry s
         JOIN shared_workplace w ON w.id = s.shared_workplace_id
        WHERE s.id = ? AND w.group_id = ?`,
      [req.params.shiftId, req.params.groupId]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Schicht nicht gefunden' });

    await cleanupTenantAutoFreiEntry({ shiftId: req.params.shiftId, tenantId: rows[0].billing_tenant_id });
    const [result] = await db.execute(
      `DELETE s FROM shared_shift_entry s
         JOIN shared_workplace w ON w.id = s.shared_workplace_id
        WHERE s.id = ? AND w.group_id = ?`,
      [req.params.shiftId, req.params.groupId]
    );
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Schicht nicht gefunden' });
    res.status(204).end();
  } catch (err) {
    handleError(res, err);
  }
});

// ============ STATS ============

router.get('/:groupId/stats', async (req, res) => {
  try {
    const ctx = await loadCtx(req, res);
    if (!ctx) return;
    await requireGroupReadAccess(db, ctx, req.params.groupId);
    const from = String(req.query.from || '').slice(0, 10);
    const to = String(req.query.to || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      return res.status(400).json({ error: 'from/to (YYYY-MM-DD) erforderlich' });
    }

    // Counts per workplace + tenant
    const [perTenant] = await db.execute(
      `SELECT w.id AS workplace_id, w.name AS workplace_name,
              s.billing_tenant_id, t.name AS tenant_name,
              COUNT(*) AS cnt
         FROM shared_shift_entry s
         JOIN shared_workplace w ON w.id = s.shared_workplace_id
         JOIN db_tokens t ON t.id = s.billing_tenant_id
        WHERE w.group_id = ? AND s.date BETWEEN ? AND ?
        GROUP BY w.id, s.billing_tenant_id
        ORDER BY w.name, t.name`,
      [req.params.groupId, from, to]
    );

    // Counts per workplace + person
    const [perPerson] = await db.execute(
      `SELECT w.id AS workplace_id, w.name AS workplace_name,
              s.employee_id, e.last_name, e.first_name,
              COUNT(*) AS cnt
         FROM shared_shift_entry s
         JOIN shared_workplace w ON w.id = s.shared_workplace_id
         LEFT JOIN Employee e
                ON e.id COLLATE utf8mb4_general_ci = s.employee_id COLLATE utf8mb4_general_ci
        WHERE w.group_id = ? AND s.date BETWEEN ? AND ?
        GROUP BY w.id, s.employee_id
        ORDER BY w.name, cnt DESC`,
      [req.params.groupId, from, to]
    );

    res.json({ per_tenant: perTenant, per_person: perPerson });
  } catch (err) {
    handleError(res, err);
  }
});

export default router;
