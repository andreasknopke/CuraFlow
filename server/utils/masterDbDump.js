/**
 * MasterDB SQL Dump Utility
 *
 * Generates a SQL dump of all non-empty tables in the CuraFlow MasterDB.
 * Follows the same pattern as the Tisoware dump (server/utils/tisowareDataSource.js).
 *
 * The dump includes:
 *   - CREATE TABLE DDL (reconstructed from information_schema)
 *   - Last 300 rows per table as INSERT statements (50 rows per batch)
 */

/**
 * Escape a value for SQL INSERT statement.
 * @param {unknown} val
 * @returns {string}
 */
function escapeSqlValue(val) {
  if (val === null || val === undefined) return 'NULL';

  if (typeof val === 'number') {
    if (Number.isNaN(val)) return 'NULL';
    if (!Number.isFinite(val)) return 'NULL';
    return String(val);
  }

  // Handle Date objects
  if (val instanceof Date) {
    return `'${val.toISOString().slice(0, 19).replace('T', ' ')}'`;
  }

  // Handle Buffer/Binary
  if (Buffer.isBuffer(val)) {
    return `X'${val.toString('hex')}'`;
  }

  // Handle objects/arrays → JSON string
  if (typeof val === 'object') {
    const json = JSON.stringify(val);
    return `'${json.replace(/'/g, "''")}'`;
  }

  const str = String(val);
  // Escape single quotes by doubling them
  return `'${str.replace(/'/g, "''")}'`;
}

/**
 * Get column definitions for CREATE TABLE DDL.
 * @param {Array<{column_name: string, data_type: string, column_type: string, is_nullable: string, column_default: string|null, extra: string}>} columns
 * @returns {string}
 */
function buildColumnDefinitions(columns) {
  return columns.map((col) => {
    let def = `  \`${col.column_name}\` ${col.column_type}`;

    if (col.is_nullable === 'NO') {
      def += ' NOT NULL';
    }

    if (col.column_default !== null && col.column_default !== undefined) {
      def += ` DEFAULT ${col.column_default}`;
    }

    if (col.extra && col.extra !== '') {
      def += ` ${col.extra}`;
    }

    return def;
  }).join(',\n');
}

/**
 * Generate a SQL dump of all non-empty tables in the MasterDB.
 *
 * @param {import('mysql2/promise').Pool} db - MasterDB connection pool
 * @returns {Promise<string>} SQL dump as a string
 */
export async function generateMasterDbDump(db) {
  // Get all non-empty tables in the current database
  const [tables] = await db.execute(
    `SELECT TABLE_NAME, TABLE_ROWS
     FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_TYPE = 'BASE TABLE'
       AND TABLE_ROWS > 0
     ORDER BY TABLE_NAME`
  );

  const dumpParts = [];

  dumpParts.push('-- ============================================================');
  dumpParts.push('-- CuraFlow MasterDB SQL Dump');
  dumpParts.push(`-- Generated: ${new Date().toISOString()}`);
  dumpParts.push(`-- Tables: ${tables.length} (non-empty only)`);
  dumpParts.push('-- Max rows per table: 300 (latest rows)');
  dumpParts.push('-- ============================================================');
  dumpParts.push('');
  dumpParts.push('SET NAMES utf8mb4;');
  dumpParts.push('');

  for (const table of tables) {
    const tableName = table.TABLE_NAME;
    const totalRows = table.TABLE_ROWS || 0;

    // Calculate offset: take the LAST 300 rows
    const maxSample = 300;
    let offset;
    let limit;
    if (totalRows <= maxSample) {
      offset = 0;
      limit = totalRows;
    } else {
      offset = totalRows - maxSample;
      limit = maxSample;
    }

    // Get columns from information_schema
    let columns;
    try {
      const [cols] = await db.execute(
        `SELECT column_name, data_type, column_type, is_nullable, column_default, extra
         FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = ?
         ORDER BY ORDINAL_POSITION`,
        [tableName]
      );
      columns = cols;
    } catch (err) {
      dumpParts.push(`-- SKIPPED \`${tableName}\`: ${err.message}`);
      dumpParts.push('');
      continue;
    }

    if (!columns || columns.length === 0) {
      dumpParts.push(`-- SKIPPED \`${tableName}\`: no columns found`);
      dumpParts.push('');
      continue;
    }

    // Get sample rows
    let rows;
    try {
      const colNames = columns.map((c) => c.column_name).join(', ');
      const [sample] = await db.execute(
        `SELECT ${colNames} FROM \`${tableName}\` LIMIT ${Number(limit)} OFFSET ${Number(offset)}`
      );
      rows = sample;
    } catch (err) {
      dumpParts.push(`-- SKIPPED \`${tableName}\`: ${err.message}`);
      dumpParts.push('');
      continue;
    }

    dumpParts.push(`-- ============================================================`);
    dumpParts.push(`-- Table: \`${tableName}\``);
    dumpParts.push(`-- Total rows: ${totalRows.toLocaleString()}`);
    dumpParts.push(`-- Sample: ${rows.length} rows (last ${maxSample} from offset ${offset})`);
    dumpParts.push(`-- ============================================================`);

    // CREATE TABLE DDL
    dumpParts.push(`DROP TABLE IF EXISTS \`${tableName}\`;`);
    dumpParts.push(`CREATE TABLE \`${tableName}\` (`);
    dumpParts.push(buildColumnDefinitions(columns));
    dumpParts.push(') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;');
    dumpParts.push('');

    // INSERT statements (batch of 50 rows per INSERT)
    if (rows.length > 0) {
      const colNames = columns.map((c) => `\`${c.column_name}\``).join(', ');
      const BATCH_SIZE = 50;

      for (let i = 0; i < rows.length; i += BATCH_SIZE) {
        const batch = rows.slice(i, i + BATCH_SIZE);
        const valueRows = batch.map((row) => {
          const vals = columns.map((col) => escapeSqlValue(row[col.column_name]));
          return `  (${vals.join(', ')})`;
        });
        dumpParts.push(`INSERT INTO \`${tableName}\` (${colNames}) VALUES`);
        dumpParts.push(valueRows.join(',\n') + ';');
        dumpParts.push('');
      }
    } else {
      dumpParts.push(`-- (empty table — no rows to dump)`);
      dumpParts.push('');
    }
  }

  dumpParts.push('-- ============================================================');
  dumpParts.push('-- End of dump');
  dumpParts.push('-- ============================================================');

  return dumpParts.join('\n');
}
