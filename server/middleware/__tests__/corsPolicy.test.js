import { describe, expect, it } from 'vitest';
import { buildAllowedOrigins, createCorsRejectionError, isOriginAllowed } from '../corsPolicy.js';

describe('corsPolicy helpers', () => {
  it('builds the configured allowlist with localhost defaults', () => {
    const allowedOrigins = buildAllowedOrigins({
      frontendUrl: 'https://frontend.example.com',
      allowedOrigins: 'https://a.example.com, https://b.example.com',
    });

    expect(allowedOrigins).toContain('https://frontend.example.com');
    expect(allowedOrigins).toContain('https://a.example.com');
    expect(allowedOrigins).toContain('https://b.example.com');
    expect(allowedOrigins).toContain('http://localhost:5173');
    expect(allowedOrigins).toContain('http://localhost:3000');
  });

  it('allows configured and Railway origins but blocks everything else', () => {
    const allowedOrigins = buildAllowedOrigins({
      frontendUrl: 'https://frontend.example.com',
      allowedOrigins: '',
    });

    expect(isOriginAllowed(undefined, allowedOrigins)).toBe(true);
    expect(isOriginAllowed('https://frontend.example.com', allowedOrigins)).toBe(true);
    expect(isOriginAllowed('https://preview-app.up.railway.app', allowedOrigins)).toBe(true);
    expect(isOriginAllowed('https://evil.example.com', allowedOrigins)).toBe(false);
    expect(createCorsRejectionError('https://evil.example.com')).toMatchObject({
      message: 'Not allowed by CORS',
      status: 403,
      origin: 'https://evil.example.com',
    });
  });
});
