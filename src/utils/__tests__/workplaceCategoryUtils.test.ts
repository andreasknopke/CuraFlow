import { describe, it, expect } from 'vitest';
import {
  parseWorkplaceCategories,
  getWorkplaceCategoriesFromSettings,
  getWorkplaceCategoryNames,
  categoryAllowsMultiple,
  workplaceAllowsMultiple,
  DEFAULT_CATEGORY_ALLOWS_MULTIPLE,
} from '../workplaceCategoryUtils';

describe('parseWorkplaceCategories', () => {
  it('returns empty array for null/undefined/empty', () => {
    expect(parseWorkplaceCategories(null)).toEqual([]);
    expect(parseWorkplaceCategories(undefined)).toEqual([]);
    expect(parseWorkplaceCategories('')).toEqual([]);
  });

  it('returns empty array for invalid JSON', () => {
    expect(parseWorkplaceCategories('not json')).toEqual([]);
    expect(parseWorkplaceCategories('{}')).toEqual([]); // object, not array
  });

  it('parses string entries with default allows_multiple: true', () => {
    const result = parseWorkplaceCategories('["CT", "MRT"]');
    expect(result).toEqual([
      { name: 'CT', allows_multiple: true },
      { name: 'MRT', allows_multiple: true },
    ]);
  });

  it('parses object entries preserving their fields', () => {
    const raw = JSON.stringify([{ name: 'Dienste', allows_multiple: false }]);
    const result = parseWorkplaceCategories(raw);
    expect(result).toEqual([{ name: 'Dienste', allows_multiple: false }]);
  });

  it('filters out null/blank entries', () => {
    const raw = JSON.stringify(['CT', '', null, '  ', { name: '' }]);
    const result = parseWorkplaceCategories(raw);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('CT');
  });

  it('trims whitespace from names', () => {
    const result = parseWorkplaceCategories('["  CT  "]');
    expect(result[0].name).toBe('CT');
  });
});

describe('getWorkplaceCategoriesFromSettings', () => {
  it('returns empty array when setting is missing', () => {
    expect(getWorkplaceCategoriesFromSettings([])).toEqual([]);
    expect(getWorkplaceCategoriesFromSettings([{ key: 'other', value: '[]' }])).toEqual([]);
  });

  it('parses the workplace_categories setting', () => {
    const settings = [{ key: 'workplace_categories', value: '["CT"]' }];
    const result = getWorkplaceCategoriesFromSettings(settings);
    expect(result).toEqual([{ name: 'CT', allows_multiple: true }]);
  });
});

describe('getWorkplaceCategoryNames', () => {
  it('returns only names', () => {
    const settings = [{ key: 'workplace_categories', value: '["CT","MRT"]' }];
    expect(getWorkplaceCategoryNames(settings)).toEqual(['CT', 'MRT']);
  });
});

describe('categoryAllowsMultiple', () => {
  it('returns the correct defaults for built-in categories', () => {
    expect(categoryAllowsMultiple('Rotationen')).toBe(true);
    expect(categoryAllowsMultiple('Dienste')).toBe(false);
    expect(categoryAllowsMultiple('Demonstrationen & Konsile')).toBe(false);
  });

  it('uses custom category setting when provided', () => {
    const customs = [{ name: 'MyCategory', allows_multiple: false }];
    expect(categoryAllowsMultiple('MyCategory', customs)).toBe(false);
  });

  it('defaults to true for unknown categories with no custom config', () => {
    expect(categoryAllowsMultiple('UnknownCategory')).toBe(true);
  });

  it('built-in overrides custom when names match', () => {
    // Built-in takes precedence via hasOwnProperty check
    const customs = [{ name: 'Rotationen', allows_multiple: false }];
    expect(categoryAllowsMultiple('Rotationen', customs)).toBe(
      DEFAULT_CATEGORY_ALLOWS_MULTIPLE['Rotationen']
    );
  });
});

describe('workplaceAllowsMultiple', () => {
  it('returns true for null workplace', () => {
    expect(workplaceAllowsMultiple(null)).toBe(true);
  });

  it('uses allows_multiple from workplace object when set', () => {
    expect(workplaceAllowsMultiple({ allows_multiple: false })).toBe(false);
    expect(workplaceAllowsMultiple({ allows_multiple: true })).toBe(true);
  });

  it('falls back to category when allows_multiple is undefined', () => {
    const wp = { category: 'Dienste' };
    expect(workplaceAllowsMultiple(wp)).toBe(false);
  });

  it('falls back to category when allows_multiple is null', () => {
    const wp = { category: 'Rotationen', allows_multiple: null };
    expect(workplaceAllowsMultiple(wp)).toBe(true);
  });
});
