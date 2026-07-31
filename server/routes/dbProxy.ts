import express from 'express';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import type { Request, Response, NextFunction } from 'express';

interface CuraDbError extends Error {
  code?: string;
  errno?: number;
  sqlState?: string;
  sqlMessage?: string;
  status?: number;
  conflictPayload?: Record<string, unknown>;
  body?: Record<string, unknown>;
}

interface CuraRequest extends Request {
  db: Pool;
  dbToken?: string;
  isCustomDb?: boolean;
  user?: {
    sub?: string;
    email?: string;
    role?: string;
    permissions?: Record<string, boolean>;
    [key: string]: unknown;
  };
}

import type { Kysely } from 'kysely';
import { db, removeTenantPool } from '../index.js';
import { authMiddleware } from './auth.js';
import { checkAdminPermission, PermissionKey } from '../utils/permissions.js';
import crypto from 'crypto';
import { broadcastPlanUpdate, buildRealtimeScope, isPlanSyncEntity } from '../utils/realtime.js';
import { COLUMNS_CACHE, clearColumnsCache, ensureColumns, assertValidIdentifier } from '../utils/schema.js';
import { ensureTenantBaseTables } from '../scripts/seed-runtime-shared.js';
import {
  isCentralAbsencePosition,
  writeShiftEntryToCentralAbsence,
} from '../utils/centralAbsences.js';
import { resolveTenantIdFromToken } from '../utils/tenantGroups.js';
import { createKysely } from '../utils/db.js';
import { sql } from 'kysely';
import { fromSqlRow } from '../utils/sqlMarshal.js';
import { insertRow, updateRow, deleteRow, selectRow, filterRows, bulkInsert } from '../utils/queryHelpers.js';
import {
  createQualification,
  updateQualification,
  deleteQualification,
  getQualification,
  listQualifications,
} from '../repos/qualificationRepo.js';
import {
  createWishRequest,
  updateWishRequest,
  deleteWishRequest,
  getWishRequest,
  listWishRequests,
} from '../repos/wishRequestRepo.js';
import {
  createDoctor,
  updateDoctor,
  deleteDoctor,
  getDoctor,
  listDoctors,
} from '../repos/doctorRepo.js';
import {
  createShiftEntry,
  updateShiftEntry,
  deleteShiftEntry,
  getShiftEntry,
  listShiftEntries,
  DbRow,
} from '../repos/shiftEntryRepo.js';

// Kategorien, die vom Default-Timeslot-Mechanismus ausgenommen sind
const EXCLUDED_DEFAULT_TIMESLOT_CATEGORIES = new Set(['Dienste', 'Demonstrationen & Konsile']);

/**
 * Stellt nach der Erstellung eines Workplace sicher, dass ein Default-Timeslot
 * (07:00–15:30) existiert, sofern die Kategorie nicht ausgeschlossen ist.
 * Idempotent: Überspringt, wenn bereits ein Timeslot existiert.
 */
async function ensureDefaultTimeslotAfterWorkplaceCreate(dbPool: any, workplaceData: any) {
  if (!workplaceData?.category || EXCLUDED_DEFAULT_TIMESLOT_CATEGORIES.has(workplaceData.category)) {
    return;
  }

  // Prüfen, ob bereits ein Timeslot existiert
  const [existingSlots] = await dbPool.execute(
    `SELECT COUNT(*) AS cnt FROM WorkplaceTimeslot WHERE workplace_id = ?`,
    [workplaceData.id]
  ) as unknown as [RowDataPacket[], RowDataPacket[]];

  if (existingSlots[0]?.cnt > 0) {
    return; // Bereits vorhanden → nichts tun
  }

  // Default-Timeslot anlegen
  const slotId = crypto.randomUUID();
  await dbPool.execute(
    `INSERT INTO WorkplaceTimeslot (id, workplace_id, label, start_time, end_time, \`order\`, overlap_tolerance_minutes, created_date, created_by)
     VALUES (?, ?, 'Standard', '07:00:00', '15:30:00', 0, 30, NOW(), ?)`,
    [slotId, workplaceData.id, workplaceData.created_by || 'system']
  );

  // timeslots_enabled = TRUE setzen (falls Spalte existiert)
  try {
    const [wpColumns] = await dbPool.execute(
      `SHOW COLUMNS FROM Workplace LIKE 'timeslots_enabled'`
    ) as unknown as [RowDataPacket[], RowDataPacket[]];
    if (wpColumns.length > 0) {
      await dbPool.execute(
        `UPDATE Workplace SET timeslots_enabled = TRUE WHERE id = ? AND (timeslots_enabled IS NULL OR timeslots_enabled = FALSE)`,
        [workplaceData.id]
      );
    }
  } catch {
    // Spalte existiert nicht → ignorieren
  }
}

const router = express.Router();

// Tables that can be read without authentication
const PUBLIC_READ_TABLES = [
  'SystemSetting',
  'ColorSetting',
  'Workplace',
  'DemoSetting',
  'TeamRole',
  'Qualification',
  'DoctorQualification',
  'WorkplaceQualification'
];

const TENANT_BASE_TABLES = [
  'Doctor',
  'Workplace',
  'ShiftEntry',
  'WishRequest',
  'TrainingRotation',
  'ScheduleRule',
  'ColorSetting',
  'ScheduleNote',
  'SystemSetting',
  'CustomHoliday',
  'StaffingPlanEntry',
  'StaffingPlanNote',
  'ShiftNotification',
  'DemoSetting',
  'BackupLog',
  'SystemLog',
  'VoiceAlias',
  'TeamRole',
  'Qualification',
  'DoctorQualification',
  'WorkplaceQualification',
  'ScheduleBlock',
];
const TENANT_BASE_TABLE_SET = new Set(TENANT_BASE_TABLES);

export { clearColumnsCache, approvalWriteRequiresPermission };


// HELPER: Get valid columns for entity (multi-tenant aware).
//
// Routed through Kysely (Phase 1, PR 1.0) so the table identifier is escaped
// centrally via sql.id() instead of hand-interpolated into a backtick string.
// This is the structural fix for the S1 injection class: a backtick in
// tableName can no longer break out of the identifier context. The generated
// SQL is identical to the previous `SHOW COLUMNS FROM \`{tableName}\`` — only
// the escaping path changed, so behavior (cache, error handling, return shape)
// is preserved.
//
// assertValidIdentifier(tableName) at the route entry (dbProxy.js ~786)
// remains as defence-in-depth; Kysely is now the primary control.
const getValidColumns = async (dbPool: any, tableName: any, cacheKey: any) => {
  const fullCacheKey = `${cacheKey}:${tableName}`;
  if (COLUMNS_CACHE[fullCacheKey]) return COLUMNS_CACHE[fullCacheKey];

  try {
    const kysely = createKysely(dbPool);
    const { rows } = await sql`SHOW COLUMNS FROM ${sql.id(tableName)}`.execute(kysely);
    const columns = rows.map((r: any) => r.Field ?? r.field ?? r.COLUMN_NAME);
    COLUMNS_CACHE[fullCacheKey] = columns;
    return columns;
  } catch (e) {
    console.error(`Failed to fetch columns for ${tableName}:`, (e as Error).message);
    if ((e as Error).message.includes("doesn't exist") || (e as CuraDbError).code === 'ER_NO_SUCH_TABLE') {
      return [];
    }
    return null;
  }
};

interface WpCacheEntry {
  data: DbRow | null;
  ts: number;
}

// Cache for Workplace allows_multiple lookups (per tenant, refreshed periodically)
const WORKPLACE_CACHE: Record<string, WpCacheEntry> = {};
const WORKPLACE_CACHE_TTL = 60_000; // 1 minute

/**
 * ShiftEntry Sentinel: Check if a position on a date already has an entry
 * when the Workplace does NOT allow multiple assignments.
 * Uses a single SELECT query — negligible performance impact.
 * 
 * @returns {object|null} The conflicting shift row, or null if no conflict
 */
const checkShiftConflict = async (dbPool: any, shiftData: any, cacheKey = 'default') => {
  const { date, position, timeslot_id } = shiftData;
  if (!date || !position) return null;

  // Look up workplace config (cached per minute)
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
      ) as unknown as [RowDataPacket[], RowDataPacket[]];
      const wp = rows[0] || null;
      WORKPLACE_CACHE[wpCacheKey] = { data: wp, ts: Date.now() };
      wpEntry = WORKPLACE_CACHE[wpCacheKey];
    } catch (e) {
      // If Workplace table doesn't exist or query fails, skip sentinel
      console.warn('[Sentinel] Workplace lookup failed:', (e as Error).message);
      return null;
    }
  }

  const wp = wpEntry.data;
  if (!wp) return null; // Unknown position → allow

  // Determine allows_multiple (same logic as client-side)
  let allowsMultiple;
  if (wp.allows_multiple !== undefined && wp.allows_multiple !== null) {
    allowsMultiple = !!wp.allows_multiple;
  } else {
    // Category defaults
    if (wp.category === 'Rotationen') allowsMultiple = true;
    else if (wp.category === 'Dienste' || wp.category === 'Demonstrationen & Konsile') allowsMultiple = false;
    else allowsMultiple = true; // Unknown category → allow
  }

  if (allowsMultiple) return null; // Multiple allowed → no conflict

  // Check if a shift already exists for this date+position (optionally +timeslot)
  let sql, params;
  if (timeslot_id) {
    sql = 'SELECT id, doctor_id FROM ShiftEntry WHERE date = ? AND position = ? AND timeslot_id = ? LIMIT 1';
    params = [date, position, timeslot_id];
  } else {
    sql = 'SELECT id, doctor_id FROM ShiftEntry WHERE date = ? AND position = ? LIMIT 1';
    params = [date, position];
  }

  try {
    const [existing] = await dbPool.execute(sql, params) as unknown as [RowDataPacket[], RowDataPacket[]];
    return existing.length > 0 ? existing[0] : null;
  } catch (e) {
    console.warn('[Sentinel] Conflict check failed:', (e as Error).message);
    return null; // On error, allow the create (don't block operations)
  }
};

const ensureTenantBaseSchema = async (dbPool: any, cacheKey: any) => {
  const tableCheckKey = `${cacheKey}:tenant-base-schema:checked`;
  if (COLUMNS_CACHE[tableCheckKey]) return;

  try {
    await ensureTenantBaseTables(dbPool);
    const doctorChanged = await ensureColumns(dbPool, 'Doctor', [
      ['central_employee_id', 'VARCHAR(36) DEFAULT NULL'],
    ]);
    if (doctorChanged) {
      try {
        await dbPool.execute('CREATE INDEX idx_doctor_central_employee ON Doctor(central_employee_id)');
      } catch (err) {
        if ((err as CuraDbError).code !== 'ER_DUP_KEYNAME') {
          console.warn('[dbProxy] ensureTenantBaseSchema doctor link index:', (err as Error).message);
        }
      }
    }
    clearColumnsCache(TENANT_BASE_TABLES, cacheKey);
  } catch (err) {
    console.error('Failed to ensure tenant base schema:', (err as Error).message);
    throw err;
  }

  COLUMNS_CACHE[tableCheckKey] = true;
};

const loadDoctorLink = async (dbPool: any, doctorId: any) => {
  if (!doctorId) return null;
  const [rows] = await dbPool.execute(
    'SELECT id, central_employee_id FROM Doctor WHERE id = ? LIMIT 1',
    [doctorId]
  ) as unknown as [RowDataPacket[], RowDataPacket[]];
  if (rows.length === 0 || !rows[0].central_employee_id) {
    return null;
  }
  return {
    doctorId: String(rows[0].id),
    employeeId: String(rows[0].central_employee_id),
  };
};

// Handle GET requests with helpful error
router.get('/', (req: Request, res: Response) => {
  res.status(405).json({ 
    error: 'Method not allowed. Use POST with { action, entity, ... }',
    hint: 'GET requests are not supported on /api/db'
  });
});

// Auto-create ScheduleBlock table if it doesn't exist (for multi-tenant support)
const ensureScheduleBlockTable = async (dbPool: any, cacheKey: any) => {
  const tableCheckKey = `${cacheKey}:ScheduleBlock:checked`;
  if (COLUMNS_CACHE[tableCheckKey]) return;
  
  try {
    await dbPool.execute(`
      CREATE TABLE IF NOT EXISTS ScheduleBlock (
        id VARCHAR(36) PRIMARY KEY,
        date DATE NOT NULL,
        position VARCHAR(255) NOT NULL,
        timeslot_id VARCHAR(36) DEFAULT NULL,
        reason VARCHAR(500) DEFAULT NULL,
        type VARCHAR(10) DEFAULT 'block',
        created_by VARCHAR(255) DEFAULT NULL,
        created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_date DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY unique_block (date, position, timeslot_id, type)
      ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
    `);

    // Add type column if missing (for tenants with old schema)
    await ensureColumns(dbPool, 'ScheduleBlock', [
      ['type', "VARCHAR(10) DEFAULT 'block'"],
    ]);

    COLUMNS_CACHE[tableCheckKey] = true;
  } catch (err) {
    console.warn('ensureScheduleBlockTable error:', (err as Error).message);
  }
};

// Auto-create TeamRole table if it doesn't exist (for multi-tenant support)
const ensureTeamRoleTable = async (dbPool: any, cacheKey: any) => {
  const tableCheckKey = `${cacheKey}:TeamRole:checked`;
  if (COLUMNS_CACHE[tableCheckKey]) return; // Already checked this session
  
  try {
    await dbPool.execute(`
      CREATE TABLE IF NOT EXISTS TeamRole (
        id VARCHAR(36) PRIMARY KEY,
        name VARCHAR(100) NOT NULL UNIQUE,
        priority INT NOT NULL DEFAULT 99,
        is_specialist BOOLEAN NOT NULL DEFAULT FALSE,
        can_do_foreground_duty BOOLEAN NOT NULL DEFAULT TRUE,
        can_do_background_duty BOOLEAN NOT NULL DEFAULT FALSE,
        excluded_from_statistics BOOLEAN NOT NULL DEFAULT FALSE,
        description VARCHAR(255) DEFAULT NULL,
        created_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);
    
    // Add new columns if table exists but lacks them (migration)
    try {
      await ensureColumns(dbPool, 'TeamRole', [
        ['can_do_foreground_duty', 'BOOLEAN NOT NULL DEFAULT TRUE'],
        ['can_do_background_duty', 'BOOLEAN NOT NULL DEFAULT FALSE'],
        ['excluded_from_statistics', 'BOOLEAN NOT NULL DEFAULT FALSE'],
        ['description', 'VARCHAR(255) DEFAULT NULL'],
      ]);
    } catch (alterErr) {
      // Columns might already exist
    }

    // Fix for existing tenants: ALTER TABLE sets can_do_background_duty=FALSE for all rows.
    // Update known roles to correct values if they still have the wrong defaults.
    try {
      await dbPool.execute(`UPDATE TeamRole SET can_do_background_duty = TRUE WHERE name IN ('Chefarzt', 'Oberarzt', 'Facharzt') AND can_do_background_duty = FALSE`);
      await dbPool.execute(`UPDATE TeamRole SET can_do_foreground_duty = FALSE WHERE name IN ('Chefarzt', 'Oberarzt', 'Nicht-Radiologe') AND can_do_foreground_duty = TRUE AND is_specialist = TRUE`);
      await dbPool.execute(`UPDATE TeamRole SET can_do_foreground_duty = FALSE WHERE name = 'Nicht-Radiologe' AND can_do_foreground_duty = TRUE`);
      await dbPool.execute(`UPDATE TeamRole SET excluded_from_statistics = TRUE WHERE name = 'Nicht-Radiologe' AND excluded_from_statistics = FALSE`);
    } catch (updateErr) {
      console.warn('TeamRole defaults migration update skipped:', (updateErr as Error).message);
    }

    // Seed defaults if empty
    const [existing] = await dbPool.execute('SELECT COUNT(*) as cnt FROM TeamRole') as unknown as [RowDataPacket[], RowDataPacket[]];
    if (existing[0].cnt === 0) {
      const defaultRoles = [
        { name: 'Chefarzt', priority: 0, is_specialist: true, can_do_foreground_duty: false, can_do_background_duty: true, excluded_from_statistics: false, description: 'Oberste Führungsebene' },
        { name: 'Oberarzt', priority: 1, is_specialist: true, can_do_foreground_duty: false, can_do_background_duty: true, excluded_from_statistics: false, description: 'Kann Hintergrunddienste übernehmen' },
        { name: 'Facharzt', priority: 2, is_specialist: true, can_do_foreground_duty: true, can_do_background_duty: true, excluded_from_statistics: false, description: 'Kann alle Dienste übernehmen' },
        { name: 'Assistenzarzt', priority: 3, is_specialist: false, can_do_foreground_duty: true, can_do_background_duty: false, excluded_from_statistics: false, description: 'Kann Vordergrunddienste übernehmen' },
        { name: 'Nicht-Radiologe', priority: 4, is_specialist: false, can_do_foreground_duty: false, can_do_background_duty: false, excluded_from_statistics: true, description: 'Wird in Statistiken nicht gezählt' },
        { name: 'MFA', priority: 13, is_specialist: false, can_do_foreground_duty: false, can_do_background_duty: false, excluded_from_statistics: false, description: 'Medizinische Fachangestellte' },
        { name: 'Pflegefachkraft', priority: 14, is_specialist: false, can_do_foreground_duty: false, can_do_background_duty: false, excluded_from_statistics: false, description: 'Pflegerische Betreuung der Patienten' },
        { name: 'KAPH', priority: 15, is_specialist: false, can_do_foreground_duty: false, can_do_background_duty: false, excluded_from_statistics: false, description: 'Krankenpflegehilfe' },
        // "Azubi …" roles intentionally NOT seeded as defaults — names clash
        // with trainee positions imported from the central employee management.
        { name: 'Studentische Hilfskraft', priority: 25, is_specialist: false, can_do_foreground_duty: false, can_do_background_duty: false, excluded_from_statistics: false, description: 'Studentische Unterstützung im Praxisalltag' },
        { name: 'Pflegerische Hilfskraft', priority: 26, is_specialist: false, can_do_foreground_duty: false, can_do_background_duty: false, excluded_from_statistics: false, description: 'Unterstützung in der Pflege' },
      ];
      for (const role of defaultRoles) {
        const id = crypto.randomUUID();
        await dbPool.execute(
          'INSERT IGNORE INTO TeamRole (id, name, priority, is_specialist, can_do_foreground_duty, can_do_background_duty, excluded_from_statistics, description) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          [id, role.name, role.priority, role.is_specialist, role.can_do_foreground_duty, role.can_do_background_duty, role.excluded_from_statistics, role.description]
        );
      }
      console.log('✅ TeamRole table created and seeded for tenant');
    }
    COLUMNS_CACHE[tableCheckKey] = true;
  } catch (err) {
    console.error('Failed to ensure TeamRole table:', (err as Error).message);
    COLUMNS_CACHE[tableCheckKey] = true; // Don't retry on error
  }
};

// Auto-create Qualification tables if they don't exist (for multi-tenant support)
const ensureQualificationTables = async (dbPool: any, cacheKey: any) => {
  const tableCheckKey = `${cacheKey}:Qualification:checked`;
  if (COLUMNS_CACHE[tableCheckKey]) return;
  
  try {
    await dbPool.execute(`
      CREATE TABLE IF NOT EXISTS Qualification (
        id VARCHAR(255) PRIMARY KEY,
        name VARCHAR(100) NOT NULL UNIQUE,
        short_label VARCHAR(10) DEFAULT NULL,
        description VARCHAR(255) DEFAULT NULL,
        color_bg VARCHAR(20) DEFAULT '#e0e7ff',
        color_text VARCHAR(20) DEFAULT '#3730a3',
        category VARCHAR(50) DEFAULT 'Allgemein',
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        requires_certificate BOOLEAN NOT NULL DEFAULT FALSE,
        certificate_requirement_mode VARCHAR(32) DEFAULT 'single_document',
        certificate_validity_months INT DEFAULT NULL,
        certificate_refresh_validity_months INT DEFAULT NULL,
        certificate_base_label VARCHAR(100) DEFAULT 'Grundnachweis',
        certificate_refresh_label VARCHAR(100) DEFAULT 'Verlängerung / Auffrischung',
        \`order\` INT NOT NULL DEFAULT 99,
        created_date DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
        updated_date DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
        created_by VARCHAR(255) DEFAULT 'system'
      ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
    `);
    
    await dbPool.execute(`
      CREATE TABLE IF NOT EXISTS DoctorQualification (
        id VARCHAR(255) PRIMARY KEY,
        doctor_id VARCHAR(255) NOT NULL,
        qualification_id VARCHAR(255) NOT NULL,
        granted_date DATE DEFAULT NULL,
        expiry_date DATE DEFAULT NULL,
        notes VARCHAR(255) DEFAULT NULL,
        certificate_status VARCHAR(32) DEFAULT NULL,
        certificate_valid_from DATE DEFAULT NULL,
        certificate_valid_until DATE DEFAULT NULL,
        certificate_status_reason VARCHAR(500) DEFAULT NULL,
        created_date DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
        updated_date DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
        created_by VARCHAR(255) DEFAULT 'system',
        UNIQUE KEY uq_doctor_qual (doctor_id, qualification_id),
        INDEX idx_dq_doctor (doctor_id),
        INDEX idx_dq_qualification (qualification_id)
      ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
    `);
    
    await dbPool.execute(`
      CREATE TABLE IF NOT EXISTS WorkplaceQualification (
        id VARCHAR(255) PRIMARY KEY,
        workplace_id VARCHAR(255) NOT NULL,
        qualification_id VARCHAR(255) NOT NULL,
        is_mandatory BOOLEAN NOT NULL DEFAULT TRUE,
        is_excluded BOOLEAN NOT NULL DEFAULT FALSE,
        created_date DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
        updated_date DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
        created_by VARCHAR(255) DEFAULT 'system',
        UNIQUE KEY uq_workplace_qual (workplace_id, qualification_id),
        INDEX idx_wq_workplace (workplace_id),
        INDEX idx_wq_qualification (qualification_id)
      ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
    `);

    // Add is_excluded column if table already existed without it
    try {
      const changed = await Promise.all([
        ensureColumns(dbPool, 'WorkplaceQualification', [
          ['is_excluded', 'BOOLEAN NOT NULL DEFAULT FALSE'],
        ]),
        ensureColumns(dbPool, 'Qualification', [
          ['requires_certificate', 'BOOLEAN NOT NULL DEFAULT FALSE'],
          ['certificate_requirement_mode', "VARCHAR(32) DEFAULT 'single_document'"],
          ['certificate_validity_months', 'INT DEFAULT NULL'],
          ['certificate_refresh_validity_months', 'INT DEFAULT NULL'],
          ['certificate_base_label', "VARCHAR(100) DEFAULT 'Grundnachweis'"],
          ['certificate_refresh_label', "VARCHAR(100) DEFAULT 'Verlängerung / Auffrischung'"],
        ]),
        ensureColumns(dbPool, 'DoctorQualification', [
          ['certificate_status', 'VARCHAR(32) DEFAULT NULL'],
          ['certificate_valid_from', 'DATE DEFAULT NULL'],
          ['certificate_valid_until', 'DATE DEFAULT NULL'],
          ['certificate_status_reason', 'VARCHAR(500) DEFAULT NULL'],
        ]),
      ]);

      if (changed.some(Boolean)) {
        clearColumnsCache(['WorkplaceQualification', 'Qualification', 'DoctorQualification'], cacheKey);
      }
    } catch (alterErr) {
      // Column might already exist
    }
    
    COLUMNS_CACHE[tableCheckKey] = true;
    console.log('✅ Qualification tables ensured for tenant');
  } catch (err) {
    console.error('Failed to ensure Qualification tables:', (err as Error).message);
    COLUMNS_CACHE[tableCheckKey] = true;
  }
};

// Auto-add min_staff and optimal_staff columns to Workplace if missing (for auto-fill engine)
const ensureWorkplaceStaffColumns = async (dbPool: any, cacheKey: any) => {
  const checkKey = `${cacheKey}:Workplace:staff_cols_checked`;
  if (COLUMNS_CACHE[checkKey]) return;

  try {
    const changed = await ensureColumns(dbPool, 'Workplace', [
      ['min_staff', 'INT DEFAULT 1'],
      ['optimal_staff', 'INT DEFAULT 1'],
      ['consecutive_days_mode', "VARCHAR(20) DEFAULT 'allowed'"],
    ]);

    // Migrate legacy boolean values if the new column was just added
    await dbPool.execute(`UPDATE Workplace SET consecutive_days_mode = 'forbidden' WHERE consecutive_days_mode = 'allowed' AND allows_consecutive_days = 0`).catch(() => {});
    if (changed) {
      clearColumnsCache(['Workplace'], cacheKey);
    }
  } catch (err) {
    // Columns might already exist or table might not exist yet — both are fine
    if ((err as CuraDbError).code !== 'ER_DUP_FIELDNAME') {
      console.warn('[dbProxy] ensureWorkplaceStaffColumns:', (err as Error).message);
    }
  }
  COLUMNS_CACHE[checkKey] = true;
};

// ============ AUDIT LOG HELPER ============

/**
 * Resolve a doctor_id to a human-readable name.
 * Returns null if the doctor cannot be found.
 */
const resolveDoctorName = async (dbPool: any, doctorId: any) => {
  if (!doctorId) return null;
  try {
    const [rows] = await dbPool.execute('SELECT name FROM Doctor WHERE id = ? LIMIT 1', [doctorId]) as unknown as [RowDataPacket[], RowDataPacket[]];
    return rows[0]?.name ?? null;
  } catch {
    return null;
  }
};

/**
 * Enrich audit log details with human-readable context (doctor name, date, position)
 * so that admins can understand audit entries without looking up cryptic IDs.
 */
export const enrichAuditDetails = async (dbPool: any, details: any) => {
  if (!details || typeof details !== 'object') return details;
  const enriched = { ...details };
  const record = details.deleted_data || details.data;
  if (record && record.doctor_id) {
    const doctorName = await resolveDoctorName(dbPool, record.doctor_id);
    if (doctorName) {
      enriched.doctor_name = doctorName;
    }
  }
  // Build a human-readable summary for ShiftEntry records
  if (details.table === 'ShiftEntry' && record) {
    const parts = [];
    if (enriched.doctor_name) parts.push(enriched.doctor_name);
    if (record.date) parts.push(`am ${record.date}`);
    if (record.position) parts.push(`(${record.position})`);
    if (parts.length > 0) enriched.summary = parts.join(' ');
  }
  return enriched;
};

// Writes an audit entry to the SystemLog table for UI visibility
export const writeAuditLog = async (dbPool: any, { level = 'audit', source, message, details, userEmail }: any) => {
  try {
    const id = crypto.randomUUID();
    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
    await dbPool.execute(
      `INSERT INTO SystemLog (id, level, source, message, details, created_date, updated_date, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, level, source, message, typeof details === 'string' ? details : JSON.stringify(details), now, now, userEmail || 'system']
    );
  } catch (err) {
    // Don't let audit logging failures break the main operation
    console.error('[AUDIT] Failed to write audit log to SystemLog table:', (err as Error).message);
  }
};

// Helper: check if a position name belongs to a "Dienste"-category workplace.
// Fail-closed (F6): on DB error we cannot determine the category, so treat the
// write as protected (return true) — the caller then requires can_edit_schedule.
// The previous fail-open `return false` let a transient lookup error bypass the
// permission check on a Dienste shift.
async function isServicePosition(dbPool: any, positionName: any) {
  if (!positionName) return false;
  try {
    const [rows] = await dbPool.execute(
      'SELECT category FROM Workplace WHERE name = ? LIMIT 1',
      [positionName],
    ) as unknown as [RowDataPacket[], RowDataPacket[]];
    return rows.length > 0 && rows[0].category === 'Dienste';
  } catch (err) {
    console.error('[isServicePosition] lookup failed, treating as protected:', (err as Error).message);
    return true;
  }
}

// Helper: extract position names from ShiftEntry request data
function extractPositionNamesFromShiftData(requestBody: any) {
  const { action, operation, entity, table, data, id } = requestBody;
  const tableName = entity || table;
  if (tableName !== 'ShiftEntry') return [];
  const effAction = action || operation;
  if (effAction === 'create' || effAction === 'update') {
    return data?.position ? [data.position] : [];
  }
  if (effAction === 'bulkCreate') {
    return (Array.isArray(data) ? data : []).map((d: any) => d.position).filter(Boolean);
  }
  // For delete: need to look up the record
  return [];
}

// WishRequest/AbsenceRequest statuses that represent an approval decision.
// Only writes that promote a record to one of these — or mutate an already
// decided record — require the approval permission. Creating, editing, or
// deleting your own *pending* request is a normal user action and must stay
// open, otherwise no non-admin can submit wishes or absence requests at all.
const APPROVAL_DECISION_STATUSES = ['approved', 'rejected'];

async function loadStatusForId(dbPool: any, table: any, id: any) {
  if (!id) return null;
  try {
    // SELECT through Kysely so the table identifier is escaped centrally
    // (PR 1.5 — completes the S1 grep gate). `table` is the route-validated
    // tableName; behavior unchanged (status column, id lookup, fail-null).
    const kysely = createKysely(dbPool);
    const rows = await (kysely as unknown as Kysely<Record<string, Record<string, unknown>>>).selectFrom(table).select('status').where('id', '=', id).limit(1).execute();
    return rows[0]?.status ?? null;
  } catch {
    return null;
  }
}

// Decide whether a WishRequest/AbsenceRequest write is an approval-affecting
// change that must be gated by can_approve_wishes / can_approve_absence.
function approvalWriteRequiresPermission({ action, data, existingStatus, noServiceRequiresApproval = true }: any) {
  const newDataStatus = typeof data?.status === 'string' ? data.status.toLowerCase() : null;
  if (action === 'create') {
    // Creating an already-decided record (e.g. directly approved) needs the perm;
    // a plain pending submission does not.
    // Exception: if no_service wishes don't require approval, users may create
    // them with status 'approved' directly (auto-approve).
    if (!noServiceRequiresApproval && data?.type === 'no_service' && newDataStatus === 'approved') {
      return false;
    }
    return APPROVAL_DECISION_STATUSES.includes(newDataStatus);
  }
  if (action === 'update') {
    // Promoting to a decision, or editing a record that is already decided.
    if (APPROVAL_DECISION_STATUSES.includes(newDataStatus)) return true;
    return APPROVAL_DECISION_STATUSES.includes(existingStatus as string);
  }
  if (action === 'delete') {
    // Users may cancel their own pending requests; only decided records are protected.
    return APPROVAL_DECISION_STATUSES.includes(existingStatus as string);
  }
  if (action === 'bulkCreate') {
    return (Array.isArray(data) ? data : []).some((d: any) =>
      APPROVAL_DECISION_STATUSES.includes(
        typeof d?.status === 'string' ? d.status.toLowerCase() : null,
      ),
    );
  }
  return true;
}

// ============ UNIFIED DB PROXY ENDPOINT ============
router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  const creq = req as unknown as CuraRequest;
  try {
    const { action, operation, entity, table, data, id, query, sort, limit, skip } = req.body;
    const effectiveAction = action || operation; // Support both 'action' and 'operation' keys
    const tableName = entity || table;
    
    // Get the database pool (set by tenantDbMiddleware)
    const dbPool = creq.db || db;
    const cacheKey = String(req.headers['x-db-token'] || '') || 'default';
    const realtimeScope = buildRealtimeScope(creq.dbToken);
    const actor = {
      id: creq.user?.sub ?? undefined,
      email: creq.user?.email || 'system',
    };

    if (creq.isCustomDb && tableName && TENANT_BASE_TABLE_SET.has(tableName)) {
      await ensureTenantBaseSchema(dbPool, cacheKey);
    }
    
    // Auto-create TeamRole table for tenants if needed
    if (tableName === 'TeamRole') {
      await ensureTeamRoleTable(dbPool, cacheKey);
    }
    
    // Auto-create Qualification tables for tenants if needed
    if (['Qualification', 'DoctorQualification', 'WorkplaceQualification'].includes(tableName)) {
      await ensureQualificationTables(dbPool, cacheKey);
    }
    
    // Auto-add min_staff/optimal_staff columns to Workplace if needed
    if (tableName === 'Workplace') {
      await ensureWorkplaceStaffColumns(dbPool, cacheKey);
    }

    // Auto-create ScheduleBlock table for tenants if needed
    if (tableName === 'ScheduleBlock') {
      await ensureScheduleBlockTable(dbPool, cacheKey);
    }
    
    if (!tableName) {
      return res.status(400).json({ error: 'Entity/table required' });
    }

    // Validate the table identifier BEFORE any SQL construction. The table name
    // is interpolated into backtick-quoted identifier contexts (SHOW COLUMNS,
    // SELECT/INSERT/UPDATE/DELETE FROM `...`); a backtick in the name breaks
    // out and enables SQL injection. Prepared statements parameterize values,
    // not identifiers, so this validation is mandatory for any user-supplied
    // table name. assertValidIdentifier throws a 400 on an invalid name; the
    // surrounding try/catch forwards it via next(error).
    assertValidIdentifier(tableName, 'Tabellenname');

    if (!effectiveAction) {
      return res.status(400).json({ error: 'Action/operation required' });
    }
    
    // Check if this is a public read operation
    const isPublicRead = PUBLIC_READ_TABLES.includes(tableName) && 
                         (effectiveAction === 'list' || effectiveAction === 'filter' || effectiveAction === 'get');
    
    // Require auth for non-public operations
    if (!isPublicRead) {
      // Check for auth token
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Nicht autorisiert' });
      }
      
      // Verify token (inline check)
      const token = authHeader.split(' ')[1];
      try {
        const jwt = await import('jsonwebtoken');
        const decoded = jwt.default.verify(token, process.env.JWT_SECRET!);
        creq.user = decoded as CuraRequest['user'];
      } catch (err) {
        return res.status(401).json({ error: 'Token ungültig' });
      }
    }
    
    // Guard: write operations on protected tables require specific permissions
    const PROTECTED_WRITE_TABLES = {
      ShiftEntry: 'can_edit_schedule',
      WishRequest: 'can_approve_wishes',
      AbsenceRequest: 'can_approve_absence',
    };
    const WRITE_ACTIONS = ['create', 'update', 'delete', 'bulkCreate'];
    const requiredPerm = (PROTECTED_WRITE_TABLES as Record<string, string>)[tableName];
    if (requiredPerm && WRITE_ACTIONS.includes(effectiveAction)) {
      // For ShiftEntry: only block if the position is a "Dienste"-category workplace
      let shouldCheckPermission = true;
      if (tableName === 'ShiftEntry') {
        const positions = extractPositionNamesFromShiftData(req.body);
        if (effectiveAction === 'delete' && id) {
          try {
            const [shiftRows] = await dbPool.execute(
              'SELECT position FROM ShiftEntry WHERE id = ? LIMIT 1',
              [id],
            ) as unknown as [RowDataPacket[], RowDataPacket[]];
            if (shiftRows.length > 0) positions.push(shiftRows[0].position);
          } catch { /* continue */ }
        }
        const isDienste = positions.length > 0
          ? (await Promise.all(positions.map((p: any) => isServicePosition(dbPool, p)))).some(Boolean)
          : false;
        shouldCheckPermission = isDienste;
      } else if (tableName === 'WishRequest' || tableName === 'AbsenceRequest') {
        // Only the approval-affecting part of these tables is permission-gated.
        // Submitting / editing / cancelling your own pending request stays open.
        let existingStatus = null;
        if ((effectiveAction === 'update' || effectiveAction === 'delete') && id) {
          existingStatus = await loadStatusForId(dbPool, tableName, id);
        }
        // Load no_service_requires_approval from tenant SystemSetting so that
        // auto-approved "kein Dienst" wishes don't require can_approve_wishes.
        let noServiceRequiresApproval = true;
        if (tableName === 'WishRequest') {
          try {
            const [settingRows] = await dbPool.execute(
              "SELECT `value` FROM SystemSetting WHERE `key` = 'wish_approval_rules' LIMIT 1",
            ) as unknown as [RowDataPacket[], RowDataPacket[]];
            if (settingRows.length > 0) {
              const rules = JSON.parse(settingRows[0].value);
              noServiceRequiresApproval = rules.no_service_requires_approval ?? true;
            }
          } catch { /* default: require approval */ }
        }
        shouldCheckPermission = approvalWriteRequiresPermission({
          action: effectiveAction,
          data,
          existingStatus,
          noServiceRequiresApproval,
        });
      }
      if (shouldCheckPermission) {
        // Authoritative check: resolve role/is_active from the master DB row,
        // not the JWT. A deactivated or demoted admin is denied immediately
        // (S7 / F4), instead of for up to TOKEN_EXPIRY via the lockout-safe
        // branch. checkAdminPermission is fail-closed (DB error ⇒ deny).
        let hasPerm = false;
        try {
          const result = await checkAdminPermission(db, creq.user?.sub ?? '', requiredPerm as PermissionKey);
          hasPerm = result.allowed;
        } catch { /* fall through to deny */ }
        if (!hasPerm) {
          return res.status(403).json({
            error: 'Ihnen fehlt die Berechtigung für diese Aktion',
            missingPermission: requiredPerm,
          });
        }
      }
    }

    // ===== Qualification repo dispatch (Phase 2, PR 2.1) =====
    // Qualification is the first entity repo-ified: it short-circuits the
    // generic dispatch to a dedicated module (table name is a constant, not
    // user input). Behavior is preserved exactly from the generic path:
    // auto-inject id/dates/created_by, column filtering, realtime broadcast,
    // delete audit. Sibling tables (DoctorQualification, WorkplaceQualification)
    // remain on the generic dispatch.
    if (tableName === 'Qualification') {
      if (effectiveAction === 'list' || effectiveAction === 'filter') {
        try {
          const rows = await listQualifications(dbPool, {
            filters: query || req.body.filters || {},
            sort,
            limit,
            skip,
          });
          return res.json(rows);
        } catch (err) {
          console.error("List Execute Error:", (err as Error).message, "table:", tableName);
          if ((err as Error).message.includes("doesn't exist") || (err as CuraDbError).code === 'ER_NO_SUCH_TABLE') {
            console.warn(`Table ${tableName} doesn't exist, returning empty array`);
            return res.json([]);
          }
          throw err;
        }
      }
      if (effectiveAction === 'get') {
        if (!id) return res.json(null);
        return res.json(await getQualification(dbPool, id));
      }
      if (effectiveAction === 'create') {
        const validColumns = await getValidColumns(dbPool, tableName, cacheKey);
        const created = await createQualification({
          dbPool,
          data,
          validColumns,
          actorEmail: creq.user?.email || 'system',
        });
        if (isPlanSyncEntity(tableName)) {
          broadcastPlanUpdate({ scope: realtimeScope, entity: tableName, action: 'create', recordId: (created as { id: string }).id, actor });
        }
        return res.json(created);
      }
      if (effectiveAction === 'update') {
        if (!id) return res.status(400).json({ error: 'ID required for update' });
        const validColumns = await getValidColumns(dbPool, tableName, cacheKey);
        const updated = await updateQualification({ dbPool, id, data, validColumns });
        if (isPlanSyncEntity(tableName)) {
          broadcastPlanUpdate({ scope: realtimeScope, entity: tableName, action: 'update', recordId: id, actor });
        }
        return res.json(updated);
      }
      if (effectiveAction === 'delete') {
        if (!id) return res.status(400).json({ error: 'ID required for delete' });
        const deletedRecord = await deleteQualification({ dbPool, id });
        await writeAuditLog(dbPool, {
          level: 'audit',
          source: 'Löschung',
          message: `${tableName} gelöscht von ${creq.user?.email || 'unknown'} (ID: ${id})`,
          details: { table: tableName, record_id: id, deleted_data: deletedRecord, timestamp: new Date().toISOString() },
          userEmail: creq.user?.email || 'unknown',
        });
        if (isPlanSyncEntity(tableName)) {
          broadcastPlanUpdate({ scope: realtimeScope, entity: tableName, action: 'delete', recordId: id, actor });
        }
        return res.json({ success: true });
      }
      // bulkCreate + unknown actions fall through to the generic dispatch.
    }

    // AbsenceRequest is a MASTER-DB entity with a dedicated route
    // (/api/absence-requests) + util (utils/absenceRequests.js) that enforces
    // future-date validation, position whitelist, employee-link resolution,
    // pending-only enforcement, and the approve→CentralAbsenceEntry transaction.
    // The generic /api/db path cannot serve it correctly: it resolves dbPool to
    // the TENANT pool (creq.db) when a token is present → ER_NO_SUCH_TABLE, and
    // to master without a token → bypasses all that validation. Reject it here
    // so the dedicated route is the only surface. (Phase 2, PR 2.2.)
    if (tableName === 'AbsenceRequest') {
      return res.status(400).json({
        error: 'AbsenceRequest wird über /api/absence-requests verwaltet, nicht über /api/db.',
      });
    }

    // ===== WishRequest repo dispatch (Phase 2, PR 2.3) =====
    // WishRequest is a tenant table (correct pool via creq.db). The approval-
    // permission guard (can_approve_wishes) already ran in the pre-action block
    // above — this repo only executes for writes that passed it. CentralWishRequest
    // (master, cross-tenant) is a separate entity with dedicated routes in groups.js.
    if (tableName === 'WishRequest') {
      if (effectiveAction === 'list' || effectiveAction === 'filter') {
        try {
          const rows = await listWishRequests(dbPool, {
            filters: query || req.body.filters || {},
            sort,
            limit,
            skip,
          });
          return res.json(rows);
        } catch (err) {
          console.error("List Execute Error:", (err as Error).message, "table:", tableName);
          if ((err as Error).message.includes("doesn't exist") || (err as CuraDbError).code === 'ER_NO_SUCH_TABLE') {
            console.warn(`Table ${tableName} doesn't exist, returning empty array`);
            return res.json([]);
          }
          throw err;
        }
      }
      if (effectiveAction === 'get') {
        if (!id) return res.json(null);
        return res.json(await getWishRequest(dbPool, id));
      }
      if (effectiveAction === 'create') {
        const validColumns = await getValidColumns(dbPool, tableName, cacheKey);
        const created = await createWishRequest({
          dbPool,
          data,
          validColumns,
          actorEmail: creq.user?.email || 'system',
        });
        if (isPlanSyncEntity(tableName)) {
          broadcastPlanUpdate({ scope: realtimeScope, entity: tableName, action: 'create', recordId: (created as { id: string }).id, actor });
        }
        return res.json(created);
      }
      if (effectiveAction === 'update') {
        if (!id) return res.status(400).json({ error: 'ID required for update' });
        const validColumns = await getValidColumns(dbPool, tableName, cacheKey);
        const updated = await updateWishRequest({ dbPool, id, data, validColumns });
        if (isPlanSyncEntity(tableName)) {
          broadcastPlanUpdate({ scope: realtimeScope, entity: tableName, action: 'update', recordId: id, actor });
        }
        return res.json(updated);
      }
      if (effectiveAction === 'delete') {
        if (!id) return res.status(400).json({ error: 'ID required for delete' });
        const deletedRecord = await deleteWishRequest({ dbPool, id });
        await writeAuditLog(dbPool, {
          level: 'audit',
          source: 'Löschung',
          message: `${tableName} gelöscht von ${creq.user?.email || 'unknown'} (ID: ${id})`,
          details: { table: tableName, record_id: id, deleted_data: deletedRecord, timestamp: new Date().toISOString() },
          userEmail: creq.user?.email || 'unknown',
        });
        if (isPlanSyncEntity(tableName)) {
          broadcastPlanUpdate({ scope: realtimeScope, entity: tableName, action: 'delete', recordId: id, actor });
        }
        return res.json({ success: true });
      }
      // bulkCreate + unknown actions fall through to the generic dispatch.
    }

    // ===== Doctor repo dispatch (Phase 2, PR 2.4) =====
    // Doctor is a tenant table (correct pool). The repo handles name/initials
    // conflict detection (pre-check returns 409; ER_DUP_ENTRY fallback below).
    // Direct-SQL sites in staff.js/master.js/etc (central_employee_id link
    // management + read projections) are a different layer — untouched.
    if (tableName === 'Doctor') {
      if (effectiveAction === 'list' || effectiveAction === 'filter') {
        try {
          const rows = await listDoctors(dbPool, {
            filters: query || req.body.filters || {},
            sort,
            limit,
            skip,
          });
          return res.json(rows);
        } catch (err) {
          console.error("List Execute Error:", (err as Error).message, "table:", tableName);
          if ((err as Error).message.includes("doesn't exist") || (err as CuraDbError).code === 'ER_NO_SUCH_TABLE') {
            console.warn(`Table ${tableName} doesn't exist, returning empty array`);
            return res.json([]);
          }
          throw err;
        }
      }
      if (effectiveAction === 'get') {
        if (!id) return res.json(null);
        return res.json(await getDoctor(dbPool, id));
      }
      if (effectiveAction === 'create') {
        const validColumns = await getValidColumns(dbPool, tableName, cacheKey);
        try {
          const created = await createDoctor({
            dbPool,
            data,
            validColumns,
            actorEmail: creq.user?.email || 'system',
          });
          if (isPlanSyncEntity(tableName)) {
          broadcastPlanUpdate({ scope: realtimeScope, entity: tableName, action: 'create', recordId: (created as { id: string }).id, actor });
          }
          return res.json(created);
        } catch (err) {
          if ((err as CuraDbError).status === 409 && (err as CuraDbError).conflictPayload) {
            return res.status(409).json((err as CuraDbError).conflictPayload);
          }
          // ER_DUP_ENTRY fallback (race / unique index the pre-check missed)
          if ((err as CuraDbError).code === 'ER_DUP_ENTRY') {
            const { buildDoctorConflictResponse } = await import('../repos/doctorRepo.js');
            const conflict = await buildDoctorConflictResponse(dbPool, data);
            if (conflict) {
              return res.status(conflict.status).json(conflict.payload);
            }
          }
          throw err;
        }
      }
      if (effectiveAction === 'update') {
        if (!id) return res.status(400).json({ error: 'ID required for update' });
        const validColumns = await getValidColumns(dbPool, tableName, cacheKey);
        try {
          const updated = await updateDoctor({ dbPool, id, data, validColumns });
          if (isPlanSyncEntity(tableName)) {
            broadcastPlanUpdate({ scope: realtimeScope, entity: tableName, action: 'update', recordId: id, actor });
          }
          return res.json(updated);
        } catch (err) {
          if ((err as CuraDbError).status === 409 && (err as CuraDbError).conflictPayload) {
            return res.status(409).json((err as CuraDbError).conflictPayload);
          }
          if ((err as CuraDbError).code === 'ER_DUP_ENTRY') {
            const { buildDoctorConflictResponse } = await import('../repos/doctorRepo.js');
            const conflict = await buildDoctorConflictResponse(dbPool, data, id);
            if (conflict) {
              return res.status(conflict.status).json(conflict.payload);
            }
          }
          throw err;
        }
      }
      if (effectiveAction === 'delete') {
        if (!id) return res.status(400).json({ error: 'ID required for delete' });
        const deletedRecord = await deleteDoctor({ dbPool, id });
        await writeAuditLog(dbPool, {
          level: 'audit',
          source: 'Löschung',
          message: `${tableName} gelöscht von ${creq.user?.email || 'unknown'} (ID: ${id})`,
          details: { table: tableName, record_id: id, deleted_data: deletedRecord, timestamp: new Date().toISOString() },
          userEmail: creq.user?.email || 'unknown',
        });
        if (isPlanSyncEntity(tableName)) {
          broadcastPlanUpdate({ scope: realtimeScope, entity: tableName, action: 'delete', recordId: id, actor });
        }
        return res.json({ success: true });
      }
      // bulkCreate + unknown actions fall through to the generic dispatch.
    }

    // ===== ShiftEntry repo dispatch (Phase 2, PR 2.5) =====
    // ShiftEntry is the most complex entity: central-absence routing, sentinels,
    // auto-time, central/tenant transitions. All that logic now lives in
    // shiftEntryRepo.js (moved from inline dbProxy branches). centralAbsences.js
    // stays as the central-store engine (the repo calls it). The can_edit_schedule
    // permission guard already ran in the pre-action block. bulkCreate falls
    // through to the generic dispatch (complex central-split, no direct e2e).
    if (tableName === 'ShiftEntry') {
      if (effectiveAction === 'list' || effectiveAction === 'filter') {
        if (creq.db) {
          try {
            const rows = await listShiftEntries({
              tenantDb: dbPool,
              masterDb: db,
              filters: query || req.body.filters || {},
              sort,
              limit,
              skip,
            });
            return res.json(rows);
          } catch (err) {
            console.error('[dbProxy] ShiftEntry central-merge failed', {
              action: effectiveAction, table: tableName,
              query: query || req.body.filters || {}, sort, limit, skip,
              actor: actor?.id, tenantToken: cacheKey,
              message: (err as Error).message, code: (err as CuraDbError).code, errno: (err as CuraDbError).errno,
              sqlState: (err as CuraDbError).sqlState, sqlMessage: (err as CuraDbError).sqlMessage, stack: (err as Error).stack,
            });
            throw err;
          }
        }
        // No creq.db → fall through to generic filterRows (master pool)
      }
      if (effectiveAction === 'get') {
        if (!id) return res.json(null);
        if (creq.db) {
          return res.json(await getShiftEntry({ tenantDb: dbPool, masterDb: db, id }));
        }
        // No creq.db → fall through to generic selectRow
      }
      if (effectiveAction === 'create') {
        try {
          const { result } = await createShiftEntry({
            dbPool, masterDb: db, req: creq, data, cacheKey,
            getValidColumns, WORKPLACE_CACHE, WORKPLACE_CACHE_TTL, ensureScheduleBlockTable,
          });
          if (isPlanSyncEntity(tableName)) {
            broadcastPlanUpdate({ scope: realtimeScope, entity: tableName, action: 'create', recordId: (result as { id?: string })?.id || (data as { id: string }).id, actor });
          }
          return res.json(result);
        } catch (err) {
          if ((err as CuraDbError).status === 409 && (err as CuraDbError).body) {
            return res.status(409).json((err as CuraDbError).body);
          }
          throw err;
        }
      }
      if (effectiveAction === 'update') {
        if (!id) return res.status(400).json({ error: 'ID required for update' });
        try {
          const { result } = await updateShiftEntry({
            dbPool, masterDb: db, req: creq, id, data, cacheKey, getValidColumns,
          });
          if (isPlanSyncEntity(tableName)) {
            broadcastPlanUpdate({
              scope: realtimeScope, entity: tableName, action: 'update', recordId: id, actor,
            });
          }
          return res.json(result);
        } catch (err) {
          if ((err as CuraDbError).status === 409 && (err as CuraDbError).body) {
            return res.status(409).json((err as CuraDbError).body);
          }
          throw err;
        }
      }
      if (effectiveAction === 'delete') {
        if (!id) return res.status(400).json({ error: 'ID required for delete' });
        const { central, deletedRecord } = await deleteShiftEntry({ dbPool, masterDb: db, req: creq, id });
        if (!central) {
          // Tenant delete: write audit log (central deletes don't audit here)
          await writeAuditLog(dbPool, {
            level: 'audit', source: 'Löschung',
            message: `${tableName} gelöscht von ${creq.user?.email || 'unknown'} (ID: ${id})`,
            details: { table: tableName, record_id: id, deleted_data: deletedRecord, timestamp: new Date().toISOString() },
            userEmail: creq.user?.email || 'unknown',
          });
        }
        if (isPlanSyncEntity(tableName)) {
          broadcastPlanUpdate({
            scope: realtimeScope, entity: tableName, action: 'delete', recordId: id, actor,
          });
        }
        return res.json({ success: true });
      }
      // bulkCreate + unknown actions fall through to the generic dispatch.
    }

    // ===== LIST / FILTER =====
    if (effectiveAction === 'list' || effectiveAction === 'filter') {
      // SELECT through Kysely (PR 1.3) so the table name, sort field, AND every
      // filter key are escaped centrally (closes the previously-unvalidated
      // filter-key interpolation). Behavior matches the old hand-built SQL:
      // equality / $gte / $lte filters, `id`-ASC default sort, optional
      // limit/skip. The table-not-exist fallback is preserved below.
      try {
        const rows = await filterRows(dbPool, tableName, {
          filters: query || req.body.filters || {},
          sort,
          limit,
          skip,
        });
        return res.json(rows.map(fromSqlRow));
      } catch (err) {
        console.error("List Execute Error:", (err as Error).message, "table:", tableName);
        if ((err as Error).message.includes("doesn't exist") || (err as CuraDbError).code === 'ER_NO_SUCH_TABLE') {
          console.warn(`Table ${tableName} doesn't exist, returning empty array`);
          return res.json([]);
        }
        throw err;
      }
    }
    
    // ===== GET =====
    if (effectiveAction === 'get') {
      if (!id) return res.json(null);

      const row = await selectRow(dbPool, tableName, id);
      return res.json(row ? fromSqlRow(row) : null);
    }
    
    // ===== CREATE =====
    if (effectiveAction === 'create') {
      if (!data.id) data.id = crypto.randomUUID();
      data.created_date = new Date();
      data.updated_date = new Date();
      data.created_by = creq.user?.email || 'system';

      const validColumns = await getValidColumns(dbPool, tableName, cacheKey);
      let keys = Object.keys(data);
      
      if (validColumns && validColumns.length > 0) {
        keys = keys.filter((k: any) => validColumns.includes(k));
      }
      
      if (keys.length === 0) {
        console.error(`CREATE failed: No valid columns for ${tableName}. Data keys:`, Object.keys(data), "Valid columns:", validColumns);
        return res.status(500).json({ error: `No valid columns found for table ${tableName}` });
      }

      try {
        // INSERT through Kysely so the table + column identifiers are escaped
        // centrally (Phase 1, PR 1.1). Behavior matches the previous hand-built
        // `INSERT INTO \`t\` (\`k\`,...) VALUES (?,...)` — same columns, same
        // toSqlValue marshaling, ER_DUP_ENTRY propagates with .code intact.
        await insertRow(dbPool, tableName, keys, data);
        if (isPlanSyncEntity(tableName)) {
          broadcastPlanUpdate({
            scope: realtimeScope,
            entity: tableName,
            action: 'create',
            recordId: data.id,
            actor,
          });
        }
        await ensureDefaultTimeslotAfterWorkplaceCreate(dbPool, data);
        return res.json(data);
      } catch (err) {
        console.error(`CREATE error for ${tableName}:`, (err as Error).message, "keys:", keys);

        // Bei Workplace: Duplikat (Name bereits vergeben) → Name hochzählen und nochmal versuchen
        if (tableName === 'Workplace' && (err as CuraDbError).code === 'ER_DUP_ENTRY' && data.name) {
          const baseName = data.name;
          let counter = 2;
          while (counter <= 20) {
            const retryName = `${baseName} ${counter}`;
            data.name = retryName;
            try {
              await insertRow(dbPool, tableName, keys, data);
              if (isPlanSyncEntity(tableName)) {
                broadcastPlanUpdate({
                  scope: realtimeScope,
                  entity: tableName,
                  action: 'create',
                  recordId: data.id,
                  actor,
                });
              }
              await ensureDefaultTimeslotAfterWorkplaceCreate(dbPool, data);
              return res.json(data);
            } catch (retryErr) {
              if ((retryErr as CuraDbError).code !== 'ER_DUP_ENTRY') throw retryErr;
              counter++;
            }
          }
        }

        throw err;
      }
    }

    // ===== UPDATE =====
    if (effectiveAction === 'update') {
      if (!id) return res.status(400).json({ error: "ID required for update" });

      data.updated_date = new Date();

      const validColumns = await getValidColumns(dbPool, tableName, cacheKey);
      let keys = Object.keys(data).filter((k: any) => k !== 'id');
      
      if (validColumns) {
        keys = keys.filter((k: any) => validColumns.includes(k));
      }
      
      if (keys.length === 0) return res.json({ success: true });

      // UPDATE through Kysely (PR 1.2) so the table + column identifiers are
      // escaped centrally. Behavior matches the previous hand-built
      // `UPDATE \`t\` SET \`k\`=?,... WHERE id = ?`.
      await updateRow(dbPool, tableName, keys, data, id);

      const row = await selectRow(dbPool, tableName, id);
      if (isPlanSyncEntity(tableName)) {
        broadcastPlanUpdate({
          scope: realtimeScope,
          entity: tableName,
          action: 'update',
          recordId: id,
          actor,
        });
      }
      return res.json(row ? fromSqlRow(row) : null);
    }
    
    // ===== DELETE =====
    if (effectiveAction === 'delete') {
      if (!id) return res.status(400).json({ error: "ID required for delete" });

      // Fetch record before deletion for logging, then DELETE — both through
      // Kysely (PR 1.2) so the table identifier is escaped centrally. Behavior
      // matches the previous hand-built `SELECT * FROM \`t\` WHERE id = ?` /
      // `DELETE FROM \`t\` WHERE id = ?`.
      const existing = await selectRow(dbPool, tableName, id);
      const deletedRecord = existing ? fromSqlRow(existing) : null;

      await deleteRow(dbPool, tableName, id);
      
      // Write audit to SystemLog table
      const userEmail = creq.user?.email || 'unknown';
      const timestamp = new Date().toISOString();
      const auditDetails = await enrichAuditDetails(dbPool, {
        table: tableName, record_id: id, deleted_data: deletedRecord, timestamp,
      });
      const auditMessage = auditDetails.summary
        ? `${tableName} gelöscht: ${auditDetails.summary} von ${userEmail}`
        : `${tableName} gelöscht von ${userEmail} (ID: ${id})`;
      await writeAuditLog(dbPool, {
        level: 'audit',
        source: 'Löschung',
        message: auditMessage,
        details: auditDetails,
        userEmail
      });

      if (isPlanSyncEntity(tableName)) {
        broadcastPlanUpdate({
          scope: realtimeScope,
          entity: tableName,
          action: 'delete',
          recordId: id,
          actor,
        });
      }
      
      return res.json({ success: true });
    }
    
    // ===== BULK CREATE =====
    if (effectiveAction === 'bulkCreate') {
      if (!Array.isArray(data) || data.length === 0) return res.json([]);

      if (tableName === 'ShiftEntry' && creq.db) {
        const tenantId = creq.dbToken ? await resolveTenantIdFromToken(db, creq.dbToken) : null;
        const createdRows = [];
        const localRows = [];

        for (const item of data) {
          const doctorLink = await loadDoctorLink(dbPool, item.doctor_id);
          if (doctorLink && isCentralAbsencePosition(item.position)) {
            const prepared = {
              ...item,
              id: item.id || crypto.randomUUID(),
              created_date: item.created_date || new Date(),
              updated_date: item.updated_date || new Date(),
              created_by: item.created_by || creq.user?.email || 'system',
            };
            const created = await writeShiftEntryToCentralAbsence({
              tenantDb: dbPool,
              masterDb: db,
              tenantId: tenantId as string,
              shiftEntry: prepared,
              doctorId: doctorLink.doctorId,
              preserveId: true,
            });
            createdRows.push(created || prepared);
          } else {
            localRows.push(item);
          }
        }

        if (localRows.length > 0) {
          const processed = localRows.map((item: any) => ({
            ...item,
            id: item.id || crypto.randomUUID(),
            created_date: item.created_date || new Date(),
            updated_date: item.updated_date || new Date(),
            created_by: item.created_by || creq.user?.email || 'system',
          }));
          const allKeys = new Set();
          processed.forEach((item) => Object.keys(item).forEach((key) => allKeys.add(key)));
          const keys = Array.from(allKeys) as string[];
          // Bulk INSERT through Kysely in a single transaction (PR 1.5) — table
          // + column identifiers escaped centrally, whole batch atomic. NOTE:
          // this ShiftEntry-local branch intentionally does NOT filter keys via
          // getValidColumns (pre-existing behavior preserved); the generic
          // branch below does.
          await bulkInsert(dbPool, 'ShiftEntry', keys, processed);
          createdRows.push(...processed);
        }

        if (isPlanSyncEntity(tableName)) {
          broadcastPlanUpdate({
            scope: realtimeScope,
            entity: tableName,
            action: 'bulkCreate',
            recordCount: createdRows.length,
            actor,
          });
        }
        return res.json(createdRows);
      }
      
      const processed = data.map((item: any) => {
        if (!item.id) item.id = crypto.randomUUID();
        item.created_date = new Date();
        item.updated_date = new Date();
        item.created_by = creq.user?.email || 'system';
        return item;
      });
      
      // --- ShiftEntry Sentinel for bulk creates ---
      if (tableName === 'ShiftEntry') {
        const filtered = [];
        for (const item of processed) {
          if (item.date && item.position) {
            const conflict = await checkShiftConflict(dbPool, item, cacheKey);
            if (conflict) {
              console.warn(`[Sentinel] Blocked duplicate in bulkCreate: ${item.position} on ${item.date}`);
              continue; // Skip this item silently
            }
          }
          filtered.push(item);
        }
        if (filtered.length === 0) return res.json([]);
        processed.length = 0;
        processed.push(...filtered);

        // --- Auto-Time for bulk creates ---
        for (const item of processed) {
          if (item.doctor_id && item.position && !item.start_time) {
            try {
              const [docRows] = await dbPool.execute(
                `SELECT work_time_model_id FROM Doctor WHERE id = ? LIMIT 1`,
                [item.doctor_id]
              ) as unknown as [RowDataPacket[], RowDataPacket[]];
              const modelId = docRows[0]?.work_time_model_id;
              if (modelId) {
                const [wpRows] = await dbPool.execute(
                  `SELECT id FROM Workplace WHERE name = ? LIMIT 1`,
                  [item.position]
                ) as unknown as [RowDataPacket[], RowDataPacket[]];
                const workplaceId = wpRows[0]?.id;
                if (workplaceId) {
                  const [ruleRows] = await dbPool.execute(
                    `SELECT start_time, end_time, break_minutes FROM ShiftTimeRule WHERE workplace_id = ? AND work_time_model_id = ? LIMIT 1`,
                    [workplaceId, modelId]
                  ) as unknown as [RowDataPacket[], RowDataPacket[]];
                  if (ruleRows[0]) {
                    item.start_time = ruleRows[0].start_time;
                    item.end_time = ruleRows[0].end_time;
                    if (ruleRows[0].break_minutes) item.break_minutes = ruleRows[0].break_minutes;
                  }
                }
              }
            } catch (e) {
              console.warn(`[AutoTime] Bulk: Failed for ${item.position}: ${(e as Error).message}`);
            }
          }
        }
      }
      
      const allKeys = new Set();
      processed.forEach(item => Object.keys(item).forEach(k => allKeys.add(k)));
      
      let keys = Array.from(allKeys);
      
      const validColumns = await getValidColumns(dbPool, tableName, cacheKey);
      if (validColumns) {
        keys = keys.filter((k: any) => validColumns.includes(k));
      }
      
      if (keys.length === 0) {
        return res.status(400).json({ error: "No valid columns found for insert" });
      }

      // Insert each item individually inside a transaction so that a mid-batch
      // failure leaves no partial data. This prevents the UI from rolling back
      // an optimistic update while the server has already persisted some rows.
      // Bulk INSERT through Kysely in a single transaction (PR 1.5) — table +
      // column identifiers escaped centrally, whole batch atomic (a mid-batch
      // failure rolls back every row, matching the previous raw-connection
      // beginTransaction/commit/rollback loop). `keys` are already filtered via
      // getValidColumns above.
      await bulkInsert(dbPool, tableName, keys as string[], processed);

      if (isPlanSyncEntity(tableName)) {
        broadcastPlanUpdate({
          scope: realtimeScope,
          entity: tableName,
          action: 'bulkCreate',
          recordCount: processed.length,
          actor,
        });
      }
      
      return res.json(processed);
    }
    
    return res.status(400).json({ error: 'Unknown action' });
    
  } catch (error) {
    console.error("DB Proxy Error:", (error as Error).message, "Stack:", (error as Error).stack);
    console.error("Request body:", JSON.stringify(req.body || {}).substring(0, 500));
    
    // If this is an access denied error and we have a custom DB token, remove it from cache
    if (((error as CuraDbError).code === 'ER_ACCESS_DENIED_ERROR' || (error as CuraDbError).code === 'ER_DBACCESS_DENIED_ERROR') && creq.dbToken) {
      console.log("Removing invalid tenant pool from cache due to access denied error");
      removeTenantPool(creq.dbToken);
    }
    
    next(error);
  }
});

export default router;
