import express from 'express';
import { authMiddleware, adminMiddleware } from './auth.js';
import toolsRouter from './admin/tools.js';
import systemRouter from './admin/system.js';
import migrationsRouter from './admin/migrations.js';
import dbTokensRouter from './admin/dbTokens.js';
import { createAdminAuditMiddleware } from '../middleware/adminAudit.js';

const router = express.Router();

router.use(toolsRouter);
router.use(authMiddleware);
router.use(adminMiddleware);
router.use(createAdminAuditMiddleware('Admin-Operation'));
router.use(systemRouter);
router.use(migrationsRouter);
router.use(dbTokensRouter);

export default router;
