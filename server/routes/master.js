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
import { createPool } from 'mysql2/promise';
import { db } from '../index.js';
import { authMiddleware, adminMiddleware } from './auth.js';
import { parseDbToken } from '../utils/crypto.js';
import { format, startOfMonth, endOfMonth, getDaysInMonth } from 'date-fns';

const router = express.Router();
router.use(authMiddleware);
router.use(adminMiddleware);

// ============ HELPERS ============

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
          // Count active staff
          const [staffRows] = await pool.execute(
            'SELECT COUNT(*) as cnt FROM Doctor WHERE is_active = 1'
          );
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

    const staff = await queryAllTenants(req.user.sub, tenantId, async (pool, token) => {
      try {
        const [rows] = await pool.execute(
          'SELECT id, name, role, is_active, qualifications, notes FROM Doctor ORDER BY name'
        );
        console.log(`[Master staff] Tenant "${token.name}": found ${rows.length} doctor(s)`);
        return rows.map(r => ({
          ...r,
          is_active: !!r.is_active,
          tenantId: token.id,
          tenantName: token.name,
          qualifications: r.qualifications || null,
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
        // Basic doctor info
        const [rows] = await pool.execute(
          'SELECT * FROM Doctor WHERE id = ?',
          [employeeId]
        );
        if (rows.length === 0) return [];

        const doc = rows[0];

        // Absences for current year
        const currentYear = new Date().getFullYear();
        const absencePositions = ['Urlaub', 'Krank', 'Frei', 'Dienstreise', 'Nicht verfügbar', 'Fortbildung', 'Kongress', 'Elternzeit', 'Mutterschutz'];
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

        // Vacation counts
        const vacationDays = absences.filter(a => a.type === 'Urlaub');
        const vacationTaken = vacationDays.length;

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
          vacation_days_total: doc.vacation_days || 30,
          vacation_days_taken: vacationTaken,
          vacation_days_planned: 0,
          remaining_vacation: (doc.vacation_days || 30) - vacationTaken,
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

    const absencePositions = ['Frei', 'Urlaub', 'Krank', 'Fortbildung', 'Kongress', 'Dienstreise', 'Nicht verfügbar'];

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

        // Get workplaces for work_time_percentage
        let workplaces = [];
        try {
          const [wp] = await pool.execute('SELECT name, work_time_percentage FROM Workplace');
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

          Object.entries(shiftsByDate).forEach(([date, dayShifts]) => {
            // Skip if only absences
            const workShifts = dayShifts.filter(s => !absencePositions.includes(s.position));
            if (workShifts.length === 0) return;

            workDays++;
            let dayMinutes = 0;

            workShifts.forEach(shift => {
              const wp = workplaces.find(w => w.name === shift.position);
              const pct = (wp?.work_time_percentage ?? 100) / 100;

              if (shift.timeslot_id) {
                const ts = timeslots.find(t => t.id === shift.timeslot_id);
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

export default router;
