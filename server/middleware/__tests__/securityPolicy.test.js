import { describe, expect, it } from 'vitest';
import { CONTENT_SECURITY_POLICY_DIRECTIVES } from '../securityPolicy.js';

describe('securityPolicy directives', () => {
  it('locks down critical sources while allowing required app resources', () => {
    expect(CONTENT_SECURITY_POLICY_DIRECTIVES.defaultSrc).toEqual(["'self'"]);
    expect(CONTENT_SECURITY_POLICY_DIRECTIVES.objectSrc).toEqual(["'none'"]);
    expect(CONTENT_SECURITY_POLICY_DIRECTIVES.frameAncestors).toEqual(["'self'"]);
    expect(CONTENT_SECURITY_POLICY_DIRECTIVES.connectSrc).toContain('wss:');
    expect(CONTENT_SECURITY_POLICY_DIRECTIVES.frameSrc).toContain('https:');
    expect(CONTENT_SECURITY_POLICY_DIRECTIVES.styleSrc).toContain("'unsafe-inline'");
    expect(CONTENT_SECURITY_POLICY_DIRECTIVES.imgSrc).toContain('https:');
  });
});
