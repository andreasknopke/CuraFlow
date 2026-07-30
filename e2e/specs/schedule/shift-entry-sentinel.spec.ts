/**
 * ShiftEntry "sentinel" conflict tests (Phase 2, PR 2.5 — shiftEntryRepo.js).
 *
 * The create path POST /api/db (table 'ShiftEntry', action 'create') runs two
 * guards before inserting (server/repos/shiftEntryRepo.js, createShiftEntry):
 *
 *   1. ScheduleBlock lock: a ScheduleBlock row matching date+position (with
 *      timeslot_id NULL when the entry carries none) rejects the create with
 *      HTTP 409 and body { error: 'Zelle gesperrt[: <reason>]', blocked: true,
 *      block_id, reason }.
 *   2. Duplicate position: when the Workplace does NOT allow multiple
 *      assignments (allows_multiple = false, or NULL with category 'Dienste' /
 *      'Demonstrationen & Konsile'), a second entry on the same date+position
 *      is rejected with HTTP 409 and body { error: 'Position bereits besetzt',
 *      conflict: true, existing_id, existing_doctor_id }. allows_multiple =
 *      true (or category 'Rotationen' / unknown) bypasses the guard.
 *
 * NOT covered here — ShiftTimeRule auto-time (shiftEntryRepo.js ~239-272):
 * setting it up requires a ShiftTimeRule row, but 'ShiftTimeRule' is not in
 * TENANT_BASE_TABLES (dbProxy.js), so /api/db routes it to the master pool
 * where the table does not exist, and no dedicated route writes ShiftTimeRule
 * rows. There is no API-only way to seed a rule, so auto-time stays untested
 * at e2e level.
 *
 * All fixtures (Workplace / ScheduleBlock / ShiftEntry rows) are created via
 * the API inside each test and cleaned up in finally blocks. API-only;
 * requires the Docker harness.
 */
import { expect, test } from '@playwright/test';

import {
  backendURL,
  getTenantId,
  getUserPassword,
  seededSchedule,
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

// Compact unique stamp: ShiftEntry/Workplace/ScheduleBlock ids are VARCHAR(36),
// so generated ids must stay short (base36 timestamp keeps them well under).
const stamp = () => `s${Date.now().toString(36)}`;

// A date inside the seeded target month. Unique position names per run make
// cross-run collisions impossible, so a fixed day is safe.
const testDate = `${seededSchedule.targetMonth}-20`;

async function createWorkplace(
  request: import('@playwright/test').APIRequestContext,
  auth: Auth,
  data: Record<string, unknown>
) {
  const res = await db(request, auth, { action: 'create', table: 'Workplace', data });
  expect(res.ok(), `create Workplace ${data.id} should succeed`).toBe(true);
}

async function createShiftEntry(
  request: import('@playwright/test').APIRequestContext,
  auth: Auth,
  data: Record<string, unknown>
) {
  return db(request, auth, { action: 'create', table: 'ShiftEntry', data });
}

async function expectOk(res: import('@playwright/test').APIResponse, label: string) {
  const body = await res.text();
  expect(res.ok(), `${label} (got ${res.status()}: ${body})`).toBe(true);
}

test.describe('ShiftEntry sentinel conflicts (PR 2.5 — shiftEntryRepo.js)', () => {
  test('ScheduleBlock on the cell rejects the create with 409 "Zelle gesperrt"', async ({ request }) => {
    const auth = await authenticate(request);
    const run = stamp();
    const workplaceId = `wp-blk-${run}`;
    const position = `Sentinel Block ${run}`;
    const blockId = `sb-${run}`;
    const entryId = `se-blk-${run}`;
    const controlEntryId = `se-blk-ctl-${run}`;
    const reason = 'OP-Saal renoviert';

    await createWorkplace(request, auth, {
      id: workplaceId,
      name: position,
      category: 'Rotationen',
      order: 900,
      is_active: true,
      allows_multiple: true,
    });

    try {
      // Lock the cell date+position (no timeslot → entry without timeslot_id matches).
      const blockRes = await db(request, auth, {
        action: 'create',
        table: 'ScheduleBlock',
        data: { id: blockId, date: testDate, position, reason, type: 'block' },
      });
      expect(blockRes.ok(), 'create ScheduleBlock should succeed').toBe(true);

      try {
        // Creating a ShiftEntry on the locked cell → 409.
        const res = await createShiftEntry(request, auth, {
          id: entryId,
          date: testDate,
          position,
          doctor_id: 'doctor-anna',
        });
        expect(res.status(), 'blocked cell must return 409').toBe(409);
        const body = await res.json();
        expect(body.error).toBe(`Zelle gesperrt: ${reason}`);
        expect(body.blocked).toBe(true);
        expect(body.block_id).toBe(blockId);
        expect(body.reason).toBe(reason);

        // Control: the same position on a DIFFERENT (unblocked) date is allowed.
        const control = await createShiftEntry(request, auth, {
          id: controlEntryId,
          date: `${seededSchedule.targetMonth}-21`,
          position,
          doctor_id: 'doctor-anna',
        });
        await expectOk(control, 'unblocked date should succeed');
      } finally {
        await db(request, auth, { action: 'delete', table: 'ShiftEntry', id: entryId });
        await db(request, auth, { action: 'delete', table: 'ShiftEntry', id: controlEntryId });
      }
    } finally {
      await db(request, auth, { action: 'delete', table: 'ScheduleBlock', id: blockId });
      await db(request, auth, { action: 'delete', table: 'Workplace', id: workplaceId });
    }
  });

  test('ScheduleBlock without a reason returns exactly "Zelle gesperrt"', async ({ request }) => {
    const auth = await authenticate(request);
    const run = stamp();
    const workplaceId = `wp-blknr-${run}`;
    const position = `Sentinel BlockNoReason ${run}`;
    const blockId = `sb-nr-${run}`;
    const entryId = `se-blknr-${run}`;

    await createWorkplace(request, auth, {
      id: workplaceId,
      name: position,
      category: 'Rotationen',
      order: 901,
      is_active: true,
      allows_multiple: true,
    });

    try {
      const blockRes = await db(request, auth, {
        action: 'create',
        table: 'ScheduleBlock',
        data: { id: blockId, date: testDate, position, type: 'block' },
      });
      expect(blockRes.ok(), 'create ScheduleBlock should succeed').toBe(true);

      try {
        const res = await createShiftEntry(request, auth, {
          id: entryId,
          date: testDate,
          position,
          doctor_id: 'doctor-anna',
        });
        expect(res.status(), 'blocked cell must return 409').toBe(409);
        const body = await res.json();
        // No reason → no ": <reason>" suffix on the message.
        expect(body.error).toBe('Zelle gesperrt');
        expect(body.blocked).toBe(true);
        expect(body.block_id).toBe(blockId);
      } finally {
        await db(request, auth, { action: 'delete', table: 'ShiftEntry', id: entryId });
      }
    } finally {
      await db(request, auth, { action: 'delete', table: 'ScheduleBlock', id: blockId });
      await db(request, auth, { action: 'delete', table: 'Workplace', id: workplaceId });
    }
  });

  test('duplicate entry on a single-assignment position returns 409 "Position bereits besetzt"', async ({ request }) => {
    const auth = await authenticate(request);
    const run = stamp();
    const workplaceId = `wp-dup-${run}`;
    const position = `Sentinel Dup ${run}`;
    const firstId = `se-dup-a-${run}`;
    const secondId = `se-dup-b-${run}`;

    // allows_multiple: false → single assignment (category 'Dienste' would also
    // default to single-assignment when allows_multiple is NULL).
    await createWorkplace(request, auth, {
      id: workplaceId,
      name: position,
      category: 'Dienste',
      order: 902,
      is_active: true,
      allows_multiple: false,
    });

    try {
      // First entry occupies the position.
      const first = await createShiftEntry(request, auth, {
        id: firstId,
        date: testDate,
        position,
        doctor_id: 'doctor-anna',
      });
      await expectOk(first, 'first entry should succeed');

      try {
        // Second entry on the same date+position → 409.
        const second = await createShiftEntry(request, auth, {
          id: secondId,
          date: testDate,
          position,
          doctor_id: 'doctor-bruno',
        });
        expect(second.status(), 'duplicate must return 409').toBe(409);
        const body = await second.json();
        expect(body.error).toBe('Position bereits besetzt');
        expect(body.conflict).toBe(true);
        expect(body.existing_id).toBe(firstId);
        expect(body.existing_doctor_id).toBe('doctor-anna');
      } finally {
        await db(request, auth, { action: 'delete', table: 'ShiftEntry', id: secondId });
      }
    } finally {
      await db(request, auth, { action: 'delete', table: 'ShiftEntry', id: firstId });
      await db(request, auth, { action: 'delete', table: 'Workplace', id: workplaceId });
    }
  });

  test('allows_multiple positions accept a second entry (sentinel bypass)', async ({ request }) => {
    const auth = await authenticate(request);
    const run = stamp();
    const workplaceId = `wp-mul-${run}`;
    const position = `Sentinel Multi ${run}`;
    const firstId = `se-mul-a-${run}`;
    const secondId = `se-mul-b-${run}`;

    await createWorkplace(request, auth, {
      id: workplaceId,
      name: position,
      category: 'Rotationen',
      order: 903,
      is_active: true,
      allows_multiple: true,
    });

    try {
      const first = await createShiftEntry(request, auth, {
        id: firstId,
        date: testDate,
        position,
        doctor_id: 'doctor-anna',
      });
      await expectOk(first, 'first entry should succeed');

      const second = await createShiftEntry(request, auth, {
        id: secondId,
        date: testDate,
        position,
        doctor_id: 'doctor-bruno',
      });
      await expectOk(second, 'second entry on allows_multiple position should succeed');
    } finally {
      await db(request, auth, { action: 'delete', table: 'ShiftEntry', id: firstId });
      await db(request, auth, { action: 'delete', table: 'ShiftEntry', id: secondId });
      await db(request, auth, { action: 'delete', table: 'Workplace', id: workplaceId });
    }
  });
});
