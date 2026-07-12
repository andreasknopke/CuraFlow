export function resolveWishDefaultPosition(
    serviceTypes: string[] = [],
    preferredPosition?: string,
): string | null {
    if (!Array.isArray(serviceTypes) || serviceTypes.length === 0) {
        return null;
    }

    if (preferredPosition && serviceTypes.includes(preferredPosition)) {
        return preferredPosition;
    }

    return serviceTypes[0];
}
