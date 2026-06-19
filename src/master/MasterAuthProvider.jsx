import { createContext, useContext, useState, useEffect } from 'react';
import { api } from '@/api/client';

const MasterAuthContext = createContext({
  isAuthenticated: false,
  user: null,
  isLoading: true,
  login: async () => {},
  logout: () => {},
});

export const useMasterAuth = () => useContext(MasterAuthContext);

const TOKEN_KEY = 'radioplan_jwt_token';

export default function MasterAuthProvider({ children }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [user, setUser] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

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
        const userData = await api.me();
        console.debug('[MasterAuth] api.me() succeeded, role:', userData.role, 'email:', userData.email);
        
        // Master-Frontend: nur Admins erlaubt
        if (userData.role !== 'admin') {
          console.warn('[MasterAuth] Zugriff nur für Admins (role:', userData.role + ')');
          setIsAuthenticated(false);
          setIsLoading(false);
          return;
        }
        
        setUser(userData);
        setIsAuthenticated(true);
        console.debug('[MasterAuth] Authenticated as admin:', userData.email);
      } catch (error) {
        console.error('[MasterAuth] Auth check failed:', error.message, 'status:', error.status);
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
      } catch (error) {
        if (!cancelled) {
          console.warn('[MasterAuth] Presence update failed:', error.message);
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

  const login = async (email, password) => {
    console.debug('[MasterAuth] login() called for', email);
    const data = await api.login(email, password);
    console.debug('[MasterAuth] api.login() returned, user role:', data.user?.role);
    
    if (data.user?.role !== 'admin') {
      api.setToken(null);
      console.warn('[MasterAuth] Login rejected: user is not admin');
      throw new Error('Zugriff nur für Administratoren. Bitte melden Sie sich mit einem Admin-Konto an.');
    }
    
    setUser(data.user);
    setIsAuthenticated(true);
    console.debug('[MasterAuth] isAuthenticated set to true for', data.user.email);
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
