// ---------------------------------------------------------------------------
// User & team role constants — single source of truth.
// ---------------------------------------------------------------------------

/** App-level user roles (stored in app_users.role) */
export const USER_ROLES = {
  ADMIN: 'admin',
  USER: 'user',
} as const;

export type UserRole = (typeof USER_ROLES)[keyof typeof USER_ROLES];

/** Clinical team roles / doctor types used in scheduling logic */
export const TEAM_ROLES = {
  ASSISTENZARZT: 'Assistenzarzt',
  NICHT_RADIOLOGE: 'Nicht-Radiologe',
} as const;

export type TeamRole = (typeof TEAM_ROLES)[keyof typeof TEAM_ROLES];

/** Helper: is this user an admin? */
export const isAdmin = (user: { role?: string } | null | undefined): boolean =>
  user?.role === USER_ROLES.ADMIN;
