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
});