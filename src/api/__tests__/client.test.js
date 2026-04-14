import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { APIClient, EntityClient, setApiToast } from '../client.js';
import { JWT_REFRESH_TOKEN_KEY, JWT_TOKEN_KEY } from '@/constants/storageKeys';

describe('APIClient auth refresh flow', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
    global.fetch = vi.fn();
  });

  afterEach(() => {
    delete global.fetch;
  });

  it('refreshes an expired access token and retries the original request once', async () => {
    const client = new APIClient();

    localStorage.setItem(JWT_TOKEN_KEY, 'expired-access');
    localStorage.setItem(JWT_REFRESH_TOKEN_KEY, 'refresh-token-1');

    global.fetch
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: 'Token ungültig oder abgelaufen' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ token: 'fresh-access', refreshToken: 'refresh-token-2' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 'user-1', email: 'admin@example.com' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

    await expect(client.me()).resolves.toEqual({
      id: 'user-1',
      email: 'admin@example.com',
    });

    expect(global.fetch).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('/api/auth/refresh'),
      expect.objectContaining({
        method: 'POST',
      }),
    );
    expect(localStorage.getItem(JWT_TOKEN_KEY)).toBe('fresh-access');
    expect(localStorage.getItem(JWT_REFRESH_TOKEN_KEY)).toBe('refresh-token-2');
  });

  it('clears stored tokens when refresh fails', async () => {
    const client = new APIClient();

    localStorage.setItem(JWT_TOKEN_KEY, 'expired-access');
    localStorage.setItem(JWT_REFRESH_TOKEN_KEY, 'expired-refresh');

    global.fetch
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: 'Token ungültig oder abgelaufen' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: 'Refresh-Token ungültig oder abgelaufen' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

    await expect(client.me()).rejects.toThrow('Refresh-Token ungültig oder abgelaufen');

    expect(localStorage.getItem(JWT_TOKEN_KEY)).toBeNull();
    expect(localStorage.getItem(JWT_REFRESH_TOKEN_KEY)).toBeNull();
  });
});

describe('EntityClient CRUD wrappers', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
    global.fetch = vi.fn();
    localStorage.setItem(JWT_TOKEN_KEY, 'valid-token');
  });

  afterEach(() => {
    delete global.fetch;
  });

  const makeOkResponse = (body) =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  it('EntityClient.list posts the expected db action payload', async () => {
    const client = new EntityClient('Doctor');
    global.fetch.mockResolvedValueOnce(makeOkResponse([{ id: '1', name: 'Dr. Test' }]));

    const result = await client.list();

    expect(result).toEqual([{ id: '1', name: 'Dr. Test' }]);
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/db'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ action: 'list', table: 'Doctor' }),
      }),
    );
  });

  it('EntityClient.create sends a create db action with data', async () => {
    const client = new EntityClient('Doctor');
    const newDoc = { name: 'Dr. New', initials: 'DN' };
    global.fetch.mockResolvedValueOnce(makeOkResponse({ id: 'new-id', ...newDoc }));

    const result = await client.create(newDoc);

    expect(result).toMatchObject({ id: 'new-id', name: 'Dr. New' });
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/db'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ action: 'create', table: 'Doctor', data: newDoc }),
      }),
    );
  });

  it('EntityClient.update sends an update db action', async () => {
    const client = new EntityClient('Doctor');
    global.fetch.mockResolvedValueOnce(makeOkResponse({ id: 'doc-1', name: 'Updated' }));

    await client.update('doc-1', { name: 'Updated' });

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/db'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          action: 'update',
          table: 'Doctor',
          id: 'doc-1',
          data: { name: 'Updated' },
        }),
      }),
    );
  });

  it('EntityClient.delete sends a delete db action', async () => {
    const client = new EntityClient('Doctor');
    global.fetch.mockResolvedValueOnce(makeOkResponse({ success: true }));

    await client.delete('doc-1');

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/db'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ action: 'delete', table: 'Doctor', id: 'doc-1' }),
      }),
    );
  });

  it('throws when response is 404', async () => {
    const client = new EntityClient('Doctor');
    global.fetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'Not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    await expect(client.get('missing-id')).rejects.toThrow();
  });

  it('shows a database toast after repeated database failures', async () => {
    vi.useFakeTimers();
    const toast = vi.fn();
    setApiToast(toast);

    const client = new EntityClient('Doctor');
    global.fetch.mockImplementation(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            error: 'MySQL server has gone away',
            databaseError: true,
            code: 'ER_CON_COUNT_ERROR',
          }),
          {
            status: 503,
            headers: { 'Content-Type': 'application/json' },
          },
        ),
      ),
    );

    const request = client.list();
    const expectation = expect(request).rejects.toThrow('MySQL server has gone away');

    await vi.runAllTimersAsync();
    await expectation;
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({
        variant: 'destructive',
        title: 'Datenbankproblem',
      }),
    );

    vi.useRealTimers();
  });
});
