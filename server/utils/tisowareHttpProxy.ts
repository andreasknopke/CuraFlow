/**
 * Tisoware HTTP Proxy Client
 *
 * Ruft den entfernten PHP HTTP Proxy (tisowareHttpProxy.php) via REST-API auf,
 * der auf dem internen PHP-Server (ksux0014 / PPUGV_HOST) läuft.
 *
 * Diese Variante wird verwendet, wenn der Coolify-Server die Tisoware-Datenbank
 * nicht direkt erreichen kann (Firewall/Middleware), der PHP-Server aber Zugriff hat.
 *
 * Konfiguration via ENV-Variablen:
 *   TISO_PROXY_URL  = http://ksux0014:8080  (Default: http://{PPUGV_HOST}:8080)
 *   TISO_PROXY_KEY  = <API-Key>             (optional, wenn im Proxy konfiguriert)
 */

import https from 'node:https';
import http from 'node:http';

// ─── Config ─────────────────────────────────────────────────────────────────

function getProxyUrl(): string | null {
  const explicit = process.env.TISO_PROXY_URL;
  if (explicit) return explicit.replace(/\/+$/, '');

  const ppugvHost = process.env.PPUGV_HOST;
  if (ppugvHost) return `http://${ppugvHost}:8080`;

  return null;
}

function getProxyKey(): string {
  return process.env.TISO_PROXY_KEY || '';
}

/**
 * Prüft, ob der HTTP Proxy konfiguriert ist.
 */
export function isProxyConfigured(): boolean {
  return getProxyUrl() !== null;
}

/**
 * Gibt die aktuell verwendete Proxy-URL zurück (für Status-Anzeige).
 */
export function getProxyUrlDisplay(): string {
  return getProxyUrl() || 'nicht konfiguriert';
}

// ─── Types ───────────────────────────────────────────────────────────────────

class ProxyError extends Error {
  code?: string;
  status?: number;
  detail?: unknown;

  constructor(message: string, code?: string, status?: number, detail?: unknown) {
    super(message);
    this.code = code;
    this.status = status;
    this.detail = detail;
  }
}

interface QueryResult {
  rows: unknown[];
  columns: unknown[];
  rowCount: number;
}

interface ServerVersion {
  connected: number;
  db?: unknown;
  version?: unknown;
  serverTime?: unknown;
}

interface TestConnectionResult {
  success: boolean;
  serverVersion?: ServerVersion;
  error?: string;
  code?: string;
  detail?: unknown;
  proxy?: boolean;
  proxyUrl?: string | null;
}

interface HealthResult {
  ok: boolean;
  phpVersion?: string;
  odbcLoaded?: boolean;
  timestamp?: unknown;
  error?: string;
  code?: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

function isNodeError(err: unknown): err is ProxyError {
  return err instanceof Error;
}

// ─── HTTP-Hilfsfunktion ──────────────────────────────────────────────────────

function httpRequest(method: string, urlPath: string, body: unknown = null, timeout = 30000): Promise<unknown> {
  const baseUrl = getProxyUrl();
  if (!baseUrl) {
    return Promise.reject(new ProxyError(
      'Tisoware HTTP Proxy nicht konfiguriert — TISO_PROXY_URL oder PPUGV_HOST setzen',
      'ENOCONFIG'
    ));
  }

  const url = new URL(urlPath, baseUrl);
  const key = getProxyKey();

  return new Promise((resolve, reject) => {
    const options: http.RequestOptions = {
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname + url.search,
      method,
      timeout,
      headers: {
        'Accept': 'application/json',
      },
    };

    // Optional: API-Key
    if (key) {
      options.headers = {
        ...options.headers,
        'X-API-Key': key,
      };
    }

    // Body bei POST
    let bodyStr: string | undefined;
    if (body) {
      bodyStr = JSON.stringify(body);
      options.headers = {
        ...options.headers,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(bodyStr),
      };
    }

    const lib = url.protocol === 'https:' ? https : http;

    const req = lib.request(options, (res) => {
      let data = '';
      res.on('data', (chunk: string | Buffer) => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed: unknown = JSON.parse(data);
          if (res.statusCode !== undefined && res.statusCode >= 400) {
            const errorMessage = isRecord(parsed) && typeof parsed.error === 'string'
              ? parsed.error
              : `Proxy antwortete mit Status ${res.statusCode}`;
            const err = new ProxyError(
              errorMessage,
              isRecord(parsed) && typeof parsed.code === 'string' ? parsed.code : `EHTTP_${res.statusCode}`,
              res.statusCode,
              isRecord(parsed) ? parsed.detail : null
            );
            reject(err);
          } else {
            resolve(parsed);
          }
        } catch {
          reject(new ProxyError(
            `Proxy ungültige JSON-Antwort: ${data.substring(0, 200)}`,
            'EPROXY_JSON',
            502
          ));
        }
      });
    });

    req.on('error', (err: Error) => {
      const nodeErr = isNodeError(err) ? err : new ProxyError(String(err));
      const errorCode = nodeErr.code;
      if (errorCode === 'ECONNREFUSED') {
        reject(new ProxyError(
          `Proxy unter ${baseUrl} nicht erreichbar (Verbindung abgelehnt)`,
          'ECONNREFUSED'
        ));
      } else if (errorCode === 'ENOTFOUND') {
        reject(new ProxyError(
          `Proxy-Host nicht gefunden: ${url.hostname}`,
          'ENOTFOUND'
        ));
      } else if (errorCode === 'ETIMEDOUT' || nodeErr.message.includes('timeout')) {
        reject(new ProxyError(
          `Proxy unter ${baseUrl} antwortet nicht (${timeout}ms Timeout)`,
          'ETIMEOUT'
        ));
      } else {
        reject(new ProxyError(
          `Proxy-Fehler: ${nodeErr.message}`,
          errorCode || 'EPROXY_UNKNOWN'
        ));
      }
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new ProxyError(
        `Proxy unter ${baseUrl} antwortet nicht (${timeout}ms Timeout)`,
        'ETIMEOUT'
      ));
    });

    if (bodyStr) {
      req.write(bodyStr);
    }
    req.end();
  });
}

// ─── Public API (entspricht dem Interface von tisowarePhpProxy.js) ───────────

/**
 * Führt eine SQL-Abfrage via HTTP-Proxy aus.
 *
 * @param {string} sql - SELECT / WITH Abfrage
 * @param {number} [timeout=30000] - Timeout in ms
 * @returns {Promise<{rows: object[], columns: object[], rowCount: number}>}
 */
export async function queryViaHttp(sql: string, timeout = 30000): Promise<QueryResult> {
  const result = await httpRequest('POST', '/query', { query: sql }, timeout);
  return {
    rows: isRecord(result) && Array.isArray(result.rows) ? result.rows : [],
    columns: isRecord(result) && Array.isArray(result.columns) ? result.columns : [],
    rowCount: isRecord(result) && typeof result.rowCount === 'number' ? result.rowCount : 0,
  };
}

/**
 * Testet die Verbindung zum Tisoware-SQL-Server durch den HTTP-Proxy.
 *
 * @param {number} [timeout=15000] - Timeout in ms
 * @returns {Promise<{success: boolean, serverVersion?: object, error?: string, code?: string}>}
 */
export async function testHttpConnection(timeout = 15000): Promise<TestConnectionResult> {
  try {
    const result = await httpRequest('GET', '/status', null, timeout);
    if (isRecord(result) && result.connected) {
      return {
        success: true,
        serverVersion: {
          connected: 1,
          db: result.database,
          version: result.version,
          serverTime: result.serverTime,
        },
        proxy: true,
        proxyUrl: getProxyUrl(),
      };
    }
    return {
      success: false,
      error: isRecord(result) && typeof result.diagnosis === 'string'
        ? result.diagnosis
        : 'Proxy meldet keine Verbindung',
      code: isRecord(result) && typeof result.code === 'string'
        ? result.code
        : 'EPROXY_DISCONNECTED',
      detail: isRecord(result) ? result.detail : null,
      proxy: true,
    };
  } catch (err) {
    const nodeErr = isNodeError(err) ? err : new ProxyError(String(err));
    return {
      success: false,
      error: nodeErr.message,
      code: nodeErr.code || 'EPROXY_ERROR',
      detail: nodeErr.detail ?? null,
      proxy: true,
    };
  }
}

/**
 * Health-Check: Prüft ob der HTTP-Proxy selbst erreichbar ist.
 *
 * @param {number} [timeout=10000] - Timeout in ms
 * @returns {Promise<{ok: boolean, phpVersion?: string, odbcLoaded?: boolean, error?: string}>}
 */
export async function checkProxyHealth(timeout = 10000): Promise<HealthResult> {
  try {
    const result = await httpRequest('GET', '/health', null, timeout);
    return {
      ok: true,
      phpVersion: isRecord(result) && typeof result.phpVersion === 'string'
        ? result.phpVersion
        : undefined,
      odbcLoaded: isRecord(result) && typeof result.odbcLoaded === 'boolean'
        ? result.odbcLoaded
        : undefined,
      timestamp: isRecord(result) ? result.timestamp : undefined,
    };
  } catch (err) {
    const nodeErr = isNodeError(err) ? err : new ProxyError(String(err));
    return {
      ok: false,
      error: nodeErr.message,
      code: nodeErr.code,
    };
  }
}
