import jwt from 'jsonwebtoken';
import config from '../config.js';

export const buildAuthTokenPayload = (user) => ({
  sub: user.sub ?? user.id,
  email: user.email,
  role: user.role,
  doctor_id: user.doctor_id ?? null,
});

export const createAccessToken = (payload) =>
  jwt.sign({ ...buildAuthTokenPayload(payload), type: 'access' }, config.jwt.secret, {
    expiresIn: config.jwt.tokenExpiry,
  });

export const createRefreshToken = (payload) =>
  jwt.sign({ ...buildAuthTokenPayload(payload), type: 'refresh' }, config.jwt.refreshSecret, {
    expiresIn: config.jwt.refreshTokenExpiry,
  });

export const createAuthTokens = (payload) => {
  const normalizedPayload = buildAuthTokenPayload(payload);
  return {
    token: createAccessToken(normalizedPayload),
    refreshToken: createRefreshToken(normalizedPayload),
  };
};

export const verifyAccessToken = (token) => {
  try {
    const payload = jwt.verify(token, config.jwt.secret);
    if (payload?.type === 'refresh') {
      return null;
    }
    return payload;
  } catch (_error) {
    return null;
  }
};

export const verifyRefreshToken = (token) => {
  try {
    const payload = jwt.verify(token, config.jwt.refreshSecret);
    if (payload?.type !== 'refresh') {
      return null;
    }
    return payload;
  } catch (_error) {
    return null;
  }
};
