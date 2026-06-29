import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  parseAllowedRotationGroups,
  parseRotationAdminGroups,
  canReadRotationGroup,
  canWriteRotationGroup,
} from '../../server/utils/rotationGroups.js';

describe('parseAllowedRotationGroups', () => {
  it('parses a JSON array string', () => {
    expect(parseAllowedRotationGroups('[1, 2, 3]')).toEqual([1, 2, 3]);
  });

  it('parses an actual array', () => {
    expect(parseAllowedRotationGroups([1, 2])).toEqual([1, 2]);
  });

  it('returns null for null/undefined/empty', () => {
    expect(parseAllowedRotationGroups(null)).toBeNull();
    expect(parseAllowedRotationGroups(undefined)).toBeNull();
    expect(parseAllowedRotationGroups('')).toBeNull();
  });

  it('returns null for invalid JSON', () => {
    expect(parseAllowedRotationGroups('not-json')).toBeNull();
  });

  it('returns null for non-array JSON', () => {
    expect(parseAllowedRotationGroups('{"a":1}')).toBeNull();
  });

  it('filters out non-integer values', () => {
    expect(parseAllowedRotationGroups('[1, "x", 2.5, 3]')).toEqual([1, 3]);
  });

  it('returns null for an empty array', () => {
    expect(parseAllowedRotationGroups('[]')).toBeNull();
  });
});

describe('parseRotationAdminGroups', () => {
  it('delegates to parseAllowedRotationGroups', () => {
    expect(parseRotationAdminGroups('[5, 6]')).toEqual([5, 6]);
    expect(parseRotationAdminGroups(null)).toBeNull();
  });
});

describe('canReadRotationGroup', () => {
  it('allows master admin access to any group', () => {
    const ctx = { isMasterAdmin: true, allowedGroups: null };
    expect(canReadRotationGroup(ctx, 42)).toBe(true);
  });

  it('allows access when group is in allowedGroups', () => {
    const ctx = { isMasterAdmin: false, allowedGroups: [1, 2, 3] };
    expect(canReadRotationGroup(ctx, 2)).toBe(true);
  });

  it('denies access when group is not in allowedGroups', () => {
    const ctx = { isMasterAdmin: false, allowedGroups: [1, 2] };
    expect(canReadRotationGroup(ctx, 99)).toBe(false);
  });

  it('denies access when allowedGroups is null (non-admin)', () => {
    const ctx = { isMasterAdmin: false, allowedGroups: null };
    expect(canReadRotationGroup(ctx, 1)).toBe(false);
  });

  it('denies access when ctx is null', () => {
    expect(canReadRotationGroup(null, 1)).toBe(false);
  });
});

describe('canWriteRotationGroup', () => {
  it('allows master admin write access', () => {
    const ctx = { isMasterAdmin: true, adminGroups: null };
    expect(canWriteRotationGroup(ctx, 42)).toBe(true);
  });

  it('allows write when group is in adminGroups', () => {
    const ctx = { isMasterAdmin: false, adminGroups: [10, 20] };
    expect(canWriteRotationGroup(ctx, 20)).toBe(true);
  });

  it('denies write when group is only in allowedGroups but not adminGroups', () => {
    const ctx = { isMasterAdmin: false, allowedGroups: [10], adminGroups: [20] };
    expect(canWriteRotationGroup(ctx, 10)).toBe(false);
  });

  it('denies write when ctx is null', () => {
    expect(canWriteRotationGroup(null, 1)).toBe(false);
  });
});

// Express matches routes in registration order. A param route like /:groupId
// would shadow any single-segment named route (e.g. /visible-rotations, /demands)
// registered after it. This test guards against that regression by checking
// the source file line order (importing the router in unit tests fails due
// to the express dependency not being resolvable from the root).
describe('rotations router route ordering', () => {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const source = readFileSync(
    join(__dirname, '..', 'routes', 'rotations.js'),
    'utf-8'
  );
  const lines = source.split('\n');

  function firstLineMatching(pattern) {
    const idx = lines.findIndex((l) => pattern.test(l));
    return idx; // 0-based, -1 if not found
  }

  it('registers GET /visible-rotations before GET /:groupId', () => {
    const visibleLine = firstLineMatching(/router\.get\(['"]\/visible-rotations['"]/);
    const groupIdLine = firstLineMatching(/router\.get\(['"]\/:groupId['"]/);
    expect(visibleLine).toBeGreaterThanOrEqual(0);
    expect(groupIdLine).toBeGreaterThanOrEqual(0);
    expect(visibleLine).toBeLessThan(groupIdLine);
  });

  it('registers POST /demands before GET /:groupId', () => {
    const demandsPostLine = firstLineMatching(/router\.post\(['"]\/demands['"]/);
    const groupIdLine = firstLineMatching(/router\.get\(['"]\/:groupId['"]/);
    expect(demandsPostLine).toBeGreaterThanOrEqual(0);
    expect(groupIdLine).toBeGreaterThanOrEqual(0);
    expect(demandsPostLine).toBeLessThan(groupIdLine);
  });

  it('registers GET /demands before GET /:groupId', () => {
    const demandsGetLine = firstLineMatching(/router\.get\(['"]\/demands['"]/);
    const groupIdLine = firstLineMatching(/router\.get\(['"]\/:groupId['"]/);
    expect(demandsGetLine).toBeGreaterThanOrEqual(0);
    expect(groupIdLine).toBeGreaterThanOrEqual(0);
    expect(demandsGetLine).toBeLessThan(groupIdLine);
  });
});
