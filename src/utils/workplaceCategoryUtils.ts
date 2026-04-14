export const DEFAULT_CATEGORY_ALLOWS_MULTIPLE: Record<string, boolean> = {
  Rotationen: true,
  Dienste: false,
  'Demonstrationen & Konsile': false,
};

export interface WorkplaceCategory {
  name: string;
  allows_multiple?: boolean;
  [key: string]: unknown;
}

interface SystemSetting {
  key: string;
  value?: string;
}

interface WorkplaceLike {
  category?: string;
  allows_multiple?: boolean | null;
}

export function parseWorkplaceCategories(rawValue: string | null | undefined): WorkplaceCategory[] {
  if (!rawValue) return [];

  try {
    const parsed = JSON.parse(rawValue);
    if (!Array.isArray(parsed)) return [];

    return parsed
      .map((category: unknown): WorkplaceCategory | null => {
        if (typeof category === 'string') {
          const name = category.trim();
          return name ? { name, allows_multiple: true } : null;
        }

        if (category && typeof category === 'object' && 'name' in category) {
          const cat = category as Record<string, unknown>;
          if (typeof cat.name === 'string') {
            const name = cat.name.trim();
            if (!name) return null;
            return { ...cat, name } as WorkplaceCategory;
          }
        }

        return null;
      })
      .filter((c): c is WorkplaceCategory => c !== null);
  } catch {
    return [];
  }
}

export function getWorkplaceCategoriesFromSettings(
  systemSettings: SystemSetting[] = [],
): WorkplaceCategory[] {
  const setting = systemSettings.find((entry) => entry.key === 'workplace_categories');
  return parseWorkplaceCategories(setting?.value);
}

export function getWorkplaceCategoryNames(systemSettings: SystemSetting[] = []): string[] {
  return getWorkplaceCategoriesFromSettings(systemSettings).map((category) => category.name);
}

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

export function workplaceAllowsMultiple(
  workplace: WorkplaceLike | null | undefined,
  customCategories: WorkplaceCategory[] = [],
): boolean {
  if (!workplace) return true;
  if (workplace.allows_multiple !== undefined && workplace.allows_multiple !== null) {
    return workplace.allows_multiple;
  }

  return categoryAllowsMultiple(workplace.category || '', customCategories);
}
