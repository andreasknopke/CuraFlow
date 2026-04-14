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
import { createPool } from 'mysql2/promise';
import { db } from '../db/pool.js';
import { authMiddleware, adminMiddleware } from './auth.js';
import { parseDbToken } from '../utils/crypto.js';
import { format, startOfMonth, endOfMonth, getDaysInMonth } from 'date-fns';
import { getPublicHolidayDatesForYear } from './holidays.js';
import config from '../config.js';
import {
  ensureDbTokensTable,
  filterTokensByTenantAccess,
  getUserTenantAccess,
} from '../utils/tenantAccess.js';

const router = express.Router();
router.use(authMiddleware);
router.use(adminMiddleware);

// ============ HELPERS ============

/**
 * Get all configured tenant database tokens from master DB
 */
async function getAllTenantTokens(adminUserId) {
  try {
    await ensureDbTokensTable(db);

    const { found, access } = await getUserTenantAccess(db, adminUserId);
    if (!found || !access.isValid) {
      return [];
    }

    const [rows] = await db.execute('SELECT * FROM db_tokens ORDER BY name ASC');
    return filterTokensByTenantAccess(rows, access);
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
      console.warn(
        `[Master API] Invalid token config for tenant "${token.name}" – host: ${config?.host}, db: ${config?.database}`,
      );
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
      try {
        await pool.end();
      } catch (e) {
        /* ignore */
      }
    }
  }
}

/**
 * Execute a query across all (or specific) tenants, merge results
 */
async function queryAllTenants(adminUserId, tenantId, queryFn) {
  const tokens = await getAllTenantTokens(adminUserId);
  const targetTokens = tenantId ? tokens.filter((t) => t.id === tenantId) : tokens;

  console.log(
    `[Master API] queryAllTenants: ${targetTokens.length} tenant(s) to query${tenantId ? ` (filtered to ${tenantId})` : ' (all)'}`,
  );

  // Run all tenant queries in parallel for better performance
  const promises = targetTokens.map(async (token) => {
    try {
      const data = await withTenantDb(token, queryFn);
      if (data && data.length > 0) {
        console.log(`[Master API] Tenant "${token.name}": ${data.length} result(s)`);
      } else {
        console.log(
          `[Master API] Tenant "${token.name}": 0 results (data=${data === null ? 'null' : '[]'})`,
        );
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
               WHERE TABLE_NAME = 'Doctor' AND COLUMN_NAME = 'is_active' AND TABLE_SCHEMA = DATABASE()`,
            );
            staffQuery =
              testCols.length > 0
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
            [today],
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

    const staff = await queryAllTenants(req.user.sub, tenantId, async (pool, token) => {
      try {
        // Discover available columns to handle schema differences across tenants
        const [cols] = await pool.execute(
          `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'Doctor' AND TABLE_SCHEMA = DATABASE()`,
        );
        const colNames = new Set(cols.map((c) => c.COLUMN_NAME));

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
          `SELECT ${selectCols.join(', ')} FROM Doctor ORDER BY name`,
        );
        console.log(
          `[Master staff] Tenant "${token.name}": found ${rows.length} doctor(s) (cols: ${selectCols.join(',')})`,
        );
        return rows.map((r) => ({
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
        const [rows] = await pool.execute('SELECT * FROM Doctor WHERE id = ?', [employeeId]);
        if (rows.length === 0) {
          console.log(
            `[Master staff-detail] Tenant "${token.name}": doctor ${employeeId} not found`,
          );
          return [];
        }

        const doc = rows[0];

        // Public holidays for workday filtering (includes manual corrections from master DB)
        const currentYear = new Date().getFullYear();
        const publicHolidayDates = await getPublicHolidayDatesForYear(currentYear);

        // Absences for current year
        const absencePositions = [
          'Urlaub',
          'Krank',
          'Frei',
          'Dienstreise',
          'Nicht verfügbar',
          'Fortbildung',
          'Kongress',
          'Elternzeit',
          'Mutterschutz',
        ];
        const placeholders = absencePositions.map(() => '?').join(',');
        let absences = [];
        try {
          const [absRows] = await pool.execute(
            `SELECT date, position, note FROM ShiftEntry 
             WHERE doctor_id = ? AND YEAR(date) = ? AND position IN (${placeholders})
             ORDER BY date`,
            [employeeId, currentYear, ...absencePositions],
          );
          // Group consecutive days into ranges
          absences = absRows.map((r) => ({
            type: r.position,
            from:
              typeof r.date === 'string' ? r.date.substring(0, 10) : format(r.date, 'yyyy-MM-dd'),
            to: typeof r.date === 'string' ? r.date.substring(0, 10) : format(r.date, 'yyyy-MM-dd'),
            days: 1,
            note: r.note || null,
          }));
        } catch (e) {
          console.warn(`[Master staff-detail] Absences query failed:`, e.message);
        }

        // Vacation counts: only count workdays (Mon-Fri, no public holidays)
        const today = format(new Date(), 'yyyy-MM-dd');
        const vacationDays = absences.filter((a) => {
          if (a.type !== 'Urlaub') return false;
          const d = new Date(a.from + 'T12:00:00');
          const dayOfWeek = d.getDay(); // 0=Sun, 6=Sat
          if (dayOfWeek === 0 || dayOfWeek === 6) return false;
          // Check if this date is a public holiday
          if (publicHolidayDates && publicHolidayDates.has(a.from)) return false;
          return true;
        });
        const vacationTaken = vacationDays.filter((a) => a.from <= today).length;
        const vacationPlanned = vacationDays.filter((a) => a.from > today).length;

        return [
          {
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
          },
        ];
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
 * GET /api/master/absences?year=2026&month=02&tenantId=xxx
 * Absences across all tenants for a given month
 */
router.get('/absences', async (req, res, next) => {
  try {
    const { year, month, tenantId } = req.query;
    const y = parseInt(year) || new Date().getFullYear();
    const m = parseInt(month) || new Date().getMonth() + 1;
    const startDate = `${y}-${String(m).padStart(2, '0')}-01`;
    const daysInMonth = getDaysInMonth(new Date(y, m - 1));
    const endDate = `${y}-${String(m).padStart(2, '0')}-${String(daysInMonth).padStart(2, '0')}`;

    const absenceTypes = [
      'Urlaub',
      'Krank',
      'Frei',
      'Dienstreise',
      'Nicht verfügbar',
      'Fortbildung',
      'Kongress',
    ];

    const entries = await queryAllTenants(req.user.sub, tenantId, async (pool, token) => {
      try {
        const placeholders = absenceTypes.map(() => '?').join(',');
        const [rows] = await pool.execute(
          `SELECT se.date, se.position, se.note, d.name as doctor_name
           FROM ShiftEntry se
           JOIN Doctor d ON se.doctor_id = d.id
           WHERE se.date >= ? AND se.date <= ? AND se.position IN (${placeholders})
           ORDER BY se.date, d.name`,
          [startDate, endDate, ...absenceTypes],
        );
        return rows.map((r) => ({
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
    absenceTypes.forEach((t) => {
      summary[t] = 0;
    });
    entries.forEach((e) => {
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
    const m = parseInt(month) || new Date().getMonth() + 1;
    const startDate = `${y}-${String(m).padStart(2, '0')}-01`;
    const daysInMonth = getDaysInMonth(new Date(y, m - 1));
    const endDate = `${y}-${String(m).padStart(2, '0')}-${String(daysInMonth).padStart(2, '0')}`;

    const absencePositions = [
      'Frei',
      'Urlaub',
      'Krank',
      'Fortbildung',
      'Kongress',
      'Dienstreise',
      'Nicht verfügbar',
    ];

    const entries = await queryAllTenants(req.user.sub, tenantId, async (pool, token) => {
      try {
        // Get all active doctors
        const [doctors] = await pool.execute(
          'SELECT id, name, role FROM Doctor WHERE is_active = 1 ORDER BY name',
        );

        // Get shifts for month
        const [shifts] = await pool.execute(
          'SELECT doctor_id, date, position, start_time, end_time, timeslot_id FROM ShiftEntry WHERE date >= ? AND date <= ?',
          [startDate, endDate],
        );

        // Get timeslots (may not exist)
        let timeslots = [];
        try {
          const [ts] = await pool.execute('SELECT id, start_time, end_time FROM WorkplaceTimeslot');
          timeslots = ts;
        } catch {
          /* table may not exist */
        }

        // Get workplaces for work_time_percentage
        let workplaces = [];
        try {
          const [wp] = await pool.execute('SELECT name, work_time_percentage FROM Workplace');
          workplaces = wp;
        } catch {
          /* ignore */
        }

        // Calculate per doctor
        return doctors.map((doc) => {
          const docShifts = shifts.filter((s) => s.doctor_id === doc.id);
          const shiftsByDate = {};
          docShifts.forEach((s) => {
            const d =
              typeof s.date === 'string' ? s.date.substring(0, 10) : format(s.date, 'yyyy-MM-dd');
            if (!shiftsByDate[d]) shiftsByDate[d] = [];
            shiftsByDate[d].push(s);
          });

          let totalMinutes = 0;
          let workDays = 0;

          Object.entries(shiftsByDate).forEach(([date, dayShifts]) => {
            // Skip if only absences
            const workShifts = dayShifts.filter((s) => !absencePositions.includes(s.position));
            if (workShifts.length === 0) return;

            workDays++;
            let dayMinutes = 0;

            workShifts.forEach((shift) => {
              const wp = workplaces.find((w) => w.name === shift.position);
              const pct = (wp?.work_time_percentage ?? 100) / 100;

              if (shift.timeslot_id) {
                const ts = timeslots.find((t) => t.id === shift.timeslot_id);
                if (ts && ts.start_time && ts.end_time) {
                  const start = timeToMin(ts.start_time);
                  let end = timeToMin(ts.end_time);
                  if (end <= start) end += 24 * 60;
                  dayMinutes += (end - start) * pct;
                  return;
                }
              }
              // Default 8h
              dayMinutes += 480 * pct;
            });

            totalMinutes += dayMinutes;
          });

          // Soll: 8h * working days in month (simple approximation)
          // TODO: Use target_hours_per_week from doctor when available
          const targetHours = (((daysInMonth * 5) / 7) * 8).toFixed(1); // ~workdays * 8h

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
  BW: 'Baden-Württemberg',
  BY: 'Bayern',
  BE: 'Berlin',
  BB: 'Brandenburg',
  HB: 'Bremen',
  HH: 'Hamburg',
  HE: 'Hessen',
  MV: 'Mecklenburg-Vorpommern',
  NI: 'Niedersachsen',
  NW: 'Nordrhein-Westfalen',
  RP: 'Rheinland-Pfalz',
  SL: 'Saarland',
  SN: 'Sachsen',
  ST: 'Sachsen-Anhalt',
  SH: 'Schleswig-Holstein',
  TH: 'Thüringen',
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
  await db.execute(
    `INSERT IGNORE INTO holiday_settings (\`key\`, \`value\`) VALUES ('federal_state', 'MV')`,
  );
  await db.execute(
    `INSERT IGNORE INTO holiday_settings (\`key\`, \`value\`) VALUES ('show_school_holidays', 'true')`,
  );

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
    rows.forEach((r) => {
      settings[r.key] = r.value;
    });
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
      [key, String(value)],
    );
    console.log(`[Master holidays] Setting updated: ${key} = ${value} by user ${req.user.sub}`);
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
      [id, name, start_date, end_date || null, type, action, req.user.sub],
    );

    console.log(
      `[Master holidays] Custom holiday created: ${name} (${type}/${action}) by user ${req.user.sub}`,
    );
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
    const response = await fetch(
      `http://localhost:${config.server.port}/api/holidays?year=${year}`,
    );
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
    let sql = `SELECT e.*, wtm.name as work_time_model_name, wtm.hours_per_week as model_hours_per_week
               FROM Employee e
               LEFT JOIN WorkTimeModel wtm ON e.work_time_model_id = wtm.id`;
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
       LEFT JOIN db_tokens dt ON eta.tenant_id COLLATE utf8mb4_general_ci = dt.id`,
    );

    const employees = rows.map((emp) => ({
      ...emp,
      is_active: !!emp.is_active,
      assignments: assignments
        .filter((a) => a.employee_id === emp.id)
        .map((a) => ({
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
 * GET /api/master/employees/:id
 * Single employee detail with assignments and time accounts
 */
router.get('/employees/:id', async (req, res, next) => {
  try {
    const { id } = req.params;

    const [rows] = await db.execute(
      `SELECT e.*, wtm.name as work_time_model_name, wtm.hours_per_week as model_hours_per_week
       FROM Employee e
       LEFT JOIN WorkTimeModel wtm ON e.work_time_model_id = wtm.id
       WHERE e.id = ?`,
      [id],
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
      [id],
    );

    // Time accounts
    const [timeAccounts] = await db.execute(
      `SELECT * FROM TimeAccount WHERE employee_id = ? ORDER BY year DESC, month DESC LIMIT 24`,
      [id],
    );

    res.json({
      ...emp,
      is_active: !!emp.is_active,
      assignments: assignments.map((a) => ({
        id: a.id,
        tenant_id: a.tenant_id,
        tenant_name: a.tenant_name,
        tenant_doctor_id: a.tenant_doctor_id,
        fte_share: a.fte_share,
        is_primary: !!a.is_primary,
        assigned_since: a.assigned_since,
      })),
      time_accounts: timeAccounts,
    });
  } catch (error) {
    console.error('[Master employees] Detail error:', error);
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
      last_name,
      first_name,
      former_name,
      date_of_birth,
      email,
      phone,
      address,
      contract_type,
      contract_start,
      contract_end,
      probation_end,
      target_hours_per_week,
      vacation_days_annual,
      payroll_id,
      work_time_model_id,
      notes,
    } = req.body;

    if (!last_name || !last_name.trim()) {
      return res.status(400).json({ error: 'Nachname ist erforderlich' });
    }

    const id = crypto.randomUUID();
    await db.execute(
      `INSERT INTO Employee (id, last_name, first_name, former_name, date_of_birth, email, phone, address,
        contract_type, contract_start, contract_end, probation_end,
        target_hours_per_week, vacation_days_annual, payroll_id, work_time_model_id, notes, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      ],
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
      'last_name',
      'first_name',
      'former_name',
      'date_of_birth',
      'email',
      'phone',
      'address',
      'contract_type',
      'contract_start',
      'contract_end',
      'probation_end',
      'target_hours_per_week',
      'vacation_days_annual',
      'payroll_id',
      'work_time_model_id',
      'is_active',
      'exit_date',
      'exit_reason',
      'notes',
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
        if (
          [
            'date_of_birth',
            'contract_start',
            'contract_end',
            'probation_end',
            'exit_date',
          ].includes(field) &&
          val === ''
        ) {
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

    console.log(
      `[Master employees] Updated employee ${id} (fields: ${updates.map((u) => u.split(' =')[0]).join(', ')}) by user ${req.user.sub}`,
    );
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
      [id],
    );

    // Upsert: for each assignment, insert or update
    for (const a of assignments) {
      if (!a.tenant_id) continue;

      const existing = currentAssignments.find((ca) => ca.tenant_id === a.tenant_id);
      if (existing) {
        await db.execute(
          `UPDATE EmployeeTenantAssignment SET fte_share = ?, is_primary = ?, tenant_doctor_id = ? WHERE id = ?`,
          [a.fte_share ?? 1.0, !!a.is_primary, a.tenant_doctor_id || null, existing.id],
        );
      } else {
        const aId = crypto.randomUUID();
        await db.execute(
          `INSERT INTO EmployeeTenantAssignment (id, employee_id, tenant_id, tenant_doctor_id, fte_share, is_primary, assigned_since) 
           VALUES (?, ?, ?, ?, ?, ?, CURDATE())`,
          [aId, id, a.tenant_id, a.tenant_doctor_id || null, a.fte_share ?? 1.0, !!a.is_primary],
        );
      }
    }

    // Remove assignments not in the new list
    const newTenantIds = assignments.map((a) => a.tenant_id).filter(Boolean);
    for (const ca of currentAssignments) {
      if (!newTenantIds.includes(ca.tenant_id)) {
        await db.execute('DELETE FROM EmployeeTenantAssignment WHERE id = ?', [ca.id]);
      }
    }

    console.log(
      `[Master employees] Updated assignments for employee ${id} by user ${req.user.sub}`,
    );
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
    const [empRows] = await db.execute(
      'SELECT id, is_active, last_name, first_name FROM Employee WHERE id = ?',
      [id],
    );
    if (empRows.length === 0) {
      return res.status(404).json({ error: 'Mitarbeiter nicht gefunden' });
    }
    if (empRows[0].is_active) {
      return res.status(400).json({
        error: 'Nur deaktivierte Mitarbeiter können gelöscht werden. Bitte zuerst deaktivieren.',
      });
    }

    // Get assignments to clean up tenant-side references
    const [assignments] = await db.execute(
      'SELECT eta.tenant_id, eta.tenant_doctor_id FROM EmployeeTenantAssignment eta WHERE eta.employee_id = ?',
      [id],
    );

    // Clean up central_employee_id in tenant Doctor tables
    const tokens = await getAllTenantTokens(req.user.sub);
    const tokenMap = new Map(tokens.map((t) => [String(t.id), t]));
    for (const assign of assignments) {
      const token = tokenMap.get(String(assign.tenant_id));
      if (token && assign.tenant_doctor_id) {
        try {
          await withTenantDb(token, async (pool) => {
            await pool.execute('UPDATE Doctor SET central_employee_id = NULL WHERE id = ?', [
              assign.tenant_doctor_id,
            ]);
          });
        } catch (err) {
          console.warn(
            `[Master employees] Could not unlink tenant doctor ${assign.tenant_doctor_id}: ${err.message}`,
          );
        }
      }
    }

    // Delete assignments
    await db.execute('DELETE FROM EmployeeTenantAssignment WHERE employee_id = ?', [id]);

    // Delete time accounts
    await db.execute('DELETE FROM TimeAccount WHERE employee_id = ?', [id]);

    // Delete employee
    await db.execute('DELETE FROM Employee WHERE id = ?', [id]);

    const name = [empRows[0].first_name, empRows[0].last_name].filter(Boolean).join(' ');
    console.log(
      `[Master employees] Permanently deleted employee ${id} (${name}) by ${req.user.email}`,
    );
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
    const tokenMap = new Map(tokens.map((t) => [String(t.id), t]));

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
          [tenant_id, doctor_id],
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
          [empId, last_name, first_name, req.user.sub],
        );

        // Set central_employee_id on tenant Doctor
        await withTenantDb(token, async (pool) => {
          await pool.execute('UPDATE Doctor SET central_employee_id = ? WHERE id = ?', [
            empId,
            doctor_id,
          ]);
        });

        // Create EmployeeTenantAssignment
        await db.execute(
          `INSERT INTO EmployeeTenantAssignment (id, employee_id, tenant_id, tenant_doctor_id, fte_share, is_primary, assigned_since)
           VALUES (?, ?, ?, ?, 1.00, TRUE, CURDATE())`,
          [crypto.randomUUID(), empId, tenant_id, doctor_id],
        );

        results.push({ doctor_id, name, employee_id: empId, status: 'success' });
      } catch (err) {
        console.error(`[Master import] Error for doctor ${doctor_id}:`, err.message);
        results.push({ doctor_id, name, status: 'error', error: err.message });
      }
    }

    const successCount = results.filter((r) => r.status === 'success').length;
    console.log(
      `[Master import] Imported ${successCount}/${items.length} employees by ${req.user.email}`,
    );
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
    const token = tokens.find((t) => t.id === tenant_id);
    if (!token) {
      return res.status(403).json({ error: 'Kein Zugriff auf diesen Mandanten' });
    }

    // Update Doctor in tenant DB to set central_employee_id
    await withTenantDb(token, async (pool) => {
      // First check if doctor has central_employee_id column
      const [cols] = await pool.execute(
        `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS 
         WHERE TABLE_NAME = 'Doctor' AND COLUMN_NAME = 'central_employee_id' AND TABLE_SCHEMA = DATABASE()`,
      );
      if (cols.length === 0) {
        throw new Error(
          'Tenant hat noch keine Migrationen für zentrale Mitarbeiterverwaltung. Bitte zuerst Migrationen ausführen.',
        );
      }

      await pool.execute('UPDATE Doctor SET central_employee_id = ? WHERE id = ?', [id, doctor_id]);
    });

    // Upsert EmployeeTenantAssignment
    const [existingAssign] = await db.execute(
      'SELECT id FROM EmployeeTenantAssignment WHERE employee_id = ? AND tenant_id = ?',
      [id, tenant_id],
    );
    if (existingAssign.length > 0) {
      await db.execute('UPDATE EmployeeTenantAssignment SET tenant_doctor_id = ? WHERE id = ?', [
        doctor_id,
        existingAssign[0].id,
      ]);
    } else {
      await db.execute(
        `INSERT INTO EmployeeTenantAssignment (id, employee_id, tenant_id, tenant_doctor_id, fte_share, is_primary, assigned_since)
         VALUES (?, ?, ?, ?, 1.00, FALSE, CURDATE())`,
        [crypto.randomUUID(), id, tenant_id, doctor_id],
      );
    }

    console.log(
      `[Master employees] Linked employee ${id} to tenant ${tenant_id} doctor ${doctor_id} by user ${req.user.sub}`,
    );
    res.json({ success: true });
  } catch (error) {
    console.error('[Master employees] Link error:', error);
    next(error);
  }
});

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
      return res
        .status(400)
        .json({ error: 'name, hours_per_week, and hours_per_day are required' });
    }

    const id = crypto.randomUUID();
    await db.execute(
      `INSERT INTO WorkTimeModel (id, name, hours_per_week, hours_per_day, is_default, description)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [id, name.trim(), hours_per_week, hours_per_day, !!is_default, description?.trim() || null],
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
      [name?.trim(), hours_per_week, hours_per_day, !!is_default, description?.trim() || null, id],
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
      [id],
    );
    if (usages[0].cnt > 0) {
      return res.status(409).json({
        error: `Dieses Modell wird noch von ${usages[0].cnt} Mitarbeiter(n) verwendet und kann nicht gelöscht werden.`,
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
    const token = tokens.find((t) => t.id === tenantId);
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
    const modelMap = Object.fromEntries(models.map((m) => [m.id, m.name]));

    const enriched = (rules || []).map((r) => ({
      ...r,
      work_time_model_name: modelMap[r.work_time_model_id] || r.work_time_model_id,
    }));

    res.json({ rules: enriched });
  } catch (error) {
    console.error('[Master shift-time-rules] List error:', error);
    next(error);
  }
});

export default router;
