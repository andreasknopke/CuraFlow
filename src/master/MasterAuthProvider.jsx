import React, { createContext, useContext, useState, useEffect } from 'react';
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
      if (!token) {
        setIsLoading(false);
        return;
      }

      try {
        api.setToken(token);
        const userData = await api.me();
        
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
        localStorage.removeItem(TOKEN_KEY);
        setIsAuthenticated(false);
      } finally {
        setIsLoading(false);
      }
    };

    checkAuth();
  }, []);

  const login = async (email, password) => {
    const data = await api.login(email, password);
    
    if (data.user?.role !== 'admin') {
      api.setToken(null);
      throw new Error('Zugriff nur für Administratoren. Bitte melden Sie sich mit einem Admin-Konto an.');
    }
    
    setUser(data.user);
    setIsAuthenticated(true);
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
