import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';

// Mock the master pool before importing the route module — admin.ts pulls in
// server/index.ts, which resolves MySQL config at module load time.
vi.mock('../index.js', () => ({
  db: {},
  getTenantDb: () => ({}),
  removeTenantPool: () => {},
}));

import { smtpRejectUnauthorized } from '../utils/email.js';
import { buildTenantSslOption } from '../routes/admin.js';

describe('TLS verification opt-in — Finding S6', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('SMTP (smtpRejectUnauthorized)', () => {
    it('defaults to permissive (rejectUnauthorized: false) when env var is unset', () => {
      delete process.env.SMTP_ALLOW_INSECURE_TLS;
      expect(smtpRejectUnauthorized()).toBe(false);
    });

    it.each(['0', 'false', 'no', 'off'])('enforces strict verification when SMTP_ALLOW_INSECURE_TLS=%s', (value) => {
      process.env.SMTP_ALLOW_INSECURE_TLS = value;
      expect(smtpRejectUnauthorized()).toBe(true);
    });

    it.each(['1', 'true', 'yes', 'on'])('remains permissive when SMTP_ALLOW_INSECURE_TLS=%s', (value) => {
      process.env.SMTP_ALLOW_INSECURE_TLS = value;
      expect(smtpRejectUnauthorized()).toBe(false);
    });
  });

  describe('Admin tenant DB (buildTenantSslOption)', () => {
    it('defaults to permissive (rejectUnauthorized: false) when env var is unset', () => {
      delete process.env.DB_ALLOW_INSECURE_TLS;
      expect(buildTenantSslOption()).toEqual({ rejectUnauthorized: false });
    });

    it.each(['0', 'false', 'no', 'off'])('enforces strict verification when DB_ALLOW_INSECURE_TLS=%s', (value) => {
      process.env.DB_ALLOW_INSECURE_TLS = value;
      expect(buildTenantSslOption()).toEqual({ rejectUnauthorized: true });
    });

    it.each(['1', 'true', 'yes', 'on'])('remains permissive when DB_ALLOW_INSECURE_TLS=%s', (value) => {
      process.env.DB_ALLOW_INSECURE_TLS = value;
      expect(buildTenantSslOption()).toEqual({ rejectUnauthorized: false });
    });
  });
});
