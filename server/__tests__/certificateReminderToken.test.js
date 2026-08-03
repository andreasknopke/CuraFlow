import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';

// Mock the master pool before importing the route module — certificates.ts
// pulls in server/index.ts, which resolves MySQL config at module load time.
vi.mock('../index.js', () => ({
  db: {},
  getTenantDb: () => ({}),
  removeTenantPool: () => {},
}));

import { createReminderToken, verifyReminderToken } from '../routes/certificates.js';

describe('certificate reminder token — Finding S3', () => {
  beforeEach(() => {
    process.env.JWT_SECRET = 'test-reminder-secret';
  });

  afterEach(() => {
    delete process.env.JWT_SECRET;
    delete process.env.AUTH_SECRET;
  });

  it('round-trips a valid token', () => {
    const token = createReminderToken({
      tenantId: 'tenant-1',
      doctorId: 'doctor-1',
      qualificationIds: ['q-1', 'q-2'],
    });
    const parsed = verifyReminderToken(token);
    expect(parsed).toMatchObject({
      tenantId: 'tenant-1',
      doctorId: 'doctor-1',
      qualificationIds: ['q-1', 'q-2'],
    });
    expect(parsed?.exp).toBeGreaterThan(Date.now());
  });

  it('rejects a tampered token', () => {
    const token = createReminderToken({
      tenantId: 'tenant-1',
      doctorId: 'doctor-1',
      qualificationIds: ['q-1'],
    });
    const tampered = token.replace(/.$/, 'X');
    expect(verifyReminderToken(tampered)).toBeNull();
  });

  it('rejects an expired token', async () => {
    const token = createReminderToken({
      tenantId: 'tenant-1',
      doctorId: 'doctor-1',
      qualificationIds: ['q-1'],
    });
    // Parse the token, overwrite exp to the past, and re-sign with the same secret.
    const [encodedPayload] = token.split('.');
    const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
    payload.exp = Date.now() - 1000;
    const newEncoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const crypto = await import('node:crypto');
    const signature = crypto
      .createHmac('sha256', process.env.JWT_SECRET)
      .update(newEncoded)
      .digest('base64url');
    const expiredToken = `${newEncoded}.${signature}`;
    expect(verifyReminderToken(expiredToken)).toBeNull();
  });

  it('rejects a token with a missing field', async () => {
    const token = createReminderToken({
      tenantId: 'tenant-1',
      doctorId: 'doctor-1',
      qualificationIds: [],
    });
    const [encodedPayload] = token.split('.');
    const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
    delete payload.doctorId;
    const newEncoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const crypto = await import('node:crypto');
    const signature = crypto
      .createHmac('sha256', process.env.JWT_SECRET)
      .update(newEncoded)
      .digest('base64url');
    const malformedToken = `${newEncoded}.${signature}`;
    expect(verifyReminderToken(malformedToken)).toBeNull();
  });

  it('rejects null/empty tokens', () => {
    expect(verifyReminderToken('')).toBeNull();
    expect(verifyReminderToken(null)).toBeNull();
    expect(verifyReminderToken('not-a-token')).toBeNull();
  });
});
