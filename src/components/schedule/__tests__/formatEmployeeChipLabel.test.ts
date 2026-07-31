// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { formatEmployeeChipLabel, formatChipLabel } from '../scheduleBoardHelpers';

describe('formatEmployeeChipLabel', () => {
  it('builds label from last name + first-name initial for "Vorname Nachname"', () => {
    expect(formatEmployeeChipLabel('Sandra Müller')).toBe('MüllS');
  });

  it('capitalizes the last name first letter', () => {
    expect(formatEmployeeChipLabel('anna adler')).toBe('AdleA');
  });

  it('uses the last word as the last name for multi-part names', () => {
    expect(formatEmployeeChipLabel('Hans Peter Schmidt')).toBe('SchmH');
  });

  it('truncates long last names to 4 characters', () => {
    expect(formatEmployeeChipLabel('Max Mustermann')).toBe('MustM');
  });

  it('falls back to formatChipLabel for single-word names', () => {
    expect(formatEmployeeChipLabel('Cher')).toBe(formatChipLabel('Cher'));
    expect(formatEmployeeChipLabel('Cher')).toBe('CHE');
  });

  it('falls back to formatChipLabel for empty or whitespace input', () => {
    expect(formatEmployeeChipLabel('')).toBe('DOC');
    expect(formatEmployeeChipLabel('   ')).toBe('DOC');
  });

  it('falls back when the first-name initial is not alphabetic', () => {
    // A leading digit should not produce a digit suffix.
    expect(formatEmployeeChipLabel('4andra Müller')).toBe(formatChipLabel('4andra Müller'));
  });

  it('handles umlauts in the last name', () => {
    expect(formatEmployeeChipLabel('Lisa Bäcker')).toBe('BäckL');
  });

  it('handles short last names without padding', () => {
    expect(formatEmployeeChipLabel('Otto Li')).toBe('LiO');
  });
});
