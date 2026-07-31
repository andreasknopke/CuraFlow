/**
 * SQL value marshaling helpers (JS ⇄ MySQL row conversion).
 *
 * Phase 2, PR 2.0 extracted these from `dbProxy.js` and `atomic.js`, which each
 * had their own copy with subtly different behavior. Both variants are
 * preserved VERBATIM here — they are NOT unified, because the differences are
 * load-bearing:
 *
 *   - `toSqlValue` (dbProxy variant) collapses `'' → null` (important for date
 *     fields). `toSqlValueStrict` (atomic variant) keeps `''` as `''`.
 *   - `fromSqlRow` (dbProxy variant) parses the `active_days` JSON field and
 *     coerces 19 boolean fields. `fromSqlRowBasic` (atomic variant) does no
 *     JSON parsing and coerces only 9 boolean fields (a strict subset).
 *
 * Unifying these would regress one caller or the other. Each caller imports the
 * variant that matches its historical behavior. (Phase 3 / per-entity repos may
 * revisit which variant each entity actually needs.)
 */

// ─── dbProxy variant ────────────────────────────────────────────────────────

/**
 * Convert a JS value to a MySQL value (dbProxy variant).
 * Empty strings become NULL (important for date fields).
 * @param {*} val
 * @returns {*}
 */
export const toSqlValue = (val) => {
  if (val === undefined) return null;
  if (val === '') return null; // Empty strings become NULL (important for date fields)
  if (typeof val === 'number' && isNaN(val)) return null;
  if (typeof val === 'object' && val !== null && !(val instanceof Date)) {
    return JSON.stringify(val);
  }
  if (val instanceof Date) {
    return val.toISOString().slice(0, 19).replace('T', ' ');
  }
  return val;
};

/**
 * Parse a MySQL row to a JS object (dbProxy variant).
 * Parses the `active_days` JSON field and coerces 19 boolean fields.
 * @param {Record<string, *>|null} row
 * @returns {Record<string, *>|null}
 */
export const fromSqlRow = (row) => {
  if (!row) return null;
  const res = { ...row };

  const jsonFields = ['active_days'];

  for (const key in res) {
    if (jsonFields.includes(key) && typeof res[key] === 'string') {
      try {
        res[key] = JSON.parse(res[key]);
      } catch (e) {}
    }

    const boolFields = [
      'receive_email_notifications', 'exclude_from_staffing_plan',
      'user_viewed', 'auto_off', 'show_in_service_plan',
      'allows_rotation_concurrently', 'allows_absence_overlap',
      'allows_multiple',
      'acknowledged', 'is_active', 'is_specialist',
      'timeslots_enabled', 'spans_midnight', 'affects_availability',
      'can_do_foreground_duty', 'can_do_background_duty', 'excluded_from_statistics',
      'is_mandatory', 'requires_certificate'
    ];
    if (boolFields.includes(key)) {
      res[key] = !!res[key];
    }
  }
  return res;
};

// ─── atomic variant ─────────────────────────────────────────────────────────

/**
 * Convert a JS value to a MySQL value (atomic variant).
 * Does NOT collapse empty strings to NULL.
 * @param {*} val
 * @returns {*}
 */
export const toSqlValueStrict = (val) => {
  if (val === undefined) return null;
  if (typeof val === 'number' && isNaN(val)) return null;
  if (typeof val === 'object' && val !== null && !(val instanceof Date)) {
    return JSON.stringify(val);
  }
  if (val instanceof Date) {
    return val.toISOString().slice(0, 19).replace('T', ' ');
  }
  return val;
};

/**
 * Parse a MySQL row to a JS object (atomic variant).
 * No JSON parsing; coerces only 9 boolean fields (a strict subset of the
 * dbProxy variant's list).
 * @param {Record<string, *>|null} row
 * @returns {Record<string, *>|null}
 */
export const fromSqlRowBasic = (row) => {
  if (!row) return null;
  const res = { ...row };
  const boolFields = [
    'receive_email_notifications', 'exclude_from_staffing_plan',
    'user_viewed', 'auto_off', 'show_in_service_plan',
    'allows_rotation_concurrently', 'allows_absence_overlap',
    'acknowledged', 'is_active'
  ];
  for (const key in res) {
    if (boolFields.includes(key)) res[key] = !!res[key];
  }
  return res;
};
