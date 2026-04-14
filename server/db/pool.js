import { createPool } from 'mysql2/promise';
import config from '../config.js';
import { parseDbToken } from '../utils/crypto.js';
import { authorizeTenantToken } from '../utils/tenantAccess.js';
import { verifyAccessToken } from '../utils/authTokens.js';

const DB_RETRY_DELAYS_MS = [250, 750];
const TRANSIENT_DB_ERROR_CODES = new Set([
  'PROTOCOL_CONNECTION_LOST',
  'PROTOCOL_ENQUEUE_AFTER_FATAL_ERROR',
  'PROTOCOL_ENQUEUE_AFTER_QUIT',
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'EPIPE',
  'ER_CON_COUNT_ERROR',
  'ER_LOCK_DEADLOCK',
  'ER_LOCK_WAIT_TIMEOUT',
]);
const TRANSIENT_DB_ERROR_PATTERNS = [
  /server has gone away/i,
  /lost connection/i,
  /connection.*closed/i,
  /closed state/i,
  /read ECONNRESET/i,
  /connect ETIMEDOUT/i,
  /can't add new command when connection is in closed state/i,
  /can't add new command when connection is closed/i,
  /the client was disconnected by the server/i,
];
const DATABASE_ERROR_PATTERNS = [
  /mysql/i,
  /sql/i,
  /database/i,
  /unknown column/i,
  /doesn't exist/i,
  /table .* doesn't exist/i,
  /ER_[A-Z_]+/i,
  ...TRANSIENT_DB_ERROR_PATTERNS,
];

const tenantPools = new Map();
const migratedTenants = new Set();
const migrationInFlight = new Map();

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const isTransientDbError = (error) => {
  if (!error) return false;

  if (TRANSIENT_DB_ERROR_CODES.has(error.code)) {
    return true;
  }

  const message = `${error.message || ''} ${error.sqlMessage || ''}`.trim();
  return TRANSIENT_DB_ERROR_PATTERNS.some((pattern) => pattern.test(message));
};

export const isDatabaseError = (error) => {
  if (!error) return false;
  if (error.isDatabaseError) return true;
  if (isTransientDbError(error)) return true;
  if (typeof error.code === 'string' && error.code.startsWith('ER_')) return true;
  if (error.sql || error.sqlMessage || error.sqlState) return true;

  const message = `${error.message || ''} ${error.sqlMessage || ''}`.trim();
  return DATABASE_ERROR_PATTERNS.some((pattern) => pattern.test(message));
};

const annotateDatabaseError = (error, meta = {}) => {
  if (!error || typeof error !== 'object') return error;

  error.isDatabaseError = true;
  if (meta.poolLabel) {
    error.poolLabel = meta.poolLabel;
  }
  if (meta.retryable !== undefined) {
    error.retryable = meta.retryable;
  } else if (error.retryable === undefined) {
    error.retryable = isTransientDbError(error);
  }

  return error;
};

const getSqlPreview = (sql) => {
  if (typeof sql !== 'string') return 'n/a';
  return sql.replace(/\s+/g, ' ').trim().slice(0, 180);
};

const wrapPoolWithRetry = (pool, { poolLabel, onFinalFailure } = {}) => {
  if (!pool || pool.__curaflowRetryWrapped) {
    return pool;
  }

  const wrapMethod = (methodName) => {
    if (typeof pool[methodName] !== 'function') {
      return;
    }

    const originalMethod = pool[methodName].bind(pool);
    pool[methodName] = async (...args) => {
      let lastError;

      for (let attempt = 1; attempt <= DB_RETRY_DELAYS_MS.length + 1; attempt += 1) {
        try {
          return await originalMethod(...args);
        } catch (error) {
          lastError = error;
          const databaseError = isDatabaseError(error);
          const transient = isTransientDbError(error);
          const canRetry = transient && attempt <= DB_RETRY_DELAYS_MS.length;

          if (!databaseError) {
            throw error;
          }

          annotateDatabaseError(error, {
            poolLabel,
            retryable: canRetry,
          });

          const logPrefix = canRetry ? '[DB][Retry]' : '[DB][Failure]';
          const logger = canRetry ? console.warn : console.error;
          logger(
            `${logPrefix} ${poolLabel || 'default'} ${methodName} attempt ${attempt}/${DB_RETRY_DELAYS_MS.length + 1} failed`,
            {
              code: error.code || null,
              message: error.message,
              sql: getSqlPreview(args[0]),
            },
          );

          if (canRetry) {
            await sleep(DB_RETRY_DELAYS_MS[attempt - 1]);
            continue;
          }

          if (typeof onFinalFailure === 'function') {
            try {
              await onFinalFailure(error);
            } catch (cleanupError) {
              console.error(
                '[DB][Cleanup] Failed to cleanup pool after error:',
                cleanupError.message,
              );
            }
          }

          throw error;
        }
      }

      throw lastError;
    };
  };

  wrapMethod('execute');
  wrapMethod('query');
  Object.defineProperty(pool, '__curaflowRetryWrapped', {
    value: true,
    configurable: false,
    enumerable: false,
  });
  return pool;
};

export const db = wrapPoolWithRetry(
  createPool({
    host: config.db.host,
    port: config.db.port,
    user: config.db.user,
    password: config.db.password,
    database: config.db.database,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    dateStrings: true,
    timezone: '+00:00',
  }),
  { poolLabel: 'default' },
);

export const removeTenantPool = (dbToken) => {
  if (tenantPools.has(dbToken)) {
    const pool = tenantPools.get(dbToken);
    try {
      pool.end();
    } catch (e) {
      // Ignore cleanup failures while evicting stale tenant pools.
    }
    tenantPools.delete(dbToken);
    migratedTenants.delete(dbToken);
    migrationInFlight.delete(dbToken);
    console.log('Removed tenant pool from cache');
  }
};

export const getTenantDb = (dbToken) => {
  if (!dbToken) return db;

  if (tenantPools.has(dbToken)) {
    return tenantPools.get(dbToken);
  }

  try {
    const tenantConfig = parseDbToken(dbToken);

    if (!tenantConfig || !tenantConfig.host || !tenantConfig.user || !tenantConfig.database) {
      console.error('Invalid DB token: missing required fields');
      return db;
    }

    const tenantPool = wrapPoolWithRetry(
      createPool({
        host: tenantConfig.host,
        port: parseInt(tenantConfig.port || '3306', 10),
        user: tenantConfig.user,
        password: tenantConfig.password,
        database: tenantConfig.database,
        ssl: tenantConfig.ssl || undefined,
        waitForConnections: true,
        connectionLimit: 5,
        queueLimit: 0,
        dateStrings: true,
        timezone: '+00:00',
      }),
      {
        poolLabel: `tenant:${tenantConfig.host}/${tenantConfig.database}`,
        onFinalFailure: async (error) => {
          if (dbToken && (isTransientDbError(error) || error.code === 'ER_ACCESS_DENIED_ERROR')) {
            removeTenantPool(dbToken);
          }
        },
      },
    );

    tenantPools.set(dbToken, tenantPool);
    console.log(`Created new tenant pool for: ${tenantConfig.host}/${tenantConfig.database}`);

    return tenantPool;
  } catch (error) {
    console.error('Failed to parse DB token:', error.message);
    return db;
  }
};

export const tenantDbMiddleware = async (req, res, next) => {
  const dbTokenHeader = req.headers['x-db-token'];
  const dbToken = Array.isArray(dbTokenHeader) ? dbTokenHeader[0] : dbTokenHeader;

  req.db = db;
  req.dbToken = dbToken || null;
  req.isCustomDb = false;

  if (!dbToken) {
    next();
    return;
  }

  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Nicht autorisiert' });
    return;
  }

  const user = verifyAccessToken(authHeader.substring(7));
  if (!user?.sub) {
    res.status(401).json({ error: 'Token ungültig oder abgelaufen' });
    return;
  }

  const authorization = await authorizeTenantToken(db, user.sub, dbToken);
  if (!authorization.allowed) {
    res.status(authorization.status).json({ error: authorization.error });
    return;
  }

  req.user = req.user || user;
  req.db = getTenantDb(dbToken);
  req.dbTokenId = authorization.tokenRecord?.id || null;
  req.isCustomDb = req.db !== db;

  if (req.isCustomDb && !migratedTenants.has(dbToken)) {
    try {
      if (!migrationInFlight.has(dbToken)) {
        const { runTenantMigrations } = await import('../utils/tenantMigrations.js');
        const promise = runTenantMigrations(req.db, dbToken)
          .then((results) => {
            const errors = results.filter((result) => result.status === 'error');
            if (errors.length > 0) {
              console.warn(
                `[Auto-Migration] Tenant migration completed with ${errors.length} errors:`,
                errors,
              );
            } else {
              console.log(`[Auto-Migration] Tenant migrations OK (${results.length} checked)`);
            }
            migratedTenants.add(dbToken);
          })
          .catch((error) => {
            console.error('[Auto-Migration] Failed:', error.message);
          })
          .finally(() => {
            migrationInFlight.delete(dbToken);
          });
        migrationInFlight.set(dbToken, promise);
      }
      await migrationInFlight.get(dbToken);
    } catch (error) {
      console.error('[Auto-Migration] Unexpected error:', error.message);
    }
  }

  next();
};
