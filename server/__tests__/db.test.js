import { describe, expect, it } from 'vitest';

import { createKysely } from '../utils/db.js';
import { sql } from 'kysely';
import { assertValidIdentifier } from '../utils/schema.js';

/**
 * Phase 1, PR 1.0 — Kysely adapter + identifier-escaping spike.
 *
 * These tests prove the two goals of the spike without a live DB:
 *   1. createKysely borrows connections from an existing mysql2 pool (tenant
 *      isolation preserved — the pool is never recreated).
 *   2. Routing a SQL statement through Kysely centralizes identifier escaping
 *      (sql.id() backtick-wraps the name), so the S1 injection class is closed
 *      structurally even though the generated SQL is byte-identical for valid
 *      names.
 *
 * getValidColumns itself lives in dbProxy.js, which can't be imported in the
 * unit suite (it pulls in express). Its behavior is verified end-to-end by the
 * e2e specs that depend on it (staff / schedule / wishlist workflows). Here we
 * verify the primitive it is built on.
 */

/**
 * Build a mock mysql2/PROMISE pool that records the SQL it is asked to run and
 * returns the given rows. This mirrors the real mysql2/promise shape the
 * createKysely bridge expects: getConnection() returns a Promise<conn>, and
 * conn.query/conn.execute return a Promise<[rows, fields]>.
 *
 * (The bridge then adapts these promise methods to the callback form Kysely's
 * MysqlDialect requires — see server/utils/db.js.)
 */
function recordingPool(rows, { throwError } = {}) {
  const executed = [];
  const connection = {
    async query(sqlText, params) {
      executed.push({ sql: sqlText, params });
      if (throwError) throw throwError;
      // mysql2/promise resolves to [rows, fields].
      return [rows, []];
    },
    async execute(sqlText, params) {
      executed.push({ sql: sqlText, params });
      if (throwError) throw throwError;
      return [rows, []];
    },
    release() {},
  };
  return {
    pool: {
      async getConnection() { return connection; },
    },
    executed,
  };
}

describe('createKysely — wraps an existing pool (tenant isolation preserved)', () => {
  it('throws if no pool is provided (never silently falls back to a default)', () => {
    expect(() => createKysely(null)).toThrow(/pool is required/);
    expect(() => createKysely(undefined)).toThrow(/pool is required/);
  });

  it('routes queries through the provided pool (does not create its own)', async () => {
    const { pool, executed } = recordingPool([{ Field: 'id' }]);
    const kysely = createKysely(pool);
    await sql`SHOW COLUMNS FROM ${sql.id('Doctor')}`.execute(kysely);
    expect(executed.length, 'exactly one query against the provided pool').toBe(1);
    expect(executed[0].sql).toContain('SHOW COLUMNS FROM');
  });
});

describe('identifier escaping — central S1 control (sql.id)', () => {
  it('backtick-wraps a valid table name (byte-identical to the old SQL)', async () => {
    const { pool, executed } = recordingPool([{ Field: 'id' }]);
    const kysely = createKysely(pool);
    await sql`SHOW COLUMNS FROM ${sql.id('Doctor')}`.execute(kysely);
    expect(executed[0].sql).toBe('SHOW COLUMNS FROM `Doctor`');
  });

  it('escapes a name containing a backtick instead of breaking out of the identifier', async () => {
    // The S1 attack: a backtick in the table name used to close the identifier
    // context and inject SQL. Kysely's sql.id() doubles the backtick so it
    // stays a literal part of the name — no breakout. (In production this name
    // never reaches Kysely because assertValidIdentifier rejects it first; this
    // test pins the builder's own escaping as the primary control.)
    const { pool, executed } = recordingPool([{ Field: 'id' }]);
    const kysely = createKysely(pool);
    await sql`SHOW COLUMNS FROM ${sql.id('evil` WHERE 1=1')}`.execute(kysely);
    // The whole thing is ONE identifier: the injected backtick is doubled (``)
    // so "WHERE 1=1" becomes inert text INSIDE the name, not a SQL clause.
    expect(executed[0].sql).toBe('SHOW COLUMNS FROM `evil`` WHERE 1=1`');
    // Only a single statement: no semicolon, and "WHERE" is inside backticks
    // (i.e. there is no unquoted WHERE that the DB would parse as a clause).
    expect(executed[0].sql).not.toMatch(/;\s/); // no statement separator
  });
});

describe('mysql2/promise ↔ callback bridge — result extraction parity', () => {
  // The bridge must extract just `rows` from mysql2/promise's [rows, fields]
  // resolution and pass them to Kysely's callback, else Kysely sees the whole
  // tuple as the result (breaking the row shape). This pins that contract.
  it('returns the rows array (not the [rows, fields] tuple) so Field is preserved', async () => {
    const columns = [{ Field: 'id' }, { Field: 'name' }, { Field: 'is_active' }];
    const { pool } = recordingPool(columns);
    const kysely = createKysely(pool);
    const result = await sql`SHOW COLUMNS FROM ${sql.id('Doctor')}`.execute(kysely);
    expect(result.rows, 'rows is the column list, not a 2-element tuple').toHaveLength(3);
    expect(result.rows[0].Field, 'SHOW COLUMNS Field property preserved').toBe('id');
    expect(result.rows.map((r) => r.Field)).toEqual(['id', 'name', 'is_active']);
  });

  it('propagates a query error through the bridge (no silent hang)', async () => {
    const { pool } = recordingPool([], { throwError: new Error('boom') });
    const kysely = createKysely(pool);
    await expect(sql`SHOW COLUMNS FROM ${sql.id('Doctor')}`.execute(kysely)).rejects.toThrow('boom');
  });
});

describe('insertInto — create path through Kysely (PR 1.1)', () => {
  // dbProxy's generic create path now uses insertRow → kysely.insertInto.
  // insertRow lives in dbProxy.js (un-importable here), so these tests pin the
  // underlying primitive: the generated INSERT escapes the table + column
  // identifiers and binds values in insertion order. Parity with the old
  // hand-built `INSERT INTO \`t\` (\`k\`,...) VALUES (?,...)`.
  it('generates a backtick-escaped INSERT with values in insertion order', async () => {
    const { pool, executed } = recordingPool([]);
    const kysely = createKysely(pool);
    await kysely.insertInto('Doctor').values({
      id: 'd1',
      name: 'Dr A',
      is_active: 1,
      created_date: '2026-07-29',
    }).executeTakeFirst();

    expect(executed[0].sql).toBe('insert into `Doctor` (`id`, `name`, `is_active`, `created_date`) values (?, ?, ?, ?)');
    expect(executed[0].params).toEqual(['d1', 'Dr A', 1, '2026-07-29']);
  });

  it('escapes a malicious table name (doubled backtick) instead of breaking out', async () => {
    // assertValidIdentifier rejects this upstream; this pins the builder's own
    // escaping as the primary control. The injected backtick is doubled (``)
    // so "values (1)" becomes inert text INSIDE the table-name identifier — the
    // real VALUES clause is separate and has a single placeholder.
    const { pool, executed } = recordingPool([]);
    const kysely = createKysely(pool);
    await kysely.insertInto('evil` values (1)').values({ id: 'x' }).executeTakeFirst();
    // The whole malicious name is one backtick-quoted identifier with the
    // inner backtick doubled:
    expect(executed[0].sql).toBe('insert into `evil`` values (1)` (`id`) values (?)');
    // ...and there is exactly ONE real VALUES clause (one placeholder), so the
    // injected "values (1)" did not create a second clause / inject a row.
    expect(executed[0].params).toEqual(['x']);
  });

  it('propagates ER_DUP_ENTRY with .code intact (Workplace-retry / Doctor-conflict rely on it)', async () => {
    const dupErr = Object.assign(new Error('Duplicate entry'), { code: 'ER_DUP_ENTRY' });
    const { pool } = recordingPool([], { throwError: dupErr });
    const kysely = createKysely(pool);
    await expect(
      kysely.insertInto('Workplace').values({ id: 'w1', name: 'X' }).executeTakeFirst(),
    ).rejects.toMatchObject({ code: 'ER_DUP_ENTRY' });
  });
});

describe('updateTable / deleteFrom / selectFrom — update & delete paths (PR 1.2)', () => {
  // dbProxy's update/delete paths now use updateRow/deleteRow/selectRow (which
  // call kysely.updateTable/deleteFrom/selectFrom). These pin the generated SQL
  // shapes — identifiers backtick-escaped, values bound, ER_DUP_ENTRY preserved.

  it('updateTable generates backtick-escaped UPDATE ... WHERE id = ?', async () => {
    const { pool, executed } = recordingPool([]);
    const kysely = createKysely(pool);
    await kysely.updateTable('Doctor').set({ name: 'Dr B', is_active: 0 }).where('id', '=', 'd1').executeTakeFirst();
    expect(executed[0].sql).toBe('update `Doctor` set `name` = ?, `is_active` = ? where `id` = ?');
    expect(executed[0].params).toEqual(['Dr B', 0, 'd1']);
  });

  it('deleteFrom generates backtick-escaped DELETE ... WHERE id = ?', async () => {
    const { pool, executed } = recordingPool([]);
    const kysely = createKysely(pool);
    await kysely.deleteFrom('Doctor').where('id', '=', 'd1').executeTakeFirst();
    expect(executed[0].sql).toBe('delete from `Doctor` where `id` = ?');
    expect(executed[0].params).toEqual(['d1']);
  });

  it('selectFrom generates backtick-escaped SELECT * ... WHERE id = ?', async () => {
    const { pool, executed } = recordingPool([{ id: 'd1', name: 'Dr A' }]);
    const kysely = createKysely(pool);
    const rows = await kysely.selectFrom('Doctor').selectAll().where('id', '=', 'd1').limit(1).execute();
    expect(executed[0].sql).toBe('select * from `Doctor` where `id` = ? limit ?');
    expect(executed[0].params).toEqual(['d1', 1]);
    expect(rows[0].name, 'select returns the row').toBe('Dr A');
  });

  it('updateTable escapes a malicious table name (doubled backtick, no breakout)', async () => {
    const { pool, executed } = recordingPool([]);
    const kysely = createKysely(pool);
    await kysely.updateTable('evil` WHERE 1=1').set({ name: 'x' }).where('id', '=', 'd1').executeTakeFirst();
    // The injected backtick is doubled → "WHERE 1=1" is inert text inside the
    // table identifier; the real WHERE is the legitimate `id = ?`.
    expect(executed[0].sql).toBe('update `evil`` WHERE 1=1` set `name` = ? where `id` = ?');
    expect(executed[0].params).toEqual(['x', 'd1']);
  });
});

describe('selectFrom with dynamic WHERE — list/filter path (PR 1.3)', () => {
  // dbProxy's list/filter path now builds a Kysely query where EVERY filter key
  // is escaped via sql.ref(key). This closes the previously-unvalidated
  // filter-key interpolation hole (a backtick in a filter key could break out
  // of the `\`{key}\`` identifier context). These pin the generated SQL.

  it('builds a WHERE with escaped equality + range operators ($gte/$lte)', async () => {
    const { pool, executed } = recordingPool([]);
    const kysely = createKysely(pool);
    let q = kysely.selectFrom('ShiftEntry').selectAll();
    const filters = { doctor_id: 'd1', date: { $gte: '2026-05-01', $lte: '2026-05-31' } };
    for (const [key, val] of Object.entries(filters)) {
      if (val && typeof val === 'object' && !Array.isArray(val)) {
        if (val.$gte !== undefined) q = q.where(sql.ref(key), '>=', val.$gte);
        if (val.$lte !== undefined) q = q.where(sql.ref(key), '<=', val.$lte);
      } else {
        q = q.where(sql.ref(key), '=', val);
      }
    }
    await q.execute();
    expect(executed[0].sql).toBe('select * from `ShiftEntry` where `doctor_id` = ? and `date` >= ? and `date` <= ?');
    expect(executed[0].params).toEqual(['d1', '2026-05-01', '2026-05-31']);
  });

  it('escapes a malicious filter key (doubled backtick, no breakout)', async () => {
    // The injection that was possible before PR 1.3: a filter key like
    // "evil`=1 OR 1" used to close the identifier and inject a tautology.
    // sql.ref doubles the backtick so it stays one identifier.
    const { pool, executed } = recordingPool([]);
    const kysely = createKysely(pool);
    await kysely.selectFrom('Doctor').selectAll().where(sql.ref('evil`=1 OR 1'), '=', 'x').execute();
    expect(executed[0].sql).toBe('select * from `Doctor` where `evil``=1 OR 1` = ?');
    expect(executed[0].params).toEqual(['x']);
  });

  it('applies sort (desc) + secondary id, and limit/offset as parameters', async () => {
    const { pool, executed } = recordingPool([]);
    const kysely = createKysely(pool);
    await kysely.selectFrom('Doctor').selectAll().orderBy('name', 'desc').orderBy('id', 'asc').limit(100).offset(10).execute();
    expect(executed[0].sql).toBe('select * from `Doctor` order by `name` desc, `id` asc limit ? offset ?');
    expect(executed[0].params).toEqual([100, 10]);
  });
});

describe('assertValidIdentifier — defence-in-depth still gates the builder', () => {
  // The primary control is now Kysely's escaping, but assertValidIdentifier at
  // the route entry still rejects invalid names first (cleaner 400 vs. a weird
  // SQL error). This test pins that the two layers compose as designed.
  it('accepts a normal table name', () => {
    expect(assertValidIdentifier('Doctor', 'Tabellenname')).toBe('Doctor');
  });

  it('rejects a backtick-breakout name with an HTTP 400 before it reaches the builder', () => {
    try {
      assertValidIdentifier('Doctor` WHERE 1=1', 'Tabellenname');
      throw new Error('should have thrown');
    } catch (err) {
      expect(err.status).toBe(400);
      expect(err.message).toMatch(/Bezeichner/);
    }
  });
});
