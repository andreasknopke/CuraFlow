/**
 * Tisoware Data Source
 *
 * Provides access to the Tisoware time-tracking SQL Server database.
 *
 * ─── Zwei Betriebsmodi ───────────────────────────────────────────────────────
 *
 * 1. DIREKT (lokales PHP im Container):
 *    Spawnt einen PHP-CLI-Prozess, der via ODBC Driver 18 verbindet.
 *    Erfordert TISO_SERVER / TISO_USER / TISO_PASS + PHP+ODBC im Container.
 *    Verwendet wenn TISO_PROXY_URL und PPUGV_HOST NICHT gesetzt sind.
 *
 * 2. HTTP-PROXY (entfernter PHP-Server via REST):
 *    Ruft den tisowareHttpProxy.php auf dem internen PHP-Server auf.
 *    Wird aktiviert wenn TISO_PROXY_URL oder PPUGV_HOST gesetzt ist.
 *    Umgeht Firewall-Probleme vom Coolify-Server aus.
 *
 * Connection is configured via ENV vars:
 *   TISO_USER     — SQL Server login (nur Direkt-Modus)
 *   TISO_PASS     — SQL Server password (nur Direkt-Modus)
 *   TISO_SERVER   — Server hostname\instance (nur Direkt-Modus)
 *   TISO_PROXY_URL — Vollständige URL zum HTTP-Proxy (z.B. http://ksux0014:8080)
 *   PPUGV_HOST    — Alternativ: Host des PHP-Servers (Proxy dann unter Port 8080)
 *   TISO_PROXY_KEY — API-Key für Proxy-Auth (optional)
 *
 * If Tisoware is not reachable (local dev), set TISO_MOCK=true to use mock data.
 *
 * Connection caching: Failed attempts are cached for 30s so subsequent calls
 * fail instantly instead of blocking on connection timeout.
 */

import {
  queryViaPhp,
  testPhpConnection,
} from './tisowarePhpProxy.js';

import {
  queryViaHttp,
  testHttpConnection,
  isProxyConfigured,
  getProxyUrlDisplay,
  checkProxyHealth,
} from './tisowareHttpProxy.js';

// ─── Modus-Auswahl ───────────────────────────────────────────────────────────
// Entscheidet zur Laufzeit, ob der HTTP-Proxy oder lokales PHP verwendet wird.

function useHttpProxy() {
  return isProxyConfigured();
}

// ─── Connection state cache (avoids blocking on repeated failed attempts) ────

const CONNECTION_CACHE_TTL = 8_000;
const connectionCache = {
  state: 'unknown',
  timestamp: 0,
  error: null,
  code: null,
  configHash: '',
};

function currentConfigHash() {
  return `${process.env.TISO_SERVER || ''}|${process.env.TISO_USER || ''}|${process.env.TISO_PASS || ''}`;
}

function resetConnectionCache() {
  connectionCache.state = 'unknown';
  connectionCache.timestamp = 0;
  connectionCache.error = null;
  connectionCache.code = null;
  connectionCache.configHash = currentConfigHash();
}

// ─── Query functions ─────────────────────────────────────────────────────────

export async function testTisowareConnection() {
  if (useHttpProxy()) {
    // HTTP-Proxy: kurzer Timeout, da Netzwerk-Roundtrip
    const result = await testHttpConnection(30000);
    return result.success
      ? { success: true, serverVersion: result.serverVersion, proxy: true, proxyUrl: getProxyUrlDisplay() }
      : { success: false, error: result.error, code: result.code, detail: result.detail, proxy: true };
  }

  // Lokales PHP: langer Timeout (ODBC kann bei Firewall hängen)
  const result = await testPhpConnection(60000);
  return result.success
    ? { success: true, serverVersion: result.serverVersion }
    : { success: false, error: result.error, code: result.code, detail: result.detail };
}

export async function queryTisoware(query, maxRows = 1000) {
  const normalized = query.trim().toUpperCase();
  if (!normalized.startsWith('SELECT') && !normalized.startsWith('WITH')) {
    throw Object.assign(new Error('Only SELECT / WITH queries are allowed'), { status: 400 });
  }
  if (useHttpProxy()) {
    return queryViaHttp(query);
  }
  return queryViaPhp(query);
}

export async function closeTisowarePool() {
  // No persistent pool to close — PHP processes are ephemeral
  resetConnectionCache();
}

/**
 * List all user tables (schema + name) in the Tisoware database.
 */
export async function getTisowareTables() {
  const result = await queryTisoware(`
    SELECT
      s.name AS schema_name,
      t.name AS table_name,
      CONCAT(s.name, '.', t.name) AS full_name,
      COALESCE(SUM(p.rows), 0) AS row_count
    FROM sys.tables t
    JOIN sys.schemas s ON t.schema_id = s.schema_id
    LEFT JOIN sys.partitions p ON t.object_id = p.object_id AND p.index_id IN (0, 1)
    WHERE s.name NOT IN ('sys', 'INFORMATION_SCHEMA')
      AND t.is_ms_shipped = 0
    GROUP BY s.name, t.name
    HAVING COALESCE(SUM(p.rows), 0) > 0
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
 * Get sample rows from a table with pagination.
 *
 * @param {string} schema - Table schema
 * @param {string} table - Table name
 * @param {number} [offset=0] - Row offset for pagination
 * @param {number} [limit=50] - Max rows per page
 * @returns {Promise<{rows: object[], columns: object[], rowCount: number, totalCount: number, offset: number, limit: number}>}
 */
export async function getTisowareTableSample(schema, table, offset = 0, limit = 50) {
  const safeSchema = schema.replace(/[^a-zA-Z0-9_]/g, '');
  const safeTable = table.replace(/[^a-zA-Z0-9_]/g, '');

  // Clamp limit to a reasonable range
  const safeLimit = Math.min(Math.max(1, limit), 500);
  const safeOffset = Math.max(0, offset);

  // Get total count
  const countResult = await queryTisoware(`SELECT COUNT(*) AS total FROM [${safeSchema}].[${safeTable}]`);
  const totalCount = countResult.rows?.[0]?.total ?? 0;

  // Get paginated data
  const dataResult = await queryTisoware(
    `SELECT * FROM [${safeSchema}].[${safeTable}] ORDER BY (SELECT NULL) OFFSET ${safeOffset} ROWS FETCH NEXT ${safeLimit} ROWS ONLY`
  );

  return {
    rows: dataResult.rows || [],
    columns: dataResult.columns || [],
    rowCount: dataResult.rowCount || 0,
    totalCount,
    offset: safeOffset,
    limit: safeLimit,
  };
}

// ============ MOCK DATA ============

const MOCK_TABLES = [
  { schema_name: 'dbo', table_name: 'PERSTAMM', full_name: 'dbo.PERSTAMM', row_count: 248 },
  { schema_name: 'dbo', table_name: 'BUCHEINZ', full_name: 'dbo.BUCHEINZ', row_count: 12580 },
  { schema_name: 'dbo', table_name: 'DPLAEND1', full_name: 'dbo.DPLAEND1', row_count: 350 },
  { schema_name: 'dbo', table_name: 'PNZUORDNUNG', full_name: 'dbo.PNZUORDNUNG', row_count: 42 },
  { schema_name: 'dbo', table_name: 'PNDIENSTPLA', full_name: 'dbo.PNDIENSTPLA', row_count: 890 },
  { schema_name: 'dbo', table_name: 'KSTSTELL', full_name: 'dbo.KSTSTELL', row_count: 15 },
  { schema_name: 'dbo', table_name: 'ABWKAL', full_name: 'dbo.ABWKAL', row_count: 0 },
  { schema_name: 'dbo', table_name: 'LOASTAMM', full_name: 'dbo.LOASTAMM', row_count: 64 },
  { schema_name: 'dbo', table_name: 'LOAGRUPP', full_name: 'dbo.LOAGRUPP', row_count: 12 },
  { schema_name: 'dbo', table_name: 'PERSGRUP', full_name: 'dbo.PERSGRUP', row_count: 8 },
  { schema_name: 'dbo', table_name: 'ZMTAGE', full_name: 'dbo.ZMTAGE', row_count: 365 },
  { schema_name: 'dbo', table_name: 'DPLVERTR', full_name: 'dbo.DPLVERTR', row_count: 72 },
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
  return MOCK_TABLES.filter(t => t.row_count > 0);
}

function mockGetColumns(schema, table) {
  return MOCK_COLUMNS[table] || [
    { column_name: 'column_name', data_type: 'varchar', max_length: 255, is_nullable: true, is_identity: false },
  ];
}

function mockGetSample(schema, table, offset = 0, limit = 50) {
  return {
    rows: [{ message: `Mock data: [${schema}].[${table}] — TISO_MOCK is active` }],
    columns: [{ name: 'message', type: 'varchar', nullable: true }],
    rowCount: 1,
    totalCount: 1,
    offset,
    limit,
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

  // ─── HTTP-Proxy-Modus ─────────────────────────────────────────────────
  if (useHttpProxy()) {
    const proxyUrl = getProxyUrlDisplay();

    // 1. Prüfe ob der Proxy selbst erreichbar ist
    const health = await checkProxyHealth(10000);
    if (!health.ok) {
      return {
        connected: false,
        mock: false,
        proxy: true,
        proxyUrl,
        diagnosis: 'HTTP-Proxy nicht erreichbar',
        message: `Proxy unter ${proxyUrl} antwortet nicht`,
        detail: health.error || null,
        code: health.code || 'EPROXY_UNREACHABLE',
        hint: 'Prüfe: (1) Der PHP-Server läuft (2) Der Proxy-Dienst ist gestartet (3) Die Firewall erlaubt Verbindungen auf Port 8080',
      };
    }

    // 2. Verbindung durch den Proxy zum Tisoware-SQL-Server testen
    const result = await testHttpConnection(30000);
    if (result.success) {
      return {
        connected: true,
        mock: false,
        proxy: true,
        proxyUrl,
        message: `Verbunden via Proxy (${proxyUrl})`,
        diagnosis: 'Verbindung hergestellt',
        serverVersion: result.serverVersion,
      };
    }

    return {
      connected: false,
      mock: false,
      proxy: true,
      proxyUrl,
      message: diagnoseError(result.error, result.code),
      diagnosis: diagnoseError(result.error, result.code),
      detail: result.detail || result.error?.substring(0, 300) || null,
      code: result.code || null,
      hint: 'Der Proxy ist erreichbar, aber die Tisoware-Datenbank antwortet nicht. Prüfe die Proxy-Logs auf dem PHP-Server.',
    };
  }

  // ─── Lokaler PHP-Modus ────────────────────────────────────────────────
  const server = process.env.TISO_SERVER || '';
  const user = process.env.TISO_USER || '';
  const pass = process.env.TISO_PASS || '';

  if (!server) {
    return {
      connected: false,
      mock: false,
      diagnosis: 'Server nicht konfiguriert',
      message: 'Weder TISO_PROXY_URL/PPUGV_HOST noch TISO_SERVER gesetzt.',
      hint: 'Setze entweder TISO_PROXY_URL (oder PPUGV_HOST) für den HTTP-Proxy, oder TISO_SERVER/USER/PASS für lokales PHP.',
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
        proxy: false,
        message: `Verbunden mit ${server}`,
        diagnosis: 'Verbindung hergestellt',
        passwordDiag: passDiag,
      };
    }

    return {
      connected: false,
      mock: false,
      proxy: false,
      message: diagnoseError(result.error, result.code),
      diagnosis: diagnoseError(result.error, result.code),
      detail: result.detail || result.error?.substring(0, 300) || null,
      code: result.code || null,
      odbcState: result.odbcState || null,
      odbcNativeCode: result.odbcNativeCode || null,
      hint: getHintForError(result.code),
      passwordDiag: passDiag,
    };
  } catch (err) {
    return {
      connected: false,
      mock: false,
      proxy: false,
      message: diagnoseError(err.message, err.code),
      diagnosis: diagnoseError(err.message, err.code),
      detail: err.message?.substring(0, 300) || 'Unbekannter Fehler',
      code: err.code || null,
      odbcState: err.odbcState || null,
      odbcNativeCode: err.odbcNativeCode || null,
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

  // ODBC SQLSTATE codes
  if (codeStr === '28000') {
    return 'Anmeldung fehlgeschlagen — Benutzername oder Passwort falsch.';
  }
  if (codeStr === '08001' || codeStr === '08004' || codeStr === '08007') {
    return 'Server nicht erreichbar — Verbindung zum SQL Server fehlgeschlagen.';
  }
  if (codeStr === 'HYT00' || codeStr === 'ETIMEOUT' || codeStr === 'ESOCKET') {
    return 'Server antwortet nicht — Verbindungsaufbau abgebrochen (Timeout).';
  }
  if (codeStr === 'ETDS' || msg.includes('tds') || msg.includes('tabular data stream') || msg.includes('0x0')) {
    return 'TDS-Protokoll-Fehler — der SQL Server ist zu alt für MS ODBC Driver 18. FreeTDS-Fallback sollte greifen.';
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
  // Proxy-spezifische Fehler
  if (codeStr === 'ENOCONFIG') {
    return 'HTTP-Proxy nicht konfiguriert — TISO_PROXY_URL oder PPUGV_HOST setzen.';
  }
  if (codeStr === 'ECONNREFUSED' && msg.includes('proxy')) {
    return 'HTTP-Proxy unter der angegebenen URL nicht erreichbar — Verbindung abgelehnt.';
  }
  if (codeStr === 'EPROXY_DISCONNECTED') {
    return 'HTTP-Proxy ist erreichbar, aber die Tisoware-Datenbank antwortet nicht.';
  }
  if (codeStr === 'EPROXY_JSON') {
    return 'HTTP-Proxy hat ungültige Daten zurückgeliefert.';
  }
  if (codeStr === 'EPROXY_UNREACHABLE') {
    return 'HTTP-Proxy ist nicht erreichbar — Server läuft? Port offen?';
  }
  if (msg.includes('cannot open database') || (msg.includes('datenbank') && msg.includes('nicht'))) {
    return 'Datenbank "tisoware" wurde nicht gefunden.';
  }

  return `${(message || 'Unbekannter Fehler').substring(0, 200)}`;
}

function getHintForError(code) {
  const codeStr = (code || '').toUpperCase();

  if (codeStr === 'HYT00' || codeStr === 'ETIMEOUT' || codeStr === 'ESOCKET') {
    return 'Prüfe: (1) TISO_SERVER ist korrekt (Host\\Instanz oder Host,Port) (2) Der SQL Server läuft (3) Die Firewall lässt Verbindungen zu.';
  }
  if (codeStr === '08001' || codeStr === '08004' || codeStr === '08007' || codeStr === 'ECONNREFUSED') {
    return 'Prüfe: (1) SQL Server Dienst läuft (2) Port 1433 (oder konfigurierter Port) ist offen (3) SQL Browser (UDP 1434) für Named Instances erreichbar.';
  }
  if (codeStr === '28000' || codeStr === 'ELOGIN') {
    return 'Prüfe: (1) TISO_USER und TISO_PASS sind korrekt (2) Der Benutzer hat Zugriff auf die tisoware-Datenbank.';
  }
  if (codeStr === 'EINSTLOOKUP' || codeStr === 'EINSTANCE') {
    return 'Prüfe: (1) Format ist HOST\\INSTANZ (2) SQL Server Browser-Dienst läuft.';
  }
  if (codeStr === 'ENOTFOUND') {
    return 'Prüfe: (1) Der Hostname ist korrekt geschrieben (2) DNS funktioniert.';
  }
  // Proxy-spezifische Hinweise
  if (codeStr === 'ENOCONFIG') {
    return 'Setze TISO_PROXY_URL=http://HOST:8080 oder PPUGV_HOST (dann Port 8080).';
  }
  if (codeStr === 'EPROXY_UNREACHABLE') {
    return 'Prüfe: (1) tisowareHttpProxy.php läuft auf dem PHP-Server (2) Port 8080 ist offen (3) Kein Firewall-Block zwischen Coolify und PHP-Server.';
  }
  if (codeStr === 'EPROXY_JSON') {
    return 'Der Proxy hat keine gültige JSON-Antwort geliefert — Proxy-Logs prüfen.';
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

export async function sampleTable(schema, table, offset = 0, limit = 50) {
  if (isMockMode()) return mockGetSample(schema, table, offset, limit);
  return getTisowareTableSample(schema, table, offset, limit);
}

export async function runQuery(query, maxRows = 1000) {
  if (isMockMode()) return mockQuery(query);
  return queryTisoware(query, maxRows);
}

export async function testConnection() {
  if (isMockMode()) return mockTestConnection();
  return testTisowareConnection();
}
