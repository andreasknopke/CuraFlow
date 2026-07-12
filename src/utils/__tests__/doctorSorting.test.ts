import { describe, it, expect } from 'vitest';
import { sortDoctorsAlphabetically } from '../doctorSorting';

describe('sortDoctorsAlphabetically', () => {
  it('returns a new array without mutating input', () => {
    const doctors = [{ name: 'Zimmermann', initials: 'Z' }, { name: 'Albrecht', initials: 'A' }];
    const result = sortDoctorsAlphabetically(doctors);
    expect(result).not.toBe(doctors);
    expect(doctors[0].name).toBe('Zimmermann');
  });

  it('sorts by name ascending (locale-aware)', () => {
    const doctors = [
      { name: 'Zimmermann', initials: 'Z' },
      { name: 'Albrecht', initials: 'A' },
      { name: 'Müller', initials: 'M' },
    ];
    const sorted = sortDoctorsAlphabetically(doctors);
    expect(sorted.map(d => d.name)).toEqual(['Albrecht', 'Müller', 'Zimmermann']);
  });

  it('breaks ties by initials', () => {
    const doctors = [
      { name: 'Müller', initials: 'TM' },
      { name: 'Müller', initials: 'AM' },
    ];
    const sorted = sortDoctorsAlphabetically(doctors);
    expect(sorted[0].initials).toBe('AM');
    expect(sorted[1].initials).toBe('TM');
  });

  it('handles missing name or initials gracefully', () => {
    const doctors = [
      { name: null, initials: null },
      { name: 'Albrecht', initials: 'A' },
    ];
    expect(() => sortDoctorsAlphabetically(doctors)).not.toThrow();
    expect(sortDoctorsAlphabetically(doctors)).toHaveLength(2);
  });

  it('returns empty array for empty input', () => {
    expect(sortDoctorsAlphabetically([])).toEqual([]);
  });

  it('handles undefined input (default parameter)', () => {
    expect(sortDoctorsAlphabetically()).toEqual([]);
  });
});
