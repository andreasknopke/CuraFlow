import { describe, expect, it } from 'vitest';
import {
  buildSharedShiftAutoFreiMarker,
  getSharedShiftAutoFreiDate,
  validateSharedShiftTenantRules,
} from '../utils/sharedShiftTenantRules.js';

const tenantWorkplaces = [
  { name: 'CT Rotation', category: 'Rotationen', affects_availability: true },
  { name: 'Demo', category: 'Demonstrationen & Konsile', affects_availability: false },
];

describe('sharedShiftTenantRules', () => {
  it('blocks an exclusive cross-tenant service when a blocking tenant rotation exists the same day', () => {
    const result = validateSharedShiftTenantRules({
      workplace: {
        name: 'Pool Hintergrund',
        category: 'Dienste',
        allows_rotation_concurrently: false,
        affects_availability: true,
      },
      dateStr: '2026-05-25',
      centralEmployeeId: 'employee-1',
      tenantDoctorId: 'doctor-1',
      tenantShifts: [
        { date: '2026-05-25', doctor_id: 'doctor-1', position: 'CT Rotation' },
      ],
      tenantWorkplaces,
      existingSharedShiftsForWorkplace: [],
      holidayDates: new Set(),
    });

    expect(result.blockers).toEqual([
      expect.objectContaining({ rule: 'rotation_conflict' }),
    ]);
  });

  it('does not block a rotation when the cross-tenant service explicitly allows it', () => {
    const result = validateSharedShiftTenantRules({
      workplace: {
        name: 'Pool Hintergrund',
        category: 'Dienste',
        allows_rotation_concurrently: true,
        affects_availability: true,
      },
      dateStr: '2026-05-25',
      centralEmployeeId: 'employee-1',
      tenantDoctorId: 'doctor-1',
      tenantShifts: [
        { date: '2026-05-25', doctor_id: 'doctor-1', position: 'CT Rotation' },
      ],
      tenantWorkplaces,
      existingSharedShiftsForWorkplace: [],
      holidayDates: new Set(),
    });

    expect(result.blockers).toEqual([]);
  });

  it('blocks auto-off services when the next workday already has a non-Frei tenant entry', () => {
    const result = validateSharedShiftTenantRules({
      workplace: {
        name: 'Pool Vordergrund',
        category: 'Dienste',
        auto_off: true,
      },
      dateStr: '2026-05-25',
      centralEmployeeId: 'employee-1',
      tenantDoctorId: 'doctor-1',
      tenantShifts: [
        { date: '2026-05-26', doctor_id: 'doctor-1', position: 'CT Rotation' },
      ],
      tenantWorkplaces,
      existingSharedShiftsForWorkplace: [],
      holidayDates: new Set(),
    });

    expect(result.autoFreiDate).toBe('2026-05-26');
    expect(result.blockers).toEqual([
      expect.objectContaining({ rule: 'auto_off_conflict' }),
    ]);
  });

  it('blocks forbidden consecutive pool services on adjacent days', () => {
    const result = validateSharedShiftTenantRules({
      workplace: {
        name: 'Pool Vordergrund',
        category: 'Dienste',
        consecutive_days_mode: 'forbidden',
      },
      dateStr: '2026-05-25',
      centralEmployeeId: 'employee-1',
      tenantDoctorId: 'doctor-1',
      tenantShifts: [],
      tenantWorkplaces,
      existingSharedShiftsForWorkplace: [
        { date: '2026-05-24', employee_id: 'employee-1' },
      ],
      holidayDates: new Set(),
    });

    expect(result.blockers).toEqual([
      expect.objectContaining({ rule: 'consecutive_days' }),
    ]);
  });

  it('provides a stable marker for generated auto-frei entries', () => {
    expect(buildSharedShiftAutoFreiMarker('shift-123')).toBe('cross-tenant:auto-frei:shift-123');
    expect(getSharedShiftAutoFreiDate('2026-05-29', new Set())).toBeNull();
  });
});
