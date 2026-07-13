import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Fake localStorage (node environment has none) ───────────────────────────
function createFakeLocalStorage() {
  const store: any = {};
  return {
    getItem(key: any) { return store[key] ?? null; },
    setItem(key: any, val: any) { store[key] = String(val); },
    removeItem(key: any) { delete store[key]; },
    clear() { Object.keys(store).forEach(k => delete store[k]); },
  };
}

const fakeLocalStorage = createFakeLocalStorage();

// ── Fake IndexedDB ───────────────────────────────────────────────────────────
// Fully functional in-memory IndexedDB mock. Every request fires its callback
// asynchronously (via microtask) so callers can set onsuccess/onerror first.

const fakeObjectStore = new Map(); // key → { key, value, updatedAt }

function asyncCall(fn: any) {
  Promise.resolve().then(fn);
}

function createFakeDB() {
  return {
    objectStoreNames: { contains: () => true },
    transaction(_storeName: any, _mode: any) {
      const tx: any = {
        objectStore() {
          return {
            put(record: any) {
              fakeObjectStore.set(record.key, record);
              const req: any = { onsuccess: null, onerror: null, result: undefined };
              asyncCall(() => req.onsuccess?.());
              return req;
            },
            get(key: any) {
              const entry = fakeObjectStore.get(key) || undefined;
              const req: any = { onsuccess: null, onerror: null, result: entry };
              asyncCall(() => req.onsuccess?.());
              return req;
            },
            delete(key: any) {
              fakeObjectStore.delete(key);
              const req: any = { onsuccess: null, onerror: null, result: undefined };
              asyncCall(() => req.onsuccess?.());
              return req;
            },
          };
        },
        oncomplete: null,
        onerror: null,
      };
      // Fire tx.oncomplete asynchronously
      asyncCall(() => tx.oncomplete?.());
      return tx;
    },
    close() {},
  };
}

vi.stubGlobal('localStorage', fakeLocalStorage);
vi.stubGlobal('indexedDB', {
  open() {
    const db = createFakeDB();
    const req: any = { onsuccess: null, onerror: null, onupgradeneeded: null, result: db };
    // openDB resolves via request.result (not event.target.result)
    asyncCall(() => req.onsuccess?.());
    return req;
  },
});

// Import after globals are stubbed
const {
  getActiveDbToken,
  getActiveTokenId,
  saveDbToken,
  clearActiveDbToken,
  getTokenFromIndexedDB,
  saveTokenToIndexedDB,
} = await import('../dbTokenStorage');

describe('dbTokenStorage', () => {
  beforeEach(() => {
    fakeLocalStorage.clear();
    fakeObjectStore.clear();
  });

  it('getActiveTokenId() returns stored token id', () => {
    fakeLocalStorage.setItem('active_token_id', 'token-123');
    expect(getActiveTokenId()).toBe('token-123');
  });

  it('getActiveDbToken() returns stored credentials', () => {
    fakeLocalStorage.setItem('db_token_enabled', 'true');
    fakeLocalStorage.setItem('db_credentials', 'my-secret-token');

    expect(getActiveDbToken()).toBe('my-secret-token');
  });

  it('saveDbToken() / getActiveDbToken() stores and retrieves correctly', async () => {
    await saveDbToken('test-token-abc');

    expect(fakeLocalStorage.getItem('db_credentials')).toBe('test-token-abc');

    const idbToken = await getTokenFromIndexedDB();
    expect(idbToken).toBe('test-token-abc');
  });

  it('clearDbToken() removes stored credentials', async () => {
    fakeLocalStorage.setItem('db_token_enabled', 'true');
    fakeLocalStorage.setItem('db_credentials', 'token-to-clear');
    fakeLocalStorage.setItem('active_token_id', 'id-1');
    await saveTokenToIndexedDB('token-to-clear');

    await clearActiveDbToken();

    expect(fakeLocalStorage.getItem('db_credentials')).toBeNull();
    expect(fakeLocalStorage.getItem('db_token_enabled')).toBe('false');
    expect(fakeLocalStorage.getItem('active_token_id')).toBeNull();
  });
});
