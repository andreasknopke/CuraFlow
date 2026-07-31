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

import type { Pool, RowDataPacket } from 'mysql2/promise';

function parseJsonArray(raw: unknown): unknown[] | null {
  if (raw === null || raw === undefined || raw === '') return null;
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw) as unknown;
      return Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Parse `allowed_rotation_groups` from an app_users row.
 * @returns list of group ids; null means "no rotation access"
 */
export function parseAllowedRotationGroups(raw: unknown): number[] | null {
  const list = parseJsonArray(raw);
  if (!list) return null;
  const ids = list.map((v) => Number(v)).filter((n) => Number.isInteger(n));
  return ids.length > 0 ? ids : null;
}

/**
 * Parse `rotation_admin_groups` from an app_users row.
 */
export function parseRotationAdminGroups(raw: unknown): number[] | null {
  return parseAllowedRotationGroups(raw);
}

interface AppUserRow extends RowDataPacket {
  id: string;
  role: string;
  allowed_rotation_groups: string | unknown[] | null;
  rotation_admin_groups: string | unknown[] | null;
}

export interface UserRotationContext {
  id: string;
  role: string;
  isMasterAdmin: boolean;
  allowedGroups: number[] | null;
  adminGroups: number[] | null;
}

/**
 * Load the user record needed for rotation permission checks.
 * Returns null when the user is not found or inactive.
 */
export async function loadUserRotationContext(
  masterDb: Pool,
  userId: string | null | undefined
): Promise<UserRotationContext | null> {
  if (!userId) return null;
  const [rows] = await masterDb.execute<AppUserRow[]>(
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
 * Users without an explicit allowed_rotation_groups list get membership-based
 * access (same behaviour as canReadRotationGroupForDemand in the routes).
 */
export function canReadRotationGroup(ctx: UserRotationContext | null, groupId: number | string): boolean {
  if (!ctx) return false;
  if (ctx.isMasterAdmin) return true;
  const list = ctx.allowedGroups;
  if (list === null) return true; // no explicit allow list → membership suffices
  return Array.isArray(list) && list.includes(Number(groupId));
}

/**
 * Check whether the user may modify rotation data for a group
 * (assign springers, manage workplaces, fulfil/reject demands).
 */
export function canWriteRotationGroup(ctx: UserRotationContext | null, groupId: number | string): boolean {
  if (!ctx) return false;
  if (ctx.isMasterAdmin) return true;
  const list = ctx.adminGroups;
  return Array.isArray(list) && list.includes(Number(groupId));
}

interface RotationGroupRow extends RowDataPacket {
  id: number;
  name: string;
  description: string | null;
  is_active: number | boolean;
}

function forbiddenError(message: string): Error & { status: number } {
  const err = new Error(message) as Error & { status: number };
  err.status = 403;
  return err;
}

function notFoundError(message: string): Error & { status: number } {
  const err = new Error(message) as Error & { status: number };
  err.status = 404;
  return err;
}

/**
 * Throws an Error with `status` if the rotation group does not exist or
 * the user lacks read permission. Returns the group row on success.
 */
export async function requireRotationGroupReadAccess(
  masterDb: Pool,
  ctx: UserRotationContext | null,
  groupId: number | string
): Promise<RotationGroupRow> {
  const [rows] = await masterDb.execute<RotationGroupRow[]>(
    'SELECT id, name, description, is_active FROM rotation_group WHERE id = ?',
    [groupId]
  );
  if (rows.length === 0) {
    throw notFoundError('Rotationsverbund nicht gefunden');
  }
  if (!canReadRotationGroup(ctx, groupId)) {
    throw forbiddenError('Kein Zugriff auf diesen Rotationsverbund');
  }
  return rows[0];
}

/**
 * Throws if the user lacks write permission for the rotation group.
 */
export function requireRotationGroupWriteAccess(ctx: UserRotationContext | null, groupId: number | string): void {
  if (!canWriteRotationGroup(ctx, groupId)) {
    throw forbiddenError('Keine Schreibrechte für diesen Rotationsverbund');
  }
}

/**
 * Load all rotation groups the user is allowed to see.
 */
export async function listUserRotationGroups(
  masterDb: Pool,
  ctx: UserRotationContext | null
): Promise<RotationGroupRow[]> {
  if (!ctx) return [];
  const [rows] = await masterDb.execute<RotationGroupRow[]>(
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

interface RotationGroupMemberRow extends RowDataPacket {
  tenant_id: string;
  role: string;
}

/**
 * Load the members of a rotation group with their role (pool/ward).
 */
export async function loadRotationGroupMembers(
  masterDb: Pool,
  groupId: number | string
): Promise<Array<{ tenant_id: string; role: string }>> {
  const [rows] = await masterDb.execute<RotationGroupMemberRow[]>(
    'SELECT tenant_id, role FROM rotation_group_member WHERE group_id = ?',
    [groupId]
  );
  return rows.map((r) => ({ tenant_id: String(r.tenant_id), role: r.role }));
}

/**
 * Resolve the pool tenant id for a rotation group (the member with role='pool').
 * Returns null if the group has no pool member.
 */
export async function resolvePoolTenantId(masterDb: Pool, groupId: number | string): Promise<string | null> {
  const [rows] = await masterDb.execute<RotationGroupMemberRow[]>(
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
 *
 * Users without an explicit allowed_rotation_groups list get membership-based
 * access: they see all groups their tenant participates in (read-only unless
 * they also have rotation_admin_groups set).
 */
export async function loadVisibleRotationGroupIdsForTenant(
  masterDb: Pool,
  ctx: UserRotationContext | null,
  tenantId: string | null | undefined
): Promise<number[]> {
  if (!ctx || !tenantId) return [];
  const [rows] = await masterDb.execute<RotationGroupMemberRow[]>(
    'SELECT group_id FROM rotation_group_member WHERE tenant_id = ?',
    [tenantId]
  );
  const groupIds = rows.map((r) => Number(r.group_id));
  if (ctx.isMasterAdmin) return groupIds;
  // No explicit allow list → membership-based access (same as canReadRotationGroupForDemand)
  if (ctx.allowedGroups === null) return groupIds;
  if (!Array.isArray(ctx.allowedGroups)) return [];
  return groupIds.filter((id) => ctx.allowedGroups?.includes(id));
}

interface DbTokenRow extends RowDataPacket {
  id: string;
}

/**
 * Resolve the db_tokens.id (VARCHAR(36) UUID) for a given raw token string.
 * Returns null when the token is absent or unknown.
 */
export async function resolveTenantIdFromToken(masterDb: Pool, dbToken: string | null | undefined): Promise<string | null> {
  if (!dbToken) return null;
  const [rows] = await masterDb.execute<DbTokenRow[]>(
    'SELECT id FROM db_tokens WHERE token = ? LIMIT 1',
    [dbToken]
  );
  return rows.length > 0 ? String(rows[0].id) : null;
}

interface AdminUserRow extends RowDataPacket {
  id: string;
}

/**
 * Load the user ids of all rotation admins for a group (users whose
 * rotation_admin_groups contains groupId OR role='admin'). Used for
 * realtime event targeting via broadcastUserEvent.
 */
export async function getRotationAdminUserIds(masterDb: Pool, groupId: number | string): Promise<string[]> {
  const [rows] = await masterDb.execute<AdminUserRow[]>(
    `SELECT id FROM app_users
      WHERE is_active = 1
        AND (role = 'admin'
             OR JSON_CONTAINS(rotation_admin_groups, ?))`,
    [String(groupId)]
  );
  return rows.map((r) => String(r.id));
}
