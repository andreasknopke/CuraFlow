import React, { createContext, useContext, useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';

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
    const [isAuthenticated, setIsAuthenticated] = useState(false);
    const [user, setUser] = useState(null);
    const [isLoading, setIsLoading] = useState(true);
    const [token, setToken] = useState(null);

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
                const fetchResponse = await fetch(
                    `${window.location.origin}/api/functions/auth`,
                    {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${storedToken}`
                        },
                        body: JSON.stringify({ action: 'me' })
                    }
                );

                if (fetchResponse.ok) {
                    const userData = await fetchResponse.json();
                    setUser(userData);
                    setToken(storedToken);
                    setIsAuthenticated(true);
                } else {
                    storeToken(null);
                    setIsAuthenticated(false);
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

    const login = async (email, password) => {
        const response = await fetch(
            `${window.location.origin}/api/functions/auth`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'login', email, password })
            }
        );

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Login fehlgeschlagen');
        }

        storeToken(data.token);
        setToken(data.token);
        setUser(data.user);
        setIsAuthenticated(true);

        return data;
    };

    const logout = () => {
        storeToken(null);
        setToken(null);
        setUser(null);
        setIsAuthenticated(false);
        window.location.href = '/AuthLogin';
    };

    const refreshUser = async () => {
        const currentToken = token || getStoredToken();
        if (!currentToken) return;

        try {
            const response = await fetch(
                `${window.location.origin}/api/functions/auth`,
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${currentToken}`
                    },
                    body: JSON.stringify({ action: 'me' })
                }
            );

            if (response.ok) {
                const userData = await response.json();
                setUser(userData);
            }
        } catch (error) {
            console.error('Refresh user failed:', error);
        }
    };

    const updateMe = async (data) => {
        const currentToken = token || getStoredToken();
        if (!currentToken) throw new Error('Nicht eingeloggt');

        const response = await fetch(
            `${window.location.origin}/api/functions/auth`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${currentToken}`
                },
                body: JSON.stringify({ action: 'updateMe', data })
            }
        );

        const result = await response.json();

        if (!response.ok) {
            throw new Error(result.error || 'Update fehlgeschlagen');
        }

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