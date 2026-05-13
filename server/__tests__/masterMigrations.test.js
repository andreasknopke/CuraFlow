import { describe, expect, it } from 'vitest';
import { runMasterMigrations } from '../utils/masterMigrations.js';

function createMockDbPool() {
  const calls = [];

  return {
    calls,
    async execute(sql, params = []) {
      calls.push({ sql, params });

      if (sql.includes('FROM information_schema.COLUMNS')) {
        return [[{ cnt: 0 }]];
      }

      return [[], []];
    },
  };
}

describe('runMasterMigrations', () => {
  it('adds QualificationCertificate analysis columns sequentially', async () => {
    const dbPool = createMockDbPool();

    await runMasterMigrations(dbPool);

    const qualificationCertificateCalls = dbPool.calls.filter(
      ({ sql, params }) =>
        sql.includes('QualificationCertificate') ||
        (sql.includes('FROM information_schema.COLUMNS') && params[0] === 'QualificationCertificate')
    );

    expect(qualificationCertificateCalls).toEqual([
      expect.objectContaining({
        sql: expect.stringContaining('CREATE TABLE IF NOT EXISTS QualificationCertificate'),
      }),
      expect.objectContaining({
        sql: expect.stringContaining('FROM information_schema.COLUMNS'),
        params: ['QualificationCertificate', 'evidence_role'],
      }),
      expect.objectContaining({
        sql: expect.stringContaining('ADD COLUMN `evidence_role`'),
      }),
      expect.objectContaining({
        sql: expect.stringContaining('FROM information_schema.COLUMNS'),
        params: ['QualificationCertificate', 'analysis_status'],
      }),
      expect.objectContaining({
        sql: expect.stringContaining('ADD COLUMN `analysis_status`'),
      }),
      expect.objectContaining({
        sql: expect.stringContaining('FROM information_schema.COLUMNS'),
        params: ['QualificationCertificate', 'analysis_is_certificate'],
      }),
      expect.objectContaining({
        sql: expect.stringContaining('ADD COLUMN `analysis_is_certificate`'),
      }),
      expect.objectContaining({
        sql: expect.stringContaining('FROM information_schema.COLUMNS'),
        params: ['QualificationCertificate', 'analysis_scope_match'],
      }),
      expect.objectContaining({
        sql: expect.stringContaining('ADD COLUMN `analysis_scope_match`'),
      }),
      expect.objectContaining({
        sql: expect.stringContaining('FROM information_schema.COLUMNS'),
        params: ['QualificationCertificate', 'analysis_scope_detected'],
      }),
      expect.objectContaining({
        sql: expect.stringContaining('ADD COLUMN `analysis_scope_detected`'),
      }),
      expect.objectContaining({
        sql: expect.stringContaining('FROM information_schema.COLUMNS'),
        params: ['QualificationCertificate', 'analysis_confidence'],
      }),
      expect.objectContaining({
        sql: expect.stringContaining('ADD COLUMN `analysis_confidence`'),
      }),
      expect.objectContaining({
        sql: expect.stringContaining('FROM information_schema.COLUMNS'),
        params: ['QualificationCertificate', 'analysis_reasoning'],
      }),
      expect.objectContaining({
        sql: expect.stringContaining('ADD COLUMN `analysis_reasoning`'),
      }),
      expect.objectContaining({
        sql: expect.stringContaining('FROM information_schema.COLUMNS'),
        params: ['QualificationCertificate', 'analysis_detected_granted'],
      }),
      expect.objectContaining({
        sql: expect.stringContaining('ADD COLUMN `analysis_detected_granted`'),
      }),
      expect.objectContaining({
        sql: expect.stringContaining('FROM information_schema.COLUMNS'),
        params: ['QualificationCertificate', 'analysis_detected_expiry'],
      }),
      expect.objectContaining({
        sql: expect.stringContaining('ADD COLUMN `analysis_detected_expiry`'),
      }),
      expect.objectContaining({
        sql: expect.stringContaining('FROM information_schema.COLUMNS'),
        params: ['QualificationCertificate', 'analyzed_at'],
      }),
      expect.objectContaining({
        sql: expect.stringContaining('ADD COLUMN `analyzed_at`'),
      }),
    ]);
  });
});