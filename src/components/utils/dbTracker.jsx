

let _pendingCount = 0;
let _debounceTimeout = null;

// In MySQL mode, auto-backup via base44 is not used.
// trackDbChange is kept as a no-op to avoid breaking callers.
export const trackDbChange = (_count = 1) => {
    // No-op: MySQL mode doesn't use base44 adminTools for change tracking
};

