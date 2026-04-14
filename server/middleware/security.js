import express from 'express';
import compression from 'compression';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { CONTENT_SECURITY_POLICY_DIRECTIVES } from './securityPolicy.js';

const generalLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 300,
  message: { error: 'Too many requests from this IP, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    const requestPath = req.originalUrl?.split('?')[0] || `${req.baseUrl || ''}${req.path || ''}`;
    return (
      requestPath === '/api/auth/me' ||
      requestPath === '/api/auth/presence' ||
      requestPath === '/api/auth/jitsi-token' ||
      requestPath.startsWith('/api/auth/cowork')
    );
  },
});

const internalAuthLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 1200,
  message: {
    error: 'Too many internal auth or CoWork requests from this IP, please try again shortly.',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: { error: 'Too many login attempts from this IP, please try again after 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
});

export const applySecurityMiddleware = (app) => {
  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      crossOriginOpenerPolicy: { policy: 'unsafe-none' },
      crossOriginEmbedderPolicy: false,
      contentSecurityPolicy: {
        useDefaults: false,
        directives: CONTENT_SECURITY_POLICY_DIRECTIVES,
      },
    }),
  );
  app.use(
    compression({
      filter: (req, res) => {
        if (req.path === '/api/auth/events/stream') {
          return false;
        }

        return compression.filter(req, res);
      },
    }),
  );

  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  app.use('/api/', generalLimiter);
  app.use('/api/auth/me', internalAuthLimiter);
  app.use('/api/auth/presence', internalAuthLimiter);
  app.use('/api/auth/jitsi-token', internalAuthLimiter);
  app.use('/api/auth/cowork', internalAuthLimiter);
};
