# Security Review — Admin Fine-Grained Permissions

**Reviewed scope:** The admin role-scoping / permission system.
**Date:** 2026-07-08
**Overall verdict:** The permission *data model* and *enforcement wiring* are sound in design, but several enforcement sites trust the JWT payload or the client request body where they must not, producing privilege-escalation and bypass paths. **Findings 1–3 are HIGH and should be fixed before this permission model is treated as a security boundary.**

---

## Background — how the permission model is supposed to work

- Permission keys are defined in `server/utils/permissions.js` (`PERMISSION_KEYS`, 13 keys) and mirrored client-side in `src/lib/permissions.ts`.
- Per-admin permissions are stored as a JSON column `app_users.permissions` (NULL ⇒ full access, lockout-safe).
- Super-admins (`SUPER_ADMINS_EMAILS` env var, semicolon-separated) bypass all checks.
- `requirePermission(key)` middleware is mounted on admin route handlers; it loads `app_users.permissions` from the master DB on every request so permission changes take effect immediately.
- Write guards in `server/routes/dbProxy.js` and `server/routes/atomic.js` gate protected tables (`ShiftEntry` → `can_edit_schedule`, `WishRequest` → `can_approve_wishes`, `AbsenceRequest` → `can_approve_absence`).

**Critical invariant — where state comes from:**
JWTs are issued at login in `server/routes/auth.js` with payload `{ sub, email, role, doctor_id }` only:

```js
const token = createToken({
  sub: user.id,
  email: user.email,
  role: user.role,
  doctor_id: user.doctor_id
});
```

`authMiddleware` (`authMiddleware`, `server/routes/auth.js:187`) sets `req.user = payload` — **the bare decoded JWT**. The token carries **no `permissions`, no `is_active`, no `is_super_admin`**, and lives for `TOKEN_EXPIRY = '24h'` (`server/routes/auth.js:15`). Every finding below follows from code paths that trust this thin JWT or the client request body instead of re-loading authoritative state from the DB.

---

## Finding 1 — Privilege escalation on user registration

**Severity:** HIGH
**Likelihood:** High (single API call, authenticated admin)
**Impact:** A restricted admin (e.g. only `can_manage_users`) can create a new admin account with **all 13 permissions**.

### Location
`server/routes/auth.js`, `POST /register` handler, lines ~332–389.

### Root cause
The handler copies the requesting admin's ("granter's") permissions into the new user:

```js
let permissions = null;
if (role === 'admin') {
  const granterPerms = loadPermissions(req.user);   // ← req.user is the bare JWT
  permissions = JSON.stringify(granterPerms);
}
```

But `req.user` is the decoded JWT, which has **no `permissions` field**. `loadPermissions()` therefore reaches the "lockout-safe" branch (`server/utils/permissions.js:105–108`) and returns `ALL_PERMISSIONS_TRUE`:

```js
// Lockout-safe: missing / empty → full access
if (!stored || typeof stored !== 'object' || Array.isArray(stored)) {
  return { ...ALL_PERMISSIONS_TRUE };
}
```

The new admin is stored with every permission set to `true`, defeating the documented invariant ("so the granter cannot give more than they have").

### Failure scenario
1. Admin *A* is configured with only `can_manage_users = true`; all other 12 keys are `false` (their stored `permissions` JSON reflects this).
2. *A* authenticates; their JWT is `{ sub, email, role:'admin', doctor_id }` — `permissions` absent.
3. *A* calls `POST /api/auth/register` with `{ email, password, role:'admin' }`. The `requirePermission('can_manage_users')` gate passes (A has that key).
4. `loadPermissions(req.user)` sees `req.user.permissions === undefined` → returns `ALL_PERMISSIONS_TRUE`.
5. The new admin is INSERTed with `permissions = '{"can_manage_users":true,...all 13...}'` — **full access**, exceeding what *A* actually holds.

### Proposed remedy
Load the granter's **authoritative** permissions from the DB by `req.user.sub`, not from the JWT. Then intersect the requested permissions with the granter's before storing — a granter may never grant a permission they lack, and any key they lack must be forced to `false` in the new user:

```js
// Load granter's real permissions from DB (not the JWT)
const [granterRows] = await db.execute(
  'SELECT permissions FROM app_users WHERE id = ? AND is_active = 1',
  [req.user.sub],
);
const granterPerms = loadPermissions({ ...req.user, permissions: granterRows[0]?.permissions ?? null });

// Intersect: new admin can never hold a permission the granter lacks
const newPerms = { ...ALL_PERMISSIONS_TRUE };
for (const key of PERMISSION_KEYS) {
  if (granterPerms[key] === false) newPerms[key] = false;   // force-revoke
}
permissions = JSON.stringify(newPerms);
```

(Exception: super-admins retain their full-access bypass in `loadPermissions`.) Export `PERMISSION_KEYS` and `ALL_PERMISSIONS_TRUE` if not already importable by `auth.js`.

---

## Finding 2 — Privilege escalation on promote-to-admin (PATCH /users/:userId)

**Severity:** HIGH
**Likelihood:** High
**Impact:** A restricted admin can promote an existing user to admin with full permissions, the same escalation as Finding 1 via a different endpoint.

### Location
`server/routes/auth.js`, `PATCH /users/:userId`, lines ~533–569.

### Root cause
Identical to Finding 1. The promotion-to-admin path inherits the granter's permissions:

```js
if (data.role === 'admin' && data.permissions === undefined) {
  const granterPerms = loadPermissions(req.user);   // ← bare JWT again
  data.permissions = granterPerms;
}
```

`req.user.permissions` is undefined, so `loadPermissions` returns `ALL_PERMISSIONS_TRUE`, and the promoted user is stored with full access.

### Failure scenario
1. Admin *A* (restricted to `can_manage_users`) patches an existing user with `{ role: 'admin' }` and no explicit `permissions`.
2. The inheritance block sets `data.permissions = loadPermissions(req.user) = ALL_PERMISSIONS_TRUE`.
3. The PATCH writes the user's `permissions` column to all-true. The promoted user now has capabilities *A* never had.

Additionally, when `_explicit_` `data.permissions` IS sent (the dialog path, see Finding 3), no interception-clamp occurs — the client-supplied permission object is stored verbatim (`'permissions'` is in `allowedFields`), so a restricted granter can grant any individual permission by name.

### Proposed remedy
Same DB-backed granter loading as Finding 1, applied in **both** branches (explicit and inherited permissions):

```js
const [granterRows] = await db.execute(
  'SELECT permissions FROM app_users WHERE id = ? AND is_active = 1',
  [req.user.sub],
);
const granterPerms = loadPermissions({ ...req.user, permissions: granterRows[0]?.permissions ?? null });

if (data.role === 'admin') {
  if (data.permissions === undefined) data.permissions = granterPerms;
  // Clamp: whatever permissions object we are about to store, force-revoke
  // anything the granter themselves lacks.
  const incoming = (typeof data.permissions === 'string')
    ? JSON.parse(data.permissions) : data.permissions;
  const clamped = { ...ALL_PERMISSIONS_TRUE };
  for (const key of PERMISSION_KEYS) {
    if (granterPerms[key] === false) clamped[key] = false;
    else clamped[key] = incoming?.[key] !== false;   // honor explicit revocation
  }
  data.permissions = clamped;
}
```

(Super-admins bypass via `loadPermissions`.)

---

## Finding 3 — Client-side dialog grants permissions the granter lacks

**Severity:** HIGH
**Likelihood:** Medium (requires `can_manage_users` admin; UI-mediated)
**Impact:** A restricted admin can grant any permission to other admins via the permissions dialog, independent of their own assigned permissions.

### Location
`src/components/admin/UserPermissionsDialog.tsx` (dialog) + `server/routes/auth.js` `PATCH /users/:userId` (storage).

### Root cause
The dialog initialises every permission checkbox to `true` by default for any key the target does not **explicitly** have set to `false`:

```js
for (const key of PERMISSION_KEYS) {
  if (user.permissions?.[key] === false) perms[key] = false;
  else perms[key] = true;          // defaults to GRANTABLE
}
```

So a granter who themselves lacks `can_manage_system` can nonetheless open the dialog (it is disabled only when `!canEdit || isSuperAdmin`, where `canEdit` checks only `can_manage_users`), see the checkbox `true`, and save it. The server (Finding 2) stores it verbatim because `allowedFields` includes `'permissions'` and no clamp runs.

### Failure scenario
1. Admin *A* has `can_manage_users=true`, `can_manage_system=false`.
2. *A* opens *B* in the permissions dialog. `can_manage_system` checkbox renders as `true` (default).
3. *A* clicks **Speichern** → `api.updateUser(B, { permissions: localPerms })` with `can_manage_system:true`.
4. Server PATCH stores `permissions` verbatim. *B* now has `can_manage_system`, which *A* never had.

### Proposed remedy
- **Frontend:** render a permission checkbox as `disabled` (and checked=false) for any key the **current user** lacks, so restricted granteers cannot offer capabilities they don't hold:
  ```js
  const granterLacks = !hasPermission(currentUser, key);
  const disabled = !canEdit || isSuperAdmin || granterLacks;
  ```
- **Backend (defence in depth):** enforce the clamp in `PATCH /users/:userId` as shown in Finding 2 — never trust the client's permission object; always intersect it with the granter's DB-loaded real permissions. The backend clamp is the authoritative control; the frontend hint is UX.

---

## Finding 4 — Deactivated / demoted admins retain write access until token expiry (24h)

**Severity:** HIGH
**Likelihood:** Medium (requires an admin to be deactivated/demoted while holding a live token)
**Impact:** Revocation of an admin (set `is_active=0` or `role`≠`'admin'`) does not take effect on protected writes for up to 24 hours.

### Location
`server/utils/permissions.js` `loadPermissions` (lines ~84–108) and `server/utils/permissions.js` `hasPermission` (lines ~122–128), as invoked from `server/routes/dbProxy.js` (lines ~788–801) and `server/routes/atomic.js` (guards around lines ~258–275, ~311–327).

### Root cause
The write guards load `permissions` from the DB (`SELECT permissions FROM app_users WHERE id = ? AND is_active = 1`), but compute the **role/super-admin** state from the **decoded JWT**, not the DB row:

```js
const effectiveUser = { ...req.user, permissions: permRows[0]?.permissions ?? null };
hasPerm = req.user?.role === 'admin' && hasPermission(effectiveUser, requiredPerm);
```

When the user has been deactivated (`is_active=0`), the `WHERE is_active = 1` filter returns **no rows**, so `permissions` is `null`. `loadPermissions()` then hits the lockout-safe branch and returns `ALL_PERMISSIONS_TRUE`, and the stale `req.user.role === 'admin'` from the JWT makes `hasPermission` return `true`. Role demotion (`role` changed away from `'admin'` in the DB) is also invisible, because `role` is read from `req.user` (JWT), not the DB.

### Failure scenario
1. Super-admin sets admin *A* to `is_active = 0` (or changes `role` to `'user'`) at 09:00.
2. *A*'s previously-issued JWT (role `'admin'`, valid for 24h) is still usable.
3. Until the token expires, *A* can still `POST /api/atomic` or `POST /api/db` writes; the guard's DB lookup returns no rows → `permissions null` → `ALL_PERMISSIONS_TRUE` → `hasPermission` → `true`.
4. Revocation does not take effect for up to 24 hours.

### Proposed remedy
Load the **authoritative role and active state** from the same DB row the guard already queries, and deny when the row is missing or the role is no longer `admin`:

```js
const [userRows] = await db.execute(
  'SELECT role, is_active, permissions FROM app_users WHERE id = ?',
  [req.user.sub],
);
const dbUser = userRows[0];
if (!dbUser || !dbUser.is_active || dbUser.role !== 'admin') {
  return res.status(403).json({ error: '...', missingPermission: requiredPerm });
}
const effectiveUser = { ...req.user, role: dbUser.role, permissions: dbUser.permissions };
hasPerm = hasPermission(effectiveUser, requiredPerm);
```

(Drop the `is_active = 1` filter and check `is_active` in code so a deactivated user is observably denied rather than masked as "lockout-safe full access".) Consider also shortening `TOKEN_EXPIRY` and/or implementing a token revocation list as a longer-term control.

---

## Finding 5 — ShiftEntry permission guard bypassed by partial-position updates

**Severity:** MEDIUM
**Likelihood:** Medium (the bypass is reachable through a normal UI operation; impact limited to schedule edits)
**Impact:** An admin without `can_edit_schedule` can modify Dienste shifts by sending an update that omits the `position` field, because the guard inspects only `data.position`.

### Location
`server/routes/dbProxy.js`, ShiftEntry write-guard block, lines ~758–785 (`extractPositionNamesFromShiftData`, called at ~759) and `server/routes/dbProxy.js` `extractPositionNamesFromShiftData` (lines ~612–633).

### Root cause
For `ShiftEntry` writes the guard decides whether to apply the `can_edit_schedule` check based on the position(s) reported in the payload only:

```js
const positions = extractPositionNamesFromShiftData(req.body);
...
const isDienste = positions.length > 0
  ? (await Promise.all(positions.map((p) => isServicePosition(dbPool, p)))).some(Boolean)
  : false;
shouldCheckPermission = isDienste;
```

`extractPositionNamesFromShiftData` returns `data?.position` for `create`/`update` and the `position` of each item for `bulkCreate`. For a `delete` it returns `[]` but the guard separately looks up the existing record's `position`. For **`update`** and **`bulkCreate`** with no `position` field in the payload, `positions` is `[]` → `isDienste = false` → the permission check is skipped entirely.

The atomic path is more careful — it uses `data?.position || current.position` (fetching the existing record) — confirming the dbProxy `update` path is the inconsistent, weaker one.

### Failure scenario
1. Admin *A* lacks `can_edit_schedule`.
2. *A* reorders shifts within a cell. The UI (`src/components/schedule/ScheduleBoard.jsx:4577`) issues `db.ShiftEntry.update(id, { order: index })` — no `position` field.
3. dbProxy: `extractPositionNamesFromShiftData` → `[]` → `isDienste false` → `shouldCheckPermission false` → no 403. The reorder commits on a Dienste shift.
4. Any direct client call `POST /api/db { action:'update', entity:'ShiftEntry', id, data:{ doctor_id } }` (reassign a Dienste shift without sending `position`) likewise bypasses the guard, including doctor reassignment.

### Proposed remedy
For `update` on `ShiftEntry` where `data.position` is absent, fetch the existing record's position before deciding — mirroring the `delete` path and the atomic guard:

```js
if (effectiveAction === 'update' && id && !extractPositionNamesFromShiftData(req.body).length) {
  try {
    const [shiftRows] = await dbPool.execute(
      'SELECT position FROM ShiftEntry WHERE id = ? LIMIT 1', [id],
    );
    if (shiftRows[0]?.position) positions.push(shiftRows[0].position);
  } catch { /* fall through to default-deny (see Finding 6) */ }
}
```

Better: treat "could not determine whether this is a Dienste write" as **deny-by-default** rather than allow-by-default.

---

## Finding 6 — Permission guard fails open on DB lookup errors

**Severity:** MEDIUM
**Likelihood:** Low (requires a transient DB error in the Workplace/admin lookup during a protected write)
**Impact:** If `isServicePosition` or the `app_users` lookup throws, the guard silently skips the permission check, allowing the write.

### Location
`server/routes/dbProxy.js` `isServicePosition` (lines ~595–606), the `app_users` permission lookup (lines ~788–795); `server/routes/atomic.js` `isServicePosition` (lines ~57–70) and the same lookup at ~266–275 / ~311–327.

### Root cause
Both lookup helpers swallow errors and return a fail-open value:

```js
async function isServicePosition(dbPool, positionName) {
  if (!positionName) return false;
  try {
    const [rows] = await dbPool.execute(...);
    return rows.length > 0 && rows[0].category === 'Dienste';
  } catch {
    return false;          // ← error ⇒ treat as "not a protected write" ⇒ bypass
  }
}
```

A transient DB error on the tenant pool (whose schema may not yet exist, or a query timeout) makes `isDienste === false`, skipping `can_edit_schedule`. Net effect: a momentary error converts a permission-gated write into an ungated one. Reliability/availability aside, this is the opposite of least-privilege.

### Proposed remedy
Fail closed. On lookup error, treat the write as protected and require the permission (or 503):

```js
} catch (err) {
  console.error('[permissions] isServicePosition lookup failed:', err);
  // Could not determine category → require the permission to be safe.
  return true;     // or: surface a 500/503 and let the client retry
}
```
For the `app_users` permission lookup, on `catch` today the code falls through to `hasPerm = false ... return 403` — that direction is already correct in `requirePermission` (deny on DB error) but the inline guards in dbProxy/atomic also rely on `hasPerm` defaulting to `false`, which is correct. Keep that direction consistent and make the `isServicePosition` failure mode match (deny-by-default), as above.

---

## Lower-severity observations (not blocking)

- **`$ne` short-circuits range operators in the test util filter** (`src/test-utils/server.js:64`): a query combining `$ne` with `$gte`/`$lte` silently skips the range checks. Test-only (MSW mock); no app path sends that combination. Latent, not live.
- **`window.alert` on every gated 403 write** (`src/api/client.ts:316–331`): a burst of denied writes produces a burst of modal alerts. UX, not security.
- **Backfill migration omits three newer keys** (`server/utils/masterMigrations.js` `add_app_user_permissions`): the backfill object lists 10 of 13 keys, but `loadPermissions` defaults missing keys to `true`, so there is no lockout. Cosmetic consistency only.
- **Indentation drift** in `src/test-utils/server.js` re-indents pre-existing lines; unrelated to security.

---

## Verification performed

- Confirmed `authMiddleware` (`server/routes/auth.js:187–203`) sets `req.user` to the **decoded JWT**, not a DB-loaded user.
- Confirmed the login token (`server/routes/auth.js:315–320`) carries only `{ sub, email, role, doctor_id }` and is signed with `expiresIn: '24h'` (`TOKEN_EXPIRY`, `server/routes/auth.js:15`).
- Confirmed `loadPermissions` returns `ALL_PERMISSIONS_TRUE` when its input has no/invalid `permissions` (`server/utils/permissions.js:105–108`).
- Confirmed the reorder code path sends `{ order: index }` with no `position` (`src/components/schedule/ScheduleBoard.jsx:4575–4579`).
- Confirmed both `WishRequest` and `AbsenceRequest` carry a `status` column (so the approval-gating lookup is not vacuous): `server/scripts/seed-runtime-shared.js:144`, `server/utils/masterMigrations.js` `AbsenceRequest` definition.
- Confirmed `requirePermission` does NOT mutate `req.user`, so the inheritance paths in Findings 1–2 see the bare JWT.

## Scope and limits

- This review covers the **permission enforcement** code paths. It does not audit the broader auth/JWT rotation, tenant isolation, or rate-limiting surface.
- The findings are static-analysis-verifed against the code as of the reviewed commit. "Likelihood" reflects reachability under realistic operator workflows, not active exploitation evidence.
- No fixes have been applied; this document is a report only, per request.
