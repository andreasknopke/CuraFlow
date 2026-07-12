import { createContext, useContext, useState, useEffect } from 'react';
import { api } from '@/api/client';
import type { AdminUser } from '@/types/master';

interface MasterAuthContextType {
  isAuthenticated: boolean;
  user: AdminUser | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<{ token?: string; user?: AdminUser }>;
  logout: () => void;
}

const MasterAuthContext = createContext<MasterAuthContextType>({
  isAuthenticated: false,
  user: null,
  isLoading: true,
  login: async () => ({}),
  logout: () => {},
});

export const useMasterAuth = () => useContext(MasterAuthContext);

const TOKEN_KEY = 'radioplan_jwt_token';

export default function MasterAuthProvider({ children }: { children: React.ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [user, setUser] = useState<AdminUser | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  useEffect(() => {
    const checkAuth = async () => {
      const token = localStorage.getItem(TOKEN_KEY);
      console.debug('[MasterAuth] checkAuth: token present:', !!token, 'pathname:', window.location.pathname);
      
      if (!token) {
        console.debug('[MasterAuth] No token found, not authenticated');
        setIsLoading(false);
        return;
      }

      try {
        api.setToken(token);
        console.debug('[MasterAuth] Calling api.me()...');
        const userData = await api.me() as AdminUser & { is_super_admin?: boolean; permissions?: Record<string, boolean> | null };
        console.debug('[MasterAuth] api.me() succeeded, role:', userData.role, 'email:', userData.email);
        
        // Master-Frontend: nur Admins erlaubt
        if (userData.role !== 'admin') {
          console.warn('[MasterAuth] Zugriff nur für Admins (role:', userData.role + ')');
          setIsAuthenticated(false);
          setIsLoading(false);
          return;
        }

        // Feingranulare Prüfung: Admin benötigt Berechtigung für Stammdaten
        // Super-Admins (is_super_admin === true) haben immer Zugriff
        if (!userData.is_super_admin) {
          const perms = userData.permissions;
          const canAccessMaster = !perms || typeof perms !== 'object' || perms.can_manage_master_data !== false;
          if (!canAccessMaster) {
            console.warn('[MasterAuth] Admin hat keine Berechtigung für Stammdaten (email:', userData.email + ')');
            setIsAuthenticated(false);
            setIsLoading(false);
            return;
          }
        }
        
        setUser(userData);
        setIsAuthenticated(true);
        console.debug('[MasterAuth] Authenticated as admin:', userData.email);
      } catch (error: unknown) {
        const err = error as Error;
        console.error('[MasterAuth] Auth check failed:', err.message);
        localStorage.removeItem(TOKEN_KEY);
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
      } catch (error: unknown) {
        if (!cancelled) {
          const err = error as Error;
          console.warn('[MasterAuth] Presence update failed:', err.message);
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

  const login = async (email: string, password: string): Promise<{ token?: string; user?: AdminUser }> => {
    console.debug('[MasterAuth] login() called for', email);
    const data = (await api.login(email, password)) as { token?: string; user?: AdminUser };
    console.debug('[MasterAuth] api.login() returned, user role:', data.user?.role);
    
    if (data.user?.role !== 'admin') {
      api.setToken(null);
      console.warn('[MasterAuth] Login rejected: user is not admin');
      throw new Error('Zugriff nur für Administratoren. Bitte melden Sie sich mit einem Admin-Konto an.');
    }
    
    if (data.user) {
      setUser(data.user);
    }
    setIsAuthenticated(true);
    console.debug('[MasterAuth] isAuthenticated set to true for', data.user?.email);
    return data;
  };

  const logout = () => {
    localStorage.removeItem(TOKEN_KEY);
    api.setToken(null);
    setUser(null);
    setIsAuthenticated(false);
  };

  return (
    <MasterAuthContext.Provider value={{ isAuthenticated, user, isLoading, login, logout }}>
      {children}
    </MasterAuthContext.Provider>
  );
}
