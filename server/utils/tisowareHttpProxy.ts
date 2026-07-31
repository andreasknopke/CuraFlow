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

function getProxyUrl() {
  const explicit = process.env.TISO_PROXY_URL;
  if (explicit) return explicit.replace(/\/+$/, '');

  const ppugvHost = process.env.PPUGV_HOST;
  if (ppugvHost) return `http://${ppugvHost}:8080`;

  return null;
}

function getProxyKey() {
  return process.env.TISO_PROXY_KEY || '';
}

/**
 * Prüft, ob der HTTP Proxy konfiguriert ist.
 */
export function isProxyConfigured() {
  return getProxyUrl() !== null;
}

/**
 * Gibt die aktuell verwendete Proxy-URL zurück (für Status-Anzeige).
 */
export function getProxyUrlDisplay() {
  return getProxyUrl() || 'nicht konfiguriert';
}

// ─── HTTP-Hilfsfunktion ──────────────────────────────────────────────────────

function httpRequest(method, urlPath, body = null, timeout = 30000) {
  const baseUrl = getProxyUrl();
  if (!baseUrl) {
    return Promise.reject(Object.assign(
      new Error('Tisoware HTTP Proxy nicht konfiguriert — TISO_PROXY_URL oder PPUGV_HOST setzen'),
      { code: 'ENOCONFIG' }
    ));
  }

  const url = new URL(urlPath, baseUrl);
  const key = getProxyKey();

  return new Promise((resolve, reject) => {
    const options = {
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
      options.headers['X-API-Key'] = key;
    }

    // Body bei POST
    if (body) {
      const bodyStr = JSON.stringify(body);
      options.headers['Content-Type'] = 'application/json';
      options.headers['Content-Length'] = Buffer.byteLength(bodyStr);
    }

    const lib = url.protocol === 'https:' ? https : http;

    const req = lib.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (res.statusCode >= 400) {
            const err = new Error(parsed.error || `Proxy antwortete mit Status ${res.statusCode}`);
            err.code = parsed.code || `EHTTP_${res.statusCode}`;
            err.status = res.statusCode;
            err.detail = parsed.detail || null;
            reject(err);
          } else {
            resolve(parsed);
          }
        } catch (parseErr) {
          reject(Object.assign(
            new Error(`Proxy ungültige JSON-Antwort: ${data.substring(0, 200)}`),
            { code: 'EPROXY_JSON', status: 502 }
          ));
        }
      });
    });

    req.on('error', (err) => {
      if (err.code === 'ECONNREFUSED') {
        reject(Object.assign(
          new Error(`Proxy unter ${baseUrl} nicht erreichbar (Verbindung abgelehnt)`),
          { code: 'ECONNREFUSED' }
        ));
      } else if (err.code === 'ENOTFOUND') {
        reject(Object.assign(
          new Error(`Proxy-Host nicht gefunden: ${url.hostname}`),
          { code: 'ENOTFOUND' }
        ));
      } else if (err.code === 'ETIMEDOUT' || err.message.includes('timeout')) {
        reject(Object.assign(
          new Error(`Proxy unter ${baseUrl} antwortet nicht (${timeout}ms Timeout)`),
          { code: 'ETIMEOUT' }
        ));
      } else {
        reject(Object.assign(
          new Error(`Proxy-Fehler: ${err.message}`),
          { code: err.code || 'EPROXY_UNKNOWN' }
        ));
      }
    });

    req.on('timeout', () => {
      req.destroy();
      reject(Object.assign(
        new Error(`Proxy unter ${baseUrl} antwortet nicht (${timeout}ms Timeout)`),
        { code: 'ETIMEOUT' }
      ));
    });

    if (body) {
      req.write(JSON.stringify(body));
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
export async function queryViaHttp(sql, timeout = 30000) {
  const result = await httpRequest('POST', '/query', { query: sql }, timeout);
  return {
    rows: result.rows || [],
    columns: result.columns || [],
    rowCount: result.rowCount || 0,
  };
}

/**
 * Testet die Verbindung zum Tisoware-SQL-Server durch den HTTP-Proxy.
 *
 * @param {number} [timeout=15000] - Timeout in ms
 * @returns {Promise<{success: boolean, serverVersion?: object, error?: string, code?: string}>}
 */
export async function testHttpConnection(timeout = 15000) {
  try {
    const result = await httpRequest('GET', '/status', null, timeout);
    if (result.connected) {
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
      error: result.diagnosis || 'Proxy meldet keine Verbindung',
      code: result.code || 'EPROXY_DISCONNECTED',
      detail: result.detail || null,
      proxy: true,
    };
  } catch (err) {
    return {
      success: false,
      error: err.message,
      code: err.code || 'EPROXY_ERROR',
      detail: err.detail || null,
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
export async function checkProxyHealth(timeout = 10000) {
  try {
    const result = await httpRequest('GET', '/health', null, timeout);
    return {
      ok: true,
      phpVersion: result.phpVersion,
      odbcLoaded: result.odbcLoaded,
      timestamp: result.timestamp,
    };
  } catch (err) {
    return {
      ok: false,
      error: err.message,
      code: err.code,
    };
  }
}
