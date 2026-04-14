// ---------------------------------------------------------------------------
// Schedule board pure utility functions — formatting, parsing, display logic.
// Extracted from ScheduleBoard.jsx for reuse and testability.
// ---------------------------------------------------------------------------

import { isValid } from 'date-fns';
import { startOfWeek } from 'date-fns';
import { SPLIT_PANEL_PREFIX, SPLIT_DRAG_PREFIX } from './scheduleConstants';
import type { Doctor } from '@/types';

// ── Panel / drag ID helpers ────────────────────────────────────────────────

export const withPanelPrefix = (id: string, prefix = ''): string => `${prefix}${id}`;

export const stripPanelPrefix = (id = ''): string =>
  id.startsWith(SPLIT_PANEL_PREFIX) ? id.slice(SPLIT_PANEL_PREFIX.length) : id;

export const normalizeDraggableId = (id = ''): string =>
  id.startsWith(SPLIT_DRAG_PREFIX) ? id.slice(SPLIT_DRAG_PREFIX.length) : id;

export const parseAvailableDoctorId = (draggableId = ''): string | null => {
  const normalized = normalizeDraggableId(draggableId);
  if (!normalized.startsWith('available-doc-')) return null;
  return normalized.substring(14, normalized.length - 11);
};

// ── Tab / URL parsing ──────────────────────────────────────────────────────

export interface SectionTab {
  id: string;
  sectionTitle: string;
}

export const parseSectionTabs = (rawValue: string | null | undefined): SectionTab[] => {
  if (!rawValue) return [];

  try {
    const parsed = JSON.parse(rawValue);
    if (Array.isArray(parsed)) {
      return parsed.filter(
        (tab: unknown): tab is SectionTab =>
          typeof tab === 'object' &&
          tab !== null &&
          'id' in tab &&
          'sectionTitle' in tab &&
          !!(tab as SectionTab).id &&
          !!(tab as SectionTab).sectionTitle,
      );
    }
  } catch {
    return [];
  }

  return [];
};

export const parseDateFromQuery = (rawDate: string | null | undefined): Date | null => {
  if (!rawDate) return null;

  const match = rawDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;

  const parsed = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return isValid(parsed) ? parsed : null;
};

export type ViewMode = 'week' | 'day' | 'month';

export interface ScheduleInitialState {
  currentDate: Date;
  viewMode: ViewMode;
  activeSectionTabId: string;
}

export const getInitialScheduleState = (): ScheduleInitialState => {
  const params = new URLSearchParams(window.location.search);
  const initialDate = parseDateFromQuery(params.get('date'));
  const rawView = params.get('view');
  const initialViewMode: ViewMode = rawView === 'day' || rawView === 'month' ? rawView : 'week';

  return {
    currentDate: initialDate || startOfWeek(new Date(), { weekStartsOn: 1 }),
    viewMode: initialViewMode,
    activeSectionTabId: params.get('sectionTab') || 'main',
  };
};

// ── Doctor chip label logic ────────────────────────────────────────────────

export const getDoctorShortLabel = (
  doctor: Pick<Doctor, 'initials' | 'name'> | null | undefined,
): string => doctor?.initials || doctor?.name?.substring(0, 3) || '';

export const normalizeChipSource = (doctor: Partial<Doctor> | null | undefined): string => {
  const rawSource = `${doctor?.initials || ''}${doctor?.name || ''}${doctor?.id || ''}`;
  const normalized = rawSource
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]/g, '')
    .toUpperCase();

  return normalized || 'DOC';
};

export const formatChipLabel = (value = ''): string => {
  const normalized = String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]/g, '')
    .toUpperCase();

  if (!normalized) return 'DOC';
  if (normalized.length >= 3) return normalized.slice(0, 3);
  return normalized.padEnd(3, normalized[normalized.length - 1] || 'X');
};

export const getUniqueChipCandidates = (doctor: Partial<Doctor>): string[] => {
  const source = normalizeChipSource(doctor);
  const candidates: string[] = [];
  const seen = new Set<string>();

  const pushCandidate = (value: string) => {
    const candidate = formatChipLabel(value);
    if (!seen.has(candidate)) {
      seen.add(candidate);
      candidates.push(candidate);
    }
  };

  pushCandidate(source.slice(0, 3));

  if (source.length < 3) {
    return candidates;
  }

  const indexPairs: [number, number][] = [];

  for (let first = 1; first < source.length; first += 1) {
    for (let second = first + 1; second < source.length; second += 1) {
      indexPairs.push([first, second]);
    }
  }

  indexPairs.sort((left, right) => {
    const leftScore = Math.abs(left[0] - 3) + Math.abs(left[1] - 4);
    const rightScore = Math.abs(right[0] - 3) + Math.abs(right[1] - 4);
    if (leftScore !== rightScore) return leftScore - rightScore;
    if (left[0] !== right[0]) return left[0] - right[0];
    return left[1] - right[1];
  });

  indexPairs.forEach(([first, second]) => {
    pushCandidate(`${source[0]}${source[first]}${source[second]}`);
  });

  for (let index = 1; index < source.length; index += 1) {
    pushCandidate(`${source[0]}${source[index]}${source[source.length - 1]}`);
  }

  return candidates;
};

export const buildDoctorChipLabelMap = (doctors: Partial<Doctor>[] = []): Map<string, string> => {
  const labelMap = new Map<string, string>();
  const usedLabels = new Set<string>();
  const groupedDoctors = new Map<string, Partial<Doctor>[]>();

  doctors.forEach((doctor) => {
    const baseLabel = formatChipLabel(normalizeChipSource(doctor).slice(0, 3));
    if (!groupedDoctors.has(baseLabel)) {
      groupedDoctors.set(baseLabel, []);
    }
    groupedDoctors.get(baseLabel)!.push(doctor);
  });

  groupedDoctors.forEach((group, baseLabel) => {
    if (group.length === 1) {
      labelMap.set(group[0].id!, baseLabel);
      usedLabels.add(baseLabel);
    }
  });

  const conflictingGroups = Array.from(groupedDoctors.entries())
    .filter(([, group]) => group.length > 1)
    .sort((left, right) => right[1].length - left[1].length);

  conflictingGroups.forEach(([, group]) => {
    group.forEach((doctor, groupIndex) => {
      const candidate = getUniqueChipCandidates(doctor).find((label) => !usedLabels.has(label));
      if (candidate) {
        labelMap.set(doctor.id!, candidate);
        usedLabels.add(candidate);
        return;
      }

      const fallbackSource = normalizeChipSource(doctor);
      for (let index = 0; index < fallbackSource.length; index += 1) {
        const fallback = formatChipLabel(
          `${fallbackSource[0]}${fallbackSource[index]}${String.fromCharCode(97 + ((groupIndex + index) % 26))}`,
        );
        if (!usedLabels.has(fallback)) {
          labelMap.set(doctor.id!, fallback);
          usedLabels.add(fallback);
          return;
        }
      }
    });
  });

  return labelMap;
};

// ── Display measurement ────────────────────────────────────────────────────

export const measureTextWidth = (() => {
  let canvas: HTMLCanvasElement | null = null;

  return (text: string | null | undefined, fontSize: number): number => {
    if (!text) return 0;
    if (typeof document === 'undefined') return text.length * fontSize * 0.62;

    if (!canvas) {
      canvas = document.createElement('canvas');
    }

    const context = canvas.getContext('2d');
    if (!context) return text.length * fontSize * 0.62;

    context.font = `700 ${fontSize}px ui-sans-serif, system-ui, sans-serif`;
    return context.measureText(text).width;
  };
})();

export interface ShiftDisplayModeParams {
  doctor: Pick<Doctor, 'name'> | null | undefined;
  isSplitModeActive: boolean;
  isSectionFullWidth: boolean;
  isSingleShift: boolean;
  forceInitialsOnly: boolean;
  cellWidth: number;
  gridFontSize: number;
  boxSize: number;
}

export const getShiftDisplayMode = ({
  doctor,
  isSplitModeActive,
  isSectionFullWidth,
  isSingleShift,
  forceInitialsOnly,
  cellWidth,
  gridFontSize,
  boxSize,
}: ShiftDisplayModeParams): 'compact' | 'full' => {
  if (forceInitialsOnly || isSplitModeActive || (!isSectionFullWidth && !isSingleShift)) {
    return 'compact';
  }

  if (!doctor?.name || !cellWidth) {
    return 'full';
  }

  const requiredWidth = boxSize + measureTextWidth(doctor.name, gridFontSize) + 40;
  return cellWidth >= requiredWidth ? 'full' : 'compact';
};
