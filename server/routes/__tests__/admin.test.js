import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../auth.js', () => ({
  authMiddleware: (req, res, next) => {
    if (req.headers['x-auth'] !== 'yes') {
      return res.status(401).json({ error: 'auth required' });
    }

    next();
  },
  adminMiddleware: (req, res, next) => {
    if (req.headers['x-admin'] !== 'yes') {
      return res.status(403).json({ error: 'admin required' });
    }

    next();
  },
}));

vi.mock('../admin/tools.js', async () => {
  const expressModule = await import('express');
  const router = expressModule.default.Router();
  router.get('/tools-probe', (req, res) => {
    res.json({ scope: 'tools' });
  });
  return { default: router };
});

vi.mock('../admin/system.js', async () => {
  const expressModule = await import('express');
  const router = expressModule.default.Router();
  router.get('/system-probe', (req, res) => {
    res.json({ scope: 'system' });
  });
  return { default: router };
});

vi.mock('../admin/migrations.js', async () => {
  const expressModule = await import('express');
  const router = expressModule.default.Router();
  router.get('/migrations-probe', (req, res) => {
    res.json({ scope: 'migrations' });
  });
  return { default: router };
});

vi.mock('../admin/dbTokens.js', async () => {
  const expressModule = await import('express');
  const router = expressModule.default.Router();
  router.get('/db-tokens-probe', (req, res) => {
    res.json({ scope: 'dbTokens' });
  });
  return { default: router };
});

import adminRouter from '../admin.js';

const createApp = () => {
  const app = express();
  app.use(adminRouter);
  return app;
};

describe('admin router', () => {
  it('keeps tools routes ahead of auth and admin checks', async () => {
    const response = await request(createApp()).get('/tools-probe');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ scope: 'tools' });
  });

  it('applies auth and admin checks before protected admin routes', async () => {
    const app = createApp();

    const unauthenticated = await request(app).get('/system-probe');
    expect(unauthenticated.status).toBe(401);
    expect(unauthenticated.body).toEqual({ error: 'auth required' });

    const nonAdmin = await request(app).get('/system-probe').set('x-auth', 'yes');
    expect(nonAdmin.status).toBe(403);
    expect(nonAdmin.body).toEqual({ error: 'admin required' });

    const allowed = await request(app)
      .get('/system-probe')
      .set('x-auth', 'yes')
      .set('x-admin', 'yes');
    expect(allowed.status).toBe(200);
    expect(allowed.body).toEqual({ scope: 'system' });
  });

  it('mounts every protected admin module behind the same middleware chain', async () => {
    const app = createApp();
    const protectedPaths = [
      ['/system-probe', 'system'],
      ['/migrations-probe', 'migrations'],
      ['/db-tokens-probe', 'dbTokens'],
    ];

    for (const [path, scope] of protectedPaths) {
      const response = await request(app).get(path).set('x-auth', 'yes').set('x-admin', 'yes');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ scope });
    }
  });
});
