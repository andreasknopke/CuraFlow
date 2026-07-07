/**
 * Tisoware ODBC Data Source
 *
 * Uses the Microsoft ODBC Driver 18 for SQL Server via the `odbc` npm package.
 * Same driver as the PHP implementation — guarantees identical behaviour.
 *
 * Connection via ENV vars:
 *   TISO_SERVER — Server hostname\instance or host,port (e.g. "SQLAGL13\TISOWARE")
 *   TISO_USER   — SQL Server login
 *   TISO_PASS   — SQL Server password
 */

import odbcConnect from 'odbc';

// ─── Server parsing ──────────────────────────────────────────────────────────

/**
 * Parse TISO_SERVER into { host, instance, port }.
 * Supports: "host\instance", "host,port", "host" (plain hostname/IP).
 */
function parseServer(raw) {
  let host = raw;
  let instanceName = null;
  let port = 1433;

  if (raw.includes('\\')) {
    const parts = raw.split('\\');
    host = parts[0];
    instanceName = parts.slice(1).join('\\');
    port = 0; // named instance → dynamic port via SQL Browser
  } else if (raw.includes(',')) {
    const [h, p] = raw.split(',', 2);
    host = h.trim();
    port = parseInt(p.trim(), 10) || 1433;
  }
  return { host, instanceName, port };
}

/**
 * Build one or more ODBC connection strings to try.
 * Primary: with named instance (if any).
 * Fallback: without instance on port 1433 (in case SQL Browser is not reachable).
 */
function buildConnectionStrings() {
  const raw = process.env.TISO_SERVER || '';
  const user = process.env.TISO_USER || '';
  let password = process.env.TISO_PASS || '';

  // Clean password: strip surrounding quotes (from Coolify/.env quoting)
  if (
    (password.startsWith('"') && password.endsWith('"')) ||
    (password.startsWith("'") && password.endsWith("'"))
  ) {
    password = password.slice(1, -1);
  }

  const { host, instanceName, port } = parseServer(raw);
  const auth = `Uid=${user};Pwd=${password}`;
  const common = `Encrypt=no;TrustServerCertificate=yes;Login Timeout=15;Connection Timeout=15`;

  const strings = [];

  // Primary: with named instance (uses SQL Browser)
  if (instanceName) {
    strings.push({
      label: `host\\instance (${host}\\${instanceName})`,
      connStr: `Driver={ODBC Driver 18 for SQL Server};Server=${host}\\${instanceName};Database=tisoware;${auth};${common}`,
    });
  }

  // Fallback: direct TCP/IP — uses parsed port, or 1433 for named instances
  const fallbackPort = port > 0 ? port : 1433;
  strings.push({
    label: `host:${fallbackPort} (${host})`,
    connStr: `Driver={ODBC Driver 18 for SQL Server};Server=${host},${fallbackPort};Database=tisoware;${auth};${common}`,
  });

  return strings;
}

// ─── Connection management ───────────────────────────────────────────────────

let connectionPool = null;
let lastConfigHash = '';

function configHash() {
  return `${process.env.TISO_SERVER || ''}|${process.env.TISO_USER || ''}|${process.env.TISO_PASS || ''}`;
}

/**
 * Extract ODBC native error details from the error object.
 */
function extractOdbcError(err) {
  const native = err?.odbcErrors?.[0];
  if (native) {
    return {
      state: native.state || null,
      nativeCode: native.code || null,
      nativeMessage: native.message || null,
    };
  }
  const msg = err?.message || '';
  const stateMatch = msg.match(/\[([A-Z0-9]{5})\]/);
  if (stateMatch) {
    return {
      state: stateMatch[1],
      nativeCode: null,
      nativeMessage: msg.substring(0, 300),
    };
  }
  return { state: null, nativeCode: null, nativeMessage: msg.substring(0, 300) };
}

/**
 * Get a pooled ODBC connection. Reconnects automatically if config changed.
 * Tries multiple connection string variants (named instance → direct port).
 */
async function getConnection() {
  const hash = configHash();
  if (connectionPool && hash !== lastConfigHash) {
    try { await connectionPool.close(); } catch { /* ignore */ }
    connectionPool = null;
  }

  if (!connectionPool) {
    const variants = buildConnectionStrings();
    let lastError = null;

    for (const { label, connStr } of variants) {
      try {
        connectionPool = await odbcConnect.connect(connStr);
        console.log('[TISOWARE:ODBC] Connected via:', label);
        lastConfigHash = hash;
        return connectionPool;
      } catch (err) {
        const odbcErr = extractOdbcError(err);
        console.error(`[TISOWARE:ODBC] ${label} failed:`, JSON.stringify(odbcErr));
        lastError = err;
        // If it's not a timeout, don't bother with fallback
        if (odbcErr.state !== 'HYT00' && odbcErr.state !== '08001') {
          break;
        }
      }
    }

    // All variants failed
    const odbcErr = extractOdbcError(lastError);
    const enhanced = new Error(odbcErr.nativeMessage || lastError?.message || 'ODBC connection failed');
    enhanced.code = odbcErr.state || lastError?.code || '';
    enhanced.odbcState = odbcErr.state;
    enhanced.odbcNativeCode = odbcErr.nativeCode;
    throw enhanced;
  }

  return connectionPool;
}

/**
 * Close the ODBC connection pool.
 */
export async function closeOdbcPool() {
  if (connectionPool) {
    try { await connectionPool.close(); } catch { /* ignore */ }
    connectionPool = null;
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Test connection. Returns { success, serverVersion?, error? } never throws.
 */
export async function testOdbcConnection() {
  try {
    const conn = await getConnection();
    const rows = await conn.query('SELECT 1 AS connected, DB_NAME() AS db, @@VERSION AS version');
    return { success: true, serverVersion: rows?.[0] || null };
  } catch (err) {
    return {
      success: false,
      error: err.message,
      code: err.code,
      odbcState: err.odbcState,
      odbcNativeCode: err.odbcNativeCode,
    };
  }
}

/**
 * Execute a read-only SQL query. Returns { rows, columns, rowCount }.
 */
export async function queryOdbc(sql, maxRows = 1000) {
  const conn = await getConnection();
  const rows = await conn.query(sql);
  const limited = (rows || []).slice(0, maxRows);
  const columns = limited.length > 0
    ? Object.keys(limited[0]).map((name) => ({ name, type: 'unknown', nullable: true }))
    : [];
  return { rows: limited, columns, rowCount: limited.length };
}
