/**
 * Shared absence-type configuration for the master frontend:
 * badge classes, chart colors and icons per absence type.
 *
 * @module master/utils/absenceTypes
 */

export interface AbsenceTypeConfig {
  /** Tailwind classes for badges/tiles. */
  color: string;
  /** Hex color used in charts. */
  hex: string;
  /** Emoji icon used in summary tiles. */
  icon: string;
}

export const ABSENCE_TYPES: Record<string, AbsenceTypeConfig> = {
  'Urlaub': { color: 'bg-emerald-100 text-emerald-800', hex: '#10b981', icon: '🏖️' },
  'Krank': { color: 'bg-red-100 text-red-800', hex: '#ef4444', icon: '🤒' },
  'Frei': { color: 'bg-slate-100 text-slate-800', hex: '#64748b', icon: '📅' },
  'Dienstreise': { color: 'bg-blue-100 text-blue-800', hex: '#3b82f6', icon: '✈️' },
  'Nicht verfügbar': { color: 'bg-amber-100 text-amber-800', hex: '#f59e0b', icon: '⛔' },
  'Fortbildung': { color: 'bg-purple-100 text-purple-800', hex: '#a855f7', icon: '📚' },
  'Kongress': { color: 'bg-violet-100 text-violet-800', hex: '#8b5cf6', icon: '🎓' },
};

/** Canonical display order of absence types. */
export const ABSENCE_TYPE_ORDER: string[] = Object.keys(ABSENCE_TYPES);

/** Fallback style for unknown absence types. */
export const UNKNOWN_ABSENCE_TYPE: AbsenceTypeConfig = {
  color: 'bg-slate-100 text-slate-800',
  hex: '#94a3b8',
  icon: '❓',
};
