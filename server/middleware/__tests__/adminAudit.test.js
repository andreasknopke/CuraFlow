import { describe, expect, it, vi, beforeEach } from 'vitest';

// Mock dependencies before importing the module under test
vi.mock('../../db/pool.js', () => ({ db: { execute: vi.fn() } }));
vi.mock('../../routes/dbProxy/audit.js', () => ({
  writeAuditLog: vi.fn().mockResolvedValue(undefined),
}));

import { createAdminAuditMiddleware } from '../adminAudit.js';
import { writeAuditLog } from '../../routes/dbProxy/audit.js';

const makeReqRes = (method = 'POST', url = '/api/admin/users', body = {}) => {
  const listeners = {};
  const res = {
    statusCode: 200,
    on: (event, cb) => {
      listeners[event] = cb;
    },
    emit: (event) => listeners[event]?.(),
  };
  const req = {
    method,
    originalUrl: url,
    body,
    params: {},
    query: {},
    user: { email: 'admin@example.com' },
    dbToken: null,
    db: null,
  };
  return { req, res };
};

describe('createAdminAuditMiddleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls writeAuditLog after a successful mutation request', async () => {
    const middleware = createAdminAuditMiddleware('TestSource');
    const { req, res } = makeReqRes('POST', '/api/admin/users', { name: 'Alice' });
    const next = vi.fn();

    middleware(req, res, next);
    expect(next).toHaveBeenCalledOnce();

    // Simulate response finish with success status
    res.statusCode = 201;
    res.emit('finish');

    await vi.waitFor(() => expect(writeAuditLog).toHaveBeenCalledOnce());

    const [, auditArgs] = writeAuditLog.mock.calls[0];
    expect(auditArgs.source).toBe('TestSource');
    expect(auditArgs.message).toContain('POST');
    expect(auditArgs.message).toContain('admin@example.com');
    expect(auditArgs.details.method).toBe('POST');
    expect(auditArgs.details.statusCode).toBe(201);
  });

  it('does NOT write audit log for read-only GET requests', () => {
    const middleware = createAdminAuditMiddleware();
    const { req, res } = makeReqRes('GET', '/api/admin/users');
    const next = vi.fn();

    middleware(req, res, next);
    res.emit('finish');

    expect(writeAuditLog).not.toHaveBeenCalled();
  });

  it('does NOT write audit log when the response status is 4xx', async () => {
    const middleware = createAdminAuditMiddleware();
    const { req, res } = makeReqRes('DELETE', '/api/admin/users/1');
    const next = vi.fn();

    middleware(req, res, next);
    res.statusCode = 404;
    res.emit('finish');

    await new Promise((r) => setTimeout(r, 10));
    expect(writeAuditLog).not.toHaveBeenCalled();
  });

  it('redacts sensitive keys in the request body', async () => {
    const middleware = createAdminAuditMiddleware();
    const { req, res } = makeReqRes('POST', '/api/admin/users', {
      email: 'alice@x.com',
      password: 'super-secret',
      token: 'abc123',
    });
    const next = vi.fn();

    middleware(req, res, next);
    res.statusCode = 200;
    res.emit('finish');

    await vi.waitFor(() => expect(writeAuditLog).toHaveBeenCalledOnce());
    const [, auditArgs] = writeAuditLog.mock.calls[0];
    expect(auditArgs.details.body.password).toBe('[REDACTED]');
    expect(auditArgs.details.body.token).toBe('[REDACTED]');
    expect(auditArgs.details.body.email).toBe('alice@x.com');
  });

  it('uses "unknown" as userEmail when no user is set on request', async () => {
    const middleware = createAdminAuditMiddleware();
    const { req, res } = makeReqRes('PUT', '/api/admin/settings');
    delete req.user;
    const next = vi.fn();

    middleware(req, res, next);
    res.statusCode = 200;
    res.emit('finish');

    await vi.waitFor(() => expect(writeAuditLog).toHaveBeenCalledOnce());
    const [, auditArgs] = writeAuditLog.mock.calls[0];
    expect(auditArgs.userEmail).toBe('unknown');
  });

  it('defaults source to "Admin" when no source is passed', async () => {
    const middleware = createAdminAuditMiddleware();
    const { req, res } = makeReqRes('PATCH', '/api/admin/roles');
    const next = vi.fn();

    middleware(req, res, next);
    res.statusCode = 200;
    res.emit('finish');

    await vi.waitFor(() => expect(writeAuditLog).toHaveBeenCalledOnce());
    const [, auditArgs] = writeAuditLog.mock.calls[0];
    expect(auditArgs.source).toBe('Admin');
  });
});
