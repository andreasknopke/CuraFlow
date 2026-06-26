/**
 * Vacation balance calculator (pure, side-effect free).
 *
 * Mirrors the aggregation logic used by the master backend in
 * `server/routes/master.js` (aggregateVacationAcrossTenants) so that
 * tenant-frontend and master-frontend never disagree on what counts as
 * "vacation taken" vs "vacation planned".
 *
 * Rules (kept in sync with the master implementation):
 *  - Only entries with the given position count (default 'Urlaub').
 *    The same helper is reused for 'Schichturlaub' by passing
 *    `{ position: 'Schichturlaub' }`, so shift-/Sonderurlaub gets its
 *    own balance with identical counting rules.
 *  - Weekends (Sat/Sun) do not consume vacation.
 *  - Public holidays do not consume vacation.
 *  - A date on or before `today` is "taken", a date after is "planned".
 *  - The candidate date (the shift the user is currently planning) is
 *    optionally added on top so the UI can show the live over/undershoot
 *    while the user is dragging a range.
 *
 * @typedef {Object} VacationBalance
 * @property {number} total         Annual vacation entitlement (days).
 * @property {number} taken         Vacation days already consumed (past).
 * @property {number} planned       Vacation days scheduled in the future.
 * @property {number} remaining     total - taken - planned (may be negative).
 * @property {boolean} overshoot    true iff remaining < 0.
 *
 * @param {Object} options
 * @param {Array<{date: string, position: string}>} options.shifts
 *        All shifts for the employee (any positions; only the target
 *        position counts).
 * @param {number|string} options.year
 *        The year to consider (e.g. 2026).
 * @param {number|null|undefined} options.annualVacationDays
 *        Annual entitlement, e.g. from `doctor.vacation_days`. Falsy/null
 *        values fall back to 30 to match the master backend default.
 *        For Schichturlaub pass `0` explicitly — most years carry no
 *        Schichturlaub at all, so the implicit 30 fallback must not apply.
 * @param {string} [options.position='Urlaub']
 *        Which position string to count. Defaults to 'Urlaub'. Pass
 *        'Schichturlaub' to compute the separate shift-vacation balance.
 * @param {Set<string>|Array<string>} [options.publicHolidayDates]
 *        Set or array of `yyyy-MM-dd` strings. Anything not provided is
 *        treated as "no public holiday information available".
 * @param {Date|string} [options.today]
 *        Override for "now" (useful for tests). Defaults to `new Date()`.
 * @param {string} [options.candidateDate]
 *        Optional `yyyy-MM-dd` for a date the user is currently planning.
 *        When provided it is counted as a planned vacation day regardless
 *        of whether it is in the past — it represents "the action in
 *        progress" so the UI can flag overshoot before save.
 * @returns {VacationBalance}
 */
export function computeVacationBalance({
  shifts = [],
  year,
  annualVacationDays,
  position = 'Urlaub',
  publicHolidayDates,
  today,
  candidateDate,
} = {}) {
  const total = parseAnnualVacationDays(annualVacationDays);

  const holidaySet = publicHolidayDates instanceof Set
    ? publicHolidayDates
    : new Set(Array.isArray(publicHolidayDates) ? publicHolidayDates : []);

  const todayDate = today instanceof Date ? today : new Date(today || Date.now());
  const todayStr = formatYmd(todayDate);

  let taken = 0;
  let planned = 0;

  for (const shift of shifts) {
    if (!shift || shift.position !== position) continue;
    const dateStr = extractYmd(shift.date);
    if (!dateStr) continue;
    if (Number(dateStr.slice(0, 4)) !== Number(year)) continue;
    if (!isCountableVacationDay(dateStr, holidaySet)) continue;

    if (dateStr <= todayStr) taken += 1;
    else planned += 1;
  }

  // Add the in-progress candidate date (does not need to be in the shifts
  // list yet — e.g. the user is dragging out a range).
  if (candidateDate) {
    const dateStr = extractYmd(candidateDate);
    if (
      dateStr
      && Number(dateStr.slice(0, 4)) === Number(year)
      && isCountableVacationDay(dateStr, holidaySet)
    ) {
      // In-progress dates count as "planned" for the overshoot warning —
      // the user is committing to them, regardless of past/future.
      planned += 1;
    }
  }

  const remaining = total - taken - planned;
  return {
    total,
    taken,
    planned,
    remaining,
    overshoot: remaining < 0,
  };
}

/**
 * Extracts `yyyy-MM-dd` from a `Date` or from a string already in that
 * format. Returns null when the input is unusable.
 */
function extractYmd(value) {
  if (value == null) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return formatYmd(value);
  }
  if (typeof value === 'string') {
    if (/^\d{4}-\d{2}-\d{2}/.test(value)) {
      return value.slice(0, 10);
    }
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return null;
    return formatYmd(parsed);
  }
  return null;
}

function formatYmd(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Parses the annual vacation entitlement. Distinguishes "no value
 * provided" (null/undefined/empty string/non-numeric → fallback 30) from
 * "explicitly zero" (legitimate, e.g. for a Praktikant).
 *
 * Exported so the multi-doctor `VacationOverview` can show the entitlement
 * next to the planned+taken count without re-implementing the fallback.
 */
export function parseAnnualVacationDays(value) {
  if (value === null || value === undefined || value === '') return 30;
  const n = Number(value);
  if (!Number.isFinite(n)) return 30;
  return n;
}

/**
 * Decision helper for the "auto-shift-vacation fallback" rule.
 *
 * Background: when a planner books 'Urlaub' beyond the regular annual
 * quota, the system should silently consume any available Schichturlaub
 * days (year-specific bonus entitlement) for the over-quota days before
 * letting the regular vacation balance go negative. Only when Schichturlaub
 * is also exhausted is the regular vacation allowed to go into overshoot.
 *
 * **Q1-Verbrauchsregel für übertragenen Schichturlaub:**
 * Wenn der Schichturlaub aus dem Vorjahr übertragen wurde (`carried_over`)
 * und am 31.03. verfällt, muss er in den ersten drei Monaten (Jan–Mär)
 * zuerst verbraucht werden – noch vor dem regulären Urlaub. Dazu wird
 * der Parameter `consumeShiftVacationFirstInQ1` auf `true` gesetzt.
 * Für Tage außerhalb des Q1 oder ohne Carry-Over gilt die Standard-
 * Logik (regulärer Urlaub zuerst).
 *
 * This helper is PURE: given the current vacation balances and a list of
 * new vacation days to be booked, it returns the position ('Urlaub' or
 * 'Schichturlaub') that each new day should be saved as. The caller
 * (Vacation.jsx) uses the result to set `position` on the ShiftEntry it
 * creates.
 *
 * Algorithm:
 *  1. Days are processed chronologically (earliest first) so the
 *     "fallback kicks in" order is stable and matches planner intuition.
 *  2. **Standard (außerhalb Q1 oder ohne Carry-Over):** regulärer Urlaub
 *     wird zuerst verbraucht, dann Schichturlaub als Fallback.
 *  3. **Q1-Regel (consumeShiftVacationFirstInQ1):** Für Jan–Mär wird
 *     zuerst der Schichturlaub verbraucht, dann der reguläre Urlaub.
 *  4. Tage, die beide Kontingente überschreiten, werden als 'Urlaub'
 *     (Überziehung) gespeichert, damit die Overshoot-Warnung greift.
 *  5. Bereits gebuchte Urlaub-/Schichturlaub-Tage werden unverändert
 *     gelassen (die Prüfung dient als Guard für den Aufrufer).
 *
 * The function does NOT mutate inputs. It uses only the `remaining`
 * fields of the two balances so the live candidate (in-progress drag)
 * is already accounted for by the caller when building the balances.
 *
 * @param {Object} params
 * @param {Array<{date: string}>} params.newDays           `yyyy-MM-dd` strings of the days the planner is booking as Urlaub.
 * @param {{remaining: number, total: number}} params.regularVacationBalance  Result of `computeVacationBalance({position: 'Urlaub', ...})` *without* the new days counted.
 * @param {{remaining: number, total: number}} [params.shiftVacationBalance]  Same shape for 'Schichturlaub'. Optional; if missing, no fallback/Q1-rule happens.
 * @param {Object<string, string>} [params.existingByDate]  Map `yyyy-MM-dd` → 'Urlaub' | 'Schichturlaub' of already-booked days.
 * @param {boolean} [params.consumeShiftVacationFirstInQ1]  When true, days in Jan–Mär consume Schichturlaub FIRST (Q1-Regel für übertragenen Schichturlaub).
 * @returns {{ positions: Array<'Urlaub'|'Schichturlaub'>, shiftedToSchichturlaub: number, regularOvershoot: number }}
 */
export function decidePositionsForUrlaubsDays({
  newDays = [],
  regularVacationBalance,
  shiftVacationBalance,
  existingByDate = {},
  consumeShiftVacationFirstInQ1 = false,
} = {}) {
  if (!regularVacationBalance) {
    return {
      positions: newDays.map(() => 'Urlaub'),
      shiftedToSchichturlaub: 0,
      regularOvershoot: 0,
    };
  }

  // Sort chronologically (mutate copy, not caller's array).
  const sortedDays = [...newDays].sort((a, b) => String(a).localeCompare(String(b)));

  // Running tallies. We start the regular counter at "already used"
  // (total - remaining) so we know how much of the allowance is spent
  // even when remaining is negative (overshoot).
  let regularUsed = Math.max(0, (regularVacationBalance.total ?? 0) - (regularVacationBalance.remaining ?? 0));
  let shiftUsed = shiftVacationBalance
    ? Math.max(0, (shiftVacationBalance.total ?? 0) - (shiftVacationBalance.remaining ?? 0))
    : 0;
  const shiftTotal = shiftVacationBalance?.total ?? 0;

  const positionsByDate = {};
  let shifted = 0;
  let regularOvershoot = 0;

  for (const dateStr of sortedDays) {
    // If this day is already booked as vacation, keep its position so the
    // caller's "skip if same type" logic continues to work.
    const existing = existingByDate[dateStr];
    if (existing === 'Urlaub' || existing === 'Schichturlaub') {
      positionsByDate[dateStr] = existing;
      continue;
    }

    // Check if this day is in Q1 (January-March).
    const month = dateStr ? parseInt(dateStr.slice(5, 7), 10) : 0;
    const isQ1 = month >= 1 && month <= 3;

    if (consumeShiftVacationFirstInQ1 && isQ1 && shiftVacationBalance) {
      // Q1-Regel: Schichturlaub zuerst verbrauchen (übertragener
      // Schichturlaub verfällt am 31.03., muss also zuerst genutzt werden).
      if (shiftUsed < shiftTotal) {
        shiftUsed += 1;
        shifted += 1;
        positionsByDate[dateStr] = 'Schichturlaub';
        continue;
      }
      // Schichturlaub aufgebraucht → regulären Urlaub verwenden.
      if (regularUsed < regularVacationBalance.total) {
        regularUsed += 1;
        positionsByDate[dateStr] = 'Urlaub';
        continue;
      }
    } else {
      // Standard-Logik (außerhalb Q1 oder ohne Carry-Over):
      // regulären Urlaub zuerst verbrauchen.
      if (regularUsed < regularVacationBalance.total) {
        regularUsed += 1;
        positionsByDate[dateStr] = 'Urlaub';
        continue;
      }

      // Regular quota exhausted → fall back to Schichturlaub when available.
      if (shiftVacationBalance && shiftUsed < shiftTotal) {
        shiftUsed += 1;
        positionsByDate[dateStr] = 'Schichturlaub';
        shifted += 1;
        continue;
      }
    }

    // Both exhausted → book as Urlaub (overshoot). The existing warning
    // in the balance box will surface this to the planner.
    regularUsed += 1;
    regularOvershoot += 1;
    positionsByDate[dateStr] = 'Urlaub';
  }

  // Preserve the caller's original ordering in the returned array.
  const positions = newDays.map((d) => positionsByDate[d] || 'Urlaub');

  return {
    positions,
    shiftedToSchichturlaub: shifted,
    regularOvershoot,
  };
}

/**
 * Returns true iff the given `yyyy-MM-dd` date is a workday that
 * consumes vacation (Mon–Fri, not on the public-holiday set).
 */
function isCountableVacationDay(dateStr, holidaySet) {
  // Re-parse the noon time to avoid TZ shifts.
  const d = new Date(`${dateStr}T12:00:00`);
  if (Number.isNaN(d.getTime())) return false;
  const day = d.getDay();
  if (day === 0 || day === 6) return false;
  if (holidaySet.has(dateStr)) return false;
  return true;
}
