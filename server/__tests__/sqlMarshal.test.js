import { describe, expect, it } from 'vitest';

import { toSqlValue, fromSqlRow, toSqlValueStrict, fromSqlRowBasic } from '../utils/sqlMarshal.js';

/**
 * Phase 2, PR 2.0 — pin the load-bearing differences between the two marshal
 * variants. dbProxy and atomic historically had DIFFERENT toSqlValue/fromSqlRow
 * behavior; PR 2.0 extracted both verbatim into sqlMarshal.js rather than
 * unifying them (unifying would regress one caller). These tests guard against
 * a future "let's just merge these" mistake.
 */
describe('toSqlValue vs toSqlValueStrict — the empty-string divergence', () => {
  it('toSqlValue (dbProxy) collapses empty string to NULL', () => {
    expect(toSqlValue('')).toBeNull();
  });

  it('toSqlValueStrict (atomic) keeps empty string as-is', () => {
    expect(toSqlValueStrict('')).toBe('');
  });

  it('both variants agree on the other transformations', () => {
    // undefined → null
    expect(toSqlValue(undefined)).toBeNull();
    expect(toSqlValueStrict(undefined)).toBeNull();
    // NaN → null
    expect(toSqlValue(NaN)).toBeNull();
    expect(toSqlValueStrict(NaN)).toBeNull();
    // Date → 'YYYY-MM-DD HH:MM:SS'
    const d = new Date('2026-07-29T10:30:00.000Z');
    expect(toSqlValue(d)).toBe('2026-07-29 10:30:00');
    expect(toSqlValueStrict(d)).toBe('2026-07-29 10:30:00');
    // object → JSON
    expect(toSqlValue({ a: 1 })).toBe('{"a":1}');
    expect(toSqlValueStrict({ a: 1 })).toBe('{"a":1}');
    // primitives pass through
    expect(toSqlValue(42)).toBe(42);
    expect(toSqlValueStrict(42)).toBe(42);
    expect(toSqlValue('hello')).toBe('hello');
    expect(toSqlValueStrict('hello')).toBe('hello');
  });
});

describe('fromSqlRow vs fromSqlRowBasic — JSON + bool-field divergence', () => {
  it('fromSqlRow (dbProxy) parses the active_days JSON field', () => {
    const row = { id: '1', active_days: '[1,2,3]' };
    expect(fromSqlRow(row).active_days).toEqual([1, 2, 3]);
  });

  it('fromSqlRowBasic (atomic) does NOT parse active_days (leaves the string)', () => {
    const row = { id: '1', active_days: '[1,2,3]' };
    expect(fromSqlRowBasic(row).active_days).toBe('[1,2,3]');
  });

  it('fromSqlRow coerces the larger bool-field set (e.g. is_specialist)', () => {
    const row = { id: '1', is_specialist: 1, can_do_foreground_duty: 0 };
    const parsed = fromSqlRow(row);
    expect(parsed.is_specialist).toBe(true);
    expect(parsed.can_do_foreground_duty).toBe(false);
  });

  it('fromSqlRowBasic does NOT coerce fields outside its 9-field set (is_specialist stays raw)', () => {
    const row = { id: '1', is_specialist: 1 };
    const parsed = fromSqlRowBasic(row);
    // is_specialist is NOT in atomic's bool list → left as the raw DB value
    expect(parsed.is_specialist).toBe(1);
  });

  it('both variants coerce the shared bool fields (e.g. is_active)', () => {
    const row = { id: '1', is_active: 1, acknowledged: 0 };
    expect(fromSqlRow(row).is_active).toBe(true);
    expect(fromSqlRow(row).acknowledged).toBe(false);
    expect(fromSqlRowBasic(row).is_active).toBe(true);
    expect(fromSqlRowBasic(row).acknowledged).toBe(false);
  });

  it('both return null for null input', () => {
    expect(fromSqlRow(null)).toBeNull();
    expect(fromSqlRowBasic(null)).toBeNull();
  });
});
