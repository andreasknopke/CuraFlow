export const COLUMNS_CACHE = {};

/**
 * Validate a SQL identifier (table or column name) before interpolating it
 * into a backtick-quoted identifier context.
 *
 * mysql2 prepared statements parameterize VALUES, not identifiers — a stray
 * backtick in a table name breaks out of the `\`{tableName}\`` context and
 * enables SQL injection (e.g. `entity: "Doctor\` WHERE 1=1 UNION SELECT ..."`).
 * No driver can parameterize identifiers, so they must be validated here.
 *
 * Allows one or two dot-separated segments (e.g. schema.table) and rejects
 * anything containing backticks, quotes, semicolons, spaces, or other
 * metacharacters. Returns the cleaned name (truthy) when valid, or a falsy
 * value (false for non-string, null otherwise) when invalid.
 */
const IDENTIFIER_SEGMENT = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;

export function isValidIdentifier(name) {
  if (typeof name !== 'string') return false;
  const cleaned = name.trim();
  if (!cleaned) return null; // empty after trim -> treated as missing (null)
  const segments = cleaned.split('.');
  if (segments.length === 0 || segments.length > 2) return null;
  for (const segment of segments) {
    if (!IDENTIFIER_SEGMENT.test(segment)) return null;
  }
  return cleaned;
}

/**
 * Assert a table/identifier is valid; throw an HTTP-shaped 400 error if not.
 * Use at request entry points where the identifier originates from user input.
 */
export function assertValidIdentifier(name, label = 'Table') {
  const valid = isValidIdentifier(name);
  if (!valid) {
    const err = new Error(`Ungültiger ${label}-Bezeichner`);
    err.status = 400;
    throw err;
  }
  return valid;
}

export function clearColumnsCache(tableNames = null, cacheKey = null) {
  if (!tableNames) {
    for (const key in COLUMNS_CACHE) {
      delete COLUMNS_CACHE[key];
    }
    console.log('[dbProxy] Cleared entire columns cache');
    return;
  }

  for (const key in COLUMNS_CACHE) {
    const matchesTable = tableNames.some((tableName) => key.endsWith(`:${tableName}`));
    const matchesCacheKey = !cacheKey || key.startsWith(`${cacheKey}:`);
    if (matchesTable && matchesCacheKey) {
      delete COLUMNS_CACHE[key];
      console.log(`[dbProxy] Cleared cache for: ${key}`);
    }
  }
}

export async function hasTable(dbPool, tableName) {
  const [rows] = await dbPool.execute(
    `SELECT COUNT(*) AS cnt
     FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [tableName]
  );

  return Number(rows[0]?.cnt || 0) > 0;
}

export async function hasColumn(dbPool, tableName, columnName) {
  const [rows] = await dbPool.execute(
    `SELECT COUNT(*) AS cnt
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [tableName, columnName]
  );

  return Number(rows[0]?.cnt || 0) > 0;
}

export async function addColumnIfMissing(dbPool, tableName, columnName, definition) {
  if (await hasColumn(dbPool, tableName, columnName)) {
    return false;
  }

  // Defensive: tableName/columnName are interpolated into DDL ident context.
  assertValidIdentifier(tableName, 'Tabelle');
  assertValidIdentifier(columnName, 'Spalte');
  await dbPool.execute(`ALTER TABLE \`${tableName}\` ADD COLUMN \`${columnName}\` ${definition}`);
  return true;
}

export async function ensureColumns(dbPool, tableName, columnDefinitions) {
  let changed = false;

  for (const [columnName, definition] of columnDefinitions) {
    const added = await addColumnIfMissing(dbPool, tableName, columnName, definition);
    changed = changed || added;
  }

  return changed;
}
