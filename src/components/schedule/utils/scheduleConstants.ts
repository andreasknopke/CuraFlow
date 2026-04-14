// ---------------------------------------------------------------------------
// Schedule board constants — section styles, layout keys, prefixes.
// Extracted from ScheduleBoard.jsx for reuse and testability.
// ---------------------------------------------------------------------------

export interface SectionStyle {
  headerColor: string;
  rowColor: string;
  rows?: string[];
}

export const STATIC_SECTIONS: Record<string, SectionStyle> = {
  Anwesenheiten: {
    headerColor: 'bg-indigo-100 text-indigo-900',
    rowColor: 'bg-indigo-50/30',
    rows: ['Verfügbar'],
  },
  Abwesenheiten: {
    headerColor: 'bg-slate-200 text-slate-800',
    rowColor: 'bg-slate-50/50',
    rows: ['Frei', 'Krank', 'Urlaub', 'Dienstreise', 'Nicht verfügbar'],
  },
  Dienste: {
    headerColor: 'bg-blue-100 text-blue-900',
    rowColor: 'bg-blue-50/30',
    rows: [],
  },
  Sonstiges: {
    headerColor: 'bg-purple-100 text-purple-900',
    rowColor: 'bg-purple-50/30',
    rows: ['Sonstiges'],
  },
} as const;

export const SECTION_CONFIG: Record<string, Omit<SectionStyle, 'rows'>> = {
  Rotationen: {
    headerColor: 'bg-emerald-100 text-emerald-900',
    rowColor: 'bg-emerald-50/30',
  },
  'Demonstrationen & Konsile': {
    headerColor: 'bg-amber-100 text-amber-900',
    rowColor: 'bg-amber-50/30',
  },
} as const;

export const SECTION_TABS_KEY = 'schedule_section_tabs';
export const PINNED_SECTION_TITLE = 'Anwesenheiten';
export const SPLIT_PANEL_PREFIX = 'split::';
export const SPLIT_DRAG_PREFIX = 'split-';
