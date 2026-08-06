import { describe, expect, it, vi, beforeEach } from 'vitest';

// ensureCentralAbsenceTables is auto-imported by tisowareImport from
// centralAbsences.js. We don't want to exercise real CREATE TABLE logic
// in unit tests, so stub the helper before importing the SUT.
vi.mock('../utils/centralAbsences.js', () => ({
  ensureCentralAbsenceTables: vi.fn().mockResolvedValue(undefined),
  isCentralAbsencePosition: (p) => ['Mutterschutz', 'Elternzeit', 'Frei'].includes(p),
  CENTRAL_ABSENCE_POSITIONS: new Set(['Mutterschutz', 'Elternzeit', 'Frei']),
}));

// tisowareDataSource must also be stubbed so importing tisowareImport does
// not trigger real proxy code paths.
vi.mock('../utils/tisowareDataSource.js', () => ({
  runQuery: vi.fn(),
  getConnectionStatus: vi.fn(),
  testConnection: vi.fn(),
  listTables: vi.fn(),
  listColumns: vi.fn(),
  sampleTable: vi.fn(),
  isMockMode: vi.fn(),
  generateDumpWrapper: vi.fn(),
}));

import { mapLoanrToPosition, repairTisowareStatusMappings } from '../utils/tisowareImport.js';

describe('mapLoanrToPosition', () => {
  it('maps Mutterschutz LOANRs to Nicht verfügbar (not Mutterschutz) to keep scheduler rows clean', () => {
    expect(mapLoanrToPosition('550').position).toBe('Nicht verfügbar');
    expect(mapLoanrToPosition('551').position).toBe('Nicht verfügbar');
    expect(mapLoanrToPosition('5511').position).toBe('Nicht verfügbar');
  });

  it('maps Elternzeit LOANR 552 to Nicht verfügbar (not Elternzeit)', () => {
    expect(mapLoanrToPosition('552').position).toBe('Nicht verfügbar');
  });

  it('preserves the original Tisoware reason in the note prefix', () => {
    const ms = mapLoanrToPosition('550');
    expect(ms.notePrefix).toContain('[TISO:550]');
    expect(ms.notePrefix).toContain('Mutterschutz');

    const ez = mapLoanrToPosition('552');
    expect(ez.notePrefix).toContain('[TISO:552]');
    expect(ez.notePrefix).toContain('Elternzeit');
  });

  it('keeps Urlaub/Krank mappings unchanged', () => {
    expect(mapLoanrToPosition('505').position).toBe('Urlaub');
    expect(mapLoanrToPosition('530').position).toBe('Krank');
  });

  it('falls back to Nicht verfügbar for unknown LOANR codes', () => {
    const result = mapLoanrToPosition('9999', 'Unbekannter Grund');
    expect(result.position).toBe('Nicht verfügbar');
    expect(result.notePrefix).toContain('[TISO:9999]');
    expect(result.notePrefix).toContain('Unbekannter Grund');
  });
});

describe('repairTisowareStatusMappings', () => {
  let executeMock;

  beforeEach(() => {
    executeMock = vi.fn();
  });

  it('dry-run reports affected rows but writes nothing', async () => {
    executeMock.mockResolvedValueOnce([[
      { id: 'a', employee_id: 'emp-1', date: new Date('2026-03-08'), position: 'Mutterschutz', note: '[TISO:550] Mutterschutz' },
      { id: 'b', employee_id: 'emp-2', date: new Date('2026-02-01'), position: 'Elternzeit',   note: '[TISO:552] Elternzeit' },
    ]]);

    const result = await repairTisowareStatusMappings({ execute: executeMock }, { dryRun: true });

    expect(result.dryRun).toBe(true);
    expect(result.scanned).toBe(2);
    expect(result.repaired).toBe(0);
    expect(result.sample).toHaveLength(2);
    expect(result.sample[0]).toMatchObject({ id: 'a', old_position: 'Mutterschutz', date: '2026-03-08' });

    // Only the SELECT happened during a dry-run
    expect(executeMock).toHaveBeenCalledTimes(1);
  });

  it('rewrites TISO-marked rows to Frei and leaves others untouched', async () => {
    executeMock.mockResolvedValueOnce([
      [{ id: 'a', employee_id: 'emp-1', date: new Date('2026-03-08'), position: 'Mutterschutz', note: '[TISO:550] Mutterschutz' }],
    ]);

    const result = await repairTisowareStatusMappings({ execute: executeMock }, { dryRun: false });

    expect(result.dryRun).toBe(false);
    expect(result.scanned).toBe(1);
    expect(result.repaired).toBe(1);

    // One SELECT + one UPDATE per row
    expect(executeMock).toHaveBeenCalledTimes(2);
    const updateCall = executeMock.mock.calls[1];
    expect(updateCall[0]).toContain("SET position = 'Nicht verfügbar'");
    expect(updateCall[0]).toContain("WHERE id = ?");
    expect(updateCall[1]).toEqual(['a']);
  });

  it('skips rows whose note marker does not match a remapped status code', async () => {
    // Row with a Krank TISO note but somehow position=Elternzeit (manual edit):
    // the note code (530 = Krank) is not in STATUS_CODE_LOANRS, so the row is reported
    // by the SELECT but NOT rewritten.
    executeMock.mockResolvedValueOnce([
      [{ id: 'c', employee_id: 'emp-3', date: new Date('2026-01-01'), position: 'Elternzeit', note: '[TISO:530] Krank mit AU' }],
    ]);

    const result = await repairTisowareStatusMappings({ execute: executeMock }, { dryRun: false });

    expect(result.scanned).toBe(1);
    expect(result.repaired).toBe(0);
    // No UPDATE calls
    expect(executeMock).toHaveBeenCalledTimes(1);
  });

  it('returns zero counts when no rows match', async () => {
    executeMock.mockResolvedValueOnce([[]]);

    const result = await repairTisowareStatusMappings({ execute: executeMock }, { dryRun: false });

    expect(result.scanned).toBe(0);
    expect(result.repaired).toBe(0);
    expect(executeMock).toHaveBeenCalledTimes(1);
  });
});
