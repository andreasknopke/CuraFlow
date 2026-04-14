const NON_WORKING_SHIFT_POSITIONS = new Set([
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

export function normalizeShiftPosition(position: string | null | undefined): string {
  return String(position || '')
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

export function isNonWorkingShiftPosition(position: string | null | undefined): boolean {
  return NON_WORKING_SHIFT_POSITIONS.has(normalizeShiftPosition(position));
}
