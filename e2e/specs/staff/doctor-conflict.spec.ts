/**
 * Doctor conflict-detection tests (Phase 2, PR 2.4).
 *
 * The Doctor repo (doctorRepo.js) moves name/initials conflict detection from
 * dbProxy's generic dispatch into a dedicated module. These tests pin the 409
 * conflict behavior that the staff-workflows spec doesn't cover (it uses unique
 * suffixes and never collides). API-only; requires the Docker harness.
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

async function db(request: import('@playwright/test').APIRequestContext, auth: Auth, body: Record<string, unknown>) {
  return request.post(`${backendURL}/api/db`, { headers: authHeaders(auth), data: body });
}

test.describe('Doctor conflict detection (PR 2.4)', () => {
  test('create with a duplicate name is rejected (409, field: name)', async ({ request }) => {
    const auth = await authenticate(request);
    const stamp = Date.now();
    const name = `Conflict Doc ${stamp}`;
    const id1 = `doc-conflict-${stamp}-1`;

    // First create succeeds
    const first = await db(request, auth, {
      action: 'create',
      table: 'Doctor',
      data: { id: id1, name, initials: `C${stamp}`.slice(0, 4), order: 999, is_active: true },
    });
    expect(first.ok(), 'first create should succeed').toBe(true);

    try {
      // Second create with same name → 409 with field: 'name'
      const dup = await db(request, auth, {
        action: 'create',
        table: 'Doctor',
        data: { id: `doc-conflict-${stamp}-2`, name, initials: `D${stamp}`.slice(0, 4), order: 998, is_active: true },
      });
      expect(dup.status(), 'duplicate name must be rejected').toBe(409);
      const body = await dup.json();
      expect(body.field).toBe('name');
      expect(body.error).toMatch(/existiert bereits/);
    } finally {
      await db(request, auth, { action: 'delete', table: 'Doctor', id: id1 });
    }
  });

  test('create with duplicate initials is rejected (409, field: initials)', async ({ request }) => {
    const auth = await authenticate(request);
    const stamp = Date.now();
    const initials = `I${stamp}`.slice(0, 4);
    const id1 = `doc-init-${stamp}-1`;

    const first = await db(request, auth, {
      action: 'create',
      table: 'Doctor',
      data: { id: id1, name: `Init Doc A ${stamp}`, initials, order: 999, is_active: true },
    });
    expect(first.ok()).toBe(true);

    try {
      // Different name, SAME initials → 409 with field: 'initials'
      const dup = await db(request, auth, {
        action: 'create',
        table: 'Doctor',
        data: { id: `doc-init-${stamp}-2`, name: `Init Doc B ${stamp}`, initials, order: 998, is_active: true },
      });
      expect(dup.status(), 'duplicate initials must be rejected').toBe(409);
      const body = await dup.json();
      expect(body.field).toBe('initials');
      expect(body.error).toMatch(/Kürzel/);
    } finally {
      await db(request, auth, { action: 'delete', table: 'Doctor', id: id1 });
    }
  });
});
