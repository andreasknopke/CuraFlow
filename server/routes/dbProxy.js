import express from 'express';
import { db } from '../index.js';
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
const COLUMNS_CACHE = {};

// HELPER: Convert JS value to MySQL value
const toSqlValue = (val) => {
  if (val === undefined) return null;
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

// HELPER: Get valid columns for entity
const getValidColumns = async (tableName) => {
  if (COLUMNS_CACHE[tableName]) return COLUMNS_CACHE[tableName];
  
  try {
    const [rows] = await db.execute(`SHOW COLUMNS FROM \`${tableName}\``);
    const columns = rows.map(r => r.Field);
    COLUMNS_CACHE[tableName] = columns;
    return columns;
  } catch (e) {
    console.error(`Failed to fetch columns for ${tableName}:`, e.message);
    if (e.message.includes("doesn't exist") || e.code === 'ER_NO_SUCH_TABLE') {
      return [];
    }
    return null;
  }
};

// ============ UNIFIED DB PROXY ENDPOINT ============
router.post('/', async (req, res, next) => {
  try {
    const { action, entity, table, data, id, query, sort, limit, skip } = req.body;
    const tableName = entity || table;
    
    if (!tableName) {
      return res.status(400).json({ error: 'Entity/table required' });
    }
    
    // Check if this is a public read operation
    const isPublicRead = PUBLIC_READ_TABLES.includes(tableName) && 
                         (action === 'list' || action === 'filter' || action === 'get');
    
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
    if (action === 'list' || action === 'filter') {
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
        const [rows] = await db.execute(sql, safeParams);
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
    if (action === 'get') {
      if (!id) return res.json(null);
      
      const [rows] = await db.execute(`SELECT * FROM \`${tableName}\` WHERE id = ?`, [id]);
      return res.json(rows[0] ? fromSqlRow(rows[0]) : null);
    }
    
    // ===== CREATE =====
    if (action === 'create') {
      if (!data.id) data.id = crypto.randomUUID();
      data.created_date = new Date();
      data.updated_date = new Date();
      data.created_by = req.user?.email || 'system';
      
      const validColumns = await getValidColumns(tableName);
      let keys = Object.keys(data);
      
      if (validColumns) {
        keys = keys.filter(k => validColumns.includes(k));
      }
      
      const values = keys.map(k => toSqlValue(data[k]));
      const placeholders = keys.map(() => '?').join(',');
      const sql = `INSERT INTO \`${tableName}\` (\`${keys.join('`,`')}\`) VALUES (${placeholders})`;
      
      const safeValues = values.map(v => v === undefined ? null : v);
      await db.execute(sql, safeValues);
      
      return res.json(data);
    }
    
    // ===== UPDATE =====
    if (action === 'update') {
      if (!id) return res.status(400).json({ error: "ID required for update" });
      
      data.updated_date = new Date();
      
      const validColumns = await getValidColumns(tableName);
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
      await db.execute(sql, safeValues);
      
      const [rows] = await db.execute(`SELECT * FROM \`${tableName}\` WHERE id = ?`, [id]);
      return res.json(rows[0] ? fromSqlRow(rows[0]) : null);
    }
    
    // ===== DELETE =====
    if (action === 'delete') {
      if (!id) return res.status(400).json({ error: "ID required for delete" });
      
      await db.execute(`DELETE FROM \`${tableName}\` WHERE id = ?`, [id]);
      return res.json({ success: true });
    }
    
    // ===== BULK CREATE =====
    if (action === 'bulkCreate') {
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
      
      const validColumns = await getValidColumns(tableName);
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
        await db.execute(sql, safeValues);
      }
      
      return res.json(processed);
    }
    
    return res.status(400).json({ error: 'Unknown action' });
    
  } catch (error) {
    console.error("DB Proxy Error:", error.message);
    next(error);
  }
});

export default router;
