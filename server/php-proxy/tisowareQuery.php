#!/usr/bin/env php
<?php
/**
 * Tisoware ODBC Query Proxy
 *
 * Reads a SQL query from stdin, executes it against Tisoware via ODBC,
 * and returns structured JSON on stdout.
 *
 * Called by Node.js via child_process.spawn() — no HTTP needed.
 *
 * ENV vars (inherited from Coolify/Docker):
 *   TISO_SERVER — Server hostname\instance or host,port
 *   TISO_USER   — SQL Server login
 *   TISO_PASS   — SQL Server password
 */

error_reporting(E_ALL);
ini_set('display_errors', '0');
ini_set('log_errors', '1');

// Shutdown handler: catch fatal errors and write to stderr as JSON
register_shutdown_function(function () {
    $err = error_get_last();
    if ($err && in_array($err['type'], [E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR])) {
        $msg = sprintf('[PHP FATAL] %s in %s:%d', $err['message'], $err['file'], $err['line']);
        file_put_contents('php://stderr', $msg . "\n");
        echo json_encode([
            'success' => false,
            'error' => $err['message'],
            'code' => 'EPHP_FATAL',
            'detail' => sprintf('%s:%d', $err['file'], $err['line']),
        ]) . "\n";
    }
});

// ─── Config from environment ─────────────────────────────────────────────────

$server = getenv('TISO_SERVER') ?: '';
$user   = getenv('TISO_USER') ?: '';
$pass   = getenv('TISO_PASS') ?: '';

// Strip surrounding quotes (same as Node.js buildConfig did)
if ((str_starts_with($pass, '"') && str_ends_with($pass, '"')) ||
    (str_starts_with($pass, "'") && str_ends_with($pass, "'"))) {
    $pass = substr($pass, 1, -1);
}

// ─── Helper: return JSON and exit ────────────────────────────────────────────

function respond($data, $exitCode = 0) {
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) . "\n";
    exit($exitCode);
}

function error($msg, $code = 'EPHP_PROXY', $detail = null) {
    file_put_contents('php://stderr', "[PHP ERROR] $msg | $code | " . ($detail ?? '') . "\n");
    respond([
        'success' => false,
        'error' => $msg,
        'code' => $code,
        'detail' => $detail,
    ], 1);
}

// ─── Validate config ────────────────────────────────────────────────────────

if (!$server) {
    error('TISO_SERVER not set');
}
if (!$user) {
    error('TISO_USER not set');
}
if (!$pass) {
    error('TISO_PASS not set');
}

// ─── Read query from stdin ──────────────────────────────────────────────────

$query = stream_get_contents(STDIN);
if ($query === false || trim($query) === '') {
    error('No query provided (stdin empty)');
}
$query = trim($query);

// ─── Check ODBC extension ───────────────────────────────────────────────────

if (!extension_loaded('odbc')) {
    error('PHP ODBC extension not loaded', 'EPHP_NO_ODBC', 'Install php-odbc package');
}

// ─── Connect to Tisoware mit Fallback ──────────────────────────────────────

// ODBC Driver 18: Connect Timeout = TCP, Login Timeout = auth handshake.
// Login timeout=30, weil AD/Reverse-DNS aus der Cloud langsam sein kann.
//
// Fallback-Strategie: Wenn $server ein Named-Instance-Format (host\instance)
// hat und der erste Verbindungsversuch timeoutet, versuchen wir es mit
// host,1433 (direktes TCP, ohne SQL Browser).
// Grund: SQL Browser (UDP 1434) ist aus Cloud-Umgebungen oft nicht erreichbar.

function buildConnStr($srv) {
    global $user, $pass;
    return sprintf(
        'Driver={ODBC Driver 18 for SQL Server};Server=%s;Database=tisoware;Uid=%s;Pwd=%s;Encrypt=no;TrustServerCertificate=yes;Connect Timeout=10;Login Timeout=30',
        $srv, $user, $pass
    );
}

function tryConnect($connStr, $label) {
    file_put_contents('php://stderr', sprintf(
        "[PHP] Trying [%s]… connStr=[%s]\n",
        $label,
        preg_replace('/Pwd=[^;]+/', 'Pwd=***', $connStr)
    ));

    $capture = '';
    set_error_handler(function ($severity, $msg) use (&$capture) {
        if (stripos($msg, 'odbc') !== false || stripos($msg, 'sql') !== false || stripos($msg, 'timeout') !== false) {
            $capture = $msg;
        }
    });
    $conn = @odbc_connect($connStr, $GLOBALS['user'], $GLOBALS['pass']);
    restore_error_handler();

    return [$conn, $capture];
}

// ── Attempt 1: mit originalem Server (host\instance oder host,port) ──
[$conn, $capture1] = tryConnect(buildConnStr($server), $server);

// ── Attempt 2 (Fallback): Wenn Server host\instance enthält und Versuch 1
//    timeoutete, versuche host,1433 (Default-Instanz, direkter TCP-Port) ──
$isNamedInstance = str_contains($server, '\\');
$conn2 = null;
$capture2 = '';

if (!$conn && $isNamedInstance) {
    $timeoutDetected = stripos($capture1, 'timeout') !== false || stripos(odbc_errormsg(), 'timeout') !== false;
    if ($timeoutDetected) {
        $fallbackServer = preg_replace('/\\\\.*$/', '', $server) . ',1433';
        file_put_contents('php://stderr', sprintf(
            "[PHP] Named-Instance timeout – fallback to %s\n", $fallbackServer
        ));
        [$conn2, $capture2] = tryConnect(buildConnStr($fallbackServer), $fallbackServer);
        if ($conn2) {
            $conn = $conn2;
        }
    }
}

if (!$conn) {
    $phpErr = odbc_errormsg();
    $detail = $phpErr ?: $capture1 ?: $capture2 ?: 'Could not connect (no error detail)';

    file_put_contents('php://stderr', sprintf(
        "[PHP] All connection attempts FAILED: %s\n", $detail
    ));

    error('ODBC connection failed', 'EODBC_CONNECT', $detail);
}

file_put_contents('php://stderr', "[PHP] Connection OK\n");

// ─── Execute query ──────────────────────────────────────────────────────────

$result = odbc_exec($conn, $query);
if (!$result) {
    $phpErr = odbc_errormsg();
    odbc_close($conn);
    error(
        'Query failed',
        'EODBC_QUERY',
        $phpErr ?: 'SQL execution error'
    );
}

// ─── Fetch results ──────────────────────────────────────────────────────────

$rows = [];
$columns = [];

// Get column metadata
$colCount = odbc_num_fields($result);
for ($i = 1; $i <= $colCount; $i++) {
    $columns[] = [
        'name' => odbc_field_name($result, $i),
        'type' => odbc_field_type($result, $i),
        'nullable' => true,
    ];
}

// Fetch rows (max 1000 to prevent OOM)
$maxRows = 1000;
$rowCount = 0;
while (($row = odbc_fetch_array($result)) && $rowCount < $maxRows) {
    // Convert all values to string/null for JSON consistency
    $clean = [];
    foreach ($row as $key => $val) {
        $clean[$key] = $val === null ? null : (string)$val;
    }
    $rows[] = $clean;
    $rowCount++;
}

odbc_free_result($result);
odbc_close($conn);

// ─── Return ─────────────────────────────────────────────────────────────────

respond([
    'success' => true,
    'rows' => $rows,
    'columns' => $columns,
    'rowCount' => count($rows),
]);
