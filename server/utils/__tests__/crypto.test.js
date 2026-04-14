import { describe, expect, it, beforeEach, vi } from 'vitest';

// Set required env vars before importing config/crypto
process.env.JWT_SECRET = 'test-secret-for-crypto-tests-minimum-length';
process.env.MYSQL_HOST = 'localhost';
process.env.MYSQL_USER = 'test';
process.env.MYSQL_PASSWORD = 'test';
process.env.MYSQL_DATABASE = 'test';

import { encryptToken, decryptToken, isLegacyToken, parseDbToken } from '../crypto.js';

describe('crypto utilities', () => {
  describe('encryptToken / decryptToken', () => {
    it('round-trips a simple string', () => {
      const plaintext = 'hello world';
      const encrypted = encryptToken(plaintext);
      expect(encrypted).not.toBe(plaintext);
      expect(decryptToken(encrypted)).toBe(plaintext);
    });

    it('round-trips a JSON DB config string', () => {
      const config = JSON.stringify({ host: 'db.example.com', user: 'app', database: 'mydb' });
      const encrypted = encryptToken(config);
      expect(decryptToken(encrypted)).toBe(config);
    });

    it('produces different ciphertexts for the same input (random IV)', () => {
      const plaintext = 'same-input';
      const first = encryptToken(plaintext);
      const second = encryptToken(plaintext);
      expect(first).not.toBe(second);
      // Both must still decrypt correctly
      expect(decryptToken(first)).toBe(plaintext);
      expect(decryptToken(second)).toBe(plaintext);
    });

    it('produces base64-only output (no binary data)', () => {
      const encrypted = encryptToken('test');
      expect(encrypted).toMatch(/^[A-Za-z0-9+/=]+$/);
    });

    it('throws on tampered ciphertext (GCM auth tag mismatch)', () => {
      const encrypted = encryptToken('sensitive-data');
      const buf = Buffer.from(encrypted, 'base64');
      // Flip a byte in the ciphertext section (after 32 bytes of iv+tag)
      buf[35] ^= 0xff;
      const tampered = buf.toString('base64');
      expect(() => decryptToken(tampered)).toThrow();
    });

    it('throws on completely invalid base64', () => {
      expect(() => decryptToken('not-valid-base64!!!')).toThrow();
    });

    it('throws when encrypted data is too short to contain iv + authTag', () => {
      const tooShort = Buffer.from('short').toString('base64');
      expect(() => decryptToken(tooShort)).toThrow();
    });
  });

  describe('isLegacyToken', () => {
    it('detects a base64-encoded JSON DB config as legacy', () => {
      const legacy = Buffer.from(
        JSON.stringify({ host: 'localhost', user: 'root', database: 'app' }),
      ).toString('base64');
      expect(isLegacyToken(legacy)).toBe(true);
    });

    it('rejects an encrypted (non-legacy) token', () => {
      const encrypted = encryptToken(JSON.stringify({ host: 'x', user: 'y', database: 'z' }));
      expect(isLegacyToken(encrypted)).toBe(false);
    });

    it('rejects random base64 that is not valid JSON', () => {
      const random = Buffer.from('this is not json').toString('base64');
      expect(isLegacyToken(random)).toBe(false);
    });

    it('rejects a JSON object that lacks the required DB fields', () => {
      const noDbFields = Buffer.from(JSON.stringify({ foo: 'bar' })).toString('base64');
      expect(isLegacyToken(noDbFields)).toBe(false);
    });

    it('returns false for null / undefined input', () => {
      expect(isLegacyToken(null)).toBe(false);
      expect(isLegacyToken(undefined)).toBe(false);
    });
  });

  describe('parseDbToken', () => {
    it('decrypts and parses a modern encrypted token', () => {
      const config = { host: 'db.example.com', user: 'app', database: 'prod' };
      const encrypted = encryptToken(JSON.stringify(config));
      expect(parseDbToken(encrypted)).toEqual(config);
    });

    it('parses a legacy base64 token without decryption', () => {
      const config = { host: 'localhost', user: 'root', database: 'legacy' };
      const legacy = Buffer.from(JSON.stringify(config)).toString('base64');
      expect(parseDbToken(legacy)).toEqual(config);
    });

    it('returns null for a completely invalid token', () => {
      expect(parseDbToken('definitely-not-a-token')).toBeNull();
    });

    it('returns null for null input', () => {
      expect(parseDbToken(null)).toBeNull();
    });
  });
});
