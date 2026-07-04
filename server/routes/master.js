/**
 * Master API Routes
 * 
 * Cross-tenant aggregation endpoints for the Master Frontend.
 * These routes query data from all configured tenant databases
 * and return consolidated results for HR/management overview.
 * 
 * All routes require admin authentication.
 */

import express from 'express';
import crypto from 'crypto';
import ExcelJS from 'exceljs';
import { createPool } from 'mysql2/promise';
import { db, getTenantDb } from '../index.js';
import { authMiddleware, adminMiddleware } from './auth.js';
import { parseDbToken } from '../utils/crypto.js';
import { deleteEmployeeDependentRecords } from '../utils/masterEmployees.js';
import {
  resolveEmployeeTargetWeeklyHours,
  syncEmployeeWorkSettingsToTenantDoctors,
} from '../utils/masterEmployeeWorkSettings.js';
import {
  migrateLinkedAssignmentsToCentral,
  migrateTenantDoctorAbsencesToCentral,
  seedTenantDoctorAbsencesFromCentral,
} from '../utils/centralAbsences.js';
import { broadcastPlanUpdate, buildRealtimeScope } from '../utils/realtime.js';
import { format, startOfMonth, endOfMonth, getDaysInMonth } from 'date-fns';
import { getPublicHolidayDatesForYear, clearHolidayCache } from './holidays.js';
import { analyzeStammdatImport, executeStammdatImport, linkStammdatToEmployee } from '../utils/masterImport.js';

const router = express.Router();
router.use(authMiddleware);
router.use(adminMiddleware);

const NON_WORKING_SHIFT_POSITIONS = new Set([
  'frei',
  'urlaub',
  'krank',
  'dienstreise',
  'nicht verfugbar',
  'nicht verfügbar',
  'fortbildung',
  'kongress',
  'elternzeit',
  'mutterschutz',
  'verfugbar',
  'verfügbar',
  'az',
  'ko',
  'ez',
  'ms',
]);

// ============ HELPERS ============

function normalizeShiftPosition(position) {
  return String(position || '')
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function isNonWorkingShiftPosition(position) {
  return NON_WORKING_SHIFT_POSITIONS.has(normalizeShiftPosition(position));
}

function mergeTimeIntervals(intervals) {
  if (!intervals || intervals.length === 0) return 0;

  const sorted = [...intervals].sort((left, right) => left.start - right.start);
  const merged = [sorted[0]];

  for (let index = 1; index < sorted.length; index++) {
    const current = sorted[index];
    const last = merged[merged.length - 1];

    if (current.start <= last.end) {
      last.end = Math.max(last.end, current.end);
      continue;
    }

    merged.push({ ...current });
  }

  return merged.reduce((sum, interval) => sum + (interval.end - interval.start), 0);
}

function shiftToInterval(shift, timeslot, workplace) {
  if (shift?.start_time && shift?.end_time) {
    const start = timeToMin(shift.start_time);
    let end = timeToMin(shift.end_time);
    if (end < start) end += 24 * 60;

    const breakMinutes = Number(shift.break_minutes) || 0;
    return {
      start,
      end: Math.max(start, end - breakMinutes),
    };
  }

  const workTimePercentage = (workplace?.work_time_percentage ?? 100) / 100;

  if (timeslot?.start_time && timeslot?.end_time) {
    const start = timeToMin(timeslot.start_time);
    let end = timeToMin(timeslot.end_time);
    if (end <= start) end += 24 * 60;

    return {
      start,
      end: start + ((end - start) * workTimePercentage),
    };
  }

  const defaultStart = 8 * 60;
  const defaultEnd = 16 * 60;
  return {
    start: defaultStart,
    end: defaultStart + ((defaultEnd - defaultStart) * workTimePercentage),
  };
}

function getMonthKey(year, month) {
  return `${year}-${String(month).padStart(2, '0')}`;
}

function createMonthlyPeriods(startDate, endDate = new Date(), maxMonths = 24) {
  const periods = [];
  const cursor = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
  const endCursor = new Date(endDate.getFullYear(), endDate.getMonth(), 1);

  while (cursor <= endCursor) {
    const year = cursor.getFullYear();
    const month = cursor.getMonth() + 1;
    const daysInMonth = getDaysInMonth(cursor);

    periods.push({
      year,
      month,
      key: getMonthKey(year, month),
      startDate: `${year}-${String(month).padStart(2, '0')}-01`,
      endDate: `${year}-${String(month).padStart(2, '0')}-${String(daysInMonth).padStart(2, '0')}`,
      daysInMonth,
    });

    cursor.setMonth(cursor.getMonth() + 1);
  }

  return periods.slice(-maxMonths);
}

function calculateMonthlyTargetMinutes(targetHoursPerWeek, year, month, options = {}) {
  const weeklyHours = Number(targetHoursPerWeek);
  if (!Number.isFinite(weeklyHours) || weeklyHours <= 0) return 0;

  const daysInMonth = getDaysInMonth(new Date(year, month - 1, 1));

  // Im Modell "volle Tage mit freien Tagen" wird an Arbeitstagen die volle
  // Tagesstundenzahl angesetzt; die Reduktion erfolgt über freie Tage.
  // Soll = Arbeitsstage × (Wochenstunden / 5)
  if (options.partTimeModel === 'full_days_off') {
    const fte = Number(options.fte);
    if (Number.isFinite(fte) && fte > 0 && fte < 1) {
      const workDaysPerWeek = Math.max(1, Math.min(5, Math.round(fte * 5)));
      const fullDailyHours = weeklyHours / 5;
      const workdays = countWorkdaysInMonth(year, month);
      return Math.round((workdays * (workDaysPerWeek / 5)) * fullDailyHours * 60);
    }
  }

  return Math.round((daysInMonth * weeklyHours / 7) * 60);
}

function countWorkdaysInMonth(year, month) {
  const daysInMonth = getDaysInMonth(new Date(year, month - 1, 1));
  let count = 0;
  for (let day = 1; day <= daysInMonth; day++) {
    const dow = new Date(year, month - 1, day).getDay();
    if (dow !== 0 && dow !== 6) count++;
  }
  return count;
}

/**
 * Aggregiert die Teilzeit-Kontexte aller verknüpften Tenant-Doctors.
 * - partTimeModel: 'full_days_off' sobald irgendeine Zuordnung dies meldet,
 *   sonst 'reduced_daily' (Default).
 * - fte: der kleinste FTE-Wert (konservativ), damit das Soll nicht zu hoch ausfällt.
 */
function aggregatePartTimeContext(assignmentContext) {
  if (!assignmentContext || assignmentContext.size === 0) return {};
  let partTimeModel = 'reduced_daily';
  let minFte = null;
  for (const ctx of assignmentContext.values()) {
    if (ctx?.partTimeModel === 'full_days_off') partTimeModel = 'full_days_off';
    if (ctx?.fte !== null && ctx?.fte !== undefined) {
      const numericFte = Number(ctx.fte);
      if (Number.isFinite(numericFte) && numericFte > 0) {
        minFte = minFte === null ? numericFte : Math.min(minFte, numericFte);
      }
    }
  }
  return { partTimeModel, fte: minFte };
}

async function syncEmployeeWorkSettingsForAssignments(adminUserId, employee, assignments, actor = null) {
  const linkedAssignments = (assignments || []).filter(
    (assignment) => assignment.tenant_id && assignment.tenant_doctor_id
  );

  if (!employee?.id || linkedAssignments.length === 0) {
    return { syncedAssignments: [], skippedAssignments: [], failedAssignments: [] };
  }

  const tokens = await getAllTenantTokens(adminUserId);
  return syncEmployeeWorkSettingsToTenantDoctors({
    employee,
    assignments: linkedAssignments,
    tokens,
    withTenantDb,
    actor,
    buildRealtimeScope,
    broadcastPlanUpdate,
  });
}

async function syncTimeAccountsForEmployee(adminUserId, employee, assignments) {
  const linkedAssignments = (assignments || []).filter(a => a.tenant_id && a.tenant_doctor_id);
  if (linkedAssignments.length === 0) {
    return { synced: false, reason: 'no-linked-assignments' };
  }

  const now = new Date();
  const defaultStart = new Date(now.getFullYear(), now.getMonth() - 23, 1);
  const earliestAssignedSince = linkedAssignments
    .map(a => a.assigned_since)
    .filter(Boolean)
    .sort()[0];
  const periodStart = earliestAssignedSince
    ? new Date(`${String(earliestAssignedSince).substring(0, 10)}T12:00:00`)
    : defaultStart;
  const periods = createMonthlyPeriods(periodStart < defaultStart ? defaultStart : periodStart, now, 24);
  if (periods.length === 0) {
    return { synced: false, reason: 'no-periods' };
  }

  const actualMinutesByMonth = new Map();
  const tokens = await getAllTenantTokens(adminUserId);
  const tokenMap = new Map(tokens.map(token => [token.id, token]));
  const rangeStart = periods[0].startDate;
  const rangeEnd = periods[periods.length - 1].endDate;
  const assignmentContext = new Map(); // tenantId -> { partTimeModel, fte }

  await Promise.all(linkedAssignments.map(async (assignment) => {
    const token = tokenMap.get(assignment.tenant_id);
    if (!token) return;

    await withTenantDb(token, async (pool) => {
      try {
        const [shiftCols] = await pool.execute(
          `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
           WHERE TABLE_NAME = 'ShiftEntry' AND TABLE_SCHEMA = DATABASE()`
        );
        const shiftColNames = new Set(shiftCols.map(col => col.COLUMN_NAME));
        const shiftSelectCols = ['doctor_id', 'date', 'position'];
        if (shiftColNames.has('start_time')) shiftSelectCols.push('start_time');
        if (shiftColNames.has('end_time')) shiftSelectCols.push('end_time');
        if (shiftColNames.has('break_minutes')) shiftSelectCols.push('break_minutes');
        if (shiftColNames.has('timeslot_id')) shiftSelectCols.push('timeslot_id');

        const [shifts] = await pool.execute(
          `SELECT ${shiftSelectCols.join(', ')}
           FROM ShiftEntry
           WHERE doctor_id = ? AND date >= ? AND date <= ?`,
          [assignment.tenant_doctor_id, rangeStart, rangeEnd]
        );

        // Teilzeitmodell + FTE des verknüpften Doctors laden, um das Soll
        // für das Modell "volle Tage mit freien Tagen" korrekt zu berechnen.
        let partTimeModel = null;
        let doctorFte = null;
        try {
          const [doctorCols] = await pool.execute(
            `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
             WHERE TABLE_NAME = 'Doctor' AND TABLE_SCHEMA = DATABASE()`
          );
          const doctorColNames = new Set(doctorCols.map(col => col.COLUMN_NAME));
          const selectParts = [];
          if (doctorColNames.has('part_time_model')) selectParts.push('part_time_model');
          if (doctorColNames.has('fte')) selectParts.push('fte');
          if (selectParts.length > 0) {
            const [docRows] = await pool.execute(
              `SELECT ${selectParts.join(', ')} FROM Doctor WHERE id = ? LIMIT 1`,
              [assignment.tenant_doctor_id]
            );
            if (docRows.length > 0) {
              partTimeModel = docRows[0].part_time_model || null;
              doctorFte = docRows[0].fte ?? null;
            }
          }
        } catch { /* Tabelle/Spalte fehlt → Standardberechnung */ }
        assignmentContext.set(assignment.tenant_id, { partTimeModel, fte: doctorFte });

        let timeslots = [];
        try {
          const [ts] = await pool.execute('SELECT id, start_time, end_time FROM WorkplaceTimeslot');
          timeslots = ts;
        } catch { /* table may not exist */ }

        let workplaces = [];
        try {
          const [workplaceCols] = await pool.execute(
            `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
             WHERE TABLE_NAME = 'Workplace' AND TABLE_SCHEMA = DATABASE()`
          );
          const workplaceColNames = new Set(workplaceCols.map(col => col.COLUMN_NAME));
          const workplaceSelectCols = ['name'];
          if (workplaceColNames.has('work_time_percentage')) workplaceSelectCols.push('work_time_percentage');
          if (workplaceColNames.has('service_type')) workplaceSelectCols.push('service_type');
          if (workplaceColNames.has('affects_availability')) workplaceSelectCols.push('affects_availability');
          if (workplaceColNames.has('allows_absence_overlap')) workplaceSelectCols.push('allows_absence_overlap');

          const [wp] = await pool.execute(`SELECT ${workplaceSelectCols.join(', ')} FROM Workplace`);
          workplaces = wp;
        } catch { /* ignore */ }

        const shiftsByDate = new Map();
        shifts.forEach((shift) => {
          const dateKey = typeof shift.date === 'string'
            ? shift.date.substring(0, 10)
            : format(shift.date, 'yyyy-MM-dd');
          if (!shiftsByDate.has(dateKey)) {
            shiftsByDate.set(dateKey, []);
          }
          shiftsByDate.get(dateKey).push(shift);
        });

        shiftsByDate.forEach((dayShifts, dateKey) => {
          const eligibleShifts = dayShifts.filter((shift) => {
            if (isNonWorkingShiftPosition(shift.position)) return false;

            const workplace = workplaces.find(w => w.name === shift.position);
            if (workplace?.service_type === 2) return false;
            if (workplace?.affects_availability === false) return false;
            return true;
          });

          if (eligibleShifts.length === 0) return;

          const intervals = eligibleShifts
            .map((shift) => {
              const workplace = workplaces.find(w => w.name === shift.position);
              const timeslot = shift.timeslot_id
                ? timeslots.find(t => t.id === shift.timeslot_id)
                : null;
              return shiftToInterval(shift, timeslot, workplace);
            })
            .filter(Boolean);

          const dayMinutes = mergeTimeIntervals(intervals);
          if (dayMinutes <= 0) return;

          const monthKey = dateKey.substring(0, 7);
          actualMinutesByMonth.set(monthKey, (actualMinutesByMonth.get(monthKey) || 0) + dayMinutes);
        });
      } catch (error) {
        console.warn(`[Master time-account sync] Tenant "${token.name}": ${error.message}`);
      }

      return [];
    });
  }));

  const [existingRows] = await db.execute(
    'SELECT * FROM TimeAccount WHERE employee_id = ? ORDER BY year ASC, month ASC',
    [employee.id]
  );
  const existingMap = new Map(existingRows.map(row => [getMonthKey(row.year, row.month), row]));

  const oldestPeriod = periods[0];
  let carryForwardMinutes = 0;
  const previousRows = existingRows.filter((row) => {
    if (row.year < oldestPeriod.year) return true;
    if (row.year === oldestPeriod.year && row.month < oldestPeriod.month) return true;
    return false;
  });
  if (previousRows.length > 0) {
    const seedRow = previousRows[previousRows.length - 1];
    carryForwardMinutes = Number(seedRow.carry_over_minutes || 0) + Number(seedRow.balance_minutes || 0);
  }

  for (const period of periods) {
    const existing = existingMap.get(period.key);
    if (existing?.status === 'closed') {
      carryForwardMinutes = Number(existing.carry_over_minutes || 0) + Number(existing.balance_minutes || 0);
      continue;
    }

    const targetMinutes = calculateMonthlyTargetMinutes(
      resolveEmployeeTargetWeeklyHours(employee) ?? 38.5,
      period.year,
      period.month,
      aggregatePartTimeContext(assignmentContext)
    );
    const actualMinutes = Math.round(actualMinutesByMonth.get(period.key) || 0);
    const balanceMinutes = actualMinutes - targetMinutes;
    const status = (period.year === now.getFullYear() && period.month === now.getMonth() + 1)
      ? 'open'
      : 'provisional';

    const id = existing?.id || crypto.randomUUID();
    await db.execute(
      `INSERT INTO TimeAccount (id, employee_id, year, month, target_minutes, actual_minutes, balance_minutes, carry_over_minutes, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         target_minutes = VALUES(target_minutes),
         actual_minutes = VALUES(actual_minutes),
         balance_minutes = VALUES(balance_minutes),
         carry_over_minutes = VALUES(carry_over_minutes),
         status = VALUES(status),
         updated_at = CURRENT_TIMESTAMP`,
      [id, employee.id, period.year, period.month, targetMinutes, actualMinutes, balanceMinutes, carryForwardMinutes, status]
    );

    carryForwardMinutes += balanceMinutes;
  }

  return { synced: true, periods: periods.length };
}

/**
 * Get all configured tenant database tokens from master DB
 */
async function getAllTenantTokens(adminUserId) {
  try {
    // Ensure db_tokens table exists
    await db.execute(`
      CREATE TABLE IF NOT EXISTS db_tokens (
        id VARCHAR(36) PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        token TEXT NOT NULL,
        host VARCHAR(255),
        db_name VARCHAR(100),
        description TEXT,
        is_active BOOLEAN DEFAULT FALSE,
        created_by VARCHAR(255),
        created_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);

    // Get admin's allowed_tenants
    const [adminRows] = await db.execute('SELECT allowed_tenants FROM app_users WHERE id = ?', [adminUserId]);
    const adminTenants = adminRows[0]?.allowed_tenants;
    let adminTenantList = null;
    if (adminTenants) {
      adminTenantList = typeof adminTenants === 'string' ? JSON.parse(adminTenants) : adminTenants;
    }

    const [rows] = await db.execute('SELECT * FROM db_tokens ORDER BY name ASC');

    // Filter by admin's allowed tenants
    let filtered = rows;
    if (adminTenantList && adminTenantList.length > 0) {
      filtered = rows.filter(t => adminTenantList.includes(t.id));
    }

    return filtered;
  } catch (err) {
    console.error('[Master API] Failed to get tenant tokens:', err.message);
    return [];
  }
}

/**
 * Create a temporary connection pool for a tenant, execute callback, then close
 */
async function withTenantDb(token, callback) {
  let pool = null;
  try {
    const config = parseDbToken(token.token);
    if (!config || !config.host || !config.database) {
      console.warn(`[Master API] Invalid token config for tenant "${token.name}" – host: ${config?.host}, db: ${config?.database}`);
      return null;
    }

    pool = createPool({
      host: config.host,
      port: parseInt(config.port || '3306'),
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

    const result = await callback(pool, token);
    return result;
  } catch (err) {
    console.error(`[Master API] Error querying tenant "${token.name}":`, err.message);
    return null;
  } finally {
    if (pool) {
      try { await pool.end(); } catch (e) { /* ignore */ }
    }
  }
}

/**
 * Execute a query across all (or specific) tenants, merge results
 */
async function queryAllTenants(adminUserId, tenantId, queryFn) {
  const tokens = await getAllTenantTokens(adminUserId);
  const targetTokens = tenantId
    ? tokens.filter(t => t.id === tenantId)
    : tokens;

  console.log(`[Master API] queryAllTenants: ${targetTokens.length} tenant(s) to query${tenantId ? ` (filtered to ${tenantId})` : ' (all)'}`);

  // Run all tenant queries in parallel for better performance
  const promises = targetTokens.map(async (token) => {
    try {
      const data = await withTenantDb(token, queryFn);
      if (data && data.length > 0) {
        console.log(`[Master API] Tenant "${token.name}": ${data.length} result(s)`);
      } else {
        console.log(`[Master API] Tenant "${token.name}": 0 results (data=${data === null ? 'null' : '[]'})`);
      }
      return data || [];
    } catch (e) {
      console.error(`[Master API] Tenant "${token.name}" failed:`, e.message);
      return [];
    }
  });

  const resultArrays = await Promise.all(promises);
  const results = resultArrays.flat();
  console.log(`[Master API] queryAllTenants total: ${results.length} result(s)`);
  return results;
}

async function repairTenantCentralEmployeeLinks(adminUserId, tenantId = null) {
  const [assignments] = await db.execute(
    `SELECT employee_id, tenant_id, tenant_doctor_id
     FROM EmployeeTenantAssignment
     WHERE tenant_doctor_id IS NOT NULL
       AND tenant_doctor_id != ''
       ${tenantId ? 'AND tenant_id = ?' : ''}`,
    tenantId ? [tenantId] : []
  );

  if (assignments.length === 0) {
    return { repaired: 0, checked: 0 };
  }

  const tokens = await getAllTenantTokens(adminUserId);
  const targetTokens = tenantId ? tokens.filter((token) => String(token.id) === String(tenantId)) : tokens;
  const assignmentsByTenant = new Map();

  assignments.forEach((assignment) => {
    const key = String(assignment.tenant_id);
    if (!assignmentsByTenant.has(key)) {
      assignmentsByTenant.set(key, []);
    }
    assignmentsByTenant.get(key).push(assignment);
  });

  let repaired = 0;
  let checked = 0;

  await Promise.all(targetTokens.map(async (token) => {
    const tenantAssignments = assignmentsByTenant.get(String(token.id)) || [];
    if (tenantAssignments.length === 0) return;

    await withTenantDb(token, async (pool) => {
      try {
        const [cols] = await pool.execute(
          `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
           WHERE TABLE_NAME = 'Doctor' AND TABLE_SCHEMA = DATABASE() AND COLUMN_NAME = 'central_employee_id'`
        );
        if (cols.length === 0) return [];

        for (const assignment of tenantAssignments) {
          checked += 1;
          const [result] = await pool.execute(
            `UPDATE Doctor
             SET central_employee_id = ?
             WHERE id = ?
               AND (central_employee_id IS NULL OR central_employee_id = '' OR central_employee_id != ?)`,
            [assignment.employee_id, assignment.tenant_doctor_id, assignment.employee_id]
          );
          repaired += Number(result?.affectedRows || 0);
        }
      } catch (error) {
        console.warn(`[Master staff] Link repair failed for tenant "${token.name}": ${error.message}`);
      }

      return [];
    });
  }));

  return { repaired, checked };
}

// ============ ROUTES ============

/**
 * GET /api/master/stats
 * Aggregated statistics across all tenants
 */
router.get('/stats', async (req, res, next) => {
  try {
    const tokens = await getAllTenantTokens(req.user.sub);
    const today = format(new Date(), 'yyyy-MM-dd');

    let totalStaff = 0;
    let absencesToday = 0;

    for (const token of tokens) {
      await withTenantDb(token, async (pool) => {
        try {
          // Count active staff (handle missing is_active column)
          let staffQuery;
          try {
            const [testCols] = await pool.execute(
              `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS 
               WHERE TABLE_NAME = 'Doctor' AND COLUMN_NAME = 'is_active' AND TABLE_SCHEMA = DATABASE()`
            );
            staffQuery = testCols.length > 0
              ? 'SELECT COUNT(*) as cnt FROM Doctor WHERE is_active = 1'
              : 'SELECT COUNT(*) as cnt FROM Doctor';
          } catch {
            staffQuery = 'SELECT COUNT(*) as cnt FROM Doctor';
          }
          const [staffRows] = await pool.execute(staffQuery);
          totalStaff += staffRows[0]?.cnt || 0;

          // Count today's absences
          const [absRows] = await pool.execute(
            `SELECT COUNT(*) as cnt FROM ShiftEntry 
             WHERE date = ? AND position IN ('Urlaub', 'Krank', 'Frei', 'Nicht verfügbar', 'Dienstreise')`,
            [today]
          );
          absencesToday += absRows[0]?.cnt || 0;
        } catch (e) {
          console.warn(`[Master stats] Tenant "${token.name}":`, e.message);
        }
        return [];
      });
    }

    res.json({
      totalStaff,
      absencesToday,
      tenantCount: tokens.length,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/master/staff?tenantId=xxx
 * Staff list across all tenants
 */
router.get('/staff', async (req, res, next) => {
  try {
    const { tenantId } = req.query;
    console.log(`[Master staff] Request: tenantId=${tenantId || 'all'}, user=${req.user.sub}`);

    try {
      const repairResult = await repairTenantCentralEmployeeLinks(req.user.sub, tenantId || null);
      if (repairResult.repaired > 0) {
        console.log(`[Master staff] Repaired ${repairResult.repaired} tenant link(s) before staff listing`);
      }
    } catch (repairError) {
      console.warn(`[Master staff] Link repair skipped: ${repairError.message}`);
    }

    const staff = await queryAllTenants(req.user.sub, tenantId, async (pool, token) => {
      try {
        // Discover available columns to handle schema differences across tenants
        const [cols] = await pool.execute(
          `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'Doctor' AND TABLE_SCHEMA = DATABASE()`
        );
        const colNames = new Set(cols.map(c => c.COLUMN_NAME));

        // Build a safe SELECT with only existing columns
        const selectCols = ['id', 'name'];
        if (colNames.has('role')) selectCols.push('role');
        if (colNames.has('is_active')) selectCols.push('is_active');
        if (colNames.has('qualifications')) selectCols.push('qualifications');
        if (colNames.has('notes')) selectCols.push('notes');
        if (colNames.has('color')) selectCols.push('color');
        if (colNames.has('central_employee_id')) selectCols.push('central_employee_id');
        if (colNames.has('work_time_model_id')) selectCols.push('work_time_model_id');
        if (colNames.has('target_hours_per_week')) selectCols.push('target_hours_per_week');

        const [rows] = await pool.execute(
          `SELECT ${selectCols.join(', ')} FROM Doctor ORDER BY name`
        );
        console.log(`[Master staff] Tenant "${token.name}": found ${rows.length} doctor(s) (cols: ${selectCols.join(',')})`);
        return rows.map(r => ({
          id: r.id,
          name: r.name,
          role: r.role || null,
          is_active: colNames.has('is_active') ? !!r.is_active : true,
          qualifications: r.qualifications || null,
          notes: r.notes || null,
          central_employee_id: r.central_employee_id || null,
          work_time_model_id: r.work_time_model_id || null,
          target_hours_per_week: r.target_hours_per_week || null,
          tenantId: token.id,
          tenantName: token.name,
        }));
      } catch (e) {
        console.error(`[Master staff] Tenant "${token.name}" query failed:`, e.message);
        return [];
      }
    });

    console.log(`[Master staff] Returning ${staff.length} staff members`);
    res.json({ staff });
  } catch (error) {
    console.error('[Master staff] Route error:', error);
    next(error);
  }
});

/**
 * GET /api/master/staff/:tenantId/:employeeId
 * Single employee detail from a specific tenant
 */
router.get('/staff/:tenantId/:employeeId', async (req, res, next) => {
  try {
    const { tenantId, employeeId } = req.params;
    console.log(`[Master staff-detail] Request: tenantId=${tenantId}, employeeId=${employeeId}`);

    const results = await queryAllTenants(req.user.sub, tenantId, async (pool, token) => {
      try {
        // Basic doctor info – use SELECT * to handle varying schemas
        const [rows] = await pool.execute(
          'SELECT * FROM Doctor WHERE id = ?',
          [employeeId]
        );
        if (rows.length === 0) {
          console.log(`[Master staff-detail] Tenant "${token.name}": doctor ${employeeId} not found`);
          return [];
        }

        const doc = rows[0];

        // Public holidays for workday filtering (includes manual corrections from master DB)
        const currentYear = new Date().getFullYear();
        const publicHolidayDates = await getPublicHolidayDatesForYear(currentYear);

        // Absences for current year (Schichturlaub added so migrated rows
        // remain visible in this legacy per-tenant view; the central detail
        // endpoint also computes its own separate Shifturlaub balance).
        const absencePositions = ['Urlaub', 'Schichturlaub', 'Krank', 'Frei', 'Dienstreise', 'Nicht verfügbar', 'Fortbildung', 'Kongress', 'Elternzeit', 'Mutterschutz'];
        const placeholders = absencePositions.map(() => '?').join(',');
        let absences = [];
        try {
          const [absRows] = await pool.execute(
            `SELECT date, position, note FROM ShiftEntry 
             WHERE doctor_id = ? AND YEAR(date) = ? AND position IN (${placeholders})
             ORDER BY date`,
            [employeeId, currentYear, ...absencePositions]
          );
          // Group consecutive days into ranges
          absences = absRows.map(r => ({
            type: r.position,
            from: typeof r.date === 'string' ? r.date.substring(0, 10) : format(r.date, 'yyyy-MM-dd'),
            to: typeof r.date === 'string' ? r.date.substring(0, 10) : format(r.date, 'yyyy-MM-dd'),
            days: 1,
            note: r.note || null,
          }));
        } catch (e) {
          console.warn(`[Master staff-detail] Absences query failed:`, e.message);
        }

        // Vacation counts: only count workdays (Mon-Fri, no public holidays)
        const today = format(new Date(), 'yyyy-MM-dd');
        const vacationDays = absences.filter(a => {
          if (a.type !== 'Urlaub') return false;
          const d = new Date(a.from + 'T12:00:00');
          const dayOfWeek = d.getDay(); // 0=Sun, 6=Sat
          if (dayOfWeek === 0 || dayOfWeek === 6) return false;
          // Check if this date is a public holiday
          if (publicHolidayDates && publicHolidayDates.has(a.from)) return false;
          return true;
        });
        const vacationTaken = vacationDays.filter(a => a.from <= today).length;
        const vacationPlanned = vacationDays.filter(a => a.from > today).length;

        return [{
          id: doc.id,
          name: doc.name,
          email: doc.email || null,
          phone: doc.phone || null,
          role: doc.role || null,
          is_active: !!doc.is_active,
          qualifications: doc.qualifications || null,
          notes: doc.notes || null,
          payroll_id: doc.payroll_id || null,
          address: doc.address || null,
          contract_start: doc.contract_start || null,
          contract_end: doc.contract_end || null,
          probation_end: doc.probation_end || null,
          target_hours_per_week: doc.target_hours_per_week || null,
          vk_share: doc.vk_share || null,
          work_time_percentage: doc.work_time_percentage || null,
          special_status: doc.special_status || null,
          central_employee_id: doc.central_employee_id || null,
          work_time_model_id: doc.work_time_model_id || null,
          vacation_days_total: doc.vacation_days || 30,
          vacation_days_taken: vacationTaken,
          vacation_days_planned: vacationPlanned,
          remaining_vacation: (doc.vacation_days || 30) - vacationTaken - vacationPlanned,
          overtime_balance: null,
          current_month_actual: null,
          month_closed: false,
          absences,
          time_accounts: [],
          tenantId: token.id,
          tenantName: token.name,
        }];
      } catch (e) {
        console.error(`[Master staff-detail] Tenant "${token.name}" query failed:`, e.message);
        return [];
      }
    });

    if (results.length === 0) {
      return res.status(404).json({ error: 'Mitarbeiter nicht gefunden' });
    }

    res.json(results[0]);
  } catch (error) {
    console.error('[Master staff-detail] Route error:', error);
    next(error);
  }
});

/**
 * GET /api/master/certificates/:tenantId/:employeeId
 * List qualification certificates stored in master DB for a single employee.
 * Read-only metadata view (no binary file data) for the Master Frontend.
 */
router.get('/certificates/:tenantId/:employeeId', async (req, res, next) => {
  try {
    const { tenantId, employeeId } = req.params;
    console.log(`[Master certificates] Request: tenantId=${tenantId}, employeeId=${employeeId}`);

    const tokens = await getAllTenantTokens(req.user.sub);
    const token = tokens.find(t => t.id === tenantId);
    if (!token) {
      return res.status(404).json({ error: 'Mandant nicht gefunden oder kein Zugriff' });
    }

    const config = parseDbToken(token.token);
    if (!config?.host || !config?.database) {
      return res.status(500).json({ error: 'Mandanten-DB-Konfiguration ungültig' });
    }
    const tenantKey = crypto
      .createHash('sha256')
      .update(`${config.host}:${config.database}`)
      .digest('hex');

    // Verify the employee exists in this tenant before exposing any certificate metadata
    await withTenantDb(token, async (pool) => {
      const [rows] = await pool.execute('SELECT id, name FROM Doctor WHERE id = ? LIMIT 1', [employeeId]);
      if (rows.length === 0) {
        const err = new Error('Mitarbeiter im Mandanten nicht gefunden');
        err.status = 404;
        throw err;
      }
    });

    const [certRows] = await db.execute(
      `SELECT id, qualification_id, evidence_role, file_name, mime_type, file_size,
              granted_date, expiry_date, notes, uploaded_by, uploaded_at, updated_at,
              analysis_status, analysis_is_certificate, analysis_scope_match,
              analysis_scope_detected, analysis_confidence, analysis_reasoning,
              analysis_detected_granted, analysis_detected_expiry, analyzed_at
         FROM QualificationCertificate
        WHERE tenant_key = ? AND doctor_id = ?
        ORDER BY uploaded_at DESC`,
      [tenantKey, employeeId]
    );

    res.json({
      employeeId,
      tenantId,
      certificates: certRows,
    });
  } catch (error) {
    if (error.status) {
      return res.status(error.status).json({ error: error.message });
    }
    console.error('[Master certificates] Route error:', error);
    next(error);
  }
});

/**
 * GET /api/master/certificates/:tenantId/:employeeId/:certificateId/download
 * Stream a single certificate file from master DB. Admin-only, tenant-scoped.
 */
router.get('/certificates/:tenantId/:employeeId/:certificateId/download', async (req, res, next) => {
  try {
    const { tenantId, employeeId, certificateId } = req.params;

    const tokens = await getAllTenantTokens(req.user.sub);
    const token = tokens.find(t => t.id === tenantId);
    if (!token) {
      return res.status(404).json({ error: 'Mandant nicht gefunden oder kein Zugriff' });
    }

    const config = parseDbToken(token.token);
    if (!config?.host || !config?.database) {
      return res.status(500).json({ error: 'Mandanten-DB-Konfiguration ungültig' });
    }
    const tenantKey = crypto
      .createHash('sha256')
      .update(`${config.host}:${config.database}`)
      .digest('hex');

    const [rows] = await db.execute(
      `SELECT id, file_name, mime_type, file_data
         FROM QualificationCertificate
        WHERE id = ? AND tenant_key = ? AND doctor_id = ?
        LIMIT 1`,
      [certificateId, tenantKey, employeeId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Zertifikat nicht gefunden' });
    }

    const cert = rows[0];
    res.setHeader('Content-Type', cert.mime_type);
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(cert.file_name)}"`);
    return res.send(cert.file_data);
  } catch (error) {
    console.error('[Master certificate download] Route error:', error);
    next(error);
  }
});

/**
 * GET /api/master/absences?year=2026&month=02&tenantId=xxx
 * Absences across all tenants for a given month
 */
router.get('/absences', async (req, res, next) => {
  try {
    const { year, month, tenantId } = req.query;
    const y = parseInt(year) || new Date().getFullYear();
    const m = parseInt(month) || (new Date().getMonth() + 1);
    const startDate = `${y}-${String(m).padStart(2, '0')}-01`;
    const daysInMonth = getDaysInMonth(new Date(y, m - 1));
    const endDate = `${y}-${String(m).padStart(2, '0')}-${String(daysInMonth).padStart(2, '0')}`;

    const absenceTypes = ['Urlaub', 'Krank', 'Frei', 'Dienstreise', 'Nicht verfügbar', 'Fortbildung', 'Kongress'];

    const entries = await queryAllTenants(req.user.sub, tenantId, async (pool, token) => {
      try {
        const placeholders = absenceTypes.map(() => '?').join(',');
        const [rows] = await pool.execute(
          `SELECT se.date, se.position, se.note, d.name as doctor_name
           FROM ShiftEntry se
           JOIN Doctor d ON se.doctor_id = d.id
           WHERE se.date >= ? AND se.date <= ? AND se.position IN (${placeholders})
           ORDER BY se.date, d.name`,
          [startDate, endDate, ...absenceTypes]
        );
        return rows.map(r => ({
          date: typeof r.date === 'string' ? r.date.substring(0, 10) : format(r.date, 'yyyy-MM-dd'),
          type: r.position,
          staffName: r.doctor_name,
          note: r.note || null,
          tenantId: token.id,
          tenantName: token.name,
        }));
      } catch (e) {
        console.warn(`[Master absences] Tenant "${token.name}":`, e.message);
        return [];
      }
    });

    // Summary: count by type
    const summary = {};
    absenceTypes.forEach(t => { summary[t] = 0; });
    entries.forEach(e => {
      if (summary[e.type] !== undefined) summary[e.type]++;
    });

    res.json({ entries, summary });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/master/time-tracking?year=2026&month=02&tenantId=xxx
 * Working time data (Soll/Ist) across all tenants for a given month
 */
router.get('/time-tracking', async (req, res, next) => {
  try {
    const { year, month, tenantId } = req.query;
    const y = parseInt(year) || new Date().getFullYear();
    const m = parseInt(month) || (new Date().getMonth() + 1);
    const startDate = `${y}-${String(m).padStart(2, '0')}-01`;
    const daysInMonth = getDaysInMonth(new Date(y, m - 1));
    const endDate = `${y}-${String(m).padStart(2, '0')}-${String(daysInMonth).padStart(2, '0')}`;

    const entries = await queryAllTenants(req.user.sub, tenantId, async (pool, token) => {
      try {
        // Get all active doctors
        const [doctors] = await pool.execute(
          'SELECT id, name, role FROM Doctor WHERE is_active = 1 ORDER BY name'
        );

        // Get shifts for month
        const [shifts] = await pool.execute(
          'SELECT doctor_id, date, position, start_time, end_time, timeslot_id FROM ShiftEntry WHERE date >= ? AND date <= ?',
          [startDate, endDate]
        );

        // Get timeslots (may not exist)
        let timeslots = [];
        try {
          const [ts] = await pool.execute('SELECT id, start_time, end_time FROM WorkplaceTimeslot');
          timeslots = ts;
        } catch { /* table may not exist */ }

        // Get workplaces for work_time_percentage, service_type and availability relevance
        let workplaces = [];
        try {
          const [wp] = await pool.execute('SELECT name, work_time_percentage, service_type, affects_availability FROM Workplace');
          workplaces = wp;
        } catch { /* ignore */ }

        // Calculate per doctor
        return doctors.map(doc => {
          const docShifts = shifts.filter(s => s.doctor_id === doc.id);
          const shiftsByDate = {};
          docShifts.forEach(s => {
            const d = typeof s.date === 'string' ? s.date.substring(0, 10) : format(s.date, 'yyyy-MM-dd');
            if (!shiftsByDate[d]) shiftsByDate[d] = [];
            shiftsByDate[d].push(s);
          });

          let totalMinutes = 0;
          let workDays = 0;

          Object.values(shiftsByDate).forEach((dayShifts) => {
            const workShifts = dayShifts.filter(s => {
              if (isNonWorkingShiftPosition(s.position)) return false;

              const wp = workplaces.find(w => w.name === s.position);
              if (wp?.affects_availability === false) return false;
              return wp?.service_type !== 2;
            });
            if (workShifts.length === 0) return;

            const intervals = [];

            workShifts.forEach(shift => {
              const wp = workplaces.find(w => w.name === shift.position);
              const ts = shift.timeslot_id
                ? timeslots.find(t => t.id === shift.timeslot_id)
                : null;

              intervals.push(shiftToInterval(shift, ts, wp));
            });

            const dayMinutes = mergeTimeIntervals(intervals);
            if (dayMinutes <= 0) return;

            workDays++;
            totalMinutes += dayMinutes;
          });

          // Soll: 8h * working days in month (simple approximation)
          // TODO: Use target_hours_per_week from doctor when available
          const targetHours = (daysInMonth * 5 / 7 * 8).toFixed(1); // ~workdays * 8h

          return {
            staffName: doc.name,
            role: doc.role || '–',
            targetHours: parseFloat(targetHours),
            actualHours: parseFloat((totalMinutes / 60).toFixed(1)),
            workDays,
            tenantId: token.id,
            tenantName: token.name,
          };
        });
      } catch (e) {
        console.warn(`[Master time-tracking] Tenant "${token.name}":`, e.message);
        return [];
      }
    });

    // Summary
    const staffCount = entries.length;
    const totalTargetHours = parseFloat(entries.reduce((s, e) => s + e.targetHours, 0).toFixed(1));
    const totalActualHours = parseFloat(entries.reduce((s, e) => s + e.actualHours, 0).toFixed(1));
    const totalDelta = parseFloat((totalActualHours - totalTargetHours).toFixed(1));

    res.json({
      entries,
      summary: {
        staffCount,
        totalTargetHours,
        totalActualHours,
        totalDelta,
      },
    });
  } catch (error) {
    next(error);
  }
});

// Helper: Convert "HH:MM:SS" to minutes
function timeToMin(timeStr) {
  if (!timeStr) return 0;
  const parts = String(timeStr).split(':');
  return parseInt(parts[0]) * 60 + parseInt(parts[1] || 0);
}

// ============ CENTRAL HOLIDAYS & VACATIONS MANAGEMENT ============

// State code mapping
const STATES = {
  'BW': 'Baden-Württemberg', 'BY': 'Bayern', 'BE': 'Berlin', 'BB': 'Brandenburg',
  'HB': 'Bremen', 'HH': 'Hamburg', 'HE': 'Hessen', 'MV': 'Mecklenburg-Vorpommern',
  'NI': 'Niedersachsen', 'NW': 'Nordrhein-Westfalen', 'RP': 'Rheinland-Pfalz',
  'SL': 'Saarland', 'SN': 'Sachsen', 'ST': 'Sachsen-Anhalt',
  'SH': 'Schleswig-Holstein', 'TH': 'Thüringen'
};

/**
 * Ensure central holiday tables exist
 */
async function ensureCentralHolidayTables() {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS holiday_settings (
      \`key\` VARCHAR(100) PRIMARY KEY,
      \`value\` TEXT NOT NULL,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);
  await db.execute(`INSERT IGNORE INTO holiday_settings (\`key\`, \`value\`) VALUES ('federal_state', 'MV')`);
  await db.execute(`INSERT IGNORE INTO holiday_settings (\`key\`, \`value\`) VALUES ('show_school_holidays', 'true')`);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS custom_holidays (
      id VARCHAR(36) PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      start_date DATE NOT NULL,
      end_date DATE DEFAULT NULL,
      type ENUM('public', 'school') NOT NULL DEFAULT 'public',
      action ENUM('add', 'remove') NOT NULL DEFAULT 'add',
      created_by VARCHAR(255) DEFAULT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

/**
 * GET /api/master/holidays/settings
 * Returns central holiday settings (federal_state, show_school_holidays)
 */
router.get('/holidays/settings', async (req, res, next) => {
  try {
    await ensureCentralHolidayTables();
    const [rows] = await db.execute('SELECT * FROM holiday_settings');
    const settings = {};
    rows.forEach(r => { settings[r.key] = r.value; });
    res.json({ settings, states: STATES });
  } catch (error) {
    console.error('[Master holidays] Settings error:', error);
    next(error);
  }
});

/**
 * PUT /api/master/holidays/settings
 * Update a central holiday setting
 * Body: { key: 'federal_state', value: 'MV' }
 */
router.put('/holidays/settings', async (req, res, next) => {
  try {
    const { key, value } = req.body;
    if (!key || value === undefined) {
      return res.status(400).json({ error: 'key and value required' });
    }
    const allowedKeys = ['federal_state', 'show_school_holidays'];
    if (!allowedKeys.includes(key)) {
      return res.status(400).json({ error: `Unknown setting: ${key}` });
    }
    await ensureCentralHolidayTables();
    await db.execute(
      'INSERT INTO holiday_settings (`key`, `value`) VALUES (?, ?) ON DUPLICATE KEY UPDATE `value` = VALUES(`value`)',
      [key, String(value)]
    );
    console.log(`[Master holidays] Setting updated: ${key} = ${value} by user ${req.user.sub}`);
    clearHolidayCache();
    res.json({ success: true });
  } catch (error) {
    console.error('[Master holidays] Update setting error:', error);
    next(error);
  }
});

/**
 * GET /api/master/holidays/custom
 * List all custom holiday corrections
 */
router.get('/holidays/custom', async (req, res, next) => {
  try {
    await ensureCentralHolidayTables();
    const [rows] = await db.execute('SELECT * FROM custom_holidays ORDER BY start_date');
    res.json(rows);
  } catch (error) {
    console.error('[Master holidays] List custom error:', error);
    next(error);
  }
});

/**
 * POST /api/master/holidays/custom
 * Add a custom holiday correction
 * Body: { name, start_date, end_date?, type: 'public'|'school', action: 'add'|'remove' }
 */
router.post('/holidays/custom', async (req, res, next) => {
  try {
    const { name, start_date, end_date, type, action } = req.body;
    if (!name || !start_date || !type || !action) {
      return res.status(400).json({ error: 'name, start_date, type, and action are required' });
    }

    const id = crypto.randomUUID();
    await ensureCentralHolidayTables();
    await db.execute(
      'INSERT INTO custom_holidays (id, name, start_date, end_date, type, action, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [id, name, start_date, end_date || null, type, action, req.user.sub]
    );

    console.log(`[Master holidays] Custom holiday created: ${name} (${type}/${action}) by user ${req.user.sub}`);
    clearHolidayCache();
    res.json({ id, name, start_date, end_date, type, action });
  } catch (error) {
    console.error('[Master holidays] Create custom error:', error);
    next(error);
  }
});

/**
 * DELETE /api/master/holidays/custom/:id
 * Delete a custom holiday correction
 */
router.delete('/holidays/custom/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    await ensureCentralHolidayTables();
    await db.execute('DELETE FROM custom_holidays WHERE id = ?', [id]);
    console.log(`[Master holidays] Custom holiday deleted: ${id} by user ${req.user.sub}`);
    clearHolidayCache();
    res.json({ success: true });
  } catch (error) {
    console.error('[Master holidays] Delete custom error:', error);
    next(error);
  }
});

/**
 * GET /api/master/holidays/preview?year=YYYY
 * Preview the fully resolved holidays for a year (as tenants would see them)
 */
router.get('/holidays/preview', async (req, res, next) => {
  try {
    const { year } = req.query;
    if (!year) return res.status(400).json({ error: 'year required' });

    // Fetch the same data that tenants get
    const response = await fetch(`http://localhost:${process.env.PORT || 3000}/api/holidays?year=${year}`);
    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error('[Master holidays] Preview error:', error);
    next(error);
  }
});

// ============ CENTRAL EMPLOYEE MANAGEMENT ============

/**
 * GET /api/master/employees
 * List all central employees (with optional search)
 */
router.get('/employees', async (req, res, next) => {
  try {
    const { q, active } = req.query;
    let sql = `SELECT e.*, wtm.name as work_time_model_name, wtm.hours_per_week as model_hours_per_week,
               pst.name as tariff_name, pst.short_name as tariff_short_name, pst.default_weekly_hours as tariff_default_weekly_hours,
               psg.name as group_name
               FROM Employee e
               LEFT JOIN WorkTimeModel wtm ON e.work_time_model_id = wtm.id
               LEFT JOIN PayScaleTariff pst ON e.payscale_tariff_id = pst.id
               LEFT JOIN PayScaleGroup psg ON e.payscale_group_id = psg.id`;
    const params = [];
    const conditions = [];

    if (active !== undefined) {
      conditions.push('e.is_active = ?');
      params.push(active === 'true' || active === '1' ? 1 : 0);
    }
    if (q) {
      conditions.push('(e.last_name LIKE ? OR e.first_name LIKE ? OR e.payroll_id LIKE ?)');
      const like = `%${q}%`;
      params.push(like, like, like);
    }

    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }
    sql += ' ORDER BY e.last_name, e.first_name';

    const [rows] = await db.execute(sql, params);

    // Enrich with tenant assignments
    const [assignments] = await db.execute(
      `SELECT eta.*, dt.name as tenant_name 
       FROM EmployeeTenantAssignment eta 
       LEFT JOIN db_tokens dt ON eta.tenant_id COLLATE utf8mb4_general_ci = dt.id`
    );

    const employees = rows.map(emp => ({
      ...emp,
      is_active: !!emp.is_active,
      assignments: assignments.filter(a => a.employee_id === emp.id).map(a => ({
        id: a.id,
        tenant_id: a.tenant_id,
        tenant_name: a.tenant_name,
        tenant_doctor_id: a.tenant_doctor_id,
        fte_share: a.fte_share,
        is_primary: !!a.is_primary,
        assigned_since: a.assigned_since,
      })),
    }));

    res.json({ employees });
  } catch (error) {
    console.error('[Master employees] List error:', error);
    next(error);
  }
});

/**
 * POST /api/master/employees/sync-time-accounts
 * Recalculate time accounts for all linked central employees
 */
router.post('/employees/sync-time-accounts', async (req, res, next) => {
  try {
    const [employees] = await db.execute(
      `SELECT e.*, wtm.hours_per_week as model_hours_per_week
       FROM Employee e
       LEFT JOIN WorkTimeModel wtm ON e.work_time_model_id = wtm.id
       ORDER BY e.last_name ASC, e.first_name ASC`
    );
    const [allAssignments] = await db.execute(
      `SELECT eta.*, dt.name as tenant_name
       FROM EmployeeTenantAssignment eta
       LEFT JOIN db_tokens dt ON eta.tenant_id COLLATE utf8mb4_general_ci = dt.id`
    );

    const linkedEmployees = employees.filter((employee) =>
      allAssignments.some((assignment) =>
        assignment.employee_id === employee.id && assignment.tenant_id && assignment.tenant_doctor_id
      )
    );

    let syncedEmployees = 0;
    const skippedEmployees = employees.length - linkedEmployees.length;

    for (const employee of linkedEmployees) {
      const assignments = allAssignments.filter((assignment) => assignment.employee_id === employee.id);
      await syncEmployeeWorkSettingsForAssignments(req.user.sub, employee, assignments, {
        id: req.user.sub,
        email: req.user.email || null,
      });
      const result = await syncTimeAccountsForEmployee(req.user.sub, employee, assignments);
      if (result?.synced) {
        syncedEmployees += 1;
      }
    }

    res.json({
      success: true,
      totalEmployees: employees.length,
      linkedEmployees: linkedEmployees.length,
      syncedEmployees,
      skippedEmployees,
    });
  } catch (error) {
    console.error('[Master employees] Global time-account sync error:', error);
    next(error);
  }
});

/**
 * POST /api/master/employees/migrate-linked-absences
 * Manually migrates existing absence rows for already-linked tenant doctors
 * into the central absence storage.
 * Body: { tenant_id?, employee_id? }
 */
router.post('/employees/migrate-linked-absences', async (req, res, next) => {
  try {
    const { tenant_id = null, employee_id = null, dry_run = false, purge_empty_dates = false, resolve_conflicts = false } = req.body || {};
    // Opt-in only: never delete empty-date tenant absence rows during the
    // regular migration. The admin must confirm a second pass to clean up
    // rows whose date is genuinely empty (null/empty string). Garbage string
    // dates are NEVER deleted — the admin must fix them in the tenant first.
    const purgeEmptyDates = Boolean(purge_empty_dates) && !dry_run;
    // Opt-in only: the regular migration must never overwrite a central
    // absence for the same day, even when the local row has a higher
    // priority. Ties are NEVER auto-resolved either.
    const resolveConflicts = Boolean(resolve_conflicts) && !dry_run;
    const tokens = await getAllTenantTokens(req.user.sub);
    const tokenMap = new Map(tokens.map((token) => [String(token.id), token]));

    if (tenant_id && !tokenMap.has(String(tenant_id))) {
      return res.status(403).json({ error: 'Kein Zugriff auf diesen Mandanten' });
    }

    const filters = [];
    const params = [];
    if (tenant_id) {
      filters.push('eta.tenant_id = ?');
      params.push(tenant_id);
    }
    if (employee_id) {
      filters.push('eta.employee_id = ?');
      params.push(employee_id);
    }

    const whereClause = filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : '';
    // db_tokens was created before the master schema adopted utf8mb4_unicode_ci
    // and still uses the server's default (utf8mb4_general_ci on this MySQL
    // instance). Force the join column to match EmployeeTenantAssignment's
    // collation so the query plan can use the PK index on db_tokens.id.
    const [assignmentRows] = await db.execute(
      `SELECT eta.employee_id, eta.tenant_id, eta.tenant_doctor_id,
              e.first_name, e.last_name,
              dt.name AS tenant_name
         FROM EmployeeTenantAssignment eta
         LEFT JOIN Employee e ON e.id = eta.employee_id
         LEFT JOIN db_tokens dt ON dt.id COLLATE utf8mb4_unicode_ci = eta.tenant_id
         ${whereClause}
        ORDER BY dt.name ASC, e.last_name ASC, e.first_name ASC`,
      params
    );

    const assignments = assignmentRows
      .filter((row) => row.tenant_id && row.tenant_doctor_id && tokenMap.has(String(row.tenant_id)))
      .map((row) => ({
        employee_id: row.employee_id,
        employee_name: [row.first_name, row.last_name].filter(Boolean).join(' ').trim() || row.last_name || null,
        tenant_id: row.tenant_id,
        tenant_name: row.tenant_name || null,
        tenant_doctor_id: row.tenant_doctor_id,
      }));

    const migrationResult = await migrateLinkedAssignmentsToCentral({
      assignments,
      tokensById: tokenMap,
      withTenantDb,
      masterDb: db,
      dryRun: Boolean(dry_run),
      purgeEmptyDates,
      resolveConflicts,
    });

    console.log(
      `[Master employees] ${migrationResult.dryRun ? 'Previewed' : 'Migrated'} linked absences for ${migrationResult.migratedAssignments}/${migrationResult.totalAssignments} assignment(s)${purgeEmptyDates ? ` (purged ${migrationResult.purgedEmptyAbsences} empty-date row(s))` : ''}${resolveConflicts ? ` (resolved ${migrationResult.resolvedConflicts} conflict(s), ${migrationResult.unresolvedConflicts} still open)` : ''} by user ${req.user.sub}`
    );

    res.json(migrationResult);
  } catch (error) {
    console.error('[Master employees] Linked absence migration error:', error);
    next(error);
  }
});

/**
 * GET /api/master/employees/:id
 * Single employee detail with assignments and time accounts
 */
router.get('/employees/:id', async (req, res, next) => {
  try {
    const { id } = req.params;

    const [rows] = await db.execute(
      `SELECT e.*, wtm.name as work_time_model_name, wtm.hours_per_week as model_hours_per_week,
              pst.name as tariff_name, pst.short_name as tariff_short_name, pst.default_weekly_hours as tariff_default_weekly_hours,
              pst.default_vacation_days as tariff_default_vacation_days,
              psg.name as group_name
       FROM Employee e
       LEFT JOIN WorkTimeModel wtm ON e.work_time_model_id = wtm.id
       LEFT JOIN PayScaleTariff pst ON e.payscale_tariff_id = pst.id
       LEFT JOIN PayScaleGroup psg ON e.payscale_group_id = psg.id
       WHERE e.id = ?`,
      [id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Mitarbeiter nicht gefunden' });
    }
    const emp = rows[0];

    // Tenant assignments
    const [assignments] = await db.execute(
      `SELECT eta.*, dt.name as tenant_name 
       FROM EmployeeTenantAssignment eta 
       LEFT JOIN db_tokens dt ON eta.tenant_id COLLATE utf8mb4_general_ci = dt.id
       WHERE eta.employee_id = ?`,
      [id]
    );

    try {
      await syncEmployeeWorkSettingsForAssignments(req.user.sub, emp, assignments, {
        id: req.user.sub,
        email: req.user.email || null,
      });
      await syncTimeAccountsForEmployee(req.user.sub, emp, assignments);
    } catch (syncError) {
      console.warn(`[Master employees] Time-account sync failed for ${id}: ${syncError.message}`);
    }

    // Time accounts
    const [timeAccounts] = await db.execute(
      `SELECT * FROM TimeAccount WHERE employee_id = ? ORDER BY year DESC, month DESC LIMIT 24`,
      [id]
    );

    // Vacation + absences aggregated across all linked tenants
    const empVacationDaysTotal = emp.vacation_days_annual != null ? Number(emp.vacation_days_annual) : 30;
    const vacationSummary = await aggregateVacationAcrossTenants(
      req.user.sub,
      assignments,
      empVacationDaysTotal,
      id
    );

    res.json({
      ...emp,
      is_active: !!emp.is_active,
      assignments: assignments.map(a => ({
        id: a.id,
        tenant_id: a.tenant_id,
        tenant_name: a.tenant_name,
        tenant_doctor_id: a.tenant_doctor_id,
        fte_share: a.fte_share,
        is_primary: !!a.is_primary,
        assigned_since: a.assigned_since,
      })),
      timeAccounts: timeAccounts,
      time_accounts: timeAccounts,
      ...vacationSummary,
    });
  } catch (error) {
    console.error('[Master employees] Detail error:', error);
    next(error);
  }
});

/**
 * Aggregate vacation data for a central employee across every linked tenant.
 *
 * Iterates over the linked tenant assignments, queries each tenant's
 * ShiftEntry table for absence positions of the current year, and returns
 * the same shape that the single-tenant `/api/master/staff/:tenantId/:employeeId`
 * endpoint exposes (vacation_days_total/taken/planned/remaining + absences).
 *
 * Deduplication: if a date appears for the same doctor in multiple linked
 * tenants we only count it once (key = `${date}::${type}`) to avoid
 * inflating the counters via duplicate tenant links.
 */
async function aggregateVacationAcrossTenants(adminUserId, assignments, vacationDaysTotal = 30, employeeId = null) {
  const absencePositions = [
    'Urlaub', 'Schichturlaub', 'Krank', 'Frei', 'Dienstreise', 'Nicht verfügbar',
    'Fortbildung', 'Kongress', 'Elternzeit', 'Mutterschutz',
  ];
  const placeholders = absencePositions.map(() => '?').join(',');

  const currentYear = new Date().getFullYear();
  let publicHolidayDates = new Set();
  try {
    publicHolidayDates = await getPublicHolidayDatesForYear(currentYear);
  } catch (e) {
    console.warn(`[Master employees] Holiday lookup failed: ${e.message}`);
  }

  const tokens = await getAllTenantTokens(adminUserId);
  const tokenById = new Map(tokens.map((t) => [t.id, t]));
  const today = format(new Date(), 'yyyy-MM-dd');

  // Dedup by date+type so duplicate tenant links don't inflate counters.
  const seenAbsenceKeys = new Set();
  const absences = [];

  // --- Source 1: CentralAbsenceEntry (master DB) for migrated employees ---
  // After migration the local ShiftEntry rows are removed; the canonical
  // data lives here. Read this first so the dedup set prevents double-
  // counting if somehow a row also still exists in a tenant ShiftEntry.
  if (employeeId) {
    try {
      const [centralRows] = await db.execute(
        `SELECT date, position, note FROM CentralAbsenceEntry
          WHERE employee_id = ? AND YEAR(date) = ? AND position IN (${placeholders})
          ORDER BY date`,
        [employeeId, currentYear, ...absencePositions]
      );
      for (const r of centralRows) {
        const dateStr = typeof r.date === 'string'
          ? r.date.substring(0, 10)
          : format(r.date, 'yyyy-MM-dd');
        const key = `${dateStr}::${r.position}`;
        if (seenAbsenceKeys.has(key)) continue;
        seenAbsenceKeys.add(key);
        absences.push({
          type: r.position,
          from: dateStr,
          to: dateStr,
          days: 1,
          note: r.note || null,
          tenant_id: null,
          tenant_name: 'Zentral',
        });
      }
    } catch (e) {
      console.warn(`[Master employees] CentralAbsenceEntry query failed for ${employeeId}: ${e.message}`);
    }
  }

  // --- Source 2: tenant ShiftEntry tables (non-migrated rows) ---
  for (const assignment of assignments) {
    if (!assignment.tenant_id || !assignment.tenant_doctor_id) continue;
    const token = tokenById.get(assignment.tenant_id);
    if (!token) continue;

    try {
      const rows = await withTenantDb(token, async (pool) => {
        const [absRows] = await pool.execute(
          `SELECT date, position, note FROM ShiftEntry
            WHERE doctor_id = ? AND YEAR(date) = ? AND position IN (${placeholders})
            ORDER BY date`,
          [assignment.tenant_doctor_id, currentYear, ...absencePositions]
        );
        return absRows;
      });

      for (const r of rows) {
        const dateStr = typeof r.date === 'string'
          ? r.date.substring(0, 10)
          : format(r.date, 'yyyy-MM-dd');
        const key = `${dateStr}::${r.position}`;
        if (seenAbsenceKeys.has(key)) continue;
        seenAbsenceKeys.add(key);
        absences.push({
          type: r.position,
          from: dateStr,
          to: dateStr,
          days: 1,
          note: r.note || null,
          tenant_id: token.id,
          tenant_name: token.name,
        });
      }
    } catch (e) {
      console.warn(`[Master employees] Absence query failed for tenant ${token.id}: ${e.message}`);
    }
  }

  absences.sort((a, b) => a.from.localeCompare(b.from));

  const isWorkday = (dateStr) => {
    const d = new Date(`${dateStr}T12:00:00`);
    const day = d.getDay();
    if (day === 0 || day === 6) return false;
    if (publicHolidayDates && publicHolidayDates.has(dateStr)) return false;
    return true;
  };

  const vacationDates = absences
    .filter((a) => a.type === 'Urlaub' && isWorkday(a.from))
    .map((a) => a.from);
  const vacationTaken = vacationDates.filter((d) => d <= today).length;
  const vacationPlanned = vacationDates.filter((d) => d > today).length;

  // Schichturlaub: separate balance with the same counting rules, but
  // sourced from EmployeeVacationYear.shift_vacation_days (default 0).
  // Out-sourced into a helper so the tenant endpoint can reuse the
  // exact same "this year's entitlement" lookup.
  const shiftEntitlement = employeeId
    ? await fetchShiftVacationEntitlement(db, employeeId, currentYear)
    : { shift_vacation_days: 0, carried_over: false, carried_over_from_year: null, expires_at: null };

  const shiftVacationDates = absences
    .filter((a) => a.type === 'Schichturlaub' && isWorkday(a.from))
    .map((a) => a.from);
  const shiftVacationTaken = shiftVacationDates.filter((d) => d <= today).length;
  const shiftVacationPlanned = shiftVacationDates.filter((d) => d > today).length;
  const shiftVacationTotal = Number(shiftEntitlement.shift_vacation_days) || 0;

  return {
    absences,
    vacation_days_total: vacationDaysTotal,
    vacation_days_taken: vacationTaken,
    vacation_days_planned: vacationPlanned,
    remaining_vacation: vacationDaysTotal - vacationTaken - vacationPlanned,
    shift_vacation_total: shiftVacationTotal,
    shift_vacation_taken: shiftVacationTaken,
    shift_vacation_planned: shiftVacationPlanned,
    remaining_shift_vacation: shiftVacationTotal - shiftVacationTaken - shiftVacationPlanned,
    shift_vacation_carried_over: Boolean(shiftEntitlement.carried_over),
    shift_vacation_carried_over_from_year: shiftEntitlement.carried_over_from_year ?? null,
    shift_vacation_expires_at: shiftEntitlement.expires_at ?? null,
  };
}

/**
 * Reads the year-specific shift/Sonderurlaub entitlement for a central
 * employee. Returns `{ shift_vacation_days: 0 }` when no row exists yet
 * (the default — most years carry no shift-vacation adjustment).
 *
 * Also tolerates a missing `EmployeeVacationYear` table so older
 * deployments don't crash on the detail endpoint.
 */
async function fetchShiftVacationEntitlement(masterDb, employeeId, year) {
  try {
    const [rows] = await masterDb.execute(
      `SELECT shift_vacation_days, carried_over, carried_over_from_year, expires_at
         FROM EmployeeVacationYear
        WHERE employee_id = ? AND year = ?
        LIMIT 1`,
      [employeeId, year]
    );
    if (rows.length === 0) {
      return { shift_vacation_days: 0, carried_over: false, carried_over_from_year: null, expires_at: null };
    }
    return {
      shift_vacation_days: Number(rows[0].shift_vacation_days) || 0,
      carried_over: Boolean(rows[0].carried_over),
      carried_over_from_year: rows[0].carried_over_from_year ?? null,
      expires_at: rows[0].expires_at ? (
        rows[0].expires_at instanceof Date
          ? rows[0].expires_at.toISOString().slice(0, 10)
          : String(rows[0].expires_at).slice(0, 10)
      ) : null,
    };
  } catch (e) {
    console.warn(`[Master employees] Shift-vacation entitlement lookup failed for ${employeeId}/${year}: ${e.message}`);
    return { shift_vacation_days: 0, carried_over: false, carried_over_from_year: null, expires_at: null };
  }
}

/**
 * GET /api/master/employees/:id/certificates
 * Aggregate qualification certificates across all linked tenants for a central
 * employee. Certificates are stored in the master DB partitioned by tenant_key;
 * we resolve each assignment's tenant_key from the linked db_token and merge
 * the rows so the central UI can show everything in one place.
 */
router.get('/employees/:id/certificates', async (req, res, next) => {
  try {
    const { id } = req.params;
    console.log(`[Master employee-certificates] Request: employeeId=${id}`);

    // 1. Find the central employee
    const [empRows] = await db.execute(
      'SELECT id, first_name, last_name FROM Employee WHERE id = ?',
      [id]
    );
    if (empRows.length === 0) {
      return res.status(404).json({ error: 'Mitarbeiter nicht gefunden' });
    }

    // 2. Get all linked tenant assignments with their db_token
    const [assignments] = await db.execute(
      `SELECT eta.tenant_id, eta.tenant_doctor_id, dt.token, dt.name as tenant_name
         FROM EmployeeTenantAssignment eta
         LEFT JOIN db_tokens dt ON eta.tenant_id COLLATE utf8mb4_general_ci = dt.id
        WHERE eta.employee_id = ?`,
      [id]
    );

    if (assignments.length === 0) {
      return res.json({ employeeId: id, certificates: [] });
    }

    // 3. Build tenant_key lookup from db_tokens, then fetch certificates per assignment
    const certificates = [];
    for (const a of assignments) {
      if (!a.token || !a.tenant_doctor_id) continue;
      const config = parseDbToken(a.token);
      if (!config?.host || !config?.database) continue;
      const tenantKey = crypto
        .createHash('sha256')
        .update(`${config.host}:${config.database}`)
        .digest('hex');

      const [rows] = await db.execute(
        `SELECT id, qualification_id, evidence_role, file_name, mime_type, file_size,
                granted_date, expiry_date, notes, uploaded_by, uploaded_at, updated_at,
                analysis_status, analysis_is_certificate, analysis_scope_match,
                analysis_scope_detected, analysis_confidence, analysis_reasoning,
                analysis_detected_granted, analysis_detected_expiry, analyzed_at
           FROM QualificationCertificate
          WHERE tenant_key = ? AND doctor_id = ?
          ORDER BY uploaded_at DESC`,
        [tenantKey, a.tenant_doctor_id]
      );
      for (const r of rows) {
        certificates.push({
          ...r,
          tenant_id: a.tenant_id,
          tenant_name: a.tenant_name,
          tenant_doctor_id: a.tenant_doctor_id,
        });
      }
    }

    res.json({ employeeId: id, certificates });
  } catch (error) {
    console.error('[Master employee-certificates] Route error:', error);
    next(error);
  }
});

/**
 * GET /api/master/employees/:id/certificates/:certificateId/download
 * Stream a single certificate file. Resolves the correct tenant_key from the
 * stored certificate row so we never trust the URL path for tenant scoping.
 */
router.get('/employees/:id/certificates/:certificateId/download', async (req, res, next) => {
  try {
    const { id, certificateId } = req.params;

    // Confirm the central employee exists
    const [empRows] = await db.execute('SELECT id FROM Employee WHERE id = ?', [id]);
    if (empRows.length === 0) {
      return res.status(404).json({ error: 'Mitarbeiter nicht gefunden' });
    }

    // We don't know the tenant_key from the URL – search across all linked
    // tenants. A single certificate id is unique per (tenant_key, doctor_id)
    // so we must scope it to one of the linked tenants to be safe.
    const [assignments] = await db.execute(
      `SELECT eta.tenant_id, eta.tenant_doctor_id, dt.token
         FROM EmployeeTenantAssignment eta
         LEFT JOIN db_tokens dt ON eta.tenant_id COLLATE utf8mb4_general_ci = dt.id
        WHERE eta.employee_id = ?`,
      [id]
    );

    for (const a of assignments) {
      if (!a.token || !a.tenant_doctor_id) continue;
      const config = parseDbToken(a.token);
      if (!config?.host || !config?.database) continue;
      const tenantKey = crypto
        .createHash('sha256')
        .update(`${config.host}:${config.database}`)
        .digest('hex');

      const [rows] = await db.execute(
        `SELECT id, file_name, mime_type, file_data
           FROM QualificationCertificate
          WHERE id = ? AND tenant_key = ? AND doctor_id = ?
          LIMIT 1`,
        [certificateId, tenantKey, a.tenant_doctor_id]
      );
      if (rows.length > 0) {
        const cert = rows[0];
        res.setHeader('Content-Type', cert.mime_type);
        res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(cert.file_name)}"`);
        return res.send(cert.file_data);
      }
    }

    return res.status(404).json({ error: 'Zertifikat nicht gefunden' });
  } catch (error) {
    console.error('[Master employee-certificate download] Route error:', error);
    next(error);
  }
});

/**
 * POST /api/master/employees/:id/sync-time-accounts
 * Recalculate time accounts for a linked central employee
 */
router.post('/employees/:id/sync-time-accounts', async (req, res, next) => {
  try {
    const { id } = req.params;

    const [rows] = await db.execute(
      `SELECT e.*, wtm.hours_per_week as model_hours_per_week
       FROM Employee e
       LEFT JOIN WorkTimeModel wtm ON e.work_time_model_id = wtm.id
       WHERE e.id = ?`,
      [id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Mitarbeiter nicht gefunden' });
    }

    const employee = rows[0];
    const [assignments] = await db.execute(
      `SELECT eta.*, dt.name as tenant_name
       FROM EmployeeTenantAssignment eta
       LEFT JOIN db_tokens dt ON eta.tenant_id COLLATE utf8mb4_general_ci = dt.id
       WHERE eta.employee_id = ?`,
      [id]
    );

    await syncEmployeeWorkSettingsForAssignments(req.user.sub, employee, assignments, {
      id: req.user.sub,
      email: req.user.email || null,
    });

    const result = await syncTimeAccountsForEmployee(req.user.sub, employee, assignments);
    const [timeAccounts] = await db.execute(
      `SELECT * FROM TimeAccount WHERE employee_id = ? ORDER BY year DESC, month DESC LIMIT 24`,
      [id]
    );

    res.json({
      success: true,
      ...result,
      timeAccounts: timeAccounts.length,
    });
  } catch (error) {
    console.error('[Master employees] Time-account sync error:', error);
    next(error);
  }
});

/**
 * POST /api/master/employees
 * Create a new central employee
 */
router.post('/employees', async (req, res, next) => {
  try {
    const {
      last_name, first_name, former_name, date_of_birth, email, phone, address,
      contract_type, contract_start, contract_end, probation_end,
      target_hours_per_week, vacation_days_annual, payroll_id, work_time_model_id, notes,
      payscale_tariff_id, payscale_group_id, payscale_level,
      salutation, title, position, cost_center, cost_center_name,
      entry_email_sent, exit_email_sent, source_system, stammdat_id,
    } = req.body;

    if (!last_name || !last_name.trim()) {
      return res.status(400).json({ error: 'Nachname ist erforderlich' });
    }

    const id = crypto.randomUUID();
    await db.execute(
      `INSERT INTO Employee (id, last_name, first_name, former_name, date_of_birth, email, phone, address,
        contract_type, contract_start, contract_end, probation_end,
        target_hours_per_week, vacation_days_annual, payroll_id, work_time_model_id, notes, created_by,
        payscale_tariff_id, payscale_group_id, payscale_level,
        salutation, title, position, cost_center, cost_center_name,
        entry_email_sent, exit_email_sent, source_system, stammdat_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        last_name.trim(),
        first_name?.trim() || null,
        former_name?.trim() || null,
        date_of_birth || null,
        email?.trim() || null,
        phone?.trim() || null,
        address?.trim() || null,
        contract_type || null,
        contract_start || null,
        contract_end || null,
        probation_end || null,
        target_hours_per_week ?? 38.5,
        vacation_days_annual ?? 30,
        payroll_id?.trim() || null,
        work_time_model_id || null,
        notes?.trim() || null,
        req.user.sub,
        payscale_tariff_id || null,
        payscale_group_id || null,
        payscale_level != null ? parseInt(payscale_level, 10) : null,
        salutation?.trim() || null,
        title?.trim() || null,
        position?.trim() || null,
        cost_center?.trim() || null,
        cost_center_name?.trim() || null,
        entry_email_sent ? 1 : 0,
        exit_email_sent ? 1 : 0,
        source_system?.trim() || null,
        stammdat_id != null ? parseInt(stammdat_id, 10) : null,
      ]
    );

    console.log(`[Master employees] Created employee ${id} (${last_name}) by user ${req.user.sub}`);
    res.status(201).json({ id, last_name, first_name });
  } catch (error) {
    console.error('[Master employees] Create error:', error);
    next(error);
  }
});

/**
 * PUT /api/master/employees/:id
 * Update a central employee
 */
router.put('/employees/:id', async (req, res, next) => {
  try {
    const { id } = req.params;

    // Check employee exists
    const [existing] = await db.execute('SELECT id FROM Employee WHERE id = ?', [id]);
    if (existing.length === 0) {
      return res.status(404).json({ error: 'Mitarbeiter nicht gefunden' });
    }

    const allowedFields = [
      'last_name', 'first_name', 'former_name', 'date_of_birth', 'email', 'phone', 'address',
      'contract_type', 'contract_start', 'contract_end', 'probation_end',
      'target_hours_per_week', 'vacation_days_annual', 'payroll_id', 'work_time_model_id',
      'is_active', 'exit_date', 'exit_reason', 'notes',
      'payscale_tariff_id', 'payscale_group_id', 'payscale_level',
      'salutation', 'title', 'position', 'cost_center', 'cost_center_name',
      'entry_email_sent', 'exit_email_sent', 'source_system', 'stammdat_id',
    ];

    const updates = [];
    const values = [];
    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        updates.push(`${field} = ?`);
        let val = req.body[field];
        // Trim strings
        if (typeof val === 'string') val = val.trim() || null;
        // Handle empty date strings
        if (['date_of_birth', 'contract_start', 'contract_end', 'probation_end', 'exit_date'].includes(field) && val === '') {
          val = null;
        }
        values.push(val);
      }
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'Keine Felder zum Aktualisieren' });
    }

    values.push(id);
    await db.execute(`UPDATE Employee SET ${updates.join(', ')} WHERE id = ?`, values);

    const [employeeRows] = await db.execute(
      `SELECT e.id, e.target_hours_per_week, e.vacation_days_annual, e.work_time_model_id, wtm.hours_per_week as model_hours_per_week
       FROM Employee e
       LEFT JOIN WorkTimeModel wtm ON e.work_time_model_id = wtm.id
       WHERE e.id = ?`,
      [id]
    );
    const [assignmentRows] = await db.execute(
      `SELECT tenant_id, tenant_doctor_id
       FROM EmployeeTenantAssignment
       WHERE employee_id = ?
         AND tenant_doctor_id IS NOT NULL
         AND tenant_doctor_id != ''`,
      [id]
    );

    if (employeeRows.length > 0 && assignmentRows.length > 0) {
      const syncResult = await syncEmployeeWorkSettingsForAssignments(req.user.sub, employeeRows[0], assignmentRows, {
        id: req.user.sub,
        email: req.user.email || null,
      });

      if (syncResult.failedAssignments.length > 0) {
        console.warn(`[Master employees] Tenant work-setting sync partially failed for ${id}`, syncResult.failedAssignments);
      }
    }

    console.log(`[Master employees] Updated employee ${id} (fields: ${updates.map(u => u.split(' =')[0]).join(', ')}) by user ${req.user.sub}`);
    res.json({ success: true });
  } catch (error) {
    console.error('[Master employees] Update error:', error);
    next(error);
  }
});

/**
 * PUT /api/master/employees/:id/assignments
 * Update tenant assignments for a central employee
 * Body: { assignments: [{ tenant_id, fte_share, is_primary, tenant_doctor_id }] }
 */
router.put('/employees/:id/assignments', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { assignments } = req.body;

    if (!Array.isArray(assignments)) {
      return res.status(400).json({ error: 'assignments array required' });
    }

    // Check employee exists
    const [existing] = await db.execute('SELECT id FROM Employee WHERE id = ?', [id]);
    if (existing.length === 0) {
      return res.status(404).json({ error: 'Mitarbeiter nicht gefunden' });
    }

    // Get current assignments
    const [currentAssignments] = await db.execute(
      'SELECT * FROM EmployeeTenantAssignment WHERE employee_id = ?',
      [id]
    );

    // Upsert: for each assignment, insert or update
    for (const a of assignments) {
      if (!a.tenant_id) continue;

      const existing = currentAssignments.find(ca => ca.tenant_id === a.tenant_id);
      if (existing) {
        await db.execute(
          `UPDATE EmployeeTenantAssignment SET fte_share = ?, is_primary = ?, tenant_doctor_id = ? WHERE id = ?`,
          [a.fte_share ?? 1.0, !!a.is_primary, a.tenant_doctor_id || null, existing.id]
        );
      } else {
        const aId = crypto.randomUUID();
        await db.execute(
          `INSERT INTO EmployeeTenantAssignment (id, employee_id, tenant_id, tenant_doctor_id, fte_share, is_primary, assigned_since) 
           VALUES (?, ?, ?, ?, ?, ?, CURDATE())`,
          [aId, id, a.tenant_id, a.tenant_doctor_id || null, a.fte_share ?? 1.0, !!a.is_primary]
        );
      }
    }

    // Remove assignments not in the new list
    const newTenantIds = assignments.map(a => a.tenant_id).filter(Boolean);
    for (const ca of currentAssignments) {
      if (!newTenantIds.includes(ca.tenant_id)) {
        await db.execute('DELETE FROM EmployeeTenantAssignment WHERE id = ?', [ca.id]);
      }
    }

    console.log(`[Master employees] Updated assignments for employee ${id} by user ${req.user.sub}`);
    res.json({ success: true });
  } catch (error) {
    console.error('[Master employees] Assignments error:', error);
    next(error);
  }
});

/**
 * DELETE /api/master/employees/:id
 * Permanently delete a deactivated employee and clean up all references
 */
router.delete('/employees/:id', async (req, res, next) => {
  try {
    const { id } = req.params;

    // Check employee exists and is inactive
    const [empRows] = await db.execute('SELECT id, is_active, last_name, first_name FROM Employee WHERE id = ?', [id]);
    if (empRows.length === 0) {
      return res.status(404).json({ error: 'Mitarbeiter nicht gefunden' });
    }
    if (empRows[0].is_active) {
      return res.status(400).json({ error: 'Nur deaktivierte Mitarbeiter können gelöscht werden. Bitte zuerst deaktivieren.' });
    }

    // Get assignments to clean up tenant-side references
    const [assignments] = await db.execute(
      'SELECT eta.tenant_id, eta.tenant_doctor_id FROM EmployeeTenantAssignment eta WHERE eta.employee_id = ?',
      [id]
    );

    // Clean up central_employee_id in tenant Doctor tables
    const tokens = await getAllTenantTokens(req.user.sub);
    const tokenMap = new Map(tokens.map(t => [String(t.id), t]));
    for (const assign of assignments) {
      const token = tokenMap.get(String(assign.tenant_id));
      if (token && assign.tenant_doctor_id) {
        try {
          await withTenantDb(token, async (pool) => {
            await pool.execute(
              'UPDATE Doctor SET central_employee_id = NULL WHERE id = ?',
              [assign.tenant_doctor_id]
            );
          });
        } catch (err) {
          console.warn(`[Master employees] Could not unlink tenant doctor ${assign.tenant_doctor_id}: ${err.message}`);
        }
      }
    }

    await deleteEmployeeDependentRecords(db, id);

    // Delete employee
    await db.execute('DELETE FROM Employee WHERE id = ?', [id]);

    const name = [empRows[0].first_name, empRows[0].last_name].filter(Boolean).join(' ');
    console.log(`[Master employees] Permanently deleted employee ${id} (${name}) by ${req.user.email}`);
    res.json({ success: true, message: `Mitarbeiter "${name}" wurde permanent gelöscht` });
  } catch (error) {
    console.error('[Master employees] Delete error:', error);
    next(error);
  }
});

/**
 * POST /api/master/employees/import-from-tenant
 * Create central Employee(s) from tenant Doctor records and auto-link them.
 * Body: { items: [{ tenant_id, doctor_id, name, role }] }
 */
router.post('/employees/import-from-tenant', async (req, res, next) => {
  try {
    const { items } = req.body;
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'items array required' });
    }

    // Pre-check: admin has access to referenced tenants
    const tokens = await getAllTenantTokens(req.user.sub);
    const tokenMap = new Map(tokens.map(t => [String(t.id), t]));

    const results = [];
    for (const item of items) {
      const { tenant_id, doctor_id, name } = item;
      if (!tenant_id || !doctor_id || !name) {
        results.push({ doctor_id, status: 'error', error: 'Fehlende Pflichtfelder' });
        continue;
      }
      const token = tokenMap.get(String(tenant_id));
      if (!token) {
        results.push({ doctor_id, status: 'error', error: 'Kein Zugriff auf Mandanten' });
        continue;
      }

      try {
        // Parse name: "Vorname Nachname" or "Nachname"
        const nameParts = name.trim().split(/\s+/);
        let first_name, last_name;
        if (nameParts.length >= 2) {
          first_name = nameParts.slice(0, -1).join(' ');
          last_name = nameParts[nameParts.length - 1];
        } else {
          first_name = null;
          last_name = nameParts[0];
        }

        // Check if already linked — primary check in master DB (reliable, no tenant column dependency)
        const [existingAssign] = await db.execute(
          'SELECT id FROM EmployeeTenantAssignment WHERE tenant_id = ? AND tenant_doctor_id = ?',
          [tenant_id, doctor_id]
        );
        if (existingAssign.length > 0) {
          results.push({ doctor_id, name, status: 'skipped', reason: 'Bereits verknüpft' });
          continue;
        }

        // Create central Employee
        const empId = crypto.randomUUID();
        await db.execute(
          `INSERT INTO Employee (id, last_name, first_name, is_active, created_by)
           VALUES (?, ?, ?, TRUE, ?)`,
          [empId, last_name, first_name, req.user.sub]
        );

        // Set central_employee_id on tenant Doctor
        await withTenantDb(token, async (pool) => {
          await pool.execute(
            'UPDATE Doctor SET central_employee_id = ? WHERE id = ?',
            [empId, doctor_id]
          );
        });

        // Create EmployeeTenantAssignment
        await db.execute(
          `INSERT INTO EmployeeTenantAssignment (id, employee_id, tenant_id, tenant_doctor_id, fte_share, is_primary, assigned_since)
           VALUES (?, ?, ?, ?, 1.00, TRUE, CURDATE())`,
          [crypto.randomUUID(), empId, tenant_id, doctor_id]
        );

        results.push({ doctor_id, name, employee_id: empId, status: 'success' });
      } catch (err) {
        console.error(`[Master import] Error for doctor ${doctor_id}:`, err.message);
        results.push({ doctor_id, name, status: 'error', error: err.message });
      }
    }

    const successCount = results.filter(r => r.status === 'success').length;
    console.log(`[Master import] Imported ${successCount}/${items.length} employees by ${req.user.email}`);
    res.json({ results, imported: successCount, total: items.length });
  } catch (error) {
    console.error('[Master import] Error:', error);
    next(error);
  }
});

/**
 * POST /api/master/employees/:id/link-tenant
 * Link a central employee to a tenant's Doctor record
 * Body: { tenant_id, doctor_id }
 */
router.post('/employees/:id/link-tenant', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { tenant_id, doctor_id } = req.body;

    if (!tenant_id || !doctor_id) {
      return res.status(400).json({ error: 'tenant_id and doctor_id required' });
    }

    // Check employee exists
    const [empRows] = await db.execute('SELECT id FROM Employee WHERE id = ?', [id]);
    if (empRows.length === 0) {
      return res.status(404).json({ error: 'Mitarbeiter nicht gefunden' });
    }

    // Check admin has access to this tenant
    const tokens = await getAllTenantTokens(req.user.sub);
    const token = tokens.find(t => t.id === tenant_id);
    if (!token) {
      return res.status(403).json({ error: 'Kein Zugriff auf diesen Mandanten' });
    }

    // Update Doctor in tenant DB to set central_employee_id
    await withTenantDb(token, async (pool) => {
      // First check if doctor has central_employee_id column
      const [cols] = await pool.execute(
        `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS 
         WHERE TABLE_NAME = 'Doctor' AND COLUMN_NAME = 'central_employee_id' AND TABLE_SCHEMA = DATABASE()`
      );
      if (cols.length === 0) {
        throw new Error('Tenant hat noch keine Migrationen für zentrale Mitarbeiterverwaltung. Bitte zuerst Migrationen ausführen.');
      }

      await pool.execute(
        'UPDATE Doctor SET central_employee_id = ? WHERE id = ?',
        [id, doctor_id]
      );
    });

    await db.execute(
      'DELETE FROM EmployeeTenantAssignment WHERE tenant_id = ? AND tenant_doctor_id = ? AND employee_id != ?',
      [tenant_id, doctor_id, id]
    );

    // Upsert EmployeeTenantAssignment
    const [existingAssign] = await db.execute(
      'SELECT id FROM EmployeeTenantAssignment WHERE employee_id = ? AND tenant_id = ?',
      [id, tenant_id]
    );
    if (existingAssign.length > 0) {
      await db.execute(
        'UPDATE EmployeeTenantAssignment SET tenant_doctor_id = ? WHERE id = ?',
        [doctor_id, existingAssign[0].id]
      );
    } else {
      await db.execute(
        `INSERT INTO EmployeeTenantAssignment (id, employee_id, tenant_id, tenant_doctor_id, fte_share, is_primary, assigned_since)
         VALUES (?, ?, ?, ?, 1.00, FALSE, CURDATE())`,
        [crypto.randomUUID(), id, tenant_id, doctor_id]
      );
    }

    console.log(`[Master employees] Linked employee ${id} to tenant ${tenant_id} doctor ${doctor_id} by user ${req.user.sub}`);
    await withTenantDb(token, async (pool) => {
      await migrateTenantDoctorAbsencesToCentral({
        tenantDb: pool,
        masterDb: db,
        tenantId: tenant_id,
        doctorId: doctor_id,
      });
    });
    res.json({ success: true });
  } catch (error) {
    console.error('[Master employees] Link error:', error);
    next(error);
  }
});

/**
 * POST /api/master/employees/unlink-tenant
 * Remove the central link for a tenant Doctor record
 * Body: { tenant_id, doctor_id }
 */
router.post('/employees/unlink-tenant', async (req, res, next) => {
  try {
    const { tenant_id, doctor_id } = req.body;

    if (!tenant_id || !doctor_id) {
      return res.status(400).json({ error: 'tenant_id and doctor_id required' });
    }

    const tokens = await getAllTenantTokens(req.user.sub);
    const token = tokens.find(t => t.id === tenant_id);
    if (!token) {
      return res.status(403).json({ error: 'Kein Zugriff auf diesen Mandanten' });
    }

    let employeeId = null;
    await withTenantDb(token, async (pool) => {
      const [doctorRows] = await pool.execute(
        'SELECT central_employee_id FROM Doctor WHERE id = ? LIMIT 1',
        [doctor_id]
      );
      employeeId = doctorRows[0]?.central_employee_id || null;
      if (employeeId) {
        await seedTenantDoctorAbsencesFromCentral({
          tenantDb: pool,
          masterDb: db,
          doctorId: doctor_id,
          employeeId,
          createdBy: req.user?.email || 'system',
        });
      }
    });

    await withTenantDb(token, async (pool) => {
      const [cols] = await pool.execute(
        `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS 
         WHERE TABLE_NAME = 'Doctor' AND COLUMN_NAME = 'central_employee_id' AND TABLE_SCHEMA = DATABASE()`
      );
      if (cols.length === 0) {
        return [];
      }

      await pool.execute(
        'UPDATE Doctor SET central_employee_id = NULL WHERE id = ?',
        [doctor_id]
      );

      return [];
    });

    await db.execute(
      'DELETE FROM EmployeeTenantAssignment WHERE tenant_id = ? AND tenant_doctor_id = ?',
      [tenant_id, doctor_id]
    );

    console.log(`[Master employees] Unlinked tenant ${tenant_id} doctor ${doctor_id} by user ${req.user.sub}`);
    res.json({ success: true });
  } catch (error) {
    console.error('[Master employees] Unlink error:', error);
    next(error);
  }
});

// ============ EMPLOYEE RELATIONSHIPS ============

/**
 * GET /api/master/employee-relationships
 * List all relationships with shift_conflict enabled.
 * Used by frontend validation to detect scheduling conflicts.
 */
router.get('/employee-relationships', async (req, res, next) => {
  try {
    const [rows] = await db.execute(
      `SELECT er.*,
              e1.last_name as employee_last_name, e1.first_name as employee_first_name,
              e2.last_name as related_last_name, e2.first_name as related_first_name
       FROM EmployeeRelationship er
       JOIN Employee e1 ON er.employee_id = e1.id
       JOIN Employee e2 ON er.related_employee_id = e2.id
       WHERE er.shift_conflict = TRUE
       ORDER BY er.created_at DESC`
    );

    res.json({ relationships: rows });
  } catch (error) {
    console.error('[Master relationships] List all error:', error);
    next(error);
  }
});

/**
 * GET /api/master/employees/:id/relationships
 * List all relationships for a central employee
 */
router.get('/employees/:id/relationships', async (req, res, next) => {
  try {
    const { id } = req.params;

    const [rows] = await db.execute(
      `SELECT er.*,
              e1.last_name as employee_last_name, e1.first_name as employee_first_name,
              e2.last_name as related_last_name, e2.first_name as related_first_name
       FROM EmployeeRelationship er
       JOIN Employee e1 ON er.employee_id = e1.id
       JOIN Employee e2 ON er.related_employee_id = e2.id
       WHERE er.employee_id = ? OR er.related_employee_id = ?
       ORDER BY er.created_at DESC`,
      [id, id]
    );

    res.json({ relationships: rows });
  } catch (error) {
    console.error('[Master relationships] List error:', error);
    next(error);
  }
});

/**
 * POST /api/master/employees/:id/relationships
 * Create a relationship between two employees
 * Body: { related_employee_id, relationship_type, shift_conflict }
 */
router.post('/employees/:id/relationships', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { related_employee_id, relationship_type, shift_conflict } = req.body;

    if (!related_employee_id) {
      return res.status(400).json({ error: 'related_employee_id ist erforderlich' });
    }
    if (id === related_employee_id) {
      return res.status(400).json({ error: 'Ein Mitarbeiter kann keine Beziehung zu sich selbst haben' });
    }

    // Verify both employees exist
    const [employees] = await db.execute(
      'SELECT id FROM Employee WHERE id IN (?, ?)',
      [id, related_employee_id]
    );
    if (employees.length !== 2) {
      return res.status(404).json({ error: 'Einer oder beide Mitarbeiter wurden nicht gefunden' });
    }

    // Check for existing relationship (bidirectional)
    const [existing] = await db.execute(
      `SELECT id FROM EmployeeRelationship
       WHERE (employee_id = ? AND related_employee_id = ?)
          OR (employee_id = ? AND related_employee_id = ?)`,
      [id, related_employee_id, related_employee_id, id]
    );
    if (existing.length > 0) {
      return res.status(409).json({ error: 'Diese Beziehung existiert bereits' });
    }

    const relId = crypto.randomUUID();
    await db.execute(
      `INSERT INTO EmployeeRelationship (id, employee_id, related_employee_id, relationship_type, shift_conflict, created_by)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [relId, id, related_employee_id, relationship_type || 'lebensgemeinschaft', shift_conflict ?? false, req.user.sub]
    );

    // Fetch the created row with names
    const [rows] = await db.execute(
      `SELECT er.*,
              e1.last_name as employee_last_name, e1.first_name as employee_first_name,
              e2.last_name as related_last_name, e2.first_name as related_first_name
       FROM EmployeeRelationship er
       JOIN Employee e1 ON er.employee_id = e1.id
       JOIN Employee e2 ON er.related_employee_id = e2.id
       WHERE er.id = ?`,
      [relId]
    );

    console.log(`[Master relationships] Created relationship ${relId}: ${id} <-> ${related_employee_id} (${relationship_type || 'lebensgemeinschaft'}) by user ${req.user.sub}`);
    res.status(201).json({ relationship: rows[0] });
  } catch (error) {
    console.error('[Master relationships] Create error:', error);
    next(error);
  }
});

/**
 * DELETE /api/master/employees/:id/relationships/:relationshipId
 * Remove a relationship
 */
router.delete('/employees/:id/relationships/:relationshipId', async (req, res, next) => {
  try {
    const { id, relationshipId } = req.params;

    const [existing] = await db.execute(
      'SELECT id FROM EmployeeRelationship WHERE id = ? AND (employee_id = ? OR related_employee_id = ?)',
      [relationshipId, id, id]
    );
    if (existing.length === 0) {
      return res.status(404).json({ error: 'Beziehung nicht gefunden' });
    }

    await db.execute('DELETE FROM EmployeeRelationship WHERE id = ?', [relationshipId]);

    console.log(`[Master relationships] Deleted relationship ${relationshipId} by user ${req.user.sub}`);
    res.json({ success: true });
  } catch (error) {
    console.error('[Master relationships] Delete error:', error);
    next(error);
  }
});

// ============ CROSS-TENANT RELATIONSHIP CONFLICTS ============

/**
 * POST /api/master/check-relationship-conflicts
 *
 * Cross-tenant check: Prüft, ob ein zentraler Mitarbeiter an einem bestimmten
 * Datum in einem anderen Mandanten einen echten Dienst hat, während ein
 * verwandter Mitarbeiter (mit shift_conflict=true) ebenfalls einen echten
 * Dienst in einem beliebigen Mandanten am selben Tag eingeteilt ist.
 *
 * Body: { employee_id: string, date: string (YYYY-MM-DD) }
 * Returns: { conflicts: Array<{ related_employee_id, related_employee_name, relationship_type }> }
 */
router.post('/check-relationship-conflicts', async (req, res, next) => {
  try {
    const { employee_id, date } = req.body || {};
    if (!employee_id || !date) {
      return res.status(400).json({ error: 'employee_id und date sind erforderlich' });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'date muss YYYY-MM-DD sein' });
    }

    const conflicts = await checkCrossTenantRelationshipConflicts(db, getTenantDb, { employeeId: employee_id, dateStr: date });
    res.json({ conflicts });
  } catch (error) {
    console.error('[Master] Cross-tenant relationship conflict check error:', error);
    next(error);
  }
});

/**
 * Führt eine mandantenübergreifende Prüfung auf Dienstkonflikte durch.
 *
 * 1. Findet alle Beziehungen mit shift_conflict=true für den gegebenen Mitarbeiter
 * 2. Ermittelt über EmployeeTenantAssignment, in welchen Mandanten die
 *    related employees als Doctors eingetragen sind
 * 3. Fragt in jedem dieser Mandanten die ShiftEntry-Tabelle ab, ob dort
 *    am gegebenen Datum ein echter Dienst (keine Abwesenheit) eingetragen ist
 * 4. Gibt die gefundenen Konflikte zurück
 *
 * @param {object} masterDb - Master-DB-Pool
 * @param {Function} getTenantPoolFn - Funktion zum Auflösen eines Tenant-Pools (getTenantDb)
 * @param {object} params
 * @param {string} params.employeeId - Zentrale Employee-ID
 * @param {string} params.dateStr - Datum als YYYY-MM-DD
 * @returns {Promise<Array<{related_employee_id, related_employee_name, relationship_type}>>}
 */
async function checkCrossTenantRelationshipConflicts(masterDb, getTenantPoolFn, { employeeId, dateStr }) {
  // 1. Alle Beziehungen mit shift_conflict für diesen Mitarbeiter laden
  const [relationships] = await masterDb.execute(
    `SELECT er.*,
            e1.first_name AS emp1_first, e1.last_name AS emp1_last,
            e2.first_name AS emp2_first, e2.last_name AS emp2_last
       FROM EmployeeRelationship er
       JOIN Employee e1 ON er.employee_id = e1.id
       JOIN Employee e2 ON er.related_employee_id = e2.id
      WHERE er.shift_conflict = TRUE
        AND (er.employee_id = ? OR er.related_employee_id = ?)`,
    [employeeId, employeeId]
  );

  if (relationships.length === 0) return [];

  // 2. Set der related employee IDs aufbauen
  const relatedIds = new Map(); // relatedEmployeeId → relationship info
  for (const rel of relationships) {
    const [first, last] = String(rel.employee_id) === String(employeeId)
      ? [rel.emp2_first, rel.emp2_last]
      : [rel.emp1_first, rel.emp1_last];
    const relatedId = String(rel.employee_id) === String(employeeId)
      ? String(rel.related_employee_id)
      : String(rel.employee_id);
    relatedIds.set(relatedId, {
      name: [first, last].filter(Boolean).join(' ') || relatedId,
      type: rel.relationship_type || 'unbekannt',
    });
  }

  if (relatedIds.size === 0) return [];

  // 3. Für jeden related employee die Tenant-Zuordnungen laden
  const placeholders = Array.from(relatedIds.keys()).map(() => '?').join(',');
  const [allAssignments] = await masterDb.execute(
    `SELECT eta.employee_id, eta.tenant_id, eta.tenant_doctor_id
       FROM EmployeeTenantAssignment eta
      WHERE eta.employee_id IN (${placeholders})`,
    Array.from(relatedIds.keys())
  );

  // Gruppiere Assignments nach tenant_id für effiziente Batch-Abfragen
  const tenantGroups = new Map(); // tenant_id → [{ employee_id, tenant_doctor_id }]
  for (const a of allAssignments) {
    if (!tenantGroups.has(a.tenant_id)) {
      tenantGroups.set(a.tenant_id, []);
    }
    tenantGroups.get(a.tenant_id).push({ employeeId: a.employee_id, tenantDoctorId: a.tenant_doctor_id });
  }

  // 4. Für jeden Tenant prüfen, ob einer der Doctors einen echten Dienst hat
  const REAL_SHIFT_EXCLUSIONS = [
    'Frei', 'frei', 'Urlaub', 'urlaub', 'Krank', 'krank',
    'Dienstreise', 'Nicht verfügbar', 'Nicht verfugbar',
    'Fortbildung', 'Kongress', 'Elternzeit', 'Mutterschutz',
    'Verfügbar', 'Verfugbar', 'AZ', 'KO', 'EZ', 'MS',
  ];

  const conflicts = [];
  const processedTenants = new Set();

  for (const [tenantId, doctorMappings] of tenantGroups) {
    if (processedTenants.has(tenantId)) continue;
    processedTenants.add(tenantId);

    // Tenant-Token laden
    const [tokenRows] = await masterDb.execute(
      'SELECT token FROM db_tokens WHERE id = ? LIMIT 1',
      [String(tenantId)]
    );
    if (tokenRows.length === 0) continue;

    const rawToken = tokenRows[0].token;
    const tenantPool = getTenantPoolFn(rawToken);
    if (!tenantPool || tenantPool === masterDb) continue;

    // Alle tenantDoctorIds für diesen Tenant sammeln
    const docIds = doctorMappings.map(d => d.tenantDoctorId);
    const docPlaceholders = docIds.map(() => '?').join(',');

    try {
      const [shifts] = await tenantPool.execute(
        `SELECT doctor_id FROM ShiftEntry
          WHERE doctor_id IN (${docPlaceholders})
            AND date = ?
            AND position NOT IN (${REAL_SHIFT_EXCLUSIONS.map(() => '?').join(',')})`,
        [...docIds, dateStr, ...REAL_SHIFT_EXCLUSIONS]
      );

      // Welche related employees haben einen Dienst?
      const conflictingEmployeeIds = new Set();
      for (const shift of shifts) {
        const mapping = doctorMappings.find(d => String(d.tenantDoctorId) === String(shift.doctor_id));
        if (mapping) {
          conflictingEmployeeIds.add(mapping.employeeId);
        }
      }

      for (const relId of conflictingEmployeeIds) {
        const info = relatedIds.get(relId);
        if (info) {
          conflicts.push({
            related_employee_id: relId,
            related_employee_name: info.name,
            relationship_type: info.type,
          });
        }
      }
    } catch (err) {
      console.warn(`[Master] Tenant query error for ${tenantId}:`, err.message);
      // Einzelschläge dürfen die Gesamtprüfung nicht blockieren
    }
  }

  return conflicts;
}

// ============ WORK TIME MODELS ============

/**
 * GET /api/master/work-time-models
 * List all work time models
 */
router.get('/work-time-models', async (req, res, next) => {
  try {
    const [rows] = await db.execute('SELECT * FROM WorkTimeModel ORDER BY hours_per_week DESC');
    res.json({ models: rows });
  } catch (error) {
    console.error('[Master work-time-models] List error:', error);
    next(error);
  }
});

/**
 * POST /api/master/work-time-models
 * Create a new work time model
 */
router.post('/work-time-models', async (req, res, next) => {
  try {
    const { name, hours_per_week, hours_per_day, is_default, description } = req.body;

    if (!name?.trim() || !hours_per_week || !hours_per_day) {
      return res.status(400).json({ error: 'name, hours_per_week, and hours_per_day are required' });
    }

    const id = crypto.randomUUID();
    await db.execute(
      `INSERT INTO WorkTimeModel (id, name, hours_per_week, hours_per_day, is_default, description)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [id, name.trim(), hours_per_week, hours_per_day, !!is_default, description?.trim() || null]
    );

    console.log(`[Master work-time-models] Created model ${id} (${name}) by user ${req.user.sub}`);
    res.status(201).json({ id, name, hours_per_week, hours_per_day });
  } catch (error) {
    console.error('[Master work-time-models] Create error:', error);
    next(error);
  }
});

/**
 * PUT /api/master/work-time-models/:id
 * Update an existing work time model
 */
router.put('/work-time-models/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name, hours_per_week, hours_per_day, is_default, description } = req.body;

    const [existing] = await db.execute('SELECT id FROM WorkTimeModel WHERE id = ?', [id]);
    if (existing.length === 0) {
      return res.status(404).json({ error: 'Arbeitszeitmodell nicht gefunden' });
    }

    await db.execute(
      `UPDATE WorkTimeModel SET name = ?, hours_per_week = ?, hours_per_day = ?, is_default = ?, description = ?
       WHERE id = ?`,
      [name?.trim(), hours_per_week, hours_per_day, !!is_default, description?.trim() || null, id]
    );

    console.log(`[Master work-time-models] Updated model ${id} by user ${req.user.sub}`);
    res.json({ success: true });
  } catch (error) {
    console.error('[Master work-time-models] Update error:', error);
    next(error);
  }
});

/**
 * DELETE /api/master/work-time-models/:id
 * Delete a work time model (only if not assigned to any employee)
 */
router.delete('/work-time-models/:id', async (req, res, next) => {
  try {
    const { id } = req.params;

    // Check if any employees use this model
    const [usages] = await db.execute(
      'SELECT COUNT(*) as cnt FROM Employee WHERE work_time_model_id = ?',
      [id]
    );
    if (usages[0].cnt > 0) {
      return res.status(409).json({ 
        error: `Dieses Modell wird noch von ${usages[0].cnt} Mitarbeiter(n) verwendet und kann nicht gelöscht werden.` 
      });
    }

    await db.execute('DELETE FROM WorkTimeModel WHERE id = ?', [id]);

    console.log(`[Master work-time-models] Deleted model ${id} by user ${req.user.sub}`);
    res.json({ success: true });
  } catch (error) {
    console.error('[Master work-time-models] Delete error:', error);
    next(error);
  }
});

// ============ SHIFT TIME RULES (Tenant-specific) ============

/**
 * GET /api/master/shift-time-rules?tenantId=xxx
 * Get shift time rules for a specific tenant
 */
router.get('/shift-time-rules', async (req, res, next) => {
  try {
    const { tenantId } = req.query;
    if (!tenantId) {
      return res.status(400).json({ error: 'tenantId required' });
    }

    const tokens = await getAllTenantTokens(req.user.sub);
    const token = tokens.find(t => t.id === tenantId);
    if (!token) {
      return res.status(403).json({ error: 'Kein Zugriff auf diesen Mandanten' });
    }

    const rules = await withTenantDb(token, async (pool) => {
      try {
        const [tables] = await pool.execute(`SHOW TABLES LIKE 'ShiftTimeRule'`);
        if (tables.length === 0) return [];

        const [rows] = await pool.execute(`
          SELECT str.*, w.name as workplace_name
          FROM ShiftTimeRule str
          LEFT JOIN Workplace w ON str.workplace_id = w.id
          ORDER BY w.name, str.work_time_model_id
        `);
        return rows;
      } catch (e) {
        console.warn(`[Master shift-time-rules] Query failed:`, e.message);
        return [];
      }
    });

    // Enrich with work time model names from master DB
    const [models] = await db.execute('SELECT id, name FROM WorkTimeModel');
    const modelMap = Object.fromEntries(models.map(m => [m.id, m.name]));

    const enriched = (rules || []).map(r => ({
      ...r,
      work_time_model_name: modelMap[r.work_time_model_id] || r.work_time_model_id,
    }));

    res.json({ rules: enriched });
  } catch (error) {
    console.error('[Master shift-time-rules] List error:', error);
    next(error);
  }
});

// ============ PAY SCALE TARIFFS (Tarifverträge) ============

/**
 * GET /api/master/payscale-tariffs
 * List all pay scale tariffs with group counts
 */
router.get('/payscale-tariffs', async (req, res, next) => {
  try {
    const [rows] = await db.execute(
      `SELECT pst.*,
              (SELECT COUNT(*) FROM PayScaleGroup psg WHERE psg.tariff_id = pst.id) AS group_count
       FROM PayScaleTariff pst
       ORDER BY pst.sort_order ASC, pst.name ASC`
    );
    res.json({ tariffs: rows });
  } catch (error) {
    console.error('[Master payscale-tariffs] List error:', error);
    next(error);
  }
});

/**
 * POST /api/master/payscale-tariffs
 * Create a new pay scale tariff
 */
router.post('/payscale-tariffs', async (req, res, next) => {
  try {
    const { name, short_name, default_weekly_hours, default_vacation_days, description } = req.body;

    if (!name?.trim() || !short_name?.trim()) {
      return res.status(400).json({ error: 'name and short_name are required' });
    }

    const id = crypto.randomUUID();
    await db.execute(
      `INSERT INTO PayScaleTariff (id, name, short_name, default_weekly_hours, default_vacation_days, description)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [id, name.trim(), short_name.trim(), default_weekly_hours ?? null, default_vacation_days ?? null, description?.trim() || null]
    );

    console.log(`[Master payscale-tariffs] Created tariff ${id} (${name}) by user ${req.user.sub}`);
    res.status(201).json({ id, name, short_name });
  } catch (error) {
    console.error('[Master payscale-tariffs] Create error:', error);
    next(error);
  }
});

/**
 * PUT /api/master/payscale-tariffs/:id
 * Update a pay scale tariff
 */
router.put('/payscale-tariffs/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name, short_name, default_weekly_hours, default_vacation_days, description, is_active, sort_order } = req.body;

    const [existing] = await db.execute('SELECT id FROM PayScaleTariff WHERE id = ?', [id]);
    if (existing.length === 0) {
      return res.status(404).json({ error: 'Tarifvertrag nicht gefunden' });
    }

    const allowedFields = [
      'name', 'short_name', 'default_weekly_hours', 'default_vacation_days',
      'description', 'is_active', 'sort_order',
    ];
    const updates = [];
    const values = [];
    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        updates.push(`${field} = ?`);
        let val = req.body[field];
        if (typeof val === 'string') val = val.trim() || null;
        values.push(val);
      }
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'Keine Felder zum Aktualisieren' });
    }

    values.push(id);
    await db.execute(`UPDATE PayScaleTariff SET ${updates.join(', ')} WHERE id = ?`, values);

    console.log(`[Master payscale-tariffs] Updated tariff ${id} by user ${req.user.sub}`);
    res.json({ success: true });
  } catch (error) {
    console.error('[Master payscale-tariffs] Update error:', error);
    next(error);
  }
});

/**
 * DELETE /api/master/payscale-tariffs/:id
 * Delete a pay scale tariff (only if no employees assigned)
 */
router.delete('/payscale-tariffs/:id', async (req, res, next) => {
  try {
    const { id } = req.params;

    // Check if any employees use this tariff
    const [usages] = await db.execute(
      'SELECT COUNT(*) as cnt FROM Employee WHERE payscale_tariff_id = ?',
      [id]
    );
    if (usages[0].cnt > 0) {
      return res.status(409).json({
        error: `Dieser Tarifvertrag wird noch von ${usages[0].cnt} Mitarbeiter(n) verwendet und kann nicht gelöscht werden.`
      });
    }

    // Delete associated groups first
    await db.execute('DELETE FROM PayScaleGroup WHERE tariff_id = ?', [id]);
    await db.execute('DELETE FROM PayScaleTariff WHERE id = ?', [id]);

    console.log(`[Master payscale-tariffs] Deleted tariff ${id} by user ${req.user.sub}`);
    res.json({ success: true });
  } catch (error) {
    console.error('[Master payscale-tariffs] Delete error:', error);
    next(error);
  }
});

/**
 * GET /api/master/payscale-tariffs/:id/groups
 * List pay scale groups for a tariff
 */
router.get('/payscale-tariffs/:id/groups', async (req, res, next) => {
  try {
    const { id } = req.params;

    const [rows] = await db.execute(
      'SELECT * FROM PayScaleGroup WHERE tariff_id = ? ORDER BY sort_order ASC, name ASC',
      [id]
    );

    res.json({ groups: rows });
  } catch (error) {
    console.error('[Master payscale-tariffs] Groups list error:', error);
    next(error);
  }
});

/**
 * POST /api/master/payscale-tariffs/:id/groups
 * Create a new pay scale group for a tariff
 */
router.post('/payscale-tariffs/:id/groups', async (req, res, next) => {
  try {
    const tariffId = req.params.id;
    const { name, description } = req.body;

    if (!name?.trim()) {
      return res.status(400).json({ error: 'name is required' });
    }

    // Check tariff exists
    const [tariffRows] = await db.execute('SELECT id FROM PayScaleTariff WHERE id = ?', [tariffId]);
    if (tariffRows.length === 0) {
      return res.status(404).json({ error: 'Tarifvertrag nicht gefunden' });
    }

    // Determine next sort_order
    const [maxOrder] = await db.execute(
      'SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_sort FROM PayScaleGroup WHERE tariff_id = ?',
      [tariffId]
    );
    const nextSort = maxOrder[0]?.next_sort ?? 0;

    const id = crypto.randomUUID();
    await db.execute(
      'INSERT INTO PayScaleGroup (id, tariff_id, name, description, sort_order) VALUES (?, ?, ?, ?, ?)',
      [id, tariffId, name.trim(), description?.trim() || null, nextSort]
    );

    console.log(`[Master payscale-tariffs] Created group ${id} (${name}) in tariff ${tariffId} by user ${req.user.sub}`);
    res.status(201).json({ id, name });
  } catch (error) {
    console.error('[Master payscale-tariffs] Groups create error:', error);
    next(error);
  }
});

/**
 * PUT /api/master/payscale-tariffs/:tariffId/groups/:groupId
 * Update a pay scale group
 */
router.put('/payscale-tariffs/:tariffId/groups/:groupId', async (req, res, next) => {
  try {
    const { tariffId, groupId } = req.params;
    const { name, description, sort_order } = req.body;

    const [existing] = await db.execute(
      'SELECT id FROM PayScaleGroup WHERE id = ? AND tariff_id = ?',
      [groupId, tariffId]
    );
    if (existing.length === 0) {
      return res.status(404).json({ error: 'Entgeltgruppe nicht gefunden' });
    }

    const updates = [];
    const values = [];
    if (name !== undefined) { updates.push('name = ?'); values.push(name?.trim() || null); }
    if (description !== undefined) { updates.push('description = ?'); values.push(description?.trim() || null); }
    if (sort_order !== undefined) { updates.push('sort_order = ?'); values.push(sort_order); }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'Keine Felder zum Aktualisieren' });
    }

    values.push(groupId);
    await db.execute(`UPDATE PayScaleGroup SET ${updates.join(', ')} WHERE id = ?`, values);

    console.log(`[Master payscale-tariffs] Updated group ${groupId} in tariff ${tariffId} by user ${req.user.sub}`);
    res.json({ success: true });
  } catch (error) {
    console.error('[Master payscale-tariffs] Groups update error:', error);
    next(error);
  }
});

/**
 * DELETE /api/master/payscale-tariffs/:tariffId/groups/:groupId
 * Delete a pay scale group
 */
router.delete('/payscale-tariffs/:tariffId/groups/:groupId', async (req, res, next) => {
  try {
    const { tariffId, groupId } = req.params;

    // Check if any employee uses this group
    const [usages] = await db.execute(
      'SELECT COUNT(*) as cnt FROM Employee WHERE payscale_group_id = ?',
      [groupId]
    );
    if (usages[0].cnt > 0) {
      return res.status(409).json({
        error: `Diese Entgeltgruppe wird noch von ${usages[0].cnt} Mitarbeiter(n) verwendet und kann nicht gelöscht werden.`
      });
    }

    await db.execute('DELETE FROM PayScaleGroup WHERE id = ? AND tariff_id = ?', [groupId, tariffId]);

    console.log(`[Master payscale-tariffs] Deleted group ${groupId} from tariff ${tariffId} by user ${req.user.sub}`);
    res.json({ success: true });
  } catch (error) {
    console.error('[Master payscale-tariffs] Groups delete error:', error);
    next(error);
  }
});

/**
 * POST /api/master/payscale-tariffs/:id/apply-defaults
 * Apply tariff defaults to all employees assigned to this tariff.
 * Only overwrites employees currently on system defaults (38.5h / 30d).
 */
router.post('/payscale-tariffs/:id/apply-defaults', async (req, res, next) => {
  try {
    const { id } = req.params;

    const [tariffRows] = await db.execute(
      'SELECT id, name, default_weekly_hours, default_vacation_days FROM PayScaleTariff WHERE id = ?',
      [id]
    );
    if (tariffRows.length === 0) {
      return res.status(404).json({ error: 'Tarifvertrag nicht gefunden' });
    }
    const tariff = tariffRows[0];

    if (tariff.default_weekly_hours == null && tariff.default_vacation_days == null) {
      return res.status(400).json({ error: 'Dieser Tarif hat keine Default-Werte (AT). Bulk-Apply nicht möglich.' });
    }

    // Only update employees still on system defaults (38.5 / 30)
    const [eligibleRows] = await db.execute(
      `SELECT COUNT(*) as cnt FROM Employee
       WHERE payscale_tariff_id = ?
         AND (target_hours_per_week = 38.5 OR target_hours_per_week IS NULL)
         AND (vacation_days_annual = 30 OR vacation_days_annual IS NULL)`,
      [id]
    );
    const eligibleCount = eligibleRows[0].cnt;

    const [skippedRows] = await db.execute(
      `SELECT COUNT(*) as cnt FROM Employee
       WHERE payscale_tariff_id = ?
         AND target_hours_per_week IS NOT NULL AND target_hours_per_week != 38.5`,
      [id]
    );
    const skippedCount = skippedRows[0].cnt;

    if (eligibleCount === 0) {
      return res.json({ updated: 0, skipped: skippedCount, message: 'Keine Mitarbeiter mit Standardwerten vorhanden.' });
    }

    // Bulk update employees
    const updates = [];
    const params = [];
    if (tariff.default_weekly_hours != null) {
      updates.push('target_hours_per_week = ?');
      params.push(tariff.default_weekly_hours);
    }
    if (tariff.default_vacation_days != null) {
      updates.push('vacation_days_annual = ?');
      params.push(tariff.default_vacation_days);
    }
    params.push(id);
    await db.execute(
      `UPDATE Employee SET ${updates.join(', ')}
       WHERE payscale_tariff_id = ?
         AND (target_hours_per_week = 38.5 OR target_hours_per_week IS NULL)
         AND (vacation_days_annual = 30 OR vacation_days_annual IS NULL)`,
      params
    );

    // Sync to tenant doctors for all affected employees
    const [affectedEmployees] = await db.execute(
      `SELECT e.id, e.target_hours_per_week, e.work_time_model_id, wtm.hours_per_week as model_hours_per_week
       FROM Employee e
       LEFT JOIN WorkTimeModel wtm ON e.work_time_model_id = wtm.id
       WHERE e.payscale_tariff_id = ?`,
      [id]
    );

    let syncedCount = 0;
    let syncErrors = 0;
    for (const emp of affectedEmployees) {
      try {
        const [assignmentRows] = await db.execute(
          `SELECT tenant_id, tenant_doctor_id
           FROM EmployeeTenantAssignment
           WHERE employee_id = ? AND tenant_doctor_id IS NOT NULL AND tenant_doctor_id != ''`,
          [emp.id]
        );
        if (assignmentRows.length > 0) {
          const result = await syncEmployeeWorkSettingsForAssignments(req.user.sub, emp, assignmentRows, {
            id: req.user.sub,
            email: req.user.email || null,
          });
          if (result.failedAssignments.length > 0) {
            syncErrors++;
          }
          syncedCount++;
        }
      } catch (syncError) {
        console.warn(`[Master payscale-tariffs] Sync failed for employee ${emp.id}: ${syncError.message}`);
        syncErrors++;
      }
    }

    console.log(`[Master payscale-tariffs] Applied defaults for tariff ${id} (${tariff.name}): ${eligibleCount} updated, ${skippedCount} skipped, ${syncedCount} tenants synced, ${syncErrors} errors`);
    res.json({ updated: eligibleCount, skipped: skippedCount, syncedTenants: syncedCount, syncErrors });
  } catch (error) {
    console.error('[Master payscale-tariffs] Apply-defaults error:', error);
    next(error);
  }
});

/**
 * POST /api/master/employees/bulk-apply-tariff
 * Apply a payscale tariff to a list of employees.
 * Sets target_hours_per_week, vacation_days_annual, and payscale_tariff_id,
 * then syncs to all linked tenant doctors.
 */
router.post('/employees/bulk-apply-tariff', async (req, res, next) => {
  try {
    const { tariff_id, employee_ids } = req.body;

    if (!tariff_id) {
      return res.status(400).json({ error: 'tariff_id ist erforderlich' });
    }
    if (!Array.isArray(employee_ids) || employee_ids.length === 0) {
      return res.status(400).json({ error: 'employee_ids muss ein nicht-leeres Array sein' });
    }

    // Look up the tariff
    const [tariffRows] = await db.execute(
      'SELECT id, name, short_name, default_weekly_hours, default_vacation_days FROM PayScaleTariff WHERE id = ?',
      [tariff_id]
    );
    if (tariffRows.length === 0) {
      return res.status(404).json({ error: 'Tarifvertrag nicht gefunden' });
    }
    const tariff = tariffRows[0];

    if (tariff.default_weekly_hours == null && tariff.default_vacation_days == null) {
      return res.status(400).json({ error: 'Dieser Tarif hat keine Default-Werte (AT). Bulk-Apply nicht möglich.' });
    }

    // Build dynamic UPDATE
    const updates = [];
    const params = [];
    if (tariff.default_weekly_hours != null) {
      updates.push('target_hours_per_week = ?');
      params.push(tariff.default_weekly_hours);
    }
    if (tariff.default_vacation_days != null) {
      updates.push('vacation_days_annual = ?');
      params.push(tariff.default_vacation_days);
    }
    updates.push('payscale_tariff_id = ?');
    params.push(tariff_id);

    const placeholders = employee_ids.map(() => '?').join(', ');
    params.push(...employee_ids);

    const [result] = await db.execute(
      `UPDATE Employee SET ${updates.join(', ')} WHERE id IN (${placeholders})`,
      params
    );
    const updatedCount = result.affectedRows;

    // Sync to tenant doctors for all affected employees
    const [affectedEmployees] = await db.execute(
      `SELECT e.id, e.target_hours_per_week, e.work_time_model_id, wtm.hours_per_week as model_hours_per_week
       FROM Employee e
       LEFT JOIN WorkTimeModel wtm ON e.work_time_model_id = wtm.id
       WHERE e.id IN (${placeholders})`,
      employee_ids
    );

    let syncedCount = 0;
    let syncErrors = 0;
    for (const emp of affectedEmployees) {
      try {
        const [assignmentRows] = await db.execute(
          `SELECT tenant_id, tenant_doctor_id
           FROM EmployeeTenantAssignment
           WHERE employee_id = ? AND tenant_doctor_id IS NOT NULL AND tenant_doctor_id != ''`,
          [emp.id]
        );
        if (assignmentRows.length > 0) {
          const syncResult = await syncEmployeeWorkSettingsForAssignments(req.user.sub, emp, assignmentRows, {
            id: req.user.sub,
            email: req.user.email || null,
          });
          if (syncResult.failedAssignments.length > 0) {
            syncErrors++;
          }
          syncedCount++;
        }
      } catch (syncError) {
        console.warn(`[Master bulk-apply-tariff] Sync failed for employee ${emp.id}: ${syncError.message}`);
        syncErrors++;
      }
    }

    console.log(`[Master bulk-apply-tariff] Applied tariff ${tariff_id} (${tariff.name}) to ${updatedCount} employees, ${syncedCount} tenants synced, ${syncErrors} errors by user ${req.user.sub}`);
    res.json({
      tariff: { id: tariff.id, name: tariff.name },
      updated: updatedCount,
      syncedTenants: syncedCount,
      syncErrors,
    });
  } catch (error) {
    console.error('[Master bulk-apply-tariff] Error:', error);
    next(error);
  }
});

// =============================================================================
// PPUGV STATISTIK (Pflegepersonaluntergrenzen-Verordnung)
// =============================================================================
//
// Diese Routes liefern die PPUGV-Auswertungen, die bisher nur im legacy PHP-
// Frontend unter /PHP/ verfuegbar waren. Die Daten werden 1x taeglich aus der
// ppugv-Datenbank (Export-Tabelle) in die master-eigene Cache-Tabelle
// (ppugv_daily_cache) uebernommen und dort fuer schnelle Abfragen vorgehalten.
//
// WICHTIG: Der Refresh (Poll der ppugv-DB) kann bis zu 15 Minuten dauern und
// laeuft daher IMMER asynchron im Hintergrund, ohne den Request-Response-Zyklus
// zu blockieren. Ein Mutex (ppugvRefreshInProgress) verhindert parallele
// Refresh-Laeufe.
//
// Umgebungvariablen:
//   Primär (mysql2-Direktverbindung):
//     PPUGV_HOST     (default: 10.10.199.14)
//     PPUGV_PORT     (default: 3306)
//     PPUGV_USER     (default: ppugv_user)
//     PPUGV_PASSWORD
//     PPUGV_DATABASE (default: ppugv)
//   Fallback (phpMyAdmin via HTTP, z.B. bei Firewall):
//     PPUGV_PMA_BASE (z.B. http://10.10.199.14/phpmyadmin)
//   Alias-Namen (für Coolify-Kompatibilität):
//     PHP_Host, PHP_User, PHP_Passwort, PHP_Datenbank
//
// Startup-Logging: Beim Serverstart wird automatisch geprüft, ob DNS,
// mysql2-Port und phpMyAdmin erreichbar sind – siehe checkPpugvConnectivity().
// =============================================================================

let ppugvRefreshInProgress = false;

// PPUGV-Zugangsdaten (mysql2-Direktverbindung, primär)
const PPUGV_HOST = process.env.PPUGV_HOST
  || process.env.PHP_Host
  || '10.10.199.14';
const PPUGV_PORT = parseInt(process.env.PPUGV_PORT || '3306', 10);
const PPUGV_USER = process.env.PPUGV_USER
  || process.env.PHP_User
  || 'ppugv_user';
const PPUGV_PASSWORD = process.env.PPUGV_PASSWORD
  || process.env.PHP_Passwort
  || '';
const PPUGV_DATABASE = process.env.PPUGV_DATABASE
  || process.env.PHP_Datenbank
  || 'ppugv';

// phpMyAdmin-Fallback (wenn Direktverbindung scheitert, z.B. von extern)
// Default: leitet sich aus PPUGV_HOST ab, z.B. http://10.10.199.14/phpmyadmin
const PPUGV_PMA_BASE = process.env.PPUGV_PMA_BASE || `http://${PPUGV_HOST}/phpmyadmin`;

// ===== PPBV (Nachfolge-DB von ppugv mit vollstaendigem Soll/Ist-Vergleich) =====
// Laeuft auf demselben MySQL-Server, nur andere Datenbank (Default: "ppbv")
// reused PPUGV_HOST/PORT/USER/PASSWORD – nur Datenbankname unterscheidet sich.
const PPBV_DATABASE = process.env.PPBV_DATABASE || 'ppbv';
let ppbvPool = null;

// ===== Stammdaten-Import (MA-Stammdaten, selber Server wie PPUGV) =====
const STAMMDAT_DATABASE = process.env.STAMMDAT_DATABASE || 'mitarbeiter';

function getStammdatConfig() {
  return {
    host: PPUGV_HOST,
    port: PPUGV_PORT,
    user: PPUGV_USER,
    password: PPUGV_PASSWORD,
    database: STAMMDAT_DATABASE,
  };
}

function getPpbvPool() {
  if (ppbvPool) return ppbvPool;
  if (!PPUGV_HOST || !PPUGV_USER || !PPBV_DATABASE) return null;
  try {
    ppbvPool = createPool({
      host: PPUGV_HOST,
      port: PPUGV_PORT,
      user: PPUGV_USER,
      password: PPUGV_PASSWORD,
      database: PPBV_DATABASE,
      waitForConnections: true,
      connectionLimit: 2,
      queueLimit: 0,
      dateStrings: true,
      timezone: '+00:00',
      connectTimeout: 15000,
    });
    return ppbvPool;
  } catch (err) {
    console.error('[PPBV] Pool-Erstellung fehlgeschlagen:', err.message);
    return null;
  }
}

// PPBV Read-Only-Schutz wie bei PPUGV
async function ppbvReadonlyQuery(sql, params = []) {
  const pool = getPpbvPool();
  if (!pool) throw new Error('PPBV-Pool nicht verfuegbar');
  const normalizedSql = String(sql).trim().toUpperCase();
  const allowedPrefixes = ['SELECT', 'SHOW', 'DESCRIBE', 'DESC ', 'EXPLAIN'];
  const isReadOnly = allowedPrefixes.some(p => normalizedSql.startsWith(p));
  if (!isReadOnly) {
    throw new Error(`PPBV: Schreibzugriff blockiert (nur SELECT erlaubt): ${String(sql).substring(0, 80)}...`);
  }
  if (String(sql).includes(';') && !String(sql).trim().endsWith(';')) {
    throw new Error('PPBV: Mehrfach-Statement erkannt und blockiert');
  }
  return await pool.execute(sql, params);
}

let ppugvPool = null;
let pmaSessionCookie = null;

function getPpugvPool() {
  if (ppugvPool) return ppugvPool;
  if (!PPUGV_HOST || !PPUGV_USER || !PPUGV_DATABASE) return null;
  try {
    ppugvPool = createPool({
      host: PPUGV_HOST,
      port: PPUGV_PORT,
      user: PPUGV_USER,
      password: PPUGV_PASSWORD,
      database: PPUGV_DATABASE,
      waitForConnections: true,
      connectionLimit: 2,
      queueLimit: 0,
      dateStrings: true,
      timezone: '+00:00',
      connectTimeout: 15000,
      // SAFETY: CuraFlow darf niemals in die externe PPUGV-Datenbank schreiben!
      // Der Pool-User hat zwar vollen Zugriff, aber wir verbieten Schreib-SQL
      // auf Applikationsebene als zusätzliche Schutzschicht (Defense in Depth).
    });
    return ppugvPool;
  } catch (err) {
    console.error('[PPUGV] Pool-Erstellung fehlgeschlagen:', err.message);
    return null;
  }
}

// SAFETY: Diese Funktion ist der EINZIGE Weg, wie auf den ppugv-Pool zugegriffen
// werden darf. Sie stellet sicher, dass NUR Lesezugriff (SELECT) erfolgt.
// Alle Anfragen gegen die externe ppugv-DB MUESSEN ueber diese Funktion laufen.
async function ppugvReadonlyQuery(sql, params = []) {
  const pool = getPpugvPool();
  if (!pool) throw new Error('PPUGV-Pool nicht verfuegbar');

  // Schutz-Schicht 1: Nur SELECT/SHOW/DESCRIBE/EXPLAIN erlauben
  const normalizedSql = String(sql).trim().toUpperCase();
  const allowedPrefixes = ['SELECT', 'SHOW', 'DESCRIBE', 'DESC ', 'EXPLAIN'];
  const isReadOnly = allowedPrefixes.some(p => normalizedSql.startsWith(p));
  if (!isReadOnly) {
    throw new Error(`PPUGV: Schreibzugriff blockiert (nur SELECT erlaubt): ${String(sql).substring(0, 80)}...`);
  }

  // Schutz-Schicht 2: Triviales Semikolon-Multi-Statement-Injection abfangen
  if (String(sql).includes(';') && !String(sql).trim().endsWith(';')) {
    throw new Error('PPUGV: Mehrfach-Statement erkannt und blockiert');
  }

  const result = await pool.execute(sql, params);
  return result;
}

// Prueft, ob die 'jahr'-Spalte in ppugv_daily_cache existiert (einmal gecacht).
// Falls eine Migration noch nicht gelaufen ist, fallback auf YEAR(frostungsdatum).
let ppugvHasJahrColumn = null;
async function hasJahrColumn() {
  if (ppugvHasJahrColumn !== null) return ppugvHasJahrColumn;
  try {
    const [cols] = await db.execute('SHOW COLUMNS FROM ppugv_daily_cache LIKE ?', ['jahr']);
    ppugvHasJahrColumn = cols.length > 0;
    if (!ppugvHasJahrColumn) {
      console.warn('[PPUGV] jahr-Spalte fehlt in ppugv_daily_cache – nutze YEAR(frostungsdatum) als Fallback. Migration läuft evtl. noch nicht.');
    }
  } catch (err) {
    console.warn('[PPUGV] SHOW COLUMNS fehlgeschlagen – nutze YEAR(frostungsdatum):', err.message);
    ppugvHasJahrColumn = false;
  }
  return ppugvHasJahrColumn;
}

// ===== phpMyAdmin-Fallback (nur wenn mysql2 nicht geht) =====

async function pmaLogin() {
  const loginUrl = `${PPUGV_PMA_BASE}/index.php`;
  const body = new URLSearchParams({
    pma_username: PPUGV_USER,
    pma_password: PPUGV_PASSWORD,
    server: '1', lang: 'de',
  });
  const response = await fetch(loginUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'CuraFlow-PPUGV-Cache/1.0' },
    body: body.toString(),
    redirect: 'manual',
  });
  const setCookie = response.headers.get('set-cookie');
  if (!setCookie) throw new Error(`phpMyAdmin-Login fehlgeschlagen (HTTP ${response.status})`);
  const cookieMatch = setCookie.match(/(phpMyAdmin=[^;]+)/);
  if (!cookieMatch) throw new Error(`phpMyAdmin-Cookie nicht gefunden`);
  pmaSessionCookie = cookieMatch[1];
}

async function fetchPpugvViaPma() {
  if (!PPUGV_PMA_BASE) throw new Error('PPUGV_PMA_BASE nicht gesetzt');
  if (!pmaSessionCookie) await pmaLogin();

  const exportUrl = `${PPUGV_PMA_BASE}/export.php`
    + `?db=${encodeURIComponent(PPUGV_DATABASE)}&table=export`
    + `&sql_query=${encodeURIComponent('SELECT * FROM export ORDER BY rec_id')}`
    + `&export_type=server&export_method=quick&format=json`;

  const doFetch = async (cookie) => {
    const res = await fetch(exportUrl, {
      method: 'GET',
      headers: { 'Cookie': cookie, 'User-Agent': 'CuraFlow-PPUGV-Cache/1.0' },
      redirect: 'manual',
    });
    if ((res.status === 302 || res.status === 301) && cookie) return null; // Session expired
    if (!res.ok) throw new Error(`phpMyAdmin-Export: HTTP ${res.status}`);
    return res.json();
  };

  let data = await doFetch(pmaSessionCookie);
  if (data === null) {
    pmaSessionCookie = null;
    await pmaLogin();
    data = await doFetch(pmaSessionCookie);
  }
  return data;
}

/**
 * Normalisiert ein vom phpMyAdmin-Export geliefertes JSON-Objekt.
 */
function normalizePpugvRow(row) {
  let jahr = 0;
  if (row.frostungsdatum) {
    const d = new Date(row.frostungsdatum);
    if (!isNaN(d.getTime())) jahr = d.getFullYear();
  }
  return {
    stationsname: String(row.stationsname || ''),
    fabschluessel: parseInt(row.fabschluessel, 10) || 0,
    fabname: String(row.fabname || ''),
    monat: String(row.monat || ''),
    schicht: String(row.schicht || ''),
    jahr,
    anzahl: parseInt(row.anzahl, 10) || 0,
    betten: parseInt(row.betten, 10) || 0,
    pfl_sen_ber: String(row.pfl_sen_ber || ''),
    patienten: parseInt(row.patienten, 10) || 0,
    belegung: parseFloat(String(row.belegung).replace(',', '.')) || 0,
    pflegekraefte_ist: parseFloat(String(row.pflegekraefte_ist).replace(',', '.')) || 0,
    hebammen_ist: parseFloat(String(row.hebammen_ist).replace(',', '.')) || 0,
    hilfskraefte_ist: parseFloat(String(row.hilfskraefte_ist).replace(',', '.')) || 0,
    anmerkungen: String(row.anmerkungen || ''),
    frostung: String(row.frostung || ''),
    frostungsdatum: row.frostungsdatum || null,
  };
}

// ===== Sanitizer: Entfernt Duplikate (gleiche Station/Monat/Schicht) =====
// Im legacy-Export gibt es oft mehrere Zeilen pro Monat, von denen einige
// Belegung=0 haben (Platzhalter). Wir behalten pro Gruppe die Zeile mit
// der hoechsten Belegung – das ist mit hoechster Wahrscheinlichkeit der
// korrekte Datensatz. Falls alle Belegung=0 haben, behalten wir den ersten.
const MONTH_ORDER_SQL = "FIELD(monat,'Januar','Februar','März','April','Mai','Juni','Juli','August','September','Oktober','November','Dezember')";

function sanitizePpugvRows(rows) {
  const groups = new Map();
  for (const row of rows) {
    const key = `${row.stationsname}|${row.monat}|${row.schicht}`;
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, row);
    } else if (Number(row.belegung) > Number(existing.belegung)) {
      groups.set(key, row);
    }
  }
  return Array.from(groups.values());
}

// ===== FAB (Fachabteilungs-) Aggregation =====
// Fasst Stationen zusammen, die denselben fabschluessel haben.
// Mehrere Stationen teilen sich eine FAB (z.B. ALIM, IN3, RPG → 0100 Innere Medizin).
// Stationen mit mehreren FABs (Komma-getrennt) werden der ersten FAB zugeordnet.
// Die Logik folgt der PHP-Export-Tabelle (ppugv_export.php).

const PPUGV_FAB_MAP = [
  { fabschluessel: 100,  fabname: 'Innere Medizin',                     stations: ['ALIM','IN3','IN5','RPG','TK','OTK'] },
  { fabschluessel: 1500, fabname: 'Allgemeine Chirurgie',               stations: ['CHI','GZ','TZS'] },
  { fabschluessel: 2400, fabname: 'Frauenheilkunde und Geburtshilfe',    stations: ['GYN','ENTB'] },
  { fabschluessel: 3600, fabname: 'Intensivmedizin',                    stations: ['ITS','ITSB'] },
  { fabschluessel: 1200, fabname: 'Neonatologie / Pädiatrie',           stations: ['NEOI','SLB'] },
];

function getFabForStation(stationsname) {
  for (const fab of PPUGV_FAB_MAP) {
    if (fab.stations.some(s => stationsname.includes(s))) return fab;
  }
  return null; // unbekannte Station bleibt eigenstaendig
}

async function fetchQuery(sql, params) {
  const [rows] = await db.execute(sql, params);
  return rows;
}

/**
 * Schreibt normalisierte PPUGV-Zeilen transaktional in den Cache.
 * Wird sowohl vom Background-Refresh als auch vom manuellen Upload genutzt.
 *
 * @param {string} cacheDate - Datum als 'YYYY-MM-DD'
 * @param {Array} normalizedRows - normalisierte Zeilen (via normalizePpugvRow)
 */
async function writePpugvDataToCache(cacheDate, normalizedRows) {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    await connection.execute('DELETE FROM ppugv_daily_cache WHERE cache_date = ?', [cacheDate]);

    const insertSql = `INSERT INTO ppugv_daily_cache 
      (cache_date, stationsname, fabschluessel, fabname, monat, schicht, jahr, anzahl, betten, pfl_sen_ber, patienten, belegung, pflegekraefte_ist, hebammen_ist, hilfskraefte_ist, anmerkungen, frostung, frostungsdatum)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

    for (const row of normalizedRows) {
      await connection.execute(insertSql, [
        cacheDate,
        row.stationsname,
        row.fabschluessel,
        row.fabname,
        row.monat,
        row.schicht,
        row.jahr || 0,
        row.anzahl,
        row.betten,
        row.pfl_sen_ber || '',
        row.patienten,
        row.belegung,
        row.pflegekraefte_ist,
        row.hebammen_ist,
        row.hilfskraefte_ist,
        row.anmerkungen || '',
        row.frostung,
        row.frostungsdatum,
      ]);
    }

    await connection.execute(
      'UPDATE ppugv_cache_meta SET status = ?, row_count = ?, refreshed_at = NOW() WHERE cache_date = ?',
      ['ok', normalizedRows.length, cacheDate]
    );

    await connection.commit();
    return { success: true, count: normalizedRows.length };
  } catch (txError) {
    await connection.rollback();
    throw txError;
  } finally {
    connection.release();
  }
}

// ===== Startup-Connectivity-Check (non-blocking, loggt Erreichbarkeit) =====

async function checkPpugvConnectivity() {
  const checks = [];

  // 1) DNS / Host-Auflösung prüfen
  checks.push(new Promise((resolve) => {
    const dns = PPUGV_HOST;
    const isIp = /^\d+\.\d+\.\d+\.\d+$/.test(dns);
    if (isIp) {
      resolve({ type: 'DNS', target: dns, status: 'info', detail: 'IP-Adresse (keine Auflösung nötig)' });
    } else {
      const lookup = setTimeout(() => resolve({ type: 'DNS', target: dns, status: 'error', detail: 'Timeout nach 3s' }), 3000);
      import('dns').then((dnsMod) => {
        dnsMod.default.resolve(dns, (err) => {
          clearTimeout(lookup);
          resolve(err
            ? { type: 'DNS', target: dns, status: 'error', detail: err.message }
            : { type: 'DNS', target: dns, status: 'info', detail: 'Auflösung erfolgreich' });
        });
      }).catch(() => clearTimeout(lookup));
    }
  }));

  // 2) mysql2-Direktverbindung prüfen (TCP connect + SELECT 1)
  checks.push((async () => {
    if (!PPUGV_HOST || !PPUGV_USER || !PPUGV_DATABASE) {
      return { type: 'mysql2', target: `${PPUGV_HOST}:${PPUGV_PORT}`, status: 'skip', detail: 'Nicht konfiguriert (Host/User/Datenbank fehlen)' };
    }
    try {
      const [rows] = await ppugvReadonlyQuery('SELECT 1 AS ok');
      const ok = rows?.[0]?.ok === 1;
      return { type: 'mysql2', target: `${PPUGV_HOST}:${PPUGV_PORT}`, status: ok ? 'ok' : 'error', detail: ok ? 'Verbindung + Query OK' : 'SELECT 1 lieferte unerwartetes Ergebnis' };
    } catch (err) {
      return { type: 'mysql2', target: `${PPUGV_HOST}:${PPUGV_PORT}`, status: 'error', detail: `${err.code || err.message}` };
    }
  })());

  // 3) phpMyAdmin HTTP-Erreichbarkeit prüfen
  checks.push((async () => {
    if (!PPUGV_PMA_BASE) return { type: 'phpMyAdmin', target: PPUGV_PMA_BASE || '(nicht gesetzt)', status: 'skip', detail: 'PPUGV_PMA_BASE nicht konfiguriert' };
    try {
      const ctrl = new AbortController();
      const to = setTimeout(() => ctrl.abort(), 8000);
      const res = await fetch(PPUGV_PMA_BASE, { method: 'HEAD', signal: ctrl.signal, redirect: 'manual' });
      clearTimeout(to);
      return { type: 'phpMyAdmin', target: PPUGV_PMA_BASE, status: 'ok', detail: `HTTP ${res.status} – Antwort empfangen` };
    } catch (err) {
      if (err.name === 'AbortError') return { type: 'phpMyAdmin', target: PPUGV_PMA_BASE, status: 'error', detail: 'Timeout nach 8s' };
      return { type: 'phpMyAdmin', target: PPUGV_PMA_BASE, status: 'error', detail: err.message };
    }
  })());

  // Ergebnisse abwarten & ausgeben
  const results = await Promise.allSettled(checks);
  const separator = '─'.repeat(58);

  console.log('');
  console.log('╔' + separator + '╗');
  console.log('║        🔌 PPUGV-Connectivity-Check (Startup)                  ║');
  console.log('╚' + separator + '╝');

  for (const r of results) {
    const c = r.status === 'fulfilled' ? r.value : { type: '?', target: '?', status: 'error', detail: r.reason?.message || 'Unbekannter Fehler' };
    const icon = c.status === 'ok' ? ' ✅' : c.status === 'info' ? ' ℹ️' : c.status === 'skip' ? ' ⏭' : ' ❌';
    console.log(`  ${icon} ${c.type.padEnd(12)} ${(c.target || '').padEnd(28)} ${c.status.padEnd(6)}  ${c.detail}`);
  }

  // Nur mysql2 und phpMyAdmin sind fuer den Datenabruf relevant (nicht DNS)
  const relevantResults = results
    .filter(r => r.status === 'fulfilled' && r.value?.type !== 'DNS')
    .map(r => r.value);
  const anyServiceOk = relevantResults.some(c => c.status === 'ok');
  const anyServiceConfigured = relevantResults.some(c => c.status !== 'skip');

  // DNS-Info: Auflösung ok oder IP-Adresse (dann ist der Host grundsätzlich erreichbar)
  const dnsResult = results.find(r => r.status === 'fulfilled' && r.value?.type === 'DNS');
  const dnsReachable = dnsResult?.value?.status === 'ok' || dnsResult?.value?.status === 'info';
  const mysqlOk = relevantResults.some(c => c.type === 'mysql2' && c.status === 'ok');
  const pmaConfigured = relevantResults.some(c => c.type === 'phpMyAdmin' && c.status !== 'skip');

  console.log(separator);
  if (anyServiceOk) {
    if (mysqlOk) {
      console.log(`  ✅ mysql2-Direktverbindung zu ${PPUGV_HOST}:${PPUGV_PORT} ist erreichbar –`);
      console.log('     Background-Refresh ueber mysql2 wird funktionieren.');
    } else {
      console.log('  ✅ phpMyAdmin ist erreichbar – Background-Refresh ueber HTTP wird funktionieren.');
    }
  } else if (!anyServiceConfigured) {
    console.log('  ⏭  PPUGV nicht konfiguriert – Cache nur via manuellen Upload verfuegbar.');
    console.log('     Setze PPUGV_HOST/USER/PASSWORD (mysql2) oder PPUGV_PMA_BASE (phpMyAdmin).');
  } else if (dnsReachable && !mysqlOk && !pmaConfigured) {
    console.log(`  ⚠️  Host ${PPUGV_HOST} ist erreichbar, aber Port ${PPUGV_PORT} blockiert (Firewall).`);
    console.log('     → Konfiguriere PPUGV_PMA_BASE fuer phpMyAdmin-Fallback,');
    console.log('     → Oder lade Daten manuell ueber POST /api/master/ppugv/upload hoch.');
  } else {
    console.log('  ⚠️  Alle PPUGV-Zugaenge sind derzeit nicht erreichbar (Firewall?).');
    console.log('     → Cache kann ueber POST /api/master/ppugv/upload befuellt werden.');
  }
  console.log(separator);
  console.log('');
}

// Startup-Check non-blocking ausfuehren
checkPpugvConnectivity().catch((err) => console.error('[PPUGV-CONNECT] Fehler im Startup-Check:', err.message));

/**
 * Fuehrt den eigentlichen Refresh asynchron im Hintergrund aus.
 *
 * Strategie (2 Wege + Fallback):
 *   1. PRIMARY: mysql2-Direktverbindung (schnell, da Server im Krankenhaus-Netz)
 *   2. FALLBACK: phpMyAdmin-Export per HTTP (wenn mysql2 nicht geht, z.B. Firewall)
 *   3. NOTFALL: Manueller JSON-Upload ueber POST /api/master/ppugv/upload
 *
 * Das Mutex ppugvRefreshInProgress verhindert doppelte Ausfuehrungen.
 */
async function runPpugvRefreshInBackground() {
  if (ppugvRefreshInProgress) {
    console.log('[PPUGV-BG] Refresh bereits in Gang – abbrechen.');
    return;
  }

  ppugvRefreshInProgress = true;
  const today = new Date().toISOString().split('T')[0];
  const startTime = Date.now();

  console.log(`[PPUGV-BG] ${new Date().toISOString()} Starte Hintergrund-Refresh...`);

  try {
    // Status auf "running" setzen
    await db.execute(
      `INSERT INTO ppugv_cache_meta (cache_date, refreshed_at, status, row_count)
       VALUES (?, NOW(), 'running', 0)
       ON DUPLICATE KEY UPDATE status = 'running', refreshed_at = NOW(), error_message = NULL`,
      [today]
    );

    // ----- VERSUCH 1: mysql2-Direktverbindung (primary, READ-ONLY) -----
    let sourceRows = null;

    if (PPUGV_HOST && PPUGV_USER && PPUGV_DATABASE) {
      try {
        console.log(`[PPUGV-BG] Versuche mysql2-Direktverbindung zu ${PPUGV_HOST}:${PPUGV_PORT}...`);
        const [rows] = await ppugvReadonlyQuery(
          'SELECT stationsname, fabschluessel, fabname, monat, schicht, anzahl, betten, pfl_sen_ber, patienten, belegung, pflegekraefte_ist, hebammen_ist, hilfskraefte_ist, anmerkungen, frostung, frostungsdatum FROM export ORDER BY rec_id'
        );
        sourceRows = rows;
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        console.log(`[PPUGV-BG] mysql2 erfolgreich nach ${elapsed}s – ${sourceRows.length} Zeilen`);
      } catch (dbErr) {
        console.warn(`[PPUGV-BG] mysql2 fehlgeschlagen: ${dbErr.code || dbErr.message} – versuche phpMyAdmin-Fallback...`);
        sourceRows = null;
      }
    } else {
      console.log('[PPUGV-BG] Kein mysql2-Pool konfiguriert – versuche phpMyAdmin...');
    }

    // ----- VERSICH 2: phpMyAdmin-Fallback (wenn mysql2 nicht geklappt hat) -----
    if (!sourceRows && PPUGV_PMA_BASE) {
      try {
        console.log(`[PPUGV-BG] Versuche phpMyAdmin via ${PPUGV_PMA_BASE}...`);
        const rawJson = await fetchPpugvViaPma();
        if (Array.isArray(rawJson) && rawJson.length > 0) {
          sourceRows = rawJson.map(normalizePpugvRow);
          const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
          console.log(`[PPUGV-BG] phpMyAdmin erfolgreich nach ${elapsed}s – ${sourceRows.length} Zeilen`);
        }
      } catch (pmaErr) {
        console.warn(`[PPUGV-BG] phpMyAdmin fehlgeschlagen: ${pmaErr.message}`);
      }
    }

    // ----- NICHTS FUNKTIONIERT -----
    if (!sourceRows || sourceRows.length === 0) {
      const msg = !sourceRows
        ? 'Keine Verbindung zur ppugv-Datenbank (mysql2 + phpMyAdmin-Fallback fehlgeschlagen). Nutze manuellen Upload.'
        : 'Keine Daten in der Export-Tabelle gefunden.';
      console.error(`[PPUGV-BG] ${msg}`);
      await db.execute(
        "UPDATE ppugv_cache_meta SET status = 'error', error_message = ? WHERE cache_date = ?",
        [msg, today]
      );
      return;
    }

    // ----- IN CACHE SCHREIBEN -----
    const result = await writePpugvDataToCache(today, sourceRows);
    const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[PPUGV-BG] ${new Date().toISOString()} Refresh erfolgreich – ${result.count} Datensaetze in ${totalTime}s`);
  } catch (error) {
    console.error(`[PPUGV-BG] Fehler nach ${((Date.now() - startTime) / 1000).toFixed(1)}s:`, error.code || error.message);
    try {
      await db.execute(
        "UPDATE ppugv_cache_meta SET status = 'error', error_message = ? WHERE cache_date = ?",
        [(error.message || String(error)).substring(0, 500), today]
      );
    } catch (metaError) {
      console.error('[PPUGV-BG] Konnte Meta-Status nicht aktualisieren:', metaError.message);
    }
  } finally {
    ppugvRefreshInProgress = false;
    const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[PPUGV-BG] Refresh beendet (${totalTime}s) – Mutex freigegeben.`);
  }
}

/**
 * Sofortige, erzwungene Cache-Abfrage: Prueft, ob der Cache leer ist.
 * Wenn ja -> startet asynchrone Hintergrundaktualisierung und antwortet
 * sofort mit Status "building".
 */
async function ensurePpugvCacheAsync() {
  if (ppugvRefreshInProgress) {
    return 'running'; // Laueft bereits
  }

  try {
    const [row] = await db.execute('SELECT COUNT(*) AS cnt FROM ppugv_daily_cache');
    const count = Number(row[0]?.cnt || 0);

    if (count === 0) {
      // Cache ist leer – starte Hintergrund-Refresh (fire & forget)
      console.log('[PPUGV] Cache leer – starte asynchronen Hintergrund-Refresh.');
      runPpugvRefreshInBackground().catch((err) => {
        console.error('[PPUGV] Unerwarteter Fehler im Hintergrund-Refresh:', err.message);
      });
      return 'triggered';
    }

    // Cache ist gefuellt – nichts zu tun
    return 'ready';
  } catch (error) {
    // Tabelle existiert vielleicht noch nicht – das ist ok
    console.warn('[PPUGV] ensurePpugvCache konnte Cache nicht prüfen:', error.message);
    return 'error';
  }
}

/**
 * GET /api/master/ppugv
 * Liefert die gecachten PPUGV-Exportdaten.
 *
 * Verhalten bei leerem Cache:
 *   Der erste Aufruf startet automatisch einen asynchronen Hintergrund-Refresh
 *   und antwortet sofort mit {"status":"building", "message":"..."}.
 *   Der Client (Frontend) kann dann polling-mässig den Status pruefen
 *   (GET /api/master/ppugv/meta) und erneut laden.
 *
 * Query-Parameter:
 *   station  – Filter auf Stationsname (optional)
 *   monat    – Filter auf Monatsname (optional, z.B. "Januar")
 *   jahr     – Filter auf Jahr (optional, 4-stellig)
 */
router.get('/ppugv', async (req, res, next) => {
  try {
    const cacheStatus = await ensurePpugvCacheAsync();

    const { station, monat, jahr } = req.query;
    let sql = 'SELECT * FROM ppugv_daily_cache WHERE 1=1';
    const params = [];

    if (station) {
      sql += ' AND stationsname LIKE ?';
      params.push(`%${station}%`);
    }
    if (monat) {
      sql += ' AND monat = ?';
      params.push(monat);
    }
    if (jahr) {
      // Fallback auf YEAR(frostungsdatum), falls jahr-Spalte fehlt (Migration nicht gelaufen)
      const yearFilter = await hasJahrColumn() ? 'jahr' : 'YEAR(frostungsdatum)';
      sql += ` AND ${yearFilter} = ?`;
      params.push(parseInt(jahr, 10));
    }

    sql += ` ORDER BY stationsname, ${MONTH_ORDER_SQL}, schicht`;

    const [rows] = await db.execute(sql, params);

    // Sanitizer: Duplikate (gleiche Station/Monat/Schicht) entfernen,
    // die Zeile mit hoechster Belegung behalten
    const sanitized = sanitizePpugvRows(rows);

    // Cache-Metadaten
    const [metaRows] = await db.execute(
      'SELECT * FROM ppugv_cache_meta ORDER BY id DESC LIMIT 1'
    );

    const isBuilding = cacheStatus === 'triggered' || cacheStatus === 'running';
    const isEmpty = sanitized.length === 0;

    res.json({
      data: sanitized,
      meta: metaRows[0] || null,
      count: sanitized.length,
      rawCount: rows.length,
      cacheStatus,
      building: isBuilding,
      message: isBuilding
        ? 'PPUGV-Cache wird im Hintergrund aufgebaut.'
        : isEmpty
          ? 'Keine gecachten Daten vorhanden.'
          : null,
    });
  } catch (error) {
    console.error('[PPUGV] GET error:', error.message);
    next(error);
  }
});

/**
 * GET /api/master/ppugv/stations
 */
router.get('/ppugv/stations', async (req, res, next) => {
  try {
    const [rows] = await db.execute(
      'SELECT DISTINCT stationsname, MIN(fabschluessel) AS fabschluessel, MIN(fabname) AS fabname FROM ppugv_daily_cache GROUP BY stationsname ORDER BY stationsname'
    );
    res.json({ stations: rows });
  } catch (error) {
    console.error('[PPUGV] stations error:', error.message);
    next(error);
  }
});

/**
 * GET /api/master/ppugv/fabstats
 * Aggregierte PPUGV-Daten auf Fachabteilungs-Ebene (FAB).
 * Fasst Stationen mit gleichem fabschluessel zusammen – analog zur
 * InEK-Meldetabelle im PHP-Frontend.
 *
 * Query-Parameter:
 *   jahr – 4-stellig (optional, default: aktuelles Jahr)
 *   fab  – fabschluessel (optional, z.B. "0100" fuer Innere Medizin)
 */
router.get('/ppugv/fabstats', async (req, res, next) => {
  try {
    const { jahr } = req.query;
    const year = parseInt(jahr, 10) || new Date().getFullYear();

    // Alle Rohdaten fuer das Jahr laden (mit Fallback falls jahr-Spalte fehlt)
    const yearFilter = await hasJahrColumn() ? 'jahr' : 'YEAR(frostungsdatum)';
    const [rows] = await db.execute(
      `SELECT * FROM ppugv_daily_cache WHERE ${yearFilter} = ? ORDER BY stationsname, ${MONTH_ORDER_SQL}, schicht`,
      [year]
    );

    const sanitized = sanitizePpugvRows(rows);

    // Nach FAB gruppieren
    const fabMap = new Map();
    for (const row of sanitized) {
      const fab = getFabForStation(row.stationsname);
      const key = fab ? `${fab.fabschluessel}|${fab.fabname}` : `${row.fabschluessel}|${row.fabname}`;
      if (!fabMap.has(key)) {
        fabMap.set(key, {
          fabschluessel: fab ? fab.fabschluessel : row.fabschluessel,
          fabname: fab ? fab.fabname : row.fabname,
          monate: {},
          stationen: new Set(),
        });
      }
      const entry = fabMap.get(key);
      entry.stationen.add(row.stationsname);

      if (!entry.monate[row.monat]) {
        entry.monate[row.monat] = {
          monat: row.monat,
          tag: { patienten: 0, belegung: 0, pflege: 0, hilfe: 0, hebamme: 0, anzahl: 0, betten: 0 },
          nacht: { patienten: 0, belegung: 0, pflege: 0, hilfe: 0, hebamme: 0, anzahl: 0, betten: 0 },
        };
      }
      const m = entry.monate[row.monat];
      const target = row.schicht === 'Nacht' ? m.nacht : m.tag;
      target.patienten += Number(row.patienten);
      target.belegung += Number(row.belegung);
      target.pflege += Number(row.pflegekraefte_ist);
      target.hilfe += Number(row.hilfskraefte_ist);
      target.hebamme += Number(row.hebammen_ist);
      target.anzahl += Number(row.anzahl);
      if (row.betten > target.betten) target.betten = Number(row.betten);
    }

    // FABs in Array umwandeln + Monate sortieren
    const fabArray = Array.from(fabMap.values()).map(fab => ({
      ...fab,
      stationen: Array.from(fab.stationen).sort(),
      monate: Object.values(fab.monate).sort((a, b) => {
        const ma = MONTH_ORDER_SQL.indexOf(a.monat);
        const mb = MONTH_ORDER_SQL.indexOf(b.monat);
        return ma - mb;
      }),
    }));

    // Gesamt-KH aggregieren (alle FABs)
    const gesamtMonate = {};
    for (const fab of fabArray) {
      for (const m of fab.monate) {
        if (!gesamtMonate[m.monat]) {
          gesamtMonate[m.monat] = {
            monat: m.monat,
            tag: { patienten: 0, belegung: 0, pflege: 0, hilfe: 0, hebamme: 0, anzahl: 0, betten: 0 },
            nacht: { patienten: 0, belegung: 0, pflege: 0, hilfe: 0, hebamme: 0, anzahl: 0, betten: 0 },
          };
        }
        const g = gesamtMonate[m.monat];
        for (const shift of ['tag', 'nacht']) {
          g[shift].patienten += m[shift].patienten;
          g[shift].belegung += m[shift].belegung;
          g[shift].pflege += m[shift].pflege;
          g[shift].hilfe += m[shift].hilfe;
          g[shift].hebamme += m[shift].hebamme;
          g[shift].anzahl += m[shift].anzahl;
          if (m[shift].betten > g[shift].betten) g[shift].betten = m[shift].betten;
        }
      }
    }

    res.json({
      jahr: year,
      fabs: fabArray,
      gesamt: Object.values(gesamtMonate).sort((a, b) => {
        const ma = MONTH_ORDER_SQL.indexOf(a.monat);
        const mb = MONTH_ORDER_SQL.indexOf(b.monat);
        return ma - mb;
      }),
    });
  } catch (error) {
    console.error('[PPUGV] fabstats error:', error.message);
    next(error);
  }
});

/**
 * GET /api/master/ppugv/trends
 * Vergleichsdaten fuer Jahrgangsvergleiche und Trends.
 *
 * Query-Parameter:
 *   station – Stationsname (optional, default: alle)
 *   jahre   – Komma-getrennte Jahresliste (optional, default: letzte 3 Jahre)
 *
 * Liefert monatliche Durchschnittswerte fuer jedes angefragte Jahr,
 * aufgeschluesselt nach Station/FAB.
 */
router.get('/ppugv/trends', async (req, res, next) => {
  try {
    const { station, jahre } = req.query;
    const years = jahre
      ? jahre.split(',').map(y => parseInt(y.trim(), 10)).filter(y => !isNaN(y))
      : [new Date().getFullYear() - 2, new Date().getFullYear() - 1, new Date().getFullYear()];

    const allData = [];
    const yearColumn = await hasJahrColumn() ? 'jahr' : 'YEAR(frostungsdatum)';
    for (const year of years) {
      let sql = `SELECT * FROM ppugv_daily_cache WHERE ${yearColumn} = ?`;
      const params = [year];
      if (station && station !== 'all') {
        sql += ' AND stationsname LIKE ?';
        params.push(`%${station}%`);
      }
      sql += ` ORDER BY stationsname, ${MONTH_ORDER_SQL}, schicht`;
      const [rows] = await db.execute(sql, params);
      const sanitized = sanitizePpugvRows(rows);
      allData.push({ year, rows: sanitized });
    }

    // Monatliche Kennzahlen pro Jahr aufbereiten
    const monthlyTrend = {};
    for (const MONTH of ['Januar','Februar','März','April','Mai','Juni','Juli','August','September','Oktober','November','Dezember']) {
      monthlyTrend[MONTH] = { monat: MONTH };
      for (const { year, rows } of allData) {
        const monthRows = rows.filter(r => r.monat === MONTH);
        const tagRows = monthRows.filter(r => r.schicht === 'Tag');
        const nachtRows = monthRows.filter(r => r.schicht === 'Nacht');

        monthlyTrend[MONTH][`patienten_${year}`] = tagRows.reduce((s, r) => s + Number(r.patienten), 0);
        monthlyTrend[MONTH][`belegung_${year}`] = tagRows.length > 0
          ? tagRows.reduce((s, r) => s + Number(r.belegung), 0) / tagRows.length : 0;
        monthlyTrend[MONTH][`pflege_${year}`] = tagRows.reduce((s, r) => s + Number(r.pflegekraefte_ist), 0);
        monthlyTrend[MONTH][`hilfe_${year}`] = tagRows.reduce((s, r) => s + Number(r.hilfskraefte_ist), 0);
        monthlyTrend[MONTH][`hebamme_${year}`] = tagRows.reduce((s, r) => s + Number(r.hebammen_ist), 0);
        monthlyTrend[MONTH][`patienten_nacht_${year}`] = nachtRows.reduce((s, r) => s + Number(r.patienten), 0);
      }
    }

    res.json({
      years,
      monate: Object.values(monthlyTrend),
    });
  } catch (error) {
    console.error('[PPUGV] trends error:', error.message);
    next(error);
  }
});

/**
 * POST /api/master/ppugv/refresh
 * Startet eine sofortige Aktualisierung des Caches im Hintergrund.
 * Die Antwort kommt sofort (HTTP 202) – der Refresh laeuft asynchron weiter.
 */
router.post('/ppugv/refresh', async (req, res, next) => {
  try {
    const hasMysqlConfig = !!(PPUGV_HOST && PPUGV_USER && PPUGV_PASSWORD);
    const hasPmaConfig = !!PPUGV_PMA_BASE;

    if (!hasMysqlConfig && !hasPmaConfig) {
      return res.status(503).json({
        error: 'PPUGV-Zugang nicht konfiguriert. Setzen Sie PPUGV_HOST/USER/PASSWORD (mysql2) oder PPUGV_PMA_BASE (phpMyAdmin).',
      });
    }

    if (ppugvRefreshInProgress) {
      return res.status(409).json({
        status: 'already_running',
        message: 'Ein Refresh laeuft bereits im Hintergrund. Bitte warten.',
      });
    }

    // Fire & Forget – der Refresh laeuft asynchron, der Request antwortet sofort
    runPpugvRefreshInBackground().catch((err) => {
      console.error('[PPUGV] Unerwarteter Fehler im Hintergrund-Refresh:', err.message);
    });

    res.status(202).json({
      status: 'started',
      message: 'PPUGV-Cache-Refresh wurde im Hintergrund gestartet. Der Status kann ueber /api/master/ppugv/meta abgefragt werden.',
    });
  } catch (error) {
    console.error('[PPUGV] refresh error:', error.message);
    next(error);
  }
});

/**
 * GET /api/master/ppugv/meta
 * Liefert die Cache-Metadaten (letzte Aktualisierung, Status, laufender Refresh).
 */
router.get('/ppugv/meta', async (req, res, next) => {
  try {
    const [rows] = await db.execute(
      'SELECT * FROM ppugv_cache_meta ORDER BY id DESC LIMIT 10'
    );
    res.json({
      meta: rows,
      refreshInProgress: ppugvRefreshInProgress,
    });
  } catch (error) {
    console.error('[PPUGV] meta error:', error.message);
    next(error);
  }
});

/**
 * GET /api/master/ppugv/quality
 * Datenqualitaets-Check: vergleicht Zeilen pro Jahr/Quartal mit Erwartung
 * (14 Stationen x 3 Monate x 2 Schichten = 84 pro Quartal, 336 pro Jahr).
 *
 * Prueft die Vollstaendigkeit der aus dem PHP-System kommenden export-Daten.
 */
router.get('/ppugv/quality', async (req, res, next) => {
  try {
    const hasJahr = await hasJahrColumn();
    const yearCol = hasJahr ? 'jahr' : 'YEAR(frostungsdatum)';

    // Zeilen pro Jahr zaehlen
    const [yearRows] = await db.execute(
      `SELECT ${yearCol} AS jahr, COUNT(*) AS cnt,
              COUNT(DISTINCT stationsname) AS stationen,
              COUNT(DISTINCT monat) AS monate
       FROM ppugv_daily_cache
       GROUP BY ${yearCol}
       ORDER BY ${yearCol} DESC`
    );

    // Erwartete Werte aus PHP-Original
    const EXPECTED_STATIONS = 14;
    const EXPECTED_MONTHS_FULL_YEAR = 12;
    const EXPECTED_SHIFT = 2;
    const expectedPerYear = EXPECTED_STATIONS * EXPECTED_MONTHS_FULL_YEAR * EXPECTED_SHIFT;

    const years = yearRows.map(r => ({
      jahr: Number(r.jahr),
      rowCount: Number(r.cnt),
      stationen: Number(r.stationen),
      monate: Number(r.monate),
      erwartet: expectedPerYear,
      komplett: Number(r.cnt) >= expectedPerYear * 0.95,
      abdeckung: Math.round((Number(r.cnt) / expectedPerYear) * 100),
    }));

    // Quartals-Check fuer aktuelles Jahr
    const currentYear = new Date().getFullYear();
    const currentYearRow = years.find(y => y.jahr === currentYear);
    let quarterly = null;
    if (currentYearRow) {
      const [qRows] = await db.execute(
        `SELECT QUARTER(frostungsdatum) AS q, COUNT(*) AS cnt,
                COUNT(DISTINCT stationsname) AS stationen
         FROM ppugv_daily_cache
         WHERE ${yearCol} = ?
         GROUP BY QUARTER(frostungsdatum)
         ORDER BY q`,
        [currentYear]
      );
      quarterly = qRows.map(r => ({
        quartal: Number(r.q),
        rowCount: Number(r.cnt),
        stationen: Number(r.stationen),
        erwartet: EXPECTED_STATIONS * 3 * EXPECTED_SHIFT,
      }));
    }

    res.json({
      expectedPerYear,
      expectedPerQuarter: EXPECTED_STATIONS * 3 * EXPECTED_SHIFT,
      expectedStations: EXPECTED_STATIONS,
      years,
      quarterly,
      hasJahrColumn: hasJahr,
    });
  } catch (error) {
    console.error('[PPUGV] quality error:', error.message);
    next(error);
  }
});

/**
 * GET /api/master/ppugv/export/inek
 * Exportiert die PPUGV-Daten als formatierte Excel-Datei (.xlsx) im
 * InEK-Meldeformat – analog zu PHP/ppugv_excelexport.php.
 *
 * Query: jahr (optional, default aktuelles Jahr)
 */
router.get('/ppugv/export/inek', async (req, res, next) => {
  try {
    const { jahr } = req.query;
    const year = parseInt(jahr, 10) || new Date().getFullYear();

    const hasJahr = await hasJahrColumn();
    const yearCol = hasJahr ? 'jahr' : 'YEAR(frostungsdatum)';
    const [rows] = await db.execute(
      `SELECT * FROM ppugv_daily_cache WHERE ${yearCol} = ? ORDER BY stationsname, ${MONTH_ORDER_SQL}, schicht`,
      [year]
    );
    const data = sanitizePpugvRows(rows);

    const wb = new ExcelJS.Workbook();
    wb.creator = 'CuraFlow PPUGV-Export';
    wb.created = new Date();
    const ws = wb.addWorksheet('InEK-Meldung', {
      views: [{ state: 'frozen', ySplit: 7 }],
    });

    // === KOPFZEILE (wie PHP-Original) ===
    ws.getCell('A1').value = 'Vorlage zur PPUGV-Nachweismeldung (CuraFlow-Export)';
    ws.getCell('A1').font = { bold: true, size: 14 };
    ws.mergeCells('A1:Z1');

    ws.getCell('A3').value = 'Institutionskennzeichen (IK)';
    ws.getCell('B3').value = '261300118';
    ws.getCell('A4').value = 'Jahr';
    ws.getCell('B4').value = year;
    ws.getCell('A5').value = 'Quartal';
    ws.getCell('B5').value = '1-4';
    ws.getCell('A3').font = ws.getCell('A4').font = ws.getCell('A5').font = { bold: true };

    // === HEADER-ZEILE (Zeile 7) ===
    const headerStyle = {
      font: { bold: true },
      alignment: { horizontal: 'left', wrapText: true, vertical: 'top' },
      fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD3D3D3' } },
      border: { top: { style: 'thin' }, bottom: { style: 'thin' } },
    };
    const headers = [
      'Standortkennzeichen',
      'Verwendeter Name der Station',
      'Fachabteilungsschlüssel nach den Daten nach § 21 KHEntgG (ggf. kommasepariert)',
      'Verwendeter Name der Fachabteilung (ggf. kommasepariert)',
      'Kategorie der Station',
      'Monat',
      'Schicht (Tag-/Nachtschicht oder 24-Stunden-Zeitraum)',
      'Anzahl der Schichten im Monat',
      'Anzahl Betten',
      'Anzahl teilstationäre Behandlungsplätze',
      'Station im Bereich Geburtshilfe (ja/nein)',
      'Anzahl Patienten',
      'durchschnittliche Patientenbelegung',
      'Pflegefachkräfte (Soll) in VZÄ § 4 Abs. 1 / § 5 Abs. 1 PPBV',
      'Ausfallzeiten (Wochenfeiertage, Urlaub) – Pflegefachkräfte Soll VZÄ § 4 Abs. 4 Nr. 2',
      'Ausfallzeiten (Arbeitsunfähigkeit, Schutzfristen) – Pflegefachkräfte Soll VZÄ § 4 Abs. 4 Nr. 1',
      'Ausfallzeiten (sonstige) – Pflegefachkräfte Soll VZÄ § 4 Abs. 4 Nr. 3',
      'Leitende Pflegefachkräfte (Soll) VZÄ § 4 Abs. 5',
      'Ausfallzeiten (Wochenfeiertage, Urlaub) – Ist VZÄ § 6 Abs. 7 i.V.m. § 4 Abs. 4 Nr. 2',
      'Ausfallzeiten (Arbeitsunfähigkeit, Schutzfristen) – Ist VZÄ § 6 Abs. 7 i.V.m. § 4 Abs. 4 Nr. 1',
      'Ausfallzeiten (sonstige) – Ist VZÄ § 6 Abs. 7 i.V.m. § 4 Abs. 4 Nr. 3',
      'durchschnittlich eingesetzte Pflegefachkräfte (Ist) VZÄ § 6 PPBV',
      'durchschnittlich eingesetzte Hebammen (Ist) VZÄ § 6 PPBV',
      'durchschnittlich eingesetzte Pflegehilfskräfte (Ist) VZÄ § 6 PPBV',
      'durchschnittlich eingesetzte Auszubildende (Ist) VZÄ § 6 PPBV',
      'Anmerkung',
    ];
    headers.forEach((title, idx) => {
      const cell = ws.getCell(1 + idx, 7);
      cell.value = title;
      cell.style = headerStyle;
    });
    ws.getRow(7).height = 60;

    // === DATENZEILEN ===
    data.forEach((row, i) => {
      const r = i + 8;
      // Leere Felder für Spalten, die wir im Cache nicht have (Soll-Ausfallzeiten etc.)
      const gyngeb = /gyn|entb/i.test(row.stationsname) ? 'ja' : 'nein';
      const category = /its/i.test(row.stationsname) ? 'Intensivstation Erwachsene' : 'Normalstation Erwachsene';

      const values = [
        '771003000',                                          // A: Standort
        row.stationsname,                                     // B: Station
        String(row.fabschluessel),                            // C: FAB-Schlüssel
        row.fabname,                                          // D: FAB-Name
        category,                                             // E: Kategorie
        row.monat,                                            // F: Monat
        row.schicht,                                          // G: Schicht
        row.anzahl,                                           // H: Anzahl Schichten
        row.betten,                                           // I: Betten
        '',                                                   // J: Teilstationär
        gyngeb,                                               // K: Geburtshilfe
        row.patienten,                                        // L: Patienten
        Number(row.belegung),                                 // M: Belegung
        '',                                                   // N: Pflege Soll
        '',                                                   // O-Q: Soll-Ausfallzeiten
        '',
        '',
        '',                                                   // R: Leitende Soll
        '',                                                   // S-U: Ist-Ausfallzeiten
        '',
        '',
        Number(row.pflegekraefte_ist),                        // V: Pflege Ist
        Number(row.hebammen_ist),                             // W: Hebammen Ist
        Number(row.hilfskraefte_ist),                         // X: Hilfskräfte Ist
        '',                                                   // Y: Azubis (nicht im Cache)
        row.anmerkungen || '',                                // Z: Anmerkung
      ];
      values.forEach((v, idx) => {
        const cell = ws.getCell(idx + 1, r);
        cell.value = v;
        cell.alignment = { horizontal: 'left' };
      });
    });

    // === SPALTENBREITEN ===
    const colWidths = [25, 50, 50, 50, 30, 10, 20, 10, 10, 10, 10, 10, 15, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 30];
    colWidths.forEach((w, i) => {
      ws.getColumn(i + 1).width = w;
    });

    // === RESPONSE ===
    const fileName = `PPUGV_InEK_${year}_${new Date().toISOString().split('T')[0]}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);

    const buffer = await wb.xlsx.writeBuffer();
    res.send(Buffer.from(buffer));
    console.log(`[PPUGV-EXPORT] InEK-Excel exportiert: ${data.length} Zeilen, Jahr ${year}`);
  } catch (error) {
    console.error('[PPUGV-EXPORT] error:', error.message);
    next(error);
  }
});

/**
 * GET /api/master/ppugv/export/csv
 * CSV-Export der Rohdaten (sanitized) – fuer Import in externe Systeme.
 */
router.get('/ppugv/export/csv', async (req, res, next) => {
  try {
    const { jahr } = req.query;
    const year = parseInt(jahr, 10) || new Date().getFullYear();

    const hasJahr = await hasJahrColumn();
    const yearCol = hasJahr ? 'jahr' : 'YEAR(frostungsdatum)';
    const [rows] = await db.execute(
      `SELECT stationsname, fabschluessel, fabname, monat, schicht, anzahl, betten, patienten, belegung, pflegekraefte_ist, hebammen_ist, hilfskraefte_ist, frostung
       FROM ppugv_daily_cache WHERE ${yearCol} = ? ORDER BY stationsname, ${MONTH_ORDER_SQL}, schicht`,
      [year]
    );
    const data = sanitizePpugvRows(rows);

    const csvHeader = 'Station;FAB-Schlüssel;Fachabteilung;Monat;Schicht;Schichten;Betten;Patienten;Belegung;Pflege;Hebammen;Hilfskräfte;Frostung\n';
    const csvRows = data.map(r => [
      `"${r.stationsname}"`,
      r.fabschluessel,
      `"${r.fabname}"`,
      r.monat,
      r.schicht,
      r.anzahl,
      r.betten,
      r.patienten,
      Number(r.belegung).toFixed(2).replace('.', ','),
      Number(r.pflegekraefte_ist).toFixed(2).replace('.', ','),
      Number(r.hebammen_ist).toFixed(2).replace('.', ','),
      Number(r.hilfskraefte_ist).toFixed(2).replace('.', ','),
      r.frostung,
    ].join(';')).join('\n');

    const fileName = `PPUGV_Export_${year}_${new Date().toISOString().split('T')[0]}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    // BOM fuer korrekte UTF-8 Erkennung in Excel
    res.send('\ufeff' + csvHeader + csvRows);
  } catch (error) {
    console.error('[PPUGV-CSV] error:', error.message);
    next(error);
  }
});

// ============================================================================
// ===== PPBV – Pflegepersonaluntergrenzen-Besetzung-Vergleich          ======
// ============================================================================
// Die ppbv-Datenbank ist der VOLLSTAENDIGERE Nachfolger von ppugv:
//   - Im Gegensatz zu ppugv enthaelt sie Soll-Ist-Vergleich
//   - Ausfallzeiten (Urlaub, Kranks Praxisreflexion, sonstiges)
//   - Fuehrungskraefte und Azubis separat
//   - Kategorie (Normalstation/Intensiv) und gyngeb fuer Geburtshilfe
//
// Wir cachen die export-Tabelle daily wie bei ppugv.
// ===========================================================================

let ppbvRefreshInProgress = false;
let ppbvHasJahrColumn = null;

async function hasPpbvJahrColumn() {
  if (ppbvHasJahrColumn !== null) return ppbvHasJahrColumn;
  try {
    const [cols] = await db.execute('SHOW COLUMNS FROM ppbv_daily_cache LIKE ?', ['jahr']);
    ppbvHasJahrColumn = cols.length > 0;
    if (!ppbvHasJahrColumn) {
      console.warn('[PPBV] jahr-Spalte fehlt – nutze YEAR(frostungsdatum) als Fallback.');
    }
  } catch (err) {
    console.warn('[PPBV] SHOW COLUMNS fehlgeschlagen – nutze YEAR(frostungsdatum):', err.message);
    ppbvHasJahrColumn = false;
  }
  return ppbvHasJahrColumn;
}

function sanitizePpbvRows(rows) {
  const groups = new Map();
  for (const row of rows) {
    const key = `${row.stationsname}|${row.monat}|${row.schicht}`;
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, row);
    } else if (Number(row.belegung) > Number(existing.belegung)) {
      groups.set(key, row);
    }
  }
  return Array.from(groups.values());
}

/**
 * Prueft, ob der ppbv-Cache leer ist, und startet ggf. einen
 * asynchronen Background-Refresh (fire & forget).
 */
async function ensurePpbvCacheAsync() {
  if (ppbvRefreshInProgress) return 'running';
  try {
    const [row] = await db.execute('SELECT COUNT(*) AS cnt FROM ppbv_daily_cache');
    const count = Number(row[0]?.cnt || 0);
    if (count === 0) {
      console.log('[PPBV] Cache leer – starte asynchronen Hintergrund-Refresh.');
      runPpbvRefreshInBackground().catch((err) => {
        console.error('[PPBV] Unerwarteter Fehler im Hintergrund-Refresh:', err.message);
      });
      return 'triggered';
    }
    return 'ready';
  } catch (error) {
    console.warn('[PPBV] ensurePpbvCache konnte Cache nicht prüfen:', error.message);
    return 'error';
  }
}

async function runPpbvRefreshInBackground() {
  if (ppbvRefreshInProgress) {
    console.log('[PPBV-BG] Refresh bereits in Gang – abbrechen.');
    return;
  }
  ppbvRefreshInProgress = true;
  const today = new Date().toISOString().split('T')[0];
  const startTime = Date.now();
  console.log(`[PPBV-BG] ${new Date().toISOString()} Starte Hintergrund-Refresh...`);

  try {
    await db.execute(
      `INSERT INTO ppbv_cache_meta (cache_date, refreshed_at, status, row_count)
       VALUES (?, NOW(), 'running', 0)
       ON DUPLICATE KEY UPDATE status = 'running', refreshed_at = NOW(), error_message = NULL`,
      [today]
    );

    let sourceRows = null;
    try {
      console.log(`[PPBV-BG] Versuche mysql2-Direktverbindung zu ${PPUGV_HOST}:${PPUGV_PORT} DB=${PPBV_DATABASE}...`);
      const [rows] = await ppbvReadonlyQuery(
        'SELECT stationsname, fabschluessel, fabname, kategorie, monat, schicht, anzahl, betten, teilstat, gyngeb, patienten, belegung, fachkraefte_soll, ausfall_soll_1, ausfall_soll_2, ausfall_soll_3, fuehrungskraft, ausfall_ist_1, ausfall_ist_2, ausfall_ist_3, fachkraefte_ist, hebammen_ist, hilfskraefte_ist, azubi_ist, anmerkungen, frostung, frostungsdatum FROM export ORDER BY rec_id'
      );
      sourceRows = rows;
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`[PPBV-BG] mysql2 erfolgreich nach ${elapsed}s – ${sourceRows.length} Zeilen`);
    } catch (dbErr) {
      console.warn(`[PPBV-BG] mysql2 fehlgeschlagen: ${dbErr.code || dbErr.message}`);
      await db.execute(
        "UPDATE ppbv_cache_meta SET status = 'error', error_message = ? WHERE cache_date = ?",
        [`PPBV nicht erreichbar: ${dbErr.message}. MySQL-Datenbank '${PPBV_DATABASE}' fehlt evtl. auf ${PPUGV_HOST}.`, today]
      );
      return;
    }

    if (!sourceRows || sourceRows.length === 0) {
      await db.execute(
        "UPDATE ppbv_cache_meta SET status = 'error', error_message = 'Keine Daten in der ppbv.export-Tabelle gefunden' WHERE cache_date = ?",
        [today]
      );
      return;
    }

    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      await connection.execute('DELETE FROM ppbv_daily_cache WHERE cache_date = ?', [today]);
      const insertSql = `INSERT INTO ppbv_daily_cache
        (cache_date, stationsname, fabschluessel, fabname, kategorie, monat, schicht, jahr, anzahl, betten, teilstat, gyngeb, patienten, belegung, fachkraefte_soll, ausfall_soll_1, ausfall_soll_2, ausfall_soll_3, fuehrungskraft, ausfall_ist_1, ausfall_ist_2, ausfall_ist_3, fachkraefte_ist, hebammen_ist, hilfskraefte_ist, azubi_ist, anmerkungen, frostung, frostungsdatum)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`;
      for (const row of sourceRows) {
        let jahr = 0;
        if (row.frostungsdatum) {
          const d = new Date(row.frostungsdatum);
          if (!isNaN(d.getTime())) jahr = d.getFullYear();
        }
        await connection.execute(insertSql, [
          today, String(row.stationsname || ''), parseInt(row.fabschluessel, 10) || 0, String(row.fabname || ''),
          String(row.kategorie || ''), String(row.monat || ''), String(row.schicht || ''), jahr,
          parseInt(row.anzahl, 10) || 0, parseInt(row.betten, 10) || 0, parseInt(row.teilstat, 10) || 0,
          String(row.gyngeb || 'nein'), parseInt(row.patienten, 10) || 0, parseFloat(row.belegung) || 0,
          parseFloat(row.fachkraefte_soll) || 0, parseFloat(row.ausfall_soll_1) || 0, parseFloat(row.ausfall_soll_2) || 0,
          parseFloat(row.ausfall_soll_3) || 0, parseFloat(row.fuehrungskraft) || 0,
          parseFloat(row.ausfall_ist_1) || 0, parseFloat(row.ausfall_ist_2) || 0, parseFloat(row.ausfall_ist_3) || 0,
          parseFloat(row.fachkraefte_ist) || 0, parseFloat(row.hebammen_ist) || 0,
          parseFloat(row.hilfskraefte_ist) || 0, parseFloat(row.azubi_ist) || 0,
          String(row.anmerkungen || ''), String(row.frostung || 'nein'), row.frostungsdatum,
        ]);
      }
      await connection.execute(
        'UPDATE ppbv_cache_meta SET status = ?, row_count = ?, refreshed_at = NOW() WHERE cache_date = ?',
        ['ok', sourceRows.length, today]
      );
      await connection.commit();
      const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`[PPBV-BG] Refresh erfolgreich – ${sourceRows.length} Datensaetze in ${totalTime}s`);
    } catch (txError) {
      await connection.rollback();
      throw txError;
    } finally {
      connection.release();
    }
  } catch (error) {
    console.error(`[PPBV-BG] Fehler:`, error.code || error.message);
    try {
      await db.execute(
        "UPDATE ppbv_cache_meta SET status = 'error', error_message = ? WHERE cache_date = ?",
        [(error.message || String(error)).substring(0, 500), today]
      );
    } catch (metaError) {
      console.error('[PPBV-BG] Konnte Meta-Status nicht aktualisieren:', metaError.message);
    }
  } finally {
    ppbvRefreshInProgress = false;
    console.log(`[PPBV-BG] Refresh beendet – Mutex freigegeben.`);
  }
}

/**
 * GET /api/master/ppbv
 * Liefert die gecachten PPBV-Exportdaten (mit vollstaendigem Soll/Ist-Vergleich)
 * Query: station, monat, jahr
 *
 * Verhalten bei leerem Cache: startet automatisch asynchronen Background-Refresh
 * und antwortet mit building:true (analog zu ppugv).
 */
router.get('/ppbv', async (req, res, next) => {
  try {
    const cacheStatus = await ensurePpbvCacheAsync();
    const { station, monat, jahr } = req.query;
    let sql = 'SELECT * FROM ppbv_daily_cache WHERE 1=1';
    const params = [];
    if (station) { sql += ' AND stationsname LIKE ?'; params.push(`%${station}%`); }
    if (monat) { sql += ' AND monat = ?'; params.push(monat); }
    if (jahr) {
      const yearCol = await hasPpbvJahrColumn() ? 'jahr' : 'YEAR(frostungsdatum)';
      sql += ` AND ${yearCol} = ?`;
      params.push(parseInt(jahr, 10));
    }
    sql += ` ORDER BY stationsname, ${MONTH_ORDER_SQL}, schicht`;
    const [rows] = await db.execute(sql, params);
    const sanitized = sanitizePpbvRows(rows);
    const [metaRows] = await db.execute('SELECT * FROM ppbv_cache_meta ORDER BY id DESC LIMIT 1');

    const isBuilding = cacheStatus === 'triggered' || cacheStatus === 'running';

    res.json({
      data: sanitized,
      meta: metaRows[0] || null,
      count: sanitized.length,
      cacheStatus,
      building: isBuilding,
      message: isBuilding
        ? 'PPBV-Cache wird im Hintergrund aufgebaut.'
        : sanitized.length === 0
          ? 'Keine gecachten PPBV-Daten vorhanden.'
          : null,
    });
  } catch (error) {
    console.error('[PPBV] GET error:', error.message);
    next(error);
  }
});

/**
 * POST /api/master/ppbv/refresh
 * Startet Hintergrund-Refresh der ppbv-Daten
 */
router.post('/ppbv/refresh', async (req, res, next) => {
  try {
    if (!PPUGV_HOST || !PPUGV_USER) {
      return res.status(503).json({ error: 'PPBV-Zugang nicht konfiguriert (PPUGV_HOST/USER).' });
    }
    if (ppbvRefreshInProgress) {
      return res.status(409).json({ status: 'already_running', message: 'Ein Refresh laeuft bereits.' });
    }
    runPpbvRefreshInBackground().catch((err) => console.error('[PPBV] Fehler:', err.message));
    res.status(202).json({ status: 'started', message: 'PPBV-Cache-Refresh im Hintergrund gestartet.' });
  } catch (error) {
    console.error('[PPBV] refresh error:', error.message);
    next(error);
  }
});

/**
 * GET /api/master/ppbv/meta
 * Liefert ppbv-Cache-Metadaten + Status
 */
router.get('/ppbv/meta', async (req, res, next) => {
  try {
    const [rows] = await db.execute('SELECT * FROM ppbv_cache_meta ORDER BY id DESC LIMIT 10');
    res.json({ meta: rows, refreshInProgress: ppbvRefreshInProgress });
  } catch (error) {
    console.error('[PPBV] meta error:', error.message);
    next(error);
  }
});

/**
 * GET /api/master/ppbv/export/inek
 * InEK-Excel-Export der PPBV-Daten – VOLLSTAENDIG mit allen Soll/Ist-Spalten.
 *
 * Im Gegensatz zu ppugv enthaelt dieser Export:
 *   - fachkraefte_soll, fuehrungskraft (Soll-Personalbesetzung)
 *   - ausfall_soll_1/2/3 (Urlaub/Krank/Sonst, Soll)
 *   - ausfall_ist_1/2/3 (Urlaub/Krank/Sonst, Ist)
 *   - azubi_ist (Auszubildende)
 */
router.get('/ppbv/export/inek', async (req, res, next) => {
  try {
    const { jahr } = req.query;
    const year = parseInt(jahr, 10) || new Date().getFullYear();
    const yearCol = await hasPpbvJahrColumn() ? 'jahr' : 'YEAR(frostungsdatum)';
    const [rows] = await db.execute(
      `SELECT * FROM ppbv_daily_cache WHERE ${yearCol} = ? ORDER BY stationsname, ${MONTH_ORDER_SQL}, schicht`,
      [year]
    );
    const data = sanitizePpbvRows(rows);

    const wb = new ExcelJS.Workbook();
    wb.creator = 'CuraFlow PPBV-Export';
    wb.created = new Date();
    const ws = wb.addWorksheet('InEK-Meldung (PPBV)', { views: [{ state: 'frozen', ySplit: 7 }] });

    ws.getCell('A1').value = 'Vorlage zur PPBV-Nachweismeldung – vollstaendige Version (CuraFlow-Export)';
    ws.getCell('A1').font = { bold: true, size: 14 };
    ws.mergeCells('A1:Z1');
    ws.getCell('A3').value = 'Institutionskennzeichen (IK)';
    ws.getCell('B3').value = '261300118';
    ws.getCell('A4').value = 'Jahr';
    ws.getCell('B4').value = year;
    ws.getCell('A5').value = 'Quartal';
    ws.getCell('B5').value = '1-4';
    ws.getCell('A3').font = ws.getCell('A4').font = ws.getCell('A5').font = { bold: true };

    const headerStyle = {
      font: { bold: true },
      alignment: { horizontal: 'left', wrapText: true, vertical: 'top' },
      fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD3D3D3' } },
      border: { top: { style: 'thin' }, bottom: { style: 'thin' } },
    };
    const headers = [
      'Standortkennzeichen', 'Verwendeter Name der Station',
      'Fachabteilungsschlüssel § 21 KHEntgG', 'Verwendeter Name der Fachabteilung',
      'Kategorie der Station', 'Monat', 'Schicht',
      'Anzahl Schichten im Monat', 'Anzahl Betten',
      'Anzahl teilstationäre Behandlungsplätze', 'Station im Bereich Geburtshilfe',
      'Anzahl Patienten', 'durchschnittliche Patientenbelegung',
      'Pflegefachkräfte (Soll) VZÄ § 4 Abs. 1 PPBV',
      'Ausfall (Wochenfeiertage, Urlaub) Soll § 4 Abs. 4 Nr. 2',
      'Ausfall (AU, Schutzfristen) Soll § 4 Abs. 4 Nr. 1',
      'Ausfall (sonstige) Soll § 4 Abs. 4 Nr. 3',
      'Leitende Pflegefachkräfte (Soll) § 4 Abs. 5',
      'Ausfall (Wochenfeiertage, Urlaub) Ist § 6 Abs. 7',
      'Ausfall (AU, Schutzfristen) Ist § 6 Abs. 7',
      'Ausfall (sonstige) Ist § 6 Abs. 7',
      'Pflegefachkräfte (Ist) VZÄ § 6 PPBV',
      'Hebammen (Ist) VZÄ § 6 PPBV',
      'Pflegehilfskräfte (Ist) VZÄ § 6 PPBV',
      'Auszubildende (Ist) VZÄ § 6 PPBV',
      'Anmerkung',
    ];
    headers.forEach((title, idx) => {
      const cell = ws.getCell(1 + idx, 7);
      cell.value = title;
      cell.style = headerStyle;
    });
    ws.getRow(7).height = 60;

    data.forEach((row, i) => {
      const r = i + 8;
      const values = [
        '771003000', row.stationsname, String(row.fabschluessel), row.fabname,
        row.kategorie || '', row.monat, row.schicht, row.anzahl, row.betten,
        row.teilstat || 0, row.gyngeb || 'nein', row.patienten, Number(row.belegung),
        Number(row.fachkraefte_soll) || 0, Number(row.ausfall_soll_1) || 0,
        Number(row.ausfall_soll_2) || 0, Number(row.ausfall_soll_3) || 0,
        Number(row.fuehrungskraft) || 0, Number(row.ausfall_ist_1) || 0,
        Number(row.ausfall_ist_2) || 0, Number(row.ausfall_ist_3) || 0,
        Number(row.fachkraefte_ist) || 0, Number(row.hebammen_ist) || 0,
        Number(row.hilfskraefte_ist) || 0, Number(row.azubi_ist) || 0,
        row.anmerkungen || '',
      ];
      values.forEach((v, idx) => {
        const cell = ws.getCell(idx + 1, r);
        cell.value = v;
        cell.alignment = { horizontal: 'left' };
      });
    });

    const colWidths = [25, 50, 50, 50, 30, 10, 20, 10, 10, 10, 10, 10, 15, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 30];
    colWidths.forEach((w, i) => ws.getColumn(i + 1).width = w);

    const fileName = `PPBV_InEK_${year}_${new Date().toISOString().split('T')[0]}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    const buffer = await wb.xlsx.writeBuffer();
    res.send(Buffer.from(buffer));
    console.log(`[PPBV-EXPORT] InEK-Excel exportiert: ${data.length} Zeilen, Jahr ${year}`);
  } catch (error) {
    console.error('[PPBV-EXPORT] error:', error.message);
    next(error);
  }
});

// ===== Stammdaten-Import (from external personnel master database) =====

/**
 * GET /api/master/employees/stammdat/analyze
 * Analyze the stammdat source DB and return categorized matching results.
 * No data is written — this is a dry-run for review.
 */
router.get('/employees/stammdat/analyze', async (req, res, next) => {
  try {
    const results = await analyzeStammdatImport(db, getStammdatConfig());
    res.json(results);
  } catch (error) {
    console.error('[Master stammdat] Analyze error:', error);
    next(error);
  }
});

/**
 * POST /api/master/employees/stammdat/import
 * Execute the stammdat import with user decisions.
 * Body: { decisions: [{ stammdat_id, action: 'apply'|'skip', existing_employee_id? }] }
 *
 * - action 'apply' with existing_employee_id → update that specific employee
 * - action 'apply' without existing_employee_id → auto-match or create
 * - action 'skip' → skip this employee
 */
router.post('/employees/stammdat/import', async (req, res, next) => {
  try {
    const { decisions, dryRun } = req.body;

    if (!decisions || !Array.isArray(decisions) || decisions.length === 0) {
      return res.status(400).json({ error: 'decisions array is required' });
    }

    const dryRunEnabled = dryRun === true || dryRun === 'true';

    const result = await executeStammdatImport(
      db, decisions, req.user.sub, getStammdatConfig(),
      { dryRun: dryRunEnabled }
    );

    if (dryRunEnabled) {
      console.log(
        `[Master stammdat] Dry-run complete: ${result.created} would-create, ${result.updated} would-update, ` +
        `${result.skipped} skipped (by user ${req.user.email})`
      );
    } else {
      console.log(
        `[Master stammdat] Import complete: ${result.created} created, ${result.updated} updated, ` +
        `${result.skipped} skipped, ${result.errors.length} errors (by user ${req.user.email})`
      );
    }

    res.json(result);
  } catch (error) {
    console.error('[Master stammdat] Import error:', error);
    next(error);
  }
});

/**
 * POST /api/master/employees/stammdat/link
 * Manually link an existing CuraFlow Employee to a stammdat source entry.
 * Body: { employee_id: string, stammdat_id: number }
 * Updates the Employee with stammdat fields (position, email, cost-center, etc.)
 */
router.post('/employees/stammdat/link', async (req, res, next) => {
  try {
    const { employee_id, stammdat_id } = req.body;

    if (!employee_id || !stammdat_id) {
      return res.status(400).json({ error: 'employee_id and stammdat_id are required' });
    }

    const result = await linkStammdatToEmployee(
      db, employee_id, stammdat_id, req.user.sub, getStammdatConfig()
    );

    res.json(result);
  } catch (error) {
    console.error('[Master stammdat] Link error:', error);
    next(error);
  }
});

export default router;
