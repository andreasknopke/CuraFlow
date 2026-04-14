import { db } from '../db/pool.js';
import { writeAuditLog } from '../routes/dbProxy/audit.js';

const ADMIN_MUTATION_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const SENSITIVE_KEY_PATTERN = /(password|token|secret|authorization)/i;

const sanitizeAuditValue = (value, key = '') => {
  if (value === null || value === undefined) {
    return value;
  }

  if (SENSITIVE_KEY_PATTERN.test(key)) {
    return '[REDACTED]';
  }

  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeAuditValue(entry, key));
  }

  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([entryKey, entryValue]) => [
        entryKey,
        sanitizeAuditValue(entryValue, entryKey),
      ]),
    );
  }

  if (typeof value === 'string' && value.length > 500) {
    return `${value.slice(0, 500)}…`;
  }

  return value;
};

export const createAdminAuditMiddleware =
  (source = 'Admin') =>
  (req, res, next) => {
    if (!ADMIN_MUTATION_METHODS.has(req.method)) {
      next();
      return;
    }

    const startedAt = Date.now();

    res.on('finish', () => {
      if (res.statusCode >= 400) {
        return;
      }

      const dbPool = req.db || db;
      const userEmail = req.user?.email || 'unknown';

      void writeAuditLog(dbPool, {
        level: 'audit',
        source,
        message: `${req.method} ${req.originalUrl} by ${userEmail}`,
        details: {
          method: req.method,
          path: req.originalUrl,
          statusCode: res.statusCode,
          durationMs: Date.now() - startedAt,
          params: sanitizeAuditValue(req.params),
          query: sanitizeAuditValue(req.query),
          body: sanitizeAuditValue(req.body),
          target: req.dbToken ? 'tenant' : 'master',
        },
        userEmail,
      });
    });

    next();
  };
