import { describe, it, expect } from 'vitest';
import { isDoctorAvailable, calculateWeeklyTargetHours } from '../staffingUtils';

// ---------------------------------------------------------------------------
// isDoctorAvailable
// ---------------------------------------------------------------------------
describe('isDoctorAvailable', () => {
  const baseDoctor = { id: 1, fte: 1.0 };

  it('returns true for active full-time doctor with no plan entries', () => {
    expect(isDoctorAvailable(baseDoctor, new Date('2024-03-11'), [])).toBe(true);
  });

  it('returns false when date is strictly after contract_end_date', () => {
    const doctor = { ...baseDoctor, contract_end_date: '2024-03-10' };
    expect(isDoctorAvailable(doctor, new Date('2024-03-11'), [])).toBe(false);
  });

  it('returns true on the contract_end_date itself', () => {
    const doctor = { ...baseDoctor, contract_end_date: '2024-03-11' };
    expect(isDoctorAvailable(doctor, new Date('2024-03-11'), [])).toBe(true);
  });

  it.each(['KO', 'EZ', 'MS'])('returns false when staffing plan value is "%s"', (val) => {
    const planEntries = [{ doctor_id: 1, year: 2024, month: 3, value: val }];
    expect(isDoctorAvailable(baseDoctor, new Date('2024-03-11'), planEntries)).toBe(false);
  });

  it('returns false when plan entry FTE is 0', () => {
    const planEntries = [{ doctor_id: 1, year: 2024, month: 3, value: '0.0' }];
    expect(isDoctorAvailable(baseDoctor, new Date('2024-03-11'), planEntries)).toBe(false);
  });

  it('returns false when plan entry FTE is 0 with comma notation', () => {
    const planEntries = [{ doctor_id: 1, year: 2024, month: 3, value: '0,0' }];
    expect(isDoctorAvailable(baseDoctor, new Date('2024-03-11'), planEntries)).toBe(false);
  });

  it('returns true for partial FTE > 0', () => {
    const planEntries = [{ doctor_id: 1, year: 2024, month: 3, value: '0.5' }];
    expect(isDoctorAvailable(baseDoctor, new Date('2024-03-11'), planEntries)).toBe(true);
  });

  it('falls back to doctor.fte when no plan entry exists for month', () => {
    const doctor = { id: 1, fte: 0.0 };
    expect(isDoctorAvailable(doctor, new Date('2024-03-11'), [])).toBe(false);
  });

  it('uses default 1.0 FTE when doctor has no fte field and no plan entry', () => {
    const doctor = { id: 1 };
    expect(isDoctorAvailable(doctor, new Date('2024-03-11'), [])).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// calculateWeeklyTargetHours
// ---------------------------------------------------------------------------
describe('calculateWeeklyTargetHours', () => {
  const monday = new Date('2024-03-11'); // Monday

  it('returns 40h for 1.0 FTE with no holidays', () => {
    expect(calculateWeeklyTargetHours(1.0, monday, [])).toBe(40);
  });

  it('scales linearly with FTE', () => {
    expect(calculateWeeklyTargetHours(0.5, monday, [])).toBe(20);
    expect(calculateWeeklyTargetHours(0.75, monday, [])).toBe(30);
  });

  it('subtracts 8h per public holiday on a working day', () => {
    const holidays = ['2024-03-13']; // Wednesday
    expect(calculateWeeklyTargetHours(1.0, monday, holidays)).toBe(32);
  });

  it('does not subtract hours for weekend holidays', () => {
    const holidays = ['2024-03-16']; // Saturday
    expect(calculateWeeklyTargetHours(1.0, monday, holidays)).toBe(40);
  });

  it('handles multiple holidays in the same week', () => {
    const holidays = ['2024-03-11', '2024-03-12']; // Mon + Tue
    expect(calculateWeeklyTargetHours(1.0, monday, holidays)).toBe(24);
  });

  it('respects custom fullTimeWeeklyHours and workDaysPerWeek', () => {
    expect(calculateWeeklyTargetHours(1.0, monday, [], 38, 5)).toBe(38);
    const holidays = ['2024-03-11'];
    expect(calculateWeeklyTargetHours(1.0, monday, holidays, 38, 5)).toBeCloseTo(38 - 38 / 5);
  });
});
