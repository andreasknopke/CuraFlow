/**
 * Shared Kysely-backed CRUD helpers (Phase 2, PR 2.0).
 *
 * Extracted verbatim from `server/routes/dbProxy.js` (Phase 1 PRs 1.1–1.5) so
 * that future per-entity repositories (`server/repos/*`) and other routes can
 * build on one set of primitives instead of each duplicating query
 * construction. `dbProxy.js` now imports these back.
 *
 * All helpers route dynamic-identifier SQL through Kysely so the table name and
 * column names are escaped centrally (the structural S1 fix). `assertValidIdentifier`
 * at the route entry stays as defence-in-depth; Kysely is the primary control.
 *
 * `toSqlValue` is the dbProxy marshal variant (`'' → null`).
 *
 * NOTE: `atomic.js`'s closures are intentionally NOT migrated to these helpers
 * in PR 2.0 — they have genuine behavioral differences (no `getValidColumns`
 * filtering, equality-only filter, audit-logging, read-back). Per-entity repos
 * (PR 2.x) reconcile them individually.
 */

import { createKysely } from './db.js';
import { sql } from 'kysely';
import { toSqlValue } from './sqlMarshal.js';
import { assertValidIdentifier } from './schema.js';

// Insert a single row through Kysely so the table identifier and column names
// are escaped centrally. `keys` must already be filtered to valid columns (via
// getValidColumns) and `data` is the source object; each value passes through
// toSqlValue, matching the previous hand-built INSERT INTO `t` (`k`,...) VALUES
// (?,...) behavior. assertValidIdentifier(tableName) at the route entry remains
// as defence-in-depth. Errors (e.g. ER_DUP_ENTRY) propagate with their .code
// intact for the caller's duplicate-handling logic.
export const insertRow = async (dbPool, tableName, keys, data) => {
  const kysely = createKysely(dbPool);
  const row = {};
  for (const k of keys) {
    const v = toSqlValue(data[k]);
    row[k] = v === undefined ? null : v;
  }
  await kysely.insertInto(tableName).values(row).executeTakeFirst();
};

// Update a single row by id through Kysely so the table + column identifiers
// are escaped centrally. `keys` must already be filtered to valid columns
// (excludes `id`); values pass through toSqlValue, matching the previous
// hand-built `UPDATE \`t\` SET \`k\`=?,... WHERE id = ?`. ER_DUP_ENTRY
// propagates with .code intact. assertValidIdentifier(tableName) at the route
// entry stays as defence-in-depth.
export const updateRow = async (dbPool, tableName, keys, data, id) => {
  const kysely = createKysely(dbPool);
  const set = {};
  for (const k of keys) {
    const v = toSqlValue(data[k]);
    set[k] = v === undefined ? null : v;
  }
  await kysely.updateTable(tableName).set(set).where('id', '=', id).executeTakeFirst();
};

// Delete a single row by id through Kysely. Equivalent to the previous
// hand-built `DELETE FROM \`t\` WHERE id = ?`.
export const deleteRow = async (dbPool, tableName, id) => {
  const kysely = createKysely(dbPool);
  await kysely.deleteFrom(tableName).where('id', '=', id).executeTakeFirst();
};

// Fetch a single row by id (SELECT * ... WHERE id = ?) through Kysely. Returns
// the raw row (caller runs fromSqlRow) or null if not found. Used for the
// update read-back and the delete pre-fetch.
export const selectRow = async (dbPool, tableName, id) => {
  const kysely = createKysely(dbPool);
  const rows = await kysely.selectFrom(tableName).selectAll().where('id', '=', id).limit(1).execute();
  return rows[0] ?? null;
};

// List/filter rows through Kysely so the table name and EVERY filter key are
// escaped centrally: table + ORDER BY via selectFrom/orderBy, filter keys via
// sql.ref(key). Supports the same operators as the old hand-built SQL:
// equality, $gte, $lte. Sort is a string like "field" or "-field" (desc);
// defaults to `id` ASC. `limit`/`skip` are integers. Returns the raw rows; the
// caller maps them through fromSqlRow. assertValidIdentifier(tableName) at the
// route entry stays as defence-in-depth; the sort field is validated with
// assertValidIdentifier here too.
export const filterRows = async (dbPool, tableName, { filters = {}, sort, limit, skip } = {}) => {
  const kysely = createKysely(dbPool);
  let query = kysely.selectFrom(tableName).selectAll();

  if (filters && Object.keys(filters).length > 0) {
    for (const [key, val] of Object.entries(filters)) {
      if (val && typeof val === 'object' && !Array.isArray(val)) {
        // sql.ref escapes the column identifier; values are bound as params.
        if (val.$gte !== undefined) query = query.where(sql.ref(key), '>=', toSqlValue(val.$gte));
        if (val.$lte !== undefined) query = query.where(sql.ref(key), '<=', toSqlValue(val.$lte));
      } else {
        query = query.where(sql.ref(key), '=', toSqlValue(val));
      }
    }
  }

  if (typeof sort === 'string' && sort) {
    const desc = sort.startsWith('-');
    const field = desc ? sort.substring(1) : sort;
    // Defence-in-depth: validate the sort identifier (Kysely would escape it
    // too, but assertValidIdentifier gives a clean 400 on a bad name).
    assertValidIdentifier(field, 'Sortierfeld');
    query = query.orderBy(field, desc ? 'desc' : 'asc');
    if (field !== 'id') query = query.orderBy('id', 'asc');
  } else {
    query = query.orderBy('id', 'asc');
  }

  const parsedLimit = parseInt(limit);
  if (limit && !isNaN(parsedLimit)) {
    query = query.limit(parsedLimit);
    const parsedSkip = parseInt(skip);
    if (skip && !isNaN(parsedSkip)) {
      query = query.offset(parsedSkip);
    }
  }

  return query.execute();
};

// Insert multiple rows in a single transaction through Kysely. All rows share
// the same `keys` (column set, already filtered to valid columns by the
// caller); each row's values pass through toSqlValue. Kysely issues
// BEGIN/COMMIT/ROLLBACK via executeQuery (handled by the bridge), so the whole
// batch is atomic — a mid-batch failure rolls back every row. Identifiers
// (table + every column) are escaped centrally.
export const bulkInsert = async (dbPool, tableName, keys, rows) => {
  const kysely = createKysely(dbPool);
  await kysely.transaction().execute(async (trx) => {
    for (const data of rows) {
      const row = {};
      for (const k of keys) {
        const v = toSqlValue(data[k]);
        row[k] = v === undefined ? null : v;
      }
      await trx.insertInto(tableName).values(row).executeTakeFirst();
    }
  });
};
