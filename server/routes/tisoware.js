/**
 * Tisoware API Routes
 *
 * DB-Explorer for the Tisoware time-tracking SQL Server database.
 * All routes require master/ admin authentication.
 *
 * Endpoints:
 *   GET  /api/master/tisoware/status       — Connection status
 *   GET  /api/master/tisoware/tables        — List all tables
 *   GET  /api/master/tisoware/tables/:schema/:table/columns — Columns for a table
 *   GET  /api/master/tisoware/tables/:schema/:table/sample  — Sample rows
 *   POST /api/master/tisoware/query         — Run arbitrary SELECT query
 */

import express from 'express';
import {
  getConnectionStatus,
  testConnection,
  listTables,
  listColumns,
  sampleTable,
  runQuery,
  isMockMode,
} from '../utils/tisowareDataSource.js';
import { authMiddleware, adminMiddleware } from './auth.js';

const router = express.Router();

// All tisoware routes require master-level auth
router.use(authMiddleware);
router.use(adminMiddleware);

// ─── Connection status ────────────────────────────────────────────────────────

/**
 * GET /api/master/tisoware/status
 * Returns whether the Tisoware connection is working (always succeeds).
 */
router.get('/status', async (req, res, next) => {
  try {
    const status = await getConnectionStatus();
    res.json(status);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/master/tisoware/test
 * Actively tests the connection (may fail).
 */
router.get('/test', async (req, res, next) => {
  try {
    const result = await testConnection();
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * Gets whether mock mode is active.
 */
router.get('/mock', async (req, res, next) => {
  try {
    res.json({ mock: isMockMode() });
  } catch (err) {
    next(err);
  }
});

// ─── Schema exploration ───────────────────────────────────────────────────────

/**
 * GET /api/master/tisoware/tables
 * List all user tables in the Tisoware database.
 */
router.get('/tables', async (req, res, next) => {
  try {
    const tables = await listTables();
    res.json({ tables });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/master/tisoware/tables/:schema/:table/columns
 * List columns for a specific table.
 */
router.get('/tables/:schema/:table/columns', async (req, res, next) => {
  try {
    const { schema, table } = req.params;
    const columns = await listColumns(schema, table);
    res.json({ columns });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/master/tisoware/tables/:schema/:table/sample
 * Return first 50 rows from a table.
 */
router.get('/tables/:schema/:table/sample', async (req, res, next) => {
  try {
    const { schema, table } = req.params;
    const result = await sampleTable(schema, table);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// ─── Custom query ─────────────────────────────────────────────────────────────

/**
 * POST /api/master/tisoware/query
 * Run an arbitrary SELECT / WITH query (read-only).
 * Body: { query: string }
 */
router.post('/query', async (req, res, next) => {
  try {
    const { query } = req.body;

    if (!query || typeof query !== 'string' || query.trim().length === 0) {
      return res.status(400).json({ error: 'Query darf nicht leer sein' });
    }

    if (query.trim().length > 10000) {
      return res.status(400).json({ error: 'Query zu lang (max. 10.000 Zeichen)' });
    }

    const result = await runQuery(query.trim());
    res.json(result);
  } catch (err) {
    if (err.status === 400) {
      return res.status(400).json({ error: err.message });
    }
    next(err);
  }
});

export default router;
