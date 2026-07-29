import { describe, expect, it, beforeEach, vi } from 'vitest';

// permissions.js imports the master pool (`db`) from index.js, which in turn
// imports express (not installed in this environment). Mock the index module
// before importing the unit under test. The functions under test take their DB
// as a parameter, so the stub never runs.
vi.mock('../index.js', () => ({ db: {}, getTenantDb: () => ({}), removeTenantPool: () => {} }));

import { checkAdminPermission, clampPermissionsToGranter } from '../utils/permissions.js';

/**
 * Mock master DB whose execute() returns the given rows. Mirrors the
 * `dbWith(rows)` pattern in tenantGroups.test.js.
 */
function dbWith(rows) {
  return { async execute() { return [rows, []]; } };
}

/** Stub DB whose execute() throws — simulates a transient master-DB error. */
function dbThatThrows(message = 'boom') {
  return { async execute() { throw new Error(message); } };
}

beforeEach(() => {
  // No super-admin env leaks across tests; the super-admin branch is exercised
  // explicitly below with a configured env.
  delete process.env.SUPER_ADMINS_EMAILS;
});

describe('checkAdminPermission — DB-backed admin/permission resolution (S7 / F4)', () => {
  const USER_ID = 'u-1';

  it('denies when the user row is missing', async () => {
    const result = await checkAdminPermission(dbWith([]), USER_ID, 'can_edit_schedule');
    expect(result).toEqual({ allowed: false, reason: 'no_user' });
  });

  it('denies when the user is deactivated (is_active = 0)', async () => {
    // Regression for the F4 root cause: the OLD guard filtered `is_active = 1`
    // in the WHERE clause, so a deactivated user returned no row, the
    // permission lookup yielded null, and loadPermissions() fell back to
    // ALL_PERMISSIONS_TRUE — granting full access. Here the denial is explicit.
    const result = await checkAdminPermission(
      dbWith([{ email: 'a@x.de', role: 'admin', is_active: 0, permissions: null }]),
      USER_ID,
      'can_edit_schedule',
    );
    expect(result).toEqual({ allowed: false, reason: 'inactive' });
  });

  it('denies when the DB role is no longer admin (demotion)', async () => {
    // Regression for F4: role is read from the DB row, not the JWT, so a
    // demoted admin is denied even while their 24h JWT still says 'admin'.
    const result = await checkAdminPermission(
      dbWith([{ email: 'a@x.de', role: 'user', is_active: 1, permissions: null }]),
      USER_ID,
      'can_edit_schedule',
    );
    expect(result).toEqual({ allowed: false, reason: 'not_admin' });
  });

  it('denies when the admin lacks the requested permission', async () => {
    const result = await checkAdminPermission(
      dbWith([{
        email: 'a@x.de',
        role: 'admin',
        is_active: 1,
        permissions: JSON.stringify({ can_edit_schedule: false }),
      }]),
      USER_ID,
      'can_edit_schedule',
    );
    expect(result.allowed).toBe(false);
  });

  it('allows when the admin holds the requested permission', async () => {
    const result = await checkAdminPermission(
      dbWith([{
        email: 'a@x.de',
        role: 'admin',
        is_active: 1,
        permissions: JSON.stringify({ can_edit_schedule: true }),
      }]),
      USER_ID,
      'can_edit_schedule',
    );
    expect(result).toEqual({ allowed: true, reason: 'checked' });
  });

  it('treats an active admin with null/empty permissions as full-access (lockout-safe)', async () => {
    // The lockout-safe default still applies — but only to an ACTIVE admin row,
    // never to a missing/deactivated one (the F4 fix narrows the blast radius).
    const result = await checkAdminPermission(
      dbWith([{ email: 'a@x.de', role: 'admin', is_active: 1, permissions: null }]),
      USER_ID,
      'can_manage_system',
    );
    expect(result).toEqual({ allowed: true, reason: 'checked' });
  });

  it('bypasses for a configured super-admin email', async () => {
    process.env.SUPER_ADMINS_EMAILS = 'boss@x.de';
    const result = await checkAdminPermission(
      dbWith([{ email: 'boss@x.de', role: 'admin', is_active: 1, permissions: null }]),
      USER_ID,
      'can_manage_system',
    );
    expect(result).toEqual({ allowed: true, reason: 'super_admin' });
  });

  it('is fail-closed on a transient DB error', async () => {
    // A DB error during the permission lookup must deny, never allow.
    const result = await checkAdminPermission(dbThatThrows(), USER_ID, 'can_edit_schedule');
    expect(result).toEqual({ allowed: false, reason: 'error' });
  });
});

describe('clampPermissionsToGranter — granter cannot grant what they lack (F1/F2/F3)', () => {
  it('force-revokes every key the granter lacks, even if incoming sets it true', () => {
    const granterPerms = {
      can_manage_users: true,
      can_manage_system: false,
      can_edit_schedule: false,
    };
    const incoming = {
      can_manage_users: true,
      can_manage_system: true, // attempted escalation
      can_edit_schedule: true, // attempted escalation
    };
    const result = clampPermissionsToGranter(incoming, granterPerms);
    expect(result.can_manage_users).toBe(true); // granter has it → honored
    expect(result.can_manage_system).toBe(false); // granter lacks → revoked
    expect(result.can_edit_schedule).toBe(false); // granter lacks → revoked
  });

  it('honors an explicit revocation of a key the granter has', () => {
    const granterPerms = { can_manage_users: true, can_manage_system: true };
    const incoming = { can_manage_users: false };
    const result = clampPermissionsToGranter(incoming, granterPerms);
    expect(result.can_manage_users).toBe(false);
  });

  it('defaults keys absent from incoming to true (only granter-lacking → false)', () => {
    const granterPerms = { can_manage_system: false };
    const result = clampPermissionsToGranter({}, granterPerms);
    expect(result.can_manage_system).toBe(false);
    // A key the granter has and the client omitted stays true (default-allow).
    expect(result.can_manage_users).toBe(true);
  });

  it('preserves a full-access granter (no key revoked)', () => {
    const granterPerms = {}; // no key is false → granter has everything
    const incoming = { can_manage_system: true };
    const result = clampPermissionsToGranter(incoming, granterPerms);
    expect(result.can_manage_system).toBe(true);
  });
});
