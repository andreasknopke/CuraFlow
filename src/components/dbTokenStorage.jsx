// IndexedDB + localStorage Hybrid Storage for DB Token
// Ensures token persistence across PWA and browser contexts

const DB_NAME = 'RadioPlanDB';
const STORE_NAME = 'settings';
const TOKEN_KEY = 'db_credentials';
const TOKEN_ENABLED_KEY = 'db_token_enabled';

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
    const dbToken = params.get('db_token');
    
    if (dbToken) {
        await saveDbToken(dbToken);
        // Clean URL
        const newUrl = window.location.pathname + window.location.hash;
        window.history.replaceState({}, document.title, newUrl);
        return dbToken;
    }
    return null;
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

// Delete token completely
export const deleteDbToken = async () => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(TOKEN_ENABLED_KEY);
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