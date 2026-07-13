import type { CSSProperties } from 'react';
import { isValid, startOfWeek } from 'date-fns';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import type { Doctor, ShiftEntry, Workplace, WorkplaceTimeslot, WorkTimeModel } from '@/types';
import type { CentralEmployee } from '@/types/master';
import { resolveDoctorTargetDailyHours } from '@/components/schedule/doctorWorkTime';

// ── Types used by helpers ──────────────────────────────────────────

export type ScheduleViewMode = 'week' | 'day' | 'month';

export interface SectionTab {
  id: string;
  sectionTitle: string;
}

interface TimeslotOption {
  id: string;
  label: string;
  startTime: string;
  endTime: string;
  breakMinutes: number;
  isCustom?: boolean;
}

interface TimeslotSelectionNormalized {
  timeslotId: string | null;
  startTime: string | null;
  endTime: string | null;
  breakMinutes: number | null;
  isCustom: boolean;
}

// ── Constants used by helpers ──────────────────────────────────────

const PINNED_SECTION_TITLE = 'Anwesenheiten';

const SPLIT_PANEL_PREFIX = 'split::';

const SPLIT_DRAG_PREFIX = 'split-';

const DEFAULT_BREAK_MINUTES = 30;
const ROUTINE_SERVICE_START_MINUTES = 7 * 60;
const LATE_ROTATION_THRESHOLD_MINUTES = ROUTINE_SERVICE_START_MINUTES + (4 * 60);

// ── ID encoding / decoding helpers ──────────────────────────────────

export const withPanelPrefix = (id: string, prefix: string = ''): string => `${prefix}${id}`;

export const stripPanelPrefix = (id: string = ''): string => (id.startsWith(SPLIT_PANEL_PREFIX) ? id.slice(SPLIT_PANEL_PREFIX.length) : id);

export const normalizeDraggableId = (id: string = ''): string => (id.startsWith(SPLIT_DRAG_PREFIX) ? id.slice(SPLIT_DRAG_PREFIX.length) : id);

export const encodeScheduleTargetId = (value: string = ''): string => encodeURIComponent(String(value));

export const movePinnedSectionToEnd = (sections: Array<{ title: string }> = []): Array<{ title: string }> => {
    const pinnedSections = sections.filter((section) => section.title === PINNED_SECTION_TITLE);
    if (pinnedSections.length === 0) return sections;

    return [
        ...sections.filter((section) => section.title !== PINNED_SECTION_TITLE),
        ...pinnedSections,
    ];
};

export const parseAvailableDoctorId = (draggableId: string = ''): string | null => {
    const normalized = normalizeDraggableId(draggableId);
    if (!normalized.startsWith('available-doc-')) return null;
    return normalized.substring(14, normalized.length - 11);
};

// ── Query / state parsing helpers ──────────────────────────────────

export const parseSectionTabs = (rawValue: string | null | undefined): SectionTab[] => {
    if (!rawValue) return [];

    try {
        const parsed = JSON.parse(rawValue);
        if (Array.isArray(parsed)) {
            return parsed.filter((tab: SectionTab) => tab?.id && tab?.sectionTitle);
        }
    } catch {
        return [];
    }

    return [];
};

const parseDateFromQuery = (rawDate: string | null): Date | null => {
    if (!rawDate) return null;

    const match = rawDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return null;

    const parsed = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    return isValid(parsed) ? parsed : null;
};

export const getInitialScheduleState = (
  searchParams: URLSearchParams
): { currentDate: Date; viewMode: ScheduleViewMode; activeSectionTabId: string } => {
    const initialDate = parseDateFromQuery(searchParams.get('date'));
    const rawView = searchParams.get('view');
    const initialViewMode: ScheduleViewMode = rawView === 'day' || rawView === 'month' ? rawView : 'week';

    return {
        currentDate: initialDate || startOfWeek(new Date(), { weekStartsOn: 1 }),
        viewMode: initialViewMode,
        activeSectionTabId: searchParams.get('sectionTab') || 'main',
    };
};

// ── Chip label helpers ──────────────────────────────────────────────

export const getDoctorShortLabel = (doctor: Doctor | undefined): string => doctor?.initials || doctor?.name?.substring(0, 3) || '';

export const normalizeChipSource = (doctor: Doctor): string => {
    const rawSource = `${doctor?.initials || ''}${doctor?.name || ''}${doctor?.id || ''}`;
    const normalized = rawSource
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-zA-Z0-9]/g, '')
        .toUpperCase();

    return normalized || 'DOC';
};

export const formatChipLabel = (value: string = ''): string => {
    const normalized = String(value)
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-zA-Z0-9]/g, '')
        .toUpperCase();

    if (!normalized) return 'DOC';
    if (normalized.length >= 3) return normalized.slice(0, 3);
    return normalized.padEnd(3, normalized[normalized.length - 1] || 'X');
};

const getUniqueChipCandidates = (doctor: Doctor): string[] => {
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

    const indexPairs = [];

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

export const buildDoctorChipLabelMap = (doctors: Doctor[] = []): Map<string, string> => {
    const labelMap = new Map<string, string>();
    const usedLabels = new Set<string>();
    const groupedDoctors = new Map<string, Doctor[]>();

    doctors.forEach((doctor) => {
        const baseLabel = formatChipLabel(normalizeChipSource(doctor).slice(0, 3));
        if (!groupedDoctors.has(baseLabel)) {
            groupedDoctors.set(baseLabel, []);
        }
        groupedDoctors.get(baseLabel)!.push(doctor);
    });

    groupedDoctors.forEach((group, baseLabel) => {
        if (group.length === 1) {
            labelMap.set(group[0].id, baseLabel);
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
                labelMap.set(doctor.id, candidate);
                usedLabels.add(candidate);
                return;
            }

            const fallbackSource = normalizeChipSource(doctor);
            for (let index = 0; index < fallbackSource.length; index += 1) {
                const fallback = formatChipLabel(`${fallbackSource[0]}${fallbackSource[index]}${String.fromCharCode(97 + ((groupIndex + index) % 26))}`);
                if (!usedLabels.has(fallback)) {
                    labelMap.set(doctor.id, fallback);
                    usedLabels.add(fallback);
                    return;
                }
            }
        });
    });

    return labelMap;
};

// ── Text measurement ───────────────────────────────────────────────

const measureTextWidth = (() => {
    let canvas: HTMLCanvasElement | null = null;

    return (text: string, fontSize: number): number => {
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

export const getShiftDisplayMode = ({ doctor, isSplitModeActive, isSingleShift, forceInitialsOnly, cellWidth, gridFontSize, boxSize }: {
    doctor: Doctor | undefined;
    isSplitModeActive: boolean;
    isSingleShift: boolean;
    forceInitialsOnly: boolean;
    cellWidth: number | null;
    gridFontSize: number;
    boxSize: number;
}): 'full' | 'compact' => {
    // Mehrfachbesetzung: IMMER compact — jeder Chip braucht eigenen Platz.
    if (forceInitialsOnly || isSplitModeActive || !isSingleShift) {
        return 'compact';
    }

    if (!doctor?.name || !cellWidth) {
        return 'full';
    }

    const requiredWidth = boxSize + measureTextWidth(doctor.name, gridFontSize) + 40;
    return cellWidth >= requiredWidth ? 'full' : 'compact';
};

// ── Time formatting helpers ─────────────────────────────────────────

export const formatTimeslotTimeRange = (startTime: string | undefined | null, endTime: string | undefined | null): string => {
    if (!startTime || !endTime) return '';
    return `${startTime.substring(0, 5)}-${endTime.substring(0, 5)}`;
};

export const formatTimeslotStartTime = (startTime: string | undefined | null): string | null => {
    if (!startTime) return null;
    return startTime.substring(0, 5);
};

export const formatMinutesAsTime = (minutes: number | null | undefined): string | null => {
    if (minutes === null || minutes === undefined || Number.isNaN(Number(minutes))) {
        return null;
    }

    const normalizedMinutes = ((Math.round(Number(minutes)) % (24 * 60)) + (24 * 60)) % (24 * 60);
    const hours = Math.floor(normalizedMinutes / 60);
    const remainingMinutes = normalizedMinutes % 60;
    return `${String(hours).padStart(2, '0')}:${String(remainingMinutes).padStart(2, '0')}`;
};

const formatDurationMinutes = (minutes: number): string => {
    const roundedMinutes = Math.max(0, Math.round(Number(minutes) || 0));
    const hours = Math.floor(roundedMinutes / 60);
    const restMinutes = roundedMinutes % 60;

    if (hours > 0 && restMinutes > 0) {
        return `${hours}h ${restMinutes}min`;
    }
    if (hours > 0) {
        return `${hours}h`;
    }
    return `${restMinutes}min`;
};

export const parseTimeToMinutes = (timeStr: string | null | undefined): number | null => {
    if (!timeStr) return null;
    const parts = String(timeStr).split(':');
    if (parts.length < 2) return null;
    const hours = Number(parts[0]);
    const minutes = Number(parts[1]);
    if (Number.isNaN(hours) || Number.isNaN(minutes)) return null;
    return hours * 60 + minutes;
};

// ── Interval / shift computation helpers ────────────────────────────

export const mergePlannedIntervals = (intervals: Array<{ start: number; end: number }>): number => {
    if (!intervals.length) return 0;

    const sorted = [...intervals].sort((left, right) => left.start - right.start);
    const merged = [{ ...sorted[0] }];

    for (let index = 1; index < sorted.length; index += 1) {
        const current = sorted[index];
        const last = merged[merged.length - 1];

        if (current.start <= last.end) {
            last.end = Math.max(last.end, current.end);
            continue;
        }

        merged.push({ ...current });
    }

    return merged.reduce((sum, interval) => sum + (interval.end - interval.start), 0);
};

const getDoctorTargetDailyHours = (doctor: Doctor | undefined, workTimeModelMap: Map<string, WorkTimeModel>, centralEmployeesById: Map<string, CentralEmployee>): number | null => {
    if (!doctor) return null;

    const model = doctor.work_time_model_id ? workTimeModelMap.get(doctor.work_time_model_id) : null;
    const centralEmployee = doctor.central_employee_id ? centralEmployeesById.get(String(doctor.central_employee_id)) : null;
    return resolveDoctorTargetDailyHours(doctor, model, centralEmployee);
};

const getDoctorTargetDailyMinutes = (doctor: Doctor | undefined, workTimeModelMap: Map<string, WorkTimeModel>, centralEmployeesById: Map<string, CentralEmployee>): number | null => {
    const dailyHours = getDoctorTargetDailyHours(doctor, workTimeModelMap, centralEmployeesById);
    if (dailyHours === null || dailyHours === undefined) return null;

    const parsedDailyHours = Number(dailyHours);
    if (!Number.isFinite(parsedDailyHours) || parsedDailyHours <= 0) return null;

    return Math.round(parsedDailyHours * 60);
};

const getTimeslotDerivedTimeRange = (timeslot: WorkplaceTimeslot | undefined | null, doctor: Doctor | undefined, workplace: Workplace | undefined | null, workTimeModelMap: Map<string, WorkTimeModel>, centralEmployeesById: Map<string, CentralEmployee>): { start: number; end: number; displayEnd: number; workMinutes: number; appliedBreakMinutes: number } | null => {
    if (!timeslot?.start_time || !timeslot?.end_time) return null;

    const start = parseTimeToMinutes(timeslot.start_time);
    let end = parseTimeToMinutes(timeslot.end_time);
    if (start === null || end === null) return null;

    if (end <= start) {
        end += 24 * 60;
    }

    const slotDurationMinutes = end - start;
    const workTimeFactor = (workplace?.work_time_percentage ?? 100) / 100;
    const scaledWorkMinutes = Math.round(slotDurationMinutes * workTimeFactor);
    const isFullDaysOff = doctor?.part_time_model === 'full_days_off';
    const doctorDailyMinutes = isFullDaysOff ? null : getDoctorTargetDailyMinutes(doctor, workTimeModelMap, centralEmployeesById);

    // Bei full_days_off wird die Reduktion ueber ganze freie Tage abgebildet,
    // nicht ueber verkuerzte Schichten. Daher immer den vollen Slot anzeigen.
    if (doctorDailyMinutes === null || scaledWorkMinutes <= doctorDailyMinutes) {
        return {
            start,
            end: start + scaledWorkMinutes,
            displayEnd: end,
            workMinutes: scaledWorkMinutes,
            appliedBreakMinutes: 0,
        };
    }

    return {
        start,
        end: start + doctorDailyMinutes,
        displayEnd: start + doctorDailyMinutes + DEFAULT_BREAK_MINUTES,
        workMinutes: doctorDailyMinutes,
        appliedBreakMinutes: DEFAULT_BREAK_MINUTES,
    };
};

export const buildShiftInterval = (shift: ShiftEntry, doctor: Doctor, workplace: Workplace, timeslot: WorkplaceTimeslot | undefined | null, workTimeModelMap: Map<string, WorkTimeModel>, centralEmployeesById: Map<string, CentralEmployee>): { start: number; end: number } | null => {
    if (shift.start_time && shift.end_time) {
        const start = parseTimeToMinutes(shift.start_time);
        let end = parseTimeToMinutes(shift.end_time);
        if (start !== null && end !== null) {
            if (end < start) {
                end += 24 * 60;
            }

            const breakMinutes = Number(shift.break_minutes) || 0;
            return {
                start,
                end: Math.max(start, end - breakMinutes),
            };
        }
    }

    if (timeslot?.start_time && timeslot?.end_time) {
        const timeRange = getTimeslotDerivedTimeRange(timeslot, doctor, workplace, workTimeModelMap, centralEmployeesById);
        if (timeRange) {
            return {
                start: timeRange.start,
                end: timeRange.end,
            };
        }
    }

    const fallbackHours = getDoctorTargetDailyHours(doctor, workTimeModelMap, centralEmployeesById);
    if (!fallbackHours) return null;

    return {
        start: 8 * 60,
        end: (8 * 60) + (fallbackHours * 60),
    };
};

// ── Row label helpers ──────────────────────────────────────────────

export const getExpandedTimeslotRowLabel = (rowObj: { isTimeslotRow?: boolean; isUnassignedRow?: boolean; startTime?: string; endTime?: string; timeslotLabel?: string }, rowDisplayName: string): string => {
    if (!rowObj?.isTimeslotRow || rowObj?.isUnassignedRow) {
        return rowDisplayName;
    }

    const timeRange = formatTimeslotTimeRange(rowObj.startTime, rowObj.endTime);
    const label = rowObj.timeslotLabel || rowDisplayName;
    return timeRange ? `${label} ${timeRange}` : label;
};

export const getRowLabelPresentation = (label: string, isCompactMode: boolean = false): { className: string; style: CSSProperties } => {
    const normalizedLabel = String(label || '').trim();
    const words = normalizedLabel.split(/\s+/).filter(Boolean);
    const longestWordLength = words.reduce((maxLength, word) => Math.max(maxLength, word.length), 0);

    let fontSizePx = isCompactMode ? 11 : 14;
    if (normalizedLabel.length > (isCompactMode ? 18 : 24)) fontSizePx -= 1;
    if (normalizedLabel.length > (isCompactMode ? 24 : 32)) fontSizePx -= 1;
    if (longestWordLength > (isCompactMode ? 12 : 18)) fontSizePx -= 1;

    const allowWrap = !isCompactMode && (normalizedLabel.length > 18 || longestWordLength > 14);
    const minFontSizePx = isCompactMode ? 9 : 11;
    const safeFontSizePx = Math.max(fontSizePx, minFontSizePx);

    return {
        className: allowWrap
            ? 'min-w-0 overflow-hidden break-words [overflow-wrap:anywhere]'
            : 'min-w-0 truncate whitespace-nowrap',
        style: allowWrap
            ? {
                fontSize: `${safeFontSizePx}px`,
                lineHeight: 1.1,
                display: '-webkit-box',
                WebkitLineClamp: 2,
                WebkitBoxOrient: 'vertical',
                maxHeight: '2.2em',
              }
            : {
                fontSize: `${safeFontSizePx}px`,
                lineHeight: 1.1,
              }
    };
};

// ── Timeslot selection helpers ─────────────────────────────────────

export const buildTimeslotSelectionOption = (timeslot: WorkplaceTimeslot, doctor: Doctor, workplace: Workplace, workTimeModelMap: Map<string, WorkTimeModel>, centralEmployeesById: Map<string, CentralEmployee>) => {
    const rawStartMinutes = parseTimeToMinutes(timeslot?.start_time);
    let rawEndMinutes = parseTimeToMinutes(timeslot?.end_time);
    if (rawStartMinutes === null || rawEndMinutes === null) {
        return {
            ...timeslot,
            timeRange: formatTimeslotTimeRange(timeslot?.start_time, timeslot?.end_time),
            effectiveTimeRange: null,
            leavesEarly: false,
            earlyLeaveLabel: null,
            canCustomize: false,
            customBreakMinutes: 0,
        };
    }

    if (rawEndMinutes <= rawStartMinutes) {
        rawEndMinutes += 24 * 60;
    }

    const derivedRange = getTimeslotDerivedTimeRange(timeslot, doctor, workplace, workTimeModelMap, centralEmployeesById);
    const slotStartLabel = formatMinutesAsTime(rawStartMinutes);
    const slotEndLabel = formatMinutesAsTime(rawEndMinutes);
    const effectiveStartMinutes = derivedRange?.start ?? rawStartMinutes;
    const effectiveEndMinutes = derivedRange?.displayEnd ?? derivedRange?.end ?? rawEndMinutes;
    const effectiveStartLabel = formatMinutesAsTime(effectiveStartMinutes);
    const effectiveEndLabel = formatMinutesAsTime(effectiveEndMinutes);
    const slotDurationMinutes = rawEndMinutes - rawStartMinutes;
    const effectivePresenceMinutes = Math.max(0, effectiveEndMinutes - effectiveStartMinutes);
    const leavesEarly = Boolean(derivedRange) && effectiveEndMinutes < rawEndMinutes;
    const dailyMinutes = getDoctorTargetDailyMinutes(doctor, workTimeModelMap, centralEmployeesById);

    return {
        ...timeslot,
        timeRange: slotStartLabel && slotEndLabel ? `${slotStartLabel}-${slotEndLabel}` : formatTimeslotTimeRange(timeslot?.start_time, timeslot?.end_time),
        effectiveTimeRange: effectiveStartLabel && effectiveEndLabel ? `${effectiveStartLabel}-${effectiveEndLabel}` : null,
        leavesEarly,
        earlyLeaveLabel: leavesEarly && effectiveEndLabel && slotEndLabel
            ? `Bleibt bis ${effectiveEndLabel} statt bis ${slotEndLabel}`
            : null,
        shorterShiftNote: leavesEarly && dailyMinutes
            ? `Tagesarbeitszeit ${formatDurationMinutes(dailyMinutes)} + ${DEFAULT_BREAK_MINUTES} Min Pause`
            : null,
        slotStartMinutes: rawStartMinutes,
        slotEndMinutes: rawEndMinutes,
        slotDurationMinutes,
        effectiveStartMinutes,
        effectiveEndMinutes,
        effectivePresenceMinutes,
        canCustomize: effectiveEndMinutes > effectiveStartMinutes,
        customBreakMinutes: derivedRange?.appliedBreakMinutes ?? 0,
    };
};

export const normalizeTimeslotSelection = (selection: unknown): TimeslotSelectionNormalized => {
    if (selection && typeof selection === 'object' && !Array.isArray(selection)) {
        const obj = selection as Record<string, unknown>;
        return {
            timeslotId: (obj.timeslotId as string) ?? null,
            startTime: (obj.startTime as string) ?? null,
            endTime: (obj.endTime as string) ?? null,
            breakMinutes: (obj.breakMinutes as number) ?? null,
            isCustom: Boolean(obj.isCustom),
        };
    }

    return {
        timeslotId: selection === '__unassigned__' ? null : (selection as string ?? null),
        startTime: null,
        endTime: null,
        breakMinutes: null,
        isCustom: false,
    };
};

export const applyTimeslotSelectionToCreateData = (data: Record<string, unknown>, selection: unknown): Record<string, unknown> => {
    const normalizedSelection = normalizeTimeslotSelection(selection);
    const nextData: Record<string, unknown> = { ...data };

    if (normalizedSelection.timeslotId) {
        nextData.timeslot_id = normalizedSelection.timeslotId;
    }

    if (normalizedSelection.isCustom) {
        nextData.start_time = normalizedSelection.startTime;
        nextData.end_time = normalizedSelection.endTime;
        nextData.break_minutes = normalizedSelection.breakMinutes ?? DEFAULT_BREAK_MINUTES;
    }

    return nextData;
};

export const applyTimeslotSelectionToUpdateData = (data: Record<string, unknown>, selection: unknown): Record<string, unknown> => {
    const normalizedSelection = normalizeTimeslotSelection(selection);
    const nextData: Record<string, unknown> = {
        ...data,
        timeslot_id: normalizedSelection.timeslotId || null,
    };

    if (normalizedSelection.isCustom) {
        nextData.start_time = normalizedSelection.startTime;
        nextData.end_time = normalizedSelection.endTime;
        nextData.break_minutes = normalizedSelection.breakMinutes ?? DEFAULT_BREAK_MINUTES;
    } else {
        nextData.start_time = null;
        nextData.end_time = null;
        nextData.break_minutes = null;
    }

    return nextData;
};

// ── Shift display helpers ──────────────────────────────────────────

export const getShiftTimeRangeLabel = (shift: ShiftEntry, doctor: Doctor | undefined, workplace: Workplace | undefined | null, workplaceTimeslots: WorkplaceTimeslot[], workTimeModelMap: Map<string, WorkTimeModel>, centralEmployeesById: Map<string, CentralEmployee>): string | null => {
    if (shift?.start_time && shift?.end_time) {
        return formatTimeslotTimeRange(shift.start_time, shift.end_time);
    }

    if (shift?.timeslot_id) {
        const timeslot = workplaceTimeslots.find((entry) => entry.id === shift.timeslot_id);
        const timeRange = getTimeslotDerivedTimeRange(timeslot, doctor, workplace, workTimeModelMap, centralEmployeesById);
        if (!timeRange) return formatTimeslotTimeRange(timeslot?.start_time, timeslot?.end_time);

        const startLabel = formatMinutesAsTime(timeRange.start);
        const endLabel = formatMinutesAsTime(timeRange.displayEnd ?? timeRange.end);
        if (!startLabel || !endLabel) return null;

        return `${startLabel}-${endLabel}`;
    }

    // Fallback fuer bestehende Shifts ohne timeslot_id bei Workplaces mit
    // timeslots_enabled=true (z.B. nach Backfill-Migration): Zeige den
    // ersten/Default-Timeslot des Arbeitsplatzes an.
    if (workplace?.timeslots_enabled && workplace?.id) {
        const defaultTimeslot = workplaceTimeslots.find((entry) => entry.workplace_id === workplace.id);
        if (defaultTimeslot) {
            const timeRange = getTimeslotDerivedTimeRange(defaultTimeslot, doctor, workplace, workTimeModelMap, centralEmployeesById);
            if (!timeRange) return formatTimeslotTimeRange(defaultTimeslot?.start_time, defaultTimeslot?.end_time);

            const startLabel = formatMinutesAsTime(timeRange.start);
            const endLabel = formatMinutesAsTime(timeRange.displayEnd ?? timeRange.end);
            if (!startLabel || !endLabel) return null;

            return `${startLabel}-${endLabel}`;
        }
    }

    return null;
};

export const getLateRotationIndicator = (shift: ShiftEntry, workplace: Workplace | undefined | null, workplaceTimeslots: WorkplaceTimeslot[]): { show: boolean; tooltip: string | null } => {
    if (!shift?.timeslot_id || workplace?.allows_rotation_concurrently !== true) {
        return { show: false, tooltip: null };
    }

    const timeslot = workplaceTimeslots.find((entry) => entry.id === shift.timeslot_id);
    const startMinutes = parseTimeToMinutes(timeslot?.start_time);
    if (startMinutes === null || startMinutes < LATE_ROTATION_THRESHOLD_MINUTES) {
        return { show: false, tooltip: null };
    }

    const startLabel = formatTimeslotStartTime(timeslot!.start_time);
    return {
        show: true,
        tooltip: startLabel
            ? `Später Dienst mit Rotationsmöglichkeit ab ${startLabel} — Mitarbeiter ist nicht von Anfang an da.`
            : 'Später Dienst mit Rotationsmöglichkeit — Mitarbeiter ist nicht von Anfang an da.'
    };
};

// ── Presentational sub-components ──────────────────────────────────

export const LateAvailabilityBadge = ({ tooltip, compact = false }: { tooltip: string | null; compact?: boolean }) => (
    <TooltipProvider delayDuration={0}>
        <Tooltip>
            <TooltipTrigger asChild>
                <span
                    className={compact
                        ? 'absolute -top-1 -left-1 z-20 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-slate-900/80 text-[9px] leading-none text-white cursor-help'
                        : 'ml-1 inline-flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full bg-slate-900/80 text-[10px] leading-none text-white cursor-help'}
                    aria-label={tooltip ?? undefined}
                >
                    🌙
                </span>
            </TooltipTrigger>
            <TooltipContent side={compact ? 'top' : 'bottom'}>
                {tooltip}
            </TooltipContent>
        </Tooltip>
    </TooltipProvider>
);

export const TimeslotSummaryHint = ({ summary, details = [], count = 0 }: { summary: string | null; details?: string[]; count?: number }) => {
    if (!summary) return null;

    const tooltipLines = Array.isArray(details) && details.length > 0 ? details : [summary];
    const ariaLabel = count > 0 ? `Multi-Slot mit ${count} Zeitfenstern` : 'Multi-Slot';

    return (
        <TooltipProvider delayDuration={100}>
            <Tooltip>
                <TooltipTrigger asChild>
                    <span
                        className="w-fit cursor-help text-[10px] font-normal text-slate-500 underline decoration-dotted underline-offset-2"
                        aria-label={ariaLabel}
                    >
                        Multi-Slot
                    </span>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="max-w-xs px-3 py-2 text-left">
                    <div className="space-y-1">
                        <div className="font-medium">Zeitfenster</div>
                        {tooltipLines.map((line) => (
                            <div key={line} className="text-xs leading-snug">
                                {line}
                            </div>
                        ))}
                    </div>
                </TooltipContent>
            </Tooltip>
        </TooltipProvider>
    );
};
