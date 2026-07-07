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

// ─── Connect to Tisoware mit Driver-Fallback ───────────────────────────────

// Manche Tisoware-Instanzen laufen auf alten SQL Server-Versionen (2000/2005),
// die keine modernen TDS-Protokolle verstehen. Der MS ODBC Driver 18 sendet
// TDS 7.4+/8.x → wird mit "TDS version 0x0 unknown" abgewiesen.
//
// Strategie:
//   1. MS ODBC Driver 18 (host,1433 – direktes TCP, ohne SQL Browser)
//   2. FreeTDS mit TDS_Version=7.0 (SQL Server 2005+)
//   3. FreeTDS mit TDS_Version=5.0 (SQL Server 7/2000)

function buildMsConnStr($srv) {
    global $user, $pass;
    return sprintf(
        'Driver={ODBC Driver 18 for SQL Server};Server=%s;Database=tisoware;Uid=%s;Pwd=%s;Encrypt=no;TrustServerCertificate=yes;Connect Timeout=10;Login Timeout=30',
        $srv, $user, $pass
    );
}

function buildFreeTdsConnStr($srv, $tdsVer) {
    global $user, $pass;
    return sprintf(
        'Driver={FreeTDS};Server=%s;Port=1433;Database=tisoware;UID=%s;PWD=%s;TDS_Version=%s;ClientCharset=UTF-8;',
        $srv, $user, $pass, $tdsVer
    );
}

function tryConnect($connStr, $label) {
    file_put_contents('php://stderr', sprintf(
        "[PHP] Trying [%s]…\n", $label
    ));

    $capture = '';
    set_error_handler(function ($severity, $msg) use (&$capture) {
        if (stripos($msg, 'odbc') !== false || stripos($msg, 'sql') !== false || stripos($msg, 'timeout') !== false || stripos($msg, 'tds') !== false) {
            $capture = $msg;
        }
    });
    $conn = @odbc_connect($connStr, $GLOBALS['user'], $GLOBALS['pass']);
    restore_error_handler();

    return [$conn, $capture];
}

// Basis-Server: Named Instance → host (ohne Port)
$baseHost = preg_replace('/\\\\.*$/', '', trim($server));
if (!str_contains($server, '\\')) {
    // könnte schon host,port sein → Port abtrennen
    $parts = explode(',', $server);
    $baseHost = trim($parts[0]);
}
$baseServerMs = $baseHost . ',1433'; // Für MS ODBC: host,port Format

$lastError = '';
$conn = null;

// ═══ Attempt 1: MS ODBC Driver 18 ═══════════════════════════════════════════
[$conn, $capture] = tryConnect(buildMsConnStr($baseServerMs), "MS ODBC Driver 18 ($baseServerMs)");
if ($conn) {
    file_put_contents('php://stderr', "[PHP] Connected via MS ODBC Driver 18\n");
}

// ═══ Attempt 2: FreeTDS TDS 7.0 (SQL Server 2005+) ═════════════════════════
if (!$conn) {
    $lastError = $capture ?: odbc_errormsg() ?: 'unknown error';
    file_put_contents('php://stderr', sprintf("[PHP] MS ODBC failed: %s – trying FreeTDS\n", $lastError));

    [$conn, $capture] = tryConnect(
        buildFreeTdsConnStr($baseHost, '7.0'),
        "FreeTDS TDS 7.0 ($baseHost:1433)"
    );
    if ($conn) {
        file_put_contents('php://stderr', "[PHP] Connected via FreeTDS TDS 7.0\n");
    }
}

// ═══ Attempt 3: FreeTDS TDS 5.0 (SQL Server 7/2000) ════════════════════════
if (!$conn) {
    $lastError = $capture ?: odbc_errormsg() ?: $lastError;
    file_put_contents('php://stderr', sprintf("[PHP] FreeTDS 7.0 failed: %s – trying TDS 5.0\n", $lastError));

    [$conn, $capture] = tryConnect(
        buildFreeTdsConnStr($baseHost, '5.0'),
        "FreeTDS TDS 5.0 ($baseHost:1433)"
    );
    if ($conn) {
        file_put_contents('php://stderr', "[PHP] Connected via FreeTDS TDS 5.0\n");
    }
}

if (!$conn) {
    $lastError = $capture ?: odbc_errormsg() ?: $lastError;
    file_put_contents('php://stderr', sprintf(
        "[PHP] All connection attempts FAILED: %s\n", $lastError
    ));
    error('ODBC connection failed', 'EODBC_CONNECT', $lastError);
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
