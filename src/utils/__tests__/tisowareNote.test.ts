import { describe, it, expect } from 'vitest';
import { getTisowareDescription } from '../tisowareNote';

describe('getTisowareDescription', () => {
  it('extracts the description after the [TISO:CODE] prefix', () => {
    expect(getTisowareDescription('[TISO:530] Krank ohne AU-Bescheinigung')).toBe('Krank ohne AU-Bescheinigung');
  });

  it('handles letter-suffixed codes (e.g. 530KV)', () => {
    expect(getTisowareDescription('[TISO:530KV] Krank auf Vertrauen')).toBe('Krank auf Vertrauen');
  });

  it('returns the description for single-word subtypes', () => {
    expect(getTisowareDescription('[TISO:550] Mutterschutz')).toBe('Mutterschutz');
  });

  it('returns null for a bare marker without description', () => {
    expect(getTisowareDescription('[TISO:900]')).toBeNull();
    expect(getTisowareDescription('[TISO:530]  ')).toBeNull();
  });

  it('returns null for notes without a Tisoware marker', () => {
    expect(getTisowareDescription('Autom. Freizeitausgleich')).toBeNull();
    expect(getTisowareDescription('')).toBeNull();
  });

  it('returns null for null/undefined/non-string input', () => {
    expect(getTisowareDescription(null)).toBeNull();
    expect(getTisowareDescription(undefined)).toBeNull();
    expect(getTisowareDescription(123)).toBeNull();
  });

  it('keeps trailing user text after the marker description', () => {
    expect(getTisowareDescription('[TISO:570] Krank (Attest) — bitte beachten')).toBe('Krank (Attest) — bitte beachten');
  });
});
