/**
 * Pure (no-Express, no DB-pool singleton) helpers for the year-specific
 * shift-/Sonderurlaubs-Anspruch.
 *
 * Lives in `utils/` so vitest can target it without booting auth.js /
 * index.js. The routes in `routes/vacation.js` are thin wrappers.
 *
 * Storage: master-DB table `EmployeeVacationYear(employee_id, year)`:
 *   - shift_vacation_days       INT NOT NULL DEFAULT 0
 *   - carried_over              BOOLEAN NOT NULL DEFAULT FALSE
 *   - carried_over_from_year    INT DEFAULT NULL
 *   - expires_at                DATE DEFAULT NULL
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

import type { Pool, RowDataPacket } from 'mysql2/promise';

interface EmployeeVacationYearRow extends RowDataPacket {
  shift_vacation_days: number | string | null;
  carried_over: number | boolean | null;
  carried_over_from_year: number | string | null;
  expires_at: Date | string | null;
  note: string | null;
}

interface EmployeeRow extends RowDataPacket {
  vacation_days_annual: number | string | null;
}

interface CentralAbsenceRow extends RowDataPacket {
  date: Date | string;
}

interface ShiftVacationEntitlement {
  shift_vacation_days: number;
  carried_over: boolean;
  carried_over_from_year: number | null;
  expires_at: string | null;
  note: string | null;
}

interface ShiftVacationRemaining {
  shift_vacation_total: number;
  shift_vacation_taken: number;
  shift_vacation_planned: number;
  remaining_shift_vacation: number;
}

interface SetEntitlementPayload {
  shift_vacation_days: number | string;
  carried_over?: boolean | number | string;
  carried_over_from_year?: number | string | null;
  expires_at?: string | Date | null;
  note?: string | null;
  updatedBy?: string | null;
}

interface CarryOverSuccess {
  carried_days: number;
  fromYear: number;
  toYear: number;
}

interface CarryOverError {
  error: string;
}

function toDateString(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === 'string') return value.slice(0, 10);
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function formatYmd(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function getErrorCode(e: unknown): string | undefined {
  if (typeof e === 'object' && e !== null && 'code' in e) {
    const code = (e as { code?: unknown }).code;
    if (typeof code === 'string') return code;
  }
  return undefined;
}

function getErrorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function isMissingTableError(e: unknown): boolean {
  const code = getErrorCode(e);
  return code === 'ER_NO_SUCH_TABLE' || /Unknown table/i.test(getErrorMessage(e));
}

function isCountableDay(dateStr: string, holidaySet: Set<string>): boolean {
  const d = new Date(`${dateStr}T12:00:00`);
  if (Number.isNaN(d.getTime())) return false;
  const day = d.getDay();
  if (day === 0 || day === 6) return false;
  if (holidaySet.has(dateStr)) return false;
  return true;
}

/**
 * Read the year-specific row for a central employee. Always returns a
 * well-shaped object; missing rows resolve to the `0` default.
 */
export async function getShiftVacationEntitlement(
  masterDb: Pool,
  employeeId: string | null | undefined,
  year: number
): Promise<ShiftVacationEntitlement> {
  const fallback: ShiftVacationEntitlement = {
    shift_vacation_days: 0,
    carried_over: false,
    carried_over_from_year: null,
    expires_at: null,
    note: null,
  };
  if (!employeeId || !Number.isFinite(year)) return fallback;
  try {
    const [rows] = await masterDb.execute<EmployeeVacationYearRow[]>(
      `SELECT shift_vacation_days, carried_over, carried_over_from_year, expires_at, note
         FROM EmployeeVacationYear
        WHERE employee_id = ? AND year = ?
        LIMIT 1`,
      [employeeId, year]
    );
    if (rows.length === 0) return fallback;

    const row: ShiftVacationEntitlement = {
      shift_vacation_days: Number(rows[0].shift_vacation_days) || 0,
      carried_over: Boolean(rows[0].carried_over),
      carried_over_from_year: rows[0].carried_over_from_year != null
        ? Number(rows[0].carried_over_from_year)
        : null,
      expires_at: rows[0].expires_at ? toDateString(
        rows[0].expires_at instanceof Date ? rows[0].expires_at : new Date(rows[0].expires_at)
      ) : null,
      note: rows[0].note ?? null,
    };

    // Dynamic carry adjustment: if this row was created by a carry-over,
    // the effective value is the current remaining of the source year,
    // because booking more Schichturlaub in the source year should
    // correspondingly reduce the carry-over to prevent double-counting.
    if (row.carried_over && row.carried_over_from_year != null) {
      let adjusted = await _adjustCarryFromSource(masterDb, employeeId, year, row);
      // Expiry check for carried-over rows — after dynamic adjustment
      if (row.expires_at && formatYmd(new Date()) > row.expires_at) {
        adjusted = { ...adjusted, shift_vacation_days: 0 };
      }
      return adjusted;
    }

    // Expiry check: if expires_at is in the past, the entitlement is 0.
    if (row.expires_at) {
      const todayStr = formatYmd(new Date());
      if (todayStr > row.expires_at) {
        return {
          ...row,
          shift_vacation_days: 0,
        };
      }
    }

    return row;
  } catch (e) {
    // Missing table is okay (migration not applied yet) — return default
    // so the API stays available. Any other error surfaces in the log.
    if (!isMissingTableError(e)) {
      console.warn(`[shiftVacationEntitlement] get failed for ${employeeId}/${year}: ${getErrorMessage(e)}`);
    }
    return fallback;
  }
}

/**
 * Re-compute the effective carry for a `year` whose row has
 * `carried_over = true`. The effective value is the *current* remaining
 * balance of the source year (clamped to `[0, originalCarry]`).
 *
 * Also applies the expiry rule: if the carried-over row has `expires_at`
 * set and today is past it, the effective days become 0.
 *
 * Persists any change so the frontend always sees the corrected value
 * on subsequent reads.
 */
async function _adjustCarryFromSource(
  masterDb: Pool,
  employeeId: string,
  targetYear: number,
  row: ShiftVacationEntitlement
): Promise<ShiftVacationEntitlement> {
  const sourceYear = row.carried_over_from_year;
  // Guard: a carry always goes forward (source < target). If the stored
  // data violates this, don't adjust — it's either a degenerate test
  // fixture or a legacy row that shouldn't cascade further.
  if (sourceYear == null || sourceYear >= targetYear) return row;

  // Expired carry → effectively 0
  const todayStr = formatYmd(new Date());
  if (row.expires_at && todayStr > row.expires_at) {
    return { ...row, shift_vacation_days: 0 };
  }

  const originalCarry = row.shift_vacation_days; // what was stored at carry time
  const sourceRemaining = await computeShiftVacationRemaining(masterDb, employeeId, sourceYear);

  // Effective carry = what the source year currently has left, but never
  // more than what was originally carried (prevents re-growth).
  const effectiveDays = Math.max(0, Math.min(
    sourceRemaining.remaining_shift_vacation,
    originalCarry
  ));

  if (effectiveDays === originalCarry) {
    return row; // no change needed
  }

  // Persist the adjusted value so subsequent reads and the frontend API
  // are always consistent. We use a targeted UPDATE instead of
  // `setShiftVacationEntitlement` so we don't clobber `note`/`updated_by`.
  try {
    await masterDb.execute(
      `UPDATE EmployeeVacationYear
          SET shift_vacation_days = ?
        WHERE employee_id = ? AND year = ?`,
      [effectiveDays, employeeId, targetYear]
    );
  } catch (e) {
    console.warn(`[shiftVacationEntitlement] carry-adjust persist failed: ${getErrorMessage(e)}`);
  }

  return {
    shift_vacation_days: effectiveDays,
    carried_over: true,
    carried_over_from_year: sourceYear,
    expires_at: row.expires_at ?? null,
    note: row.note,
  };
}

/**
 * Persist the row for `(employeeId, year)`. Creates the row via
 * INSERT ... ON DUPLICATE KEY UPDATE so both first-write and edit work,
 * and never touches `id`/`created_*`, only `updated_*`.
 */
export async function setShiftVacationEntitlement(
  masterDb: Pool,
  employeeId: string,
  year: number,
  payload: SetEntitlementPayload
): Promise<ShiftVacationEntitlement> {
  const days = Number(payload.shift_vacation_days);
  if (!Number.isFinite(days) || days < 0 || !Number.isInteger(days)) {
    throw new Error('shift_vacation_days muss eine nicht-negative Ganzzahl sein.');
  }
  const carriedOver = payload.carried_over ? 1 : 0;
  const carriedOverFromYear = Number.isFinite(payload.carried_over_from_year)
    ? Number(payload.carried_over_from_year)
    : null;
  const expiresAt = payload.expires_at ? toDateString(payload.expires_at) : null;
  const note = payload.note ?? null;
  const updatedBy = payload.updatedBy ?? null;

  await masterDb.execute(
    `INSERT INTO EmployeeVacationYear
        (employee_id, year, shift_vacation_days, carried_over, carried_over_from_year, expires_at, note, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
        shift_vacation_days   = VALUES(shift_vacation_days),
        carried_over          = VALUES(carried_over),
        carried_over_from_year = VALUES(carried_over_from_year),
        expires_at            = VALUES(expires_at),
        note                  = VALUES(note),
        updated_by            = VALUES(updated_by)`,
    [employeeId, year, days, carriedOver, carriedOverFromYear, expiresAt, note, updatedBy]
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
 */
export async function computeShiftVacationRemaining(
  masterDb: Pool,
  employeeId: string,
  year: number,
  options: { publicHolidayDates?: Set<string> | string[]; today?: string } = {}
): Promise<ShiftVacationRemaining> {
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
    const [rows] = await masterDb.execute<CentralAbsenceRow[]>(
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
      console.warn(`[shiftVacationEntitlement] compute failed for ${employeeId}/${year}: ${getErrorMessage(e)}`);
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
 */
export async function carryOverShiftVacation(
  masterDb: Pool,
  employeeId: string,
  opts: { fromYear: number; toYear: number; updatedBy?: string | null; publicHolidayDates?: Set<string> | string[] }
): Promise<CarryOverSuccess | CarryOverError> {
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
    expires_at: `${toYear}-03-31`,
    note: `Übertrag aus ${fromYear}: ${carriedDays} Tag(e) Schichturlaub`,
    updatedBy,
  });

  return { carried_days: carriedDays, fromYear, toYear };
}

// Re-exported for unit tests so they don't need to construct a fresh id.
export const __test__ = { isMissingTableError, isCountableDay, formatYmd };
