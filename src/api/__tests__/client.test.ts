import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { api, resolveRequestRetryable } from '../client';

describe('resolveRequestRetryable', () => {
  it('does not mark non-database failures as retryable', () => {
    expect(resolveRequestRetryable({
      status: 500,
      errorData: {},
      databaseError: false,
    })).toBe(false);
  });

  it('respects explicit non-retryable flags from the server', () => {
    expect(resolveRequestRetryable({
      status: 500,
      errorData: {
        code: 'ER_DBACCESS_DENIED_ERROR',
        retryable: false,
      },
      databaseError: true,
    })).toBe(false);
  });

  it('keeps retrying transient database failures when the server allows it', () => {
    expect(resolveRequestRetryable({
      status: 503,
      errorData: {
        code: 'PROTOCOL_CONNECTION_LOST',
        retryable: true,
      },
      databaseError: true,
    })).toBe(true);
  });

  it('falls back to retrying server-side database failures when no retry hint is present', () => {
    expect(resolveRequestRetryable({
      status: 500,
      errorData: {
        code: 'ER_LOCK_WAIT_TIMEOUT',
      },
      databaseError: true,
    })).toBe(true);
  });
});

describe('api.request', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
      removeItem: vi.fn(),
      clear: vi.fn(),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('returns null for successful 204 responses', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(null, {
        status: 204,
      })
    );

    await expect(api.request('/api/groups/1/shifts/shift-1', { method: 'DELETE' })).resolves.toBeNull();
  });

  it('does not attach tenant DB token to master-admin token management routes', async () => {
    (localStorage.getItem as any).mockImplementation((key: string) => {
      if (key === 'radioplan_jwt_token') return 'jwt-token';
      if (key === 'db_token_enabled') return 'true';
      if (key === 'db_credentials') return 'tenant-token';
      return null;
    });
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('[]', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    await api.request('/api/admin/db-tokens');

    expect(fetchMock).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
      headers: expect.not.objectContaining({ 'X-DB-Token': 'tenant-token' }),
    }));
  });

  it('keeps attaching tenant DB token to tenant data routes', async () => {
    (localStorage.getItem as any).mockImplementation((key: string) => {
      if (key === 'radioplan_jwt_token') return 'jwt-token';
      if (key === 'db_token_enabled') return 'true';
      if (key === 'db_credentials') return 'tenant-token';
      return null;
    });
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('[]', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    await api.request('/api/db', { method: 'POST', body: JSON.stringify({ action: 'list', table: 'Doctor' }) });

    expect(fetchMock).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
      headers: expect.objectContaining({ 'X-DB-Token': 'tenant-token' }),
    }));
  });
});
