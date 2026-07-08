import { describe, expect, it } from 'vitest';

import { isValidIdentifier, assertValidIdentifier } from '../utils/schema.js';

describe('isValidIdentifier (SQL identifier validation — injection guard)', () => {
  // ---- Valid identifiers are accepted (returned, trimmed, truthy) ----
  it.each([
    ['Doctor'],
    ['ShiftEntry'],
    ['StaffingPlanEntry'],
    ['Tenant_Base_Tbl1'],
    ['x'],
    ['a1'],
    ['  Doctor  '], // trimmed
  ])('accepts valid identifier %p', (input) => {
    expect(isValidIdentifier(input)).toBeTruthy();
  });

  it('returns the trimmed name for valid input', () => {
    expect(isValidIdentifier('  Doctor  ')).toBe('Doctor');
  });

  // ---- SQL-injection payloads are REJECTED ----
  // This is the security boundary: a backtick (or other metacharacter) in a
  // table/column name would break out of the `\`{name}\`` identifier context.
  // Prepared statements cannot parameterize identifiers, so the name itself
  // must be validated before interpolation.
  it.each([
    ['Doctor` WHERE 1=1'], // backtick breakout (the S1 finding)
    ['Doctor`-- '],
    ['Doc`x'],
    ['Doctor; DROP TABLE x'], // statement chaining
    ["Dr'or"], // single quote
    ['"quoted"'], // double quote
    ['Dr octor'], // space
    ['Inject) UNION SELECT'], // parentheses + keywords
    ['name--'], // SQL comment
    ['name/*c*/'],
    ['name`x`'],
    ['ta\nble'], // newline
    ['tab\x00le'], // null byte
    [''], // empty
    ['   '], // whitespace only
  ])('rejects injection payload %p', (input) => {
    expect(isValidIdentifier(input)).toBeFalsy();
  });

  it.each([
    [123],
    [null],
    [undefined],
    [{}],
    [[]],
  ])('rejects non-string input %p', (input) => {
    expect(isValidIdentifier(input)).toBeFalsy();
  });

  it('accepts a two-segment schema.table form', () => {
    expect(isValidIdentifier('information_schema.tables')).toBe('information_schema.tables');
  });

  it('rejects three or more dot segments', () => {
    expect(isValidIdentifier('a.b.c')).toBeFalsy();
  });

  it('rejects a leading digit', () => {
    expect(isValidIdentifier('1table')).toBeFalsy();
  });
});

describe('assertValidIdentifier', () => {
  it('returns the valid identifier and does not throw', () => {
    expect(assertValidIdentifier('Doctor', 'Tabellenname')).toBe('Doctor');
  });

  it('throws an HTTP 400 error for a backtick-injection payload', () => {
    try {
      assertValidIdentifier('Doctor` WHERE 1=1', 'Tabellenname');
      throw new Error('should have thrown');
    } catch (err) {
      expect(err.status).toBe(400);
      expect(err.message).toMatch(/Tabellenname/);
    }
  });

  it('throws a 400 for empty input', () => {
    try {
      assertValidIdentifier('', 'entity');
      throw new Error('should have thrown');
    } catch (err) {
      expect(err.status).toBe(400);
    }
  });
});
