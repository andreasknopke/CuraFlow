<?php
#!/usr/bin/env php
/**
 * Tisoware HTTP Proxy — Standalone REST API für Tisoware-Datenbankabfragen
 *
 * Dieses Skript läuft als PHP Built-in Server oder hinter Apache/nginx
 * und stellt die Tisoware-MSSQL-Datenbank via REST-API bereit.
 *
 * Gedacht für den Einsatz auf dem internen PHP-Server (ksux0014),
 * wenn der Coolify-Server die Tisoware-DB nicht direkt erreichen kann.
 *
 * ─── Starten ──────────────────────────────────────────────────────────────────
 *
 *   # Per PHP Built-in Server (Port 8080):
 *   php -S 0.0.0.0:8080 tisowareHttpProxy.php
 *
 *   # Oder via systemd-Daemon (Empfohlen):
 *   [Siehe Installationsanleitung unten]
 *
 * ─── Konfiguration ────────────────────────────────────────────────────────────
 *
 *   ENV-Variablen (Pflicht – keine Fallback-Werte im Code):
 *     TISO_SERVER     = Host\Instanz      (z.B. SQLAGL13\TISOWARE)
 *     TISO_USER       = tisoware
 *     TISO_PASS       = <Passwort>
 *     TISO_PROXY_KEY  = <API-Key>          (für Authentifizierung)
 *
 *   API-Key wird via X-API-Key Header oder ?api_key= Query-Parameter erwartet.
 *
 * ─── API-Endpunkte ────────────────────────────────────────────────────────────
 *
 *   GET  /health                → Health-Check (immer OK)
 *   GET  /status                → Verbindungsstatus
 *   GET  /tables                → Alle Tabellen auflisten
 *   GET  /tables/{schema}/{table}/columns  → Spalten einer Tabelle
 *   GET  /tables/{schema}/{table}/sample   → Erste 50 Zeilen
 *   POST /query                 → Eigene SELECT-Abfrage
 *                                 Body: { "query": "SELECT ..." }
 *
 * ─── Installation als systemd-Daemon ─────────────────────────────────────────
 *
 *   sudo tee /etc/systemd/system/tisoware-proxy.service << 'SERVICE'
 *   [Unit]
 *   Description=Tisoware HTTP Proxy
 *   After=network.target
 *
 *   [Service]
 *   Type=simple
 *   User=adminedv
 *   WorkingDirectory=/home/adminedv/tisoware-proxy
 *   ExecStart=/usr/bin/php -S 0.0.0.0:8080 /home/adminedv/tisoware-proxy/tisowareHttpProxy.php
 *   EnvironmentFile=/etc/tisoware-proxy.env
 *   Restart=always
 *   RestartSec=5
 *
 *   [Install]
 *   WantedBy=multi-user.target
 *   SERVICE
 *
 *   Dann die Umgebungsvariablen in /etc/tisoware-proxy.env (chmod 600):
 *     TISO_SERVER=SQLAGL13\TISOWARE
 *     TISO_USER=tisoware
 *     TISO_PASS=<Passwort>
 *     TISO_PROXY_KEY=<API-Key>
 *
 *   sudo systemctl daemon-reload
 *   sudo systemctl enable --now tisoware-proxy
 */

// ─── Fehler-Reporting ────────────────────────────────────────────────────────
// Nur fatale Fehler im Production-Betrieb
error_reporting(E_ERROR);
ini_set('display_errors', '0');
ini_set('log_errors', '1');

// ─── Konstanten aus ENV ──────────────────────────────────────────────────────

$TISO_SERVER   = getenv('TISO_SERVER') ?: '';
$TISO_USER     = getenv('TISO_USER') ?: '';
$TISO_PASS     = getenv('TISO_PASS') ?: '';
$TISO_PROXY_KEY = getenv('TISO_PROXY_KEY') ?: '';
$CORS_ORIGIN   = getenv('TISO_CORS_ORIGIN') ?: '*';

// Strip surrounding quotes from password (same as tisowareQuery.php)
if ((str_starts_with($TISO_PASS, '"') && str_ends_with($TISO_PASS, '"')) ||
    (str_starts_with($TISO_PASS, "'") && str_ends_with($TISO_PASS, "'"))) {
    $TISO_PASS = substr($TISO_PASS, 1, -1);
}

// ─── Hilfsfunktionen ─────────────────────────────────────────────────────────

function jsonResponse($data, $statusCode = 200) {
    global $CORS_ORIGIN;
    http_response_code($statusCode);
    header('Content-Type: application/json; charset=utf-8');
    header("Access-Control-Allow-Origin: $CORS_ORIGIN");
    header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
    header('Access-Control-Allow-Headers: Content-Type, X-API-Key');
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) . "\n";
    exit;
}

function errorResponse($message, $statusCode = 400, $code = null, $detail = null) {
    $data = ['error' => $message, 'tisoware' => true];
    if ($code)  $data['code'] = $code;
    if ($detail) $data['detail'] = $detail;
    jsonResponse($data, $statusCode);
}

// ─── Authentifizierung ───────────────────────────────────────────────────────

function checkAuth() {
    global $TISO_PROXY_KEY;

    // Ohne konfigurierten Key ist Auth deaktiviert (nur für interne Netze)
    if (empty($TISO_PROXY_KEY)) {
        return true;
    }

    $key = '';
    if (isset($_SERVER['HTTP_X_API_KEY'])) {
        $key = $_SERVER['HTTP_X_API_KEY'];
    } elseif (isset($_GET['api_key'])) {
        $key = $_GET['api_key'];
    }

    if (!hash_equals($TISO_PROXY_KEY, $key)) {
        errorResponse('Unauthorized — gültiger X-API-Key erforderlich', 401, 'EUNAUTHORIZED');
    }
    return true;
}

// ─── ODBC-Verbindung ─────────────────────────────────────────────────────────

function connectTisoware() {
    global $TISO_SERVER, $TISO_USER, $TISO_PASS;

    $connStr = sprintf(
        'Driver={ODBC Driver 18 for SQL Server};Server=%s;Database=tisoware;Uid=%s;Pwd=%s;Encrypt=no;TrustServerCertificate=yes',
        $TISO_SERVER,
        $TISO_USER,
        $TISO_PASS
    );

    $conn = @odbc_connect($connStr, $TISO_USER, $TISO_PASS);
    if (!$conn) {
        $phpErr = odbc_errormsg();
        errorResponse(
            'ODBC-Verbindung fehlgeschlagen',
            502,
            'EODBC_CONNECT',
            $phpErr ?: 'Keine Verbindung zum Tisoware SQL Server möglich'
        );
    }
    return $conn;
}

function queryTisoware($conn, $sql) {
    $result = @odbc_exec($conn, $sql);
    if (!$result) {
        $phpErr = odbc_errormsg();
        odbc_close($conn);
        errorResponse(
            'Query fehlgeschlagen',
            400,
            'EODBC_QUERY',
            $phpErr ?: 'SQL-Fehler'
        );
    }

    $rows = [];
    $columns = [];

    $colCount = odbc_num_fields($result);
    for ($i = 1; $i <= $colCount; $i++) {
        $columns[] = [
            'name' => odbc_field_name($result, $i),
            'type' => odbc_field_type($result, $i),
            'nullable' => true,
        ];
    }

    $maxRows = 5000;
    $rowCount = 0;
    while (($row = odbc_fetch_array($result)) && $rowCount < $maxRows) {
        $clean = [];
        foreach ($row as $key => $val) {
            $clean[$key] = $val === null ? null : (string)$val;
        }
        $rows[] = $clean;
        $rowCount++;
    }

    odbc_free_result($result);

    return [
        'rows' => $rows,
        'columns' => $columns,
        'rowCount' => count($rows),
    ];
}

// ─── SQL-Sicherheitsprüfung ──────────────────────────────────────────────────

function validateQuery($sql) {
    $normalized = strtoupper(trim($sql));
    if (!str_starts_with($normalized, 'SELECT') && !str_starts_with($normalized, 'WITH')) {
        errorResponse('Nur SELECT / WITH Abfragen sind erlaubt', 400, 'EQUERY_TYPE');
    }
    if (strlen($sql) > 10000) {
        errorResponse('Query zu lang (max. 10.000 Zeichen)', 400, 'EQUERY_LENGTH');
    }
}

function sanitizeIdentifier($name) {
    return preg_replace('/[^a-zA-Z0-9_]/', '', $name);
}

// ─── Request-Routing ─────────────────────────────────────────────────────────

function handleRequest() {
    global $TISO_SERVER, $TISO_USER, $TISO_PASS;

    // Bei OPTIONS (CORS-Preflight) sofort antworten
    if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
        global $CORS_ORIGIN;
        http_response_code(204);
        header("Access-Control-Allow-Origin: $CORS_ORIGIN");
        header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
        header('Access-Control-Allow-Headers: Content-Type, X-API-Key');
        exit;
    }

    // Auth-Check (außer bei /health)
    $uri = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
    $uri = rtrim($uri, '/');

    if ($uri !== '/health') {
        checkAuth();
    }

    $method = $_SERVER['REQUEST_METHOD'];

    // ── GET /health ──────────────────────────────────────────────────────────
    if ($uri === '/health' && $method === 'GET') {
        jsonResponse([
            'status' => 'ok',
            'service' => 'tisoware-http-proxy',
            'phpVersion' => PHP_VERSION,
            'odbcLoaded' => extension_loaded('odbc'),
            'timestamp' => date('c'),
        ]);
    }

    // ── GET /status ──────────────────────────────────────────────────────────
    if ($uri === '/status' && $method === 'GET') {
        $conn = @odbc_connect(
            sprintf('Driver={ODBC Driver 18 for SQL Server};Server=%s;Database=tisoware;Uid=%s;Pwd=%s;Encrypt=no;TrustServerCertificate=yes', $TISO_SERVER, $TISO_USER, $TISO_PASS),
            $TISO_USER,
            $TISO_PASS
        );

        if (!$conn) {
            jsonResponse([
                'connected' => false,
                'diagnosis' => 'ODBC-Verbindung fehlgeschlagen',
                'detail' => odbc_errormsg(),
                'hint' => 'Prüfe die ENV-Variablen TISO_SERVER, TISO_USER, TISO_PASS',
            ]);
        }

        $rs = @odbc_exec($conn, 'SELECT @@VERSION AS version, DB_NAME() AS db, GETDATE() AS server_time');
        $info = odbc_fetch_array($rs);
        odbc_close($conn);

        jsonResponse([
            'connected' => true,
            'server' => $TISO_SERVER,
            'database' => $info['db'] ?? 'tisoware',
            'serverTime' => $info['server_time'] ?? null,
            'version' => $info['version'] ?? null,
        ]);
    }

    // ── GET /tables ──────────────────────────────────────────────────────────
    if ($uri === '/tables' && $method === 'GET') {
        $conn = connectTisoware();
        $result = queryTisoware($conn, "
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
        ");
        odbc_close($conn);
        jsonResponse(['tables' => $result['rows']]);
    }

    // ── GET /tables/{schema}/{table}/columns ────────────────────────────────
    if (preg_match('#^/tables/([a-zA-Z0-9_]+)/([a-zA-Z0-9_]+)/columns$#', $uri, $m) && $method === 'GET') {
        $schema = sanitizeIdentifier($m[1]);
        $table  = sanitizeIdentifier($m[2]);
        $safeObject = "[$schema].[$table]";

        $conn = connectTisoware();
        $result = queryTisoware($conn, "
            SELECT
                c.name AS column_name,
                TYPE_NAME(c.user_type_id) AS data_type,
                c.max_length,
                c.precision,
                c.scale,
                c.is_nullable,
                c.is_identity
            FROM sys.columns c
            WHERE c.object_id = OBJECT_ID('$safeObject')
            ORDER BY c.column_id
        ");
        odbc_close($conn);
        jsonResponse(['columns' => $result['rows']]);
    }

    // ── GET /tables/{schema}/{table}/sample ─────────────────────────────────
    if (preg_match('#^/tables/([a-zA-Z0-9_]+)/([a-zA-Z0-9_]+)/sample$#', $uri, $m) && $method === 'GET') {
        $schema = sanitizeIdentifier($m[1]);
        $table  = sanitizeIdentifier($m[2]);
        $offset = isset($_GET['offset']) ? max(0, intval($_GET['offset'])) : 0;
        $limit  = isset($_GET['limit']) ? min(max(1, intval($_GET['limit'])), 500) : 50;

        $conn = connectTisoware();

        // Total count
        $countResult = queryTisoware($conn, "SELECT COUNT(*) AS total FROM [$schema].[$table]");
        $totalCount = $countResult['rows'][0]['total'] ?? 0;

        // Paginated data
        $result = queryTisoware($conn, "SELECT * FROM [$schema].[$table] ORDER BY (SELECT NULL) OFFSET $offset ROWS FETCH NEXT $limit ROWS ONLY");
        odbc_close($conn);

        $result['totalCount'] = (int)$totalCount;
        $result['offset'] = $offset;
        $result['limit'] = $limit;
        jsonResponse($result);
    }

    // ── POST /query ─────────────────────────────────────────────────────────
    if ($uri === '/query' && $method === 'POST') {
        $body = json_decode(file_get_contents('php://input'), true);
        if (!$body || empty($body['query']) || !is_string($body['query'])) {
            errorResponse('Body muss JSON mit "query"-Feld enthalten', 400, 'EBODY');
        }

        $query = trim($body['query']);
        validateQuery($query);

        $conn = connectTisoware();
        $result = queryTisoware($conn, $query);
        odbc_close($conn);
        jsonResponse($result);
    }

    // ── 404 Fallback ─────────────────────────────────────────────────────────
    errorResponse("Unbekannter Endpoint: $method $uri", 404, 'ENOTFOUND');
}

// ─── Einstiegspunkt ──────────────────────────────────────────────────────────

// Wenn via PHP Built-in Server aufgerufen: route alle Requests hierher
handleRequest();
