/**
 * CuraFlow — AuthProvider
 *
 * Provides authentication context (JWT-based custom auth) to the entire app.
 * Manages login, logout, token storage, presence updates, tenant selection,
 * and cross-tenant group access.
 *
 * The Base44 auth variant (USE_CUSTOM_AUTH = false) is DEAD CODE — it was
 * part of an abandoned Base44 integration. The constant is always `true`.
 *
 * @module components/AuthProvider
 */

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { clearActiveDbToken } from '@/components/dbTokenStorage';

// ─── Configuration ───────────────────────────────────────────────────────────

/** Always true — Base44 auth path is dead code. */
const USE_CUSTOM_AUTH = true;

// ─── Types ───────────────────────────────────────────────────────────────────

export interface User {
  id: string;
  email: string;
  role: string;
  must_change_password?: boolean;
  schedule_sort_doctors_alphabetically?: boolean;
  permissions?: Record<string, boolean> | null;
  is_super_admin?: boolean;
  [key: string]: unknown;
}

interface Tenant {
  [key: string]: unknown;
}

interface Group {
  id: string | number;
  [key: string]: unknown;
}

interface AuthContextValue {
  isAuthenticated: boolean;
  isReadOnly: boolean;
  user: User | null;
  isLoading: boolean;
  token?: string | null;
  mustChangePassword: boolean;
  setMustChangePassword: (value: boolean) => void;
  needsTenantSelection: boolean;
  allowedTenants: Tenant[];
  hasFullTenantAccess: boolean;
  allowedGroups: Group[];
  hasGroupAccess: boolean;
  activeGroupId: number | null;
  setActiveGroupId: (id: number | null) => void;
  completeTenantSelection: () => void;
  login: (email: string, password: string) => Promise<unknown>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
  updateMe: (data: Record<string, unknown>) => Promise<User | null>;
}

const AuthContext = createContext<AuthContextValue>({
  isAuthenticated: false,
  isReadOnly: true,
  user: null,
  isLoading: true,
  token: null,
  mustChangePassword: false,
  setMustChangePassword: () => {},
  needsTenantSelection: false,
  allowedTenants: [],
  hasFullTenantAccess: false,
  allowedGroups: [],
  hasGroupAccess: false,
  activeGroupId: null,
  setActiveGroupId: () => {},
  completeTenantSelection: () => {},
  refreshUser: async () => {},
  updateMe: async () => null,
  logout: async () => {},
  login: async () => ({}),
});

export const useAuth = (): AuthContextValue => useContext(AuthContext);

const TOKEN_KEY = 'radioplan_jwt_token';

// ─── JWT Auth Provider (active) ──────────────────────────────────────────────

const JWTAuthProviderInner: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const queryClient = useQueryClient();
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [token, setToken] = useState<string | null>(null);
  const [mustChangePassword, setMustChangePassword] = useState(false);
  const [needsTenantSelection, setNeedsTenantSelection] = useState(false);
  const [allowedTenants, setAllowedTenants] = useState<Tenant[]>([]);
  const [hasFullTenantAccess, setHasFullTenantAccess] = useState(false);
  const [allowedGroups, setAllowedGroups] = useState<Group[]>([]);
  const [hasGroupAccess, setHasGroupAccess] = useState(false);
  const [activeGroupId, setActiveGroupIdState] = useState<number | null>(() => {
    try {
      const raw = localStorage.getItem('curaflow_active_group_id');
      const parsed = raw ? Number(raw) : null;
      return Number.isInteger(parsed) ? parsed : null;
    } catch {
      return null;
    }
  });

  const setActiveGroupId = useCallback((id: number | null) => {
    setActiveGroupIdState(id);
    try {
      if (id === null || id === undefined) {
        localStorage.removeItem('curaflow_active_group_id');
      } else {
        localStorage.setItem('curaflow_active_group_id', String(id));
      }
    } catch (e) {
      console.error('[Auth] Failed to persist active group id:', e);
    }
  }, []);

  const getStoredToken = (): string | null => {
    try {
      return localStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  };

  const storeToken = (newToken: string | null): void => {
    try {
      if (newToken) {
        localStorage.setItem(TOKEN_KEY, newToken);
      } else {
        localStorage.removeItem(TOKEN_KEY);
      }
    } catch (e) {
      console.error('Token storage error:', e);
    }
  };

  // ── Check stored token on mount ──────────────────────────────────────────

  useEffect(() => {
    const checkAuth = async () => {
      const storedToken = getStoredToken();

      if (!storedToken) {
        setIsLoading(false);
        return;
      }

      try {
        api.setToken(storedToken);
        const userData = (await api.me()) as User;
        setUser(userData);
        setToken(storedToken);
        setIsAuthenticated(true);
        setMustChangePassword(userData.must_change_password === true);

        // Load tenant groups (non-blocking on failure)
        try {
          const groupsData = (await api.getMyGroups()) as {
            groups?: Group[];
          };
          const list = Array.isArray(groupsData?.groups)
            ? groupsData.groups
            : [];
          setAllowedGroups(list);
          setHasGroupAccess(list.length > 0);
        } catch (err) {
          console.warn(
            '[Auth] Failed to load tenant groups on refresh:',
            (err as Error).message,
          );
        }
      } catch (error) {
        console.error('Auth check failed:', error);
        storeToken(null);
        setIsAuthenticated(false);
      } finally {
        setIsLoading(false);
      }
    };

    checkAuth();
  }, []);

  // ── Presence heartbeat (every 60s while authenticated) ────────────────────

  useEffect(() => {
    if (!isAuthenticated || !user) return undefined;

    let cancelled = false;

    const sendPresence = async () => {
      try {
        await api.updatePresence();
      } catch (error) {
        if (!cancelled) {
          console.warn(
            '[Auth] Presence update failed:',
            (error as Error).message,
          );
        }
      }
    };

    sendPresence();
    const intervalId = window.setInterval(sendPresence, 60000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [isAuthenticated, user?.id]);

  // ── Login ─────────────────────────────────────────────────────────────────

  const login = async (email: string, password: string) => {
    console.log('[Auth] Login started for:', email);

    // Clear old DB token locally immediately (important on user switch)
    try {
      clearActiveDbToken().catch((e) => {
        console.error('[Auth] Failed to clear old DB token state:', e);
      });
      console.log('[Auth] Cleared old DB tokens');
    } catch (e) {
      console.error('[Auth] Failed to clear old DB token:', e);
    }

    const data = (await api.login(email, password)) as {
      token: string;
      user: User;
      must_change_password?: boolean;
    };

    console.log('[Auth] Login successful, user:', data.user?.email);

    storeToken(data.token);
    setToken(data.token);
    setUser(data.user);
    setIsAuthenticated(true);
    setMustChangePassword(data.must_change_password === true);

    // Check if tenant selection is required
    try {
      api.setToken(data.token);
      console.log('[Auth] Fetching tenants...');
      const tenantsData = (await api.getMyTenants()) as {
        tenants?: Tenant[];
        hasFullAccess?: boolean;
      };
      console.log('[Auth] Tenants response:', tenantsData);

      if (tenantsData.tenants && tenantsData.tenants.length > 0) {
        console.log(
          '[Auth] Found',
          tenantsData.tenants.length,
          'tenants, hasFullAccess:',
          tenantsData.hasFullAccess,
        );
        setAllowedTenants(tenantsData.tenants);
        setHasFullTenantAccess(tenantsData.hasFullAccess ?? false);
        setNeedsTenantSelection(true);
      } else {
        console.log('[Auth] No tenants found for user');
      }
    } catch (err) {
      console.error('[Auth] Failed to load tenants:', err);
    }

    // Load cross-tenant pool groups (optional, non-blocking)
    try {
      const groupsData = (await api.getMyGroups()) as {
        groups?: Group[];
      };
      const list = Array.isArray(groupsData?.groups)
        ? groupsData.groups
        : [];
      setAllowedGroups(list);
      setHasGroupAccess(list.length > 0);
    } catch (err) {
      console.warn(
        '[Auth] Failed to load tenant groups:',
        (err as Error).message,
      );
      setAllowedGroups([]);
      setHasGroupAccess(false);
    }

    return data;
  };

  const completeTenantSelection = () => {
    setNeedsTenantSelection(false);
  };

  // ── Logout ────────────────────────────────────────────────────────────────

  const logout = async () => {
    storeToken(null);
    api.setToken(null);
    setToken(null);
    setUser(null);
    setIsAuthenticated(false);
    queryClient.clear();

    try {
      await clearActiveDbToken();
    } catch (e) {
      console.error('Failed to clear DB token on logout:', e);
    }

    window.location.href = '/authlogin';
  };

  // ── Refresh user ──────────────────────────────────────────────────────────

  const refreshUser = async () => {
    const currentToken = token || getStoredToken();
    if (!currentToken) return;

    try {
      api.setToken(currentToken);
      const userData = (await api.me()) as User;
      setUser(userData);
    } catch (error) {
      console.error('Refresh user failed:', error);
    }
  };

  // ── Update user profile ───────────────────────────────────────────────────

  const updateMe = async (
    data: Record<string, unknown>,
  ): Promise<User | null> => {
    const currentToken = token || getStoredToken();
    if (!currentToken) throw new Error('Nicht eingeloggt');
    if (!data || Object.keys(data).length === 0) {
      console.warn('updateMe called with empty data');
      return user;
    }

    api.setToken(currentToken);
    const result = (await api.updateMe({ data })) as User;
    setUser(result);
    return result;
  };

  const isReadOnly = !user || user.role !== 'admin';

  return (
    <AuthContext.Provider
      value={{
        isAuthenticated,
        isReadOnly,
        user,
        isLoading,
        token: token || getStoredToken(),
        mustChangePassword,
        setMustChangePassword,
        needsTenantSelection,
        allowedTenants,
        hasFullTenantAccess,
        allowedGroups,
        hasGroupAccess,
        activeGroupId,
        setActiveGroupId,
        completeTenantSelection,
        login,
        logout,
        refreshUser,
        updateMe,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

// ─── Base44 Auth Provider (DEAD CODE) ────────────────────────────────────────

/**
 * Base44 auth variant — NEVER USED because USE_CUSTOM_AUTH is always `true`.
 * Retained for reference only. The Base44 integration was abandoned.
 *
 * @dead Remove after TypeScript migration is complete.
 */

// const Base44AuthProviderInner: React.FC<{ children: React.ReactNode }> = ({ children }) => {
//   // ... dead code omitted
// };

// ─── Main Export ─────────────────────────────────────────────────────────────

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  // USE_CUSTOM_AUTH is always true — Base44 path is dead.
  return <JWTAuthProviderInner>{children}</JWTAuthProviderInner>;
};

export const isUsingCustomAuth = (): boolean => USE_CUSTOM_AUTH;
