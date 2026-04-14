import React, { createContext, useContext, useState, useEffect } from 'react';
import { api } from '@/api/client';
import { DB_CREDENTIALS_KEY, DB_TOKEN_ENABLED_KEY, JWT_TOKEN_KEY } from '@/constants/storageKeys';

interface MasterUser {
  id: string | number;
  email: string;
  full_name?: string;
  role: string;
  [key: string]: unknown;
}

interface MasterLoginResponse {
  token: string;
  user: MasterUser;
  [key: string]: unknown;
}

interface MasterAuthContextValue {
  isAuthenticated: boolean;
  user: MasterUser | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<MasterLoginResponse>;
  logout: () => void;
}

const MasterAuthContext = createContext<MasterAuthContextValue>({
  isAuthenticated: false,
  user: null,
  isLoading: true,
  login: async () => {
    throw new Error('MasterAuthContext not initialized');
  },
  logout: () => {},
});

export const useMasterAuth = () => useContext(MasterAuthContext);

const TOKEN_KEY = JWT_TOKEN_KEY;
const DB_TOKEN_KEY = DB_CREDENTIALS_KEY;

interface MasterAuthProviderProps {
  children: React.ReactNode;
}

export default function MasterAuthProvider({ children }: MasterAuthProviderProps) {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [user, setUser] = useState<MasterUser | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  useEffect(() => {
    const checkAuth = async () => {
      localStorage.removeItem(DB_TOKEN_KEY);
      localStorage.setItem(DB_TOKEN_ENABLED_KEY, 'false');

      const token = localStorage.getItem(TOKEN_KEY);
      if (!token) {
        setIsLoading(false);
        return;
      }

      try {
        api.setToken(token);
        const userData = (await api.me()) as MasterUser;

        // Master-Frontend: nur Admins erlaubt
        if (userData.role !== 'admin') {
          console.warn('Master-Frontend: Zugriff nur für Admins');
          setIsAuthenticated(false);
          setIsLoading(false);
          return;
        }

        setUser(userData);
        setIsAuthenticated(true);
      } catch (error) {
        console.error('Auth check failed:', error);
        api.clearAuthTokens();
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
          console.warn('[MasterAuth] Presence update failed:', (error as Error).message);
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

  const login = async (email: string, password: string): Promise<MasterLoginResponse> => {
    localStorage.removeItem(DB_TOKEN_KEY);
    localStorage.setItem(DB_TOKEN_ENABLED_KEY, 'false');

    const data = (await api.login(email, password)) as MasterLoginResponse;

    if (data.user?.role !== 'admin') {
      api.clearAuthTokens();
      throw new Error(
        'Zugriff nur für Administratoren. Bitte melden Sie sich mit einem Admin-Konto an.',
      );
    }

    setUser(data.user);
    setIsAuthenticated(true);
    return data;
  };

  const logout = () => {
    api.clearAuthTokens();
    localStorage.removeItem(DB_TOKEN_KEY);
    localStorage.setItem(DB_TOKEN_ENABLED_KEY, 'false');
    setUser(null);
    setIsAuthenticated(false);
  };

  return (
    <MasterAuthContext.Provider value={{ isAuthenticated, user, isLoading, login, logout }}>
      {children}
    </MasterAuthContext.Provider>
  );
}
