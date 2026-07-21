import { describe, expect, it } from 'vitest';
import { discoverAbwkalDateColumns } from '../utils/tisowareImport.js';

describe('discoverAbwkalDateColumns', () => {
  it('prioritizes ABWDATE as both fromCol and toCol (canonical Tisoware column)', () => {
    // Real ABWKAL keys from SQL dump (per 2026-07-21)
    const keys = [
      'FIRMA', 'PSNR', 'ABWDATE', 'LFDNR', 'LOANR',
      'VONSTD', 'VONMIN', 'BISSTD', 'BISMIN', 'GANZTAG',
      'ABGESCHL', 'ABWSTD', 'ABWMIN', 'VONSHAD', 'BISSHAD',
      'TAGABDAT', 'WFID', 'AKTIV', 'TAGTEIL', 'WFLFDNR',
      'ABWSOLL', 'PROZENTSATZ',
    ];
    const result = discoverAbwkalDateColumns(keys);
    expect(result.fromCol).toBe('ABWDATE');
    expect(result.toCol).toBe('ABWDATE');
  });

  it('prioritizes ABWDATUM if ABWDATE is not present', () => {
    const keys = ['PSNR', 'ABWDATUM', 'VONSTD', 'BISSTD', 'LOANR'];
    const result = discoverAbwkalDateColumns(keys);
    expect(result.fromCol).toBe('ABWDATUM');
    expect(result.toCol).toBe('ABWDATUM');
  });

  it('falls back to VON/BIS pattern when no ABWDATE/ABWDATUM exists', () => {
    const keys = ['PSNR', 'ABVON', 'ABBIS', 'LOANR'];
    const result = discoverAbwkalDateColumns(keys);
    expect(result.fromCol).toBe('ABVON');
    expect(result.toCol).toBe('ABBIS');
  });

  it('excludes VONSTD/BISSTD (time hours) from matching', () => {
    const keys = ['PSNR', 'VONSTD', 'BISSTD', 'LOANR'];
    const result = discoverAbwkalDateColumns(keys);
    expect(result.fromCol).toBeNull();
    expect(result.toCol).toBeNull();
  });

  it('excludes VONMIN/BISMIN (time minutes) from matching', () => {
    const keys = ['PSNR', 'VONMIN', 'BISMIN', 'LOANR'];
    const result = discoverAbwkalDateColumns(keys);
    expect(result.fromCol).toBeNull();
    expect(result.toCol).toBeNull();
  });

  it('uses a single date column for both from and to (e.g., DATUM)', () => {
    const keys = ['PSNR', 'DATUM', 'LOANR'];
    const result = discoverAbwkalDateColumns(keys);
    expect(result.fromCol).toBe('DATUM');
    expect(result.toCol).toBe('DATUM');
  });

  it('handles empty keys', () => {
    const result = discoverAbwkalDateColumns([]);
    expect(result.fromCol).toBeNull();
    expect(result.toCol).toBeNull();
  });

  it('handles mixed-case keys', () => {
    const keys = ['psnr', 'abwdate', 'vonstd'];
    const result = discoverAbwkalDateColumns(keys);
    expect(result.fromCol).toBe('abwdate');
    expect(result.toCol).toBe('abwdate');
  });
});
