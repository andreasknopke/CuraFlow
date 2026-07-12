import { describe, expect, it } from 'vitest';
import { createShiftValidator } from '../ShiftValidation';

function createValidator(workplaces = []) {
  return createShiftValidator({
    doctors: [{ id: 'doctor-1', role: 'Facharzt', fte: 1 }],
    shifts: [
      {
        id: 'shift-1',
        doctor_id: 'doctor-1',
        date: '2026-05-19',
        position: 'Frei',
      },
    ],
    workplaces,
    wishes: [],
    systemSettings: [],
    staffingEntries: [],
    timeslots: [],
    qualificationMap: {},
    getDoctorQualIds: () => [],
    wpQualsByWorkplace: {},
  });
}

describe('ShiftValidator absence overlap setting', () => {
  it('blocks overlapping absence and duty by default', () => {
    const validator = createValidator([
      { id: 'workplace-1', name: 'Bereitschaftsdienst', category: 'Dienste' },
    ]);

    const result = validator.validate('doctor-1', '2026-05-19', 'Bereitschaftsdienst');

    expect(result.canProceed).toBe(false);
    expect(result.blockers).toContain('Mitarbeiter ist bereits als "Frei" eingetragen (blockiert).');
  });

  it('allows overlapping absence and duty when the workplace setting is enabled', () => {
    const validator = createValidator([
      { id: 'workplace-1', name: 'Bereitschaftsdienst', category: 'Dienste', allows_absence_overlap: true },
    ]);

    const result = validator.validate('doctor-1', '2026-05-19', 'Bereitschaftsdienst');

    expect(result.canProceed).toBe(true);
    expect(result.blockers).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it('blocks a tenant rotation when an exclusive cross-tenant service already exists for the linked employee', () => {
    const validator = createShiftValidator({
      doctors: [{ id: 'doctor-1', role: 'Facharzt', fte: 1, central_employee_id: 'employee-1' }],
      shifts: [],
      sharedShifts: [
        {
          id: 'shared-1',
          date: '2026-05-19',
          employee_id: 'employee-1',
          workplace_name: 'Pool Hintergrund',
          workplace_category: 'Dienste',
          allows_rotation_concurrently: false,
          affects_availability: true,
        },
      ],
      workplaces: [
        { id: 'workplace-1', name: 'CT Rotation', category: 'Rotationen', affects_availability: true },
      ],
      wishes: [],
      systemSettings: [],
      staffingEntries: [],
      timeslots: [],
      qualificationMap: {},
      getDoctorQualIds: () => [],
      wpQualsByWorkplace: {},
    });

    const result = validator.validate('doctor-1', '2026-05-19', 'CT Rotation');

    expect(result.canProceed).toBe(false);
    expect(result.blockers).toContain('Konflikt: "Pool Hintergrund" blockiert Rotation.');
  });

  it('blocks an availability-affecting non-service area when an exclusive cross-tenant service already exists for the linked employee', () => {
    const validator = createShiftValidator({
      doctors: [{ id: 'doctor-1', role: 'Facharzt', fte: 1, central_employee_id: 'employee-1' }],
      shifts: [],
      sharedShifts: [
        {
          id: 'shared-1',
          date: '2026-05-19',
          employee_id: 'employee-1',
          workplace_name: 'Pool Hintergrund',
          workplace_category: 'Dienste',
          allows_rotation_concurrently: false,
          affects_availability: true,
        },
      ],
      workplaces: [
        { id: 'workplace-1', name: 'CT Spezialbereich', category: 'Demonstrationen & Konsile', affects_availability: true },
      ],
      wishes: [],
      systemSettings: [],
      staffingEntries: [],
      timeslots: [],
      qualificationMap: {},
      getDoctorQualIds: () => [],
      wpQualsByWorkplace: {},
    });

    const result = validator.validate('doctor-1', '2026-05-19', 'CT Spezialbereich');

    expect(result.canProceed).toBe(false);
    expect(result.blockers).toContain('Konflikt: "Pool Hintergrund" blockiert diesen Bereich.');
  });
});

/**
 * Vacation-overshoot rule: when a user plans an "Urlaub" shift that
 * would push the employee past their annual entitlement, the validator
 * must emit a warning. The actual save must still go through (warning,
 * not blocker) — managers explicitly asked for the "Warnsymbol wie bei
 * anderen Regelüberschreitungen" UX.
 */
describe('ShiftValidator vacation overshoot', () => {
  function build(overrides = {}) {
    return createShiftValidator({
      doctors: [{ id: 'doctor-1', role: 'Facharzt', fte: 1, vacation_days: 30 }],
      shifts: [],
      workplaces: [],
      wishes: [],
      systemSettings: [],
      staffingEntries: [],
      timeslots: [],
      qualificationMap: {},
      getDoctorQualIds: () => [],
      wpQualsByWorkplace: {},
      ...overrides,
    });
  }

  // Build N consecutive past weekdays in 2026 (Mon–Fri only).
  function buildPastWeekdays(start, count) {
    const dates = [];
    let cursor = new Date(start);
    while (dates.length < count) {
      const day = cursor.getDay();
      if (day !== 0 && day !== 6) {
        dates.push(cursor.toISOString().slice(0, 10));
      }
      cursor.setDate(cursor.getDate() + 1);
    }
    return dates;
  }

  it('does NOT warn when remaining Urlaub is within the annual entitlement', () => {
    const validator = build({
      shifts: [
        { id: 's-1', doctor_id: 'doctor-1', date: '2026-05-19', position: 'Urlaub' },
      ],
    });
    const result = validator.validate('doctor-1', '2026-05-20', 'Urlaub');
    expect(result.warnings.find((w) => w.startsWith('Urlaubskontingent'))).toBeUndefined();
    expect(result.canProceed).toBe(true);
  });

  it('warns when the new Urlaub would push the employee past the entitlement', () => {
    // 30 past weekdays already booked → entitlement exhausted. The next
    // workday (which the user is about to insert) must trigger the warning.
    const shifts = buildPastWeekdays(new Date('2026-01-05'), 30).map((date, i) => ({
      id: `s-${i}`,
      doctor_id: 'doctor-1',
      date,
      position: 'Urlaub',
    }));
    const validator = build({ shifts });
    // 2026-02-16 is a Monday — well within the year of the past dates.
    const result = validator.validate('doctor-1', '2026-02-16', 'Urlaub');
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^Urlaubskontingent überschritten: 1 Tag über dem Jahresanspruch \(30 Tage\)\.$/),
      ])
    );
    // Warning, not blocker — the user can still proceed.
    expect(result.canProceed).toBe(true);
    expect(result.blockers).toEqual([]);
  });

  it('does NOT warn for non-Urlaub positions even when other Urlaub is overbooked', () => {
    const shifts = buildPastWeekdays(new Date('2026-01-05'), 35).map((date, i) => ({
      id: `s-${i}`,
      doctor_id: 'doctor-1',
      date,
      position: 'Urlaub',
    }));
    const validator = build({ shifts });
    const result = validator.validate('doctor-1', '2026-05-20', 'Krank');
    expect(result.warnings.find((w) => w.startsWith('Urlaubskontingent'))).toBeUndefined();
  });

  it('uses singular "Tag" for a 1-day overshoot', () => {
    // 30 past weekdays + candidate 2026-05-21 = 31, entitlement 30 → 1 over.
    const past = buildPastWeekdays(new Date('2026-01-05'), 30);
    const shifts = past.map((date, i) => ({
      id: `s-${i}`,
      doctor_id: 'doctor-1',
      date,
      position: 'Urlaub',
    }));
    const validator = build({ shifts });
    // 2026-05-21 is a Thursday
    const result = validator.validate('doctor-1', '2026-05-21', 'Urlaub');
    const warning = result.warnings.find((w) => w.startsWith('Urlaubskontingent'));
    expect(warning).toBeDefined();
    expect(warning).toMatch(/1 Tag über/);
  });

  it('does not double-count the candidate date when updating an existing shift', () => {
    // 29 past weekdays + 1 future Wednesday (the one we're "editing").
    // 29 + 1 (candidate) = 30 = entitlement → no overshoot when excludeShiftId works.
    const past = buildPastWeekdays(new Date('2026-01-05'), 29);
    const shifts = [
      ...past.map((date, i) => ({ id: `s-${i}`, doctor_id: 'doctor-1', date, position: 'Urlaub' })),
      { id: 's-edit', doctor_id: 'doctor-1', date: '2026-05-20', position: 'Urlaub' },
    ];
    const validator = build({ shifts });
    // Re-validate the SAME shift (exclude its own id) → no overshoot yet.
    const result = validator.validate('doctor-1', '2026-05-20', 'Urlaub', {
      excludeShiftId: 's-edit',
    });
    expect(result.warnings.find((w) => w.startsWith('Urlaubskontingent'))).toBeUndefined();
  });
});

describe('ShiftValidator employee relationship conflicts', () => {
  it('does not warn when no relationships are configured', () => {
    const validator = createShiftValidator({
      doctors: [
        { id: 'doctor-1', role: 'Facharzt', fte: 1, central_employee_id: 'employee-1' },
        { id: 'doctor-2', role: 'Facharzt', fte: 1, central_employee_id: 'employee-2' },
        { id: 'doctor-3', role: 'Assistenzarzt', fte: 1 },
        { id: 'doctor-4', role: 'Assistenzarzt', fte: 1 },
        { id: 'doctor-5', role: 'Assistenzarzt', fte: 1 },
      ],
      shifts: [
        { id: 'shift-1', doctor_id: 'doctor-2', date: '2026-06-22', position: 'Bereitschaftsdienst' },
      ],
      workplaces: [
        { id: 'workplace-1', name: 'Bereitschaftsdienst', category: 'Dienste' },
      ],
      wishes: [],
      systemSettings: [],
      staffingEntries: [],
      timeslots: [],
      sharedShifts: [],
      qualificationMap: {},
      getDoctorQualIds: () => [],
      wpQualsByWorkplace: {},
      employeeRelationships: new Map(),
    });

    const result = validator.validate('doctor-1', '2026-06-22', 'Bereitschaftsdienst');
    expect(result.canProceed).toBe(true);
    // Keine Dienstkonflikt-Warnung bei leerer Relationships-Map
    expect(result.warnings.filter(w => w.includes('Dienstkonflikt'))).toEqual([]);
  });

  it('warns when a related employee with shift_conflict is already assigned a real shift on the same day', () => {
    const validator = createShiftValidator({
      doctors: [
        { id: 'doctor-1', role: 'Facharzt', fte: 1, central_employee_id: 'employee-1', name: 'Dr. Anna Müller' },
        { id: 'doctor-2', role: 'Facharzt', fte: 1, central_employee_id: 'employee-2', name: 'Dr. Max Schmidt' },
        { id: 'doctor-3', role: 'Assistenzarzt', fte: 1 },
        { id: 'doctor-4', role: 'Assistenzarzt', fte: 1 },
        { id: 'doctor-5', role: 'Assistenzarzt', fte: 1 },
      ],
      shifts: [
        { id: 'shift-1', doctor_id: 'doctor-2', date: '2026-06-22', position: 'Bereitschaftsdienst' },
      ],
      workplaces: [
        { id: 'workplace-1', name: 'Bereitschaftsdienst', category: 'Dienste' },
      ],
      wishes: [],
      systemSettings: [],
      staffingEntries: [],
      timeslots: [],
      sharedShifts: [],
      qualificationMap: {},
      getDoctorQualIds: () => [],
      wpQualsByWorkplace: {},
      // Bidirektionale Beziehung zwischen employee-1 und employee-2 mit shift_conflict
      employeeRelationships: new Map([
        ['employee-1', ['employee-2']],
        ['employee-2', ['employee-1']],
      ]),
    });

    const result = validator.validate('doctor-1', '2026-06-22', 'Bereitschaftsdienst');
    expect(result.canProceed).toBe(true);
    const conflictWarnings = result.warnings.filter(w => w.includes('Dienstkonflikt'));
    expect(conflictWarnings.length).toBeGreaterThan(0);
    expect(conflictWarnings[0]).toContain('Dr. Max Schmidt');
  });

  it('does not warn for absence positions (Frei, Urlaub, Krank)', () => {
    const validator = createShiftValidator({
      doctors: [
        { id: 'doctor-1', role: 'Facharzt', fte: 1, central_employee_id: 'employee-1' },
        { id: 'doctor-2', role: 'Facharzt', fte: 1, central_employee_id: 'employee-2' },
        { id: 'doctor-3', role: 'Assistenzarzt', fte: 1 },
        { id: 'doctor-4', role: 'Assistenzarzt', fte: 1 },
        { id: 'doctor-5', role: 'Assistenzarzt', fte: 1 },
      ],
      shifts: [
        { id: 'shift-1', doctor_id: 'doctor-2', date: '2026-06-22', position: 'Bereitschaftsdienst' },
      ],
      workplaces: [
        { id: 'workplace-1', name: 'Bereitschaftsdienst', category: 'Dienste' },
      ],
      wishes: [],
      systemSettings: [],
      staffingEntries: [],
      timeslots: [],
      sharedShifts: [],
      qualificationMap: {},
      getDoctorQualIds: () => [],
      wpQualsByWorkplace: {},
      employeeRelationships: new Map([
        ['employee-1', ['employee-2']],
        ['employee-2', ['employee-1']],
      ]),
    });

    // Frei sollte keine Dienstkonflikt-Warnung auslösen
    const result = validator.validate('doctor-1', '2026-06-22', 'Frei');
    expect(result.canProceed).toBe(true);
    // Es sollte keine Warnung wegen Dienstkonflikt geben (nur ggf. Mindestbesetzung, aber das ist ein anderes Feature)
    expect(result.warnings.filter(w => w.includes('Dienstkonflikt'))).toEqual([]);
  });

  it('does not warn for routine categories (Rotationen)', () => {
    const validator = createShiftValidator({
      doctors: [
        { id: 'doctor-1', role: 'Facharzt', fte: 1, central_employee_id: 'employee-1' },
        { id: 'doctor-2', role: 'Facharzt', fte: 1, central_employee_id: 'employee-2' },
        { id: 'doctor-3', role: 'Assistenzarzt', fte: 1 },
        { id: 'doctor-4', role: 'Assistenzarzt', fte: 1 },
        { id: 'doctor-5', role: 'Assistenzarzt', fte: 1 },
      ],
      shifts: [
        { id: 'shift-1', doctor_id: 'doctor-2', date: '2026-06-22', position: 'CT Rotation' },
      ],
      workplaces: [
        { id: 'workplace-1', name: 'CT Rotation', category: 'Rotationen' },
      ],
      wishes: [],
      systemSettings: [],
      staffingEntries: [],
      timeslots: [],
      sharedShifts: [],
      qualificationMap: {},
      getDoctorQualIds: () => [],
      wpQualsByWorkplace: {},
      employeeRelationships: new Map([
        ['employee-1', ['employee-2']],
        ['employee-2', ['employee-1']],
      ]),
    });

    const result = validator.validate('doctor-1', '2026-06-22', 'CT Rotation');
    expect(result.canProceed).toBe(true);
    // Keine Dienstkonflikt-Warnung für Rotationen
    expect(result.warnings.filter(w => w.includes('Dienstkonflikt'))).toEqual([]);
  });

  it('warns only when both employees are assigned to real shifts on the same day', () => {
    const validator = createShiftValidator({
      doctors: [
        { id: 'doctor-1', role: 'Facharzt', fte: 1, central_employee_id: 'employee-1', name: 'Dr. Anna Müller' },
        { id: 'doctor-2', role: 'Facharzt', fte: 1, central_employee_id: 'employee-2', name: 'Dr. Max Schmidt' },
        { id: 'doctor-3', role: 'Assistenzarzt', fte: 1 },
        { id: 'doctor-4', role: 'Assistenzarzt', fte: 1 },
        { id: 'doctor-5', role: 'Assistenzarzt', fte: 1 },
      ],
      shifts: [
        { id: 'shift-1', doctor_id: 'doctor-2', date: '2026-06-23', position: 'Bereitschaftsdienst' },
      ],
      workplaces: [
        { id: 'workplace-1', name: 'Bereitschaftsdienst', category: 'Dienste' },
      ],
      wishes: [],
      systemSettings: [],
      staffingEntries: [],
      timeslots: [],
      sharedShifts: [],
      qualificationMap: {},
      getDoctorQualIds: () => [],
      wpQualsByWorkplace: {},
      employeeRelationships: new Map([
        ['employee-1', ['employee-2']],
        ['employee-2', ['employee-1']],
      ]),
    });

    // doctor-2 ist am 2026-06-23, nicht am 2026-06-22 -> keine Warnung
    const result = validator.validate('doctor-1', '2026-06-22', 'Bereitschaftsdienst');
    expect(result.canProceed).toBe(true);
    // Keine Dienstkonflikt-Warnung, da doctor-2 nicht am gleichen Tag eingeteilt ist
    expect(result.warnings.filter(w => w.includes('Dienstkonflikt'))).toEqual([]);
  });
});