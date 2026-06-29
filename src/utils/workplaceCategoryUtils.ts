/**
 * CuraFlow — Workplace Category Utilities
 *
 * Parses and queries workplace categories from system settings JSON.
 * Categories determine whether a workplace allows multiple staff assignments.
 *
 * @module utils/workplaceCategoryUtils
 */

/** Raw category parsed from JSON — may be a string or an object. */
type RawCategory = string | { name?: string | null; allows_multiple?: boolean | null; [key: string]: unknown };

interface WorkplaceCategory {
  name: string;
  allows_multiple?: boolean | null;
  [key: string]: unknown;
}

interface WorkplaceLike {
  allows_multiple?: boolean | null;
  category?: string | null;
}

interface SystemSetting {
  key: string;
  value?: string | null;
}

/**
 * Default `allows_multiple` values for the three built-in workplace categories.
 * Custom categories default to `true` unless explicitly set.
 */
export const DEFAULT_CATEGORY_ALLOWS_MULTIPLE: Record<string, boolean> = {
  Rotationen: true,
  Dienste: false,
  'Demonstrationen & Konsile': false,
};

/**
 * Parses a JSON string of workplace categories into structured objects.
 * Handles both legacy string-only format and modern object format.
 */
export function parseWorkplaceCategories(rawValue: string | null | undefined): WorkplaceCategory[] {
  if (!rawValue) return [];

  try {
    const parsed: unknown = JSON.parse(rawValue);
    if (!Array.isArray(parsed)) return [];

    return (parsed as RawCategory[])
      .map((category): WorkplaceCategory | null => {
        // Legacy: plain string
        if (typeof category === 'string') {
          const name = category.trim();
          return name ? { name, allows_multiple: true } : null;
        }

        // Modern: object with name property
        if (category && typeof (category as WorkplaceCategory).name === 'string') {
          const name = (category as WorkplaceCategory).name.trim();
          if (!name) return null;

          return {
            ...(category as WorkplaceCategory),
            name,
          };
        }

        return null;
      })
      .filter((c): c is WorkplaceCategory => c !== null);
  } catch {
    return [];
  }
}

/** Extracts workplace categories from the system_settings array. */
export function getWorkplaceCategoriesFromSettings(
  systemSettings: SystemSetting[] = [],
): WorkplaceCategory[] {
  const setting = systemSettings.find((entry) => entry.key === 'workplace_categories');
  return parseWorkplaceCategories(setting?.value);
}

/** Returns just the category name strings. */
export function getWorkplaceCategoryNames(systemSettings: SystemSetting[] = []): string[] {
  return getWorkplaceCategoriesFromSettings(systemSettings).map((category) => category.name);
}

/**
 * Returns whether the given category allows multiple staff assignments.
 * Checks defaults first, then custom categories.
 */
export function categoryAllowsMultiple(
  categoryName: string,
  customCategories: WorkplaceCategory[] = [],
): boolean {
  if (Object.prototype.hasOwnProperty.call(DEFAULT_CATEGORY_ALLOWS_MULTIPLE, categoryName)) {
    return DEFAULT_CATEGORY_ALLOWS_MULTIPLE[categoryName];
  }

  const customCategory = customCategories.find((category) => category.name === categoryName);
  return customCategory?.allows_multiple ?? true;
}

/**
 * Returns whether a specific workplace allows multiple assignments.
 * Checks the workplace's own setting first, then falls back to its category.
 */
export function workplaceAllowsMultiple(
  workplace: WorkplaceLike | null | undefined,
  customCategories: WorkplaceCategory[] = [],
): boolean {
  if (!workplace) return true;
  if (workplace.allows_multiple !== undefined && workplace.allows_multiple !== null) {
    return workplace.allows_multiple;
  }

  return categoryAllowsMultiple(workplace.category ?? '', customCategories);
}
