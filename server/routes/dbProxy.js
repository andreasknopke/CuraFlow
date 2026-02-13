import express from 'express';
import { db, removeTenantPool } from '../index.js';
import { authMiddleware } from './auth.js';
import crypto from 'crypto';

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

// Cache for table columns to avoid "Unknown column" errors
// Key format: "dbToken:tableName" to support multi-tenant
const COLUMNS_CACHE = {};

// Clear cache for specific tables (used after migrations)
export const clearColumnsCache = (tableNames = null, cacheKey = null) => {
  if (!tableNames) {
    // Clear entire cache
    for (const key in COLUMNS_CACHE) {
      delete COLUMNS_CACHE[key];
    }
    console.log('[dbProxy] Cleared entire columns cache');
    return;
  }
  
  // Clear specific tables
  for (const key in COLUMNS_CACHE) {
    const matchesTable = tableNames.some(t => key.endsWith(`:${t}`));
    const matchesCacheKey = !cacheKey || key.startsWith(`${cacheKey}:`);
    if (matchesTable && matchesCacheKey) {
      delete COLUMNS_CACHE[key];
      console.log(`[dbProxy] Cleared cache for: ${key}`);
    }
  }
};

// HELPER: Convert JS value to MySQL value
const toSqlValue = (val) => {
  if (val === undefined) return null;
  if (val === '') return null; // Empty strings become NULL (important for date fields)
  if (typeof val === 'number' && isNaN(val)) return null;
  if (typeof val === 'object' && val !== null && !(val instanceof Date)) {
    return JSON.stringify(val);
  }
  if (val instanceof Date) {
    return val.toISOString().slice(0, 19).replace('T', ' ');
  }
  return val;
};

// HELPER: Parse MySQL row to JS object
const fromSqlRow = (row) => {
  if (!row) return null;
  const res = { ...row };
  
  const jsonFields = ['active_days'];
  
  for (const key in res) {
    if (jsonFields.includes(key) && typeof res[key] === 'string') {
      try {
        res[key] = JSON.parse(res[key]);
      } catch (e) {}
    }
    
    const boolFields = [
      'receive_email_notifications', 'exclude_from_staffing_plan', 
      'user_viewed', 'auto_off', 'show_in_service_plan', 
      'allows_rotation_concurrently', 'allows_consecutive_days', 
      'acknowledged', 'is_active', 'is_specialist',
      'timeslots_enabled', 'spans_midnight', 'affects_availability',
      'can_do_foreground_duty', 'can_do_background_duty', 'excluded_from_statistics',
      'is_mandatory'
    ];
    if (boolFields.includes(key)) {
      res[key] = !!res[key];
    }
  }
  return res;
};

// HELPER: Get valid columns for entity (multi-tenant aware)
const getValidColumns = async (dbPool, tableName, cacheKey) => {
  const fullCacheKey = `${cacheKey}:${tableName}`;
  if (COLUMNS_CACHE[fullCacheKey]) return COLUMNS_CACHE[fullCacheKey];
  
  try {
    const [rows] = await dbPool.execute(`SHOW COLUMNS FROM \`${tableName}\``);
    const columns = rows.map(r => r.Field);
    COLUMNS_CACHE[fullCacheKey] = columns;
    return columns;
  } catch (e) {
    console.error(`Failed to fetch columns for ${tableName}:`, e.message);
    if (e.message.includes("doesn't exist") || e.code === 'ER_NO_SUCH_TABLE') {
      return [];
    }
    return null;
  }
};

// Handle GET requests with helpful error
router.get('/', (req, res) => {
  res.status(405).json({ 
    error: 'Method not allowed. Use POST with { action, entity, ... }',
    hint: 'GET requests are not supported on /api/db'
  });
});

// Auto-create TeamRole table if it doesn't exist (for multi-tenant support)
const ensureTeamRoleTable = async (dbPool, cacheKey) => {
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
      await dbPool.execute(`ALTER TABLE TeamRole ADD COLUMN IF NOT EXISTS can_do_foreground_duty BOOLEAN NOT NULL DEFAULT TRUE`);
      await dbPool.execute(`ALTER TABLE TeamRole ADD COLUMN IF NOT EXISTS can_do_background_duty BOOLEAN NOT NULL DEFAULT FALSE`);
      await dbPool.execute(`ALTER TABLE TeamRole ADD COLUMN IF NOT EXISTS excluded_from_statistics BOOLEAN NOT NULL DEFAULT FALSE`);
      await dbPool.execute(`ALTER TABLE TeamRole ADD COLUMN IF NOT EXISTS description VARCHAR(255) DEFAULT NULL`);
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
      console.warn('TeamRole defaults migration update skipped:', updateErr.message);
    }

    // Seed defaults if empty
    const [existing] = await dbPool.execute('SELECT COUNT(*) as cnt FROM TeamRole');
    if (existing[0].cnt === 0) {
      const defaultRoles = [
        { name: 'Chefarzt', priority: 0, is_specialist: true, can_do_foreground_duty: false, can_do_background_duty: true, excluded_from_statistics: false, description: 'Oberste Führungsebene' },
        { name: 'Oberarzt', priority: 1, is_specialist: true, can_do_foreground_duty: false, can_do_background_duty: true, excluded_from_statistics: false, description: 'Kann Hintergrunddienste übernehmen' },
        { name: 'Facharzt', priority: 2, is_specialist: true, can_do_foreground_duty: true, can_do_background_duty: true, excluded_from_statistics: false, description: 'Kann alle Dienste übernehmen' },
        { name: 'Assistenzarzt', priority: 3, is_specialist: false, can_do_foreground_duty: true, can_do_background_duty: false, excluded_from_statistics: false, description: 'Kann Vordergrunddienste übernehmen' },
        { name: 'Nicht-Radiologe', priority: 4, is_specialist: false, can_do_foreground_duty: false, can_do_background_duty: false, excluded_from_statistics: true, description: 'Wird in Statistiken nicht gezählt' },
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
    console.error('Failed to ensure TeamRole table:', err.message);
    COLUMNS_CACHE[tableCheckKey] = true; // Don't retry on error
  }
};

// Auto-create Qualification tables if they don't exist (for multi-tenant support)
const ensureQualificationTables = async (dbPool, cacheKey) => {
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
        \`order\` INT NOT NULL DEFAULT 99,
        created_date DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
        updated_date DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
        created_by VARCHAR(255) DEFAULT 'system'
      )
    `);
    
    await dbPool.execute(`
      CREATE TABLE IF NOT EXISTS DoctorQualification (
        id VARCHAR(255) PRIMARY KEY,
        doctor_id VARCHAR(255) NOT NULL,
        qualification_id VARCHAR(255) NOT NULL,
        granted_date DATE DEFAULT NULL,
        expiry_date DATE DEFAULT NULL,
        notes VARCHAR(255) DEFAULT NULL,
        created_date DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
        updated_date DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
        created_by VARCHAR(255) DEFAULT 'system',
        UNIQUE KEY uq_doctor_qual (doctor_id, qualification_id),
        INDEX idx_dq_doctor (doctor_id),
        INDEX idx_dq_qualification (qualification_id)
      )
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
      )
    `);

    // Add is_excluded column if table already existed without it
    try {
      await dbPool.execute(`ALTER TABLE WorkplaceQualification ADD COLUMN IF NOT EXISTS is_excluded BOOLEAN NOT NULL DEFAULT FALSE`);
      // Clear cache so new column is recognized
      const wqCacheKey = `${cacheKey}:WorkplaceQualification`;
      delete COLUMNS_CACHE[wqCacheKey];
    } catch (alterErr) {
      // Column might already exist
    }
    
    COLUMNS_CACHE[tableCheckKey] = true;
    console.log('✅ Qualification tables ensured for tenant');
  } catch (err) {
    console.error('Failed to ensure Qualification tables:', err.message);
    COLUMNS_CACHE[tableCheckKey] = true;
  }
};

// Auto-add min_staff and optimal_staff columns to Workplace if missing (for auto-fill engine)
const ensureWorkplaceStaffColumns = async (dbPool, cacheKey) => {
  const checkKey = `${cacheKey}:Workplace:staff_cols_checked`;
  if (COLUMNS_CACHE[checkKey]) return;

  try {
    await dbPool.execute(`ALTER TABLE Workplace ADD COLUMN IF NOT EXISTS min_staff INT DEFAULT 1`);
    await dbPool.execute(`ALTER TABLE Workplace ADD COLUMN IF NOT EXISTS optimal_staff INT DEFAULT 1`);
    // Clear cached columns so the new columns are recognized
    const colCacheKey = `${cacheKey}:Workplace`;
    delete COLUMNS_CACHE[colCacheKey];
  } catch (err) {
    // Columns might already exist or table might not exist yet — both are fine
    if (err.code !== 'ER_DUP_FIELDNAME') {
      console.warn('[dbProxy] ensureWorkplaceStaffColumns:', err.message);
    }
  }
  COLUMNS_CACHE[checkKey] = true;
};

// ============ AUDIT LOG HELPER ============
// Writes an audit entry to the SystemLog table for UI visibility
export const writeAuditLog = async (dbPool, { level = 'audit', source, message, details, userEmail }) => {
  try {
    const id = crypto.randomUUID();
    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
    await dbPool.execute(
      `INSERT INTO SystemLog (id, level, source, message, details, created_date, updated_date, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, level, source, message, typeof details === 'string' ? details : JSON.stringify(details), now, now, userEmail || 'system']
    );
  } catch (err) {
    // Don't let audit logging failures break the main operation
    console.error('[AUDIT] Failed to write audit log to SystemLog table:', err.message);
  }
};

// ============ UNIFIED DB PROXY ENDPOINT ============
router.post('/', async (req, res, next) => {
  try {
    const { action, operation, entity, table, data, id, query, sort, limit, skip } = req.body;
    const effectiveAction = action || operation; // Support both 'action' and 'operation' keys
    const tableName = entity || table;
    
    // Get the database pool (set by tenantDbMiddleware)
    const dbPool = req.db || db;
    const cacheKey = req.headers['x-db-token'] || 'default';
    
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
    
    if (!tableName) {
      return res.status(400).json({ error: 'Entity/table required' });
    }
    
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
        const decoded = jwt.default.verify(token, process.env.JWT_SECRET);
        req.user = decoded; // Set user from token
      } catch (err) {
        return res.status(401).json({ error: 'Token ungültig' });
      }
    }
    
    // ===== LIST / FILTER =====
    if (effectiveAction === 'list' || effectiveAction === 'filter') {
      let sql = `SELECT * FROM \`${tableName}\``;
      const params = [];
      
      const filters = query || req.body.filters || {};
      
      if (filters && Object.keys(filters).length > 0) {
        const clauses = [];
        for (const [key, val] of Object.entries(filters)) {
          if (val && typeof val === 'object' && !Array.isArray(val)) {
            if (val.$gte !== undefined) {
              clauses.push(`\`${key}\` >= ?`);
              params.push(toSqlValue(val.$gte));
            }
            if (val.$lte !== undefined) {
              clauses.push(`\`${key}\` <= ?`);
              params.push(toSqlValue(val.$lte));
            }
          } else {
            clauses.push(`\`${key}\` = ?`);
            params.push(toSqlValue(val));
          }
        }
        if (clauses.length > 0) {
          sql += ` WHERE ${clauses.join(' AND ')}`;
        }
      }
      
      if (sort) {
        if (typeof sort === 'string') {
          const desc = sort.startsWith('-');
          const field = desc ? sort.substring(1) : sort;
          sql += ` ORDER BY \`${field}\` ${desc ? 'DESC' : 'ASC'}`;
          
          if (field !== 'id') {
            sql += `, \`id\` ASC`;
          }
        }
      } else {
        sql += ` ORDER BY \`id\` ASC`;
      }
      
      if (limit && !isNaN(parseInt(limit))) {
        sql += ` LIMIT ${parseInt(limit)}`;
        if (skip && !isNaN(parseInt(skip))) {
          sql += ` OFFSET ${parseInt(skip)}`;
        }
      }
      
      try {
        const safeParams = params.map(p => p === undefined ? null : p);
        const [rows] = await dbPool.execute(sql, safeParams);
        return res.json(rows.map(fromSqlRow));
      } catch (err) {
        console.error("List Execute Error:", err.message, "SQL:", sql);
        if (err.message.includes("doesn't exist") || err.code === 'ER_NO_SUCH_TABLE') {
          console.warn(`Table ${tableName} doesn't exist, returning empty array`);
          return res.json([]);
        }
        throw err;
      }
    }
    
    // ===== GET =====
    if (effectiveAction === 'get') {
      if (!id) return res.json(null);
      
      const [rows] = await dbPool.execute(`SELECT * FROM \`${tableName}\` WHERE id = ?`, [id]);
      return res.json(rows[0] ? fromSqlRow(rows[0]) : null);
    }
    
    // ===== CREATE =====
    if (effectiveAction === 'create') {
      if (!data.id) data.id = crypto.randomUUID();
      data.created_date = new Date();
      data.updated_date = new Date();
      data.created_by = req.user?.email || 'system';
      
      const validColumns = await getValidColumns(dbPool, tableName, cacheKey);
      let keys = Object.keys(data);
      
      if (validColumns && validColumns.length > 0) {
        keys = keys.filter(k => validColumns.includes(k));
      }
      
      if (keys.length === 0) {
        console.error(`CREATE failed: No valid columns for ${tableName}. Data keys:`, Object.keys(data), "Valid columns:", validColumns);
        return res.status(500).json({ error: `No valid columns found for table ${tableName}` });
      }
      
      const values = keys.map(k => toSqlValue(data[k]));
      const placeholders = keys.map(() => '?').join(',');
      const sql = `INSERT INTO \`${tableName}\` (\`${keys.join('`,`')}\`) VALUES (${placeholders})`;
      
      try {
        const safeValues = values.map(v => v === undefined ? null : v);
        await dbPool.execute(sql, safeValues);
        return res.json(data);
      } catch (err) {
        console.error(`CREATE error for ${tableName}:`, err.message, "SQL:", sql);
        throw err;
      }
    }
    
    // ===== UPDATE =====
    if (effectiveAction === 'update') {
      if (!id) return res.status(400).json({ error: "ID required for update" });
      
      data.updated_date = new Date();
      
      const validColumns = await getValidColumns(dbPool, tableName, cacheKey);
      let keys = Object.keys(data).filter(k => k !== 'id');
      
      if (validColumns) {
        keys = keys.filter(k => validColumns.includes(k));
      }
      
      if (keys.length === 0) return res.json({ success: true });
      
      const sets = keys.map(k => `\`${k}\` = ?`).join(',');
      const values = keys.map(k => toSqlValue(data[k]));
      values.push(id);
      
      const sql = `UPDATE \`${tableName}\` SET ${sets} WHERE id = ?`;
      const safeValues = values.map(v => v === undefined ? null : v);
      await dbPool.execute(sql, safeValues);
      
      const [rows] = await dbPool.execute(`SELECT * FROM \`${tableName}\` WHERE id = ?`, [id]);
      return res.json(rows[0] ? fromSqlRow(rows[0]) : null);
    }
    
    // ===== DELETE =====
    if (effectiveAction === 'delete') {
      if (!id) return res.status(400).json({ error: "ID required for delete" });
      
      // Fetch record before deletion for logging
      const [existingRows] = await dbPool.execute(`SELECT * FROM \`${tableName}\` WHERE id = ?`, [id]);
      const deletedRecord = existingRows[0] ? fromSqlRow(existingRows[0]) : null;
      
      await dbPool.execute(`DELETE FROM \`${tableName}\` WHERE id = ?`, [id]);
      
      // Write audit to SystemLog table
      const userEmail = req.user?.email || 'unknown';
      const timestamp = new Date().toISOString();
      await writeAuditLog(dbPool, {
        level: 'audit',
        source: 'Löschung',
        message: `${tableName} gelöscht von ${userEmail} (ID: ${id})`,
        details: { table: tableName, record_id: id, deleted_data: deletedRecord, timestamp },
        userEmail
      });
      
      return res.json({ success: true });
    }
    
    // ===== BULK CREATE =====
    if (effectiveAction === 'bulkCreate') {
      if (!Array.isArray(data) || data.length === 0) return res.json([]);
      
      const processed = data.map(item => {
        if (!item.id) item.id = crypto.randomUUID();
        item.created_date = new Date();
        item.updated_date = new Date();
        item.created_by = req.user?.email || 'system';
        return item;
      });
      
      const allKeys = new Set();
      processed.forEach(item => Object.keys(item).forEach(k => allKeys.add(k)));
      
      let keys = Array.from(allKeys);
      
      const validColumns = await getValidColumns(dbPool, tableName, cacheKey);
      if (validColumns) {
        keys = keys.filter(k => validColumns.includes(k));
      }
      
      if (keys.length === 0) {
        return res.status(400).json({ error: "No valid columns found for insert" });
      }
      
      // Insert each item individually to avoid MySQL2 bulk insert syntax issues
      for (const item of processed) {
        const values = keys.map(k => toSqlValue(item[k]));
        const placeholders = keys.map(() => '?').join(',');
        const sql = `INSERT INTO \`${tableName}\` (\`${keys.join('`,`')}\`) VALUES (${placeholders})`;
        const safeValues = values.map(v => v === undefined ? null : v);
        await dbPool.execute(sql, safeValues);
      }
      
      return res.json(processed);
    }
    
    return res.status(400).json({ error: 'Unknown action' });
    
  } catch (error) {
    console.error("DB Proxy Error:", error.message, "Stack:", error.stack);
    console.error("Request body:", JSON.stringify(req.body || {}).substring(0, 500));
    
    // If this is an access denied error and we have a custom DB token, remove it from cache
    if (error.code === 'ER_ACCESS_DENIED_ERROR' && req.dbToken) {
      console.log("Removing invalid tenant pool from cache due to access denied error");
      removeTenantPool(req.dbToken);
    }
    
    next(error);
  }
});

export default router;
