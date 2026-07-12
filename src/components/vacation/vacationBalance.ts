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
 */

export interface VacationBalance {
    total: number;
    taken: number;
    planned: number;
    remaining: number;
    overshoot: boolean;
}

interface VacationShift {
    date: string;
    position: string;
}

interface VacationBalanceParams {
    shifts?: VacationShift[];
    year?: number | string;
    annualVacationDays?: number | string | null;
    position?: string;
    publicHolidayDates?: Set<string> | string[] | null;
    today?: Date | string;
    candidateDate?: string;
}

export function computeVacationBalance({
  shifts = [],
  year,
  annualVacationDays,
  position = 'Urlaub',
  publicHolidayDates,
  today,
  candidateDate,
}: VacationBalanceParams = {}): VacationBalance {
  const total = parseAnnualVacationDays(annualVacationDays);

  const holidaySet: Set<string> = publicHolidayDates instanceof Set
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
function extractYmd(value: unknown): string | null {
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

function formatYmd(date: Date): string {
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
export function parseAnnualVacationDays(value: unknown): number {
  if (value === null || value === undefined || value === '') return 30;
  const n = Number(value);
  if (!Number.isFinite(n)) return 30;
  return n;
}

/**
 * Decision helper for the "auto-shift-vacation fallback" rule.
 *
 * This helper is PURE: given the current vacation balances and a list of
 * new vacation days to be booked, it returns the position ('Urlaub' or
 * 'Schichturlaub') that each new day should be saved as.
 */
export function decidePositionsForUrlaubsDays({
  newDays = [],
  regularVacationBalance,
  shiftVacationBalance,
  existingByDate = {},
  consumeShiftVacationFirstInQ1 = false,
}: {
  newDays?: string[];
  regularVacationBalance?: { remaining: number; total: number } | null;
  shiftVacationBalance?: { remaining: number; total: number } | null;
  existingByDate?: Record<string, string>;
  consumeShiftVacationFirstInQ1?: boolean;
} = {}): {
  positions: Array<'Urlaub' | 'Schichturlaub'>;
  shiftedToSchichturlaub: number;
  regularOvershoot: number;
} {
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

  const positionsByDate: Record<string, 'Urlaub' | 'Schichturlaub'> = {};
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
function isCountableVacationDay(dateStr: string, holidaySet: Set<string>): boolean {
  // Re-parse the noon time to avoid TZ shifts.
  const d = new Date(`${dateStr}T12:00:00`);
  if (Number.isNaN(d.getTime())) return false;
  const day = d.getDay();
  if (day === 0 || day === 6) return false;
  if (holidaySet.has(dateStr)) return false;
  return true;
}
