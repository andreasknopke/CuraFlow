/**
 * Permission-based access control — Frontend helpers.
 *
 * Mirrors the server-side constants in `server/utils/permissions.js`.
 * This is the single source of truth for both the tenant-Admin UI and
 * the Master-Frontend Admin config page.
 */

// ─── Permission keys (must match server/utils/permissions.js) ────────────────

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

export type PermissionKey = (typeof PERMISSION_KEYS)[number];

// ─── Human-readable labels (German, for the UI) ─────────────────────────────

export const PERMISSION_LABELS: Record<PermissionKey, string> = {
  can_manage_users: 'Benutzer verwalten',
  can_approve_absence: 'Abwesenheitsanträge freigeben',
  can_manage_master_data: 'Stammdaten verwalten (Master-Frontend)',
  can_link_employees: 'Mitarbeiter-Verknüpfung (zentral ↔ Mandant)',
  can_manage_groups: 'Verbünde & Rotationen verwalten',
  can_manage_workplace_links: 'Arbeitsplatz-Links verwalten',
  can_manage_shift_vacation: 'Schichturlaub & Übertrag verwalten',
  can_manage_system: 'System-Einstellungen & Datenbank',
  can_manage_cowork: 'CoWork-Einladungen verwalten',
  can_approve_wishes: 'Dienstwünsche genehmigen',
  can_send_schedule_emails: 'Dienstplan-E-Mails versenden',
  can_assign_pool_shifts: 'Pool-Dienste besetzen',
  can_edit_schedule: 'Dienstplan bearbeiten (tenant-eigene Schichten)',
};

// ─── Helper ──────────────────────────────────────────────────────────────────

export type PermissionsObject = Partial<Record<PermissionKey, boolean>>;

/**
 * Check whether a user has a specific permission.
 *
 * Non-admin users always return `false`.  A missing or `undefined` key
 * is treated as `true` for admins (lockout-safe — same logic as backend).
 *
 * @param user  The current user object (from AuthProvider).
 * @param key   The permission key to check.
 */
export function hasPermission(
  user: { role?: string; permissions?: PermissionsObject | null; is_super_admin?: boolean } | null,
  key: PermissionKey,
): boolean {
  if (!user || user.role !== 'admin') return false;
  if (user.is_super_admin) return true;

  const perms = user.permissions;
  if (!perms || typeof perms !== 'object') return true; // lockout-safe
  // Every key defaults to true unless explicitly set to false
  return perms[key] !== false;
}
