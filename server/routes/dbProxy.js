import express from 'express';
import { handleDbProxyRequest } from './dbProxy/operations.js';

export { clearColumnsCache } from './dbProxy/cache.js';
export { writeAuditLog } from './dbProxy/audit.js';

const router = express.Router();

router.get('/', (req, res) => {
  res.status(405).json({
    error: 'Method not allowed. Use POST with { action, entity, ... }',
    hint: 'GET requests are not supported on /api/db',
  });
});

router.post('/', handleDbProxyRequest);

export default router;
