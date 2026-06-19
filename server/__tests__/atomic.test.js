import { describe, expect, it } from 'vitest';

// ---------------------------------------------------------------------------
// Helper functions from atomic.js (reproduced for isolated testing)
// ---------------------------------------------------------------------------

/** Convert JS value to MySQL value */
function toSqlValue(val) {
  if (val === undefined) return null;
  if (typeof val === 'number' && isNaN(val)) return null;
  if (typeof val === 'object' && val !== null && !(val instanceof Date)) {
    return JSON.stringify(val);
  }
  if (val instanceof Date) {
    return val.toISOString().slice(0, 19).replace('T', ' ');
  }
  return val;
}

/** Parse MySQL row (boolean field coercion) */
function fromSqlRow(row) {
  if (!row) return null;
  const res = { ...row };
  const boolFields = [
    'receive_email_notifications', 'exclude_from_staffing_plan',
    'user_viewed', 'auto_off', 'show_in_service_plan',
    'allows_rotation_concurrently', 'allows_absence_overlap',
    'acknowledged', 'is_active',
  ];
  for (const key in res) {
    if (boolFields.includes(key)) res[key] = !!res[key];
  }
  return res;
}

/** Add/subtract days from a date string */
function shiftIsoDate(dateString, days) {
  const date = new Date(`${dateString}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Tests: toSqlValue
// ---------------------------------------------------------------------------
describe('toSqlValue', () => {
  it('returns null for undefined', () => {
    expect(toSqlValue(undefined)).toBeNull();
  });

  it('returns null for NaN', () => {
    expect(toSqlValue(NaN)).toBeNull();
  });

  it('returns string values unchanged', () => {
    expect(toSqlValue('hello')).toBe('hello');
  });

  it('returns number values unchanged', () => {
    expect(toSqlValue(42)).toBe(42);
    expect(toSqlValue(3.14)).toBe(3.14);
  });

  it('returns boolean values unchanged', () => {
    expect(toSqlValue(true)).toBe(true);
    expect(toSqlValue(false)).toBe(false);
  });

  it('returns null as null', () => {
    expect(toSqlValue(null)).toBeNull();
  });

  it('serializes plain objects to JSON', () => {
    const obj = { key: 'value', nested: { a: 1 } };
    expect(toSqlValue(obj)).toBe(JSON.stringify(obj));
  });

  it('serializes arrays to JSON', () => {
    const arr = [1, 2, 3];
    expect(toSqlValue(arr)).toBe(JSON.stringify(arr));
  });

  it('formats Date objects to MySQL datetime', () => {
    const date = new Date(2026, 5, 15, 10, 30, 0);
    const result = toSqlValue(date);
    // Should be YYYY-MM-DD HH:MM:SS format
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    expect(result).toContain('2026-06-15');
  });

  it('returns empty string unchanged', () => {
    expect(toSqlValue('')).toBe('');
  });

  it('returns zero as 0', () => {
    expect(toSqlValue(0)).toBe(0);
  });

  it('handles date-only Date objects', () => {
    const date = new Date(2026, 0, 1);
    const result = toSqlValue(date);
    expect(result).toContain('2026-01-01');
  });
});

// ---------------------------------------------------------------------------
// Tests: fromSqlRow
// ---------------------------------------------------------------------------
describe('fromSqlRow', () => {
  it('returns null for null/undefined input', () => {
    expect(fromSqlRow(null)).toBeNull();
    expect(fromSqlRow(undefined)).toBeNull();
  });

  it('returns the row unchanged if no boolean fields are present', () => {
    const row = { id: 1, name: 'test', value: 42 };
    expect(fromSqlRow(row)).toEqual(row);
  });

  it('coerces boolean fields from 0/1 to false/true', () => {
    const row = {
      id: 1,
      auto_off: 1,
      receive_email_notifications: 0,
      is_active: 1,
    };
    const result = fromSqlRow(row);
    expect(result.auto_off).toBe(true);
    expect(result.receive_email_notifications).toBe(false);
    expect(result.is_active).toBe(true);
  });

  it('does not modify non-boolean fields', () => {
    const row = {
      id: 42,
      name: 'CT',
      optimal_staff: 2,
    };
    const result = fromSqlRow(row);
    expect(result.id).toBe(42);
    expect(result.name).toBe('CT');
    expect(result.optimal_staff).toBe(2);
  });

  it('handles empty objects', () => {
    expect(fromSqlRow({})).toEqual({});
  });

  it('does not mutate the original row', () => {
    const row = { auto_off: 1 };
    const copy = { ...row };
    fromSqlRow(row);
    expect(row).toEqual(copy);
  });
});

// ---------------------------------------------------------------------------
// Tests: shiftIsoDate
// ---------------------------------------------------------------------------
describe('shiftIsoDate', () => {
  it('returns the same date when days=0', () => {
    expect(shiftIsoDate('2026-06-15', 0)).toBe('2026-06-15');
  });

  it('adds days correctly', () => {
    expect(shiftIsoDate('2026-06-15', 1)).toBe('2026-06-16');
    expect(shiftIsoDate('2026-06-15', 7)).toBe('2026-06-22');
    expect(shiftIsoDate('2026-12-30', 2)).toBe('2027-01-01');
  });

  it('subtracts days correctly', () => {
    expect(shiftIsoDate('2026-06-15', -1)).toBe('2026-06-14');
    expect(shiftIsoDate('2026-06-15', -7)).toBe('2026-06-08');
    expect(shiftIsoDate('2026-01-01', -1)).toBe('2025-12-31');
  });

  it('handles month boundaries', () => {
    expect(shiftIsoDate('2026-01-31', 1)).toBe('2026-02-01');
    expect(shiftIsoDate('2026-02-28', 1)).toBe('2026-03-01');
  });

  it('handles leap years', () => {
    // 2024 is a leap year
    expect(shiftIsoDate('2024-02-28', 1)).toBe('2024-02-29');
    expect(shiftIsoDate('2024-02-28', 2)).toBe('2024-03-01');
    // 2025 is not a leap year
    expect(shiftIsoDate('2025-02-28', 1)).toBe('2025-03-01');
  });

  it('handles large positive shifts', () => {
    expect(shiftIsoDate('2026-01-01', 365)).toBe('2027-01-01');
  });

  it('handles large negative shifts', () => {
    expect(shiftIsoDate('2026-01-01', -365)).toBe('2025-01-01');
  });

  it('always returns YYYY-MM-DD format', () => {
    const result = shiftIsoDate('2026-06-15', 42);
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

// ---------------------------------------------------------------------------
// Tests: combined scenarios (mimicking route logic)
// ---------------------------------------------------------------------------
describe('atomic route logic (combined)', () => {
  it('toSqlValue + fromSqlRow round-trip preserves simple values', () => {
    const original = { id: 1, name: 'Test' };
    const sqlVal = toSqlValue(original.name);
    expect(sqlVal).toBe('Test');
  });

  it('boolean fields are handled correctly through the full pipeline', () => {
    const dbRow = { id: 1, auto_off: 1, name: 'CT' };
    const processed = fromSqlRow(dbRow);
    expect(processed.auto_off).toBe(true);
    expect(processed.name).toBe('CT');
    expect(processed.id).toBe(1);
  });
});
