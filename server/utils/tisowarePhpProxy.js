/**
 * Tisoware PHP Proxy
 *
 * Calls the PHP CLI script (php-proxy/tisowareQuery.php) to execute
 * SQL queries against Tisoware via Microsoft ODBC Driver 18.
 *
 * PHP + ODBC works in production (used by ppugv_station.php) —
 * this proxy exists because Node.js (tedious + odbc packages)
 * could not replicate the connection.
 *
 * Usage:
 *   import { queryViaPhp, testPhpConnection } from './tisowarePhpProxy.js';
 *   const result = await queryViaPhp('SELECT TOP 5 * FROM dbo.PERSTAMM');
 */

import { spawn, exec } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PHP_SCRIPT = path.resolve(__dirname, '..', 'php-proxy', 'tisowareQuery.php');

/**
 * Execute a Tisoware query via the PHP proxy.
 *
 * @param {string} sql - The SQL query to execute
 * @param {number} [timeout=30000] - Max execution time in ms
 * @returns {Promise<{rows: object[], columns: object[], rowCount: number}>}
 */
export async function queryViaPhp(sql, timeout = 30000) {
  const normalized = sql.trim().toUpperCase();
  if (!normalized.startsWith('SELECT') && !normalized.startsWith('WITH')) {
    throw Object.assign(new Error('Only SELECT / WITH queries are allowed'), { status: 400 });
  }

  const result = await runPhp(sql, timeout);

  if (!result.success) {
    const err = new Error(result.error || 'PHP query failed');
    err.code = result.code || 'EPHP_PROXY';
    err.detail = result.detail || null;
    throw err;
  }

  return {
    rows: result.rows || [],
    columns: result.columns || [],
    rowCount: result.rowCount || 0,
  };
}

/**
 * Test connection via PHP proxy.
 *
 * @returns {Promise<{success: boolean, serverVersion?: object, error?: string}>}
 */
export async function testPhpConnection(timeout = 15000) {
  try {
    const result = await runPhp('SELECT 1 AS connected, DB_NAME() AS db, @@VERSION AS version', timeout);
    if (result.success && result.rows?.length > 0) {
      return { success: true, serverVersion: result.rows[0] };
    }
    return { success: false, error: result.error || 'PHP returned no rows', code: result.code, detail: result.detail };
  } catch (err) {
    return { success: false, error: err.message, code: err.code };
  }
}

/**
 * Low-level: spawn PHP process, pipe query via stdin, collect output.
 */
function runPhp(sql, timeout) {
  return new Promise((resolve) => {
    const php = spawn('php', [PHP_SCRIPT], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: process.env, // inherit all env vars (TISO_SERVER, TISO_USER, TISO_PASS)
      timeout,
    });

    let stdout = '';
    let stderr = '';

    php.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    php.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

    php.on('error', (err) => {
      // PHP binary not found or other OS error
      resolve({
        success: false,
        error: err.message.includes('ENOENT')
          ? 'PHP CLI not found — install php-cli + php-odbc in container'
          : err.message,
        code: 'EPHP_BINARY',
        detail: err.message,
      });
    });

    php.on('close', (exitCode, signal) => {
      const signalStr = signal ? ` (signal: ${signal})` : '';

      if (exitCode !== 0 || !stdout) {
        // SIGTERM → timeout. ODBC connection hangs (SQL Browser / firewall)
        if (signal === 'SIGTERM') {
          resolve({
            success: false,
            error: `PHP connection timed out after ${timeout}ms — SQL Server antwortet nicht`,
            code: 'ETIMEOUT',
            detail: `Der PHP-ODBC-Verbindungsversuch wurde nach ${timeout}ms abgebrochen. Der SQL Server (${process.env.TISO_SERVER || 'unbekannt'}) ist vermutlich nicht erreichbar.`,
          });
          return;
        }

        // Try to parse JSON even on non-zero exit
        try {
          const parsed = JSON.parse(stdout);
          resolve(parsed);
        } catch {
          const errMsg = stderr
            ? `PHP stderr: ${stderr.substring(0, 500)}`
            : `PHP exited with code ${exitCode}${signalStr} (no output)`;
          resolve({
            success: false,
            error: errMsg,
            code: signal ? 'EPHP_SIGNAL' : 'EPHP_EXIT',
            detail: stderr ? stderr.substring(0, 1000) : `code=${exitCode} signal=${signal}`,
          });
        }
        return;
      }

      try {
        const parsed = JSON.parse(stdout);
        resolve(parsed);
      } catch (parseErr) {
        resolve({
          success: false,
          error: 'PHP returned invalid JSON',
          code: 'EPHP_JSON',
          detail: stdout.substring(0, 500),
        });
      }
    });

    // Send query to PHP via stdin
    php.stdin.write(sql);
    php.stdin.end();
  });
}

/**
 * Quick check if PHP + ODBC are available.
 * Returns { php_available, php_version, odbc_loaded, drivers? }
 *
 * Runs two steps:
 *   1. `php --version`           →  is php-cli installed?
 *   2. `php -r 'extension_loaded'` + `odbcinst -q -d`  →  odbc extension + drivers
 * If step 1 fails, php is truly missing (ENOENT).
 */
export async function checkPhpAvailable() {
  // Step 1: is PHP executable reachable?
  try {
    await execPromise('php --version', 5000);
  } catch (err) {
    return { php_available: false, error: `PHP not found: ${err.message}` };
  }

  // Step 2a: check PHP ODBC extension is loaded
  let odbcLoaded = false;
  try {
    const out = await execPromise(`php -r 'echo extension_loaded("odbc") ? "yes" : "no";'`, 5000);
    odbcLoaded = out === 'yes';
  } catch {
    odbcLoaded = false;
  }

  // Step 2b: list ODBC drivers via odbcinst (shell tool)
  let drivers = [];
  try {
    const out = await execPromise('odbcinst -q -d', 5000);
    drivers = out
      .split('\n')
      .map(l => l.trim())
      .filter(l => l.length > 0);
  } catch {
    // odbcinst not available — no ODBC drivers
  }

  // Step 2c: PHP version string
  let phpVersion = 'unknown';
  try {
    phpVersion = await execPromise('php -r \'echo PHP_VERSION;\'', 5000);
  } catch {
    // ignore
  }

  return {
    php_available: true,
    php_version: phpVersion,
    odbc_loaded: odbcLoaded,
    odbc_drivers: drivers,
  };
}

// Small helper: promisified exec that returns stdout (not full result)
function execPromise(cmd, timeout) {
  return new Promise((resolve, reject) => {
    exec(cmd, { env: process.env, timeout, maxBuffer: 1024 * 100 }, (err, stdout, stderr) => {
      if (err) {
        const detail = stderr ? ` (stderr: ${stderr.substring(0, 200)})` : '';
        reject(new Error(`${err.message}${detail}`));
        return;
      }
      resolve(stdout.trim());
    });
  });
}
