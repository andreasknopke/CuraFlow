import { describe, it, expect } from 'vitest';
import { normalizeShiftPosition, isNonWorkingShiftPosition } from '../shiftPositionUtils';

describe('normalizeShiftPosition', () => {
  it('lowercases and trims input', () => {
    expect(normalizeShiftPosition('  FREI  ')).toBe('frei');
  });

  it('strips diacritics (ü → u)', () => {
    expect(normalizeShiftPosition('Verfügbar')).toBe('verfugbar');
  });

  it('returns empty string for null/undefined', () => {
    expect(normalizeShiftPosition(null)).toBe('');
    expect(normalizeShiftPosition(undefined)).toBe('');
  });

  it('coerces numeric values to string (0 becomes "0")', () => {
    expect(normalizeShiftPosition(0)).toBe('0');
  });
});

describe('isNonWorkingShiftPosition', () => {
  it.each([
    'frei', 'Frei', 'FREI',
    'urlaub', 'Urlaub',
    'krank', 'Krank',
    'dienstreise',
    'fortbildung',
    'kongress',
    'elternzeit',
    'mutterschutz',
    'verfügbar', 'verfugbar',
    'AZ', 'az',
    'KO', 'ko',
    'EZ', 'ez',
    'MS', 'ms',
  ])('recognizes "%s" as non-working', (position) => {
    expect(isNonWorkingShiftPosition(position)).toBe(true);
  });

  it.each([
    'CT', 'MRT', 'Dienst Vordergrund', 'Sonographie', 'Angiographie', '',
  ])('does NOT flag "%s" as non-working', (position) => {
    expect(isNonWorkingShiftPosition(position)).toBe(false);
  });

  it('returns false for null/undefined', () => {
    expect(isNonWorkingShiftPosition(null)).toBe(false);
    expect(isNonWorkingShiftPosition(undefined)).toBe(false);
  });
});
