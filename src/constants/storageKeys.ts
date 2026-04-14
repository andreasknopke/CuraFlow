// ---------------------------------------------------------------------------
// Centralised localStorage / IndexedDB key constants.
// Import from here instead of defining local string literals.
// ---------------------------------------------------------------------------

/** JWT authentication token */
export const JWT_TOKEN_KEY = 'radioplan_jwt_token';

/** JWT refresh token */
export const JWT_REFRESH_TOKEN_KEY = 'radioplan_jwt_refresh_token';

/** Encrypted DB credentials blob */
export const DB_CREDENTIALS_KEY = 'db_credentials';

/** Whether DB-token mode is active ('true' / 'false') */
export const DB_TOKEN_ENABLED_KEY = 'db_token_enabled';

/** Saved DB token list (JSON array) */
export const SAVED_DB_TOKENS_KEY = 'saved_db_tokens';

/** Currently active tenant token id */
export const ACTIVE_TOKEN_ID_KEY = 'active_token_id';

// ── Schedule board UI preferences ──────────────────────────────────────────
export const SORT_DOCTORS_ALPHA_KEY = 'radioplan_sortDoctorsAlphabetically';
export const SHOW_SIDEBAR_KEY = 'radioplan_showSidebar';
export const HIDDEN_ROWS_KEY = 'radioplan_hiddenRows';
export const COLLAPSED_SECTIONS_KEY = 'radioplan_collapsedSections';
export const HIGHLIGHT_MY_NAME_KEY = 'radioplan_highlightMyName';
export const SHOW_INITIALS_ONLY_KEY = 'radioplan_showInitialsOnly';
export const GRID_FONT_SIZE_KEY = 'radioplan_gridFontSize';
export const COLLAPSED_TIMESLOT_GROUPS_KEY = 'radioplan_collapsedTimeslotGroups';
