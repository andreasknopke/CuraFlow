export function resolveWishDefaultPosition(serviceTypes = [], preferredPosition) {
    if (!Array.isArray(serviceTypes) || serviceTypes.length === 0) {
        return null;
    }

    if (preferredPosition && serviceTypes.includes(preferredPosition)) {
        return preferredPosition;
    }

    return serviceTypes[0];
}