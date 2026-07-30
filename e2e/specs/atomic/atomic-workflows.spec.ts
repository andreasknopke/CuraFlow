/**
 * Atomic operations (/api/atomic) integration tests.
 *
 * Phase 1, PR 1.4 migrated the atomic.js helper functions (getRecord,
 * filterRecords, createRecord, updateRecord, deleteRecord) to route SQL through
 * Kysely so identifiers are escaped centrally. Before this spec, /api/atomic
 * had NO direct e2e coverage (only indirect via the training-transfer UI flow).
 * This spec exercises every migrated helper through the live endpoint so the
 * migration is verified at the request level — not just indirectly.
 *
 * Operations covered (each maps to the helpers it exercises):
 *   - checkAndCreate        → filterRecords (dup check) + createRecord
 *   - checkAndCreate dup    → filterRecords returns 409
 *   - checkAndUpdate        → getRecord (concurrency read) + updateRecord
 *   - upsertStaffing create → filterRecords + createRecord
 *   - upsertStaffing update → filterRecords + updateRecord
 *   - upsertStaffing delete → filterRecords + deleteRecord
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

  // Activate the seeded tenant to obtain its raw db token (X-DB-Token).
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

async function atomic(
  request: import('@playwright/test').APIRequestContext,
  auth: Auth,
  body: Record<string, unknown>,
) {
  return request.post(`${backendURL}/api/atomic`, { headers: authHeaders(auth), data: body });
}

test.describe('atomic operations (PR 1.4 — Kysely migration)', () => {
  test('checkAndCreate creates a record and rejects a duplicate', async ({ request }) => {
    const auth = await authenticate(request);
    // A unique SystemSetting row (id is a UUID; key is the natural unique key).
    const id = `atomic-test-${Date.now()}`;
    const key = `atomic_test_key_${Date.now()}`;

    // createRecord path: no existing record → 200 with the created row.
    const createRes = await atomic(request, auth, {
      operation: 'checkAndCreate',
      entity: 'SystemSetting',
      data: { id, key, value: 'v1' },
      check: { uniqueKeys: ['key'] },
    });
    expect(createRes.ok(), 'first create should succeed').toBe(true);
    expect((await createRes.json()).id).toBe(id);

    // filterRecords duplicate-check path: same key → 409 DUPLICATE_ERROR.
    const dupRes = await atomic(request, auth, {
      operation: 'checkAndCreate',
      entity: 'SystemSetting',
      data: { id: `${id}-dup`, key, value: 'v2' },
      check: { uniqueKeys: ['key'] },
    });
    expect(dupRes.status(), 'duplicate must be rejected').toBe(409);
    const dupBody = await dupRes.json();
    expect(dupBody.error).toBe('DUPLICATE_ERROR');

    // Cleanup via /api/db delete (SystemSetting isn't central-routed).
    await request.post(`${backendURL}/api/db`, {
      headers: authHeaders(auth),
      data: { action: 'delete', table: 'SystemSetting', id },
    });
  });

  test('checkAndUpdate updates a record and detects concurrent modification', async ({ request }) => {
    const auth = await authenticate(request);
    const id = `atomic-upd-${Date.now()}`;
    // Seed a row to update.
    await atomic(request, auth, {
      operation: 'checkAndCreate',
      entity: 'SystemSetting',
      data: { id, key: `upd_${Date.now()}`, value: 'original' },
    });

    // Read it back via /api/db to get the authoritative updated_date for the
    // concurrency check (checkAndUpdate compares check.updated_date).
    const getRes = await request.post(`${backendURL}/api/db`, {
      headers: authHeaders(auth),
      data: { action: 'get', table: 'SystemSetting', id },
    });
    const existing = await getRes.json();
    expect(existing.value).toBe('original');

    // updateRecord path: matching updated_date → 200 with updated value.
    const updateRes = await atomic(request, auth, {
      operation: 'checkAndUpdate',
      entity: 'SystemSetting',
      id,
      data: { value: 'changed' },
      check: { updated_date: existing.updated_date },
    });
    expect(updateRes.ok(), 'update with correct updated_date should succeed').toBe(true);
    expect((await updateRes.json()).value).toBe('changed');

    // getRecord concurrency-check path: a clearly stale updated_date (far in
    // the past) must be rejected → 409 CONCURRENCY_ERROR. Using a deliberately
    // mismatched value avoids DATETIME(3) millisecond-truncation fragility.
    const staleRes = await atomic(request, auth, {
      operation: 'checkAndUpdate',
      entity: 'SystemSetting',
      id,
      data: { value: 'stale-attempt' },
      check: { updated_date: '2000-01-01 00:00:00' },
    });
    expect(staleRes.status(), 'stale update must be rejected').toBe(409);
    expect((await staleRes.json()).error).toBe('CONCURRENCY_ERROR');

    await request.post(`${backendURL}/api/db`, {
      headers: authHeaders(auth),
      data: { action: 'delete', table: 'SystemSetting', id },
    });
  });

  test('upsertStaffing creates, updates, and deletes a StaffingPlanEntry', async ({ request }) => {
    const auth = await authenticate(request);
    // Use a seeded doctor + a far-future month unlikely to clash with seed data.
    const doctorId = 'doctor-clara';
    const year = 2099;
    const month = 12;

    // createRecord path (no existing entry): upsert creates it.
    const createRes = await atomic(request, auth, {
      operation: 'upsertStaffing',
      data: { doctor_id: doctorId, year, month, value: '5' },
    });
    expect(createRes.ok(), 'upsert create').toBe(true);
    const created = await createRes.json();
    expect(created.value).toBe('5');
    const staffingId = created.id;
    expect(staffingId).toBeTruthy();

    // updateRecord path: existing entry, old_value_check matches → update.
    const updateRes = await atomic(request, auth, {
      operation: 'upsertStaffing',
      data: { doctor_id: doctorId, year, month, value: '8', old_value_check: '5' },
    });
    expect(updateRes.ok(), 'upsert update').toBe(true);
    expect((await updateRes.json()).value).toBe('8');

    // deleteRecord path: empty value → delete the entry.
    const deleteRes = await atomic(request, auth, {
      operation: 'upsertStaffing',
      data: { doctor_id: doctorId, year, month, value: '', old_value_check: '8' },
    });
    expect(deleteRes.ok(), 'upsert delete').toBe(true);
    expect((await deleteRes.json()).deleted).toBe(true);

    // Confirm it's gone (filterRecords finds nothing).
    const verifyRes = await request.post(`${backendURL}/api/db`, {
      headers: authHeaders(auth),
      data: { action: 'filter', table: 'StaffingPlanEntry', query: { doctor_id: doctorId, year, month } },
    });
    expect((await verifyRes.json())).toHaveLength(0);
  });
});
