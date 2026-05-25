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