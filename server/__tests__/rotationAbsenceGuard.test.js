import { describe, expect, it } from 'vitest';
import {
  findUnavailableAbsenceForAssignment,
  isUnavailablePosition,
  normalizePosition,
} from '../utils/rotationAbsenceGuard.js';

describe('normalizePosition / isUnavailablePosition', () => {
  it('normalizes umlauts and case ("Nicht verfügbar" == "nicht verfuegbar")', () => {
    expect(normalizePosition('Nicht verfügbar')).toBe('nicht verfugbar');
    // NFD entfernt nur echte Umlaute, nicht die ASCII-Umschreibung "ue" —
    // die Gleichheit stellt isUnavailablePosition über die Varianten-Menge her.
    expect(normalizePosition('nicht verfuegbar')).toBe('nicht verfuegbar');
    expect(normalizePosition('  Urlaub  ')).toBe('urlaub');
  });

  it('detects "Nicht verfügbar" regardless of spelling', () => {
    expect(isUnavailablePosition('Nicht verfügbar')).toBe(true);
    expect(isUnavailablePosition('nicht verfuegbar')).toBe(true);
    expect(isUnavailablePosition('nicht verfügbar')).toBe(true);
  });

  it('rejects other positions', () => {
    expect(isUnavailablePosition('Urlaub')).toBe(false);
    expect(isUnavailablePosition('Frei')).toBe(false);
    expect(isUnavailablePosition(null)).toBe(false);
    expect(isUnavailablePosition(undefined)).toBe(false);
  });
});

describe('findUnavailableAbsenceForAssignment', () => {
  function createMasterDb({ absenceRows = [], throwOnAbsence = false } = {}) {
    const calls = [];
    const masterDb = {
      calls,
      execute: async (sql, params) => {
        calls.push({ sql: String(sql), params });
        if (String(sql).includes('FROM CentralAbsenceEntry')) {
          if (throwOnAbsence) throw new Error('CentralAbsenceEntry table missing');
          return [absenceRows];
        }
        return [[]];
      },
    };
    return masterDb;
  }

  function createTenantDb({ doctorRow = null, shiftRows = [], throwOnDoctor = false } = {}) {
    const calls = [];
    const tenantDb = {
      calls,
      execute: async (sql, params) => {
        calls.push({ sql: String(sql), params });
        if (String(sql).startsWith('SELECT id, central_employee_id FROM Doctor')) {
          if (throwOnDoctor) throw new Error('Doctor table missing');
          return [doctorRow ? [doctorRow] : []];
        }
        if (String(sql).includes('FROM ShiftEntry')) {
          return [shiftRows];
        }
        return [[]];
      },
    };
    return tenantDb;
  }

  const DATE = '2026-08-05';

  it('blocks when the local tenant ShiftEntry is "Nicht verfügbar"', async () => {
    const tenantDb = createTenantDb({
      doctorRow: { id: 'doc-1', central_employee_id: null },
      shiftRows: [{ position: 'Nicht verfügbar' }],
    });
    const masterDb = createMasterDb();

    const result = await findUnavailableAbsenceForAssignment({ masterDb, tenantDb, employeeId: 'doc-1', date: DATE });

    expect(result).toEqual({ position: 'Nicht verfügbar', source: 'tenant' });
  });

  it('blocks lowercase umlaut-free spelling ("nicht verfuegbar")', async () => {
    const tenantDb = createTenantDb({
      doctorRow: { id: 'doc-1', central_employee_id: null },
      shiftRows: [{ position: 'nicht verfuegbar' }],
    });
    const masterDb = createMasterDb();

    const result = await findUnavailableAbsenceForAssignment({ masterDb, tenantDb, employeeId: 'doc-1', date: DATE });

    expect(result).toEqual({ position: 'nicht verfuegbar', source: 'tenant' });
  });

  it('does not block non-unavailable local shifts', async () => {
    const tenantDb = createTenantDb({
      doctorRow: { id: 'doc-1', central_employee_id: null },
      shiftRows: [{ position: 'Urlaub' }, { position: 'Frei' }],
    });
    const masterDb = createMasterDb();

    const result = await findUnavailableAbsenceForAssignment({ masterDb, tenantDb, employeeId: 'doc-1', date: DATE });

    expect(result).toBeNull();
  });

  it('blocks via CentralAbsenceEntry when the local doctor has a central link', async () => {
    const tenantDb = createTenantDb({
      doctorRow: { id: 'doc-1', central_employee_id: 'employee-1' },
      shiftRows: [],
    });
    const masterDb = createMasterDb({
      absenceRows: [{ position: 'Nicht verfügbar' }],
    });

    const result = await findUnavailableAbsenceForAssignment({ masterDb, tenantDb, employeeId: 'doc-1', date: DATE });

    expect(result).toEqual({ position: 'Nicht verfügbar', source: 'central' });
    // Die zentrale Prüfung muss die central_employee_id des Doctors enthalten
    const absenceCall = masterDb.calls.find((c) => c.sql.includes('FROM CentralAbsenceEntry'));
    expect(absenceCall.params).toContain('employee-1');
  });

  it('checks the employee_id directly as a central UUID (Springer/Joker)', async () => {
    const tenantDb = createTenantDb({ doctorRow: null, shiftRows: [] });
    const masterDb = createMasterDb({
      absenceRows: [{ position: 'nicht verfuegbar' }],
    });

    const result = await findUnavailableAbsenceForAssignment({ masterDb, tenantDb, employeeId: 'employee-99', date: DATE });

    expect(result).toEqual({ position: 'nicht verfuegbar', source: 'central' });
  });

  it('returns null when no absence exists', async () => {
    const tenantDb = createTenantDb({
      doctorRow: { id: 'doc-1', central_employee_id: 'employee-1' },
      shiftRows: [],
    });
    const masterDb = createMasterDb({ absenceRows: [] });

    const result = await findUnavailableAbsenceForAssignment({ masterDb, tenantDb, employeeId: 'doc-1', date: DATE });

    expect(result).toBeNull();
  });

  it('is fail-open when the Doctor/ShiftEntry tables are missing (fresh tenant)', async () => {
    const tenantDb = createTenantDb({ throwOnDoctor: true });
    const masterDb = createMasterDb({ absenceRows: [] });

    const result = await findUnavailableAbsenceForAssignment({ masterDb, tenantDb, employeeId: 'doc-1', date: DATE });

    expect(result).toBeNull();
  });

  it('is fail-open when CentralAbsenceEntry does not exist yet', async () => {
    const tenantDb = createTenantDb({
      doctorRow: { id: 'doc-1', central_employee_id: null },
      shiftRows: [],
    });
    const masterDb = createMasterDb({ throwOnAbsence: true });

    const result = await findUnavailableAbsenceForAssignment({ masterDb, tenantDb, employeeId: 'doc-1', date: DATE });

    expect(result).toBeNull();
  });

  it('works without a tenant pool (master-only check)', async () => {
    const masterDb = createMasterDb({
      absenceRows: [{ position: 'Nicht verfügbar' }],
    });

    const result = await findUnavailableAbsenceForAssignment({ masterDb, tenantDb: null, employeeId: 'employee-1', date: DATE });

    expect(result).toEqual({ position: 'Nicht verfügbar', source: 'central' });
  });
});
