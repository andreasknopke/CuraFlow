// Pure helpers for the row-scoped qualification filter in the scheduler.
//
// Row semantics (mirrors WorkplaceQualificationEditor state cycle):
//   - Pflicht          (is_mandatory=true,  is_excluded=false)  -> include (OR)
//   - Sollte           (is_mandatory=false, is_excluded=false)  -> include (OR)
//   - Sollte nicht     (is_mandatory=true,  is_excluded=true)   -> include (OR)
//   - Nicht           (is_mandatory=false, is_excluded=true)   -> exclude (AND-NOT)
//
// Activation: clicking the hover filter icon on a row whose workplace has
// configured qualifications builds a { includeIds, excludeIds } pair from the
// four sets above and stores it as the single active row filter. Clicking the
// same row again clears it. Activating on another row replaces it.

/**
 * Build the include/exclude sets for a workplace from the four getter functions
 * provided by useAllWorkplaceQualifications.
 *
 * @param {object} args
 * @param {string|null|undefined} args.workplaceId
 * @param {Function} args.getRequired   Pflicht  (is_mandatory=true,  is_excluded=false)
 * @param {Function} args.getOptional   Sollte   (is_mandatory=false, is_excluded=false)
 * @param {Function} args.getDiscouraged Sollte nicht (is_mandatory=true, is_excluded=true)
 * @param {Function} args.getExcluded   Nicht    (is_mandatory=false, is_excluded=true)
 * @returns {{ includeIds: string[], excludeIds: string[] }}
 */
export function buildRowQualSets({ workplaceId, getRequired, getOptional, getDiscouraged, getExcluded }) {
    if (!workplaceId) return { includeIds: [], excludeIds: [] };

    const includeIds = [
        ...new Set([
            ...(getRequired?.(workplaceId) || []),
            ...(getOptional?.(workplaceId) || []),
            ...(getDiscouraged?.(workplaceId) || []),
        ]),
    ];

    const excludeIds = [...new Set(getExcluded?.(workplaceId) || [])];

    return { includeIds, excludeIds };
}

/**
 * Test whether a doctor passes the active row filter.
 *
 * Rule:
 *   - filter is null/empty -> true (no filtering)
 *   - doctor must hold at least one include qualification (OR over includeIds)
 *   - doctor must NOT hold any exclude qualification (AND-NOT over excludeIds)
 *
 * @param {object|null|undefined} filter  { includeIds, excludeIds }
 * @param {string[]} doctorQualIds
 * @returns {boolean}
 */
export function matchesRowQualFilter(filter, doctorQualIds) {
    if (!filter) return true;
    const ids = doctorQualIds || [];
    const include = filter.includeIds || [];
    const exclude = filter.excludeIds || [];

    if (include.length === 0 && exclude.length === 0) return true;

    if (include.length > 0 && !include.some((qid) => ids.includes(qid))) {
        return false;
    }

    if (exclude.length > 0 && exclude.some((qid) => ids.includes(qid))) {
        return false;
    }

    return true;
}

/**
 * Compute the unique key for a row given its name and optional timeslot id.
 * Used to detect "click the same row again -> deactivate".
 */
export function rowKey(rowName, rowTimeslotId) {
    return rowTimeslotId ? `${rowName}__${rowTimeslotId}` : rowName;
}
