/**
 * Kysely query-builder adapter for the existing mysql2/promise pools.
 *
 * Purpose: route dynamic-identifier SQL through Kysely so identifier escaping
 * happens in ONE place (the structural fix for SQL-injection finding S1).
 *
 * The pool is NOT recreated: the bridge borrows connections from the SAME pool
 * the rest of the route uses (req.db / the master db), preserving tenant
 * isolation. A repo that accidentally imported the master pool would query the
 * wrong tenant, so call sites must always pass the request-scoped pool.
 *
 * IMPORTANT — the mysql2/promise ↔ callback bridge:
 * Kysely's MysqlDialect expects the callback-style `mysql2` API. CuraFlow uses
 * `mysql2/promise`, whose pool/connection methods are promise-only and IGNORE
 * callbacks — so passing a promise pool straight to Kysely hangs forever.
 * `bridgePool` adapts the promise API to the callback API Kysely requires.
 */

import { Kysely, MysqlDialect, type MysqlPool } from 'kysely';
import type { Pool, PoolConnection } from 'mysql2/promise';

type Callback = (err: Error | null, result?: unknown) => void;

interface BridgedConnection {
  query(sql: string, params: unknown[], cb: Callback): void;
  execute(sql: string, params: unknown[], cb: Callback): void;
  release(): void;
}

interface BridgedPool {
  getConnection(callback: (err: Error | null, conn?: BridgedConnection) => void): void;
  end(callback: (err?: Error | null) => void): void;
}

function bridgePool(promisePool: Pool): BridgedPool {
  return {
    getConnection(callback) {
      promisePool.getConnection().then((raw: PoolConnection) => {
        callback(null, {
          // mysql2/promise resolves to [rows, fields]; Kysely wants just rows.
          query(sql: string, params: unknown[], cb: Callback) {
            raw.query(sql, params).then(([rows]) => cb(null, rows)).catch(cb);
          },
          execute(sql: string, params: unknown[], cb: Callback) {
            raw.execute(sql, params).then(([rows]) => cb(null, rows)).catch(cb);
          },
          release() { raw.release(); },
        });
      }).catch((err: Error) => callback(err));
    },
    end(callback) {
      promisePool.end().then(() => callback()).catch(callback);
    },
  };
}

/**
 * Wrap an existing mysql2/promise pool in a Kysely instance (via the
 * callback bridge). The pool is borrowed, never recreated.
 */
export function createKysely(pool: Pool): Kysely<unknown> {
  if (!pool) {
    throw new Error('createKysely: a mysql2 pool is required (got null/undefined)');
  }
  // The bridge returns a callback-style pool (correct at runtime — see the
  // mysql2/promise ↔ callback bridge comment above), but Kysely's types expect
  // a Promise-returning pool factory. Cast at this boundary; the types will
  // tighten when a Database schema type is introduced later in Phase 3.
  return new Kysely({ dialect: new MysqlDialect({ pool: async () => bridgePool(pool) as unknown as MysqlPool }) });
}
