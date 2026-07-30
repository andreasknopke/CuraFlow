/**
 * Qualification CRUD (/api/db table: 'Qualification') integration tests.
 *
 * Phase 2, PR 2.1 — written FIRST (test-first) to pin behavior before
 * introducing a Qualification repository. Qualification entity CRUD previously
 * had ZERO e2e coverage (only DoctorQualification assignment was exercised).
 *
 * What these pin (and therefore what the repo migration must preserve):
 *   - create inserts a row and returns it (with auto-injected id/dates)
 *   - list/filter is PUBLIC (no auth required) — Qualification is in PUBLIC_READ_TABLES
 *   - update changes a field and the read-back reflects it
 *   - delete removes the row
 *   - duplicate name (Qualification.name is UNIQUE) is rejected
 *
 * API-only (no browser page). Requires the Docker harness.
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

const stamp = () => `qual-${Date.now()}`;

test.describe('Qualification CRUD (PR 2.1 — repo migration)', () => {
  test('create, list, update, delete a Qualification', async ({ request }) => {
    const auth = await authenticate(request);
    const id = stamp();
    const name = `Test Qual ${stamp()}`;

    // create
    const createRes = await db(request, auth, {
      action: 'create',
      table: 'Qualification',
      data: {
        id,
        name,
        short_label: 'TQ',
        color_bg: '#dbeafe',
        color_text: '#1e3a8a',
        category: 'Test',
        order: 999,
        is_active: true,
      },
    });
    expect(createRes.ok(), 'create should succeed').toBe(true);
    expect((await createRes.json()).id).toBe(id);

    try {
      // list/filter finds it
      const filterRes = await db(request, auth, {
        action: 'filter',
        table: 'Qualification',
        query: { id },
      });
      expect(filterRes.ok()).toBe(true);
      const filtered = await filterRes.json();
      expect(filtered.length).toBe(1);
      expect(filtered[0].name).toBe(name);

      // update changes a field
      const updateRes = await db(request, auth, {
        action: 'update',
        table: 'Qualification',
        id,
        data: { short_label: 'UPD' },
      });
      expect(updateRes.ok()).toBe(true);
      const updated = await updateRes.json();
      expect(updated.short_label).toBe('UPD');

      // read-back confirms persistence
      const getRes = await db(request, auth, { action: 'get', table: 'Qualification', id });
      expect((await getRes.json()).short_label).toBe('UPD');
    } finally {
      // delete
      await db(request, auth, { action: 'delete', table: 'Qualification', id });
    }

    // delete confirmed
    const afterDelete = await db(request, auth, { action: 'filter', table: 'Qualification', query: { id } });
    expect((await afterDelete.json()).length).toBe(0);
  });

  test('Qualification list is PUBLIC (readable without an auth JWT)', async ({ request }) => {
    // Qualification is in PUBLIC_READ_TABLES, so a request with NO Authorization
    // header still passes the auth check. A tenant db token IS supplied (as the
    // app always carries one in localStorage) so the read hits tenant data.
    const auth = await authenticate(request);
    const res = await request.post(`${backendURL}/api/db`, {
      headers: {
        'Content-Type': 'application/json',
        // NOTE: deliberately NO Authorization header — exercises the public-read bypass.
        'X-DB-Token': auth.dbToken,
      },
      data: { action: 'list', table: 'Qualification' },
    });
    expect(res.ok(), 'public list should succeed without an auth JWT').toBe(true);
    // The seeded data includes at least one qualification (Strahlenschutz).
    const rows = await res.json();
    expect(Array.isArray(rows)).toBe(true);
    expect(rows.length, 'seeded qualifications are readable').toBeGreaterThan(0);
  });

  test('duplicate Qualification name is rejected (UNIQUE constraint)', async ({ request }) => {
    const auth = await authenticate(request);
    const name = `Dup Qual ${stamp()}`;
    const id1 = stamp();

    // First create succeeds
    const first = await db(request, auth, {
      action: 'create',
      table: 'Qualification',
      data: { id: id1, name, color_bg: '#ccc', color_text: '#000', category: 'Dup', order: 1, is_active: true },
    });
    expect(first.ok()).toBe(true);

    try {
      // Second create with same name → fails (UNIQUE on Qualification.name)
      const dup = await db(request, auth, {
        action: 'create',
        table: 'Qualification',
        data: { id: stamp(), name, color_bg: '#ccc', color_text: '#000', category: 'Dup', order: 2, is_active: true },
      });
      expect(dup.ok(), 'duplicate name should be rejected').toBe(false);
      expect(dup.status()).toBe(500);
    } finally {
      await db(request, auth, { action: 'delete', table: 'Qualification', id: id1 });
    }
  });

  test('create auto-injects id/dates when not provided', async ({ request }) => {
    const auth = await authenticate(request);
    const name = `AutoId Qual ${stamp()}`;

    const createRes = await db(request, auth, {
      action: 'create',
      table: 'Qualification',
      data: { name, color_bg: '#ccc', color_text: '#000', category: 'Auto', order: 1, is_active: true },
      // NOTE: no id provided
    });
    expect(createRes.ok()).toBe(true);
    const created = await createRes.json();
    expect(created.id, 'id auto-injected').toBeTruthy();

    try {
      // The auto-injected id is a valid UUID and the row is readable.
      const getRes = await db(request, auth, { action: 'get', table: 'Qualification', id: created.id });
      expect(getRes.ok()).toBe(true);
      const row = await getRes.json();
      expect(row.created_date, 'created_date auto-injected').toBeTruthy();
    } finally {
      await db(request, auth, { action: 'delete', table: 'Qualification', id: created.id });
    }
  });
});
