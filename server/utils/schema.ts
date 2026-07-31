import type { Pool } from 'mysql2/promise';

/** Shared column-list cache (keyed by `${cacheKey}:${tableName}`). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const COLUMNS_CACHE: Record<string, any> = {};

const IDENTIFIER_SEGMENT = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;

/**
 * Validate a SQL identifier (table or column name) before interpolating it
 * into a backtick-quoted identifier context.
 *
 * Returns the cleaned name (string) when valid, `false` for non-strings, or
 * `null` for empty/invalid input.
 */
export function isValidIdentifier(name: unknown): string | false | null {
  if (typeof name !== 'string') return false;
  const cleaned = name.trim();
  if (!cleaned) return null;
  const segments = cleaned.split('.');
  if (segments.length === 0 || segments.length > 2) return null;
  for (const segment of segments) {
    if (!IDENTIFIER_SEGMENT.test(segment)) return null;
  }
  return cleaned;
}

/**
 * Assert a table/identifier is valid; throw an HTTP-shaped 400 error if not.
 */
export function assertValidIdentifier(name: unknown, label = 'Table'): string {
  const valid = isValidIdentifier(name);
  if (!valid) {
    const err = new Error(`Ungültiger ${label}-Bezeichner`);
    (err as Error & { status: number }).status = 400;
    throw err;
  }
  return valid;
}

export function clearColumnsCache(tableNames: string[] | null = null, cacheKey: string | null = null): void {
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

export async function hasTable(dbPool: Pool, tableName: string): Promise<boolean> {
  const [rows] = await dbPool.execute(
    `SELECT COUNT(*) AS cnt
     FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [tableName]
  );

  return Number((rows as Record<string, unknown>[])[0]?.cnt || 0) > 0;
}

export async function hasColumn(dbPool: Pool, tableName: string, columnName: string): Promise<boolean> {
  const [rows] = await dbPool.execute(
    `SELECT COUNT(*) AS cnt
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [tableName, columnName]
  );

  return Number((rows as Record<string, unknown>[])[0]?.cnt || 0) > 0;
}

export async function addColumnIfMissing(
  dbPool: Pool,
  tableName: string,
  columnName: string,
  definition: string,
): Promise<boolean> {
  if (await hasColumn(dbPool, tableName, columnName)) {
    return false;
  }

  assertValidIdentifier(tableName, 'Tabelle');
  assertValidIdentifier(columnName, 'Spalte');
  await dbPool.execute(`ALTER TABLE \`${tableName}\` ADD COLUMN \`${columnName}\` ${definition}`);
  return true;
}

export async function ensureColumns(
  dbPool: Pool,
  tableName: string,
  columnDefinitions: [string, string][],
): Promise<boolean> {
  let changed = false;

  for (const [columnName, definition] of columnDefinitions) {
    const added = await addColumnIfMissing(dbPool, tableName, columnName, definition);
    changed = changed || added;
  }

  return changed;
}

