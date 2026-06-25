/**
 * Pure (no-Express, no DB-pool singleton) helpers for the year-specific
 * shift-/Sonderurlaubs-Anspruch.
 *
 * Lives in `utils/` so vitest can target it without booting auth.js /
 * index.js. The routes in `routes/vacation.js` are thin wrappers.
 *
 * Storage: master-DB table `EmployeeVacationYear(employee_id, year)`:
 *   - shift_vacation_days   INT NOT NULL DEFAULT 0
 *   - carried_over          BOOLEAN NOT NULL DEFAULT FALSE
 *   - carried_over_from_year INT DEFAULT NULL
 *
 * Business rules (mirrored in the frontend `vacationBalance.js` helper):
 *  - The remaining shift-vacation is `shift_vacation_days` MINUS
 *    workday Schichturlaub-entries of the same year.
 *  - Only Schichturlaub is carryable; regular Urlaub never is.
 *  - The carry target year must be `fromYear + 1`.
 *
 * The helpers all swallow errors from a missing table gracefully and
 * return safe defaults, because the detail endpoint runs even if the
 * `EmployeeVacationYear` migration hasn't been applied yet.
 */

/**
 * Read the year-specific row for a central employee. Always returns a
 * well-shaped object; missing rows resolve to the `0` default.
 *
 * @param {import('mysql2/promise').Pool} masterDb
 * @param {string} employeeId
 * @param {number} year
 * @returns {Promise<{ shift_vacation_days: number, carried_over: boolean, carried_over_from_year: number|null, note: string|null }>}
 */
export async function getShiftVacationEntitlement(masterDb, employeeId, year) {
  const fallback = {
    shift_vacation_days: 0,
    carried_over: false,
    carried_over_from_year: null,
    note: null,
  };
  if (!employeeId || !Number.isFinite(year)) return fallback;
  try {
    const [rows] = await masterDb.execute(
      `SELECT shift_vacation_days, carried_over, carried_over_from_year, note
         FROM EmployeeVacationYear
        WHERE employee_id = ? AND year = ?
        LIMIT 1`,
      [employeeId, year]
    );
    if (rows.length === 0) return fallback;
    return {
      shift_vacation_days: Number(rows[0].shift_vacation_days) || 0,
      carried_over: Boolean(rows[0].carried_over),
      carried_over_from_year: rows[0].carried_over_from_year != null
        ? Number(rows[0].carried_over_from_year)
        : null,
      note: rows[0].note ?? null,
    };
  } catch (e) {
    // Missing table is okay (migration not applied yet) — return default
    // so the API stays available. Any other error surfaces in the log.
    if (!isMissingTableError(e)) {
      console.warn(`[shiftVacationEntitlement] get failed for ${employeeId}/${year}: ${e.message}`);
    }
    return fallback;
  }
}

/**
 * Persist the row for `(employeeId, year)`. Creates the row via
 * INSERT ... ON DUPLICATE KEY UPDATE so both first-write and edit work,
 * and never touches `id`/`created_*`, only `updated_*`.
 *
 * @param {import('mysql2/promise').Pool} masterDb
 * @param {string} employeeId
 * @param {number} year
 * @param {Object} payload
 * @param {number} payload.shift_vacation_days   Non-negative integer.
 * @param {boolean} [payload.carried_over=false]
 * @param {number|null} [payload.carried_over_from_year=null]
 * @param {string|null} [payload.note=null]
 * @param {string|null} [payload.updatedBy=null]
 * @returns {Promise<Object>} the row as `getShiftVacationEntitlement` returns.
 */
export async function setShiftVacationEntitlement(masterDb, employeeId, year, payload = {}) {
  const days = Number(payload.shift_vacation_days);
  if (!Number.isFinite(days) || days < 0 || !Number.isInteger(days)) {
    throw new Error('shift_vacation_days muss eine nicht-negative Ganzzahl sein.');
  }
  const carriedOver = payload.carried_over ? 1 : 0;
  const carriedOverFromYear = Number.isFinite(payload.carried_over_from_year)
    ? Number(payload.carried_over_from_year)
    : null;
  const note = payload.note ?? null;
  const updatedBy = payload.updatedBy ?? null;

  await masterDb.execute(
    `INSERT INTO EmployeeVacationYear
        (employee_id, year, shift_vacation_days, carried_over, carried_over_from_year, note, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
        shift_vacation_days   = VALUES(shift_vacation_days),
        carried_over          = VALUES(carried_over),
        carried_over_from_year = VALUES(carried_over_from_year),
        note                  = VALUES(note),
        updated_by            = VALUES(updated_by)`,
    [employeeId, year, days, carriedOver, carriedOverFromYear, note, updatedBy]
  );

  return getShiftVacationEntitlement(masterDb, employeeId, year);
}

/**
 * Compute the remaining shift-vacation days for a `(employeeId, year)`
 * combination so the carry-over endpoint knows how much to transfer.
 *
 * Re-uses the same workday rule as the frontend helper: weekends and
 * public holidays don't consume Schichturlaub, taken = date <= today,
 * planned = date > today. We keep it here server-side so the persist
 * step doesn't depend on client math.
 *
 * @param {import('mysql2/promise').Pool} masterDb
 * @param {string} employeeId
 * @param {number} year
 * @param {Object} [options]
 * @param {Set<string>} [options.publicHolidayDates]  `yyyy-MM-dd` set.
 * @param {string} [options.today]                     `yyyy-MM-dd`, defaults to today.
 * @returns {Promise<{ shift_vacation_total: number, shift_vacation_taken: number, shift_vacation_planned: number, remaining_shift_vacation: number }>}
 */
export async function computeShiftVacationRemaining(masterDb, employeeId, year, options = {}) {
  const entitlement = await getShiftVacationEntitlement(masterDb, employeeId, year);
  const total = Number(entitlement.shift_vacation_days) || 0;
  const holidaySet = options.publicHolidayDates instanceof Set
    ? options.publicHolidayDates
    : new Set(
        Array.isArray(options.publicHolidayDates) ? options.publicHolidayDates : []
      );
  const today = options.today || formatYmd(new Date());

  let taken = 0;
  let planned = 0;
  try {
    const [rows] = await masterDb.execute(
      `SELECT date FROM CentralAbsenceEntry
        WHERE employee_id = ?
          AND YEAR(date) = ?
          AND position = 'Schichturlaub'`,
      [employeeId, year]
    );
    for (const r of rows) {
      const dateStr = r.date instanceof Date ? formatYmd(r.date) : String(r.date).slice(0, 10);
      if (!isCountableDay(dateStr, holidaySet)) continue;
      if (dateStr <= today) taken += 1;
      else planned += 1;
    }
  } catch (e) {
    if (!isMissingTableError(e)) {
      console.warn(`[shiftVacationEntitlement] compute failed for ${employeeId}/${year}: ${e.message}`);
    }
  }

  return {
    shift_vacation_total: total,
    shift_vacation_taken: taken,
    shift_vacation_planned: planned,
    remaining_shift_vacation: total - taken - planned,
  };
}

/**
 * Carry the remaining shift-vacation of `fromYear` over to `toYear`.
 *
 *  Returns `{ error }` for all business-rule violations — the route maps
 *  them to HTTP 422. The caller never has to `throw` to distinguish
 *  validation from infra failures.
 *
 * Rules:
 *  - `toYear` must equal `fromYear + 1`.
 *  - The target year row must not already be `carried_over`
 *    (prevents re-carrying on top of an older carry).
 *  - The remainder must be positive (≤ 0 = nothing to do).
 *
 * @param {import('mysql2/promise').Pool} masterDb
 * @param {string} employeeId
 * @param {Object} opts
 * @param {number} opts.fromYear
 * @param {number} opts.toYear
 * @param {string|null} [opts.updatedBy]
 * @param {Set<string>} [opts.publicHolidayDates]
 * @returns {Promise<Object>} on success: `{ carried_days, fromYear, toYear }`
 *                            on rule violation: `{ error }`.
 */
export async function carryOverShiftVacation(masterDb, employeeId, opts) {
  const { fromYear, toYear, updatedBy = null } = opts ?? {};
  if (!Number.isFinite(fromYear) || !Number.isFinite(toYear)) {
    return { error: 'fromYear/toYear fehlen.' };
  }
  if (toYear !== fromYear + 1) {
    return { error: 'Übertrag ist nur in das unmittelbare Folgejahr erlaubt.' };
  }

  const target = await getShiftVacationEntitlement(masterDb, employeeId, toYear);
  if (target.carried_over) {
    return { error: 'Das Zieljahr wurde bereits aus dem Vorjahr übertragen.' };
  }

  const remaining = await computeShiftVacationRemaining(masterDb, employeeId, fromYear, {
    publicHolidayDates: opts.publicHolidayDates,
  });
  const carriedDays = Math.max(0, remaining.remaining_shift_vacation);
  if (carriedDays <= 0) {
    return { error: 'Es ist kein Resturlaub (Schichturlaub) zum Übertragen vorhanden.' };
  }

  await setShiftVacationEntitlement(masterDb, employeeId, toYear, {
    shift_vacation_days: carriedDays,
    carried_over: true,
    carried_over_from_year: fromYear,
    note: `Übertrag aus ${fromYear}: ${carriedDays} Tag(e) Schichturlaub`,
    updatedBy,
  });

  return { carried_days: carriedDays, fromYear, toYear };
}

// ---------------------------------------------------------------------------
// Internal helpers (kept private — exported only for unit tests via the
// named exports below).
// ---------------------------------------------------------------------------

function isMissingTableError(e) {
  return e && (e.code === 'ER_NO_SUCH_TABLE' || /Unknown table/i.test(e.message || ''));
}

function isCountableDay(dateStr, holidaySet) {
  const d = new Date(`${dateStr}T12:00:00`);
  if (Number.isNaN(d.getTime())) return false;
  const day = d.getDay();
  if (day === 0 || day === 6) return false;
  if (holidaySet.has(dateStr)) return false;
  return true;
}

function formatYmd(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// Re-exported for unit tests so they don't need to construct a fresh id.
export const __test__ = { isMissingTableError, isCountableDay, formatYmd };
