/**
 * Kysely query-builder adapter for the existing mysql2/promise pools.
 *
 * Purpose: route dynamic-identifier SQL through Kysely so identifier escaping
 * happens in ONE place (the structural fix for SQL-injection finding S1 in
 * docs/SECURITY_REVIEW_SYSTEM.md — see docs/BACKEND_MODERNIZATION_PLAN.md,
 * Phase 1). mysql2 prepared statements parameterize VALUES but NOT identifiers,
 * so a stray backtick in a table/column name breaks out of the `\`{name}\``
 * context. Kysely escapes identifiers centrally, so a missed site cannot inject.
 *
 * The pool is NOT recreated: the bridge borrows connections from the SAME pool
 * the rest of the route uses (req.db / the master db), preserving tenant
 * isolation (BACKEND_MODERNIZATION_PLAN.md "Tenant-pool coupling"). A repo that
 * accidentally imported the master pool would query the wrong tenant, so call
 * sites must always pass the request-scoped pool.
 *
 * IMPORTANT — the mysql2/promise ↔ callback bridge:
 * Kysely's MysqlDialect expects the callback-style `mysql2` API
 * (pool.getConnection((err,conn)=>...) and conn.query(sql, params, cb)).
 * CuraFlow uses `mysql2/promise`, whose pool/connection methods are
 * promise-only and IGNORE callbacks — so passing a promise pool straight to
 * Kysely hangs forever (the callback never fires). `bridgePool` adapts the
 * promise API to the callback API Kysely requires. This was found by the
 * Phase 1 PR 1.0 spike and is the reason the adapter is non-trivial.
 *
 * NOTE on retries: Kysely-issued queries bypass the server's wrapPoolWithRetry
 * layer (that wraps .execute/.query on the pool, not the bridged connection).
 * Acceptable for the read-path spike (getValidColumns already swallows
 * failures non-fatally); revisit when migrating write paths that need retry.
 *
 * NOTE on types: the DB type parameter is left untyped (unknown) for now.
 * Phase 2 (typed repositories) / Phase 3 (TS port) introduce schema types.
 */

import { Kysely, MysqlDialect } from 'kysely';

/**
 * Adapt a mysql2/promise pool to the callback-style pool Kysely's MysqlDialect
 * expects. Returns a thin object whose getConnection/end invoke callbacks, and
 * whose checked-out connections expose callback-style query/execute that map
 * the promise result ([rows, fields]) to just `rows`.
 *
 * @param {import('mysql2/promise').Pool} promisePool
 * @returns {{ getConnection: Function, end: Function }}
 */
function bridgePool(promisePool) {
  return {
    getConnection(callback) {
      promisePool.getConnection().then((raw) => {
        callback(null, {
          // mysql2/promise resolves to [rows, fields]; Kysely wants just rows.
          query(sql, params, cb) {
            raw.query(sql, params).then(([rows]) => cb(null, rows)).catch(cb);
          },
          execute(sql, params, cb) {
            raw.execute(sql, params).then(([rows]) => cb(null, rows)).catch(cb);
          },
          release() { raw.release(); },
        });
      }).catch((err) => callback(err));
    },
    end(callback) {
      promisePool.end().then(() => callback()).catch(callback);
    },
  };
}

/**
 * Wrap an existing mysql2/promise pool in a Kysely instance (via the
 * callback bridge). The pool is borrowed, never recreated.
 *
 * @param {import('mysql2/promise').Pool} pool - An existing mysql2 pool (e.g.
 *   `req.db` for a tenant, or the master `db`). Must not be null.
 * @returns {Kysely<unknown>} A Kysely instance borrowing connections from pool.
 */
export function createKysely(pool) {
  if (!pool) {
    throw new Error('createKysely: a mysql2 pool is required (got null/undefined)');
  }
  return new Kysely({
    dialect: new MysqlDialect({ pool: () => bridgePool(pool) }),
  });
}
