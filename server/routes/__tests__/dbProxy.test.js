import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { handleDbProxyRequest } = vi.hoisted(() => ({
  handleDbProxyRequest: vi.fn((req, res) => {
    res.status(200).json({
      delegated: true,
      action: req.body.action,
      entity: req.body.entity,
    });
  }),
}));

vi.mock('../dbProxy/operations.js', () => ({
  handleDbProxyRequest,
}));

import dbProxyRouter from '../dbProxy.js';

const createApp = () => {
  const app = express();
  app.use(express.json());
  app.use(dbProxyRouter);
  return app;
};

describe('dbProxy router', () => {
  beforeEach(() => {
    handleDbProxyRequest.mockClear();
  });

  it('rejects GET requests with a clear method hint', async () => {
    const response = await request(createApp()).get('/');

    expect(response.status).toBe(405);
    expect(response.body).toEqual({
      error: 'Method not allowed. Use POST with { action, entity, ... }',
      hint: 'GET requests are not supported on /api/db',
    });
    expect(handleDbProxyRequest).not.toHaveBeenCalled();
  });

  it('delegates POST requests to the db proxy handler', async () => {
    const payload = { action: 'list', entity: 'Doctor' };

    const response = await request(createApp()).post('/').send(payload);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      delegated: true,
      action: 'list',
      entity: 'Doctor',
    });
    expect(handleDbProxyRequest).toHaveBeenCalledTimes(1);
  });
});
