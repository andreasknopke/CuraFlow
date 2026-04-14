// ---------------------------------------------------------------------------
// Auth & user types — derived from app_users table and API responses.
// ---------------------------------------------------------------------------

import type { UserRole } from '@/constants/roles';

export interface AppUser {
  id: string;
  email: string;
  full_name: string;
  role: UserRole | string;
  doctor_id?: string | null;
  theme: string;
  is_active: boolean;

  // UI preferences (stored per-user)
  section_config?: unknown;
  collapsed_sections?: string[];
  schedule_hidden_rows?: string[];
  schedule_show_sidebar: boolean;
  schedule_initials_only: boolean;
  schedule_sort_doctors_alphabetically: boolean;
  highlight_my_name: boolean;
  grid_font_size?: string | null;
  wish_hidden_doctors?: string[];
  wish_show_occupied: boolean;
  wish_show_absences: boolean;

  // Multi-tenant
  allowed_tenants?: string[] | null;

  // Security
  must_change_password: boolean;
  email_verified: boolean;
  email_verified_date?: string | null;
  last_login?: string | null;
  last_seen_at?: string | null;

  created_date: string;
  updated_date: string;
}

/** Subset of AppUser returned by /api/auth/me */
export interface AuthUser {
  id: string;
  email: string;
  full_name: string;
  role: UserRole | string;
  doctor_id?: string | null;
  theme: string;
  is_active: boolean;
  must_change_password: boolean;
  email_verified: boolean;
  allowed_tenants?: string[] | null;

  // UI preferences
  section_config?: unknown;
  collapsed_sections?: string[];
  schedule_hidden_rows?: string[];
  schedule_show_sidebar: boolean;
  schedule_initials_only: boolean;
  schedule_sort_doctors_alphabetically: boolean;
  highlight_my_name: boolean;
  grid_font_size?: string | null;
  wish_hidden_doctors?: string[];
  wish_show_occupied: boolean;
  wish_show_absences: boolean;
}

/** JWT token payload */
export interface TokenPayload {
  userId: string;
  email: string;
  role: string;
  iat?: number;
  exp?: number;
}

/** Login request body */
export interface LoginRequest {
  email: string;
  password: string;
}

/** Login response */
export interface LoginResponse {
  token: string;
  refreshToken: string;
  must_change_password?: boolean;
  user: AuthUser;
}
