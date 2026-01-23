import React, { createContext, useContext, useState, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';

// Configuration: Set to true to use custom JWT auth, false for Base44 auth
const USE_CUSTOM_AUTH = true; // Custom JWT auth enabled

const AuthContext = createContext({
    isAuthenticated: false,
    isReadOnly: true,
    user: null,
    isLoading: true,
    refreshUser: async () => {},
    updateMe: async () => {},
    logout: () => {},
    login: async () => {}
});

export const useAuth = () => useContext(AuthContext);

const TOKEN_KEY = 'radioplan_jwt_token';

// ============ CUSTOM JWT AUTH PROVIDER ============
const JWTAuthProviderInner = ({ children }) => {
    const queryClient = useQueryClient();
    const [isAuthenticated, setIsAuthenticated] = useState(false);
    const [user, setUser] = useState(null);
    const [isLoading, setIsLoading] = useState(true);
    const [token, setToken] = useState(null);
    const [mustChangePassword, setMustChangePassword] = useState(false);

    const getStoredToken = () => {
        try {
            return localStorage.getItem(TOKEN_KEY);
        } catch (e) {
            return null;
        }
    };

    const storeToken = (newToken) => {
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
                const userData = await api.me();
                setUser(userData);
                setToken(storedToken);
                setIsAuthenticated(true);
                // Check if password change is required
                setMustChangePassword(userData.must_change_password === true);
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

    const login = async (email, password) => {
        const data = await api.login(email, password);
        storeToken(data.token);
        setToken(data.token);
        setUser(data.user);
        setIsAuthenticated(true);
        setMustChangePassword(data.must_change_password === true);
        return data;
    };

    const logout = () => {
        storeToken(null);
        api.setToken(null);
        setToken(null);
        setUser(null);
        setIsAuthenticated(false);
        queryClient.clear();
        window.location.href = '/AuthLogin';
    };

    const refreshUser = async () => {
        const currentToken = token || getStoredToken();
        if (!currentToken) return;

        try {
            api.setToken(currentToken);
            const userData = await api.me();
            setUser(userData);
        } catch (error) {
            console.error('Refresh user failed:', error);
        }
    };

    const updateMe = async (data) => {
        const currentToken = token || getStoredToken();
        if (!currentToken) throw new Error('Nicht eingeloggt');
        if (!data || Object.keys(data).length === 0) {
            console.warn('updateMe called with empty data');
            return user;
        }

        api.setToken(currentToken);
        const result = await api.updateMe({ data });
        setUser(result);
        return result;
    };

    const isReadOnly = !user || user.role !== 'admin';

    return (
        <AuthContext.Provider value={{
            isAuthenticated,
            isReadOnly,
            user,
            isLoading,
            token: token || getStoredToken(),
            mustChangePassword,
            setMustChangePassword,
            login,
            logout,
            refreshUser,
            updateMe
        }}>
            {children}
        </AuthContext.Provider>
    );
};

// ============ BASE44 AUTH PROVIDER (Original) ============
const Base44AuthProviderInner = ({ children }) => {
    const [isAuthenticated, setIsAuthenticated] = useState(false);
    const [user, setUser] = useState(null);
    const [isLoading, setIsLoading] = useState(true);

    const refreshUser = async () => {
        if (isAuthenticated) {
            const userData = await base44.auth.me();
            setUser(userData);
        }
    };

    useEffect(() => {
        const checkAuth = async () => {
            try {
                const isAuth = await base44.auth.isAuthenticated();
                setIsAuthenticated(isAuth);
                if (isAuth) {
                    const userData = await base44.auth.me();
                    setUser(userData);
                }
            } catch (error) {
                console.error("Auth check failed", error);
                setIsAuthenticated(false);
            } finally {
                setIsLoading(false);
            }
        };
        checkAuth();
    }, []);

    const isReadOnly = !user || user.role !== 'admin';

    const logout = () => {
        base44.auth.logout();
    };

    const login = () => {
        base44.auth.redirectToLogin();
    };

    const updateMe = async (data) => {
        await base44.auth.updateMe(data);
        await refreshUser();
    };

    return (
        <AuthContext.Provider value={{ 
            isAuthenticated, 
            isReadOnly, 
            user, 
            isLoading,
            refreshUser,
            updateMe,
            logout,
            login
        }}>
            {children}
        </AuthContext.Provider>
    );
};

// ============ MAIN EXPORT ============
export const AuthProvider = ({ children }) => {
    if (USE_CUSTOM_AUTH) {
        return <JWTAuthProviderInner>{children}</JWTAuthProviderInner>;
    }
    return <Base44AuthProviderInner>{children}</Base44AuthProviderInner>;
};

// Export config flag for other components
export const isUsingCustomAuth = () => USE_CUSTOM_AUTH;