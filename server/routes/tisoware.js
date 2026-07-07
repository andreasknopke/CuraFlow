/**
 * Tisoware API Routes
 *
 * DB-Explorer for the Tisoware time-tracking SQL Server database.
 * All routes require master/ admin authentication.
 *
 * Endpoints:
 *   GET  /api/master/tisoware/status       — Verbindungsstatus mit Diagnose
 *   GET  /api/master/tisoware/tables        — Alle Tabellen listen
 *   GET  /api/master/tisoware/tables/:schema/:table/columns — Spalten einer Tabelle
 *   GET  /api/master/tisoware/tables/:schema/:table/sample  — Datenvorschau
 *   POST /api/master/tisoware/query         — Eigene SELECT-Abfrage
 */

import express from 'express';
import {
  getConnectionStatus,
  testConnection,
  listTables,
  listColumns,
  sampleTable,
  runQuery,
  isMockMode,
} from '../utils/tisowareDataSource.js';
import { authMiddleware, adminMiddleware } from './auth.js';
import { checkPhpAvailable } from '../utils/tisowarePhpProxy.js';

const router = express.Router();

// All tisoware routes require master-level auth
router.use(authMiddleware);
router.use(adminMiddleware);

/**
 * GET /api/master/tisoware/php-check
 * Prüft ob PHP + ODBC im Container verfügbar sind.
 */
router.get('/php-check', async (req, res, next) => {
  try {
    const result = await checkPhpAvailable();
    return res.json(result);
  } catch (err) {
    return tisowareErrorHandler(err, req, res, next);
  }
});

// ─── Error analysis helper ────────────────────────────────────────────────────

function analyzeTisowareError(err) {
  const code = err?.code || '';
  const message = err?.message || '';
  const number = err?.number; // SQL Server native error number
  const odbcState = err?.odbcState;
  const odbcNativeCode = err?.odbcNativeCode;

  // ODBC SQLSTATE: 28000 → Login failed
  if (code === '28000' || odbcState === '28000' || message.includes('Login failed') || message.includes('login failed')) {
    return {
      diagnosis: 'Anmeldung fehlgeschlagen',
      detail: `Die Tisoware-Credentials wurden vom SQL Server zurückgewiesen.${odbcNativeCode ? ` (Native Error ${odbcNativeCode})` : ''}`,
      hint: 'Prüfe: (1) Benutzername und Passwort in den ENV-Variablen sind korrekt (2) Der SQL Server erlaubt SQL Server Authentication (Mixed Mode) (3) Der Benutzer hat Zugriff auf die tisoware-Datenbank',
      code: 'ELOGIN',
      odbcState,
      odbcNativeCode,
      tisoware: true,
    };
  }

  // ODBC SQLSTATE: 08001 / 08004 → Server nicht erreichbar (kein Route/Verbindung)
  if (code === '08001' || code === '08004' || code === '08007' || odbcState === '08001') {
    return {
      diagnosis: 'Server nicht erreichbar',
      detail: `Der Tisoware SQL-Server antwortet nicht (${code || odbcState}).`,
      hint: 'Prüfe: (1) TISO_SERVER ist korrekt (Host\Instance oder Host,Port) (2) Der SQL Server läuft (3) Die Firewall lässt Verbindungen zu (4) SQL Browser (UDP 1434) ist erreichbar für Named Instances',
      code: 'ECONNREFUSED',
      odbcState,
      odbcNativeCode,
      tisoware: true,
    };
  }

  // ETIMEOUT
  if (code === 'ETIMEOUT' || code === 'ESOCKET' || code === 'ECONNREFUSED' || code === 'ECONNRESET' || code === 'HYT00') {
    return {
      diagnosis: 'Server antwortet nicht',
      detail: `Der Tisoware SQL-Server antwortet nicht (${code}).`,
      hint: 'Prüfe: (1) TISO_SERVER ist korrekt (Host\Instance oder Host,Port) (2) Der SQL Server läuft (3) Die Firewall lässt Verbindungen zu',
      code,
      odbcState,
      odbcNativeCode,
      tisoware: true,
    };
  }

  // ENOTFOUND / 08001 → Hostname unbekannt
  if (code === 'ENOTFOUND' || code === 'ENOENT') {
    return {
      diagnosis: 'Server-Hostname nicht auflösbar',
      detail: `Der Hostname in TISO_SERVER konnte nicht aufgelöst werden (${code}).`,
      hint: 'Prüfe: (1) Der Hostname ist korrekt geschrieben (2) DNS funktioniert (3) Bei IP: Ist die IP korrekt?',
      code,
      odbcState,
      odbcNativeCode,
      tisoware: true,
    };
  }

  // 08004 / 4060 → Datenbank nicht gefunden
  if (number === 4060 || message.includes('Cannot open database') || message.includes('datenbank')) {
    return {
      diagnosis: 'Datenbank nicht gefunden',
      detail: 'Die Datenbank "tisoware" existiert auf dem SQL Server nicht oder ist nicht erreichbar.',
      hint: 'Prüfe: (1) Der Datenbankname lautet tatsächlich "tisoware" (2) Der Benutzer hat Zugriff darauf',
      code,
      odbcState,
      odbcNativeCode,
      tisoware: true,
    };
  }

  // EINSTLOOKUP
  if (code === 'EINSTLOOKUP' || code === 'EINSTANCE' || message.includes('instance')) {
    return {
      diagnosis: 'SQL Server-Instanz nicht gefunden',
      detail: `Die angegebene Instanz in TISO_SERVER wurde nicht gefunden (${code || 'instance'}).`,
      hint: 'Prüfe: (1) Format: HOST\\INSTANCE (2) Der SQL Server Browser-Dienst läuft',
      code: code || 'EINSTLOOKUP',
      odbcState,
      odbcNativeCode,
      tisoware: true,
    };
  }

  // Generic ODBC/SQL error
  if (code || odbcState || message.includes('odbc') || message.includes('SQL')) {
    return {
      diagnosis: 'SQL/ODBC-Fehler',
      detail: `${(odbcState ? `[${odbcState}] ` : '')}${message.substring(0, 300)}`,
      hint: 'Siehe Server-Log für Details.',
      code: code || odbcState || 'EODBC',
      odbcState,
      odbcNativeCode,
      tisoware: true,
    };
  }

  // Fallback
  return {
    diagnosis: 'Unbekannter Fehler',
    detail: message?.substring(0, 300) || 'Keine Fehlerdetails verfügbar',
    hint: 'Siehe Server-Log für den vollständigen Stack Trace.',
    code: code || 'EUNKNOWN',
    odbcState,
    odbcNativeCode,
    tisoware: true,
  };
}

// ─── Route-level error handler ────────────────────────────────────────────────
// Catches ALL errors from Tisoware endpoints and returns detailed diagnostics.
// Does NOT delegate to the global Express error handler.

function tisowareErrorHandler(err, req, res, next) {
  // If already handled, skip
  if (res.headersSent) return next(err);

  const analysis = analyzeTisowareError(err);

  console.error('[TISOWARE]', analysis.diagnosis, {
    code: analysis.code,
    message: err?.message?.substring(0, 200),
    stack: err?.stack?.substring(0, 400),
    path: req.originalUrl,
  });

  const statusCode = err?.status || (analysis.code === 'ETIMEOUT' || analysis.code === 'ECONNREFUSED' ? 502 : 500);

  res.status(statusCode).json({
    error: `Tisoware: ${analysis.diagnosis}`,
    detail: analysis.detail,
    hint: analysis.hint,
    code: analysis.code || null,
    odbcState: analysis.odbcState || null,
    odbcNativeCode: analysis.odbcNativeCode || null,
    tisoware: true,
    connected: false,
    diagnosis: analysis.diagnosis,
  });
}

// ─── Connection status ────────────────────────────────────────────────────────

/**
 * GET /api/master/tisoware/status
 * Verbindungsstatus — immer erfolgreich (zeigt an ob verbunden oder warum nicht).
 */
router.get('/status', async (req, res, next) => {
  try {
    const status = await getConnectionStatus();
    return res.json(status);
  } catch (err) {
    return tisowareErrorHandler(err, req, res, next);
  }
});

/**
 * GET /api/master/tisoware/test
 * Aktiver Verbindungstest — kann fehlschlagen.
 */
router.get('/test', async (req, res, next) => {
  try {
    const result = await testConnection();
    return res.json(result);
  } catch (err) {
    return tisowareErrorHandler(err, req, res, next);
  }
});

/**
 * GET /api/master/tisoware/mock
 * Gibt zurück, ob der Mock-Modus aktiv ist.
 */
router.get('/mock', async (req, res, next) => {
  try {
    return res.json({ mock: isMockMode() });
  } catch (err) {
    return tisowareErrorHandler(err, req, res, next);
  }
});

// ─── Schema exploration ───────────────────────────────────────────────────────

/**
 * GET /api/master/tisoware/tables
 * Alle Benutzertabellen in der Tisoware-Datenbank listen.
 */
router.get('/tables', async (req, res, next) => {
  try {
    const tables = await listTables();
    return res.json({ tables });
  } catch (err) {
    return tisowareErrorHandler(err, req, res, next);
  }
});

/**
 * GET /api/master/tisoware/tables/:schema/:table/columns
 * Spalten einer Tabelle.
 */
router.get('/tables/:schema/:table/columns', async (req, res, next) => {
  try {
    const { schema, table } = req.params;
    const columns = await listColumns(schema, table);
    return res.json({ columns });
  } catch (err) {
    return tisowareErrorHandler(err, req, res, next);
  }
});

/**
 * GET /api/master/tisoware/tables/:schema/:table/sample
 * Erste 50 Zeilen einer Tabelle.
 */
router.get('/tables/:schema/:table/sample', async (req, res, next) => {
  try {
    const { schema, table } = req.params;
    const result = await sampleTable(schema, table);
    return res.json(result);
  } catch (err) {
    return tisowareErrorHandler(err, req, res, next);
  }
});

// ─── Custom query ─────────────────────────────────────────────────────────────

/**
 * POST /api/master/tisoware/query
 * Eigene SELECT / WITH Abfrage (read-only).
 * Body: { query: string }
 */
router.post('/query', async (req, res, next) => {
  try {
    const { query } = req.body;

    if (!query || typeof query !== 'string' || query.trim().length === 0) {
      return res.status(400).json({
        error: 'Query darf nicht leer sein',
        tisoware: true,
      });
    }

    if (query.trim().length > 10000) {
      return res.status(400).json({
        error: 'Query zu lang (max. 10.000 Zeichen)',
        tisoware: true,
      });
    }

    const result = await runQuery(query.trim());
    return res.json(result);
  } catch (err) {
    if (err.status === 400) {
      return res.status(400).json({
        error: err.message,
        tisoware: true,
      });
    }
    return tisowareErrorHandler(err, req, res, next);
  }
});

// ─── Fallback for unknown routes ──────────────────────────────────────────────

router.use('*', (req, res) => {
  res.status(404).json({
    error: 'Unbekannter Tisoware-Endpoint',
    tisoware: true,
  });
});

export default router;
