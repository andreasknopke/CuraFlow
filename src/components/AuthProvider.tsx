import { createContext, useContext, useState, useEffect } from 'react';
import type { ReactNode, Dispatch, SetStateAction } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { disableDbToken } from '@/components/dbTokenStorage';
import { JWT_TOKEN_KEY } from '@/constants/storageKeys';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface User {
  id: number;
  email: string;
  role: string;
  doctor_id?: number;
  theme?: string;
  must_change_password?: boolean;
  schedule_sort_doctors_alphabetically?: boolean;
  [key: string]: unknown;
}

export interface Tenant {
  id: number | string;
  name: string;
  token: string;
  [key: string]: unknown;
}

export interface AuthContextValue {
  isAuthenticated: boolean;
  isReadOnly: boolean;
  user: User | null;
  isLoading: boolean;
  needsTenantSelection?: boolean;
  allowedTenants?: Tenant[];
  hasFullTenantAccess?: boolean;
  completeTenantSelection?: () => void;
  refreshUser: () => Promise<void>;
  updateMe: (data: Record<string, unknown>) => Promise<User | null>;
  logout: () => void | Promise<void>;
  login: (email: string, password: string) => Promise<unknown>;
  token?: string | null;
  mustChangePassword?: boolean;
  setMustChangePassword?: Dispatch<SetStateAction<boolean>>;
}

const AuthContext = createContext<AuthContextValue>({
  isAuthenticated: false,
  isReadOnly: true,
  user: null,
  isLoading: true,
  needsTenantSelection: false,
  allowedTenants: [],
  hasFullTenantAccess: false,
  completeTenantSelection: () => {},
  refreshUser: async () => {},
  updateMe: async () => null,
  logout: () => {},
  login: async () => {},
});

export const useAuth = (): AuthContextValue => useContext(AuthContext);

const TOKEN_KEY = JWT_TOKEN_KEY;

// ============ CUSTOM JWT AUTH PROVIDER ============
const JWTAuthProviderInner = ({ children }: { children: ReactNode }) => {
  const queryClient = useQueryClient();
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [token, setToken] = useState<string | null>(null);
  const [mustChangePassword, setMustChangePassword] = useState<boolean>(false);
  const [needsTenantSelection, setNeedsTenantSelection] = useState<boolean>(false);
  const [allowedTenants, setAllowedTenants] = useState<Tenant[]>([]);
  const [hasFullTenantAccess, setHasFullTenantAccess] = useState<boolean>(false);

  const getStoredToken = () => {
    try {
      return localStorage.getItem(TOKEN_KEY);
    } catch (_e) {
      return null;
    }
  };

  const storeToken = (newToken: string | null) => {
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
        // Check if password change is required
        setMustChangePassword(userData.must_change_password === true);
      } catch (error) {
        console.error('Auth check failed:', error);
        api.clearAuthTokens();
        setToken(null);
        setUser(null);
        setIsAuthenticated(false);
      } finally {
        setIsLoading(false);
      }
    };

    checkAuth();
  }, []);

  useEffect(() => {
    if (!isAuthenticated || !user) return undefined;

    let cancelled = false;

    const sendPresence = async () => {
      try {
        await api.updatePresence();
      } catch (error) {
        if (!cancelled) {
          console.warn('[Auth] Presence update failed:', (error as Error).message);
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

  const login = async (email: string, password: string) => {
    console.log('[Auth] Login started for:', email);

    // Zuerst alten DB-Token zurücksetzen (wichtig bei User-Wechsel)
    try {
      await disableDbToken();
      localStorage.removeItem('active_token_id');
      localStorage.removeItem('db_credentials');
      localStorage.removeItem('db_token_enabled');
      console.log('[Auth] Cleared old DB tokens');
    } catch (e) {
      console.error('[Auth] Failed to clear old DB token:', e);
    }

    const data = (await api.login(email, password)) as {
      token: string;
      user: User;
      must_change_password?: boolean;
      refreshToken?: string;
    };
    console.log('[Auth] Login successful, user:', data.user?.email);

    storeToken(data.token);
    setToken(data.token);
    setUser(data.user);
    setIsAuthenticated(true);
    setMustChangePassword(data.must_change_password === true);

    // Prüfen, ob Tenant-Auswahl erforderlich ist
    try {
      api.setToken(data.token);
      console.log('[Auth] Fetching tenants...');
      const tenantsData = (await api.getMyTenants()) as {
        tenants: Tenant[];
        hasFullAccess: boolean;
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
        setHasFullTenantAccess(tenantsData.hasFullAccess);

        // Bei jedem Login: Tenant-Auswahl anzeigen
        console.log('[Auth] Setting needsTenantSelection = true');
        setNeedsTenantSelection(true);
      } else {
        console.log('[Auth] No tenants found for user');
      }
    } catch (err) {
      console.error('[Auth] Failed to load tenants:', err);
      // Bei Fehler einfach weitermachen ohne Tenant-Auswahl
    }

    return data;
  };

  const completeTenantSelection = () => {
    setNeedsTenantSelection(false);
  };

  const logout = async () => {
    api.clearAuthTokens();
    setToken(null);
    setUser(null);
    setIsAuthenticated(false);
    queryClient.clear();

    // DB-Token beim Logout zurücksetzen
    try {
      await disableDbToken();
      localStorage.removeItem('active_token_id');
      localStorage.removeItem('db_credentials');
    } catch (e) {
      console.error('Failed to disable DB token on logout:', e);
    }

    window.location.href = '/AuthLogin';
  };

  const refreshUser = async () => {
    const currentToken = getStoredToken() || token;
    if (!currentToken) return;

    try {
      api.setToken(currentToken);
      const userData = (await api.me()) as User;
      setUser(userData);
    } catch (error) {
      console.error('Refresh user failed:', error);
    }
  };

  const updateMe = async (data: Record<string, unknown>) => {
    const currentToken = getStoredToken() || token;
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
        token: getStoredToken() || token,
        mustChangePassword,
        setMustChangePassword,
        needsTenantSelection,
        allowedTenants,
        hasFullTenantAccess,
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

// ============ MAIN EXPORT ============
export const AuthProvider = ({ children }: { children: ReactNode }) => {
  return <JWTAuthProviderInner>{children}</JWTAuthProviderInner>;
};

// Export config flag for other components
export const isUsingCustomAuth = () => true;
