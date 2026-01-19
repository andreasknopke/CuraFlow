import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { base44 } from '@/api/base44Client';

const AuthContext = createContext({
    isAuthenticated: false,
    isReadOnly: true,
    user: null,
    isLoading: true,
    login: async () => {},
    logout: () => {},
    refreshUser: async () => {},
    updateMe: async () => {}
});

export const useAuth = () => useContext(AuthContext);

const TOKEN_KEY = 'radioplan_jwt_token';

export const JWTAuthProvider = ({ children }) => {
    const [isAuthenticated, setIsAuthenticated] = useState(false);
    const [user, setUser] = useState(null);
    const [isLoading, setIsLoading] = useState(true);
    const [token, setToken] = useState(null);

    // Get stored token
    const getStoredToken = () => {
        try {
            return localStorage.getItem(TOKEN_KEY);
        } catch (e) {
            return null;
        }
    };

    // Store token
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

    // API call helper with auth
    const authFetch = useCallback(async (action, data = {}) => {
        const currentToken = token || getStoredToken();
        
        const response = await base44.functions.invoke('auth', {
            action,
            ...data
        });
        
        // The response from base44.functions.invoke wraps in { data }
        return response.data;
    }, [token]);

    // Check auth status on mount
    useEffect(() => {
        const checkAuth = async () => {
            const storedToken = getStoredToken();
            
            if (!storedToken) {
                setIsLoading(false);
                return;
            }

            try {
                // Verify token and get user
                const response = await fetch(
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

                if (response.ok) {
                    const userData = await response.json();
                    setUser(userData);
                    setToken(storedToken);
                    setIsAuthenticated(true);
                } else {
                    // Token invalid, clear it
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

    // Login function
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

    // Logout function
    const logout = () => {
        storeToken(null);
        setToken(null);
        setUser(null);
        setIsAuthenticated(false);
        window.location.href = '/Login';
    };

    // Refresh user data
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

    // Update current user
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

    // ReadOnly is true if user is NOT admin
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

// Helper hook for making authenticated API calls
export const useAuthFetch = () => {
    const { token } = useAuth();

    return async (url, options = {}) => {
        const currentToken = token || localStorage.getItem(TOKEN_KEY);
        
        return fetch(url, {
            ...options,
            headers: {
                ...options.headers,
                'Authorization': currentToken ? `Bearer ${currentToken}` : ''
            }
        });
    };
};

export default JWTAuthProvider;