import { describe, expect, it } from 'vitest';

import jwt from 'jsonwebtoken';
import config from '../../config.js';
import {
  buildAuthTokenPayload,
  createAccessToken,
  createRefreshToken,
  createAuthTokens,
  verifyAccessToken,
  verifyRefreshToken,
} from '../authTokens.js';

const baseUser = { id: 'user-123', email: 'alice@example.com', role: 'admin', doctor_id: 'doc-1' };

describe('buildAuthTokenPayload', () => {
  it('normalizes user.id into sub when sub is absent', () => {
    const payload = buildAuthTokenPayload(baseUser);
    expect(payload.sub).toBe('user-123');
    expect(payload.email).toBe('alice@example.com');
    expect(payload.role).toBe('admin');
    expect(payload.doctor_id).toBe('doc-1');
  });

  it('prefers sub over id when both are present', () => {
    const user = { ...baseUser, sub: 'sub-override', id: 'id-fallback' };
    const payload = buildAuthTokenPayload(user);
    expect(payload.sub).toBe('sub-override');
  });

  it('sets doctor_id to null when absent', () => {
    const { doctor_id, ...noDoctor } = baseUser;
    const payload = buildAuthTokenPayload(noDoctor);
    expect(payload.doctor_id).toBeNull();
  });
});

describe('createAccessToken / verifyAccessToken', () => {
  it('creates a verifiable JWT with type=access', () => {
    const token = createAccessToken(baseUser);
    const decoded = verifyAccessToken(token);
    expect(decoded).not.toBeNull();
    expect(decoded.sub).toBe('user-123');
    expect(decoded.type).toBe('access');
  });

  it('rejects a refresh token passed to verifyAccessToken (cross-token protection)', () => {
    const refresh = createRefreshToken(baseUser);
    expect(verifyAccessToken(refresh)).toBeNull();
  });

  it('returns null for a malformed token', () => {
    expect(verifyAccessToken('not.a.jwt')).toBeNull();
  });

  it('returns null for an expired access token', () => {
    const expired = jwt.sign(
      { ...buildAuthTokenPayload(baseUser), type: 'access' },
      config.jwt.secret,
      { expiresIn: '-1s' },
    );
    expect(verifyAccessToken(expired)).toBeNull();
  });
});

describe('createRefreshToken / verifyRefreshToken', () => {
  it('creates a verifiable JWT with type=refresh', () => {
    const token = createRefreshToken(baseUser);
    const decoded = verifyRefreshToken(token);
    expect(decoded).not.toBeNull();
    expect(decoded.sub).toBe('user-123');
    expect(decoded.type).toBe('refresh');
  });

  it('rejects an access token passed to verifyRefreshToken (cross-token protection)', () => {
    const access = createAccessToken(baseUser);
    expect(verifyRefreshToken(access)).toBeNull();
  });

  it('returns null for a malformed token', () => {
    expect(verifyRefreshToken('garbage')).toBeNull();
  });

  it('returns null for an expired refresh token', () => {
    const expired = jwt.sign(
      { ...buildAuthTokenPayload(baseUser), type: 'refresh' },
      config.jwt.refreshSecret,
      { expiresIn: '-1s' },
    );
    expect(verifyRefreshToken(expired)).toBeNull();
  });
});

describe('createAuthTokens', () => {
  it('returns both token and refreshToken in one call', () => {
    const { token, refreshToken } = createAuthTokens(baseUser);
    expect(verifyAccessToken(token)).not.toBeNull();
    expect(verifyRefreshToken(refreshToken)).not.toBeNull();
  });

  it('access and refresh tokens are distinct strings', () => {
    const { token, refreshToken } = createAuthTokens(baseUser);
    expect(token).not.toBe(refreshToken);
  });
});
