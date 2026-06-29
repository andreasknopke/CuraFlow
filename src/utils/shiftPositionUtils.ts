/**
 * CuraFlow — Shift Position Utilities
 *
 * Determines whether a given shift position represents "non-working" status
 * (vacation, sick leave, training, parental leave, etc.).
 *
 * @module utils/shiftPositionUtils
 */

/**
 * All shift position names that should be treated as non-working.
 * Both umlaut and non-umlaut forms are included for robustness.
 */
const NON_WORKING_SHIFT_POSITIONS: ReadonlySet<string> = new Set([
  'frei',
  'urlaub',
  'krank',
  'dienstreise',
  'nicht verfugbar',
  'nicht verfügbar',
  'fortbildung',
  'kongress',
  'elternzeit',
  'mutterschutz',
  'verfugbar',
  'verfügbar',
  'az',
  'ko',
  'ez',
  'ms',
]);

/**
 * Normalizes a shift position string for comparison:
 * trims, lowercases, and strips diacritics (umlauts → base form).
 */
export function normalizeShiftPosition(position: unknown): string {
  return String(position ?? '')
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

/**
 * Returns true if the given position is one of the non-working statuses.
 */
export function isNonWorkingShiftPosition(position: unknown): boolean {
  return NON_WORKING_SHIFT_POSITIONS.has(normalizeShiftPosition(position));
}
