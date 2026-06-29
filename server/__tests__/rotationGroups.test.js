import { describe, it, expect } from 'vitest';
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
