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
  'DemoSetting'
];

// Cache for table columns to avoid "Unknown column" errors
// Key format: "dbToken:tableName" to support multi-tenant
const COLUMNS_CACHE = {};

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
      'acknowledged', 'is_active'
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

// ============ UNIFIED DB PROXY ENDPOINT ============
router.post('/', async (req, res, next) => {
  try {
    const { action, operation, entity, table, data, id, query, sort, limit, skip } = req.body;
    const effectiveAction = action || operation; // Support both 'action' and 'operation' keys
    const tableName = entity || table;
    
    // Get the database pool (set by tenantDbMiddleware)
    const dbPool = req.db || db;
    const cacheKey = req.headers['x-db-token'] || 'default';
    
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
      
      await dbPool.execute(`DELETE FROM \`${tableName}\` WHERE id = ?`, [id]);
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
