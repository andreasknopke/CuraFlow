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

// ─── Connection string builder ───────────────────────────────────────────────

function buildConnectionString() {
  const server = process.env.TISO_SERVER || '';
  const user = process.env.TISO_USER || '';
  const password = process.env.TISO_PASS || '';

  // Clean password: strip surrounding quotes (from Coolify/.env quoting)
  let cleanPassword = password;
  if (
    (cleanPassword.startsWith('"') && cleanPassword.endsWith('"')) ||
    (cleanPassword.startsWith("'") && cleanPassword.endsWith("'"))
  ) {
    cleanPassword = cleanPassword.slice(1, -1);
  }

  // Build ODBC connection string matching the PHP format exactly
  const connStr =
    `Driver={ODBC Driver 18 for SQL Server};` +
    `Server=${server};` +
    `Database=tisoware;` +
    `Uid=${user};` +
    `Pwd=${cleanPassword};` +
    `Encrypt=no;` +
    `TrustServerCertificate=yes`;

  return connStr;
}

// ─── Connection management ───────────────────────────────────────────────────

let connectionPool = null;
let lastConfigHash = '';

function configHash() {
  return `${process.env.TISO_SERVER || ''}|${process.env.TISO_USER || ''}|${process.env.TISO_PASS || ''}`;
}

/**
 * Extract ODBC native error details from the error object.
 * The `odbc` package provides odbcErrors array with real SQLSTATE + native error code.
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
  // Fallback: try to parse something useful from the generic message
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
 */
async function getConnection() {
  const hash = configHash();
  if (connectionPool && hash !== lastConfigHash) {
    try { await connectionPool.close(); } catch { /* ignore */ }
    connectionPool = null;
  }

  if (!connectionPool) {
    const connStr = buildConnectionString();
    try {
      connectionPool = await odbcConnect.connect(connStr);
    } catch (err) {
      const odbcErr = extractOdbcError(err);
      // Log the full native error for debugging
      console.error('[TISOWARE:ODBC] Connection failed', JSON.stringify(odbcErr));
      const enhanced = new Error(odbcErr.nativeMessage || err.message || 'ODBC connection failed');
      enhanced.code = odbcErr.state || err.code || '';
      enhanced.odbcState = odbcErr.state;
      enhanced.odbcNativeCode = odbcErr.nativeCode;
      throw enhanced;
    }
    lastConfigHash = hash;
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
