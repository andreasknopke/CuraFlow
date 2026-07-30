/**
 * Tests for the approvalWriteRequiresPermission logic in dbProxy.js.
 *
 * Key regression: a normal user creating a "kein Dienst" (no_service) wish
 * with status 'approved' must NOT require can_approve_wishes when the tenant
 * setting no_service_requires_approval is false.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../index.js', () => ({
  db: { execute: vi.fn() },
  removeTenantPool: vi.fn(),
}));

vi.mock('../utils/realtime.js', () => ({
  broadcastPlanUpdate: vi.fn(),
  buildRealtimeScope: vi.fn(),
  isPlanSyncEntity: vi.fn(),
}));

vi.mock('../utils/permissions.js', () => ({
  checkAdminPermission: vi.fn(),
  requirePermission: () => (req, res, next) => next(),
  isSuperAdmin: vi.fn(() => false),
  loadPermissions: vi.fn(),
  clampPermissionsToGranter: vi.fn(),
  ALL_PERMISSIONS_TRUE: {},
}));

vi.mock('../scripts/seed-runtime-shared.js', () => ({
  ensureTenantBaseTables: vi.fn(),
}));

vi.mock('../utils/centralAbsences.js', () => ({
  deleteCentralAbsenceById: vi.fn(),
  getShiftEntryWithCentralAbsence: vi.fn(),
  isCentralAbsencePosition: vi.fn(),
  listShiftEntriesWithCentralAbsences: vi.fn(),
  writeShiftEntryToCentralAbsence: vi.fn(),
}));

vi.mock('../utils/tenantGroups.js', () => ({
  resolveTenantIdFromToken: vi.fn(),
}));

vi.mock('../utils/db.js', () => ({
  createKysely: vi.fn(),
}));

vi.mock('../utils/schema.js', () => ({
  COLUMNS_CACHE: new Map(),
  clearColumnsCache: vi.fn(),
  ensureColumns: vi.fn(),
  assertValidIdentifier: vi.fn(),
}));

vi.mock('./auth.js', () => ({
  authMiddleware: vi.fn((req, res, next) => next()),
}));

const { approvalWriteRequiresPermission } = await import('../routes/dbProxy.js');

describe('approvalWriteRequiresPermission', () => {
  describe('create action', () => {
    it('does not require permission for a pending wish', () => {
      expect(approvalWriteRequiresPermission({
        action: 'create',
        data: { type: 'no_service', status: 'pending' },
        existingStatus: null,
      })).toBe(false);
    });

    it('requires permission for an approved service wish', () => {
      expect(approvalWriteRequiresPermission({
        action: 'create',
        data: { type: 'service', status: 'approved' },
        existingStatus: null,
      })).toBe(true);
    });

    it('requires permission for an approved no_service wish when approval IS required', () => {
      expect(approvalWriteRequiresPermission({
        action: 'create',
        data: { type: 'no_service', status: 'approved' },
        existingStatus: null,
        noServiceRequiresApproval: true,
      })).toBe(true);
    });

    it('does NOT require permission for an approved no_service wish when approval is NOT required', () => {
      expect(approvalWriteRequiresPermission({
        action: 'create',
        data: { type: 'no_service', status: 'approved' },
        existingStatus: null,
        noServiceRequiresApproval: false,
      })).toBe(false);
    });

    it('still requires permission for a rejected no_service wish even when approval is not required', () => {
      expect(approvalWriteRequiresPermission({
        action: 'create',
        data: { type: 'no_service', status: 'rejected' },
        existingStatus: null,
        noServiceRequiresApproval: false,
      })).toBe(true);
    });
  });

  describe('update action', () => {
    it('requires permission when promoting to approved', () => {
      expect(approvalWriteRequiresPermission({
        action: 'update',
        data: { status: 'approved' },
        existingStatus: 'pending',
      })).toBe(true);
    });

    it('requires permission when editing an already-approved record', () => {
      expect(approvalWriteRequiresPermission({
        action: 'update',
        data: { reason: 'changed' },
        existingStatus: 'approved',
      })).toBe(true);
    });

    it('does not require permission for editing a pending record without status change', () => {
      expect(approvalWriteRequiresPermission({
        action: 'update',
        data: { reason: 'changed' },
        existingStatus: 'pending',
      })).toBe(false);
    });
  });

  describe('delete action', () => {
    it('does not require permission for deleting a pending record', () => {
      expect(approvalWriteRequiresPermission({
        action: 'delete',
        data: null,
        existingStatus: 'pending',
      })).toBe(false);
    });

    it('requires permission for deleting an approved record', () => {
      expect(approvalWriteRequiresPermission({
        action: 'delete',
        data: null,
        existingStatus: 'approved',
      })).toBe(true);
    });
  });

  describe('bulkCreate action', () => {
    it('does not require permission when all entries are pending', () => {
      expect(approvalWriteRequiresPermission({
        action: 'bulkCreate',
        data: [
          { type: 'no_service', status: 'pending' },
          { type: 'service', status: 'pending' },
        ],
        existingStatus: null,
      })).toBe(false);
    });

    it('requires permission when any entry is approved', () => {
      expect(approvalWriteRequiresPermission({
        action: 'bulkCreate',
        data: [
          { type: 'no_service', status: 'pending' },
          { type: 'service', status: 'approved' },
        ],
        existingStatus: null,
      })).toBe(true);
    });
  });
});
