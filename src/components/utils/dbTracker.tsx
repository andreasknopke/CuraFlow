let _pendingCount = 0;
let _debounceTimeout = null;

// In MySQL mode, automatic backup integration is not used.
// trackDbChange is kept as a no-op to avoid breaking callers.
export const trackDbChange = (_count = 1) => {
  // No-op: change tracking is not wired to a backup service in MySQL mode.
};
