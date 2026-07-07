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
 *
 * Connection caching: Failed attempts are cached for 30s so subsequent calls
 * fail instantly instead of blocking on connection timeout.
 * Connection timeout is 3s — fast failure is preferred over long waits.
 */

import sql from 'mssql';

// ─── Connection pool ─────────────────────────────────────────────────────────

let pool = null;
let poolPromise = null;

// ─── Connection state cache (avoids blocking on repeated failed attempts) ────

const CONNECTION_CACHE_TTL = 8_000; // 8 seconds (short: allows quick retry after config change)
const connectionCache = {
  state: 'unknown', // 'unknown' | 'connected' | 'failed'
  timestamp: 0,
  error: null,
  code: null,
  configHash: '', // tracks env state to invalidate cache on config change
};

/**
 * Compute a hash of the current ENV config for cache invalidation.
 */
function currentConfigHash() {
  return `${process.env.TISO_SERVER || ''}|${process.env.TISO_USER || ''}|${process.env.TISO_PASS || ''}`;
}

function buildConfig() {
  const server = process.env.TISO_SERVER || '';
  const passwordRaw = process.env.TISO_PASS || '';

  // Strip surrounding quotes (pass from .env-/Coolify-Quoting)
  let password = passwordRaw;
  if ((password.startsWith('"') && password.endsWith('"')) ||
      (password.startsWith("'") && password.endsWith("'"))) {
    password = password.slice(1, -1);
  }

  let host = server;
  let instanceName = null;
  let port = 1433;

  if (server.includes('\\')) {
    [host, instanceName] = server.split('\\', 2);
  } else if (server.includes(',')) {
    const [h, p] = server.split(',', 2);
    host = h.trim();
    port = parseInt(p.trim(), 10) || 1433;
  }

  return {
    server: host,
    port,
    user: process.env.TISO_USER || '',
    password,
    options: {
      database: 'tisoware',
      encrypt: false,
      trustServerCertificate: true,
      ...(instanceName ? { instanceName } : {}),
    },
    pool: {
      max: 2,
      min: 0,
      idleTimeoutMillis: 30000,
    },
    connectionTimeout: 5000,
    requestTimeout: 15000,
  };
}

/**
 * Reset the connection cache — forces a fresh connection attempt on next call.
 */
function resetConnectionCache() {
  connectionCache.state = 'unknown';
  connectionCache.timestamp = 0;
  connectionCache.error = null;
  connectionCache.code = null;
  connectionCache.configHash = currentConfigHash();
}

/**
 * Get (or create) the Tisoware SQL Server connection pool.
 * Uses connection cache to avoid blocking on repeated failed attempts.
 * If ENV vars changed since last attempt, cache is automatically invalidated.
 * @throws {Error} with rich metadata if connection fails or was recently failed.
 */
export async function getTisowarePool(forceFresh = false) {
  // Auto-invalidate cache if config changed
  if (connectionCache.configHash && connectionCache.configHash !== currentConfigHash()) {
    resetConnectionCache();
    await closeTisowarePool();
  }

  // If forced fresh, clear cache and pool
  if (forceFresh) {
    resetConnectionCache();
    await closeTisowarePool();
  }

  // Fast path: cache says we're recently connected
  if (connectionCache.state === 'connected' && pool) {
    return pool;
  }

  // Fast path: cache says we recently failed (< TTL ago)
  if (
    connectionCache.state === 'failed' &&
    Date.now() - connectionCache.timestamp < CONNECTION_CACHE_TTL
  ) {
    const err = new Error(connectionCache.error || 'Tisoware nicht verbunden (Fehler zwischengespeichert)');
    err.code = connectionCache.code || 'ECACHED';
    err.tisoware = true;
    err.cached = true;
    throw err;
  }

  // Need to connect — attempt pool creation
  // Prevent concurrent attempts
  if (poolPromise) {
    return poolPromise;
  }

  poolPromise = (async () => {
    try {
      const config = buildConfig();
      pool = await sql.connect(config);

      // Cache success
      connectionCache.state = 'connected';
      connectionCache.timestamp = Date.now();
      connectionCache.error = null;
      connectionCache.code = null;

      return pool;
    } catch (err) {
      // Cache failure
      connectionCache.state = 'failed';
      connectionCache.timestamp = Date.now();
      connectionCache.error = err.message;
      connectionCache.code = err.code || null;

      // Reset pool promise so next call can retry (after TTL)
      poolPromise = null;
      pool = null;

      throw err;
    }
  })();

  return poolPromise;
}

// ─── Low-level query functions ───────────────────────────────────────────────

/**
 * Test connection — returns { success, serverVersion?, error?, code? } never throws.
 * Always does a fresh connection attempt (for probing).
 */
export async function testTisowareConnection() {
  try {
    const p = await getTisowarePool(true); // force fresh
    const result = await p.request().query('SELECT 1 AS connected');
    return { success: true, serverVersion: result.recordset?.[0] };
  } catch (err) {
    return {
      success: false,
      error: err.message,
      code: err.code || null,
      sqlNumber: err.number || null,
    };
  }
}

/**
 * Run a read-only query against Tisoware.
 * Only SELECT / WITH queries are permitted.
 * Uses the connection cache — fails fast if not connected.
 */
export async function queryTisoware(query, maxRows = 1000) {
  const normalized = query.trim().toUpperCase();
  if (!normalized.startsWith('SELECT') && !normalized.startsWith('WITH')) {
    throw Object.assign(new Error('Only SELECT / WITH queries are allowed'), { status: 400 });
  }

  const p = await getTisowarePool(); // uses cache — may throw instantly
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
 * Connection status info — always succeeds, includes structured diagnosis.
 * Performs a fresh connection attempt.
 */
export async function getConnectionStatus() {
  if (isMockMode()) {
    return { connected: true, mock: true, message: 'Mock-Modus aktiv (TISO_MOCK=true)' };
  }

  const server = process.env.TISO_SERVER || '';
  const user = process.env.TISO_USER || '';
  const pass = process.env.TISO_PASS || '';

  if (!server) {
    return {
      connected: false,
      mock: false,
      diagnosis: 'Server nicht konfiguriert',
      message: 'TISO_SERVER ist nicht gesetzt.',
      hint: 'Setze die ENV-Variablen TISO_SERVER, TISO_USER und TISO_PASS im Deployment.',
      passwordDiag: null,
    };
  }

  if (!user || !pass) {
    return {
      connected: false,
      mock: false,
      diagnosis: 'Credentials nicht konfiguriert',
      message: 'TISO_USER oder TISO_PASS ist nicht gesetzt.',
      hint: 'Setze TISO_USER und TISO_PASS als ENV-Variablen.',
      passwordDiag: {
        length: 0,
        effectiveLength: 0,
        containsHash: false,
        surroundedByQuotes: false,
      },
    };
  }

  // Password diagnostics (for debugging)
  const passDiag = {
    rawLength: pass.length,
    hasLeadingQuote: pass.startsWith('"') || pass.startsWith("'"),
    hasTrailingQuote: pass.endsWith('"') || pass.endsWith("'"),
    surroundedByQuotes: (pass.startsWith('"') && pass.endsWith('"')) || (pass.startsWith("'") && pass.endsWith("'")),
    containsHash: pass.includes('#'),
  };
  // Calculate effective length (without surrounding quotes)
  const effectivePass = passDiag.surroundedByQuotes ? pass.slice(1, -1) : pass;
  passDiag.effectiveLength = effectivePass.length;
  passDiag.effectiveContainsHash = effectivePass.includes('#');

  // Fresh connection attempt — uses forceFresh=true to bypass cache
  try {
    const result = await testTisowareConnection();
    if (result.success) {
      return {
        connected: true,
        mock: false,
        message: `Verbunden mit ${server}`,
        diagnosis: 'Verbindung hergestellt',
        passwordDiag: passDiag,
      };
    }

    return {
      connected: false,
      mock: false,
      message: diagnoseError(result.error, result.code),
      diagnosis: diagnoseError(result.error, result.code),
      detail: result.error?.substring(0, 300) || null,
      code: result.code || null,
      hint: getHintForError(result.code),
      passwordDiag: passDiag,
    };
  } catch (err) {
    return {
      connected: false,
      mock: false,
      message: diagnoseError(err.message, err.code),
      diagnosis: diagnoseError(err.message, err.code),
      detail: err.message?.substring(0, 300) || 'Unbekannter Fehler',
      code: err.code || null,
      hint: getHintForError(err.code),
      passwordDiag: passDiag,
    };
  }
}

/**
 * Analyse a Tisoware connection error and return a human-readable diagnosis.
 */
function diagnoseError(message, code) {
  const msg = (message || '').toLowerCase();
  const codeStr = (code || '').toUpperCase();

  if (codeStr === 'ETIMEOUT' || codeStr === 'ESOCKET') {
    return 'Server antwortet nicht — Verbindungsaufbau abgebrochen (Timeout 3s).';
  }
  if (codeStr === 'ECONNREFUSED') {
    return 'Verbindung abgelehnt — SQL Server läuft nicht oder Port ist blockiert.';
  }
  if (codeStr === 'ECONNRESET') {
    return 'Verbindung wurde zurückgesetzt — möglicherweise SSL/TLS-Problem oder Firewall.';
  }
  if (codeStr === 'ELOGIN' || msg.includes('login failed')) {
    return 'Anmeldung fehlgeschlagen — Benutzername oder Passwort falsch.';
  }
  if (codeStr === 'EINSTLOOKUP' || codeStr === 'EINSTANCE') {
    return 'SQL Server-Instanz wurde nicht gefunden — Host\\Instanz-Format prüfen.';
  }
  if (codeStr === 'ENOTFOUND' || codeStr === 'ENOENT') {
    return 'Hostname nicht auflösbar — TISO_SERVER prüfen.';
  }
  if (codeStr === 'ECACHED') {
    return 'Tisoware aktuell nicht verfügbar (vorheriger Fehler zwischengespeichert). Nächster Versuch in 30s.';
  }
  if (msg.includes('cannot open database') || (msg.includes('datenbank') && msg.includes('nicht'))) {
    return 'Datenbank "tisoware" wurde nicht gefunden.';
  }

  return `${(message || 'Unbekannter Fehler').substring(0, 200)}`;
}

function getHintForError(code) {
  const codeStr = (code || '').toUpperCase();

  if (codeStr === 'ETIMEOUT' || codeStr === 'ESOCKET') {
    return 'Prüfe: (1) TISO_SERVER ist korrekt (Host\\Instanz oder Host,Port) (2) Der SQL Server läuft (3) Die Firewall lässt Verbindungen zu (4) 3s Timeout — ist der Server aus diesem Netz erreichbar?';
  }
  if (codeStr === 'ECONNREFUSED') {
    return 'Prüfe: (1) SQL Server Dienst läuft (2) Port 1433 (oder konfigurierter Port) ist offen.';
  }
  if (codeStr === 'ELOGIN') {
    return 'Prüfe: (1) TISO_USER und TISO_PASS sind korrekt (2) Der Benutzer hat Zugriff auf die tisoware-Datenbank.';
  }
  if (codeStr === 'EINSTLOOKUP' || codeStr === 'EINSTANCE') {
    return 'Prüfe: (1) Format ist HOST\\INSTANZ (2) SQL Server Browser-Dienst läuft.';
  }
  if (codeStr === 'ENOTFOUND') {
    return 'Prüfe: (1) Der Hostname ist korrekt geschrieben (2) DNS funktioniert.';
  }
  return 'Siehe Server-Log für Details.';
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
