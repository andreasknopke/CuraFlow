// IndexedDB + localStorage Hybrid Storage for DB Token
// Ensures token persistence across PWA and browser contexts

const DB_NAME = 'RadioPlanDB';
const STORE_NAME = 'settings';
const TOKEN_KEY = 'db_credentials';
const TOKEN_ENABLED_KEY = 'db_token_enabled';
const SAVED_TOKENS_KEY = 'saved_db_tokens';

// Open IndexedDB
const openDB = () => {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, 1);
        
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
        
        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME, { keyPath: 'key' });
            }
        };
    });
};

// Save token to IndexedDB
export const saveTokenToIndexedDB = async (token) => {
    try {
        const db = await openDB();
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        store.put({ key: TOKEN_KEY, value: token, updatedAt: Date.now() });
        await new Promise((resolve, reject) => {
            tx.oncomplete = resolve;
            tx.onerror = () => reject(tx.error);
        });
        db.close();
    } catch (e) {
        console.warn('Failed to save token to IndexedDB:', e);
    }
};

// Get token from IndexedDB
export const getTokenFromIndexedDB = async () => {
    try {
        const db = await openDB();
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const request = store.get(TOKEN_KEY);
        
        return new Promise((resolve, reject) => {
            request.onsuccess = () => {
                db.close();
                resolve(request.result?.value || null);
            };
            request.onerror = () => {
                db.close();
                reject(request.error);
            };
        });
    } catch (e) {
        console.warn('Failed to get token from IndexedDB:', e);
        return null;
    }
};

// Sync token from IndexedDB to localStorage (for PWA startup)
export const syncDbTokenFromIndexedDB = async () => {
    try {
        const localToken = localStorage.getItem(TOKEN_KEY);
        const idbToken = await getTokenFromIndexedDB();
        
        if (idbToken && !localToken) {
            // Token exists in IDB but not in localStorage -> copy it
            localStorage.setItem(TOKEN_KEY, idbToken);
            console.log('DB token synced from IndexedDB to localStorage');
            return idbToken;
        }
        
        if (localToken && !idbToken) {
            // Token exists in localStorage but not in IDB -> save to IDB
            await saveTokenToIndexedDB(localToken);
            console.log('DB token synced from localStorage to IndexedDB');
        }
        
        return localToken || idbToken;
    } catch (e) {
        console.warn('Token sync failed:', e);
        return localStorage.getItem(TOKEN_KEY);
    }
};

// Save token to both storages
export const saveDbToken = async (token) => {
    localStorage.setItem(TOKEN_KEY, token);
    await saveTokenToIndexedDB(token);
};

// Extract token from URL and save
export const extractAndSaveDbTokenFromUrl = async () => {
    const params = new URLSearchParams(window.location.search);
    let dbToken = params.get('db_token');
    
    if (dbToken) {
        // URLSearchParams converts + to space, so we need to handle this
        // The original token may contain + and / characters that need to be preserved
        // First, restore + signs that were converted to spaces
        dbToken = dbToken.replace(/ /g, '+');
        
        await saveDbToken(dbToken);
        // Enable the token so it becomes active immediately
        await enableDbToken();
        // Clear the active_token_id since this is a new token from URL
        localStorage.removeItem('active_token_id');
        
        // Clean URL and reload page to ensure all queries use the new token
        const newUrl = window.location.pathname + window.location.hash;
        window.history.replaceState({}, document.title, newUrl);
        
        // Force reload to ensure all data is fetched with new token
        window.location.reload();
        return dbToken;
    }
    return null;
};

// Synchronous extraction for early initialization (before React renders)
export const extractDbTokenFromUrlSync = () => {
    const params = new URLSearchParams(window.location.search);
    let dbToken = params.get('db_token');
    
    if (dbToken) {
        // URLSearchParams converts + to space, restore them
        dbToken = dbToken.replace(/ /g, '+');
        
        // Save synchronously to localStorage
        localStorage.setItem(TOKEN_KEY, dbToken);
        localStorage.setItem(TOKEN_ENABLED_KEY, 'true');
        localStorage.removeItem('active_token_id');
        
        // Clean URL
        const newUrl = window.location.pathname + window.location.hash;
        window.history.replaceState({}, document.title, newUrl);
        
        // Force reload to ensure all data is fetched with new token
        window.location.reload();
        return true;
    }
    return false;
};

// Check if token is enabled
export const isDbTokenEnabled = () => {
    const enabled = localStorage.getItem(TOKEN_ENABLED_KEY);
    return enabled === 'true';
};

// Enable token
export const enableDbToken = async () => {
    localStorage.setItem(TOKEN_ENABLED_KEY, 'true');
    try {
        const db = await openDB();
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        store.put({ key: TOKEN_ENABLED_KEY, value: 'true', updatedAt: Date.now() });
        await new Promise((resolve, reject) => {
            tx.oncomplete = resolve;
            tx.onerror = () => reject(tx.error);
        });
        db.close();
    } catch (e) {
        console.warn('Failed to save token enabled state to IndexedDB:', e);
    }
};

// Disable token (return to standard DB)
export const disableDbToken = async () => {
    localStorage.setItem(TOKEN_ENABLED_KEY, 'false');
    try {
        const db = await openDB();
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        store.put({ key: TOKEN_ENABLED_KEY, value: 'false', updatedAt: Date.now() });
        await new Promise((resolve, reject) => {
            tx.oncomplete = resolve;
            tx.onerror = () => reject(tx.error);
        });
        db.close();
    } catch (e) {
        console.warn('Failed to save token enabled state to IndexedDB:', e);
    }
};

// Get active token (only if enabled)
export const getActiveDbToken = () => {
    if (!isDbTokenEnabled()) return null;
    return localStorage.getItem(TOKEN_KEY);
};

// Delete token completely (single active token)
export const deleteDbToken = async () => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(TOKEN_ENABLED_KEY);
    localStorage.removeItem('active_token_id');
    try {
        const db = await openDB();
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        store.delete(TOKEN_KEY);
        store.delete(TOKEN_ENABLED_KEY);
        await new Promise((resolve, reject) => {
            tx.oncomplete = resolve;
            tx.onerror = () => reject(tx.error);
        });
        db.close();
    } catch (e) {
        console.warn('Failed to delete token from IndexedDB:', e);
    }
};

// Initialize: Sync from IDB, then check URL
export const initDbToken = async () => {
    await syncDbTokenFromIndexedDB();
    await extractAndSaveDbTokenFromUrl();
    return localStorage.getItem(TOKEN_KEY);
};

// Delete ALL token data (for complete reset)
export const deleteAllTokenData = async () => {
    // Clear all token-related localStorage items
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(TOKEN_ENABLED_KEY);
    localStorage.removeItem(SAVED_TOKENS_KEY);
    localStorage.removeItem('active_token_id');
    
    // Clear IndexedDB
    try {
        const db = await openDB();
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        store.delete(TOKEN_KEY);
        store.delete(TOKEN_ENABLED_KEY);
        store.delete(SAVED_TOKENS_KEY);
        await new Promise((resolve, reject) => {
            tx.oncomplete = resolve;
            tx.onerror = () => reject(tx.error);
        });
        db.close();
        console.log('[TokenStorage] All token data deleted');
    } catch (e) {
        console.warn('Failed to delete all token data from IndexedDB:', e);
    }
};

// ==========================================
// SAVED TOKENS MANAGEMENT (Multiple Named Tokens)
// ==========================================

// Get all saved tokens
export const getSavedTokens = () => {
    try {
        const saved = localStorage.getItem(SAVED_TOKENS_KEY);
        return saved ? JSON.parse(saved) : [];
    } catch (e) {
        console.warn('Failed to parse saved tokens:', e);
        return [];
    }
};

// Save a token with a name
export const saveNamedToken = async (name, token) => {
    const tokens = getSavedTokens();
    const existingIndex = tokens.findIndex(t => t.name === name);
    
    const tokenEntry = {
        id: existingIndex >= 0 ? tokens[existingIndex].id : crypto.randomUUID(),
        name,
        token,
        createdAt: existingIndex >= 0 ? tokens[existingIndex].createdAt : Date.now(),
        updatedAt: Date.now()
    };
    
    if (existingIndex >= 0) {
        tokens[existingIndex] = tokenEntry;
    } else {
        tokens.push(tokenEntry);
    }
    
    localStorage.setItem(SAVED_TOKENS_KEY, JSON.stringify(tokens));
    
    // Also save to IndexedDB for persistence
    try {
        const db = await openDB();
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        store.put({ key: SAVED_TOKENS_KEY, value: tokens, updatedAt: Date.now() });
        await new Promise((resolve, reject) => {
            tx.oncomplete = resolve;
            tx.onerror = () => reject(tx.error);
        });
        db.close();
    } catch (e) {
        console.warn('Failed to save tokens to IndexedDB:', e);
    }
    
    return tokenEntry;
};

// Delete a saved token by id
export const deleteNamedToken = async (id) => {
    const tokens = getSavedTokens().filter(t => t.id !== id);
    localStorage.setItem(SAVED_TOKENS_KEY, JSON.stringify(tokens));
    
    // Also update IndexedDB
    try {
        const db = await openDB();
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        store.put({ key: SAVED_TOKENS_KEY, value: tokens, updatedAt: Date.now() });
        await new Promise((resolve, reject) => {
            tx.oncomplete = resolve;
            tx.onerror = () => reject(tx.error);
        });
        db.close();
    } catch (e) {
        console.warn('Failed to update tokens in IndexedDB:', e);
    }
};

// Rename a saved token
export const renameToken = async (id, newName) => {
    const tokens = getSavedTokens();
    const token = tokens.find(t => t.id === id);
    if (token) {
        token.name = newName;
        token.updatedAt = Date.now();
        localStorage.setItem(SAVED_TOKENS_KEY, JSON.stringify(tokens));
        
        // Also update IndexedDB
        try {
            const db = await openDB();
            const tx = db.transaction(STORE_NAME, 'readwrite');
            const store = tx.objectStore(STORE_NAME);
            store.put({ key: SAVED_TOKENS_KEY, value: tokens, updatedAt: Date.now() });
            await new Promise((resolve, reject) => {
                tx.oncomplete = resolve;
                tx.onerror = () => reject(tx.error);
            });
            db.close();
        } catch (e) {
            console.warn('Failed to update tokens in IndexedDB:', e);
        }
    }
};

// Switch to a saved token (activate it)
export const switchToToken = async (id) => {
    const tokens = getSavedTokens();
    const tokenEntry = tokens.find(t => t.id === id);
    
    if (!tokenEntry) {
        throw new Error('Token not found');
    }
    
    // Save as active token
    await saveDbToken(tokenEntry.token);
    await enableDbToken();
    
    // Store active token id
    localStorage.setItem('active_token_id', id);
    
    return tokenEntry;
};

// Get currently active token id
export const getActiveTokenId = () => {
    return localStorage.getItem('active_token_id');
};

// Sync saved tokens from IndexedDB
export const syncSavedTokensFromIndexedDB = async () => {
    try {
        const db = await openDB();
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const request = store.get(SAVED_TOKENS_KEY);
        
        const result = await new Promise((resolve, reject) => {
            request.onsuccess = () => {
                db.close();
                resolve(request.result?.value || null);
            };
            request.onerror = () => {
                db.close();
                reject(request.error);
            };
        });
        
        if (result && Array.isArray(result)) {
            const localTokens = getSavedTokens();
            if (result.length > localTokens.length) {
                localStorage.setItem(SAVED_TOKENS_KEY, JSON.stringify(result));
                return result;
            }
        }
        
        return getSavedTokens();
    } catch (e) {
        console.warn('Failed to sync saved tokens from IndexedDB:', e);
        return getSavedTokens();
    }
};