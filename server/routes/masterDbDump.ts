/**
 * MasterDB Dump Route
 *
 * Provides a download endpoint for a SQL dump of all non-empty tables
 * in the CuraFlow MasterDB. Used for comparison with external databases
 * (e.g., Tisoware) as part of data synchronization efforts.
 *
 * GET /api/master/database/dump — SQL dump download
 */

import express from 'express';
import { db } from '../index.js';
import { authMiddleware } from './auth.js';
import { requirePermission } from '../utils/permissions.js';
import { generateMasterDbDump } from '../utils/masterDbDump.js';

const router = express.Router();

// All dump routes require master auth with system management permission
router.use(authMiddleware);
router.use(requirePermission('can_manage_system'));

/**
 * GET /api/master/database/dump
 * Generates a SQL dump of all non-empty MasterDB tables with up to 300
 * representative rows per table (latest rows) and downloads it as a .sql file.
 */
router.get('/dump', async (req, res, next) => {
  try {
    const sql = await generateMasterDbDump(db);

    const filename = `curaflow_masterdb_dump_${new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19)}.sql`;

    res.setHeader('Content-Type', 'application/sql; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', Buffer.byteLength(sql, 'utf-8'));
    res.send(sql);
  } catch (err) {
    console.error('[MasterDB Dump] Error generating dump:', err.message);
    next(err);
  }
});

export default router;
