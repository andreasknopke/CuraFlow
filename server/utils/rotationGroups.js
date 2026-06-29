/**
 * Helpers for rotation_group (Springerpool-Rotationen) feature.
 *
 * This is a SEPARATE system from tenant_group (cross-tenant Dienste).
 * Rotationen sind keine Dienste — they have their own tables, routes, and
 * permissions. See docs/features/SPRINGERPOOL_ROTATION_V2.md.
 *
 * All data lives in the master DB. Permission columns on app_users:
 *   - allowed_rotation_groups (JSON array of group ids) — read access
 *   - rotation_admin_groups   (JSON array of group ids) — write access
 *
 * Membership in rotation_group_member carries a role:
 *   - 'pool'  → the Springerpool tenant (exactly one per group)
 *   - 'ward'  → a department tenant served by the pool (N per group)
 */

function parseJsonArray(raw) {
  if (raw === null || raw === undefined || raw === '') return null;
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Parse `allowed_rotation_groups` from an app_users row.
 * @returns {number[] | null} list of group ids; null means "no rotation access"
 */
export function parseAllowedRotationGroups(raw) {
  const list = parseJsonArray(raw);
  if (!list) return null;
  const ids = list.map((v) => Number(v)).filter((n) => Number.isInteger(n));
  return ids.length > 0 ? ids : null;
}

/**
 * Parse `rotation_admin_groups` from an app_users row.
 * @returns {number[] | null}
 */
export function parseRotationAdminGroups(raw) {
  return parseAllowedRotationGroups(raw);
}

/**
 * Load the user record needed for rotation permission checks.
 * Returns null when the user is not found or inactive.
 */
export async function loadUserRotationContext(masterDb, userId) {
  const [rows] = await masterDb.execute(
    'SELECT id, role, allowed_rotation_groups, rotation_admin_groups FROM app_users WHERE id = ? AND is_active = 1',
    [userId]
  );
  if (rows.length === 0) return null;
  const row = rows[0];
  return {
    id: row.id,
    role: row.role,
    isMasterAdmin: row.role === 'admin',
    allowedGroups: parseAllowedRotationGroups(row.allowed_rotation_groups),
    adminGroups: parseRotationAdminGroups(row.rotation_admin_groups),
  };
}

/**
 * Check whether the user may read a given rotation group.
 * Master admins always have access.
 */
export function canReadRotationGroup(ctx, groupId) {
  if (!ctx) return false;
  if (ctx.isMasterAdmin) return true;
  const list = ctx.allowedGroups;
  return Array.isArray(list) && list.includes(Number(groupId));
}

/**
 * Check whether the user may modify rotation data for a group
 * (assign springers, manage workplaces, fulfil/reject demands).
 */
export function canWriteRotationGroup(ctx, groupId) {
  if (!ctx) return false;
  if (ctx.isMasterAdmin) return true;
  const list = ctx.adminGroups;
  return Array.isArray(list) && list.includes(Number(groupId));
}

/**
 * Throws an Error with `status` if the rotation group does not exist or
 * the user lacks read permission. Returns the group row on success.
 */
export async function requireRotationGroupReadAccess(masterDb, ctx, groupId) {
  const [rows] = await masterDb.execute(
    'SELECT id, name, description, is_active FROM rotation_group WHERE id = ?',
    [groupId]
  );
  if (rows.length === 0) {
    const err = new Error('Rotationsverbund nicht gefunden');
    err.status = 404;
    throw err;
  }
  if (!canReadRotationGroup(ctx, groupId)) {
    const err = new Error('Kein Zugriff auf diesen Rotationsverbund');
    err.status = 403;
    throw err;
  }
  return rows[0];
}

/**
 * Throws if the user lacks write permission for the rotation group.
 */
export function requireRotationGroupWriteAccess(ctx, groupId) {
  if (!canWriteRotationGroup(ctx, groupId)) {
    const err = new Error('Keine Schreibrechte für diesen Rotationsverbund');
    err.status = 403;
    throw err;
  }
}

/**
 * Load all rotation groups the user is allowed to see.
 */
export async function listUserRotationGroups(masterDb, ctx) {
  if (!ctx) return [];
  const [rows] = await masterDb.execute(
    `SELECT id, name, description, is_active
       FROM rotation_group
      WHERE is_active = 1
      ORDER BY name ASC`
  );
  if (ctx.isMasterAdmin) return rows;
  const allowed = ctx.allowedGroups;
  if (!allowed) return [];
  return rows.filter((g) => allowed.includes(Number(g.id)));
}

/**
 * Load the members of a rotation group with their role (pool/ward).
 * @returns {Promise<Array<{tenant_id: string, role: string}>>}
 */
export async function loadRotationGroupMembers(masterDb, groupId) {
  const [rows] = await masterDb.execute(
    'SELECT tenant_id, role FROM rotation_group_member WHERE group_id = ?',
    [groupId]
  );
  return rows.map((r) => ({ tenant_id: String(r.tenant_id), role: r.role }));
}

/**
 * Resolve the pool tenant id for a rotation group (the member with role='pool').
 * Returns null if the group has no pool member.
 */
export async function resolvePoolTenantId(masterDb, groupId) {
  const [rows] = await masterDb.execute(
    "SELECT tenant_id FROM rotation_group_member WHERE group_id = ? AND role = 'pool' LIMIT 1",
    [groupId]
  );
  return rows.length > 0 ? String(rows[0].tenant_id) : null;
}

/**
 * Compute the set of rotation group ids visible to the user while viewing
 * a given tenant. Intersection of:
 *   - groups the tenant participates in (rotation_group_member.tenant_id)
 *   - groups the user is allowed to read (ctx.allowedGroups or master admin)
 */
export async function loadVisibleRotationGroupIdsForTenant(masterDb, ctx, tenantId) {
  if (!ctx || !tenantId) return [];
  const [rows] = await masterDb.execute(
    'SELECT group_id FROM rotation_group_member WHERE tenant_id = ?',
    [tenantId]
  );
  const groupIds = rows.map((r) => Number(r.group_id));
  if (ctx.isMasterAdmin) return groupIds;
  if (!Array.isArray(ctx.allowedGroups)) return [];
  return groupIds.filter((id) => ctx.allowedGroups.includes(id));
}

/**
 * Resolve the db_tokens.id (VARCHAR(36) UUID) for a given raw token string.
 * Returns null when the token is absent or unknown.
 */
export async function resolveTenantIdFromToken(masterDb, dbToken) {
  if (!dbToken) return null;
  const [rows] = await masterDb.execute(
    'SELECT id FROM db_tokens WHERE token = ? LIMIT 1',
    [dbToken]
  );
  return rows.length > 0 ? String(rows[0].id) : null;
}

/**
 * Load the user ids of all rotation admins for a group (users whose
 * rotation_admin_groups contains groupId OR role='admin'). Used for
 * realtime event targeting via broadcastUserEvent.
 */
export async function getRotationAdminUserIds(masterDb, groupId) {
  const [rows] = await masterDb.execute(
    `SELECT id FROM app_users
      WHERE is_active = 1
        AND (role = 'admin'
             OR JSON_CONTAINS(rotation_admin_groups, ?))`,
    [String(groupId)]
  );
  return rows.map((r) => String(r.id));
}
