/**
 * Permission-based access control for Admin role-scoping.
 *
 * Admins can be restricted to specific functional areas instead of
 * having full access.  The permissions are stored as a JSON column
 * (`app_users.permissions`) in the master DB.
 *
 * A permission key that is missing, NULL, or set to `true` grants access;
 * explicitly setting a key to `false` revokes it.
 *
 * Super-admins (defined via the `SUPER_ADMINS_EMAILS` env var,
 * semicolon-separated) always have full access regardless of the stored
 * permissions object.
 */

// ─── Constants ───────────────────────────────────────────────────────────────

import { db } from '../index.js';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import type { Request, Response, NextFunction, RequestHandler } from 'express';

export const PERMISSION_KEYS = [
  'can_manage_users',
  'can_approve_absence',
  'can_manage_master_data',
  'can_link_employees',
  'can_manage_groups',
  'can_manage_workplace_links',
  'can_manage_shift_vacation',
  'can_manage_system',
  'can_manage_cowork',
  'can_approve_wishes',
  'can_send_schedule_emails',
  'can_assign_pool_shifts',
  'can_edit_schedule',
] as const;

export type PermissionKey = typeof PERMISSION_KEYS[number];

interface PermissionsMap {
  [key: string]: boolean | null | undefined;
}

/** Object with every permission key set to `true`. */
export const ALL_PERMISSIONS_TRUE = Object.fromEntries(
  PERMISSION_KEYS.map((key) => [key, true]),
) as Record<PermissionKey, true>;

interface PermissionUserInput {
  role?: string;
  email?: string;
  permissions?: unknown;
}

function isPermissionObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Force-revoke any permission key the granter themselves lacks (F1/F2/F3).
 *
 * Used by the register / promote-to-admin paths to guarantee a granter can
 * never grant a capability they do not hold: for every key where the granter's
 * effective permissions are `false`, the clamped result is `false` regardless
 * of the incoming value. For keys the granter has, the incoming explicit choice
 * is honored. Missing keys default to `true` (lockout-safe).
 *
 * @param incoming - Requested permissions object.
 * @param granterPerms - The granter's effective permissions (from
 *   `loadPermissions`).
 * @returns A flat record of `{ permission_key: boolean }`.
 */
export function clampPermissionsToGranter(
  incoming: PermissionsMap | null | undefined,
  granterPerms: PermissionsMap,
): Record<PermissionKey, boolean> {
  const incomingRecord = isPermissionObject(incoming) ? incoming : (incoming || {});
  const clamped: Record<PermissionKey, boolean> = {
    ...ALL_PERMISSIONS_TRUE,
    ...incomingRecord,
  } as Record<PermissionKey, boolean>;
  for (const key of PERMISSION_KEYS) {
    if (granterPerms[key] === false) clamped[key] = false;
  }
  return clamped;
}

// ─── Super-Admin helpers ─────────────────────────────────────────────────────

/**
 * Return the list of super-admin email addresses (lowercased, trimmed)
 * from the `SUPER_ADMINS_EMAILS` environment variable.
 *
 * The env var uses **semicolons** as the delimiter (e.g.
 * `admin@example.com;super@hospital.org`).
 */
function getSuperAdminEmails(): string[] {
  const raw = process.env.SUPER_ADMINS_EMAILS || '';
  return raw
    .split(';')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Returns `true` if the given email belongs to a configured super-admin.
 *
 * Super-admins bypass all permission checks — they always have full access
 * and cannot be restricted via the UI.
 */
export function isSuperAdmin(email: string | null | undefined): boolean {
  if (!email) return false;
  const normalized = String(email).trim().toLowerCase();
  return getSuperAdminEmails().includes(normalized);
}

// ─── Permission resolution ───────────────────────────────────────────────────

/**
 * Load the effective permissions for a user.
 *
 * Rules:
 * 1. Non-admin roles → empty object (no admin permissions).
 * 2. Super-admins → all permissions true (bypass).
 * 3. Admin with NULL/empty/malformed permissions → all true (lockout-safe).
 * 4. Admin with valid permissions object → merge over defaults (missing keys = true).
 *
 * @param user - The user row/object (must have `role` and `permissions`).
 * @returns A flat record of `{ permission_key: boolean }`.
 */
export function loadPermissions(
  user: PermissionUserInput | null | undefined,
): Record<string, boolean> {
  if (!user || user.role !== 'admin') {
    return {};
  }

  if (isSuperAdmin(user.email)) {
    return { ...ALL_PERMISSIONS_TRUE };
  }

  // Parse the stored permissions JSON
  let stored: unknown = null;
  if (user.permissions) {
    try {
      stored = typeof user.permissions === 'string'
        ? JSON.parse(user.permissions)
        : user.permissions;
    } catch {
      stored = null;
    }
  }

  // Lockout-safe: missing / empty → full access
  if (!isPermissionObject(stored)) {
    return { ...ALL_PERMISSIONS_TRUE };
  }

  // Merge: every key defaults to `true` unless explicitly set to `false`
  const result: Record<PermissionKey, boolean> = { ...ALL_PERMISSIONS_TRUE };
  for (const key of PERMISSION_KEYS) {
    if (stored[key] === false) {
      result[key] = false;
    }
  }
  return result;
}

/**
 * Check whether a user has a specific permission.
 *
 * @param user - User object (from `req.user` or similar).
 * @param key - One of `PERMISSION_KEYS`.
 * @returns `true` if the permission is granted.
 */
export function hasPermission(
  user: PermissionUserInput | null | undefined,
  key: PermissionKey,
): boolean {
  if (!user || user.role !== 'admin') return false;
  if (isSuperAdmin(user.email)) return true;
  const perms = loadPermissions(user);
  return perms[key] === true;
}

// ─── Express middleware ──────────────────────────────────────────────────────

interface AuthenticatedRequest extends Request {
  user: {
    sub?: string;
    email?: string;
    role?: string;
    permissions?: unknown;
  };
}

/**
 * Express middleware factory that checks for a specific admin permission.
 *
 * Usage:
 * ```js
 * import { requirePermission } from '../utils/permissions.js';
 *
 * router.post('/some-admin-endpoint',
 *   authMiddleware,
 *   requirePermission('can_manage_users'),
 *   handler);
 * ```
 *
 * The middleware expects `authMiddleware` to have populated `req.user`
 * (JWT payload with at least `sub` = user ID). It loads the current
 * permissions from the master database on every request, so that
 * permission changes take effect immediately without re-login.
 *
 * @param permissionKey - One of `PERMISSION_KEYS`.
 * @returns Express middleware.
 */
export function requirePermission(permissionKey: PermissionKey): RequestHandler {
  if (!PERMISSION_KEYS.includes(permissionKey)) {
    throw new Error(
      `Unknown permission key "${permissionKey}". `
      + `Valid keys: ${PERMISSION_KEYS.join(', ')}`,
    );
  }

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const authReq = req as AuthenticatedRequest;
    if (!authReq.user) {
      res.status(401).json({ error: 'Nicht autorisiert' });
      return;
    }

    if (authReq.user.role !== 'admin') {
      res.status(403).json({ error: 'Nur Administratoren haben Zugriff' });
      return;
    }

    // Super-Admin: immer Zugriff, kein DB-Lookup nötig
    if (isSuperAdmin(authReq.user.email)) {
      console.debug('[permissions] Super-Admin bypass:', authReq.user.email, 'key:', permissionKey);
      next();
      return;
    }

    // Load current permissions from master DB
    const masterDb: Pool = db;
    let permissionsRaw: unknown = null;
    try {
      const [rows] = await masterDb.execute<RowDataPacket[]>(
        'SELECT permissions FROM app_users WHERE id = ? AND is_active = 1',
        [authReq.user.sub],
      );
      permissionsRaw = rows[0]?.permissions ?? null;
      console.debug('[permissions] DB lookup for', authReq.user.email, 'key:', permissionKey, 'raw:', permissionsRaw ? '(has data)' : '(null/empty)');
    } catch (err) {
      console.error('[permissions] DB lookup error:', err);
      // Bei DB-Fehler: Zugriff verweigern (sicherer als alles erlauben)
      res.status(500).json({ error: 'Fehler bei der Berechtigungsprüfung' });
      return;
    }

    // Build effective user object with DB-loaded permissions
    const effectiveUser = { ...authReq.user, permissions: permissionsRaw };

    if (!hasPermission(effectiveUser, permissionKey)) {
      console.debug('[permissions] DENIED:', authReq.user.email, 'key:', permissionKey);
      res.status(403).json({
        error: 'Ihnen fehlt die Berechtigung für diese Aktion',
        missingPermission: permissionKey,
      });
      return;
    }

    console.debug('[permissions] GRANTED:', authReq.user.email, 'key:', permissionKey);
    next();
  };
}

// ─── DB-backed enforcement helper ────────────────────────────────────────────

interface AppUserRow extends RowDataPacket {
  email: string;
  role: string;
  is_active: number | boolean;
  permissions: unknown;
}

interface AdminPermissionResult {
  allowed: boolean;
  reason: string;
}

/**
 * Resolve the authoritative admin state for a user from the master DB and
 * check a single permission.
 *
 * This is the security-critical counterpart to `requirePermission` for inline
 * write guards (dbProxy/atomic). Unlike the older inline pattern, it reads
 * `role` and `is_active` from the DB row — **not** the JWT — so a deactivated
 * or demoted admin is denied immediately rather than for up to `TOKEN_EXPIRY`
 * (see SECURITY_REVIEW_SYSTEM.md Finding S7 / ADMIN_PERMISSIONS Finding 4).
 *
 * The query deliberately omits the `is_active = 1` *filter* and checks
 * `is_active` in code: with the filter, a deactivated user returns no row,
 * which made `loadPermissions` hit its lockout-safe branch
 * (`null` → `ALL_PERMISSIONS_TRUE`) and silently grant full access. Here a
 * missing/inactive/non-admin row is an explicit denial.
 *
 * Fail-closed: a DB error rejects (`allowed: false, reason: 'error'`) — the
 * caller's surrounding try/catch already denies on false.
 *
 * @param masterDb - Master mysql2 pool.
 * @param userId - `app_users.id` (JWT `sub`).
 * @param permissionKey - One of `PERMISSION_KEYS`.
 * @returns Permission check result.
 */
export async function checkAdminPermission(
  masterDb: Pool,
  userId: string,
  permissionKey: PermissionKey,
): Promise<AdminPermissionResult> {
  let rows: AppUserRow[];
  try {
    [rows] = await masterDb.execute<AppUserRow[]>(
      'SELECT email, role, is_active, permissions FROM app_users WHERE id = ?',
      [userId],
    );
  } catch (err) {
    console.error('[permissions] checkAdminPermission DB error:', err instanceof Error ? err.message : String(err));
    return { allowed: false, reason: 'error' };
  }

  const row = rows?.[0];
  if (!row) return { allowed: false, reason: 'no_user' };
  if (!row.is_active) return { allowed: false, reason: 'inactive' };
  if (isSuperAdmin(row.email)) return { allowed: true, reason: 'super_admin' };
  if (row.role !== 'admin') return { allowed: false, reason: 'not_admin' };

  // role from the DB row, not the JWT
  const effectiveUser = { ...row, role: row.role, permissions: row.permissions };
  return { allowed: hasPermission(effectiveUser, permissionKey), reason: 'checked' };
}
