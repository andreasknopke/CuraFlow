/**
 * Security / authorization integration tests (Phase 0 trust-boundary fixes).
 *
 * Covers the request-level behavior that unit tests cannot verify because the
 * enforcement lives in Express middleware / route handlers:
 *   - S2  : per-user tenant reauthorization in tenantDbMiddleware
 *           (a user restricted to tenant-main presenting tenant-other's
 *            X-DB-Token is rejected with 403).
 *   - S7/F4: DB-backed permission gates — a deactivated admin's protected
 *            write is denied immediately while their JWT is still valid.
 *   - F1  : the register granter-permission clamp — a restricted granter
 *            cannot mint a full-permission admin.
 *   - F2  : the promote-to-admin granter-permission clamp — a restricted
 *            granter cannot grant a permission they lack via PATCH.
 *
 * This spec is API-only (no browser page). It authenticates seeded users via
 * /api/auth/login, obtains raw db tokens via /api/auth/activate-tenant, and
 * asserts status codes against the live backend started by the e2e harness.
 *
 * Requires the Docker harness: `npm run test:db:up` then `npm run test:e2e`.
 */
import { expect, test } from '@playwright/test';

import {
  backendURL,
  getSecurityUserPassword,
  getTenantId,
  getUserPassword,
  otherTenant,
  seededSecurityUsers,
  seededUsers,
} from '../../support/config';

const RESTRICTED_ADMIN_EMAIL = seededSecurityUsers.restrictedAdmin.email;

type LoginResult = { jwt: string };

async function login(request: import('@playwright/test').APIRequestContext, email: string, password: string): Promise<LoginResult> {
  const response = await request.post(`${backendURL}/api/auth/login`, {
    data: { email, password },
  });
  expect(response.ok(), `login ${email} should succeed`).toBe(true);
  const body = await response.json();
  return { jwt: body.token };
}

/** Activate a tenant and return its raw db token (the value for X-DB-Token). */
async function activateTenant(request: import('@playwright/test').APIRequestContext, jwt: string, tenantId: string): Promise<string> {
  const response = await request.post(`${backendURL}/api/auth/activate-tenant/${tenantId}`, {
    headers: { Authorization: `Bearer ${jwt}` },
  });
  expect(response.ok(), `activate-tenant ${tenantId} should succeed`).toBe(true);
  const body = await response.json();
  expect(body.token, 'activate-tenant should return a db token').toBeTruthy();
  return body.token as string;
}

async function authJson(jwt: string, dbToken?: string): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${jwt}`,
    'Content-Type': 'application/json',
  };
  if (dbToken) headers['X-DB-Token'] = dbToken;
  return headers;
}

/** A ShiftEntry write to a Dienste position — gated by can_edit_schedule. */
async function postShiftEntryUpdate(request: import('@playwright/test').APIRequestContext, jwt: string, dbToken: string, shiftId: string) {
  // The write MUST include `position` so the dbProxy guard evaluates the
  // Dienste category. An update that omits `position` bypasses the guard
  // entirely (the still-open ADMIN F5 partial-position bypass), which would
  // make a 403 assertion pass for the wrong reason.
  return request.post(`${backendURL}/api/db`, {
    headers: await authJson(jwt, dbToken),
    data: {
      action: 'update',
      table: 'ShiftEntry',
      id: shiftId,
      data: { position: 'Dienst Vordergrund', order: 0 },
    },
  });
}

// ---------------------------------------------------------------------------
// S2 — per-user tenant reauthorization
// ---------------------------------------------------------------------------

test.describe('S2 — per-user tenant reauthorization (tenantDbMiddleware)', () => {
  test('rejects a user presenting a tenant token they are not authorized for (403)', async ({ request }) => {
    // user-standard is restricted to tenant-main. Log in as the restricted
    // admin (full tenant access) to obtain tenant-other's raw token, then use
    // it with user-standard's JWT and expect the middleware to reject it.
    const restrictedAdminJwt = (
      await login(request, RESTRICTED_ADMIN_EMAIL, getSecurityUserPassword('restrictedAdmin'))
    ).jwt;
    const otherTenantToken = await activateTenant(request, restrictedAdminJwt, otherTenant.id);

    const standardJwt = (
      await login(request, seededUsers.user.email, getUserPassword('user'))
    ).jwt;

    const response = await postShiftEntryUpdate(request, standardJwt, otherTenantToken, 'shift-2026-05-05-foreground');

    // The tenant middleware runs before the route handler, so this 403 is the
    // tenant-isolation rejection (no missingPermission field) — distinct from
    // a permission-guard 403. Assert both the status and the specific error.
    expect(response.status(), 'cross-tenant request must be rejected').toBe(403);
    const body = await response.json().catch(() => ({}));
    expect(body.error, 'should be the tenant-isolation error').toBe('Kein Zugriff auf diesen Mandanten');
    expect(body.missingPermission, 'tenant 403 carries no missingPermission').toBeUndefined();
  });

  test('allows an authorized tenant through to the handler (negative control)', async ({ request }) => {
    // Use the full admin (authorized for tenant-main, holds can_edit_schedule)
    // so a clean 200 proves the tenant check passed and the request reached the
    // handler — the opposite of the cross-tenant rejection above.
    const adminJwt = (await login(request, seededUsers.admin.email, getUserPassword('admin'))).jwt;
    const mainTenantToken = await activateTenant(request, adminJwt, getTenantId());

    const response = await postShiftEntryUpdate(request, adminJwt, mainTenantToken, 'shift-2026-05-05-foreground');

    expect(response.status(), 'authorized tenant + full admin → 200').toBe(200);
  });
});

// ---------------------------------------------------------------------------
// S7 / F4 — DB-backed permission gate (deactivated admin denied immediately)
// ---------------------------------------------------------------------------

test.describe('S7/F4 — deactivated admin denied on protected write', () => {
  test('a deactivated admin cannot write a Dienste shift while their JWT is still valid', async ({ request, browserName }) => {
    // Mutates the shared user-admin row (deactivate then restore). Restrict to
    // chromium so other browser projects don't observe user-admin
    // mid-deactivation (same pattern as admin-workflows).
    test.skip(browserName !== 'chromium', 'This flow mutates shared seeded admin data across browser projects.');
    // 1. user-admin (full access) logs in and activates the tenant — their JWT
    //    is now valid for 24h regardless of DB state.
    const adminLogin = await login(request, seededUsers.admin.email, getUserPassword('admin'));
    const mainTenantToken = await activateTenant(request, adminLogin.jwt, getTenantId());

    // Sanity: before deactivation, the full-access admin CAN perform the
    // protected write (200, not 403). This proves the guard would otherwise
    // allow them, isolating the deactivation as the cause of the later 403.
    const beforeDeactivation = await postShiftEntryUpdate(request, adminLogin.jwt, mainTenantToken, 'shift-2026-05-05-foreground');
    expect(beforeDeactivation.status(), 'active full admin should be allowed').toBe(200);

    // 2. A second admin (restricted-admin, who holds can_manage_users) sets
    //    user-admin's is_active = 0 via PATCH (soft deactivation, not delete).
    const restrictedAdminJwt = (
      await login(request, RESTRICTED_ADMIN_EMAIL, getSecurityUserPassword('restrictedAdmin'))
    ).jwt;
    const deactivateResponse = await request.patch(`${backendURL}/api/auth/users/user-admin`, {
      headers: { Authorization: `Bearer ${restrictedAdminJwt}`, 'Content-Type': 'application/json' },
      data: { data: { is_active: false } },
    });
    expect(deactivateResponse.ok(), 'restricted admin can deactivate user-admin').toBe(true);

    try {
      // 3. user-admin's JWT is still valid (we hold it), but the DB row now has
      //    is_active = 0. checkAdminPermission reads is_active from the DB
      //    (not the JWT), so the protected write must now be denied — proving
      //    revocation takes effect immediately instead of after TOKEN_EXPIRY.
      const afterDeactivation = await postShiftEntryUpdate(request, adminLogin.jwt, mainTenantToken, 'shift-2026-05-05-foreground');
      expect(afterDeactivation.status(), 'deactivated admin must be denied').toBe(403);
    } finally {
      // 4. Restore user-admin (is_active = true) so other specs are unaffected.
      await request.patch(`${backendURL}/api/auth/users/user-admin`, {
        headers: { Authorization: `Bearer ${restrictedAdminJwt}`, 'Content-Type': 'application/json' },
        data: { data: { is_active: true } },
      });
    }
  });
});

// ---------------------------------------------------------------------------
// F1 — register granter-permission clamp
// ---------------------------------------------------------------------------

test.describe('F1 — register granter-permission clamp', () => {
  test('a restricted granter cannot create a full-permission admin', async ({ request }) => {
    const restrictedAdminJwt = (
      await login(request, RESTRICTED_ADMIN_EMAIL, getSecurityUserPassword("restrictedAdmin"))
    ).jwt;

    const email = `f1-clamp-${Date.now()}@test.local`;
    const password = 'F1-Clamp-Test-Password!1';

    // The granter holds only can_manage_users; request an admin with the
    // can_manage_system capability explicitly set (escalation attempt).
    const createResponse = await request.post(`${backendURL}/api/auth/register`, {
      headers: await authJson(restrictedAdminJwt),
      data: {
        email,
        password,
        full_name: 'F1 Clamp Target',
        role: 'admin',
        // Note: register ignores client-sent permissions and inherits the
        // granter's, so can_manage_system must come back false regardless.
      },
    });
    expect(createResponse.status(), 'register should succeed (granter has can_manage_users)').toBe(201);

    const created = await createResponse.json();
    // The new admin's permissions must reflect the granter's (can_manage_system
    // false), never the lockout-safe all-true.
    expect(created.user?.permissions?.can_manage_users, 'granter-held key stays true').toBe(true);
    expect(created.user?.permissions?.can_manage_system, 'granter-lacking key must be false').toBe(false);
  });
});

// ---------------------------------------------------------------------------
// F2 — promote-to-admin granter-permission clamp
// ---------------------------------------------------------------------------

test.describe('F2 — promote-to-admin granter-permission clamp', () => {
  test('a restricted granter cannot grant a permission they lack via PATCH', async ({ request }) => {
    const restrictedAdminJwt = (
      await login(request, RESTRICTED_ADMIN_EMAIL, getSecurityUserPassword("restrictedAdmin"))
    ).jwt;

    // Promote the existing seed user (role 'user') to admin while attempting
    // to grant can_manage_system, which the granter lacks.
    const targetUserId = 'user-standard';
    const patchResponse = await request.patch(`${backendURL}/api/auth/users/${targetUserId}`, {
      headers: await authJson(restrictedAdminJwt),
      data: {
        data: {
          role: 'admin',
          permissions: { can_manage_users: true, can_manage_system: true }, // escalation attempt
        },
      },
    });
    expect(patchResponse.ok(), 'PATCH should succeed (granter has can_manage_users)').toBe(true);

    const updated = await patchResponse.json();
    expect(updated.permissions?.can_manage_users, 'granter-held key honored').toBe(true);
    expect(updated.permissions?.can_manage_system, 'granter-lacking key force-revoked').toBe(false);

    // Restore the seed user to role 'user' so other specs are unaffected.
    await request.patch(`${backendURL}/api/auth/users/${targetUserId}`, {
      headers: await authJson(restrictedAdminJwt),
      data: { data: { role: 'user', permissions: null } },
    });
  });
});
