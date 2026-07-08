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
];

/** Object with every permission key set to `true`. */
export const ALL_PERMISSIONS_TRUE = Object.fromEntries(
  PERMISSION_KEYS.map((key) => [key, true]),
);

// ─── Super-Admin helpers ─────────────────────────────────────────────────────

/**
 * Return the list of super-admin email addresses (lowercased, trimmed)
 * from the `SUPER_ADMINS_EMAILS` environment variable.
 *
 * The env var uses **semicolons** as the delimiter (e.g.
 * `admin@example.com;super@hospital.org`).
 */
function getSuperAdminEmails() {
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
export function isSuperAdmin(email) {
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
 * @param {object} user - The user row/object (must have `role` and `permissions`).
 * @returns {object} A flat record of `{ permission_key: boolean }`.
 */
export function loadPermissions(user) {
  if (!user || user.role !== 'admin') {
    return {};
  }

  if (isSuperAdmin(user.email)) {
    return { ...ALL_PERMISSIONS_TRUE };
  }

  // Parse the stored permissions JSON
  let stored = null;
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
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) {
    return { ...ALL_PERMISSIONS_TRUE };
  }

  // Merge: every key defaults to `true` unless explicitly set to `false`
  const result = { ...ALL_PERMISSIONS_TRUE };
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
 * @param {object} user - User object (from `req.user` or similar).
 * @param {string} key - One of `PERMISSION_KEYS`.
 * @returns {boolean}
 */
export function hasPermission(user, key) {
  if (!user || user.role !== 'admin') return false;
  if (isSuperAdmin(user.email)) return true;
  const perms = loadPermissions(user);
  return perms[key] === true;
}

// ─── Express middleware ──────────────────────────────────────────────────────

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
 * @param {string} permissionKey - One of `PERMISSION_KEYS`.
 * @returns {Function} Express middleware.
 */
export function requirePermission(permissionKey) {
  if (!PERMISSION_KEYS.includes(permissionKey)) {
    throw new Error(
      `Unknown permission key "${permissionKey}". `
      + `Valid keys: ${PERMISSION_KEYS.join(', ')}`,
    );
  }

  return async (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Nicht autorisiert' });
    }

    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Nur Administratoren haben Zugriff' });
    }

    // Load current permissions from DB (JWT does not contain permissions)
    // This ensures permission changes take effect immediately.
    try {
      const { db } = await import('../index.js');
      const [rows] = await db.execute(
        'SELECT permissions FROM app_users WHERE id = ? AND is_active = 1',
        [req.user.sub],
      );
      const dbUser = rows[0] || {};
      req.user.permissions = dbUser.permissions || null;
    } catch (err) {
      console.error('[permissions] DB lookup failed:', err.message);
      // Lockout-safe on DB error: fall back to no restrictions
      req.user.permissions = null;
    }

    if (!hasPermission(req.user, permissionKey)) {
      return res.status(403).json({
        error: 'Ihnen fehlt die Berechtigung für diese Aktion',
        missingPermission: permissionKey,
      });
    }

    next();
  };
}
