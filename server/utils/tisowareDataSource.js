/**
 * Tisoware Data Source
 *
 * Provides access to the Tisoware time-tracking SQL Server database.
 * Uses mssql (tedious) driver — pure JS, no ODBC/native deps needed.
 *
 * Connection is configured via ENV vars:
 *   TISO_USER   — SQL Server login
 *   TISO_PASS   — SQL Server password
 *   TISO_SERVER — Server hostname\instance or host,port (e.g. "SQLAGL13\TISOWARE")
 *
 * If Tisoware is not reachable (local dev), set TISO_MOCK=true to use mock data.
 */

import sql from 'mssql';

let tisowareConfig = null;
let pool = null;
let poolPromise = null;

function buildConfig() {
  if (tisowareConfig) return tisowareConfig;

  const server = process.env.TISO_SERVER || '';
  const user = process.env.TISO_USER || '';
  const password = process.env.TISO_PASS || '';

  let host = server;
  let instanceName = null;
  let port = 1433;

  if (server.includes('\\')) {
    [host, instanceName] = server.split('\\', 2);
  } else if (server.includes(',')) {
    const [h, p] = server.split(',', 2);
    host = h;
    port = parseInt(p, 10) || 1433;
  }

  tisowareConfig = {
    server: host,
    port,
    user,
    password,
    database: 'tisoware',
    options: {
      encrypt: false,
      trustServerCertificate: true,
      ...(instanceName ? { instanceName } : {}),
    },
    pool: {
      max: 5,
      min: 0,
      idleTimeoutMillis: 30000,
    },
    connectionTimeout: 10000,
    requestTimeout: 30000,
  };

  return tisowareConfig;
}

/**
 * Get (or create) the Tisoware SQL Server connection pool.
 */
export async function getTisowarePool() {
  if (poolPromise) return poolPromise;

  poolPromise = (async () => {
    try {
      const config = buildConfig();
      pool = await sql.connect(config);
      return pool;
    } catch (err) {
      poolPromise = null;
      throw err;
    }
  })();

  return poolPromise;
}

/**
 * Test connection — returns { success, serverVersion?, error? } never throws.
 */
export async function testTisowareConnection() {
  try {
    const p = await getTisowarePool();
    const result = await p.request().query('SELECT 1 AS connected');
    return { success: true, serverVersion: result.recordset?.[0] };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Run a read-only query against Tisoware.
 * Only SELECT / WITH queries are permitted.
 * maxRows caps the result set (default 1000).
 */
export async function queryTisoware(query, maxRows = 1000) {
  const normalized = query.trim().toUpperCase();
  if (!normalized.startsWith('SELECT') && !normalized.startsWith('WITH')) {
    throw Object.assign(new Error('Only SELECT / WITH queries are allowed'), { status: 400 });
  }

  const p = await getTisowarePool();
  const result = await p.request().query(query);

  const rows = (result.recordset || []).slice(0, maxRows);
  const columns = result.columns
    ? Object.entries(result.columns).map(([name, col]) => ({
        name,
        type: col.type?.name || 'unknown',
        nullable: col.nullable,
      }))
    : [];

  return { rows, columns, rowCount: rows.length };
}

/**
 * List all user tables (schema + name) in the Tisoware database.
 */
export async function getTisowareTables() {
  const result = await queryTisoware(`
    SELECT
      s.name AS schema_name,
      t.name AS table_name,
      CONCAT(s.name, '.', t.name) AS full_name
    FROM sys.tables t
    JOIN sys.schemas s ON t.schema_id = s.schema_id
    WHERE s.name NOT IN ('sys', 'INFORMATION_SCHEMA')
      AND t.is_ms_shipped = 0
    ORDER BY s.name, t.name
  `);

  return result.rows;
}

/**
 * Get columns for a given table.
 */
export async function getTisowareTableColumns(schema, table) {
  const safeSchema = schema.replace(/[^a-zA-Z0-9_]/g, '');
  const safeTable = table.replace(/[^a-zA-Z0-9_]/g, '');
  const safeObject = `[${safeSchema}].[${safeTable}]`;

  const result = await queryTisoware(`
    SELECT
      c.name AS column_name,
      TYPE_NAME(c.user_type_id) AS data_type,
      c.max_length,
      c.precision,
      c.scale,
      c.is_nullable,
      c.is_identity
    FROM sys.columns c
    WHERE c.object_id = OBJECT_ID('${safeObject.replace(/'/g, "''")}')
    ORDER BY c.column_id
  `);

  return result.rows;
}

/**
 * Get sample rows from a table (first 50).
 */
export async function getTisowareTableSample(schema, table) {
  const safeSchema = schema.replace(/[^a-zA-Z0-9_]/g, '');
  const safeTable = table.replace(/[^a-zA-Z0-9_]/g, '');
  return queryTisoware(`SELECT TOP 50 * FROM [${safeSchema}].[${safeTable}]`);
}

/**
 * Close the Tisoware connection pool.
 */
export async function closeTisowarePool() {
  if (pool) {
    try { await pool.close(); } catch { /* ignore */ }
    pool = null;
    poolPromise = null;
  }
}

// ============ MOCK DATA ============

const MOCK_TABLES = [
  { schema_name: 'dbo', table_name: 'PERSTAMM', full_name: 'dbo.PERSTAMM' },
  { schema_name: 'dbo', table_name: 'BUCHEINZ', full_name: 'dbo.BUCHEINZ' },
  { schema_name: 'dbo', table_name: 'DPLAEND1', full_name: 'dbo.DPLAEND1' },
  { schema_name: 'dbo', table_name: 'PNZUORDNUNG', full_name: 'dbo.PNZUORDNUNG' },
  { schema_name: 'dbo', table_name: 'PNDIENSTPLA', full_name: 'dbo.PNDIENSTPLA' },
  { schema_name: 'dbo', table_name: 'KSTSTELL', full_name: 'dbo.KSTSTELL' },
  { schema_name: 'dbo', table_name: 'ABWKAL', full_name: 'dbo.ABWKAL' },
  { schema_name: 'dbo', table_name: 'LOASTAMM', full_name: 'dbo.LOASTAMM' },
  { schema_name: 'dbo', table_name: 'LOAGRUPP', full_name: 'dbo.LOAGRUPP' },
  { schema_name: 'dbo', table_name: 'PERSGRUP', full_name: 'dbo.PERSGRUP' },
  { schema_name: 'dbo', table_name: 'ZMTAGE', full_name: 'dbo.ZMTAGE' },
  { schema_name: 'dbo', table_name: 'DPLVERTR', full_name: 'dbo.DPLVERTR' },
];

const MOCK_COLUMNS = {
  PERSTAMM: [
    { column_name: 'PSNR', data_type: 'int', max_length: 4, is_nullable: false, is_identity: true },
    { column_name: 'PSPERSNR', data_type: 'varchar', max_length: 20, is_nullable: false, is_identity: false },
    { column_name: 'PSVORNA', data_type: 'varchar', max_length: 50, is_nullable: true, is_identity: false },
    { column_name: 'PSNACHNA', data_type: 'varchar', max_length: 50, is_nullable: true, is_identity: false },
    { column_name: 'PSEINDAT', data_type: 'varchar', max_length: 10, is_nullable: true, is_identity: false },
    { column_name: 'PSAUSDAT', data_type: 'varchar', max_length: 10, is_nullable: true, is_identity: false },
    { column_name: 'PGNR', data_type: 'varchar', max_length: 10, is_nullable: true, is_identity: false },
    { column_name: 'QALNR', data_type: 'varchar', max_length: 10, is_nullable: true, is_identity: false },
    { column_name: 'KSTNR', data_type: 'varchar', max_length: 10, is_nullable: true, is_identity: false },
  ],
  BUCHEINZ: [
    { column_name: 'PSNR', data_type: 'int', max_length: 4, is_nullable: false, is_identity: false },
    { column_name: 'BEDATE', data_type: 'varchar', max_length: 10, is_nullable: false, is_identity: false },
    { column_name: 'BEVONGWS', data_type: 'int', max_length: 4, is_nullable: true, is_identity: false },
    { column_name: 'BEVONGWM', data_type: 'int', max_length: 4, is_nullable: true, is_identity: false },
    { column_name: 'BEBISGWS', data_type: 'int', max_length: 4, is_nullable: true, is_identity: false },
    { column_name: 'BEBISGWM', data_type: 'int', max_length: 4, is_nullable: true, is_identity: false },
    { column_name: 'BEPAUSES', data_type: 'int', max_length: 4, is_nullable: true, is_identity: false },
    { column_name: 'BEPAUSEM', data_type: 'int', max_length: 4, is_nullable: true, is_identity: false },
    { column_name: 'LOANR', data_type: 'varchar', max_length: 10, is_nullable: true, is_identity: false },
  ],
};

function mockGetTables() {
  return [...MOCK_TABLES];
}

function mockGetColumns(schema, table) {
  return MOCK_COLUMNS[table] || [
    { column_name: 'column_name', data_type: 'varchar', max_length: 255, is_nullable: true, is_identity: false },
  ];
}

function mockGetSample(schema, table) {
  return {
    rows: [{ message: `Mock data: [${schema}].[${table}] — TISO_MOCK is active` }],
    columns: [{ name: 'message', type: 'varchar', nullable: true }],
    rowCount: 1,
  };
}

function mockTestConnection() {
  return { success: true, serverVersion: { connected: 1 }, mock: true };
}

function mockQuery(query) {
  return {
    rows: [
      { note: `Mock result for: ${query.substring(0, 80)}…` },
      { note: 'Set TISO_MOCK=true for development without Tisoware access.' },
    ],
    columns: [{ name: 'note', type: 'varchar', nullable: true }],
    rowCount: 2,
  };
}

/**
 * Whether mock mode is active (TISO_MOCK=true in env).
 */
export function isMockMode() {
  return process.env.TISO_MOCK === 'true' || process.env.TISO_MOCK === '1';
}

/**
 * Connection status info — always succeeds, includes mock flag.
 */
export async function getConnectionStatus() {
  if (isMockMode()) {
    return { connected: true, mock: true, message: 'Mock-Modus aktiv (TISO_MOCK=true)' };
  }

  if (!process.env.TISO_SERVER) {
    return { connected: false, mock: false, message: 'TISO_SERVER nicht konfiguriert' };
  }

  try {
    const result = await testTisowareConnection();
    if (result.success) {
      return { connected: true, mock: false, message: `Verbunden mit ${process.env.TISO_SERVER}` };
    }
    return { connected: false, mock: false, message: `Fehler: ${result.error}` };
  } catch (err) {
    return { connected: false, mock: false, message: err.message };
  }
}

// ============ EXPORT WRAPPERS (mock-aware) ============

export async function listTables() {
  if (isMockMode()) return mockGetTables();
  return getTisowareTables();
}

export async function listColumns(schema, table) {
  if (isMockMode()) return mockGetColumns(schema, table);
  return getTisowareTableColumns(schema, table);
}

export async function sampleTable(schema, table) {
  if (isMockMode()) return mockGetSample(schema, table);
  return getTisowareTableSample(schema, table);
}

export async function runQuery(query, maxRows = 1000) {
  if (isMockMode()) return mockQuery(query);
  return queryTisoware(query, maxRows);
}

export async function testConnection() {
  if (isMockMode()) return mockTestConnection();
  return testTisowareConnection();
}
