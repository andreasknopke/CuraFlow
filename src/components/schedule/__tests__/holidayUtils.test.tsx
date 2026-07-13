import { describe, it, expect } from 'vitest';
import { HolidayCalculator, getEasterDate, isHolidayMV, isSchoolHolidayMV, STATES } from '../holidayUtils';

describe('HolidayCalculator', () => {
  describe('constructor', () => {
    it('creates an instance with default state MV', () => {
      const calc = new HolidayCalculator();
      expect(calc.stateCode).toBe('MV');
    });

    it('creates an instance with a custom state', () => {
      const calc = new HolidayCalculator('BY');
      expect(calc.stateCode).toBe('BY');
    });
  });

  describe('isPublicHoliday', () => {
    it('returns null for a regular weekday', () => {
      const calc = new HolidayCalculator('MV');
      // 2026-06-15 is a Monday
      const result = calc.isPublicHoliday(new Date(2026, 5, 15));
      expect(result).toBeNull();
    });

    it('returns holiday data for Neujahr (Jan 1)', () => {
      const calc = new HolidayCalculator('MV');
      const result = calc.isPublicHoliday(new Date(2026, 0, 1));
      expect(result).not.toBeNull();
      expect(result!.name).toContain('Neujahr');
    });

    it('returns holiday data for Tag der Arbeit (May 1)', () => {
      const calc = new HolidayCalculator('MV');
      const result = calc.isPublicHoliday(new Date(2026, 4, 1));
      expect(result).not.toBeNull();
      expect(result!.name).toContain('Tag der Arbeit');
    });

    it('returns holiday data for Tag der Deutschen Einheit (Oct 3)', () => {
      const calc = new HolidayCalculator('MV');
      const result = calc.isPublicHoliday(new Date(2026, 9, 3));
      expect(result).not.toBeNull();
      expect(result!.name).toContain('Tag der Deutschen Einheit');
    });

    it('returns holiday data for 1. Weihnachtstag (Dec 25)', () => {
      const calc = new HolidayCalculator('MV');
      const result = calc.isPublicHoliday(new Date(2026, 11, 25));
      expect(result).not.toBeNull();
      expect(result!.name).toContain('Weihnachtstag');
    });

    it('returns holiday data for Easter Monday (Ostermontag)', () => {
      const calc = new HolidayCalculator('MV');
      // Easter 2026: April 5 → Easter Monday: April 6
      const result = calc.isPublicHoliday(new Date(2026, 3, 6));
      expect(result).not.toBeNull();
      expect(result!.name).toContain('Ostermontag');
    });

    it('returns holiday data for Karfreitag', () => {
      const calc = new HolidayCalculator('MV');
      // Easter 2026: April 5 → Karfreitag: April 3
      const result = calc.isPublicHoliday(new Date(2026, 3, 3));
      expect(result).not.toBeNull();
      expect(result!.name).toContain('Karfreitag');
    });

    it('returns Reformationstag for MV state', () => {
      const calc = new HolidayCalculator('MV');
      const result = calc.isPublicHoliday(new Date(2026, 9, 31));
      expect(result).not.toBeNull();
      expect(result!.name).toContain('Reformationstag');
    });

    it('returns null for Reformationstag in BY state', () => {
      const calc = new HolidayCalculator('BY');
      const result = calc.isPublicHoliday(new Date(2026, 9, 31));
      expect(result).toBeNull();
    });

    it('recognises Frauentag (March 8) in MV for 2026', () => {
      const calc = new HolidayCalculator('MV');
      const result = calc.isPublicHoliday(new Date(2026, 2, 8));
      expect(result).not.toBeNull();
      expect(result!.name).toContain('Frauentag');
    });

    it('correctly handles year boundaries', () => {
      const calc = new HolidayCalculator('MV');
      // Dec 25 2026
      const result = calc.isPublicHoliday(new Date(2026, 11, 25));
      expect(result).not.toBeNull();
    });

    it('returns null for a Saturday', () => {
      const calc = new HolidayCalculator('MV');
      // 2026-06-20 is a Saturday
      const result = calc.isPublicHoliday(new Date(2026, 5, 20));
      expect(result).toBeNull();
    });

    it('returns null for a Sunday that is not a holiday', () => {
      const calc = new HolidayCalculator('MV');
      // 2026-06-21 is a Sunday
      const result = calc.isPublicHoliday(new Date(2026, 5, 21));
      expect(result).toBeNull();
    });
  });

  describe('isSchoolHoliday', () => {
    it('returns null for a non-school-holiday date', () => {
      const calc = new HolidayCalculator('MV');
      // Assume ~June 15 is not a school holiday by default
      const result = calc.isSchoolHoliday(new Date(2026, 5, 15));
      // Without API data, there are no school holiday ranges
      expect(result).toBeNull();
    });

    it('returns school holiday data for a date within an API-provided range', () => {
      const calc = new HolidayCalculator('MV', [], {
        school: [{ start: '2026-07-01', end: '2026-08-31', name: 'Sommerferien' }],
      });
      const result = calc.isSchoolHoliday(new Date(2026, 6, 15));
      expect(result).not.toBeNull();
      expect(result!.name).toBe('Sommerferien');
    });

    it('returns null for a date outside an API-provided range', () => {
      const calc = new HolidayCalculator('MV', [], {
        school: [{ start: '2026-07-01', end: '2026-08-31', name: 'Sommerferien' }],
      });
      const result = calc.isSchoolHoliday(new Date(2026, 5, 15));
      expect(result).toBeNull();
    });

    it('correctly handles custom school holiday additions', () => {
      const calc = new HolidayCalculator('MV', [
        { type: 'school', action: 'add', start_date: '2026-05-01', end_date: '2026-05-05', name: 'Extra Ferien' },
      ]);
      const result = calc.isSchoolHoliday(new Date(2026, 4, 3));
      expect(result).not.toBeNull();
      expect(result!.name).toBe('Extra Ferien');
    });
  });

  describe('public holiday with custom additions and removals', () => {
    it('adds a custom public holiday', () => {
      const calc = new HolidayCalculator('MV', [
        { type: 'public', action: 'add', start_date: '2026-11-27', name: 'Brückentag' } as any,
      ]);
      const result = calc.isPublicHoliday(new Date(2026, 10, 27));
      expect(result).not.toBeNull();
      expect(result!.name).toBe('Brückentag');
    });

    it('removes a default public holiday via custom removal', () => {
      const calc = new HolidayCalculator('MV', [
        { type: 'public', action: 'remove', start_date: '2026-10-03', end_date: '2026-10-03', name: '' } as any,
      ]);
      const result = calc.isPublicHoliday(new Date(2026, 9, 3));
      expect(result).toBeNull();
    });
  });

  describe('with API data for public holidays', () => {
    it('uses API-provided public holiday data instead of fallback', () => {
      const calc = new HolidayCalculator('MV', [], {
        public: [{ date: '2026-01-01', name: 'API Neujahr' }],
      });
      const result = calc.isPublicHoliday(new Date(2026, 0, 1));
      expect(result).not.toBeNull();
      expect(result!.name).toBe('API Neujahr');
    });
  });
});

describe('getEasterDate', () => {
  it('returns correct Easter date for 2026', () => {
    const easter = getEasterDate(2026);
    expect(easter.getFullYear()).toBe(2026);
    expect(easter.getMonth()).toBe(3); // April (0-indexed)
    expect(easter.getDate()).toBe(5);
  });

  it('returns correct Easter date for 2025', () => {
    const easter = getEasterDate(2025);
    expect(easter.getFullYear()).toBe(2025);
    expect(easter.getMonth()).toBe(3); // April
    expect(easter.getDate()).toBe(20);
  });

  it('returns correct Easter date for 2024', () => {
    const easter = getEasterDate(2024);
    expect(easter.getFullYear()).toBe(2024);
    expect(easter.getMonth()).toBe(2); // March
    expect(easter.getDate()).toBe(31);
  });
});

describe('isHolidayMV', () => {
  it('returns holiday data for a known public holiday in MV', () => {
    const result = isHolidayMV(new Date(2026, 0, 1));
    expect(result).not.toBeNull();
  });

  it('returns null for a regular day', () => {
    const result = isHolidayMV(new Date(2026, 5, 15));
    expect(result).toBeNull();
  });
});

describe('isSchoolHolidayMV', () => {
  it('returns null for a non-school-holiday date without API data', () => {
    const result = isSchoolHolidayMV(new Date(2026, 5, 15));
    expect(result).toBeNull();
  });
});

describe('STATES', () => {
  it('contains all 16 German federal states', () => {
    expect(Object.keys(STATES)).toHaveLength(16);
  });

  it('maps MV to Mecklenburg-Vorpommern', () => {
    expect(STATES.MV).toBe('Mecklenburg-Vorpommern');
  });

  it('maps BY to Bayern', () => {
    expect(STATES.BY).toBe('Bayern');
  });

  it('maps BE to Berlin', () => {
    expect(STATES.BE).toBe('Berlin');
  });
});
