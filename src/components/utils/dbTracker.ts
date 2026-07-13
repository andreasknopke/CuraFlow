

const _pendingCount: number = 0;
const _debounceTimeout: ReturnType<typeof setTimeout> | null = null;

// In MySQL mode, auto-backup via base44 is not used.
// trackDbChange is kept as a no-op to avoid breaking callers.
export const trackDbChange = (_count: number = 1): void => {
    // No-op: MySQL mode doesn't use base44 adminTools for change tracking
};

