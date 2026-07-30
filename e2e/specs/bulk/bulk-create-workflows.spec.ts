/**
 * bulkCreate (/api/db action: 'bulkCreate') integration tests.
 *
 * These are written FIRST (test-first) to pin the current behavior of the
 * bulkCreate path before its transaction is migrated to Kysely
 * (kysely.transaction().execute(trx => ...)). bulkCreate previously had NO
 * direct e2e coverage.
 *
 * What these pin (and therefore what the migration must preserve):
 *   - A batch of N rows is inserted atomically (all-or-nothing).
 *   - A mid-batch failure rolls back the whole batch (no partial rows).
 *   - An empty array short-circuits to [].
 *   - Column filtering via getValidColumns still drops unknown keys.
 *
 * Uses StaffingPlanEntry for the generic (non-ShiftEntry) branch: simple
 * columns, no central-absence routing, no sentinel duplicate-check, easy to
 * clean up. API-only; requires the Docker harness.
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

async function deleteRows(request: import('@playwright/test').APIRequestContext, auth: Auth, ids: string[]) {
  for (const id of ids) {
    await db(request, auth, { action: 'delete', table: 'StaffingPlanEntry', id });
  }
}

// A far-future month so seeded data never clashes.
const FUTURE_YEAR = 2099;
const FUTURE_MONTH = 12;
const DOCTOR_ID = 'doctor-clara';

test.describe('bulkCreate (generic branch — StaffingPlanEntry)', () => {
  test('inserts a batch of rows atomically and they are all readable', async ({ request }) => {
    const auth = await authenticate(request);
    const stamp = Date.now();
    const ids = [`bulk-a-${stamp}-1`, `bulk-a-${stamp}-2`, `bulk-a-${stamp}-3`];

    const res = await db(request, auth, {
      action: 'bulkCreate',
      table: 'StaffingPlanEntry',
      data: ids.map((id, i) => ({
        id,
        doctor_id: DOCTOR_ID,
        year: FUTURE_YEAR,
        month: FUTURE_MONTH,
        value: String(10 + i),
        // Unknown column — getValidColumns filtering must drop it, not error.
        not_a_real_column: 'should-be-ignored',
      })),
    });

    try {
      expect(res.ok(), 'bulkCreate should succeed').toBe(true);
      const created = await res.json();
      expect(created.length, 'all rows created').toBe(3);

      // Each row is readable via filter and reflects only valid columns.
      for (const id of ids) {
        const readRes = await db(request, auth, {
          action: 'filter',
          table: 'StaffingPlanEntry',
          query: { id },
        });
        const rows = await readRes.json();
        expect(rows.length, `row ${id} persisted`).toBe(1);
        expect(rows[0].value, 'value persisted').toMatch(/^(10|11|12)$/);
        expect(rows[0].not_a_real_column, 'unknown column dropped').toBeUndefined();
      }
    } finally {
      await deleteRows(request, auth, ids);
    }
  });

  test('rolls back the whole batch when one row fails (no partial inserts)', async ({ request }) => {
    const auth = await authenticate(request);
    const stamp = Date.now();
    const goodId = `bulk-rb-${stamp}-good`;
    // A row whose id duplicates an existing one (we insert it first) so the
    // SECOND insert in the batch violates the PK → triggers a rollback.
    const dupId = `bulk-rb-${stamp}-dup`;

    // Pre-insert the dup row so the batch's second item collides.
    await db(request, auth, {
      action: 'create',
      table: 'StaffingPlanEntry',
      data: { id: dupId, doctor_id: DOCTOR_ID, year: FUTURE_YEAR, month: FUTURE_MONTH, value: 'pre' },
    });

    try {
      // Batch: goodId (new) + dupId (collides) → batch must fail atomically.
      const res = await db(request, auth, {
        action: 'bulkCreate',
        table: 'StaffingPlanEntry',
        data: [
          { id: goodId, doctor_id: DOCTOR_ID, year: FUTURE_YEAR, month: FUTURE_MONTH, value: 'good' },
          { id: dupId, doctor_id: DOCTOR_ID, year: FUTURE_YEAR, month: FUTURE_MONTH, value: 'collide' },
        ],
      });

      expect(res.ok(), 'batch with a collision must fail').toBe(false);
      expect(res.status()).toBe(500);

      // Atomicity: goodId must NOT exist (rollback discarded it).
      const goodRead = await db(request, auth, {
        action: 'filter',
        table: 'StaffingPlanEntry',
        query: { id: goodId },
      });
      expect((await goodRead.json()).length, 'good row must be rolled back').toBe(0);

      // The pre-existing dupId keeps its original value (not overwritten).
      const dupRead = await db(request, auth, {
        action: 'filter',
        table: 'StaffingPlanEntry',
        query: { id: dupId },
      });
      const dupRows = await dupRead.json();
      expect(dupRows.length, 'pre-existing row still present').toBe(1);
      expect(dupRows[0].value, 'pre-existing row untouched').toBe('pre');
    } finally {
      await deleteRows(request, auth, [goodId, dupId]);
    }
  });

  test('an empty array short-circuits to []', async ({ request }) => {
    const auth = await authenticate(request);
    const res = await db(request, auth, { action: 'bulkCreate', table: 'StaffingPlanEntry', data: [] });
    expect(res.ok(), 'empty batch is valid').toBe(true);
    expect(await res.json()).toEqual([]);
  });
});
