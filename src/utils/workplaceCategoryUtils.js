export const DEFAULT_CATEGORY_ALLOWS_MULTIPLE = {
    'Rotationen': true,
    'Dienste': false,
    'Demonstrationen & Konsile': false,
};

export function parseWorkplaceCategories(rawValue) {
    if (!rawValue) return [];

    try {
        const parsed = JSON.parse(rawValue);
        if (!Array.isArray(parsed)) return [];

        return parsed
            .map((category) => {
                if (typeof category === 'string') {
                    const name = category.trim();
                    return name ? { name, allows_multiple: true } : null;
                }

                if (category && typeof category.name === 'string') {
                    const name = category.name.trim();
                    if (!name) return null;

                    return {
                        ...category,
                        name,
                    };
                }

                return null;
            })
            .filter(Boolean);
    } catch {
        return [];
    }
}

export function getWorkplaceCategoriesFromSettings(systemSettings = []) {
    const setting = systemSettings.find((entry) => entry.key === 'workplace_categories');
    return parseWorkplaceCategories(setting?.value);
}

export function getWorkplaceCategoryNames(systemSettings = []) {
    return getWorkplaceCategoriesFromSettings(systemSettings).map((category) => category.name);
}

export function categoryAllowsMultiple(categoryName, customCategories = []) {
    if (Object.prototype.hasOwnProperty.call(DEFAULT_CATEGORY_ALLOWS_MULTIPLE, categoryName)) {
        return DEFAULT_CATEGORY_ALLOWS_MULTIPLE[categoryName];
    }

    const customCategory = customCategories.find((category) => category.name === categoryName);
    return customCategory?.allows_multiple ?? true;
}

export function workplaceAllowsMultiple(workplace, customCategories = []) {
    if (!workplace) return true;
    if (workplace.allows_multiple !== undefined && workplace.allows_multiple !== null) {
        return workplace.allows_multiple;
    }

    return categoryAllowsMultiple(workplace.category, customCategories);
}