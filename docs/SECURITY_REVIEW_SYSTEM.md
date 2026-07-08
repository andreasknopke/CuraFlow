# Security Review — Whole System (CuraFlow)

**Scope:** Full backend (`server/`) — auth, multi-tenant DB proxy, file upload, external integrations (email, Tisoware/PHP-ODBC, PPUGV/phpMyAdmin, OpenAI), realtime, plus global middleware (CORS, rate limiting, helmet). The admin permission-model issues are documented separately in [`SECURITY_REVIEW_ADMIN_PERMISSIONS.md`](./SECURITY_REVIEW_ADMIN_PERMISSIONS.md) and are referenced here where they compound.
**Reviewer:** Claude Code (automated static review)
**Date:** 2026-07-08
**Method:** Source review of the affected files; manual trace of data flow from request to SQL / FS / subprocess / network. No dynamic exploitation performed.
**Overall:** The high-risk mechanisms are sound in shape (parameterized values, MIME allowlists, subprocess-via-stdin with no shell, static-file safety). The systemic weaknesses are **trust boundaries**: the server trusts client-supplied identifiers, client-supplied tenant tokens, and the JWT's `role` field in places where authoritative DB state should be consulted. Several of these chain with the permission-model findings into end-to-end exploit paths.

Severity legend: **HIGH** (exploitable, real-world impact), **MEDIUM** (exploitable under conditions / defence-in-depth gap), **LOW** (hardening / accepted risk worth recording).

---

## Finding S1 — SQL injection via unsanitized table identifier in `/api/db`

**Severity:** HIGH
**Location:** `server/routes/dbProxy.js` — `tableName = entity || table` (line 681), interpolated into backtick-quoted SQL at lines ~844, 915, 1042/1056, 1189/1202, 1216, 1258, 1261; `getValidColumns` `SHOW COLUMNS FROM \`{tableName}\`` (line 111).

### Root cause
The unified DB proxy accepts `entity`/`table` from the request body and interpolates it verbatim into SQL identifiers:

```js
const tableName = entity || table;                 // user-controlled, no validation
...
const sql = `INSERT INTO \`${tableName}\` (\`${keys.join('`,`')}\`) VALUES (${placeholders})`;
```

`tableName` is only checked for non-emptiness (line 716). It is **never** validated against an allowlist, a `SHOW TABLES` result, or an identifier regex, and backticks inside it are never escaped. mysql2 prepared statements parameterize **values**, not identifiers, so a backtick in `tableName` breaks out of the identifier context.

Column names *are* protected: `getValidColumns` fetches real columns via `SHOW COLUMNS`, then user keys are filtered to that set (lines 1045–1047, 1192–1194), so column names cannot break out. The table name is the gap.

### Mitigating factors (already present)
- `multipleStatements` is **not enabled** on any pool (`server/index.js:252`, `:309`; `server/utils/mysqlConfig.js`), so classic multi-statement injection (`...; DROP TABLE ...`) is blocked by the driver — the injected payload must be a single statement.
- `create`/`update`/`delete`/`bulkCreate` require a valid JWT of **any** role (public-read bypass only covers `list`/`filter`/`get`). So exploitation requires authentication, not anonymity.
- Write paths on protected tables are additionally gated by the permission guards (see the separate permission review) — but those gates run *before* `tableName` is used in SQL and do not sanitize it, so a non-protected table like `Doctor` is injectable by any authenticated user.

### Failure scenario
1. Attacker authenticates as any user (lowest-friction: a read-only or freshly-registered tenant user — the public-read bypass does not apply to writes, but writes still only need a valid token).
2. `POST /api/db` body: `{ "action": "filter", "entity": "Doctor\\` WHERE 1=1 UNION SELECT id,email,password_hash,1,2,3,4,5,6,7,8 FROM app_users-- " }`.
3. `tableName` is interpolated into `SELECT * FROM \`Doctor\` WHERE 1=1 UNION SELECT … FROM app_users-- \``. Because column filtering calls `getValidColumns` first via `SHOW COLUMNS FROM \`{...}\``, even that statement runs attacker-controlled SQL against `information_schema` / `app_users`.
4. Result: **credential hash exfiltration** (`app_users.password_hash`) and arbitrary **read** of any table in the (tenant or master) pool the connection can reach. Master-pool writes (`app_users`, `db_tokens`) are reachable when no `X-DB-Token` is sent.

### Proposed remedy
Validate `tableName` (and any interpolated column/identifier) against an allowlist or an identifier regex **before** any SQL construction, and reject otherwise:

```js
const IDENT = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
if (!tableName || !IDENT.test(tableName)) {
  return res.status(400).json({ error: 'Invalid table name' });
}
// Optionally confirm the table exists in this pool:
// const [rows] = await dbPool.execute('SHOW TABLES LIKE ?', [tableName]);
// if (!rows.length) return res.status(404)...
```
Apply the same identifier check everywhere a name is interpolated (`server/routes/atomic.js`, `server/routes/admin.js`, `server/routes/master.js`, `server/utils/schema.js`, `server/utils/masterMigrations.js`). This is the single highest-impact fix in this review.

---

## Finding S2 — Multi-tenant isolation trusts the `X-DB-Token` header with no per-user authorization

**Severity:** HIGH
**Location:** `server/index.js` `tenantDbMiddleware` (lines 342–398) and `getTenantDb` (lines 290–333); token list / authorization in `server/routes/auth.js` `/my-tenants` (lines 664–714).

### Root cause
`tenantDbMiddleware` resolves the tenant connection pool purely from the request's `X-DB-Token` header:

```js
const dbToken = req.headers['x-db-token'];
req.db = getTenantDb(dbToken);          // no check against req.user.allowed_tenants
```

`parseDbToken(token)` decrypts to raw DB credentials (`host/user/password/database`); whoever presents a valid token is routed to that tenant's database. The **only** authorisation that a user may use a given tenant happens client-side — `/my-tenants` returns the filtered token list and the frontend picks one. The backend never re-checks that the presented token corresponds to a tenant the authenticated user is allowed to access.

A user with `allowed_tenants = ['tenantA']` who obtains (by any means) the token for `tenantB` is silently routed to `tenantB`'s database and can read/write its schedule, doctors, and qualification data.

### Failure scenario
1. `db_token` values are not treated as pure secrets in all paths — see S3 (tokens embedded in email links). A user who captures another tenant's token (shared link, proxy log, referer header, leaked support message) can present it in their own `X-DB-Token`.
2. Because `tenantDbMiddleware` does not consult `app_users.allowed_tenants`, the server happily routes the request to the foreign tenant. All downstream route handlers operate on `req.db` (the foreign pool) with the attacker's own identity — no further tenant check exists in most handlers (a few do re-scope by `req.user`, but the bulk do not).
3. Result: **cross-tenant data access** — a user reads/writes another hospital's schedule.

### Proposed remedy
Enforce tenant authorization server-side, not just client-side:

```js
// in tenantDbMiddleware, after resolving req.db from the token:
if (req.isCustomDb && req.user) {
  const tokenRow = await tokenRowFor(dbToken);           // map token -> tenant id
  const allowed = await userAllowedTenants(req.user.sub); // from app_users
  const hasFull = !allowed || allowed.length === 0;
  if (!hasFull && !allowed.includes(tokenRow.id)) {
    return res.status(403).json({ error: 'Tenant access denied' });
  }
}
```
(Introduce a `db_tokens.id`/token map or a signed claim binding the token to allowed users.) Until then, treat every `db_token` as a capability that must be protected (see S3) and rotate on suspicion of leak.

---

## Finding S3 — Tenant `db_token` embedded in email reminder links (URL-based credential leak)

**Severity:** MEDIUM
**Location:** `server/routes/certificates.js` `buildCertificateReminderLink` (lines 272–281).

### Root cause
The certificate-reminder email embeds the current tenant's `db_token` as a URL query parameter:

```js
if (req.dbToken) {
  url.searchParams.set('db_token', req.dbToken);   // raw tenant DB credential in a link
}
```
The generated link is sent by email (`POST /api/certificates/reminders/send`). A `db_token` decrypts to DB connection credentials (see S2); placing it in a URL exposes it to: mail transport/logs, the recipient's browser history, `Referer` headers on any off-site resource the page loads, and reverse-proxy/access logs.

### Failure scenario
1. Admin triggers reminders; an admin's browser/email client or a forwarded email ends up containing `https://app/db_token=<raw-encrypted-credential>`.
2. Anyone capturing that URL gains a tenant capability (compounds with S2 — no per-user re-authorization), yielding access to that tenant's database.

### Proposed remedy
Do not carry the `db_token` in user-facing links. Issue a short-lived, signed, single-purpose token that resolves to (user → tenant → upload page) server-side, with the tenant resolution done after authentication:

```js
// mint: HMAC-signed { doctor_id, qualification_ids[], tenant_id, exp }
// link: /certificate-upload?Reminder=<token>
// server: on GET, verify token, look up the user's allowed_tenants, then route to their tenant.
```
If the reminder must deep-link to a specific tenant, bind the token to an explicit `user_id` and validate it on resolution.

---

## Finding S4 — SSE/JWT authentication via `?access_token=` query parameter

**Severity:** LOW
**Location:** `server/routes/auth.js` `resolveAuthPayload` (lines 37–48), used by `streamAuthMiddleware` (lines 50–58).

### Root cause
The Server-Sent-Events stream authenticates by accepting the JWT in the URL:

```js
if (typeof req.query?.access_token === 'string' && req.query.access_token) {
  return verifyToken(req.query.access_token);
}
```
This is the canonical way to authenticate `EventSource` (which cannot set headers), so it is an accepted trade-off, but it places live 24h JWTs in URLs — reachable by proxies, access logs, and `Referer`.

### Proposed remedy (defence in depth)
- Prefer a short-lived, one-time SSE token minted from the JWT (e.g. 60s TTL) for the `access_token` query param, so leaked-URL tokens expire fast.
- Ensure access logs of the reverse proxy redact `access_token` / `db_token` query parameters.
- Document that JWTs in URLs are explicitly SSE-only.

---

## Finding S5 — CORS reflects any origin with credentials (debug gate shipped)

**Severity:** MEDIUM
**Location:** `server/index.js` CORS middleware (lines 427–447).

### Root cause
The CORS origin callback allows every origin, including rejected ones, with an explicit debugging comment:

```js
if (allowedOrigins.includes(origin)) {
  callback(null, true);
} else {
  console.warn('CORS blocked origin:', origin);
  callback(null, true); // Allow anyway for debugging - change to false in production
}
```
Combined with `credentials: true`, the server emits `Access-Control-Allow-Origin: <attacker>` and `Access-Control-Allow-Credentials: true` for **any** origin.

### Mitigating factor
Authentication is Bearer-header (`Authorization`) and there is **no cookie-based session** (grep found no `res.cookie`/`req.cookies`/`cookie-parser`). Bearer tokens are not auto-attached cross-origin the way cookies are, so the classical "CSRF + reflected-CORS" credential theft is largely neutered. The residual risk: if any session state ever moves to cookies, or if a same-site fetch relies on `credentials: 'include'` to attach other headers, the open CORS becomes exploitable immediately.

### Proposed remedy
Ship the production policy:

```js
if (allowedOrigins.includes(origin)) {
  callback(null, true);
} else {
  callback(null, false);   // or: new Error('Not allowed by CORS')
}
```
Keep the railway subdomain allowance only for known preview environments; gate it behind a non-production flag if needed.

---

## Finding S6 — TLS certificate verification disabled on admin-configured DB and SMTP connections

**Severity:** LOW
**Location:** `server/utils/email.js` (`rejectUnauthorized: false`, lines 115–116), `server/routes/admin.js` (`config.ssl = { rejectUnauthorized: false }`, lines 104, 1128, 1187).

### Root cause
SMTP (Brevo fallback / direct SMTP) and admin-configured external MySQL connections disable TLS verification, explicitly to tolerate self-signed certificates on shared hosting. This makes those connections blind to man-in-the-middle / certificate-spoofing attacks on the path between the CuraFlow server and the external DB or mail host.

### Proposed remedy
- Default to strict verification (`rejectUnauthorized: true`).
- Provide an explicit opt-in flag (`SMTP_ALLOW_INSECURE_TLS=1`, `DB_ALLOW_INSECURE_TLS=1`) rather than a hardcoded disable, and log a warning when it is in use.
- Where self-signed certs are genuinely required, support installing a custom CA rather than disabling verification.

---

## Finding S7 — Permission gates trust JWT `role` instead of DB state (compounds the permission-model review)

**Severity:** high (see [`SECURITY_REVIEW_ADMIN_PERMISSIONS.md`](./SECURITY_REVIEW_ADMIN_PERMISSIONS.md) Finding 4) — restated here because it is a *system-wide* pattern.

**Location:** `server/routes/dbProxy.js` (lines ~788–801) and `server/routes/atomic.js` (guards around lines 258–275, 311–327) write-gate `ShiftEntry`/`WishRequest`/`AbsenceRequest`.

### Root cause (system view)
Every permission guard computes `role`/`is_active`/`is_super_admin` from `req.user` (the JWT, see `SECURITY_REVIEW_ADMIN_PERMISSIONS.md` "Critical invariant"), and loads only `permissions` from the DB. A deactivated or demoted admin (`is_active=0` or `role`≠`'admin'` in the DB) is still treated as an active admin until the 24h JWT expires. `hasPermission` is lockout-safe (null permissions ⇒ all-true), so `SELECT ... WHERE is_active=1` returning no rows yields **full** write access rather than denial.

This is the same root class as S2: the server trusts the client-issued token's claims where it should re-read authoritative DB state.

### Proposed remedy
See the permission-model review for the per-handler fix. System-wide guidance: ensure every enforcement site that already does a DB lookup for `permissions` re-reads `role` and `is_active` in the same query and denies on mismatch, instead of trusting the JWT's `role`.

---

## Finding S8 — `/api/master/tisoware/query` is an authenticated arbitrary-read against an external HR system

**Severity:** LOW (by design; recorded as accepted risk)
**Location:** `server/routes/tisoware.js` `POST /query` (lines 297–326), gated by `authMiddleware` + `requirePermission('can_manage_system')`; execution via `server/utils/tisowarePhpProxy.js`.

### Root cause
The Tisoware DB Explorer passes a user-supplied SQL string to the PHP/ODBC proxy, scoped only by a `SELECT`/`WITH`-prefix check in `queryTisoware` (`server/utils/tisowareDataSource.js:60–62`) and `queryViaPhp`. That prefix check is **not** a security boundary — it does not prevent `UNION`, subqueries, `INTO`-less data exfiltration, or access to any table the TISO SQL login can read.

The subprocess path itself is safe: the SQL is written to the PHP process's **stdin** (`tisowarePhpProxy.js:149-150`), the script path is fixed (`tisowarePhpProxy.js:21`), `execPromise` uses static command strings (lines 166, 174, 183, 195) with no user interpolation. So this is **not** command injection — it is an intentional, permission-gated arbitrary-read surface.

### Concern
A `can_manage_system` admin gains full read of the external Tisoware time-tracking/personnel database. Treat `can_manage_system` as a high-trust capability equivalent to "read everything in Tisoware," and document that. If Tisoware holds highly sensitive data, consider restricting the allowed query shape (allowlist of tables/views) rather than free text.

### Proposed remedy (hardening, optional)
- Constrain the explorer to a allowlist of vetted views in Tisoware rather than raw table access.
- Apply a `maxRows` cap inside `queryViaPhp` (currently `queryTisoware` declares `maxRows=1000` but never applies it — `tisowareDataSource.js:59` ignores its own argument).
- Audit-log every `/query` invocation with actor + query text.

---

## Finding S9 — `runQuery` `maxRows` parameter silently ignored (Tisoware)

**Severity:** LOW
**Location:** `server/utils/tisowareDataSource.js` `queryTisoware(query, maxRows = 1000)` (lines 59–65) and `runQuery(query, maxRows = 1000)` (lines 384–387).

### Root cause
`maxRows` is accepted but never forwarded to `queryViaPhp` or applied; the PHP script receives the raw query. An admin `/query` against a large Tisoware table can pull unbounded rows, which is a resource-exhaustion / data-volume concern rather than a break-in.

### Proposed remedy
Either enforce `maxRows` (wrap the query or pass `TOP N` for SQL Server) or drop the misleading parameter. If enforcing, pre-validate the query wrapper does not alter semantics for `WITH` queries.

---

## Lower-severity / accepted-risk observations

- **`express.json` limit 10 MB globally** (`server/index.js:467`) is large for a scheduling API and raises the DoS floor for authenticated endpoints; consider a smaller global limit with per-route overrides for upload routes (the certificate route already uses its own 5 MB multer limit).
- **`app.set('trust proxy', 1)`** is appropriate for a single reverse proxy (Railway/Coolify) but should be revisited if additional proxy hops are introduced, to avoid IP-spoofing in rate-limit/audit logic.
- **Static SPA fallback** via `sendFile(path.join(distPath, htmlFile))` (`server/index.js:590`) and `express.static(distPath)` — both safe against `..` traversal (`express.static` sanitizes; the `htmlFile` is a ternary of two literals), so no path traversal here.
- **`pptugv` / phpMyAdmin fallback** in `master.js` programmatically logs into phpMyAdmin with stored credentials and scrapes an export. Not user-controllable (env-driven base URL/credentials), so not SSRF, but it surfaces credentials into a cookie and adds a fragile scraping path; prefer direct SQL access over the PMA fallback where possible.
- **Password diagnostics in `tisowareDataSource.js` `getConnectionStatus`** returns password shape information (length, quote-wrapping, `#` presence) in the response body to any `can_manage_system` admin. Low-impact (admin-only, true password never returned), but it leaks credential shape — consider server-log-only.

---

## Cross-cutting theme: trust boundaries

Three of the HIGH findings (S1, S2, S7) share one root cause pattern: **the server trusts client-supplied or token-supplied claims where it should consult authoritative, server-resolved state.**

- S1 trusts the request body's `entity` as a SQL identifier instead of validating it.
- S2 trusts the `X-DB-Token` header as the user's tenant instead of re-checking `allowed_tenants`.
- S7 trusts the JWT's `role` field instead of the DB's `role`/`is_active`.

A single remediation posture covers all three: at every enforcement boundary, resolve the *authoritative* value from the database (valid identifier set, allowed-tenant list, current user row) and reject when the client-supplied value does not match. Combined with the permission-model fixes in [`SECURITY_REVIEW_ADMIN_PERMISSIONS.md`](./SECURITY_REVIEW_ADMIN_PERMISSIONS.md), this closes the end-to-end escalation/bypass paths.

---

## Verification performed

- `authMiddleware` (`server/routes/auth.js:187–203`) sets `req.user` to the decoded JWT; login token (`server/routes/auth.js:315–320`) carries only `sub/email/role/doctor_id` with `expiresIn: '24h'`.
- No `multipleStatements` option on any mysql2 pool (`server/index.js:252,309`; `server/utils/mysqlConfig.js`).
- No cookie-based auth: `res.cookie`/`req.cookies`/`cookie-parser` absent across `server/`.
- `tenantDbMiddleware` (`server/index.js:342–398`) does not consult `allowed_tenants` before routing `req.db`.
- `tableName` interpolated into SQL with no identifier validation (`server/routes/dbProxy.js`); column names are filtered against `SHOW COLUMNS` results.
- `tisowarePhpProxy.js` spawns a fixed script path and passes SQL via stdin (no shell); `execPromise` uses static commands only.
- `db_token` placed in an email link (`server/routes/certificates.js:278`); JWT placed in a URL for SSE (`server/routes/auth.js:43`).
- Certificates upload/download: parameterized SQL, tenant-key scoping, MIME allowlist, `Content-Disposition` sanitization (`server/routes/certificates.js`).
- `getTisowareTableColumns`/`getTisowareTableSample` sanitize schema/table via whitelist regex (`server/utils/tisowareDataSource.js:95–97,120–122`) — contrast with dbProxy, which does not.

## Scope and limits

- Static review only; no runtime exploitation, no fuzzing, no dependency-CVE database scan (versions were spot-checked against known-bad ranges but not formally audited).
- Frontend (`src/`) reviewed only where it shapes request payloads (e.g. reorder `{order}` bypass, dialog granting) — see the permission-model review.
- Secrets management, infrastructure, and deployment hardening (Coolify/Traefik/Railway) are out of scope except where they touch app code.
- No fixes have been applied — this document is a report only, per request.
