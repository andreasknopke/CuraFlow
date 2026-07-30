/**
 * AbsenceRequest surface tests (Phase 2, PR 2.2).
 *
 * AbsenceRequest has TWO access surfaces:
 *   1. The dedicated route /api/absence-requests (the ONLY one the frontend
 *      uses — Vacation.tsx, MyDashboard.tsx).
 *   2. The generic /api/db dispatch (dbProxy.js) — which is BROKEN for
 *      AbsenceRequest (master-DB table, but the generic path resolves the
 *      TENANT pool → ER_NO_SUCH_TABLE, or master-without-token → bypasses all
 *      util validation + the approve→CentralAbsenceEntry side-effect).
 *
 * PR 2.2 rejects the generic surface so the broken/latent-bug path can never
 * bypass the dedicated route. These tests pin both:
 *   - the generic path is rejected (400, dedicated-route message)
 *   - the dedicated route still works (200)
 *
 * AbsenceRequest previously had ZERO e2e coverage on either surface.
 * API-only; requires the Docker harness.
 */
import { expect, test } from '@playwright/test';

import {
  backendURL,
  getTenantId,
  getUserPassword,
  seededUsers,
} from '../../support/config';

type Auth = { jwt: string; dbToken: string };

async function authenticate(request: import('@playwright/test').APIRequestContext): Promise<Auth> {
  const login = await request.post(`${backendURL}/api/auth/login`, {
    data: { email: seededUsers.admin.email, password: getUserPassword('admin') },
  });
  expect(login.ok(), 'admin login').toBe(true);
  const { token: jwt } = await login.json();
  const activate = await request.post(`${backendURL}/api/auth/activate-tenant/${getTenantId()}`, {
    headers: { Authorization: `Bearer ${jwt}` },
  });
  expect(activate.ok(), 'activate tenant').toBe(true);
  const { token: dbToken } = await activate.json();
  return { jwt, dbToken };
}

function authHeaders({ jwt, dbToken }: Auth): Record<string, string> {
  return {
    Authorization: `Bearer ${jwt}`,
    'Content-Type': 'application/json',
    'X-DB-Token': dbToken,
  };
}

test.describe('AbsenceRequest surfaces (PR 2.2)', () => {
  test('the generic /api/db path is rejected (400, dedicated-route message)', async ({ request }) => {
    const auth = await authenticate(request);
    // The broken generic path must now return a clean 400 instead of
    // ER_NO_SUCH_TABLE (with token) or silently corrupting master (without).
    const res = await request.post(`${backendURL}/api/db`, {
      headers: authHeaders(auth),
      data: { action: 'list', table: 'AbsenceRequest' },
    });
    expect(res.status(), 'generic /api/db for AbsenceRequest must be rejected').toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/absence-requests/i);
  });

  test('the dedicated /api/absence-requests route still works (200)', async ({ request }) => {
    const auth = await authenticate(request);
    // The legitimate surface (used by Vacation.tsx + MyDashboard.tsx) must be
    // unaffected by the generic-path rejection.
    const res = await request.get(`${backendURL}/api/absence-requests`, {
      headers: authHeaders(auth),
    });
    expect(res.ok(), 'dedicated route should succeed').toBe(true);
    const body = await res.json();
    expect(body, 'returns a requests array').toHaveProperty('requests');
    expect(Array.isArray(body.requests)).toBe(true);
  });

  test('the dedicated route pending-filter works (admin path MyDashboard uses)', async ({ request }) => {
    const auth = await authenticate(request);
    const res = await request.get(`${backendURL}/api/absence-requests?status=pending`, {
      headers: authHeaders(auth),
    });
    expect(res.ok(), 'pending-filter should succeed').toBe(true);
    const body = await res.json();
    expect(Array.isArray(body.requests)).toBe(true);
  });
});
