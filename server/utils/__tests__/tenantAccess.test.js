import { describe, expect, it, vi } from 'vitest';
import {
  authorizeTenantToken,
  canAccessTenant,
  filterTokensByTenantAccess,
  parseTenantAccess,
} from '../tenantAccess.js';

describe('tenantAccess helpers', () => {
  it('treats empty tenant configuration as full access and invalid JSON as denied', () => {
    expect(parseTenantAccess(null)).toEqual({
      tenantIds: [],
      hasFullAccess: true,
      isValid: true,
    });

    expect(parseTenantAccess('["tenant-a", 2]')).toEqual({
      tenantIds: ['tenant-a', '2'],
      hasFullAccess: false,
      isValid: true,
    });

    expect(parseTenantAccess('not-json')).toEqual({
      tenantIds: [],
      hasFullAccess: false,
      isValid: false,
    });
  });

  it('filters visible tenant tokens according to the parsed access list', () => {
    const access = parseTenantAccess(['tenant-a']);
    const tokens = [
      { id: 'tenant-a', name: 'A' },
      { id: 'tenant-b', name: 'B' },
    ];

    expect(canAccessTenant(access, 'tenant-a')).toBe(true);
    expect(canAccessTenant(access, 'tenant-b')).toBe(false);
    expect(filterTokensByTenantAccess(tokens, access)).toEqual([{ id: 'tenant-a', name: 'A' }]);
  });

  it('authorizes an encrypted token only when the user is allowed to access it', async () => {
    const masterDb = {
      execute: vi
        .fn()
        .mockResolvedValueOnce([{}])
        .mockResolvedValueOnce([[{ id: 'tenant-a', name: 'Tenant A' }]])
        .mockResolvedValueOnce([[{ allowed_tenants: '["tenant-a"]' }]]),
    };

    await expect(
      authorizeTenantToken(masterDb, 'user-1', 'encrypted-token'),
    ).resolves.toMatchObject({
      allowed: true,
      tokenRecord: { id: 'tenant-a', name: 'Tenant A' },
    });
  });

  it('rejects access when the token is outside the user allowlist', async () => {
    const masterDb = {
      execute: vi
        .fn()
        .mockResolvedValueOnce([{}])
        .mockResolvedValueOnce([[{ id: 'tenant-b', name: 'Tenant B' }]])
        .mockResolvedValueOnce([[{ allowed_tenants: '["tenant-a"]' }]]),
    };

    await expect(
      authorizeTenantToken(masterDb, 'user-1', 'encrypted-token'),
    ).resolves.toMatchObject({
      allowed: false,
      status: 403,
      error: 'Kein Zugriff auf diesen Mandanten',
    });
  });

  it('returns 403 with Ungültiger Mandanten-Token when no token record is found', async () => {
    const masterDb = {
      // ensureDbTokensTable → no rows for token
      execute: vi.fn().mockResolvedValueOnce([{}]).mockResolvedValueOnce([[]]),
    };

    await expect(authorizeTenantToken(masterDb, 'user-1', 'unknown-token')).resolves.toMatchObject({
      allowed: false,
      status: 403,
      error: 'Ungültiger Mandanten-Token',
      tokenRecord: null,
    });
  });

  it('returns 401 when user is not found in app_users', async () => {
    const masterDb = {
      execute: vi
        .fn()
        .mockResolvedValueOnce([{}]) // ensureDbTokensTable
        .mockResolvedValueOnce([[{ id: 'tenant-a', name: 'Tenant A' }]]) // token found
        .mockResolvedValueOnce([[]]), // user not found
    };

    await expect(
      authorizeTenantToken(masterDb, 'ghost-user', 'encrypted-token'),
    ).resolves.toMatchObject({
      allowed: false,
      status: 401,
      error: 'Nicht autorisiert',
    });
  });

  it('returns 403 when the users allowed_tenants value is malformed JSON', async () => {
    const masterDb = {
      execute: vi
        .fn()
        .mockResolvedValueOnce([{}]) // ensureDbTokensTable
        .mockResolvedValueOnce([[{ id: 'tenant-a' }]]) // token found
        .mockResolvedValueOnce([[{ allowed_tenants: 'not-json' }]]), // bad tenant config
    };

    await expect(
      authorizeTenantToken(masterDb, 'user-1', 'encrypted-token'),
    ).resolves.toMatchObject({
      allowed: false,
      status: 403,
      error: 'Mandantenzugriff fehlerhaft konfiguriert',
    });
  });

  it('returns true access when user has full access (null allowed_tenants)', async () => {
    const masterDb = {
      execute: vi
        .fn()
        .mockResolvedValueOnce([{}]) // ensureDbTokensTable
        .mockResolvedValueOnce([[{ id: 'any-tenant' }]]) // token found
        .mockResolvedValueOnce([[{ allowed_tenants: null }]]), // full access
    };

    await expect(
      authorizeTenantToken(masterDb, 'admin-user', 'encrypted-token'),
    ).resolves.toMatchObject({ allowed: true });
  });
});
