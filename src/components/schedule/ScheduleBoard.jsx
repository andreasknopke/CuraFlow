import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { flushSync } from 'react-dom';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import { format, addDays, subDays, startOfWeek, isSameDay, startOfMonth, endOfMonth, addMonths, eachDayOfInterval, isValid } from 'date-fns';
import { de } from 'date-fns/locale';
import { ChevronLeft, ChevronRight, ChevronDown, Wand2, Loader2, Trash2, Eye, EyeOff, Layout, Calendar, LayoutList, StickyNote, AlertTriangle, Download, Undo, ExternalLink, X, Lock, Unlock, Settings2, Globe2, Link2, Plus, Filter, Check, ChevronsUpDown } from 'lucide-react';
import { toast } from "sonner";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Badge } from "@/components/ui/badge";
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuCheckboxItem,
} from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { db, api } from "@/api/client";
import { cn } from '@/lib/utils';
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { useAuth } from '@/components/AuthProvider';
import DraggableDoctor from './DraggableDoctor';
import DraggableShift from './DraggableShift';
import DroppableCell from './DroppableCell';
import PoolShiftEditDialog from './PoolShiftEditDialog';
import RotationAssignmentDialog from './RotationAssignmentDialog';
import RotationDemandDialog from './RotationDemandDialog';
import WorkplaceConfigDialog from '@/components/settings/WorkplaceConfigDialog';
import { generateSuggestions } from './autoFillEngine';
import AutoFillSettingsDialog from './AutoFillSettingsDialog';
import ColorSettingsDialog, { DEFAULT_COLORS } from '@/components/settings/ColorSettingsDialog';
import FreeTextCell from './FreeTextCell';
import { isWishOnDate } from '@/utils/wishRange';
import { useShiftValidation } from '@/components/validation/useShiftValidation';
import { useOverrideValidation } from '@/components/validation/useOverrideValidation';
import { useAllDoctorQualifications, useAllWorkplaceQualifications, useQualifications } from '@/hooks/useQualifications';
import { buildRowQualSets, matchesRowQualFilter, getDoctorRowQualHint, getDoctorRowQualRingClass, rowKey as buildRowFilterKey } from '@/components/schedule/rowQualFilter';
import OverrideConfirmDialog from '@/components/validation/OverrideConfirmDialog';
// trackDbChange removed - MySQL mode doesn't use auto-backup
import { useHolidays } from '@/components/useHolidays';
import { getAvailabilityBlockingDoctorIdsByDate, getDoctorEffectiveFte, isDoctorAvailable } from './staffingUtils';
import { getAvailabilityWarnings } from '@/utils/staffingUtils';
import SectionConfigDialog, { useSectionConfig } from '@/components/settings/SectionConfigDialog';
import MobileScheduleView from './MobileScheduleView';
import { useIsMobile } from '../hooks/useIsMobile';
import { useTeamRoles } from '@/components/settings/TeamRoleSettings';
import { getWorkplaceCategoriesFromSettings, getWorkplaceCategoryNames, workplaceAllowsMultiple } from '@/utils/workplaceCategoryUtils';
import { isNonWorkingShiftPosition } from '@/utils/shiftPositionUtils';
import { applyAlwaysVisibleRowsToSections, parseAlwaysVisibleRows, ALWAYS_VISIBLE_ROWS_KEY } from '@/components/schedule/sectionVisibility';
import { createScheduleShiftLookup, getShiftsForScheduleCell } from '@/components/schedule/scheduleShiftLookup';
import { buildInitialCustomTimeslotEndMinutesByOption, buildInitialCustomTimeslotStartMinutesByOption, getDefaultCustomTimeslotEndMinutes, normalizeCustomTimeslotEndMinutes, normalizeCustomTimeslotStartMinutes } from '@/components/schedule/timeslotSelectionUtils';
import { resolveDoctorTargetDailyHours } from '@/components/schedule/doctorWorkTime';
// import VoiceControl from './VoiceControl';

const STATIC_SECTIONS = {
    "Anwesenheiten": {
        headerColor: "bg-indigo-100 text-indigo-900",
        rowColor: "bg-indigo-50/30",
        rows: ["Verfügbar"]
    },
    "Abwesenheiten": {
        headerColor: "bg-slate-200 text-slate-800",
        rowColor: "bg-slate-50/50",
        rows: ["Frei", "Krank", "Urlaub", "Dienstreise", "Nicht verfügbar"]
    },
    "Dienste": {
        headerColor: "bg-blue-100 text-blue-900",
        rowColor: "bg-blue-50/30",
        rows: [] // Dynamically loaded from workplaces
    },
    "Sonstiges": {
        headerColor: "bg-purple-100 text-purple-900",
        rowColor: "bg-purple-50/30",
        rows: ["Sonstiges"]
    }
};

const SECTION_CONFIG = {
    "Rotationen": {
        headerColor: "bg-emerald-100 text-emerald-900",
        rowColor: "bg-emerald-50/30",
    },
    "Demonstrationen & Konsile": {
        headerColor: "bg-amber-100 text-amber-900",
        rowColor: "bg-amber-50/30",
    },
    "Pool-Rotationen": {
        headerColor: "bg-teal-100 text-teal-900",
        rowColor: "bg-teal-50/30",
    }
};

const SECTION_TABS_KEY = 'schedule_section_tabs';
const PINNED_SECTION_TITLE = 'Anwesenheiten';
const SPLIT_PANEL_PREFIX = 'split::';
const SPLIT_DRAG_PREFIX = 'split-';
const STICKY_AVAILABLE_SECTION_CLASS = 'sticky z-20 bg-white shadow-sm';

const withPanelPrefix = (id, prefix = '') => `${prefix}${id}`;
const stripPanelPrefix = (id = '') => (id.startsWith(SPLIT_PANEL_PREFIX) ? id.slice(SPLIT_PANEL_PREFIX.length) : id);
const normalizeDraggableId = (id = '') => (id.startsWith(SPLIT_DRAG_PREFIX) ? id.slice(SPLIT_DRAG_PREFIX.length) : id);
const encodeScheduleTargetId = (value = '') => encodeURIComponent(String(value));
const movePinnedSectionToEnd = (sections = []) => {
    const pinnedSections = sections.filter((section) => section.title === PINNED_SECTION_TITLE);
    if (pinnedSections.length === 0) return sections;

    return [
        ...sections.filter((section) => section.title !== PINNED_SECTION_TITLE),
        ...pinnedSections,
    ];
};
const parseAvailableDoctorId = (draggableId = '') => {
    const normalized = normalizeDraggableId(draggableId);
    if (!normalized.startsWith('available-doc-')) return null;
    return normalized.substring(14, normalized.length - 11);
};

const parseSectionTabs = (rawValue) => {
    if (!rawValue) return [];

    try {
        const parsed = JSON.parse(rawValue);
        if (Array.isArray(parsed)) {
            return parsed.filter((tab) => tab?.id && tab?.sectionTitle);
        }
    } catch {
        return [];
    }

    return [];
};

const parseDateFromQuery = (rawDate) => {
    if (!rawDate) return null;

    const match = rawDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return null;

    const parsed = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    return isValid(parsed) ? parsed : null;
};

const getInitialScheduleState = () => {
    const params = new URLSearchParams(window.location.search);
    const initialDate = parseDateFromQuery(params.get('date'));
    const rawView = params.get('view');
    const initialViewMode = rawView === 'day' || rawView === 'month' ? rawView : 'week';

    return {
        currentDate: initialDate || startOfWeek(new Date(), { weekStartsOn: 1 }),
        viewMode: initialViewMode,
        activeSectionTabId: params.get('sectionTab') || 'main',
    };
};

const getDoctorShortLabel = (doctor) => doctor?.initials || doctor?.name?.substring(0, 3) || '';

const normalizeChipSource = (doctor) => {
    const rawSource = `${doctor?.initials || ''}${doctor?.name || ''}${doctor?.id || ''}`;
    const normalized = rawSource
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-zA-Z0-9]/g, '')
        .toUpperCase();

    return normalized || 'DOC';
};

const formatChipLabel = (value = '') => {
    const normalized = String(value)
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-zA-Z0-9]/g, '')
        .toUpperCase();

    if (!normalized) return 'DOC';
    if (normalized.length >= 3) return normalized.slice(0, 3);
    return normalized.padEnd(3, normalized[normalized.length - 1] || 'X');
};

const getUniqueChipCandidates = (doctor) => {
    const source = normalizeChipSource(doctor);
    const candidates = [];
    const seen = new Set();

    const pushCandidate = (value) => {
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

const buildDoctorChipLabelMap = (doctors = []) => {
    const labelMap = new Map();
    const usedLabels = new Set();
    const groupedDoctors = new Map();

    doctors.forEach((doctor) => {
        const baseLabel = formatChipLabel(normalizeChipSource(doctor).slice(0, 3));
        if (!groupedDoctors.has(baseLabel)) {
            groupedDoctors.set(baseLabel, []);
        }
        groupedDoctors.get(baseLabel).push(doctor);
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

const measureTextWidth = (() => {
    let canvas = null;

    return (text, fontSize) => {
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

const getShiftDisplayMode = ({ doctor, isSplitModeActive, isSingleShift, forceInitialsOnly, cellWidth, gridFontSize, boxSize }) => {
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

const formatTimeslotTimeRange = (startTime, endTime) => {
    if (!startTime || !endTime) return '';
    return `${startTime.substring(0, 5)}-${endTime.substring(0, 5)}`;
};

const DEFAULT_BREAK_MINUTES = 30;
const ROUTINE_SERVICE_START_MINUTES = 7 * 60;
const LATE_ROTATION_THRESHOLD_MINUTES = ROUTINE_SERVICE_START_MINUTES + (4 * 60);

const formatTimeslotStartTime = (startTime) => {
    if (!startTime) return null;
    return startTime.substring(0, 5);
};

const formatMinutesAsTime = (minutes) => {
    if (minutes === null || minutes === undefined || Number.isNaN(Number(minutes))) {
        return null;
    }

    const normalizedMinutes = ((Math.round(Number(minutes)) % (24 * 60)) + (24 * 60)) % (24 * 60);
    const hours = Math.floor(normalizedMinutes / 60);
    const remainingMinutes = normalizedMinutes % 60;
    return `${String(hours).padStart(2, '0')}:${String(remainingMinutes).padStart(2, '0')}`;
};

const formatDurationMinutes = (minutes) => {
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

const parseTimeToMinutes = (timeStr) => {
    if (!timeStr) return null;
    const parts = String(timeStr).split(':');
    if (parts.length < 2) return null;
    const hours = Number(parts[0]);
    const minutes = Number(parts[1]);
    if (Number.isNaN(hours) || Number.isNaN(minutes)) return null;
    return hours * 60 + minutes;
};

const mergePlannedIntervals = (intervals) => {
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

const buildShiftInterval = (shift, doctor, workplace, timeslot, workTimeModelMap, centralEmployeesById) => {
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

const getExpandedTimeslotRowLabel = (rowObj, rowDisplayName) => {
    if (!rowObj?.isTimeslotRow || rowObj?.isUnassignedRow) {
        return rowDisplayName;
    }

    const timeRange = formatTimeslotTimeRange(rowObj.startTime, rowObj.endTime);
    const label = rowObj.timeslotLabel || rowDisplayName;
    return timeRange ? `${label} ${timeRange}` : label;
};

const getRowLabelPresentation = (label, isCompactMode = false) => {
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

const getDoctorTargetDailyHours = (doctor, workTimeModelMap, centralEmployeesById) => {
    if (!doctor) return null;

    const model = doctor.work_time_model_id ? workTimeModelMap.get(doctor.work_time_model_id) : null;
    const centralEmployee = doctor.central_employee_id ? centralEmployeesById.get(String(doctor.central_employee_id)) : null;
    return resolveDoctorTargetDailyHours(doctor, model, centralEmployee);
};

const getDoctorTargetDailyMinutes = (doctor, workTimeModelMap, centralEmployeesById) => {
    const dailyHours = getDoctorTargetDailyHours(doctor, workTimeModelMap, centralEmployeesById);
    if (dailyHours === null || dailyHours === undefined) return null;

    const parsedDailyHours = Number(dailyHours);
    if (!Number.isFinite(parsedDailyHours) || parsedDailyHours <= 0) return null;

    return Math.round(parsedDailyHours * 60);
};

const getTimeslotDerivedTimeRange = (timeslot, doctor, workplace, workTimeModelMap, centralEmployeesById) => {
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

const buildTimeslotSelectionOption = (timeslot, doctor, workplace, workTimeModelMap, centralEmployeesById) => {
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

const normalizeTimeslotSelection = (selection) => {
    if (selection && typeof selection === 'object' && !Array.isArray(selection)) {
        return {
            timeslotId: selection.timeslotId ?? null,
            startTime: selection.startTime ?? null,
            endTime: selection.endTime ?? null,
            breakMinutes: selection.breakMinutes ?? null,
            isCustom: Boolean(selection.isCustom),
        };
    }

    return {
        timeslotId: selection === '__unassigned__' ? null : (selection ?? null),
        startTime: null,
        endTime: null,
        breakMinutes: null,
        isCustom: false,
    };
};

const applyTimeslotSelectionToCreateData = (data, selection) => {
    const normalizedSelection = normalizeTimeslotSelection(selection);
    const nextData = { ...data };

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

const applyTimeslotSelectionToUpdateData = (data, selection) => {
    const normalizedSelection = normalizeTimeslotSelection(selection);
    const nextData = {
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

const getShiftTimeRangeLabel = (shift, doctor, workplace, workplaceTimeslots, workTimeModelMap, centralEmployeesById) => {
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

const getLateRotationIndicator = (shift, workplace, workplaceTimeslots) => {
    if (!shift?.timeslot_id || workplace?.allows_rotation_concurrently !== true) {
        return { show: false, tooltip: null };
    }

    const timeslot = workplaceTimeslots.find((entry) => entry.id === shift.timeslot_id);
    const startMinutes = parseTimeToMinutes(timeslot?.start_time);
    if (startMinutes === null || startMinutes < LATE_ROTATION_THRESHOLD_MINUTES) {
        return { show: false, tooltip: null };
    }

    const startLabel = formatTimeslotStartTime(timeslot.start_time);
    return {
        show: true,
        tooltip: startLabel
            ? `Später Dienst mit Rotationsmöglichkeit ab ${startLabel} — Mitarbeiter ist nicht von Anfang an da.`
            : 'Später Dienst mit Rotationsmöglichkeit — Mitarbeiter ist nicht von Anfang an da.'
    };
};

const LateAvailabilityBadge = ({ tooltip, compact = false }) => (
    <TooltipProvider delayDuration={0}>
        <Tooltip>
            <TooltipTrigger asChild>
                <span
                    className={compact
                        ? 'absolute -top-1 -left-1 z-20 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-slate-900/80 text-[9px] leading-none text-white cursor-help'
                        : 'ml-1 inline-flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full bg-slate-900/80 text-[10px] leading-none text-white cursor-help'}
                    aria-label={tooltip}
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

const TimeslotSummaryHint = ({ summary, details = [], count = 0 }) => {
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

export default function ScheduleBoard() {
    const initialState = useMemo(() => getInitialScheduleState(), []);
    const isEmbeddedSchedule = useMemo(() => {
            const params = new URLSearchParams(window.location.search);
            return params.get('embeddedSchedule') === '1';
    }, []);
  // const { isReadOnly } = useAuth(); // Removed duplicate destructuring
  const isMobile = useIsMobile();
    const [currentDate, setCurrentDate] = useState(initialState.currentDate);
    const [viewMode, setViewMode] = useState(initialState.viewMode); // 'week' | 'day' | 'month'
    const isMonthView = viewMode === 'month';
  const [isGenerating, setIsGenerating] = useState(false);
  const [isCtrlPressed, setIsCtrlPressed] = useState(false);
  const [undoStack, setUndoStack] = useState([]);

  // Cell-lock to prevent race conditions during rapid drag-drops
  // Keys are "date|position" or "date|position|timeslot_id", values are timestamps
  const cellLocksRef = useRef(new Set());
  const lockCell = (date, position, timeslotId) => {
    const key = timeslotId ? `${date}|${position}|${timeslotId}` : `${date}|${position}`;
    if (cellLocksRef.current.has(key)) return false; // Already locked
    cellLocksRef.current.add(key);
    // Auto-release after 3 seconds (safety net)
    setTimeout(() => cellLocksRef.current.delete(key), 3000);
    return true;
  };
  const unlockCell = (date, position, timeslotId) => {
    const key = timeslotId ? `${date}|${position}|${timeslotId}` : `${date}|${position}`;
    cellLocksRef.current.delete(key);
  };

  const handleUndo = async () => {
      if (undoStack.length === 0) return;
      const item = undoStack[undoStack.length - 1];
      
      // Remove from stack immediately
      setUndoStack(prev => prev.slice(0, -1));

      const actions = Array.isArray(item) ? item : [item];

      try {
          for (const action of actions) {
              if (action.type === 'DELETE') {
                  await db.ShiftEntry.delete(action.id);
              } else if (action.type === 'CREATE') {
                  await db.ShiftEntry.create(action.data);
              } else if (action.type === 'UPDATE') {
                  await db.ShiftEntry.update(action.id, action.data);
              } else if (action.type === 'BULK_CREATE') {
                  await db.ShiftEntry.bulkCreate(action.data);
              } else if (action.type === 'BULK_DELETE') {
                  await Promise.all(action.ids.map(id => db.ShiftEntry.delete(id)));
              }
          }
          queryClient.invalidateQueries(['shifts']);
      } catch (e) {
          console.error("Undo failed", e);
          alert("Rückgängig fehlgeschlagen: " + e.message);
      }
  };

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Control') setIsCtrlPressed(true);
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
          e.preventDefault();
          handleUndo();
      }
    };
    const handleKeyUp = (e) => {
      if (e.key === 'Control') setIsCtrlPressed(false);
    };
    const handleBlur = () => setIsCtrlPressed(false);

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleBlur);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleBlur);
    };
  }, [undoStack]);

    const { isReadOnly, user, updateMe, can: _can } = useAuth();

  // Load saved settings from user profile or localStorage fallback
  const [showSidebar, setShowSidebar] = useState(() => {
      if (user?.schedule_show_sidebar !== undefined) return user.schedule_show_sidebar;
      try {
          const saved = localStorage.getItem('radioplan_showSidebar');
          return saved ? JSON.parse(saved) : true;
    } catch { return true; }
  });
  
  const [hiddenRows, setHiddenRows] = useState(() => {
      if (user?.schedule_hidden_rows && Array.isArray(user.schedule_hidden_rows)) return user.schedule_hidden_rows;
      try {
          const saved = localStorage.getItem('radioplan_hiddenRows');
          return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });
  
  // Use dynamic holiday calculator instead of static MV functions
  const currentYear = useMemo(() => new Date(currentDate).getFullYear(), [currentDate]);
  const { isPublicHoliday, isSchoolHoliday } = useHolidays(currentYear);
  
    // Tenant-specific section configuration
  const { getSectionName, getSectionOrder } = useSectionConfig();

  const [collapsedSections, setCollapsedSections] = useState(() => {
      // Try user prefs first, then localStorage as fallback (migration), then empty
      if (user?.collapsed_sections) return user.collapsed_sections;
      try {
          const saved = localStorage.getItem('radioplan_collapsedSections');
          return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });

  const [highlightMyName, setHighlightMyName] = useState(() => {
      if (user?.highlight_my_name !== undefined) return user.highlight_my_name;
      try {
          const saved = localStorage.getItem('radioplan_highlightMyName');
          return saved ? JSON.parse(saved) : true;
    } catch { return true; }
  });

  const [showInitialsOnly, setShowInitialsOnly] = useState(() => {
      if (user?.schedule_initials_only !== undefined) return user.schedule_initials_only;
      try {
          const saved = localStorage.getItem('radioplan_showInitialsOnly');
          return saved ? JSON.parse(saved) : false;
    } catch { return false; }
  });

  const [sortDoctorsAlphabetically, setSortDoctorsAlphabetically] = useState(() => {
      if (user?.schedule_sort_doctors_alphabetically !== undefined) return user.schedule_sort_doctors_alphabetically;
      try {
          const saved = localStorage.getItem('radioplan_sortDoctorsAlphabetically');
          return saved ? JSON.parse(saved) : false;
    } catch { return false; }
  });

    const [showSidebarTimeAccount, setShowSidebarTimeAccount] = useState(() => {
            if (user?.schedule_show_time_account !== undefined) return user.schedule_show_time_account;
            try {
                    const saved = localStorage.getItem('radioplan_showSidebarTimeAccount');
                    return saved ? JSON.parse(saved) : false;
        } catch { return false; }
    });

    const [selectedQualificationIds, setSelectedQualificationIds] = useState([]);
    const [scheduleFilterOpen, setScheduleFilterOpen] = useState(false);
    // Single active row-scoped qualification filter. Replacing it on a different
    // row; clicking the same row's filter icon again clears it.
    const [rowQualFilter, setRowQualFilter] = useState(null);
    // { key, sourceName, workplaceId, includeIds, excludeIds } | null

  // Sync with user profile when it loads/updates
  useEffect(() => {
      if (user?.collapsed_sections && Array.isArray(user.collapsed_sections)) {
          setCollapsedSections(prev => {
              // Only update if significantly different to avoid overwriting local interactions during sync
              if (JSON.stringify(prev) !== JSON.stringify(user.collapsed_sections)) {
                  return user.collapsed_sections;
              }
              return prev;
          });
      }
      if (user?.highlight_my_name !== undefined) {
          setHighlightMyName(user.highlight_my_name);
      }
      if (user?.schedule_initials_only !== undefined) {
          setShowInitialsOnly(user.schedule_initials_only);
      }
      if (user?.schedule_sort_doctors_alphabetically !== undefined) {
          setSortDoctorsAlphabetically(user.schedule_sort_doctors_alphabetically);
      }
      if (user?.schedule_show_time_account !== undefined) {
          setShowSidebarTimeAccount(user.schedule_show_time_account);
      }
  }, [user]);

  useEffect(() => {
      localStorage.setItem('radioplan_highlightMyName', JSON.stringify(highlightMyName));
      if (user && user.highlight_my_name !== highlightMyName) {
          updateMe({ highlight_my_name: highlightMyName }).catch(e => console.error("Pref save failed", e));
      }
  }, [highlightMyName, updateMe, user]);

  useEffect(() => {
      localStorage.setItem('radioplan_showInitialsOnly', JSON.stringify(showInitialsOnly));
      if (user && user.schedule_initials_only !== showInitialsOnly) {
          updateMe({ schedule_initials_only: showInitialsOnly }).catch(e => console.error("Pref save failed", e));
      }
  }, [showInitialsOnly, updateMe, user]);

  useEffect(() => {
      localStorage.setItem('radioplan_sortDoctorsAlphabetically', JSON.stringify(sortDoctorsAlphabetically));
      if (user && user.schedule_sort_doctors_alphabetically !== sortDoctorsAlphabetically) {
          updateMe({ schedule_sort_doctors_alphabetically: sortDoctorsAlphabetically }).catch(e => console.error("Pref save failed", e));
      }
  }, [sortDoctorsAlphabetically, updateMe, user]);

  useEffect(() => {
      localStorage.setItem('radioplan_showSidebarTimeAccount', JSON.stringify(showSidebarTimeAccount));
      if (user && user.schedule_show_time_account !== showSidebarTimeAccount) {
          updateMe({ schedule_show_time_account: showSidebarTimeAccount }).catch(e => console.error("Pref save failed", e));
      }
  }, [showSidebarTimeAccount, updateMe, user]);

  const sortDoctorsForDisplay = (doctorList = []) => {
      if (!sortDoctorsAlphabetically) {
          return doctorList;
      }

      return [...doctorList].sort((a, b) => {
          const nameDiff = (a?.name || '').localeCompare(b?.name || '', 'de', { sensitivity: 'base' });
          if (nameDiff !== 0) return nameDiff;

          return (a?.initials || '').localeCompare(b?.initials || '', 'de', { sensitivity: 'base' });
      });
  };



  const [gridFontSize, setGridFontSize] = useState(() => {
      try {
          const saved = localStorage.getItem('radioplan_gridFontSize');
          return saved ? JSON.parse(saved) : 14;
    } catch { return 14; }
  });

  // Sync with user profile when it loads/updates (for sidebar/hiddenRows)
  useEffect(() => {
      if (user?.schedule_show_sidebar !== undefined) {
          setShowSidebar(user.schedule_show_sidebar);
      }
      if (user?.schedule_hidden_rows && Array.isArray(user.schedule_hidden_rows)) {
          setHiddenRows(prev => {
              if (JSON.stringify(prev) !== JSON.stringify(user.schedule_hidden_rows)) {
                  return user.schedule_hidden_rows;
              }
              return prev;
          });
      }
  }, [user]);

  // Save settings on change
  useEffect(() => {
      localStorage.setItem('radioplan_showSidebar', JSON.stringify(showSidebar));
      if (user && user.schedule_show_sidebar !== showSidebar) {
          updateMe({ schedule_show_sidebar: showSidebar }).catch(e => console.error("Pref save failed", e));
      }
  }, [showSidebar, updateMe, user]);

  useEffect(() => {
      localStorage.setItem('radioplan_hiddenRows', JSON.stringify(hiddenRows));
      if (user && JSON.stringify(user.schedule_hidden_rows) !== JSON.stringify(hiddenRows)) {
          updateMe({ schedule_hidden_rows: hiddenRows }).catch(e => console.error("Pref save failed", e));
      }
  }, [hiddenRows, updateMe, user]);

  useEffect(() => {
      localStorage.setItem('radioplan_collapsedSections', JSON.stringify(collapsedSections));
      
      // Persist to backend if user is logged in
      if (user) {
          // Debounce or direct? Direct is fine for clicks. 
          // We need to be careful not to create a loop with the user effect above.
          // The user effect checks for equality, so it should be fine.
          // However, updateMe triggers user update which triggers effect.
          // We should only updateMe if the value is different from what's in user object currently.
          if (JSON.stringify(user.collapsed_sections) !== JSON.stringify(collapsedSections)) {
             updateMe({ collapsed_sections: collapsedSections }).catch(e => console.error("Pref save failed", e));
          }
      }
  }, [collapsedSections, updateMe, user]);

    const dragAutoScrollerOptions = useMemo(() => ({
        startFromPercentage: 0.12,
        maxScrollAtPercentage: 0.04,
        maxPixelScroll: 30,
            ease: (value) => value,
    }), []);

  useEffect(() => {
      localStorage.setItem('radioplan_gridFontSize', JSON.stringify(gridFontSize));
  }, [gridFontSize]);
    const effectiveGridFontSize = isMonthView ? Math.min(gridFontSize, 11) : gridFontSize;
    const shiftBoxSize = isMonthView ? Math.max(effectiveGridFontSize * 2.8, 30) : effectiveGridFontSize * 3.5;
  const [previewShifts, setPreviewShifts] = useState(null);
    const [, setPreviewCategories] = useState(null); // welche Kategorien im Vorschlag
  const [draggingDoctorId, setDraggingDoctorId] = useState(null);
  const [draggingShiftId, setDraggingShiftId] = useState(null);
  const [isDraggingFromGrid, setIsDraggingFromGrid] = useState(false);
    const [activeSectionTabId, setActiveSectionTabId] = useState(initialState.activeSectionTabId);
    const [isSplitViewEnabled, setIsSplitViewEnabled] = useState(false);
    const [splitSectionTabId, setSplitSectionTabId] = useState('');

  const queryClient = useQueryClient();

  // Dynamische Rollenprioritäten aus DB laden
  const { rolePriority } = useTeamRoles();

  // Fetch data with optimized caching
  const { data: doctors = [] } = useQuery({
    queryKey: ['doctors'],
    queryFn: () => db.Doctor.list(),
    staleTime: 5 * 60 * 1000, // 5 minutes
    refetchOnWindowFocus: false,
    select: (data) => [...data].sort((a, b) => {
      const roleDiff = (rolePriority[a.role] ?? 99) - (rolePriority[b.role] ?? 99);
      if (roleDiff !== 0) return roleDiff;
      return (a.order || 0) - (b.order || 0);
    }),
  });

  const updateDoctorMutation = useMutation({
    mutationFn: ({ id, data }) => db.Doctor.update(id, data),
    onSuccess: () => queryClient.invalidateQueries(['doctors']),
  });

  const fetchRange = useMemo(() => {
      if (!isValid(currentDate)) {
          console.warn("Invalid currentDate detected, using fallback range");
          return { start: format(new Date(), 'yyyy-MM-dd'), end: format(new Date(), 'yyyy-MM-dd') };
      }
      const start = startOfMonth(addMonths(currentDate, -1));
      const end = endOfMonth(addMonths(currentDate, 1));
      return {
          start: format(start, 'yyyy-MM-dd'),
          end: format(end, 'yyyy-MM-dd')
      };
  }, [currentDate]);

  const { data: allShifts = [] } = useQuery({
    queryKey: ['shifts', fetchRange.start, fetchRange.end],
    queryFn: () => db.ShiftEntry.filter({
        date: { $gte: fetchRange.start, $lte: fetchRange.end }
    }, null, 5000),
    keepPreviousData: true,
    staleTime: 30 * 1000, // 30 seconds cache
  });

    const { data: visiblePoolData } = useQuery({
        queryKey: ['pool', 'visible-shifts', fetchRange.start, fetchRange.end],
        queryFn: () => api.getVisiblePoolShifts({ from: fetchRange.start, to: fetchRange.end }),
        staleTime: 30 * 1000,
        refetchOnWindowFocus: false,
        // Keep prior data visible while a new fetch (e.g. after view switch) is in-flight.
        // Without this the cross-tenant rows would disappear on every key change because
        // React Query v5 no longer honours the legacy `keepPreviousData: true` option.
        placeholderData: keepPreviousData,
    });

    const visiblePoolShifts = visiblePoolData?.shifts || [];
    const crossTenantWorkplaces = visiblePoolData?.workplaces || [];

    // Read-only cross-tenant staffing mirror (e.g. Radiology "CT" ↔ MTR "CT1"/"CT2").
    // Only fetched/shown in day view — see docs/features/WORKPLACE_LINKS.md.
    const { data: visibleWorkplaceLinksData } = useQuery({
        queryKey: ['workplace-links', 'visible-links', fetchRange.start, fetchRange.end],
        queryFn: () => api.getVisibleWorkplaceLinks({ from: fetchRange.start, to: fetchRange.end }),
        enabled: viewMode === 'day' || viewMode === 'week',
        staleTime: 30 * 1000,
        refetchOnWindowFocus: false,
        placeholderData: keepPreviousData,
    });

    const linkedWorkplacesByName = visibleWorkplaceLinksData?.linkedWorkplaces || {};
    const activeLinkTenantId = visibleWorkplaceLinksData?.tenantId || null;

    // ===== Springerpool-Rotationen (separates System) =====
    const { data: visibleRotationData } = useQuery({
        queryKey: ['rotations', 'visible-rotations', fetchRange.start, fetchRange.end],
        queryFn: () => api.getVisibleRotations({ from: fetchRange.start, to: fetchRange.end }),
        staleTime: 30 * 1000,
        refetchOnWindowFocus: false,
        placeholderData: keepPreviousData,
    });

    const rotationWorkplaces = visibleRotationData?.workplaces || [];
    const rotationAssignments = visibleRotationData?.assignments || [];
    const rotationDemands = visibleRotationData?.demands || [];

    // Map assignments by `${rotation_workplace_id}|${date}` for fast cell lookup.
    const rotationAssignmentsByCell = useMemo(() => {
        const map = new Map();
        for (const assignment of rotationAssignments) {
            const key = `${assignment.rotation_workplace_id}|${String(assignment.date).slice(0, 10)}`;
            const list = map.get(key) || [];
            list.push(assignment);
            map.set(key, list);
        }
        return map;
    }, [rotationAssignments]);

    // Map demands by `${rotation_workplace_id}|${date}|${timeslot_id}` for cell overlay.
    const rotationDemandsByCell = useMemo(() => {
        const map = new Map();
        for (const demand of rotationDemands) {
            const key = `${demand.rotation_workplace_id}|${String(demand.date).slice(0, 10)}|${demand.timeslot_id || ''}`;
            map.set(key, demand);
        }
        return map;
    }, [rotationDemands]);

    // Open return-request demands indexed by the assignment they want back.
    // Used by the pool planner to color assignment chips red and show a badge
    // even when the demand sits on a different (ward) workplace.
    const openReturnRequestByAssignmentId = useMemo(() => {
        const map = new Map();
        for (const demand of rotationDemands) {
            if (demand.status === 'open' && demand.return_requested_assignment_id) {
                map.set(String(demand.return_requested_assignment_id), demand);
            }
        }
        return map;
    }, [rotationDemands]);

    // Local state for the rotation dialogs launched from the board cells.
    const [rotationAssignmentDialog, setRotationAssignmentDialog] = useState({ open: false, workplace: null, date: null, assignment: null, timeslotId: null, defaultEmployeeId: null });
    const [rotationDemandDialog, setRotationDemandDialog] = useState({
        open: false,
        workplace: null,
        date: null,
        timeslot: null,
        existingDemand: null,
    });

    // Set of Springer chip IDs the user has dragged away from the Verfügbar row.
    // These are hidden until the page is refreshed (they remain in rotation_assignments).
    const [hiddenSpringerChipIds, setHiddenSpringerChipIds] = useState(new Set());

    // Set of `${doctorId}|${dateStr}` for ward employees that have been
    // offered as Joker to the pool. Hides the doctor chip from the
    // Verfügbar row until the page is refreshed.
    const [hiddenJokerDoctorIds, setHiddenJokerDoctorIds] = useState(new Set());

    // Map shifts by `${shared_workplace_id}|${date}` for fast cell lookup.
    const crossTenantShiftsByCell = useMemo(() => {
        const map = new Map();
        for (const shift of visiblePoolShifts) {
            const key = `${shift.shared_workplace_id}|${String(shift.date).slice(0, 10)}`;
            const list = map.get(key) || [];
            list.push(shift);
            map.set(key, list);
        }
        return map;
    }, [visiblePoolShifts]);

    // Local state for the cross-tenant edit dialog launched from the board cells.
    const [poolEditDialog, setPoolEditDialog] = useState({ open: false, workplace: null, date: null, shift: null });
    const pendingTimeslotSelectionRef = useRef(null);
    const [timeslotSelectionDialog, setTimeslotSelectionDialog] = useState({
        open: false,
        workplaceName: '',
        description: '',
        options: [],
        allowCustomEditing: false,
        customEndMinutesByOptionId: {},
        customStartMinutesByOptionId: {},
        activeTimeslotId: null,
    });

    const openPoolEditDialog = (workplace, dateStr, shift = null) => {
        setPoolEditDialog({ open: true, workplace, date: dateStr, shift });
    };

    const closeTimeslotSelectionDialog = () => {
        pendingTimeslotSelectionRef.current = null;
        setTimeslotSelectionDialog({
            open: false,
            workplaceName: '',
            description: '',
            options: [],
            allowCustomEditing: false,
            customEndMinutesByOptionId: {},
            customStartMinutesByOptionId: {},
            activeTimeslotId: null,
        });
    };

    const handleTimeslotDialogOpenChange = (open) => {
        if (!open) {
            closeTimeslotSelectionDialog();
        }
    };

    const handleTimeslotDialogSelect = (timeslotId) => {
        const callback = pendingTimeslotSelectionRef.current;
        closeTimeslotSelectionDialog();
        callback?.(timeslotId);
    };

    const handleTimeslotCustomEndChange = (timeslotId, option, value) => {
        // Nur den reinen Minutenwert parsen, OHNE die start+5min-Floor-Logik.
        // Die Floor-Logik in normalizeCustomTimeslotEndMinutes würde sonst
        // während des Tippens einen Zwischenwert (z. B. Browser liefert "01:00"
        // bei Eingabe von "1") auf start+5min hochclampen und das Feld zurücksetzen.
        const parsedMinutes = parseTimeToMinutes(value);
        if (!Number.isFinite(parsedMinutes)) return;

        setTimeslotSelectionDialog((current) => ({
            ...current,
            customEndMinutesByOptionId: {
                ...current.customEndMinutesByOptionId,
                [timeslotId]: parsedMinutes,
            },
        }));
    };

    const handleTimeslotCustomStartChange = (timeslotId, option, value) => {
        const parsedMinutes = parseTimeToMinutes(value);
        if (!Number.isFinite(parsedMinutes)) return;

        const normalizedStartMinutes = normalizeCustomTimeslotStartMinutes(option, value);

        setTimeslotSelectionDialog((current) => ({
            ...current,
            customStartMinutesByOptionId: {
                ...current.customStartMinutesByOptionId,
                [timeslotId]: normalizedStartMinutes,
            },
        }));
    };

    const handleTimeslotCustomApply = (option) => {
        const callback = pendingTimeslotSelectionRef.current;
        if (!callback || !option?.id) return;

        // Rohwert aus dem Dialog (während des Tippens ohne Floor gespeichert)
        const rawEndMinutes = timeslotSelectionDialog.customEndMinutesByOptionId?.[option.id];
        const customEndMinutes = Number.isFinite(rawEndMinutes)
            ? normalizeCustomTimeslotEndMinutes(option, formatMinutesAsTime(rawEndMinutes))
            : getDefaultCustomTimeslotEndMinutes(option);
        const customStartMinutes = timeslotSelectionDialog.customStartMinutesByOptionId?.[option.id]
            ?? option.effectiveStartMinutes ?? option.slotStartMinutes;
        if (!Number.isFinite(customStartMinutes) || !Number.isFinite(customEndMinutes)) return;

        closeTimeslotSelectionDialog();
        callback({
            timeslotId: option.id,
            startTime: formatMinutesAsTime(customStartMinutes),
            endTime: formatMinutesAsTime(customEndMinutes),
            breakMinutes: option.customBreakMinutes ?? 0,
            isCustom: true,
        });
    };

    // Map of date → Set of central_employee_ids busy on that date. Used to
    // hide already-absent employees from the PoolShiftEditDialog dropdown.
    const busyCentralIdsByDate = useMemo(() => {
        const ABSENCE_POSITIONS = ['Frei', 'Krank', 'Urlaub', 'Dienstreise', 'Nicht verfügbar'];
        const doctorToCentral = new Map();
        for (const d of doctors) {
            if (d.central_employee_id) doctorToCentral.set(d.id, String(d.central_employee_id));
        }
        const map = {};
        const add = (dateStr, centralId) => {
            const key = String(dateStr).slice(0, 10);
            if (!map[key]) map[key] = new Set();
            map[key].add(String(centralId));
        };
        const nextWorkdayIso = (dateStr) => {
            const next = new Date(`${dateStr}T00:00:00Z`);
            next.setUTCDate(next.getUTCDate() + 1);
            const day = next.getUTCDay();
            if (day === 0 || day === 6) return null;
            const iso = next.toISOString().slice(0, 10);
            try { if (isPublicHoliday(next)) return null; } catch { /* ignore */ }
            return iso;
        };
        for (const s of allShifts) {
            if (!ABSENCE_POSITIONS.includes(s.position)) continue;
            const central = doctorToCentral.get(s.doctor_id);
            if (central) add(s.date, central);
        }
        for (const s of visiblePoolShifts) {
            if (!s.employee_id) continue;
            const dateStr = String(s.date).slice(0, 10);
            if (s.affects_availability !== false) add(dateStr, s.employee_id);
            const impliesAutoFrei = s.auto_off === true
                || (s.auto_off == null && s.workplace_category === 'Dienste');
            if (impliesAutoFrei) {
                const nd = nextWorkdayIso(dateStr);
                if (nd) add(nd, s.employee_id);
            }
        }
        return map;
    }, [allShifts, visiblePoolShifts, doctors, isPublicHoliday]);

  // Query to fetch shifts for the 4-week fairness window relative to the planning period.
  // The autoFill engine uses 3 weeks before firstPlanDate → lastPlanDate.
  // We mirror that: 21 days before fetchRange.start through fetchRange.end.
  const fairnessRange = useMemo(() => {
    const s = new Date(fetchRange.start + 'T00:00:00');
    const histStart = subDays(s, 21); // 3 weeks before the earliest fetched month
    return {
      start: format(histStart, 'yyyy-MM-dd'),
      end: fetchRange.end,
    };
  }, [fetchRange]);

  const { data: fairnessShifts = [] } = useQuery({
    queryKey: ['shifts-history', fairnessRange.start, fairnessRange.end],
    queryFn: () => db.ShiftEntry.filter({
      date: { $gte: fairnessRange.start, $lte: fairnessRange.end }
    }),
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const { data: wishes = [] } = useQuery({
    queryKey: ['wishes', fetchRange.start, fetchRange.end],
    queryFn: () => db.WishRequest.filter({
                date: {
                    $gte: format(subDays(new Date(`${fetchRange.start}T00:00:00`), 370), 'yyyy-MM-dd'),
                    $lte: format(addDays(new Date(`${fetchRange.end}T00:00:00`), 370), 'yyyy-MM-dd')
                }
    }),
    staleTime: 2 * 60 * 1000,
    refetchOnWindowFocus: false,
    keepPreviousData: true,
  });

  const { data: workplaces = [] } = useQuery({
    queryKey: ['workplaces'],
    queryFn: () => db.Workplace.list(null, 1000),
    staleTime: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  // Timeslots für Zeitfenster-Feature
  const { data: workplaceTimeslots = [] } = useQuery({
    queryKey: ['workplaceTimeslots'],
    queryFn: () => db.WorkplaceTimeslot.list(null, 1000),
    staleTime: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

    const { data: systemSettings = [], isLoading: isLoadingSystemSettings } = useQuery({
    queryKey: ['systemSettings'],
    queryFn: () => db.SystemSetting.list(),
    staleTime: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

        const workplaceTimeslotsByWorkplaceId = useMemo(() => {
                const map = new Map();

                workplaceTimeslots.forEach((timeslot) => {
                        const key = timeslot.workplace_id;
                        const list = map.get(key) || [];
                        list.push(timeslot);
                        map.set(key, list);
                });

                map.forEach((list, key) => {
                        map.set(key, [...list].sort((a, b) => (a.order || 0) - (b.order || 0)));
                });

                return map;
        }, [workplaceTimeslots]);

    const updateSystemSettingMutation = useMutation({
        mutationFn: async ({ key, value }) => {
            const existing = systemSettings.find(s => s.key === key);
            if (existing) {
                return db.SystemSetting.update(existing.id, { value });
            }
            return db.SystemSetting.create({ key, value });
        },
        onSuccess: () => queryClient.invalidateQueries(['systemSettings'])
    });

    const sectionTabs = useMemo(() => {
        const tabSetting = systemSettings.find(s => s.key === SECTION_TABS_KEY);
        return parseSectionTabs(tabSetting?.value);
    }, [systemSettings]);

    const alwaysVisibleRows = useMemo(() => {
        const setting = systemSettings.find(s => s.key === ALWAYS_VISIBLE_ROWS_KEY);
        return parseAlwaysVisibleRows(setting?.value);
    }, [systemSettings]);

  // Stellenplan-Einträge für die Sidebar-Filterung laden
  const staffingYear = useMemo(() => currentDate ? new Date(currentDate).getFullYear() : new Date().getFullYear(), [currentDate]);
  const { data: staffingPlanEntries = [] } = useQuery({
    queryKey: ['staffingPlanEntries', staffingYear],
    queryFn: () => db.StaffingPlanEntry.filter({ year: staffingYear }),
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  // Arbeitszeitmodelle aus Master-DB laden
  const { data: workTimeModels = [] } = useQuery({
    queryKey: ['workTimeModels'],
    queryFn: async () => {
      const res = await api.request('/api/staff/work-time-models');
      return res.models || [];
    },
    staleTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  // Lookup: work_time_model_id → { name, hours_per_week, hours_per_day }
  const workTimeModelMap = useMemo(() => {
    const map = new Map();
    for (const m of workTimeModels) {
      map.set(m.id, m);
    }
    return map;
  }, [workTimeModels]);

    const { data: centralEmployees = [] } = useQuery({
        queryKey: ['tenant-central-employees-for-schedule'],
        queryFn: async () => {
            try {
                const res = await api.request('/api/staff/central-employees');
                return res.employees || [];
            } catch {
                return [];
            }
        },
        staleTime: 10 * 60 * 1000,
        refetchOnWindowFocus: false,
    });

    const centralEmployeesById = useMemo(() => {
        const map = new Map();
        for (const employee of centralEmployees) {
            map.set(String(employee.id), employee);
        }
        return map;
    }, [centralEmployees]);


    const allSections = useMemo(() => {
      // Get custom categories from settings
            const customCategories = getWorkplaceCategoriesFromSettings(systemSettings);
            const customCategoryNames = customCategories.map(category => category.name);

      // Hilfsfunktion: Erstellt Zeilen für Arbeitsplätze (kompakt mit optionalen Timeslot-Metadaten)
      const createRowsForCategory = (categoryName) => {
          const categoryWorkplaces = workplaces
              .filter(w => w.category === categoryName)
              .sort((a, b) => (a.order || 0) - (b.order || 0));
          
          const rows = [];
          for (const wp of categoryWorkplaces) {
              if (wp.timeslots_enabled) {
                  const wpTimeslots = workplaceTimeslotsByWorkplaceId.get(wp.id) || [];
                  
                  if (wpTimeslots.length === 1) {
                      // NUR 1 Timeslot: Verhalte dich wie normaler Workplace
                      // Mitarbeiter werden automatisch in den ersten Timeslot eingetragen
                      rows.push({ 
                          name: wp.name, 
                          displayName: wp.name, 
                          timeslotId: null, 
                          isTimeslotRow: false, 
                          isTimeslotGroupHeader: false,
                          // Speichere den einzigen Timeslot für automatische Zuweisung
                          singleTimeslotId: wpTimeslots[0].id,
                          singleTimeslotLabel: wpTimeslots[0].label
                      });
                  } else if (wpTimeslots.length > 1) {
                      const timeslotDetails = wpTimeslots
                          .map((timeslot) => {
                              const range = formatTimeslotTimeRange(timeslot.start_time, timeslot.end_time);
                              return timeslot.label ? `${timeslot.label}${range ? ` ${range}` : ''}` : range;
                          })
                          .filter(Boolean);

                      rows.push({
                          name: wp.name,
                          displayName: wp.name,
                          timeslotId: null,
                          timeslotLabel: null,
                          isTimeslotRow: false,
                          isTimeslotGroupHeader: false,
                          timeslotCount: wpTimeslots.length,
                          allTimeslotIds: wpTimeslots.map(t => t.id),
                          workplaceId: wp.id,
                          timeslotDetails,
                          timeslotSummary: timeslotDetails.join(' · ')
                      });
                  } else {
                      // Timeslots aktiviert aber noch keine definiert
                      rows.push({ name: wp.name, displayName: wp.name, timeslotId: null, isTimeslotRow: false, isTimeslotGroupHeader: false });
                  }
              } else {
                  // Standard: Eine Zeile
                  rows.push({ name: wp.name, displayName: wp.name, timeslotId: null, isTimeslotRow: false, isTimeslotGroupHeader: false });
              }
          }
          return rows;
      };

      const dynamicRows = {
          "Dienste": createRowsForCategory("Dienste"),
          "Rotationen": createRowsForCategory("Rotationen"),
          "Demonstrationen & Konsile": createRowsForCategory("Demonstrationen & Konsile")
      };

      // Add custom categories to dynamicRows
      for (const categoryName of customCategoryNames) {
          dynamicRows[categoryName] = createRowsForCategory(categoryName);
      }

      // Append cross-tenant (group) workplaces to the "Dienste" section.
      // These rows are NOT drop targets — they are managed via the
      // PoolShiftEditDialog when the user clicks a cell.
      for (const wp of crossTenantWorkplaces) {
          dynamicRows["Dienste"].push({
              name: `__cross_${wp.id}`,
              displayName: `${wp.name} (Gruppendienst)`,
              timeslotId: null,
              isTimeslotRow: false,
              isTimeslotGroupHeader: false,
              isCrossTenantRow: true,
              crossTenantWorkplace: wp,
          });
      }

      // Append Springerpool-Rotationen — je nach Rolle in den passenden Bereich.
      // Pool-Administratoren (canWrite=true) sehen die Zeilen als normale
      // Rotationszeilen im Bereich "Rotationen" (Header = Name wie "Gyn 3", damit
      // der Pool-Planer die Stationen unterscheiden kann).
      // Stations-Mandanten (canWrite=false) sehen ihre eigene Zeile im Bereich
      // "Pool-Rotationen" — dort ist der Workplace-Name redundant (sie sehen eh nur
      // ihre eigene Zeile), daher zeigen wir den Header "Springerpool" an.
      const poolRotationRows = [];
      const wardRotationRows = [];
      for (const wp of rotationWorkplaces) {
          const row = {
              name: `__rotation_${wp.id}`,
              displayName: wp.canWrite ? wp.name : 'Springerpool',
              timeslotId: null,
              isTimeslotRow: false,
              isTimeslotGroupHeader: false,
              isRotationRow: true,
              rotationWorkplace: wp,
          };
          if (wp.canWrite) {
              poolRotationRows.push(row);
          } else {
              wardRotationRows.push(row);
          }
      }
      dynamicRows["Rotationen"].push(...poolRotationRows);
      dynamicRows["Pool-Rotationen"] = wardRotationRows;

      // Für statische Sections: Einfache String-zu-Objekt Konvertierung
      const staticRowsToObjects = (rows) => rows.map(name => ({ 
          name, displayName: name, timeslotId: null, isTimeslotRow: false 
      }));

      // Find Orphaned Positions - jetzt mit Namen aus dynamicRows
      const allKnownPositions = new Set([
          ...STATIC_SECTIONS["Anwesenheiten"].rows,
          ...STATIC_SECTIONS["Abwesenheiten"].rows,
          ...dynamicRows["Dienste"].map(r => r.name),
          ...dynamicRows["Rotationen"].map(r => r.name),
          ...dynamicRows["Demonstrationen & Konsile"].map(r => r.name),
          ...(dynamicRows["Pool-Rotationen"] || []).map(r => r.name),
          ...customCategoryNames.flatMap(categoryName => (dynamicRows[categoryName] || []).map(r => r.name)),
          ...STATIC_SECTIONS["Sonstiges"].rows
      ]);

      const currentViewShifts = previewShifts 
          ? [...allShifts, ...previewShifts]
          : allShifts;

      // We only care about shifts in the current view range roughly, but better to check all loaded shifts
      const orphanedPositions = Array.from(new Set(
          currentViewShifts
              .map(s => s.position)
              .filter(p => !allKnownPositions.has(p))
      )).sort();

      // Build sections with default order
      const defaultSections = [
          { title: "Abwesenheiten", ...STATIC_SECTIONS["Abwesenheiten"], rows: staticRowsToObjects(STATIC_SECTIONS["Abwesenheiten"].rows) },
          { 
              title: "Dienste", 
              ...STATIC_SECTIONS["Dienste"],
              rows: dynamicRows["Dienste"]
          },
          { 
              title: "Rotationen", 
              ...SECTION_CONFIG["Rotationen"], 
              rows: dynamicRows["Rotationen"] 
          },
          { title: "Anwesenheiten", ...STATIC_SECTIONS["Anwesenheiten"], rows: staticRowsToObjects(STATIC_SECTIONS["Anwesenheiten"].rows) },
          { 
              title: "Demonstrationen & Konsile", 
              ...SECTION_CONFIG["Demonstrationen & Konsile"], 
              rows: dynamicRows["Demonstrationen & Konsile"] 
          },
          {
              title: "Pool-Rotationen",
              ...SECTION_CONFIG["Pool-Rotationen"],
              rows: dynamicRows["Pool-Rotationen"] || []
          },
          // Add custom categories dynamically
          ...customCategoryNames.map(categoryName => ({
              title: categoryName,
              headerColor: "bg-indigo-100 text-indigo-900",
              rowColor: "bg-indigo-50/30",
              rows: dynamicRows[categoryName] || []
          })),
          { title: "Sonstiges", ...STATIC_SECTIONS["Sonstiges"], rows: staticRowsToObjects(STATIC_SECTIONS["Sonstiges"].rows) }
      ];
      
      // Apply user-specific order
      const orderedTitles = getSectionOrder();
      const result = orderedTitles
          .map(title => defaultSections.find(s => s.title === title))
          .filter(Boolean);
      
      // Add any sections that are new and not yet in the order
      for (const section of defaultSections) {
          if (!result.find(r => r.title === section.title)) {
              // Insert before "Sonstiges" if possible, otherwise at end
              const sonstigesIdx = result.findIndex(r => r.title === "Sonstiges");
              if (sonstigesIdx >= 0) {
                  result.splice(sonstigesIdx, 0, section);
              } else {
                  result.push(section);
              }
          }
      }

      if (orphanedPositions.length > 0) {
          result.push({
              title: "Archiv / Unbekannt",
              headerColor: "bg-red-100 text-red-900",
              rowColor: "bg-red-50/30",
              rows: staticRowsToObjects(orphanedPositions)
          });
      }

      return result;
    }, [workplaces, workplaceTimeslotsByWorkplaceId, allShifts, previewShifts, getSectionOrder, systemSettings, crossTenantWorkplaces, rotationWorkplaces]);

    const availableSectionTabs = useMemo(() => {
        const knownTitles = new Set(allSections.map(s => s.title));
        return sectionTabs.filter(tab => knownTitles.has(tab.sectionTitle) && tab.sectionTitle !== PINNED_SECTION_TITLE);
    }, [sectionTabs, allSections]);

    const renderedSections = useMemo(() => {
        return applyAlwaysVisibleRowsToSections(allSections, alwaysVisibleRows);
    }, [allSections, alwaysVisibleRows]);

    useEffect(() => {
        if (isLoadingSystemSettings) return;
        if (activeSectionTabId === 'main') return;
        if (!availableSectionTabs.find(t => t.id === activeSectionTabId)) {
            setActiveSectionTabId('main');
        }
    }, [activeSectionTabId, availableSectionTabs, isLoadingSystemSettings]);

    useEffect(() => {
        if (isSplitViewEnabled && activeSectionTabId !== 'main') {
            setActiveSectionTabId('main');
        }
    }, [isSplitViewEnabled, activeSectionTabId]);

    useEffect(() => {
        if (!availableSectionTabs.length) {
            setIsSplitViewEnabled(false);
            setSplitSectionTabId('');
            return;
        }

        if (splitSectionTabId && !availableSectionTabs.some(t => t.id === splitSectionTabId)) {
            setSplitSectionTabId(availableSectionTabs[0].id);
        }
    }, [availableSectionTabs, splitSectionTabId]);

    useEffect(() => {
        if (isMobile && isSplitViewEnabled) {
            setIsSplitViewEnabled(false);
        }
    }, [isMobile, isSplitViewEnabled]);

    useEffect(() => {
        if (viewMode === 'month' && isSplitViewEnabled) {
            setIsSplitViewEnabled(false);
        }
    }, [viewMode, isSplitViewEnabled]);

    const canUseSplitView = !isEmbeddedSchedule && !isMobile && viewMode !== 'month';
    const effectiveSplitTabId = availableSectionTabs.some(t => t.id === splitSectionTabId)
        ? splitSectionTabId
        : (availableSectionTabs[0]?.id || '');

    const splitSections = useMemo(() => {
        if (!isSplitViewEnabled || !effectiveSplitTabId) return [];
        const activeTab = availableSectionTabs.find(t => t.id === effectiveSplitTabId);
        if (!activeTab) return [];
        const activeSection = renderedSections.find(section => section.title === activeTab.sectionTitle);
        const pinnedSection = renderedSections.find(section => section.title === PINNED_SECTION_TITLE);
        if (!activeSection) return [];
        if (!pinnedSection || activeSection.title === PINNED_SECTION_TITLE) return [activeSection];
        return [activeSection, pinnedSection];
    }, [isSplitViewEnabled, effectiveSplitTabId, availableSectionTabs, renderedSections]);

    const sections = useMemo(() => {
        if (activeSectionTabId === 'main') {
            const assigned = new Set(availableSectionTabs.map(t => t.sectionTitle));
            return renderedSections.filter(section => section.title === PINNED_SECTION_TITLE || !assigned.has(section.title));
        }
        const activeTab = availableSectionTabs.find(t => t.id === activeSectionTabId);
        if (!activeTab) return renderedSections;
        const activeSection = renderedSections.find(section => section.title === activeTab.sectionTitle);
        const pinnedSection = renderedSections.find(section => section.title === PINNED_SECTION_TITLE);
        if (!activeSection) return renderedSections;
        if (!pinnedSection || activeSection.title === PINNED_SECTION_TITLE) return [activeSection];
        return [activeSection, pinnedSection];
    }, [activeSectionTabId, availableSectionTabs, renderedSections]);

    const persistSectionTabs = async (tabs) => {
        await updateSystemSettingMutation.mutateAsync({
            key: SECTION_TABS_KEY,
            value: JSON.stringify(tabs)
        });
    };

    const handleMoveSectionToTab = async (sectionTitle) => {
        if (sectionTitle === PINNED_SECTION_TITLE) {
            toast.info(`"${getSectionName(PINNED_SECTION_TITLE)}" bleibt immer im Hauptplan enthalten`);
            return;
        }
        const existing = availableSectionTabs.find(t => t.sectionTitle === sectionTitle);
        if (existing) {
            setActiveSectionTabId(existing.id);
            return;
        }
        const slug = sectionTitle.toLowerCase().replace(/[^a-z0-9]/g, '_');
        const newTab = {
            id: `tab_${Date.now()}_${slug}`,
            sectionTitle
        };
        const nextTabs = [...sectionTabs, newTab];
        try {
            await persistSectionTabs(nextTabs);
            setActiveSectionTabId(newTab.id);
            toast.success(`"${getSectionName(sectionTitle)}" wurde in einen eigenen Reiter verschoben`);
        } catch {
            toast.error('Reiter konnte nicht gespeichert werden');
        }
    };

    const handleCloseSectionTab = async (tabId) => {
        const nextTabs = sectionTabs.filter(t => t.id !== tabId);
        try {
            await persistSectionTabs(nextTabs);
            if (activeSectionTabId === tabId) {
                setActiveSectionTabId('main');
            }
        } catch {
            toast.error('Reiter konnte nicht entfernt werden');
        }
    };

    const handleOpenSectionTabInNewWindow = (tabId) => {
        const nextUrl = new URL(window.location.href);
        nextUrl.searchParams.set('sectionTab', tabId);
        nextUrl.searchParams.set('view', viewMode);
        nextUrl.searchParams.set('date', format(currentDate, 'yyyy-MM-dd'));
        const popupWidth = Math.min(1400, Math.max(1000, Math.floor(window.screen.availWidth * 0.75)));
        const popupHeight = Math.min(900, Math.max(700, Math.floor(window.screen.availHeight * 0.8)));
        const popupLeft = Math.max(0, Math.floor((window.screen.availWidth - popupWidth) / 2));
        const popupTop = Math.max(0, Math.floor((window.screen.availHeight - popupHeight) / 2));
        const windowFeatures = `noopener,noreferrer,width=${popupWidth},height=${popupHeight},left=${popupLeft},top=${popupTop}`;
        const openedWindow = window.open(nextUrl.toString(), `schedule_tab_${tabId}_${Date.now()}`, windowFeatures);
        if (!openedWindow) {
            toast.error('Neues Fenster wurde vom Browser blockiert');
            return;
        }

        setActiveSectionTabId('main');
    };

    const handleOpenSectionTabInSplitView = (tabId) => {
        if (!canUseSplitView) return;
        setSplitSectionTabId(tabId);
        setIsSplitViewEnabled(true);
        setActiveSectionTabId('main');
    };

  const { data: trainingRotations = [] } = useQuery({
    queryKey: ['trainingRotations'],
    queryFn: () => db.TrainingRotation.list(),
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const { data: colorSettings = [], isLoading: isLoadingColors } = useQuery({
    queryKey: ['colorSettings'],
    queryFn: () => db.ColorSetting.list(),
    staleTime: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const { data: scheduleNotes = [] } = useQuery({
    queryKey: ['scheduleNotes'],
    queryFn: () => db.ScheduleNote.list(),
    staleTime: 30 * 1000,
    refetchOnWindowFocus: false,
  });

    const doctorChipLabelMap = useMemo(() => buildDoctorChipLabelMap(doctors), [doctors]);

    const getDoctorChipLabel = useMemo(() => (doctor) => {
            if (!doctor) return '';
            if (!isMonthView) return getDoctorShortLabel(doctor);
            return doctorChipLabelMap.get(doctor.id) || formatChipLabel(normalizeChipSource(doctor).slice(0, 3));
    }, [doctorChipLabelMap, isMonthView]);

    const scheduleNotesMap = useMemo(() => {
            const noteMap = new Map();
            scheduleNotes.forEach((note) => {
                    noteMap.set(`${note.date}|${note.position}`, note);
            });
            return noteMap;
    }, [scheduleNotes]);

  // ScheduleBlock: Gesperrte Zellen + Info-Notizen im Wochenplan
  // type='block' = Zelle gesperrt (kein Drag & Drop)
  // type='info'  = nur Information, kein Lock
  const { data: scheduleBlocks = [] } = useQuery({
    queryKey: ['scheduleBlocks', fetchRange.start, fetchRange.end],
    queryFn: () => db.ScheduleBlock.filter({
        date: { $gte: fetchRange.start, $lte: fetchRange.end }
    }),
    staleTime: 30 * 1000,
    refetchOnWindowFocus: false,
    keepPreviousData: true,
  });

  // Map for quick lookup: "date|position" or "date|position|timeslotId" → block (type='block')
  const scheduleBlocksMap = useMemo(() => {
    const map = new Map();
    for (const entry of scheduleBlocks) {
      if (entry.type === 'info') continue; // only blocks
      const dateStr = typeof entry.date === 'string' ? entry.date.substring(0, 10) : format(new Date(entry.date), 'yyyy-MM-dd');
      const key = entry.timeslot_id ? `${dateStr}|${entry.position}|${entry.timeslot_id}` : `${dateStr}|${entry.position}`;
      map.set(key, entry);
    }
    return map;
  }, [scheduleBlocks]);

  // Map for quick lookup: "date|position" or "date|position|timeslotId" → info (type='info')
  const scheduleInfoMap = useMemo(() => {
    const map = new Map();
    for (const entry of scheduleBlocks) {
      if (entry.type !== 'info') continue; // only infos
      const dateStr = typeof entry.date === 'string' ? entry.date.substring(0, 10) : format(new Date(entry.date), 'yyyy-MM-dd');
      const key = entry.timeslot_id ? `${dateStr}|${entry.position}|${entry.timeslot_id}` : `${dateStr}|${entry.position}`;
      map.set(key, entry);
    }
    return map;
  }, [scheduleBlocks]);

  const getScheduleBlock = (dateStr, position, timeslotId) => {
    if (timeslotId) {
      return scheduleBlocksMap.get(`${dateStr}|${position}|${timeslotId}`) || scheduleBlocksMap.get(`${dateStr}|${position}`);
    }
    return scheduleBlocksMap.get(`${dateStr}|${position}`);
  };

  const getScheduleInfo = (dateStr, position, timeslotId) => {
    if (timeslotId) {
      return scheduleInfoMap.get(`${dateStr}|${position}|${timeslotId}`) || scheduleInfoMap.get(`${dateStr}|${position}`);
    }
    return scheduleInfoMap.get(`${dateStr}|${position}`);
  };

        const { validate, shouldCreateAutoFrei, findAutoFreiToCleanup, isAutoOffPosition, checkCrossTenantConflicts } = useShiftValidation(allShifts, {
            workplaces,
            timeslots: workplaceTimeslots,
            sharedShifts: visiblePoolShifts,
        });

  // Qualifikationsdaten für visuelle Indikatoren
    const { getQualificationIds: getDoctorQualIds, isLoading: allDoctorQualsLoading, byDoctor: doctorQualByDoctor } = useAllDoctorQualifications();
    const { getRequiredQualificationIds: getWpRequiredQualIds, getOptionalQualificationIds: getWpOptionalQualIds, getExcludedQualificationIds: getWpExcludedQualIds, getDiscouragedQualificationIds: getWpDiscouragedQualIds } = useAllWorkplaceQualifications();
    const { qualifications = [], qualificationMap, isLoading: qualificationsLoading } = useQualifications();

    // ─── Verfügbarkeits-Grenzwerte aus SystemSettings parsen ───
    const availabilityThresholds = useMemo(() => {
        const raw = systemSettings.find(s => s.key === 'availability_thresholds')?.value;
        if (raw) {
            try { return JSON.parse(raw); } catch { return []; }
        }
        return [];
    }, [systemSettings]);

    const activeQualifications = useMemo(
        () => qualifications.filter((q) => q.is_active !== false),
        [qualifications]
    );
    const isQualificationDataLoading = qualificationsLoading || allDoctorQualsLoading;

    const toggleScheduleQualification = (qid) => {
        setSelectedQualificationIds((current) => (
            current.includes(qid)
                ? current.filter((id) => id !== qid)
                : [...current, qid]
        ));
    };

    const matchesScheduleQualificationFilter = useCallback((doctor) => {
        if (selectedQualificationIds.length === 0) return true;
        const ids = getDoctorQualIds(doctor.id);
        return selectedQualificationIds.some((qid) => ids.includes(qid));
    }, [selectedQualificationIds, getDoctorQualIds]);

    // Row-scoped qualification filter: Pflicht (AND), Sollte (OR), Sollte-nicht
    // (soft exclude with empty-candidate fallback), Nicht (hard AND-NOT).
    // AND-combined with the global schedule filter.
    const matchesRowQualificationFilter = useCallback((doctor) => {
        if (!rowQualFilter) return true;
        const ids = getDoctorQualIds(doctor.id);
        const doctorList = doctors.map((d) => ({
            id: d.id,
            qualification_ids: getDoctorQualIds(d.id),
        }));
        return matchesRowQualFilter(
            {
                requiredIds: rowQualFilter.requiredIds,
                optionalIds: rowQualFilter.optionalIds,
                discouragedIds: rowQualFilter.discouragedIds,
                excludeIds: rowQualFilter.excludeIds,
            },
            ids,
            doctorList,
        );
    }, [rowQualFilter, getDoctorQualIds, doctors]);

    const matchesAllQualificationFilters = useCallback((doctor) => {
        return matchesScheduleQualificationFilter(doctor) && matchesRowQualificationFilter(doctor);
    }, [matchesScheduleQualificationFilter, matchesRowQualificationFilter]);

    // Build (or toggle off) the row-scoped filter for a given row.
    const applyRowQualificationFilter = useCallback((rowName, rowTimeslotId, rowWorkplace) => {
        if (!rowWorkplace?.id) return;
        const key = buildRowFilterKey(rowName, rowTimeslotId);
        if (rowQualFilter && rowQualFilter.key === key) {
            setRowQualFilter(null);
            return;
        }
        const { requiredIds, optionalIds, discouragedIds, excludeIds } = buildRowQualSets({
            workplaceId: rowWorkplace.id,
            getRequired: getWpRequiredQualIds,
            getOptional: getWpOptionalQualIds,
            getDiscouraged: getWpDiscouragedQualIds,
            getExcluded: getWpExcludedQualIds,
        });
        if (
            requiredIds.length === 0
            && optionalIds.length === 0
            && discouragedIds.length === 0
            && excludeIds.length === 0
        ) {
            // No qualifications defined for this workplace -> nothing to filter on.
            return;
        }
        setRowQualFilter({
            key,
            sourceName: rowWorkplace.name || rowName,
            workplaceId: rowWorkplace.id,
            requiredIds,
            optionalIds,
            discouragedIds,
            excludeIds,
        });
    }, [rowQualFilter, getWpRequiredQualIds, getWpOptionalQualIds, getWpDiscouragedQualIds, getWpExcludedQualIds]);

  // Override-Validierung mit Dialog
  const {
      overrideDialog,
      requestOverride,
      confirmOverride,
      cancelOverride,
      setOverrideDialogOpen
  } = useOverrideValidation({ user, doctors });

  const getRoleColor = useMemo(() => (role) => {
      const setting = colorSettings.find(s => s.name === role && s.category === 'role');
      if (setting) return { backgroundColor: setting.bg_color, color: setting.text_color };
      if (DEFAULT_COLORS.roles[role]) return { backgroundColor: DEFAULT_COLORS.roles[role].bg, color: DEFAULT_COLORS.roles[role].text };
      return { backgroundColor: '#f3f4f6', color: '#1f2937' }; // Default gray
  }, [colorSettings]);

  // Helper to mix tailwind default and custom style
  const getSectionStyle = useMemo(() => (sectionTitle) => {
      const setting = colorSettings.find(s => s.name === sectionTitle && s.category === 'section');
      if (setting) {
          return { 
              header: { backgroundColor: setting.bg_color, color: setting.text_color },
              row: { backgroundColor: setting.bg_color + '4D' } 
          };
      }
      return null;
  }, [colorSettings]);

  const getRowStyle = useMemo(() => (rowName, sectionStyle) => {
      // Check for specific position color
      const setting = colorSettings.find(s => s.name === rowName && s.category === 'position');
      if (setting) {
          return { 
              backgroundColor: setting.bg_color + '33', // ~20% opacity
              color: setting.text_color
          };
      }
      // Fallback to section style
      if (sectionStyle) {
          return { backgroundColor: sectionStyle.row.backgroundColor };
      }
      return {};
  }, [colorSettings]);

  const createShiftMutation = useMutation({
    mutationFn: (data) => db.ShiftEntry.create(data),
    onMutate: async (newData) => {
        await queryClient.cancelQueries(['shifts', fetchRange.start, fetchRange.end]);
        const previousShifts = queryClient.getQueryData(['shifts', fetchRange.start, fetchRange.end]);
        
        const tempShift = { ...newData, id: `temp-${Date.now()}` };
        if (previousShifts) {
            queryClient.setQueryData(['shifts', fetchRange.start, fetchRange.end], old => [...old, tempShift]);
        }
        return { previousShifts };
    },
    onSuccess: (data, newData, _context) => {
        // trackDbChange(); // Disabled - MySQL mode
        setUndoStack(prev => [...prev, { type: 'DELETE', id: data.id }]);
        // Only invalidate shifts in affected range
        queryClient.invalidateQueries(['shifts', fetchRange.start, fetchRange.end]);

        // Side-effects are best-effort: they must NOT roll back the primary write
        // if they fail (which previously caused the UI to lose a successfully
        // created shift after a transient DB hiccup).
        if (user?.role === 'admin' && newData.doctor_id) {
            const doc = doctors.find(d => d.id === newData.doctor_id);
            if (doc && doc.id !== user.doctor_id) {
                db.ShiftNotification.create({
                    doctor_id: newData.doctor_id,
                    date: newData.date,
                    type: 'create',
                    message: `Neuer Dienst eingetragen: ${newData.position}`,
                    acknowledged: false,
                }).catch((err) => console.warn('[ScheduleBoard] Notification create failed:', err?.message));
            }
        }

        const matchingWish = wishes.find(w =>
            w.doctor_id === newData.doctor_id &&
            w.date === newData.date &&
            w.type === 'service' &&
            w.status === 'pending' &&
            (!w.position || w.position === newData.position)
        );
        if (matchingWish) {
            db.WishRequest.update(matchingWish.id, {
                status: 'approved',
                user_viewed: false,
                admin_comment: 'Automatisch genehmigt durch Diensteinteilung',
            })
                .then(() => queryClient.invalidateQueries(['wishes']))
                .catch((err) => {
                    console.warn('[ScheduleBoard] Wunsch-Auto-Genehmigung fehlgeschlagen:', err?.message);
                    toast.warning('Dienst wurde gespeichert, aber der zugehörige Wunsch konnte nicht automatisch genehmigt werden.');
                });
        }
    },
    onSettled: (_data, _error, newData) => {
        // Release cell lock after mutation completes (success or error)
        if (newData?.date && newData?.position) {
            unlockCell(newData.date, newData.position, newData.timeslot_id);
        }
    },
    onError: (error, newData, context) => {
        console.error('DEBUG: Create Mutation Failed', error);
        if (context?.previousShifts) {
            queryClient.setQueryData(['shifts', fetchRange.start, fetchRange.end], context.previousShifts);
        }
        // 409 Conflict = Server-Sentinel blocked a duplicate → silent rollback + refresh
        if (error.message?.includes('Position bereits besetzt') || error.message?.includes('409')) {
            console.warn('[Sentinel] Duplicate blocked by server, refreshing data');
            queryClient.invalidateQueries(['shifts', fetchRange.start, fetchRange.end]);
            return;
        }
        // 403 handled globally in client.ts — just log here
        if (error.message?.includes('403') || error.message?.includes('fehlt die Berechtigung') || error.message?.includes('missingPermission')) {
            console.warn('[ScheduleBoard] Create mutation denied by permission');
            return;
        }
        toast.error(`Fehler beim Erstellen: ${error.message}`);
    }
  });

  const bulkCreateShiftsMutation = useMutation({
    mutationFn: (shiftsData) => db.ShiftEntry.bulkCreate(shiftsData),
    onMutate: async (newShifts) => {
        await queryClient.cancelQueries(['shifts', fetchRange.start, fetchRange.end]);
        const previousShifts = queryClient.getQueryData(['shifts', fetchRange.start, fetchRange.end]);
        
        const tempShifts = newShifts.map((s, i) => ({ ...s, id: `temp-bulk-${Date.now()}-${i}` }));
        
        if (previousShifts) {
            queryClient.setQueryData(['shifts', fetchRange.start, fetchRange.end], old => [...old, ...tempShifts]);
        }
        return { previousShifts };
    },
    onSuccess: (data, _variables, _context) => {
        // trackDbChange(data.length); // Disabled - MySQL mode
        if (Array.isArray(data)) {
             setUndoStack(prev => [...prev, { type: 'BULK_DELETE', ids: data.map(s => s.id) }]);
             // Best-effort side-effects (do not block / not rollback)
             for (const shift of data) {
                 if (user?.role === 'admin' && shift.doctor_id) {
                     const doc = doctors.find(d => d.id === shift.doctor_id);
                     if (doc && doc.id !== user.doctor_id) {
                         db.ShiftNotification.create({
                             doctor_id: shift.doctor_id,
                             date: shift.date,
                             type: 'create',
                             message: `Neuer Dienst eingetragen: ${shift.position}`,
                             acknowledged: false,
                         }).catch((err) => console.warn('[ScheduleBoard] Bulk notification failed:', err?.message));
                     }
                 }
                 const matchingWish = wishes.find(w =>
                     w.doctor_id === shift.doctor_id &&
                     w.date === shift.date &&
                     w.type === 'service' &&
                     w.status === 'pending' &&
                     (!w.position || w.position === shift.position)
                 );
                 if (matchingWish) {
                     db.WishRequest.update(matchingWish.id, {
                         status: 'approved',
                         user_viewed: false,
                         admin_comment: 'Automatisch genehmigt durch Diensteinteilung',
                     })
                         .then(() => queryClient.invalidateQueries(['wishes']))
                         .catch((err) => console.warn('[ScheduleBoard] Bulk wish approval failed:', err?.message));
                 }
             }
        }
        queryClient.invalidateQueries(['shifts', fetchRange.start, fetchRange.end]);
    },
    onError: (error, _variables, context) => {
        console.error('DEBUG: Bulk Create Failed', error);
        if (context?.previousShifts) {
            queryClient.setQueryData(['shifts', fetchRange.start, fetchRange.end], context.previousShifts);
        }
        // 409 Conflict = Server-Sentinel blocked duplicates → silent rollback + refresh
        if (error.message?.includes('Position bereits besetzt') || error.message?.includes('409')) {
            console.warn('[Sentinel] Bulk duplicate blocked by server, refreshing data');
            queryClient.invalidateQueries(['shifts', fetchRange.start, fetchRange.end]);
            return;
        }
        // 403 handled globally in client.ts
        if (error.message?.includes('403') || error.message?.includes('fehlt die Berechtigung') || error.message?.includes('missingPermission')) {
            console.warn('[ScheduleBoard] BulkCreate mutation denied by permission');
            return;
        }
        toast.error(`Fehler beim Erstellen (Bulk): ${error.message}`);
    }
  });

  const updateShiftMutation = useMutation({
    mutationFn: ({ id, data }) => db.ShiftEntry.update(id, data),
    onMutate: async ({ id, data }) => {
        // Cancel any outgoing refetches to avoid overwriting our optimistic update
        await queryClient.cancelQueries(['shifts', fetchRange.start, fetchRange.end]);
        
        // Snapshot the previous value for rollback
        const previousShifts = queryClient.getQueryData(['shifts', fetchRange.start, fetchRange.end]);
        const oldShift = previousShifts?.find(s => s.id === id);
        
        // Optimistically update to the new value immediately
        if (previousShifts) {
            queryClient.setQueryData(['shifts', fetchRange.start, fetchRange.end], old => 
                old.map(s => s.id === id ? { ...s, ...data } : s)
            );
        }
        
        return { previousShifts, oldShift, newData: data };
    },
    onSuccess: (data, { id, data: inputData }, context) => {
        // trackDbChange(); // Disabled - MySQL mode
        if (context.oldShift) {
            const { id: _, created_date: _createdDate, updated_date: _updatedDate, created_by: _createdBy, ...oldData } = context.oldShift;
            setUndoStack(prev => [...prev, { type: 'UPDATE', id, data: oldData }]);

            // Best-effort wish auto-approval (does NOT roll back primary update on failure)
            const fullShift = { ...context.oldShift, ...inputData };
            const matchingWish = wishes.find(w =>
                w.doctor_id === fullShift.doctor_id &&
                w.date === fullShift.date &&
                w.type === 'service' &&
                w.status === 'pending' &&
                (!w.position || w.position === fullShift.position)
            );
            if (matchingWish) {
                db.WishRequest.update(matchingWish.id, {
                    status: 'approved',
                    user_viewed: false,
                    admin_comment: 'Automatisch genehmigt durch Diensteinteilung',
                })
                    .then(() => queryClient.invalidateQueries(['wishes']))
                    .catch((err) => {
                        console.warn('[ScheduleBoard] Wunsch-Auto-Genehmigung fehlgeschlagen:', err?.message);
                        toast.warning('Dienst wurde aktualisiert, aber der zugehörige Wunsch konnte nicht automatisch genehmigt werden.');
                    });
            }

            // Notify user if admin updated it (best-effort)
            if (user?.role === 'admin') {
                const newShift = { ...context.oldShift, ...inputData };
                const docId = newShift.doctor_id;
                
                if (context.oldShift.doctor_id !== docId) {
                    // Notify old doctor
                    if (context.oldShift.doctor_id !== user.doctor_id) {
                        db.ShiftNotification.create({
                            doctor_id: context.oldShift.doctor_id,
                            date: context.oldShift.date,
                            type: 'delete',
                            message: `Dienst entfernt: ${context.oldShift.position}`,
                            acknowledged: false
                        });
                    }
                    // Notify new doctor
                    if (docId && docId !== user.doctor_id) {
                        db.ShiftNotification.create({
                            doctor_id: docId,
                            date: newShift.date,
                            type: 'create',
                            message: `Neuer Dienst zugewiesen: ${newShift.position}`,
                            acknowledged: false
                        });
                    }
                } else if (docId && docId !== user.doctor_id) {
                    // Same doctor, details changed
                    const changes = [];
                    if (context.oldShift.date !== newShift.date) changes.push(`Datum: ${format(new Date(context.oldShift.date), 'dd.MM')} -> ${format(new Date(newShift.date), 'dd.MM')}`);
                    if (context.oldShift.position !== newShift.position) changes.push(`Position: ${context.oldShift.position} -> ${newShift.position}`);
                    
                    if (changes.length > 0) {
                        db.ShiftNotification.create({
                            doctor_id: docId,
                            date: newShift.date,
                            type: 'update',
                            message: `Dienständerung: ${changes.join(', ')}`,
                            acknowledged: false
                        });
                    }
                }
            }
        }
        // Debounced invalidation
        setTimeout(() => {
            queryClient.invalidateQueries(['shifts', fetchRange.start, fetchRange.end]);
        }, 100);
    },
    onError: (error, _variables, context) => {
        console.error('DEBUG: Update Mutation Failed', error);
        if (context?.previousShifts) {
            queryClient.setQueryData(['shifts', fetchRange.start, fetchRange.end], context.previousShifts);
        }
        // 403 handled globally in client.ts
        if (error.message?.includes('403') || error.message?.includes('fehlt die Berechtigung') || error.message?.includes('missingPermission')) {
            console.warn('[ScheduleBoard] Update mutation denied by permission');
            return;
        }
        toast.error(`Fehler beim Aktualisieren: ${error.message}`);
    }
    });

  // Dedicated mutations for automatic background operations
  const createAutoFreiMutation = useMutation({
    mutationFn: (data) => db.ShiftEntry.create(data),
    onSuccess: (data) => {
        setUndoStack(prev => {
            const undoAction = { type: 'DELETE', id: data.id };
            if (prev.length === 0) return [...prev, undoAction];
            const last = prev[prev.length - 1];
            const newGroup = Array.isArray(last) ? [...last, undoAction] : [last, undoAction];
            return [...prev.slice(0, -1), newGroup];
        });
        setTimeout(() => queryClient.invalidateQueries(['shifts', fetchRange.start, fetchRange.end]), 100);
    },
    onError: (error) => console.error('Auto-Frei creation failed:', error)
  });

  const updateAutoFreiMutation = useMutation({
    mutationFn: ({ id, data }) => db.ShiftEntry.update(id, data),
    onMutate: async ({ id }) => {
        const oldShift = allShifts.find(s => s.id === id);
        return { oldShift };
    },
    onSuccess: (data, { id }, context) => {
        if (context.oldShift) {
            const { id: _, created_date: _createdDate, updated_date: _updatedDate, created_by: _createdBy, ...oldData } = context.oldShift;
            const undoAction = { type: 'UPDATE', id, data: oldData };
            
            setUndoStack(prev => {
                if (prev.length === 0) return [...prev, undoAction];
                const last = prev[prev.length - 1];
                const newGroup = Array.isArray(last) ? [...last, undoAction] : [last, undoAction];
                return [...prev.slice(0, -1), newGroup];
            });
        }
        setTimeout(() => queryClient.invalidateQueries(['shifts', fetchRange.start, fetchRange.end]), 100);
    },
    onError: (error) => console.error('Auto-Frei update failed:', error)
  });

  const deleteShiftMutation = useMutation({
    mutationFn: async (id) => {
        // Find shift to check for related wish
        const shiftToDelete = allShifts.find(s => s.id === id);
        
        if (shiftToDelete) {
            // Find matching approved wish
            const matchingWish = wishes.find(w => 
                w.doctor_id === shiftToDelete.doctor_id && 
                w.date === shiftToDelete.date &&
                w.status === 'approved' && 
                w.type === 'service' &&
                (!w.position || w.position === shiftToDelete.position)
            );
            
            if (matchingWish) {
                // Revert to pending
                await db.WishRequest.update(matchingWish.id, { status: 'pending' });
            }
        }
        
        return db.ShiftEntry.delete(id);
    },
    onMutate: async (id) => {
        await queryClient.cancelQueries(['shifts', fetchRange.start, fetchRange.end]);
        const previousShifts = queryClient.getQueryData(['shifts', fetchRange.start, fetchRange.end]);

        if (previousShifts) {
            queryClient.setQueryData(['shifts', fetchRange.start, fetchRange.end], old => old.filter(s => s.id !== id));
        }

        const shift = allShifts.find(s => s.id === id);
        return { shift, previousShifts };
    },
    onSuccess: (_data, id, context) => {
        // trackDbChange(); // Disabled - MySQL mode
        if (context.shift) {
            const { id: _, created_date: _createdDate, updated_date: _updatedDate, created_by: _createdBy, ...shiftData } = context.shift;
            setUndoStack(prev => [...prev, { type: 'CREATE', data: shiftData }]);

            if (user?.role === 'admin' && context.shift.doctor_id && context.shift.doctor_id !== user.doctor_id) {
                db.ShiftNotification.create({
                    doctor_id: context.shift.doctor_id,
                    date: context.shift.date,
                    type: 'delete',
                    message: `Dienst gestrichen: ${context.shift.position}`,
                    acknowledged: false
                });
            }
        }
        setTimeout(() => {
            queryClient.invalidateQueries(['shifts', fetchRange.start, fetchRange.end]);
        }, 100);
    },
    onError: (error, id, context) => {
        console.error('DEBUG: Delete Mutation Failed', { id, error });
        if (context?.previousShifts) {
            queryClient.setQueryData(['shifts', fetchRange.start, fetchRange.end], context.previousShifts);
        }
        // 403 handled globally in client.ts
        if (error.message?.includes('403') || error.message?.includes('fehlt die Berechtigung') || error.message?.includes('missingPermission')) {
            console.warn('[ScheduleBoard] Delete mutation denied by permission');
            return;
        }
        toast.error(`Fehler beim Löschen: ${error.message}`);
    }
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: async (ids) => {
        // Use allSettled so a single failure does not leave the batch in a
        // partially deleted state without the caller knowing. We collect
        // failures and surface them so the user is informed.
        const results = await Promise.allSettled(ids.map(id => db.ShiftEntry.delete(id)));
        const failures = results
            .map((r, idx) => ({ r, id: ids[idx] }))
            .filter(({ r }) => r.status === 'rejected');
        if (failures.length > 0) {
            const firstError = failures[0].r.reason;
            const err = new Error(
                `${failures.length} von ${ids.length} Löschvorgängen sind fehlgeschlagen: ${firstError?.message || 'Unbekannter Fehler'}`,
            );
            err.failedIds = failures.map(f => f.id);
            err.partial = failures.length < ids.length;
            throw err;
        }
    },
    onMutate: async (ids) => {
        await queryClient.cancelQueries(['shifts', fetchRange.start, fetchRange.end]);
        const previousShifts = queryClient.getQueryData(['shifts', fetchRange.start, fetchRange.end]);

        if (previousShifts) {
            queryClient.setQueryData(['shifts', fetchRange.start, fetchRange.end], old => old.filter(s => !ids.includes(s.id)));
        }

        const shifts = allShifts.filter(s => ids.includes(s.id));
        return { shifts, previousShifts };
    },
    onError: (err, _ids, context) => {
         // If the failure was total, restore the optimistic snapshot. For a
         // partial failure we cannot trust the snapshot (some rows really
         // were deleted on the server), so refetch instead.
         if (err?.partial && context?.previousShifts) {
             queryClient.invalidateQueries(['shifts', fetchRange.start, fetchRange.end]);
             toast.error(`Teilweiser Löschfehler: ${err.message}`, {
                 description: 'Die Daten wurden vom Server neu geladen, damit die Anzeige korrekt ist.',
             });
             return;
         }
         if (context?.previousShifts) {
             queryClient.setQueryData(['shifts', fetchRange.start, fetchRange.end], context.previousShifts);
         }
         toast.error(`Fehler beim Löschen: ${err.message}`);
    },
    onSuccess: (_data, ids, context) => {
        // trackDbChange(ids.length); // Disabled - MySQL mode
        if (context.shifts && context.shifts.length > 0) {
            const shiftsData = context.shifts.map(s => {
                const { id: _id, created_date: _createdDate, updated_date: _updatedDate, created_by: _createdBy, ...rest } = s;
                return rest;
            });
            setUndoStack(prev => [...prev, { type: 'BULK_CREATE', data: shiftsData }]);
        }
        setTimeout(() => {
            queryClient.invalidateQueries(['shifts', fetchRange.start, fetchRange.end]);
        }, 100);
    }
  });

  const createNoteMutation = useMutation({
    mutationFn: (data) => db.ScheduleNote.create(data),
    onSuccess: () => queryClient.invalidateQueries(['scheduleNotes']),
  });

  const updateNoteMutation = useMutation({
    mutationFn: ({ id, data }) => db.ScheduleNote.update(id, data),
    onSuccess: () => queryClient.invalidateQueries(['scheduleNotes']),
  });

  const deleteNoteMutation = useMutation({
    mutationFn: (id) => db.ScheduleNote.delete(id),
    onSuccess: () => queryClient.invalidateQueries(['scheduleNotes']),
  });

  // ScheduleBlock mutations (type='block')
  const createBlockMutation = useMutation({
    mutationFn: (data) => db.ScheduleBlock.create({ ...data, type: 'block' }),
    onSuccess: () => {
      queryClient.invalidateQueries(['scheduleBlocks']);
      toast.success('Zelle gesperrt');
    },
  });

  const deleteBlockMutation = useMutation({
    mutationFn: (id) => db.ScheduleBlock.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries(['scheduleBlocks']);
      toast.success('Sperrung aufgehoben');
    },
  });

  // ScheduleBlock mutations (type='info')
  const createInfoMutation = useMutation({
    mutationFn: (data) => db.ScheduleBlock.create({ ...data, type: 'info' }),
    onSuccess: () => {
      queryClient.invalidateQueries(['scheduleBlocks']);
      toast.success('Info hinterlegt');
    },
  });

  const deleteInfoMutation = useMutation({
    mutationFn: (id) => db.ScheduleBlock.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries(['scheduleBlocks']);
      toast.success('Info entfernt');
    },
  });

  // Context menu state for cell blocking / info
  const [blockContextMenu, setBlockContextMenu] = useState(null);
  const [blockReasonInput, setBlockReasonInput] = useState('');
  const [infoReasonInput, setInfoReasonInput] = useState('');

  const handleCellContextMenu = (e, dateStr, position, timeslotId = null) => {
    if (isReadOnly) return;
    e.preventDefault();
    const block = getScheduleBlock(dateStr, position, timeslotId);
    const info = getScheduleInfo(dateStr, position, timeslotId);
    setBlockContextMenu({
      x: e.clientX,
      y: e.clientY,
      dateStr,
      position,
      timeslotId,
      existingBlock: block || null,
      existingInfo: info || null,
    });
    setBlockReasonInput(block?.reason || '');
    setInfoReasonInput(info?.reason || '');
  };

  const handleBlockCell = () => {
    if (!blockContextMenu) return;
    const { dateStr, position, timeslotId } = blockContextMenu;
    createBlockMutation.mutate({
      date: dateStr,
      position,
      timeslot_id: timeslotId || null,
      reason: blockReasonInput.trim() || null,
    });
    setBlockContextMenu(null);
    setBlockReasonInput('');
    setInfoReasonInput('');
  };

  const handleUnblockCell = () => {
    if (!blockContextMenu?.existingBlock) return;
    deleteBlockMutation.mutate(blockContextMenu.existingBlock.id);
    setBlockContextMenu(null);
    setBlockReasonInput('');
    setInfoReasonInput('');
  };

  const handleInfoCell = () => {
    if (!blockContextMenu) return;
    const { dateStr, position, timeslotId } = blockContextMenu;
    createInfoMutation.mutate({
      date: dateStr,
      position,
      timeslot_id: timeslotId || null,
      reason: infoReasonInput.trim() || null,
    });
    setBlockContextMenu(null);
    setBlockReasonInput('');
    setInfoReasonInput('');
  };

  const handleDeleteInfoCell = () => {
    if (!blockContextMenu?.existingInfo) return;
    deleteInfoMutation.mutate(blockContextMenu.existingInfo.id);
    setBlockContextMenu(null);
    setBlockReasonInput('');
    setInfoReasonInput('');
  };

  const handleClearWeek = () => {
      const protectedPositions = ["Frei", "Krank", "Urlaub", "Dienstreise"];
      const shiftsToDelete = currentWeekShifts.filter(s => !protectedPositions.includes(s.position));
      
      if (shiftsToDelete.length === 0) return;
      
      if (window.confirm('Möchten Sie den Wochenplan bereinigen? (Abwesenheiten bleiben erhalten)')) {
          const ids = shiftsToDelete.map(s => s.id);
          bulkDeleteMutation.mutate(ids);
      }
  };

  const handleClearDay = (date) => {
      const protectedPositions = ["Frei", "Krank", "Urlaub", "Dienstreise"];
      const dateStr = format(date, 'yyyy-MM-dd');
      const shiftsToDelete = currentWeekShifts.filter(s => 
          s.date === dateStr && !protectedPositions.includes(s.position)
      );
      
      if (shiftsToDelete.length === 0) return;

      if (window.confirm(`Möchten Sie die Dienste für ${format(date, 'EEEE', { locale: de })} löschen? (Abwesenheiten bleiben erhalten)`)) {
          const ids = shiftsToDelete.map(s => s.id);
          bulkDeleteMutation.mutate(ids);
      }
  };

  const handleClearRow = (rowName, timeslotId = null) => {
      // Bei Timeslot-Zeilen: nur Shifts mit dieser Timeslot-ID löschen
      const shiftsToDelete = currentWeekShifts.filter(s => {
          if (s.position !== rowName) return false;
          if (timeslotId) return s.timeslot_id === timeslotId;
          // Wenn keine Timeslot-ID angegeben, prüfen ob der Arbeitsplatz Timeslots hat
          const workplace = workplaces.find(w => w.name === rowName);
          if (workplace?.timeslots_enabled) {
              // Hat Timeslots - nur Shifts ohne Timeslot löschen (Legacy)
              return !s.timeslot_id;
          }
          // Keine Timeslots - alle löschen
          return true;
      });
      
      if (shiftsToDelete.length === 0) return;

      const displayName = timeslotId 
          ? `${rowName} (Zeitfenster)` 
          : rowName;

      if (window.confirm(`Möchten Sie alle Einträge in der Zeile "${displayName}" für diese Woche löschen?`)) {
          const ids = shiftsToDelete.map(s => s.id);
          bulkDeleteMutation.mutate(ids);
      }
  };

  const [isExporting, setIsExporting] = useState(false);

  const absencePositions = ["Frei", "Krank", "Urlaub", "Dienstreise", "Nicht verfügbar"];

  // Synchrone Konfliktprüfung (nur für Voice-Commands)
  const checkConflictsVoice = (doctorId, dateStr, newPosition, excludeShiftId = null) => {
      const result = validate(doctorId, dateStr, newPosition, { excludeShiftId });
      
      if (result.blockers.length > 0) {
          toast.error(result.blockers.join('\n'));
          return true;
      }

      if (result.warnings.length > 0) {
          toast.warning(result.warnings.join('\n'));
      }
      
      return false;
  };

  // Konfliktprüfung mit Override-Dialog
  // Gibt true zurück wenn blockiert (Aktion abbrechen)
  // Wenn Override möglich: zeigt Dialog und führt onProceed bei Bestätigung aus
  const checkConflictsWithOverride = async (doctorId, dateStr, newPosition, excludeShiftId = null, onProceed = null) => {
      const result = validate(doctorId, dateStr, newPosition, { excludeShiftId });
      const doctor = doctors.find(d => d.id === doctorId);
      
      // Bei Blockern: Override-Dialog anzeigen
      if (result.blockers.length > 0) {
          requestOverride({
              blockers: result.blockers,
              warnings: result.warnings,
              doctorId,
              doctorName: doctor?.name,
              date: dateStr,
              position: newPosition,
              onConfirm: onProceed
          });
          return true; // Blockiert - warte auf Override-Bestätigung
      }

      // Warnungen anzeigen (kein Blocker)
      if (result.warnings.length > 0) {
          toast.warning(result.warnings.join('\n'));
      }

      // Mandantenübergreifende Dienstkonflikt-Prüfung
      const absencePositions = ["Frei", "Krank", "Urlaub", "Dienstreise", "Nicht verfügbar",
                                "Fortbildung", "Kongress", "Elternzeit", "Mutterschutz", "Verfügbar"];
      if (!absencePositions.includes(newPosition)) {
          const crossConflicts = await checkCrossTenantConflicts(doctorId, dateStr);
          if (crossConflicts.length > 0) {
              const names = [...new Set(crossConflicts.map(c => c.related_employee_name))].join(', ');
              requestOverride({
                  blockers: [`Dienstkonflikt (mandantenübergreifend): „${names}" hat eine Beziehung mit aktiviertem Dienstkonflikt und ist am selben Tag in einem anderen Mandanten ebenfalls für einen Dienst eingeteilt.`],
                  warnings: [],
                  doctorId,
                  doctorName: doctor?.name,
                  date: dateStr,
                  position: newPosition,
                  onConfirm: onProceed
              });
              return true; // Blockiert - warte auf Override-Bestätigung
          }
      }
      
      return false; // Nicht blockiert
  };

  // Legacy-Wrapper für Stellen die noch nicht umgestellt sind
  const checkConflicts = async (doctorId, dateStr, newPosition, isVoice = false, excludeShiftId = null) => {
      if (isVoice) {
          return checkConflictsVoice(doctorId, dateStr, newPosition, excludeShiftId);
      }
      // Für non-voice: verwende Override-Dialog ohne Callback
      return checkConflictsWithOverride(doctorId, dateStr, newPosition, excludeShiftId, null);
  };

  // Wrapper für Abwesenheits-spezifische Staffing-Prüfung
  const checkStaffing = (dateStr, doctorId) => {
      const result = validate(doctorId, dateStr, 'Frei', {});
      return result.warnings.length > 0 ? result.warnings.join('\n') : null;
  };

  // Wrapper für Limit-Prüfung (jetzt nur Warnung)
  const checkLimits = (doctorId, dateStr, position) => {
      const result = validate(doctorId, dateStr, position, {});
      const limitWarnings = result.warnings.filter(w => w.includes('Dienstlimit'));
      return limitWarnings.length > 0 ? limitWarnings.join('\n') : null;
  };

  // Prüfung beim Drag in Abwesenheit: Warnung falls bestehende Einträge gelöscht werden
  // Kombiniert Dienst-Lösch-Warnung + Staffing-Check in einem Dialog
  const checkAbsenceDropConflicts = (doctorId, dateStr, position, onProceed, excludeShiftId = null) => {
      const doctor = doctors.find(d => d.id === doctorId);
      const shiftsToDelete = currentWeekShifts.filter(s =>
          s.doctor_id === doctorId &&
          s.date === dateStr &&
          s.id !== excludeShiftId &&
          !absencePositions.includes(s.position)
      );

      // Staffing-Warnungen prüfen
      const result = validate(doctorId, dateStr, position, {});
      const staffingWarnings = result.warnings.filter(w =>
          w.includes('Mindestbesetzung') || w.includes('anwesend')
      );

      if (shiftsToDelete.length === 0 && staffingWarnings.length === 0) {
          return false; // Kein Konflikt
      }

      const messages = [];
      if (shiftsToDelete.length > 0) {
          const entries = shiftsToDelete.map(s => `"${s.position}"`).join(', ');
          messages.push(`Bestehende Einträge werden gelöscht: ${entries}`);
      }
      messages.push(...staffingWarnings);

      requestOverride({
          blockers: messages,
          warnings: [],
          doctorId,
          doctorName: doctor?.name,
          date: dateStr,
          position,
          onConfirm: onProceed
      });
      return true; // Blockiert - warte auf Override
  };

  const handleExportExcel = async () => {
      setIsExporting(true);
      try {
          // Determine date range based on viewMode
          const startDate = weekDays[0];
          const endDate = weekDays[weekDays.length - 1];
          
          const data = await api.exportScheduleToExcel(
              format(startDate, 'yyyy-MM-dd'),
              format(endDate, 'yyyy-MM-dd'),
              hiddenRows
          );
          
          // Decode base64
          const byteCharacters = atob(data.file);
          const byteNumbers = new Array(byteCharacters.length);
          for (let i = 0; i < byteCharacters.length; i++) {
              byteNumbers[i] = byteCharacters.charCodeAt(i);
          }
          const byteArray = new Uint8Array(byteNumbers);
          
          const blob = new Blob([byteArray], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
          const url = window.URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `Wochenplan_${format(startDate, 'yyyy-MM-dd')}_bis_${format(endDate, 'yyyy-MM-dd')}.xlsx`;
          document.body.appendChild(a);
          a.click();
          window.URL.revokeObjectURL(url);
          a.remove();
      } catch (error) {
          console.error("Export Error:", error);
          alert("Export fehlgeschlagen: " + (error.message || "Unbekannter Fehler"));
      } finally {
          setIsExporting(false);
      }
  };

  const weekDays = useMemo(() => {
    if (!isValid(currentDate)) return [];
    if (viewMode === 'day') {
        return [currentDate];
    }
        if (viewMode === 'month') {
                return eachDayOfInterval({
                        start: startOfMonth(currentDate),
                        end: endOfMonth(currentDate)
                });
        }
    const start = startOfWeek(currentDate, { weekStartsOn: 1 });
    return Array.from({ length: 7 }).map((_, i) => addDays(start, i));
  }, [currentDate, viewMode]);

    const rowLabelWidth = isMonthView ? 160 : 200;
    const matrixGridStyle = useMemo(() => ({
        gridTemplateColumns: viewMode === 'day'
            ? `${rowLabelWidth}px minmax(0, 1fr)`
            : `${rowLabelWidth}px repeat(${weekDays.length}, minmax(${isMonthView ? 38 : 0}px, 1fr))`
    }), [viewMode, rowLabelWidth, weekDays.length, isMonthView]);

    const stickyAvailableSectionStyle = useMemo(() => ({
        bottom: 0,
    }), []);

    const matrixMinWidth = useMemo(() => {
        if (viewMode === 'day') return rowLabelWidth + 480;
        return rowLabelWidth + (weekDays.length * (isMonthView ? 38 : 90));
    }, [viewMode, rowLabelWidth, weekDays.length, isMonthView]);

  // Sidebar-Ärzte filtern: Ausgeschiedene, KO, MS, 0.0 FTE ausblenden
  const sidebarDoctorsAll = useMemo(() => {
    if (!weekDays.length || !doctors.length) return doctors;
        const checkDate = viewMode === 'month' ? currentDate : weekDays[0];
        return sortDoctorsForDisplay(
            doctors.filter(doc => isDoctorAvailable(doc, checkDate, staffingPlanEntries))
        );
        }, [currentDate, doctors, sortDoctorsAlphabetically, staffingPlanEntries, viewMode, weekDays]);

    const sidebarDoctors = useMemo(() => {
        if (selectedQualificationIds.length === 0 && !rowQualFilter) return sidebarDoctorsAll;
        return sidebarDoctorsAll.filter(matchesAllQualificationFilters);
    }, [sidebarDoctorsAll, matchesAllQualificationFilters, selectedQualificationIds, rowQualFilter]);

    const getDoctorWithEffectiveFte = (doctor, referenceDate) => {
        if (!doctor || !referenceDate) {
            return doctor;
        }

        return {
            ...doctor,
            fte: getDoctorEffectiveFte(doctor, new Date(referenceDate), staffingPlanEntries),
        };
    };

  const currentWeekShifts = useMemo(() => {
    // Use weekDays to determine range, ensuring we catch shifts for visible days
    if (weekDays.length === 0) return [];
    
    const start = weekDays[0];
    if (!isValid(start)) return [];

    const end = addDays(weekDays[weekDays.length - 1], 1);
    if (!isValid(end)) return [];
    
    const startStr = format(start, 'yyyy-MM-dd');
    const endStr = format(end, 'yyyy-MM-dd'); // end is exclusive in logic below, but for string range let's be careful
    
    const dbShifts = allShifts.filter(s => {
      // Robust string comparison to avoid timezone issues
      return s.date >= startStr && s.date < endStr;
    });
    
    if (previewShifts) {
        // Add temporary IDs to preview shifts if they don't have them, to avoid key errors
        const formattedPreview = previewShifts.map((s, i) => ({
            ...s,
            id: s.id || `preview-${i}`,
            isPreview: true
        }));
        return [...dbShifts, ...formattedPreview];
    }
    
    return dbShifts;
  }, [allShifts, currentDate, previewShifts]);

        const currentWeekShiftLookup = useMemo(() => createScheduleShiftLookup(currentWeekShifts), [currentWeekShifts]);

        const currentWeekShiftDates = useMemo(() => new Set(currentWeekShifts.map((shift) => shift.date)), [currentWeekShifts]);

        const currentWeekShiftPositionsByDate = useMemo(() => {
            const map = new Map();

            currentWeekShifts.forEach((shift) => {
                if (!shift?.date || !shift?.position) return;

                if (!map.has(shift.date)) {
                    map.set(shift.date, new Set());
                }
                map.get(shift.date).add(shift.position);
            });

            return map;
        }, [currentWeekShifts]);

        const doctorById = useMemo(() => new Map(doctors.map((doctor) => [doctor.id, doctor])), [doctors]);

        const workplaceByName = useMemo(() => new Map(workplaces.map((workplace) => [workplace.name, workplace])), [workplaces]);

    const getPositionTimeslotOptions = (positionName, doctorId = null) => {
        const workplace = workplaceByName.get(positionName);
        if (!workplace?.timeslots_enabled) return [];

        const baseDoctor = doctorId ? doctorById.get(doctorId) : null;
        const doctor = baseDoctor ? getDoctorWithEffectiveFte(baseDoctor, currentDate) : null;

        return (workplaceTimeslotsByWorkplaceId.get(workplace.id) || []).map((timeslot) => ({
            ...buildTimeslotSelectionOption(timeslot, doctor, workplace, workTimeModelMap, centralEmployeesById),
        }));
    };

    const resolveTimeslotSelection = ({ positionName, dateStr = null, requestedTimeslotId = null, onResolved, doctorId = null, initialSelection = null, forceDialog = false, allowCustomEditing = false }) => {
        const normalizedTimeslotId = requestedTimeslotId === '__unassigned__' ? null : requestedTimeslotId;
        if (normalizedTimeslotId && !forceDialog) {
            onResolved(normalizedTimeslotId);
            return true;
        }

        const options = getPositionTimeslotOptions(positionName, doctorId);
        if (options.length === 0) {
            onResolved(null);
            return true;
        }

        if (options.length === 1 && !options[0].canCustomize && !forceDialog) {
            onResolved(options[0].id);
            return true;
        }

        const formattedDate = dateStr ? format(new Date(`${dateStr}T00:00:00`), 'dd.MM.yyyy') : null;
        pendingTimeslotSelectionRef.current = onResolved;
        setTimeslotSelectionDialog({
            open: true,
            workplaceName: positionName,
            description: formattedDate
                ? `${positionName} am ${formattedDate} hat mehrere Zeitfenster.`
                : `${positionName} hat mehrere Zeitfenster.`,
            options,
            allowCustomEditing,
            customEndMinutesByOptionId: buildInitialCustomTimeslotEndMinutesByOption(options, initialSelection),
            customStartMinutesByOptionId: buildInitialCustomTimeslotStartMinutesByOption(options, initialSelection),
            activeTimeslotId: initialSelection?.timeslotId ?? null,
        });
        return false;
    };

    const handleShiftTimeslotEdit = (shift, doctor, workplace) => {
        if (!shift || shift.isPreview || !doctor || !workplace?.timeslots_enabled || isReadOnly) return;

        const options = getPositionTimeslotOptions(shift.position, doctor.id);
        const canOpenDialog = options.length > 0;
        if (!canOpenDialog) return;

        const initialSelection = shift.start_time && shift.end_time
            ? {
                timeslotId: shift.timeslot_id ?? null,
                startTime: shift.start_time,
                endTime: shift.end_time,
                breakMinutes: shift.break_minutes ?? null,
                isCustom: true,
            }
            : {
                timeslotId: shift.timeslot_id ?? null,
                startTime: null,
                endTime: null,
                breakMinutes: null,
                isCustom: false,
            };

        resolveTimeslotSelection({
            positionName: shift.position,
            dateStr: shift.date,
            doctorId: doctor.id,
            initialSelection,
            forceDialog: true,
            allowCustomEditing: true,
            onResolved: (selection) => {
                const normalizedSelection = normalizeTimeslotSelection(selection);
                const nextTimeslotId = normalizedSelection.timeslotId;

                const duplicate = currentWeekShifts.some((entry) => {
                    if (entry.id === shift.id) return false;
                    if (entry.date !== shift.date || entry.position !== shift.position || entry.doctor_id !== shift.doctor_id) return false;
                    if (nextTimeslotId) return entry.timeslot_id === nextTimeslotId;
                    return !entry.timeslot_id;
                });
                if (duplicate) {
                    toast.error('Mitarbeiter ist in diesem Zeitfenster bereits eingeteilt.');
                    return;
                }

                const customCategories = getWorkplaceCategoriesFromSettings(systemSettings);
                const allowsMultiple = workplaceAllowsMultiple(workplace, customCategories);
                if (!allowsMultiple) {
                    const occupyingShift = currentWeekShifts.find((entry) => {
                        if (entry.id === shift.id) return false;
                        if (entry.date !== shift.date || entry.position !== shift.position) return false;
                        if (workplace.timeslots_enabled) {
                            if (nextTimeslotId) return entry.timeslot_id === nextTimeslotId;
                            return !entry.timeslot_id;
                        }
                        return true;
                    });

                    if (occupyingShift) {
                        toast.error('Dieses Zeitfenster ist bereits besetzt.');
                        return;
                    }
                }

                const updateData = applyTimeslotSelectionToUpdateData(
                    { date: shift.date, position: shift.position, order: shift.order },
                    normalizedSelection
                );

                updateShiftMutation.mutate({ id: shift.id, data: updateData });
            },
        });
    };

    const availabilityBlockingDoctorIdsByDate = useMemo(() => {
        const baseMap = getAvailabilityBlockingDoctorIdsByDate({
            localShifts: currentWeekShifts,
            sharedShifts: visiblePoolShifts,
            workplaces,
            doctors,
        });
        // Rotation-Assignments blockieren die Verfügbarkeit — ein Mitarbeiter,
        // der an einem Tag in eine Pool-Rotation eingeteilt ist, ist nicht
        // für reguläre Dienste verfügbar. Mapping via central_employee_id
        // (gleiches Pattern wie sharedShifts in getAvailabilityBlockingDoctorIdsByDate).
        const ceMap = new Map();
        doctors.forEach((doc) => {
            if (!doc.central_employee_id) return;
            const key = String(doc.central_employee_id);
            const list = ceMap.get(key) || [];
            list.push(doc.id);
            ceMap.set(key, list);
        });
        for (const assignment of rotationAssignments) {
            const dateStr = String(assignment.date).slice(0, 10);
            const empId = String(assignment.employee_id);
            const doctorIds = ceMap.get(empId)
                || (doctorById.has(assignment.employee_id) ? [assignment.employee_id] : []);
            for (const docId of doctorIds) {
                const existing = baseMap.get(dateStr) || new Set();
                existing.add(docId);
                baseMap.set(dateStr, existing);
            }
        }
        return baseMap;
    }, [currentWeekShifts, visiblePoolShifts, workplaces, doctors, rotationAssignments, doctorById]);

    // Central employee IDs whose Joker offer has been accepted (demand
    // fulfilled) per date. Used by availableDoctorsByDate to keep the
    // employee hidden in the ward after the pool accepts the transfer.
    const jokerFulfilledCentralIdsByDate = useMemo(() => {
        const map = new Map();
        for (const demand of rotationDemands) {
            if (demand.status !== 'fulfilled' || !demand.offered_employee_id || !demand.date) continue;
            const set = map.get(demand.date) || new Set();
            set.add(String(demand.offered_employee_id));
            map.set(demand.date, set);
        }
        return map;
    }, [rotationDemands]);

    const availableDoctorsByDate = useMemo(() => {
        const map = new Map();

        weekDays.forEach((day) => {
            if (!isValid(day)) return;

            const dateStr = format(day, 'yyyy-MM-dd');
            const assignedDocIds = availabilityBlockingDoctorIdsByDate.get(dateStr) || new Set();
            map.set(dateStr, sortDoctorsForDisplay(
                doctors.filter((doctor) =>
                    !assignedDocIds.has(doctor.id) &&
                    doctor.role !== 'Nicht-Radiologe' &&
                    matchesAllQualificationFilters(doctor) &&
                    !hiddenJokerDoctorIds.has(`${doctor.id}|${dateStr}`) &&
                    // Also hide employees whose Joker offer has been
                    // accepted by the pool (demand fulfilled). The pool
                    // acceptance invalidates the visible-rotations query,
                    // which would otherwise make the employee reappear.
                    !jokerFulfilledCentralIdsByDate.get(dateStr)?.has(String(doctor.central_employee_id || ''))
                )
            ));
        });

        return map;
    }, [availabilityBlockingDoctorIdsByDate, doctors, matchesAllQualificationFilters, sortDoctorsAlphabetically, weekDays, hiddenJokerDoctorIds, jokerFulfilledCentralIdsByDate]);

    // Springer placeholder chips for ward tenants in rotation networks.
    // Produces doctor-like objects that flow through the SAME rendering
    // code as regular available doctors (Verfügbar row + drag clone).
    const springerChipsByDate = useMemo(() => {
        const map = new Map();

        // Only show Springer chips for ward tenants (non-write rotation workplaces)
        const isWardTenant = rotationWorkplaces.length > 0 && rotationWorkplaces.every(wp => wp.canWrite === false);
        if (!isWardTenant || rotationAssignments.length === 0) return map;

        // Assignments that already have an OPEN return-request must not be
        // draggable again (dragging would produce a 409 "already requested").
        const openReturnRequestAssignmentIds = new Set(
            rotationDemands
                .filter((d) => d.status === 'open' && d.return_requested_assignment_id)
                .map((d) => String(d.return_requested_assignment_id))
        );

        // Group rotation assignments by date
        const assignmentsByDate = new Map();
        for (const assignment of rotationAssignments) {
            const dateStr = String(assignment.date).slice(0, 10);
            const list = assignmentsByDate.get(dateStr) || [];
            list.push(assignment);
            assignmentsByDate.set(dateStr, list);
        }

        // Create doctor-like synthetic entries. The `id` field is the central
        // employee_id so that parseAvailableDoctorId etc. resolve correctly.
        // The draggableId in the Verfügbar row will be available-doc-{id}-{dateStr},
        // which flows through the EXACT SAME drag-drop handler as regular doctors.
        for (const day of weekDays) {
            if (!isValid(day)) continue;
            const dateStr = format(day, 'yyyy-MM-dd');
            const assignments = assignmentsByDate.get(dateStr) || [];
            if (assignments.length === 0) continue;

            const chips = assignments
                .filter((assignment) => !openReturnRequestAssignmentIds.has(String(assignment.id)))
                .map((assignment) => {
                    const empName = assignment.employee_name || `#${assignment.employee_id}`;
                    const autoLabel = formatChipLabel(empName);
                    return {
                        id: assignment.employee_id,
                        name: empName,
                        role: 'Arzt',
                        initials: autoLabel,
                        _isSpringer: true,
                        _assignmentId: assignment.id,
                        _employeeId: assignment.employee_id,
                        _employeeName: empName,
                        _groupId: assignment.group_id,
                        _springerLabel: autoLabel,
                    };
                });
            map.set(dateStr, chips);
        }

        return map;
    }, [rotationAssignments, rotationDemands, rotationWorkplaces, weekDays]);

    // Central employee ID → tenant doctor lookup. Used to resolve
    // Joker names (offered_employee_id is a central UUID) and to build
    // Joker chips from fulfilled demands.
    const doctorByCentralEmployeeId = useMemo(() => {
        const map = new Map();
        for (const doc of doctors) {
            if (doc.central_employee_id && !map.has(String(doc.central_employee_id))) {
                map.set(String(doc.central_employee_id), doc);
            }
        }
        return map;
    }, [doctors]);

    // Joker chips for the pool planner's Verfügbar row. Built from
    // fulfilled demands that have an offered_employee_id (ward→pool
    // Joker transfers). These are NOT rotation_assignments — the Joker
    // is unassigned and can be dragged anywhere from the Verfügbar row.
    const jokerChipsByDate = useMemo(() => {
        const map = new Map();
        // Only for pool planners (canWrite on at least one workplace)
        const isPoolTenant = rotationWorkplaces.length > 0 && rotationWorkplaces.some(wp => wp.canWrite === true);
        if (!isPoolTenant) return map;

        for (const demand of rotationDemands) {
            if (demand.status !== 'fulfilled' || !demand.offered_employee_id) continue;
            const dateStr = demand.date;
            if (!dateStr) continue;
            // Skip if this Joker has already been assigned to a cell (the
            // rotation_assignment will block them in Verfügbar via the
            // availabilityBlockingDoctorIdsByDate mechanism).
            const alreadyAssigned = rotationAssignments.some(
                (a) => String(a.employee_id) === String(demand.offered_employee_id)
                    && String(a.date).slice(0, 10) === dateStr
            );
            if (alreadyAssigned) continue;
            const doc = doctorByCentralEmployeeId.get(String(demand.offered_employee_id));
            const centralEmp = centralEmployeesById.get(String(demand.offered_employee_id));
            const name = demand.offered_employee_name
                || doc?.name
                || (centralEmp ? `${centralEmp.first_name || ''} ${centralEmp.last_name || ''}`.trim() : '')
                || `#${demand.offered_employee_id}`;
            const initials = doc?.initials || formatChipLabel(name);
            const chips = map.get(dateStr) || [];
            chips.push({
                id: String(demand.offered_employee_id),
                name,
                role: doc?.role || 'Arzt',
                initials,
                _isJoker: true,
                _jokerDemandId: demand.id,
                _employeeId: String(demand.offered_employee_id),
            });
            map.set(dateStr, chips);
        }
        return map;
    }, [rotationDemands, rotationWorkplaces, rotationAssignments, doctorByCentralEmployeeId, centralEmployeesById]);

    // Fallback doctor map for rotation assignments with Joker employees.
    // The assignment's employee_id is a central UUID — not in doctorById.
    // Used by renderRotationCell's getEmpName fallback.
    // Built from doctorByCentralEmployeeId so name resolution survives
    // even after the Joker chip is filtered out of jokerChipsByDate.
    const jokerDoctorById = useMemo(() => {
        const map = new Map();
        for (const [, docs] of jokerChipsByDate) {
            for (const doc of docs) {
                if (doc._isJoker && !map.has(doc.id)) {
                    map.set(doc.id, doc);
                }
            }
        }
        // Also include doctors with central IDs that may not have
        // active Joker chips (e.g. after being assigned to a cell)
        for (const [centralId, doc] of doctorByCentralEmployeeId) {
            if (!map.has(centralId)) {
                map.set(centralId, {
                    id: centralId,
                    name: doc.name,
                    role: doc.role || 'Arzt',
                    initials: doc.initials || doc.name.slice(0, 2).toUpperCase(),
                    _isJoker: true,
                });
            }
        }
        // Also seed from rotationAssignments with resolved employee_name
        // so that Joker employees from other tenants (not in doctorByCentralEmployeeId)
        // are still resolvable by name in renderRotationCell.
        for (const assignment of rotationAssignments) {
            const empId = String(assignment.employee_id);
            if (!map.has(empId) && assignment.employee_name && !assignment.employee_name.startsWith('#')) {
                map.set(empId, {
                    id: empId,
                    name: assignment.employee_name,
                    role: 'Arzt',
                    initials: formatChipLabel(assignment.employee_name),
                    _isJoker: true,
                });
            }
        }
        return map;
    }, [jokerChipsByDate, doctorByCentralEmployeeId, rotationAssignments]);

    // Fallback doctor map for springer shifts rendered in grid cells.
    // The shift's doctor_id is the central employee ID, which won't be
    // in the local doctorById. This map provides display data for them.
    // Built from raw springerChipsByDate (NOT allDisplayDocsByDate) so
    // that hiding the chip from Verfügbar doesn't break grid rendering.
    const springerDoctorById = useMemo(() => {
        const map = new Map();
        for (const [, docs] of springerChipsByDate) {
            for (const doc of docs) {
                if (doc._isSpringer && !map.has(doc.id)) {
                    map.set(doc.id, doc);
                }
            }
        }
        return map;
    }, [springerChipsByDate]);

    // Springer assignment IDs whose central employee already has a local ShiftEntry
    // for the same date. Derived from currentWeekShifts so that deleting a shift
    // (which triggers ['shifts', ...] invalidation) automatically re-shows the
    // Springer chip in Verfügbar — no hiddenSpringerChipIds race condition needed.
    // MUST be defined AFTER springerDoctorById (referenced in closure).
    const springerDoctorIdByDateWithLocalShift = useMemo(() => {
        const dateMap = new Map(); // dateStr → Set<central_employee_id>
        for (const shift of currentWeekShifts) {
            const doc = springerDoctorById.get(shift.doctor_id);
            if (!doc?._isSpringer) continue;
            const dateStr = String(shift.date).slice(0, 10);
            if (!dateMap.has(dateStr)) dateMap.set(dateStr, new Set());
            dateMap.get(dateStr).add(doc.id);
        }
        return dateMap;
    }, [currentWeekShifts, springerDoctorById]);

    // Combined: real available doctors + Springer placeholder chips (filtered by hidden set
    // AND derived local-shift check). Used by the Verfügbar row rendering and drag clone.
    const allDisplayDocsByDate = useMemo(() => {
        const map = new Map();
        for (const day of weekDays) {
            if (!isValid(day)) continue;
            const dateStr = format(day, 'yyyy-MM-dd');
            const realDocs = availableDoctorsByDate.get(dateStr) || [];
            const springerDocs = springerChipsByDate.get(dateStr) || [];
            const assignedSpringerDoctorIds = springerDoctorIdByDateWithLocalShift.get(dateStr) || new Set();
            const visibleSpringers = springerDocs.filter(d =>
                !hiddenSpringerChipIds.has(d._assignmentId) &&
                !assignedSpringerDoctorIds.has(d.id)
            );
            const jokerDocs = jokerChipsByDate.get(dateStr) || [];
            map.set(dateStr, [...realDocs, ...visibleSpringers, ...jokerDocs]);
        }
        return map;
    }, [availableDoctorsByDate, springerChipsByDate, jokerChipsByDate, hiddenSpringerChipIds, springerDoctorIdByDateWithLocalShift, weekDays]);

    const lateRotationIndicatorByDoctorDay = useMemo(() => {
        const indicatorMap = new Map();

        currentWeekShifts.forEach((shift) => {
                if (!shift?.doctor_id || !shift?.date) return;
                const workplace = workplaces.find((entry) => entry.name === shift.position);
                const indicator = getLateRotationIndicator(shift, workplace, workplaceTimeslots);
                if (!indicator.show) return;

                indicatorMap.set(`${shift.doctor_id}__${shift.date}`, indicator.tooltip);
        });

        return indicatorMap;
    }, [currentWeekShifts, workplaces, workplaceTimeslots]);

  // Pro Arzt: Geplante Stunden in der aktuellen Woche berechnen
  const weeklyPlannedHours = useMemo(() => {
    if (!weekDays.length || !currentWeekShifts.length) return new Map();
    const map = new Map();
    const weekStart = format(weekDays[0], 'yyyy-MM-dd');
    const weekEnd = format(weekDays[weekDays.length - 1], 'yyyy-MM-dd');
        const shiftsByDoctorAndDate = new Map();

        for (const shift of currentWeekShifts) {
            if (shift.date < weekStart || shift.date > weekEnd) continue;
            if (!shift.doctor_id) continue;
            if (isNonWorkingShiftPosition(shift.position)) continue;

            const workplace = workplaces.find(wp => wp.name === shift.position);
            if (workplace?.service_type === 2) continue;
            if (workplace?.affects_availability === false) continue;

            const groupKey = `${shift.doctor_id}__${shift.date}`;
            if (!shiftsByDoctorAndDate.has(groupKey)) {
                shiftsByDoctorAndDate.set(groupKey, []);
            }
            shiftsByDoctorAndDate.get(groupKey).push({ shift, workplace });
        }

        shiftsByDoctorAndDate.forEach((entries, groupKey) => {
            const [doctorId, dateStr] = groupKey.split('__');
            const baseDoctor = doctors.find(d => d.id === doctorId);
            const doctor = baseDoctor ? getDoctorWithEffectiveFte(baseDoctor, dateStr) : null;
            const intervals = entries
                .map(({ shift, workplace }) => {
                    const timeslot = shift.timeslot_id
                        ? workplaceTimeslots.find(slot => slot.id === shift.timeslot_id)
                        : null;
                    return buildShiftInterval(shift, doctor, workplace, timeslot, workTimeModelMap, centralEmployeesById);
                })
                .filter(Boolean);

            if (!intervals.length) return;

            const totalMinutes = mergePlannedIntervals(intervals);
            if (totalMinutes <= 0) return;

            map.set(doctorId, (map.get(doctorId) || 0) + (totalMinutes / 60));
        });

    return map;
    }, [currentWeekShifts, weekDays, doctors, workplaces, workplaceTimeslots, workTimeModelMap, centralEmployeesById]);

  const cleanupAutoFreiOnly = (doctorId, dateStr, position) => {
      const autoFreiShift = findAutoFreiToCleanup(doctorId, dateStr, position);
      if (autoFreiShift) {
          deleteShiftMutation.mutate(autoFreiShift.id);
      }
  };

  const deleteShiftWithCleanup = (shift) => {
      // Skip if temp ID (optimistic update not yet persisted)
      if (shift.id?.startsWith('temp-')) {
          console.log(`[DEBUG-LOG] Skipping delete for temp shift ${shift.id}`);
          // Cancel optimistic update
          queryClient.setQueryData(['shifts', fetchRange.start, fetchRange.end], old => 
              old?.filter(s => s.id !== shift.id) || []
          );
          return;
      }

      console.log(`[DEBUG-LOG] deleteShiftWithCleanup triggered for Shift ${shift.id} (${shift.position})`);
      const idsToDelete = [shift.id];
      if (isAutoOffPosition(shift.position)) {
           const autoFreiShift = findAutoFreiToCleanup(shift.doctor_id, shift.date, shift.position);
           if (autoFreiShift && !autoFreiShift.id?.startsWith('temp-')) {
               console.log(`[DEBUG-LOG] Found Auto-Frei to cleanup: ${autoFreiShift.id}`);
               idsToDelete.push(autoFreiShift.id);
           }
      }

      if (idsToDelete.length === 1) {
          console.log(`[DEBUG-LOG] Mutating Single Delete: ${idsToDelete[0]}`);
          deleteShiftMutation.mutate(idsToDelete[0]);
      } else {
          console.log(`[DEBUG-LOG] Mutating Bulk Delete: ${idsToDelete.join(', ')}`);
          bulkDeleteMutation.mutate(idsToDelete);
      }
  };

  // ============================================================
  //  PREVIEW AUTO-FREI HELPERS
  //  Mirror the DB-based auto-frei logic for in-memory preview shifts
  // ============================================================

    /**
     * Adds an Auto-Frei preview entry for the direct next day if the position has auto_off.
     * Returns the updated preview array (or unchanged array if no auto-frei needed).
     */
  const addPreviewAutoFrei = (doctorId, dateStr, positionName, currentPreviews) => {
      const autoFreiDateStr = shouldCreateAutoFrei(positionName, dateStr, isPublicHoliday);
      if (!autoFreiDateStr) return currentPreviews;

      // Check if doctor already has something on that date (in preview or DB)
      const allMerged = [...(currentWeekShifts || [])];
      // Also include the current previews being modified
      const previewMerged = [...currentPreviews];
      const hasExisting = allMerged.some(s => s.date === autoFreiDateStr && s.doctor_id === doctorId && !s.isPreview) ||
                          previewMerged.some(s => s.date === autoFreiDateStr && s.doctor_id === doctorId);
      if (hasExisting) return currentPreviews;

      const newAutoFrei = {
          id: `preview-autofrei-${Date.now()}`,
          date: autoFreiDateStr,
          position: 'Frei',
          doctor_id: doctorId,
          note: 'Autom. Freizeitausgleich',
          isPreview: true,
      };
      console.log('[PREVIEW] Auto-Frei hinzugefügt:', newAutoFrei);
      toast.info(`Auto-Frei für ${autoFreiDateStr} hinzugefügt`);
      return [...currentPreviews, newAutoFrei];
  };

  /**
   * Removes any Auto-Frei preview entry that was generated for a shift at the given position/date.
   * Also checks DB-based auto-frei entries (they remain in DB but user is warned).
   * Returns the updated preview array.
   */
  const removePreviewAutoFrei = (doctorId, dateStr, positionName, currentPreviews) => {
      const autoFreiDateStr = shouldCreateAutoFrei(positionName, dateStr, isPublicHoliday);
      if (!autoFreiDateStr) return currentPreviews;

      // Remove from preview
      const filtered = currentPreviews.filter(s => {
          if (s.date !== autoFreiDateStr || s.doctor_id !== doctorId) return true;
          if (s.position !== 'Frei') return true;
          // Match auto-frei entries (either by note or by preview-autofrei ID)
          if (s.id?.startsWith('preview-autofrei-')) return false;
          if (s.note?.includes('Autom.') || s.note?.includes('Freizeitausgleich')) return false;
          return true;
      });

      if (filtered.length < currentPreviews.length) {
          console.log('[PREVIEW] Auto-Frei entfernt für', doctorId, 'am', autoFreiDateStr);
          toast.info(`Auto-Frei für ${autoFreiDateStr} entfernt`);
      }

      // Check if there's a DB-based auto-frei that should also be cleaned up
      const dbAutoFrei = findAutoFreiToCleanup(doctorId, dateStr, positionName);
      if (dbAutoFrei) {
          console.log('[PREVIEW] Hinweis: DB-basiertes Auto-Frei gefunden, wird beim Übernehmen bereinigt:', dbAutoFrei.id);
      }

      return filtered;
  };

  // Called BEFORE dimension capture - must be synchronous to affect measurements
  const handleBeforeCapture = (before) => {
    const { draggableId } = before;
        const normalizedDraggableId = normalizeDraggableId(draggableId);
        if (!normalizedDraggableId) return;

    let docId = null;
    let shiftId = null;
    
    if (normalizedDraggableId.startsWith('sidebar-doc-')) {
        docId = normalizedDraggableId.replace('sidebar-doc-', '');
    } else if (normalizedDraggableId.startsWith('available-doc-')) {
        docId = parseAvailableDoctorId(normalizedDraggableId);
    } else if (normalizedDraggableId.startsWith('shift-')) {
        shiftId = normalizedDraggableId.replace('shift-', '');
        const shift = currentWeekShifts.find(s => s.id === shiftId);
        if (shift) {
            docId = shift.doctor_id;
        }
    }
    flushSync(() => {
      if (docId) setDraggingDoctorId(docId);
      if (shiftId) setDraggingShiftId(shiftId);
    });
  };

  const handleDragStart = (start) => {
    console.log('Drag Start:', start);
    const { draggableId } = start;
    const normalizedDraggableId = normalizeDraggableId(draggableId);
    let docId = null;
    
    if (!normalizedDraggableId) return;

    if (normalizedDraggableId.startsWith('sidebar-doc-')) {
        docId = normalizedDraggableId.replace('sidebar-doc-', '');
    } else if (normalizedDraggableId.startsWith('available-doc-')) {
        docId = parseAvailableDoctorId(normalizedDraggableId);
    } else if (normalizedDraggableId.startsWith('shift-')) {
        const shiftId = normalizedDraggableId.replace('shift-', '');
        setDraggingShiftId(shiftId);
        const shift = currentWeekShifts.find(s => s.id === shiftId);
        if (shift) {
            docId = shift.doctor_id;
        }
    }
    console.log('Dragging Doctor ID:', docId);
    setDraggingDoctorId(docId);

    // Check if dragging from grid
    const { source } = start;
    const sourceDroppableId = stripPanelPrefix(source.droppableId);
    if (sourceDroppableId !== 'sidebar' && !sourceDroppableId.startsWith('available__')) {
        setIsDraggingFromGrid(true);
    }
    };

    const handleDragUpdate = () => {};

  const handleDragEnd = async (result) => {
    setIsDraggingFromGrid(false);
    console.log('DEBUG: Drag Operation Ended', { 
        draggableId: result.draggableId,
        source: result.source,
        destination: result.destination,
        reason: result.reason 
    });
    
    setDraggingDoctorId(null);
    setDraggingShiftId(null);
    const { source, destination, draggableId } = result;

    // Permission guard: admin without can_edit_schedule cannot modify Dienste positions
    if (!isReadOnly && user?.role === 'admin') {
      const perms = user.permissions;
      const canEditSchedule = !perms || typeof perms !== 'object' || perms.can_edit_schedule !== false;
      if (!canEditSchedule) {
        // Only block if the target/modified position is a "Dienste" workplace
        const destPos = destination ? stripPanelPrefix(destination.droppableId).split('__')[1] : null;
        const srcPos = source.droppableId !== 'sidebar' && source.droppableId !== 'available__' && !source.droppableId.startsWith('available__')
          ? stripPanelPrefix(source.droppableId).split('__')[1] : null;
        const checkPos = destPos || srcPos;
        const isDienste = checkPos && workplaces.some(w => w.name === checkPos && w.category === 'Dienste');
        if (isDienste) {
          console.warn('[Permissions] Admin ohne can_edit_schedule, Dienste-Drag blockiert:', user.email, 'position:', checkPos);
          alert('Ihre Berechtigung "Dienstplan bearbeiten" ist deaktiviert. Bitte wenden Sie sich an einen Super-Admin.');
          return;
        }
      }
    }

    const normalizedDraggableId = normalizeDraggableId(draggableId);
    const sourceDroppableId = stripPanelPrefix(source.droppableId);
    const destinationDroppableId = destination ? stripPanelPrefix(destination.droppableId) : null;

    // ============================================================
    //  SPRINGER HIDE-ON-TRASH (Ward-Tenant Rotation Network)
    //  A Springer chip dragged to the trash / sidebar is merely hidden
    //  from the Verfügbar row. The rotation assignment is NOT deleted.
    //  Grid-drops on station workplaces are handled by the regular
    //  available-doc handler below (same draggableId format).
    // ============================================================
    if ((destinationDroppableId === 'trash' || destinationDroppableId === 'trash-overlay' || destinationDroppableId === 'sidebar') && sourceDroppableId.startsWith('available__')) {
        const hideDateStr = sourceDroppableId.replace('available__', '');
        const hideDoc = (allDisplayDocsByDate.get(hideDateStr) || [])[source.index];
        if (hideDoc?._isSpringer) {
            setHiddenSpringerChipIds(prev => new Set([...prev, hideDoc._assignmentId]));
            toast.success('Springer aus Verfügbar entfernt');
            return;
        }
    }

    // ============================================================
    //  ROTATION ASSIGNMENT DRAG-OUT (Pool-Rotationen)
    //  Detect rotation-assignment-* dragged to trash or available.
    // ============================================================
    if (normalizedDraggableId.startsWith('rotation-assignment-')) {
        const assignmentId = normalizedDraggableId.replace('rotation-assignment-', '');
        const assignment = rotationAssignments.find((a) => String(a.id) === String(assignmentId));
        if (!assignment) return;

        // Dropped outside or to Verfügbar/sidebar/trash → delete
        if (!destination || destinationDroppableId === 'sidebar' || destinationDroppableId.startsWith('available__') || destinationDroppableId.endsWith('__Verfügbar') || destinationDroppableId === 'trash' || destinationDroppableId === 'trash-overlay') {
            try {
                await api.deleteRotationAssignment(assignment.group_id, assignmentId);
                queryClient.invalidateQueries({ queryKey: ['rotations', 'visible-rotations'] });
                queryClient.invalidateQueries({ queryKey: ['rotations', 'demands'] });
                toast.success('Einteilung entfernt');
            } catch (err) {
                toast.error('Fehler beim Entfernen: ' + (err?.message || ''));
            }
        }
        return;
    }

    // ============================================================
    //  ROTATION CELL DROP (Pool-Rotationen)
    //  Timeslot-Auswahl wie bei normalen Rotationen.
    //  Für Ward-Tenants: Springer-Chip → Rückgabe an den Pool anfordern.
    // ============================================================
    if (destinationDroppableId && (destinationDroppableId.startsWith('rotationCell__') || destinationDroppableId.startsWith('rotationCellTslot__'))) {
        const isTimeslotCell = destinationDroppableId.startsWith('rotationCellTslot__');
        const parts = destinationDroppableId.split('__');
        const wpId = isTimeslotCell ? parts[1] : parts[1];
        const destDate = isTimeslotCell ? parts[2] : parts[2];
        const tsId = isTimeslotCell ? parts[3] : null;
        if (!wpId || !destDate) return;

        // Resolve doctor from sidebar, available, or shift drag
        let doctorId = null;
        if (normalizedDraggableId.startsWith('sidebar-doc-')) {
            doctorId = normalizedDraggableId.replace('sidebar-doc-', '');
        } else if (normalizedDraggableId.startsWith('available-doc-')) {
            doctorId = parseAvailableDoctorId(normalizedDraggableId);
        } else if (normalizedDraggableId.startsWith('shift-')) {
            const shift = currentWeekShifts.find(s => s.id === normalizedDraggableId.replace('shift-', ''));
            if (shift) doctorId = shift.doctor_id;
        }

        if (!doctorId) return;

        // Find the rotation workplace
        const wp = rotationWorkplaces.find(w => String(w.id) === String(wpId));
        if (!wp) return;

        // ────────────────────────────────────────────────────────────
        //  WARD-TENANT: Springer zurück an den Pool anfordern
        //  Im Ward-Tenant (wp.canWrite === false) gibt es keine
        //  createRotationAssignment-Berechtigung. Statt dessen kann
        //  ein Springer-Chip aus der Verfügbar-Reihe auf die
        //  Pool-Tageszelle gezogen werden, um eine Rückgabe-Anfrage
        //  (Demand mit return_requested_assignment_id) zu stellen.
        // ────────────────────────────────────────────────────────────
        if (wp.canWrite === false && normalizedDraggableId.startsWith('available-doc-')) {
            const springerDoc = (allDisplayDocsByDate.get(sourceDroppableId.replace('available__', '')) || [])
                .find((d) => d._isSpringer && d.id === doctorId);
            if (springerDoc?._assignmentId) {
                const assignmentId = springerDoc._assignmentId;
                const confirmed = window.confirm('Wollen Sie den Springer an den Pool zurückgeben?');
                if (!confirmed) return;
                // Optimistically hide the chip so the user can't re-trigger
                // the request while the network round-trip is in flight (which
                // would otherwise produce a 409 "already requested").
                setHiddenSpringerChipIds((prev) => new Set([...prev, assignmentId]));
                api.createRotationDemand({
                    rotation_workplace_id: wp.id,
                    date: destDate,
                    timeslot_id: tsId || null,
                    return_requested_assignment_id: assignmentId,
                    note: 'Rückgabe an den Pool angefordert',
                }).then(() => {
                    queryClient.invalidateQueries({ queryKey: ['rotations', 'demands'] });
                    queryClient.invalidateQueries({ queryKey: ['rotations', 'visible-rotations'] });
                    toast.success('Rückgabe angefordert — Pool wurde benachrichtigt.');
                }).catch((err) => {
                    // On error: re-show the chip so the user can retry.
                    setHiddenSpringerChipIds((prev) => {
                        const next = new Set(prev);
                        next.delete(assignmentId);
                        return next;
                    });
                    const msg = err?.status === 409
                        ? 'Für diesen Springer wurde bereits eine Rückgabe angefordert.'
                        : 'Fehler beim Anfordern der Rückgabe: ' + (err?.message || '');
                    toast.error(msg);
                });
                return;
            }
        }

        // ────────────────────────────────────────────────────────────
        //  WARD-TENANT: Joker an den Pool übergeben
        //  Ein regulärer Mitarbeiter (kein Springer) wird aus der
        //  Verfügbar-Leiste auf eine Pool-Timeslot-Zelle gezogen,
        //  um ihn dem Springerpool als "Joker" anzubieten.
        // ────────────────────────────────────────────────────────────
        if (wp.canWrite === false && normalizedDraggableId.startsWith('available-doc-')) {
            // Only regular doctors (not Springer chips) can be offered as Joker
            const isSpringer = (allDisplayDocsByDate.get(sourceDroppableId.replace('available__', '')) || [])
                .some((d) => d._isSpringer && d.id === doctorId);
            if (!isSpringer) {
                const doctor = doctorById.get(doctorId);
                const doctorName = doctor?.name || doctorId;
                const centralEmployeeId = doctor?.central_employee_id;
                if (!centralEmployeeId) {
                    toast.error('Dieser Mitarbeiter hat keine zentrale Verknüpfung und kann nicht an den Pool übergeben werden.');
                    return;
                }
                const confirmed = window.confirm(
                    `Wollen Sie ${doctorName} an den Springerpool übergeben?`
                );
                if (!confirmed) return;
                // Hide the doctor chip from Verfügbar for this date so the
                // ward can't accidentally re-offer the same person.
                const sourceDateKey = sourceDroppableId.replace('available__', '');
                const hideKey = `${doctorId}|${sourceDateKey}`;
                setHiddenJokerDoctorIds((prev) => new Set([...prev, hideKey]));
                api.createRotationDemand({
                    rotation_workplace_id: wp.id,
                    date: destDate,
                    timeslot_id: tsId || null,
                    offered_employee_id: centralEmployeeId,
                    note: `Übergabe von ${doctorName} an den Pool gewünscht`,
                }).then(() => {
                    queryClient.invalidateQueries({ queryKey: ['rotations', 'demands'] });
                    queryClient.invalidateQueries({ queryKey: ['rotations', 'visible-rotations'] });
                    toast.success(`${doctorName} wurde dem Pool angeboten.`);
                }).catch((err) => {
                    // Re-show the chip so the user can retry
                    setHiddenJokerDoctorIds((prev) => {
                        const next = new Set(prev);
                        next.delete(hideKey);
                        return next;
                    });
                    const msg = err?.status === 409
                        ? 'Für diesen Mitarbeiter existiert bereits ein Angebot in dieser Zelle.'
                        : 'Fehler bei der Joker-Übergabe: ' + (err?.message || '');
                    toast.error(msg);
                });
                return;
            }
        }

        const hasTimeslots = wp.timeslots_enabled && wp.timeslots?.length > 0;

        // Build callback for timeslot selection (or direct creation)
        const doCreate = (timeslotId) => {
            api.createRotationAssignment(wp.group_id, {
                rotation_workplace_id: wp.id,
                date: destDate,
                employee_id: doctorId,
                timeslot_id: timeslotId || null,
            }).then(() => {
                queryClient.invalidateQueries({ queryKey: ['rotations', 'visible-rotations'] });
                queryClient.invalidateQueries({ queryKey: ['rotations', 'demands'] });
                toast.success('Springer eingeteilt');
            }).catch((err) => {
                toast.error('Fehler: ' + (err?.message || ''));
            });
        };

        // Drop on a specific timeslot cell → no dialog, create directly
        if (isTimeslotCell) {
            doCreate(tsId);
            return;
        }

        if (hasTimeslots) {
            const options = wp.timeslots.map((ts) => ({
                id: ts.id,
                label: ts.label,
                start_time: ts.start_time,
                end_time: ts.end_time,
                canCustomize: false,
            }));
            pendingTimeslotSelectionRef.current = doCreate;
            setTimeslotSelectionDialog({
                open: true,
                workplaceName: wp.name,
                description: `${wp.name} am ${format(new Date(destDate + 'T00:00:00'), 'dd.MM.yyyy')} hat mehrere Zeitfenster.`,
                options,
                allowCustomEditing: false,
                customEndMinutesByOptionId: {},
            });
        } else {
            doCreate(null);
        }
        return;
    }

    // ============================================================
    //  PREVIEW SHIFT DRAG HANDLING
    //  Preview shifts are modified in-memory (no DB operations)
    // ============================================================
    if (normalizedDraggableId.startsWith('shift-preview-')) {
        const shiftId = normalizedDraggableId.replace('shift-', '');
        const previewShift = previewShifts?.find(s => s.id === shiftId);
        if (!previewShift || !previewShifts) return;

        // Dropped outside or to trash/sidebar → remove from preview
        if (!destination || destinationDroppableId === 'sidebar' || destinationDroppableId === 'trash' || destinationDroppableId === 'trash-overlay' || destinationDroppableId.startsWith('available__') || destinationDroppableId.endsWith('__Verfügbar')) {
            let remaining = previewShifts.filter(s => s.id !== shiftId);
            // Auto-Frei cleanup: if removed shift was on an auto-off position, remove its auto-frei too
            if (isAutoOffPosition(previewShift.position)) {
                remaining = removePreviewAutoFrei(previewShift.doctor_id, previewShift.date, previewShift.position, remaining);
            }
            if (remaining.length === 0) {
                setPreviewShifts(null);
                setPreviewCategories(null);
            } else {
                setPreviewShifts(remaining);
            }
            toast.info('Vorschlag entfernt');
            return;
        }

        // Dropped on row header → assign Mo-Fr (skip for preview)
        if (destinationDroppableId.startsWith('rowHeader__')) {
            return;
        }

        // Dropped to same position → no change
        if (sourceDroppableId === destinationDroppableId && source.index === destination.index) return;

        // Dropped to a grid cell → move preview entry
        const destParts = destinationDroppableId.split('__');
        const newDateStr = destParts[0];
        const newPosition = destParts[1];
        const rawNewTimeslotId = destParts[2] || null;
        if (!newDateStr || !newPosition) return;

        const executePreviewMove = (selection) => {
            const normalizedSelection = normalizeTimeslotSelection(selection);
            const resolvedPreviewTimeslotId = normalizedSelection.timeslotId;
            const absencePositions = ["Frei", "Krank", "Urlaub", "Dienstreise", "Nicht verfügbar"];
            if (!absencePositions.includes(newPosition)) {
                const wp = workplaces.find(w => w.name === newPosition);
                if (wp) {
                    const activeDays = (wp.active_days && wp.active_days.length > 0) ? wp.active_days : [1, 2, 3, 4, 5];
                    const date = new Date(newDateStr + 'T00:00:00');
                    const dayOfWeek = date.getDay();
                    const isActive = isPublicHoliday(date)
                        ? activeDays.some(d => Number(d) === 0)
                        : activeDays.some(d => Number(d) === dayOfWeek);
                    if (!isActive) {
                        toast.error('Diese Position ist an diesem Tag nicht aktiv.');
                        return;
                    }
                }
            }

            const previewBlock = getScheduleBlock(newDateStr, newPosition, resolvedPreviewTimeslotId);
            if (previewBlock) {
                toast.error('Zelle gesperrt' + (previewBlock.reason ? `: ${previewBlock.reason}` : ''));
                return;
            }

            const allMerged = [...(currentWeekShifts || [])];
            const duplicate = allMerged.find(s => 
                s.id !== shiftId &&
                s.date === newDateStr && 
                s.position === newPosition && 
                s.doctor_id === previewShift.doctor_id &&
                (resolvedPreviewTimeslotId ? s.timeslot_id === resolvedPreviewTimeslotId : !s.timeslot_id)
            );
            if (duplicate) {
                toast.error('Arzt ist dort bereits eingeteilt.');
                return;
            }

            let updated = previewShifts.map(s => {
                if (s.id !== shiftId) return s;
                const nextShift = applyTimeslotSelectionToUpdateData(
                    { ...s, date: newDateStr, position: newPosition },
                    normalizedSelection
                );
                if (resolvedPreviewTimeslotId) {
                    nextShift.timeslot_id = resolvedPreviewTimeslotId;
                } else {
                    delete nextShift.timeslot_id;
                }
                return nextShift;
            });

            if (isAutoOffPosition(previewShift.position)) {
                updated = removePreviewAutoFrei(previewShift.doctor_id, previewShift.date, previewShift.position, updated);
            }
            if (isAutoOffPosition(newPosition)) {
                updated = addPreviewAutoFrei(previewShift.doctor_id, newDateStr, newPosition, updated);
            }

            setPreviewShifts(updated);
        };

        if (!resolveTimeslotSelection({
            positionName: newPosition,
            dateStr: newDateStr,
            requestedTimeslotId: rawNewTimeslotId,
            onResolved: executePreviewMove,
            doctorId: previewShift.doctor_id,
        })) {
            return;
        }
        return;
    }

    // If dropped outside any droppable and was from grid -> delete
    if (!destination) {
        if (isDraggingFromGrid && normalizedDraggableId.startsWith('shift-')) {
            const shiftId = normalizedDraggableId.replace('shift-', '');
            // Skip temp IDs (optimistic updates not yet persisted)
            if (shiftId.startsWith('temp-')) {
                return;
            }
            const shift = currentWeekShifts.find(s => s.id === shiftId) || allShifts.find(s => s.id === shiftId);
            if (shift) {
                const springerDoc = springerDoctorById.get(shift.doctor_id);
                if (springerDoc?._isSpringer) {
                    setHiddenSpringerChipIds(prev => {
                        const next = new Set(prev);
                        next.delete(springerDoc._assignmentId);
                        return next;
                    });
                }
                deleteShiftWithCleanup(shift);
            }
        }
        return;
    }

      const absencePositions = ["Frei", "Krank", "Urlaub", "Dienstreise", "Nicht verfügbar"];

      // Helper: Check if workplace is active on a given date (active_days + holiday check)
      // Feiertage verhalten sich wie Sonntag (Index 0)
      // Default active_days (wenn nicht gesetzt): Mo-Fr [1,2,3,4,5]
      const isWorkplaceActiveOnDate = (positionName, dateStr) => {
          const wp = workplaces.find(w => w.name === positionName);
          if (!wp) return true;
          const activeDays = (wp.active_days && wp.active_days.length > 0) ? wp.active_days : [1, 2, 3, 4, 5];
          const date = new Date(dateStr + 'T00:00:00');
          const dayOfWeek = date.getDay(); // 0=So, 1=Mo, ..., 6=Sa
          // Feiertag = wie Sonntag behandeln: An Feiertagen zählt nur, ob Sonntag (0) aktiv ist
          if (isPublicHoliday(date)) {
              return activeDays.some(d => Number(d) === 0);
          }
          return activeDays.some(d => Number(d) === dayOfWeek);
      };

      // Helper to find occupying shift for services or demos (for replacement)
      const findOccupyingShift = (dateStr, position, ignoreShiftId = null, timeslotId = null) => {
          const targetWorkplace = workplaces.find(w => w.name === position);
          if (!targetWorkplace) return null;

          // Prüfe allows_multiple direkt am Workplace (mit Kategorie-Fallback)
          const customCategories = getWorkplaceCategoriesFromSettings(systemSettings);
          const allowsMultiple = workplaceAllowsMultiple(targetWorkplace, customCategories);

          if (allowsMultiple) return null;

          return currentWeekShifts.find((shift) => {
               if (shift.date !== dateStr || shift.position !== position || shift.id === ignoreShiftId) {
                   return false;
               }

               if (targetWorkplace.timeslots_enabled) {
                   if (timeslotId) return shift.timeslot_id === timeslotId;
                   return !shift.timeslot_id;
               }

               return true;
          });
      };

      // Helper to cleanup other shifts when becoming absent
      const cleanupOtherShifts = (doctorId, dateStr, currentShiftId = null) => {
        const shiftsToDelete = currentWeekShifts.filter(s => 
            s.doctor_id === doctorId && 
            s.date === dateStr && 
            s.id !== currentShiftId
        );
        shiftsToDelete.forEach(s => deleteShiftMutation.mutate(s.id));
    };

    // Helper to handle automatic "Frei" after "Dienst Vordergrund" or other auto-off shifts
    const handlePostShiftOff = (doctorId, dateStr, positionName) => {
        // Zentrale Logik: Prüft ob Auto-Frei erstellt werden soll (inkl. Feiertag-Check, ohne Wochenend-Block)
        const autoFreiDateStr = shouldCreateAutoFrei(positionName, dateStr, isPublicHoliday);
        
        if (!autoFreiDateStr) return;

        const nextDay = new Date(autoFreiDateStr);

        // Staffing Check for the auto-off day
        const warning = checkStaffing(autoFreiDateStr, doctorId);
        if (warning) {
            alert(`${warning}\n\n(Durch automatischen Freizeitausgleich am ${format(nextDay, 'dd.MM.')})`);
        }

        const existingShift = allShifts.find(s => s.date === autoFreiDateStr && s.doctor_id === doctorId);

        if (!existingShift) {
            createAutoFreiMutation.mutate({ 
                date: autoFreiDateStr, 
                position: 'Frei', 
                doctor_id: doctorId,
                note: 'Autom. Freizeitausgleich'
            });
        } else if (existingShift.position !== 'Frei') {
             if (window.confirm(`Für den Folgetag (${format(nextDay, 'dd.MM.')}) existiert bereits ein Eintrag "${existingShift.position}". Soll dieser durch "Frei" ersetzt werden?`)) {
                 updateAutoFreiMutation.mutate({
                     id: existingShift.id,
                     data: { position: 'Frei', note: 'Autom. Freizeitausgleich' }
                 });
             }
        }
    };

    // Handle Drop on Row Header (Assign Mo-Fr)
    if (destinationDroppableId.startsWith('rowHeader__')) {
        // Format: rowHeader__position oder rowHeader__position__timeslotId
        const headerParts = destinationDroppableId.replace('rowHeader__', '').split('__');
        const rowName = headerParts[0];
        const rawHeaderTimeslotId = headerParts[1] || null;
        const rowHeaderTimeslotId = rawHeaderTimeslotId;

        // Springer chips cannot be assigned Mo-Fr — they apply to one day only
        if (sourceDroppableId.startsWith('available__')) {
            const springerSourceDate = sourceDroppableId.replace('available__', '');
            const springerDoc = (allDisplayDocsByDate.get(springerSourceDate) || [])[source.index];
            if (springerDoc?._isSpringer) {
                toast.error('Springer kann nicht für die ganze Woche eingeteilt werden');
                return;
            }
        }

        let doctorId = null;

           if (sourceDroppableId === 'sidebar') {
               doctorId = normalizedDraggableId.replace('sidebar-doc-', '');
           } else if (normalizedDraggableId.startsWith('shift-')) {
               const shift = currentWeekShifts.find(s => s.id === normalizedDraggableId.replace('shift-', ''));
             doctorId = shift?.doctor_id;
           } else if (normalizedDraggableId.startsWith('available-doc-')) {
               doctorId = parseAvailableDoctorId(normalizedDraggableId);
        }

        if (!doctorId) return;

        const assignWeekdaysToTimeslot = async (selection) => {
            const normalizedSelection = normalizeTimeslotSelection(selection);
            const resolvedTimeslotId = normalizedSelection.timeslotId;
            const monday = startOfWeek(currentDate, { weekStartsOn: 1 });
            const allWeekDays = [0, 1, 2, 3, 4, 5, 6].map(offset => addDays(monday, offset));
            const daysToAssign = allWeekDays.filter(day => isWorkplaceActiveOnDate(rowName, format(day, 'yyyy-MM-dd')));

            const toCreate = [];
            const toDelete = [];

            let successCount = 0;
            let blockedCount = 0;

            for (const day of daysToAssign) {
                const dateStr = format(day, 'yyyy-MM-dd');

                if (getScheduleBlock(dateStr, rowName, resolvedTimeslotId)) {
                    blockedCount++;
                    continue;
                }

                if (checkConflicts(doctorId, dateStr, rowName, true)) {
                    blockedCount++;
                    continue;
                }

                const limitWarning = checkLimits(doctorId, dateStr, rowName);
                if (limitWarning) {
                    toast.warning(`Limit Warnung (${format(day, 'dd.MM')}): ${limitWarning}`);
                }

                if (absencePositions.includes(rowName)) {
                    const staffingWarn = checkStaffing(dateStr, doctorId);
                    if (staffingWarn) toast.warning(staffingWarn);

                    const others = currentWeekShifts.filter(s => s.doctor_id === doctorId && s.date === dateStr);
                    others.forEach(s => toDelete.push(s.id));
                } else {
                    const occupying = findOccupyingShift(dateStr, rowName, null, resolvedTimeslotId);
                    if (occupying) {
                        if (isAutoOffPosition(occupying.position)) {
                            // cleanupAutoFrei omitted for batch simplicity or handled later
                        }
                        toDelete.push(occupying.id);
                    }
                }

                const effectiveTsId = resolvedTimeslotId === '__unassigned__' ? null : resolvedTimeslotId;
                
                const existingShift = currentWeekShifts.find(s => {
                    if (s.date !== dateStr || s.position !== rowName || s.doctor_id !== doctorId) return false;
                    if (effectiveTsId) return s.timeslot_id === effectiveTsId;
                    return !s.timeslot_id;
                });
                if (existingShift) continue; 

                // Bei Timeslot-Zeilen: Filter auch nach timeslot_id
                const cellShifts = currentWeekShifts.filter(s => {
                    if (s.date !== dateStr || s.position !== rowName) return false;
                    if (effectiveTsId) return s.timeslot_id === effectiveTsId;
                    return !s.timeslot_id;
                });
                // Also check pending creates for order calculation within this batch
                const pendingInCell = toCreate.filter(s => s.date === dateStr && s.position === rowName && s.timeslot_id === effectiveTsId);

                const maxOrder = Math.max(
                    cellShifts.reduce((max, s) => Math.max(max, s.order || 0), -1),
                    pendingInCell.reduce((max, s) => Math.max(max, s.order || 0), -1)
                );

                const newShiftData = {
                    date: dateStr,
                    position: rowName,
                    doctor_id: doctorId,
                    order: maxOrder + 1
                };
                toCreate.push(applyTimeslotSelectionToCreateData(newShiftData, {
                    ...normalizedSelection,
                    timeslotId: effectiveTsId,
                }));
                successCount++;
            }

            if (toDelete.length > 0) {
                await bulkDeleteMutation.mutateAsync(toDelete);
            }
            if (toCreate.length > 0) {
                const created = await db.ShiftEntry.bulkCreate(toCreate);
                if (created && Array.isArray(created)) {
                    setUndoStack(prev => [...prev, { type: 'BULK_DELETE', ids: created.map(c => c.id) }]);
                }
                setTimeout(() => queryClient.invalidateQueries(['shifts', fetchRange.start, fetchRange.end]), 100);
            }

            if (successCount > 0) toast.success(`${successCount} Tage zugewiesen (Mo-Fr)`);
            if (blockedCount > 0) toast.warning(`${blockedCount} Tage übersprungen wegen Konflikten`);
        };

        if (!resolveTimeslotSelection({
            positionName: rowName,
            requestedTimeslotId: rowHeaderTimeslotId,
            onResolved: (selection) => {
                void assignWeekdaysToTimeslot(selection);
            },
            doctorId,
        })) {
            return;
        }

        return;
    }

    // 1. Reordering in Sidebar
    if (sourceDroppableId === 'sidebar' && destinationDroppableId === 'sidebar') {
        if (source.index === destination.index) return;

        const newDoctors = Array.from(sidebarDoctors);
        const [movedDoctor] = newDoctors.splice(source.index, 1);
        newDoctors.splice(destination.index, 0, movedDoctor);

        newDoctors.forEach((doc, index) => {
            if (doc.order !== index) {
                updateDoctorMutation.mutate({ id: doc.id, data: { order: index } });
            }
        });
        return;
    }

    // Dragged from Grid to Available or Sidebar (Delete/Return)
    // Note: Available droppableId format is `available__${dateStr)}
    const isDestAvailable = destinationDroppableId.startsWith('available__') || destinationDroppableId.endsWith('__Verfügbar');
    const isSourceFromGrid = sourceDroppableId !== 'sidebar' && !sourceDroppableId.startsWith('available__');

    if (isSourceFromGrid && (isDestAvailable || destinationDroppableId === 'sidebar')) {
         const shiftId = normalizedDraggableId.replace('shift-', '');

         // Preview shift → remove from preview state (not DB)
         if (shiftId.startsWith('preview-') && previewShifts) {
             const removedShift = previewShifts.find(s => s.id === shiftId);
             let remaining = previewShifts.filter(s => s.id !== shiftId);
             // Auto-Frei cleanup: if removed shift was on an auto-off position, remove its auto-frei too
             if (removedShift && isAutoOffPosition(removedShift.position)) {
                 remaining = removePreviewAutoFrei(removedShift.doctor_id, removedShift.date, removedShift.position, remaining);
             }
             if (remaining.length === 0) {
                 setPreviewShifts(null);
                 setPreviewCategories(null);
             } else {
                 setPreviewShifts(remaining);
             }
             toast.info('Vorschlag entfernt');
             return;
         }

         const shift = currentWeekShifts.find(s => s.id === shiftId);

         console.log(`[DEBUG-LOG] Drop to Trash/Sidebar. ShiftID: ${shiftId}, Found: ${!!shift}`);

         if (shift) {
             // If this is a springer shift, unhide the Verfügbar chip
             const springerDoc = springerDoctorById.get(shift.doctor_id);
             if (springerDoc?._isSpringer) {
                 setHiddenSpringerChipIds(prev => {
                     const next = new Set(prev);
                     next.delete(springerDoc._assignmentId);
                     return next;
                 });
             }
             deleteShiftWithCleanup(shift);
         } else {
             console.error(`[DEBUG-LOG] Shift ${shiftId} not found in currentWeekShifts! Available IDs:`, currentWeekShifts.map(s => s.id));
             // Fallback: Try finding in allShifts directly as safety net
             const fallbackShift = allShifts.find(s => s.id === shiftId);
             if (fallbackShift) {
                 console.log(`[DEBUG-LOG] Found shift in allShifts fallback. Deleting.`);
                 const fallbackSpringerDoc = springerDoctorById.get(fallbackShift.doctor_id);
                 if (fallbackSpringerDoc?._isSpringer) {
                     setHiddenSpringerChipIds(prev => {
                         const next = new Set(prev);
                         next.delete(fallbackSpringerDoc._assignmentId);
                         return next;
                     });
                 }
                 deleteShiftWithCleanup(fallbackShift);
             }
         }
         return;
    }

    // 2. Dragged from Sidebar OR Available to Grid (Create)
    if (sourceDroppableId === 'sidebar' || sourceDroppableId.startsWith('available__')) {
        // Ignore dragging to trash, unknown destinations, available lists, or back to sidebar
        if (destinationDroppableId === 'trash' || destinationDroppableId === 'trash-overlay' || destinationDroppableId === 'sidebar' || !destinationDroppableId.includes('__') || destinationDroppableId.endsWith('__Verfügbar') || destinationDroppableId.startsWith('available__')) return;

        let doctorId;
        if (sourceDroppableId === 'sidebar') {
            doctorId = normalizedDraggableId.replace('sidebar-doc-', '');
        } else {
            doctorId = parseAvailableDoctorId(normalizedDraggableId);
        }

        const dropParts = destinationDroppableId.split('__');
        const dateStr = dropParts[0];
        const position = dropParts[1];
        const rawTimeslotId = dropParts[2] || null;
        if (!dateStr || !position) return;

        // Springer chips are only valid on the day they come from.
        // Also capture the assignment ID so we can hide the chip on success.
        let springerAssignmentId = null;
        if (sourceDroppableId.startsWith('available__')) {
            const springerSourceDate = sourceDroppableId.replace('available__', '');
            const springerDoc = (allDisplayDocsByDate.get(springerSourceDate) || [])[source.index];
            if (springerDoc?._isSpringer) {
                if (springerSourceDate !== dateStr) {
                    toast.error('Springer kann nur am selben Tag eingeteilt werden');
                    return;
                }
                springerAssignmentId = springerDoc._assignmentId;
            }
        }

        // PREVIEW MODE: Add to previewShifts instead of creating DB entry
        if (previewShifts) {
            const executePreviewCreate = (selection) => {
                const normalizedSelection = normalizeTimeslotSelection(selection);
                const resolvedPreviewTimeslotId = normalizedSelection.timeslotId;
                const duplicate = currentWeekShifts.find((shift) => {
                    if (shift.date !== dateStr || shift.position !== position || shift.doctor_id !== doctorId) return false;
                    if (resolvedPreviewTimeslotId) return shift.timeslot_id === resolvedPreviewTimeslotId;
                    return !shift.timeslot_id;
                });
                if (duplicate) {
                    toast.error('Arzt ist dort bereits eingeteilt.');
                    return;
                }

                const newId = `preview-add-${Date.now()}`;
                const newPreviewShift = {
                    ...applyTimeslotSelectionToCreateData(
                        { id: newId, date: dateStr, position, doctor_id: doctorId },
                        normalizedSelection
                    ),
                    isPreview: true,
                };

                let updatedPreviews = [...previewShifts, newPreviewShift];
                if (isAutoOffPosition(position)) {
                    updatedPreviews = addPreviewAutoFrei(doctorId, dateStr, position, updatedPreviews);
                }
                setPreviewShifts(updatedPreviews);
                toast.info('Vorschlag hinzugefügt');
            };

            if (!resolveTimeslotSelection({
                positionName: position,
                dateStr,
                requestedTimeslotId: rawTimeslotId,
                onResolved: executePreviewCreate,
                doctorId,
            })) {
                return;
            }
            return;
        }

        const executeCreateDrop = async (selection) => {
            const normalizedSelection = normalizeTimeslotSelection(selection);
            const timeslotId = normalizedSelection.timeslotId;
            console.log('Dropping Doctor:', doctorId, 'to', dateStr, position, 'timeslotId:', timeslotId);

            const dropBlock = getScheduleBlock(dateStr, position, timeslotId);
            if (dropBlock) {
                toast.error('Zelle gesperrt' + (dropBlock.reason ? `: ${dropBlock.reason}` : ''));
                return;
            }

            if (!absencePositions.includes(position) && !isWorkplaceActiveOnDate(position, dateStr)) {
                toast.error('Diese Position ist an diesem Tag nicht aktiv.');
                return;
            }

            if (absencePositions.includes(position)) {
                const executeAbsenceCreation = () => {
                    cleanupOtherShifts(doctorId, dateStr);

                    const existing = currentWeekShifts.find(s => 
                        s.date === dateStr && s.doctor_id === doctorId && s.position === position
                    );
                    if (existing) {
                        console.log('DEBUG: Absence already exists');
                        return;
                    }

                    const existingInCell = currentWeekShifts.filter(s => s.date === dateStr && s.position === position);
                    const maxOrder = existingInCell.reduce((max, s) => Math.max(max, s.order || 0), -1);
                    const newOrder = maxOrder + 1;

                    createShiftMutation.mutate({ date: dateStr, position, doctor_id: doctorId, order: newOrder });
                };

                const hasConflicts = checkAbsenceDropConflicts(doctorId, dateStr, position, executeAbsenceCreation);
                if (hasConflicts) {
                    console.log('Absence drop conflicts - waiting for override decision');
                    return;
                }

                executeAbsenceCreation();
                return;
            }

            const limitWarning = checkLimits(doctorId, dateStr, position);
            if (limitWarning) alert(limitWarning);

            {
                const effectiveTimeslotId = timeslotId === '__unassigned__' ? null : timeslotId;
                const exists = currentWeekShifts.some(s => {
                    if (s.date !== dateStr || s.position !== position || s.doctor_id !== doctorId) return false;
                    if (effectiveTimeslotId) return s.timeslot_id === effectiveTimeslotId;
                    return !s.timeslot_id;
                });

                if (exists) {
                    console.log('DEBUG: Blocked - Shift already exists for this doctor/date/position/timeslot');
                    alert('Mitarbeiter ist in dieser Position bereits eingeteilt.');
                    return;
                }
            }

            const occupyingShift = findOccupyingShift(dateStr, position, null, timeslotId);

            if (!occupyingShift) {
                const effectiveLockTs = timeslotId === '__unassigned__' ? null : timeslotId;
                if (!lockCell(dateStr, position, effectiveLockTs)) {
                    console.warn('[CellLock] Blocked rapid duplicate drop:', dateStr, position);
                    return;
                }
            }

            const executeShiftCreation = () => {
                if (occupyingShift) {
                    deleteShiftWithCleanup(occupyingShift);
                }

                const shiftsToCreate = [];
                const slotsToProcess = [timeslotId];

                for (const tsId of slotsToProcess) {
                    const effectiveTsId = tsId === '__unassigned__' ? null : tsId;

                    const existsForSlot = currentWeekShifts.some(s => {
                        if (s.date !== dateStr || s.position !== position || s.doctor_id !== doctorId) return false;
                        if (effectiveTsId) return s.timeslot_id === effectiveTsId;
                        return !s.timeslot_id;
                    });
                    if (existsForSlot) {
                        console.log('DEBUG: Skipping - Shift already exists for timeslot:', effectiveTsId);
                        continue;
                    }

                    const existingInCell = currentWeekShifts.filter(s => {
                        if (s.date !== dateStr || s.position !== position) return false;
                        if (effectiveTsId) return s.timeslot_id === effectiveTsId;
                        return !s.timeslot_id;
                    });
                    const maxOrder = existingInCell.reduce((max, s) => Math.max(max, s.order || 0), -1);
                    const newOrder = maxOrder + 1;

                    const newShiftData = applyTimeslotSelectionToCreateData(
                        { date: dateStr, position, doctor_id: doctorId, order: newOrder },
                        {
                            ...normalizedSelection,
                            timeslotId: effectiveTsId,
                        }
                    );
                    shiftsToCreate.push(newShiftData);
                }

                const autoFreiDateStr = shouldCreateAutoFrei(position, dateStr, isPublicHoliday);
                let updateAutoFreiNeeded = false;
                let existingAutoFreiShift = null;

                if (autoFreiDateStr) {
                    const warning = checkStaffing(autoFreiDateStr, doctorId);
                    if (warning) {
                        toast.warning(`${warning}\n(Durch automatischen Freizeitausgleich am ${format(new Date(autoFreiDateStr), 'dd.MM.')})`);
                    }

                    existingAutoFreiShift = allShifts.find(s => s.date === autoFreiDateStr && s.doctor_id === doctorId);

                    if (!existingAutoFreiShift) {
                        shiftsToCreate.push({
                            date: autoFreiDateStr,
                            position: 'Frei',
                            doctor_id: doctorId,
                            note: 'Autom. Freizeitausgleich'
                        });
                    } else if (existingAutoFreiShift.position !== 'Frei') {
                        updateAutoFreiNeeded = true;
                    }
                }

                console.log('DEBUG: Creating shifts (Bulk)', shiftsToCreate);

                if (shiftsToCreate.length > 0) {
                    bulkCreateShiftsMutation.mutate(shiftsToCreate, {
                        onSuccess: () => {
                            console.log('DEBUG: Bulk Create Success');
                            if (springerAssignmentId) {
                                setHiddenSpringerChipIds(prev => new Set([...prev, springerAssignmentId]));
                            }
                            if (updateAutoFreiNeeded && existingAutoFreiShift) {
                                if (window.confirm(`Für den Folgetag (${format(new Date(autoFreiDateStr), 'dd.MM.')}) existiert bereits ein Eintrag "${existingAutoFreiShift.position}". Soll dieser durch "Frei" ersetzt werden?`)) {
                                    updateAutoFreiMutation.mutate({
                                        id: existingAutoFreiShift.id,
                                        data: { position: 'Frei', note: 'Autom. Freizeitausgleich' }
                                    });
                                }
                            }
                        },
                        onError: (err) => {
                            console.error('DEBUG: Error creating shifts:', err);
                            toast.error('Fehler beim Erstellen: ' + err.message);
                        }
                    });
                }
            };

            // Springer chips from rotation networks use the central employee ID
            // as doctor_id. The local doctors table doesn't know them, so the
            // "Person nicht gefunden" validator check would block. Skip validation
            // for springer drops — the backend shift_entry table accepts any
            // doctor_id (no FK constraint in the MySQL schema).
            const springerSourceDate = sourceDroppableId.startsWith('available__')
                ? sourceDroppableId.replace('available__', '')
                : '';
            const isSpringerDrop = springerSourceDate
                && ((allDisplayDocsByDate.get(springerSourceDate) || [])[source.index] || {})._isSpringer;

            if (!isSpringerDrop) {
                const hasConflict = await checkConflictsWithOverride(doctorId, dateStr, position, null, executeShiftCreation);
                if (hasConflict) {
                    console.log('Conflict detected - waiting for override decision');
                    return;
                }
            }

            executeShiftCreation();
        };

        if (!resolveTimeslotSelection({
            positionName: position,
            dateStr,
            requestedTimeslotId: rawTimeslotId,
            onResolved: executeCreateDrop,
            doctorId,
        })) {
            return;
        }

        return;
    }

    // Dragged from Grid to Grid
    if (sourceDroppableId !== 'sidebar' && !sourceDroppableId.startsWith('available__') && destinationDroppableId !== 'sidebar' && destinationDroppableId !== 'trash' && destinationDroppableId !== 'trash-overlay' && !destinationDroppableId.endsWith('__Verfügbar') && !destinationDroppableId.startsWith('available__')) {
        const shiftId = normalizedDraggableId.replace('shift-', '');
        const movingShift = currentWeekShifts.find(s => s.id === shiftId);
        // Format: date__position oder date__position__timeslotId
        const destParts = destinationDroppableId.split('__');
        const newDateStr = destParts[0];
        const newPosition = destParts[1];
        const rawNewTimeslotId = destParts[2] || null;
        const executeGridDrop = async (selection) => {
            const normalizedSelection = normalizeTimeslotSelection(selection);
            const newTimeslotId = normalizedSelection.timeslotId;
            if (!absencePositions.includes(newPosition) && !isWorkplaceActiveOnDate(newPosition, newDateStr)) {
                toast.error('Diese Position ist an diesem Tag nicht aktiv.');
                return;
            }

            const moveBlock = getScheduleBlock(newDateStr, newPosition, newTimeslotId);
            if (moveBlock) {
                toast.error('Zelle gesperrt' + (moveBlock.reason ? `: ${moveBlock.reason}` : ''));
                return;
            }

            if (sourceDroppableId === destinationDroppableId) {
                if (source.index === destination.index) return;

                const targetWorkplace = workplaceByName.get(newPosition);
                const targetAllTimeslotIds = targetWorkplace?.timeslots_enabled
                    ? (workplaceTimeslotsByWorkplaceId.get(targetWorkplace.id) || []).map((timeslot) => timeslot.id)
                    : [];
                const cellShifts = currentWeekShifts
                    .filter(s => {
                        if (s.date !== newDateStr || s.position !== newPosition) return false;
                        if (!newTimeslotId && targetAllTimeslotIds.length > 1) {
                            return targetAllTimeslotIds.includes(s.timeslot_id) || !s.timeslot_id;
                        }
                        if (newTimeslotId) return s.timeslot_id === newTimeslotId;
                        return !s.timeslot_id;
                    })
                    .sort((a, b) => (a.order || 0) - (b.order || 0));

                const newShifts = Array.from(cellShifts);
                const [movedShift] = newShifts.splice(source.index, 1);
                newShifts.splice(destination.index, 0, movedShift);

                newShifts.forEach((s, index) => {
                    if (s.order !== index) {
                        updateShiftMutation.mutate({ id: s.id, data: { order: index } });
                    }
                });
                return;
            }

            const shift = currentWeekShifts.find(s => s.id === shiftId);
            if (!shift) return;

            if (isCtrlPressed && sourceDroppableId !== destinationDroppableId) {
                const alreadyInTarget = currentWeekShifts.some(s => {
                    if (s.date !== newDateStr || s.position !== newPosition || s.doctor_id !== shift.doctor_id) return false;
                    if (newTimeslotId) return s.timeslot_id === newTimeslotId;
                    return !s.timeslot_id;
                });
                if (alreadyInTarget) {
                    alert('Mitarbeiter ist in dieser Position bereits eingeteilt.');
                    return;
                }

                if (absencePositions.includes(newPosition)) {
                    const executeCopyAbsence = () => {
                        cleanupOtherShifts(shift.doctor_id, newDateStr);

                        const existingInNewCell = currentWeekShifts.filter(s => {
                            if (s.date !== newDateStr || s.position !== newPosition) return false;
                            if (newTimeslotId) return s.timeslot_id === newTimeslotId;
                            return !s.timeslot_id;
                        });
                        const maxOrder = existingInNewCell.reduce((max, s) => Math.max(max, s.order || 0), -1);
                        const newOrder = maxOrder + 1;

                        const copyData = applyTimeslotSelectionToCreateData(
                            { date: newDateStr, position: newPosition, doctor_id: shift.doctor_id, order: newOrder },
                            normalizedSelection
                        );

                        createShiftMutation.mutate(copyData, {
                            onSuccess: () => {
                                handlePostShiftOff(shift.doctor_id, newDateStr, newPosition);
                            }
                        });
                    };

                    const hasConflicts = checkAbsenceDropConflicts(shift.doctor_id, newDateStr, newPosition, executeCopyAbsence);
                    if (hasConflicts) return;

                    executeCopyAbsence();
                    return;
                }

                const limitWarning = checkLimits(shift.doctor_id, newDateStr, newPosition);
                if (limitWarning) toast.warning(limitWarning);

                const occupyingShift = findOccupyingShift(newDateStr, newPosition, null, newTimeslotId);
                if (occupyingShift) {
                    if (isAutoOffPosition(occupyingShift.position)) {
                        cleanupAutoFrei(occupyingShift.doctor_id, occupyingShift.date, occupyingShift.position);
                    }
                    deleteShiftMutation.mutate(occupyingShift.id);
                }

                const executeCopy = async () => {
                    const existingInNewCell = currentWeekShifts.filter(s => {
                        if (s.date !== newDateStr || s.position !== newPosition) return false;
                        if (newTimeslotId) return s.timeslot_id === newTimeslotId;
                        return !s.timeslot_id;
                    });
                    const maxOrder = existingInNewCell.reduce((max, s) => Math.max(max, s.order || 0), -1);
                    const newOrder = maxOrder + 1;

                    const copyData = applyTimeslotSelectionToCreateData(
                        { date: newDateStr, position: newPosition, doctor_id: shift.doctor_id, order: newOrder },
                        normalizedSelection
                    );

                    createShiftMutation.mutate(copyData, {
                        onSuccess: () => {
                            handlePostShiftOff(shift.doctor_id, newDateStr, newPosition);
                        }
                    });
                };

                const hasConflict = await checkConflictsWithOverride(shift.doctor_id, newDateStr, newPosition, null, executeCopy);
                if (hasConflict) return;

                executeCopy();
                return;
            }

            const wasAutoOff = isAutoOffPosition(shift.position);
            if (wasAutoOff && (newPosition !== shift.position || newDateStr !== shift.date)) {
                cleanupAutoFreiOnly(shift.doctor_id, shift.date, shift.position);
            }

            const positionOrTimeslotChanged = newPosition !== shift.position || newTimeslotId !== shift.timeslot_id;
            if (positionOrTimeslotChanged) {
                const alreadyInTarget = currentWeekShifts.some(s => {
                    if (s.date !== newDateStr || s.position !== newPosition || s.doctor_id !== shift.doctor_id || s.id === shiftId) return false;
                    if (newTimeslotId) return s.timeslot_id === newTimeslotId;
                    return !s.timeslot_id;
                });
                if (alreadyInTarget) {
                    alert('Mitarbeiter ist in dieser Position bereits eingeteilt.');
                    return;
                }
            }

            if (absencePositions.includes(newPosition)) {
                const executeMoveToAbsence = () => {
                    cleanupOtherShifts(shift.doctor_id, newDateStr, shiftId);

                    const existingInNewCell = currentWeekShifts.filter(s => {
                        if (s.date !== newDateStr || s.position !== newPosition) return false;
                        if (newTimeslotId) return s.timeslot_id === newTimeslotId;
                        return !s.timeslot_id;
                    });
                    const maxOrder = existingInNewCell.reduce((max, s) => Math.max(max, s.order || 0), -1);
                    const newOrder = maxOrder + 1;

                    const updateData = applyTimeslotSelectionToUpdateData(
                        { date: newDateStr, position: newPosition, order: newOrder },
                        normalizedSelection
                    );

                    updateShiftMutation.mutate(
                        { id: shiftId, data: updateData },
                        {
                            onSuccess: () => {
                                handlePostShiftOff(shift.doctor_id, newDateStr, newPosition);
                            }
                        }
                    );
                };

                const hasConflicts = checkAbsenceDropConflicts(shift.doctor_id, newDateStr, newPosition, executeMoveToAbsence, shiftId);
                if (hasConflicts) return;

                executeMoveToAbsence();
                return;
            }

            const limitWarning = checkLimits(shift.doctor_id, newDateStr, newPosition);
            if (limitWarning) toast.warning(limitWarning);

            const occupyingShift = findOccupyingShift(newDateStr, newPosition, shiftId, newTimeslotId);
            if (occupyingShift) {
                deleteShiftWithCleanup(occupyingShift);
            }

            const executeMove = async () => {
                const existingInNewCell = currentWeekShifts.filter(s => {
                    if (s.date !== newDateStr || s.position !== newPosition) return false;
                    if (newTimeslotId) return s.timeslot_id === newTimeslotId;
                    return !s.timeslot_id;
                });
                const maxOrder = existingInNewCell.reduce((max, s) => Math.max(max, s.order || 0), -1);
                const newOrder = maxOrder + 1;

                const updateData = applyTimeslotSelectionToUpdateData(
                    { date: newDateStr, position: newPosition, order: newOrder },
                    normalizedSelection
                );

                updateShiftMutation.mutate(
                    { id: shiftId, data: updateData },
                    {
                        onSuccess: () => {
                            handlePostShiftOff(shift.doctor_id, newDateStr, newPosition);
                        }
                    }
                );
            };

            const hasConflict = await checkConflictsWithOverride(shift.doctor_id, newDateStr, newPosition, shiftId, executeMove);
            if (hasConflict) return;

            executeMove();
        };

        if (!resolveTimeslotSelection({
            positionName: newPosition,
            dateStr: newDateStr,
            requestedTimeslotId: rawNewTimeslotId,
            onResolved: executeGridDrop,
            doctorId: movingShift?.doctor_id || null,
        })) {
            return;
        }
        return;
    }
  };
  
  const applyPreview = async () => {
      if (!previewShifts) return;
      // Remove isPreview flag before saving
    const shiftsToCreate = previewShifts.map(({ isPreview: _isPreview, id: _id, ...rest }) => rest);
      await db.ShiftEntry.bulkCreate(shiftsToCreate);
      queryClient.invalidateQueries(['shifts']);
      setPreviewShifts(null);
      setPreviewCategories(null);
      toast.success(`${shiftsToCreate.length} Eintr\u00e4ge \u00fcbernommen`);
  };

  const cancelPreview = () => {
      setPreviewShifts(null);
      setPreviewCategories(null);
  };

  const handleAutoFill = (categories = null) => {
    setIsGenerating(true);
    try {
            const autoFillDebugEnabled = (
                systemSettings.find(s => s.key === 'autofill_debug_enabled')?.value ||
                systemSettings.find(s => s.key === 'ai_autofill_debug_enabled')?.value
            ) === 'true';
            const autoFillDebugEntries = [];
            const autoFillRequestId = `af-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

      // Determine which categories to fill
      const allCategories = [
        'Rotationen', 
        'Dienste', 
        'Demonstrationen & Konsile',
                ...getWorkplaceCategoryNames(systemSettings)
      ];
      // Always calculate with ALL categories so the cost function can
      // consider every workplace (understaffing, fairness, impact, etc.).
      // Then filter results to only show the user-selected categories.
      const selectedCategories = categories || allCategories;
      setPreviewCategories(selectedCategories);

      const result = generateSuggestions({
        weekDays,
        doctors,
        workplaces,
        existingShifts: currentWeekShifts.filter(s => !s.isPreview),
        allShifts,
        trainingRotations,
        isPublicHoliday,
        getDoctorQualIds,
        getWpRequiredQualIds,
        getWpOptionalQualIds,
        getWpExcludedQualIds,
        getWpDiscouragedQualIds,
        categoriesToFill: allCategories,  // always compute ALL
        systemSettings,
        wishes,
        workplaceTimeslots,
                debug: {
                    enabled: autoFillDebugEnabled,
                    requestId: autoFillRequestId,
                    entries: autoFillDebugEntries,
                },
      });

      // Filter results to only the selected categories (if not "all")
      let filtered = result;
      if (categories) {
        // Build a set of position names belonging to the selected categories  
        const selectedPositions = new Set(
          workplaces
            .filter(wp => selectedCategories.includes(wp.category))
            .map(wp => wp.name)
        );
        // Also include absence positions that may be generated (e.g. Auto-Frei)
        const absencePositions = ['Frei', 'Krank', 'Urlaub', 'Dienstreise', 'Nicht verfügbar', 'Verfügbar'];

        filtered = result.filter(s => {
          // Always keep Auto-Frei entries (generated by auto_off services/positions)
          if (absencePositions.includes(s.position)) return true;
          // Keep if position belongs to a selected category
          return selectedPositions.has(s.position);
        });
      }

      if (filtered.length > 0) {
        // Assign stable IDs immediately so drag-drop can find them in state
        const withIds = filtered.map((s, i) => ({ ...s, id: `preview-${i}` }));
        setPreviewShifts(withIds);
        toast.success(`${filtered.length} Vorschläge generiert` + (categories ? ` (${result.length} insgesamt berechnet)` : ''));

                if (autoFillDebugEnabled && result.__debug?.entries?.length) {
                    console.groupCollapsed(`🧭 AutoFill Debug (${result.__debug.requestId}) — ${result.__debug.entries.length} Events`);
                    for (const entry of result.__debug.entries) {
                        const prefix = `[${entry.ts}] [${entry.stage}] ${entry.message}`;
                        if (entry.meta) {
                            console.log(prefix, entry.meta);
                        } else {
                            console.log(prefix);
                        }
                    }
                    console.groupEnd();
                }
      } else {
        toast.info('Keine offenen Positionen gefunden');
      }
    } catch (error) {
      console.error('AutoFill Error:', error);
      toast.error('Fehler beim Generieren: ' + error.message);
    } finally {
      setIsGenerating(false);
    }
  };

  // ============================================================
  //  FAIRNESS-DATEN für Preview-Dienste
  //  Berechnet für jeden Arzt: Dienste letzte 4 Wochen, Wochenenden, Wünsche
  // ============================================================
  const previewFairnessData = useMemo(() => {
    if (!previewShifts || previewShifts.length === 0) return {};

    const serviceWps = workplaces.filter(w => w.category === 'Dienste');
    if (serviceWps.length === 0) return {};
    const serviceNames = new Set(serviceWps.map(w => w.name));
    const sorted = [...serviceWps].sort((a, b) => (a.order || 0) - (b.order || 0));
    const fgName = sorted[0]?.name;
    const bgName = sorted[1]?.name;

    // Collect all doctor IDs that have a service in preview
    const previewServiceShifts = previewShifts.filter(s => serviceNames.has(s.position));
    if (previewServiceShifts.length === 0) return {};

    const doctorIds = new Set(previewServiceShifts.map(s => s.doctor_id));

    // 4-week window relative to planning dates (mirrors autoFillEngine logic):
    //   3 weeks before first preview date → last preview date
    const previewDates = previewServiceShifts.map(s => s.date).sort();
    const firstPlanStr = previewDates[0];
    const lastPlanStr = previewDates[previewDates.length - 1];
    const fourWeekStart = new Date(firstPlanStr + 'T00:00:00');
    fourWeekStart.setDate(fourWeekStart.getDate() - 21); // 3 weeks back
    const fourWeekStartStr = format(fourWeekStart, 'yyyy-MM-dd');

    // Count services per doctor from DB shifts (fairnessShifts) + preview shifts
    const result = {};
    for (const docId of doctorIds) {
      // 1) Historical DB shifts (non-preview)
      const docShifts = fairnessShifts.filter(s =>
        s.doctor_id === docId &&
        s.date >= fourWeekStartStr &&
        s.date <= lastPlanStr &&
        serviceNames.has(s.position) &&
        !s.isPreview
      );

      let fg = 0, bg = 0, weekendCount = 0;
      for (const s of docShifts) {
        if (s.position === fgName) {
          fg++;
          const d = new Date(s.date + 'T00:00:00').getDay();
          if (d === 0 || d === 6) weekendCount++;
        }
        if (s.position === bgName) {
          bg++;
          const d = new Date(s.date + 'T00:00:00').getDay();
          if (d === 0 || d === 6) weekendCount++;
        }
      }

      // 2) Preview shifts for this doctor also count towards duty total
      const docPreviewShifts = previewServiceShifts.filter(s => s.doctor_id === docId);
      for (const s of docPreviewShifts) {
        if (s.position === fgName) {
          fg++;
          const d = new Date(s.date + 'T00:00:00').getDay();
          if (d === 0 || d === 6) weekendCount++;
        }
        if (s.position === bgName) {
          bg++;
          const d = new Date(s.date + 'T00:00:00').getDay();
          if (d === 0 || d === 6) weekendCount++;
        }
      }

      result[docId] = { fg, bg, total: fg + bg, weekend: weekendCount };
    }

    return result;
  }, [previewShifts, fairnessShifts, workplaces]);

  /**
   * Get fairness info for a specific preview service shift.
   * Returns { fg, bg, total, weekend, wishText } or null.
   */
  const getFairnessInfo = useMemo(() => (shift) => {
    if (!shift.isPreview || !previewFairnessData[shift.doctor_id]) return null;

    const serviceWps = workplaces.filter(w => w.category === 'Dienste');
    const serviceNames = new Set(serviceWps.map(w => w.name));
    if (!serviceNames.has(shift.position)) return null;

    const info = { ...previewFairnessData[shift.doctor_id] };

    // Check wishes for this date+doctor
    const shiftWishes = wishes.filter(w =>
      w.doctor_id === shift.doctor_id &&
            isWishOnDate(w, shift.date)
    );

    const wishTexts = [];
    for (const w of shiftWishes) {
      if (w.type === 'service') {
        const statusLabel = w.status === 'approved' ? '✓' : w.status === 'pending' ? '?' : '✗';
        const posLabel = w.position ? ` (${w.position})` : '';
        wishTexts.push(`Wunsch: Dienst${posLabel} ${statusLabel}`);
      } else if (w.type === 'no_service') {
        const statusLabel = w.status === 'approved' ? '✓' : w.status === 'pending' ? '?' : '✗';
        wishTexts.push(`Wunsch: kein Dienst ${statusLabel}`);
      }
    }
    info.wishText = wishTexts.length > 0 ? wishTexts.join(', ') : null;

    return info;
  }, [previewFairnessData, workplaces, wishes]);

    const getDoctorDayWishes = useMemo(() => (doctorId, dateStr) => {
        return wishes.filter(w =>
            w.doctor_id === doctorId &&
            isWishOnDate(w, dateStr) &&
            w.status !== 'rejected'
        );
    }, [wishes]);

    const buildWishTooltip = useMemo(() => (doctor, doctorWishes = []) => {
        const lines = [doctor.name];

        for (const wish of doctorWishes) {
            if (wish.type === 'service') {
                lines.push(`Dienstwunsch: ${wish.position || 'Beliebiger Dienst'}`);
            } else if (wish.type === 'no_service') {
                lines.push(`Kein-Dienst-Wunsch: ${wish.position || 'Alle Dienste'}`);
            }

            if (wish.priority) lines.push(`Prio: ${wish.priority}`);
            if (wish.reason) lines.push(`Grund: ${wish.reason}`);
        }

        return lines.join('\n');
    }, []);

    const getAvailableDoctorWishPresentation = useMemo(() => (doctor, dateStr) => {
        const doctorWishes = getDoctorDayWishes(doctor.id, dateStr);
        const wish = doctorWishes[0];
        let style = getRoleColor(doctor.role);
        let wishClass = '';

        if (wish) {
            if (wish.type === 'service') {
                style = { backgroundColor: '#dcfce7', color: '#166534' };
                wishClass = 'ring-1 ring-green-500';
            } else if (wish.type === 'no_service') {
                style = { backgroundColor: '#fee2e2', color: '#991b1b' };
                wishClass = 'ring-1 ring-red-500';
            }
        }

        return {
            doctorWishes,
            style,
            wishClass,
            tooltipText: buildWishTooltip(doctor, doctorWishes),
        };
    }, [buildWishTooltip, getDoctorDayWishes, getRoleColor]);

    const getShiftWishMarker = useMemo(() => (shift) => {
        if (!shift) return null;

        const workplace = workplaces.find(w => w.name === shift.position);
        if (workplace?.category !== 'Dienste') return null;

        const doctorWishes = getDoctorDayWishes(shift.doctor_id, shift.date);
        if (!doctorWishes.length) return null;

        const matchingServiceWish = doctorWishes.find(w =>
            w.type === 'service' && (!w.position || w.position === shift.position)
        );
        if (matchingServiceWish) {
            return {
                color: 'green',
                title: `Dienstwunsch erfüllt: ${matchingServiceWish.position || shift.position}`
            };
        }

        const conflictingNoServiceWish = doctorWishes.find(w =>
            w.type === 'no_service' && (!w.position || w.position === shift.position)
        );
        if (conflictingNoServiceWish) {
            return {
                color: 'red',
                title: `Kein-Dienst-Wunsch verletzt: ${conflictingNoServiceWish.position || shift.position}`
            };
        }

        return null;
    }, [getDoctorDayWishes, workplaces]);

    // Renders the cell content for a cross-tenant (group/pool) workplace row.
    // The row itself is NOT a drop target; the user clicks to open the
    // PoolShiftEditDialog. Existing shifts are rendered as simple chips.
    const renderCrossTenantCell = (workplace, dateStr) => {
        const shifts = crossTenantShiftsByCell.get(`${workplace.id}|${dateStr}`) || [];
        const canWrite = !isReadOnly && (workplace.canWrite !== false);
        return (
            <div
                className={`min-h-[40px] p-1 flex flex-wrap gap-1 transition-colors ${canWrite ? 'cursor-pointer hover:bg-indigo-50/40' : ''}`}
                onClick={(e) => {
                    if (!canWrite) return;
                    // Only open "create" when clicking empty area
                    if (e.target === e.currentTarget) {
                        openPoolEditDialog(workplace, dateStr, null);
                    }
                }}
            >
                {shifts.map((shift) => (
                    <button
                        key={shift.id}
                        type="button"
                        onClick={(e) => {
                            e.stopPropagation();
                            if (canWrite) openPoolEditDialog(workplace, dateStr, shift);
                        }}
                        className={`text-[10px] px-1.5 py-0.5 rounded border shadow-sm max-w-[140px] truncate ${shift.belongs_to_active_tenant ? 'bg-indigo-100 border-indigo-200 text-indigo-800' : 'bg-slate-100 border-slate-200 text-slate-700'}`}
                        title={`${shift.employee_name} · ${shift.workplace_name}`}
                        disabled={!canWrite}
                    >
                        {shift.employee_name}
                    </button>
                ))}
                {canWrite && shifts.length === 0 && (
                    <span
                        className="text-[10px] text-slate-400 inline-flex items-center gap-0.5 pointer-events-none"
                    >
                        <Plus className="w-3 h-3" />
                    </span>
                )}
            </div>
        );
    };

    // Renders a small Link2 icon button in the row header that opens a popover
    // showing the partner workplace staffing for the selected day (read-only).
    // Only shown in day view when workplace links exist.
    const renderLinkedWorkplaceButton = (rowName, dateStr) => {
        const rawPartners = linkedWorkplacesByName[rowName] || linkedWorkplacesByName[rowName.trim()];
        if (!rawPartners || rawPartners.length === 0) return null;
        // Show only partners from OTHER tenants — own tenant's workplaces are
        // already visible as separate rows in the schedule.
        const partners = activeLinkTenantId
            ? rawPartners.filter((p) => String(p.tenant_id) !== String(activeLinkTenantId))
            : rawPartners;
        if (partners.length === 0) return null;
        return (
            <Popover>
                <PopoverTrigger asChild>
                    <Button
                        variant="ghost"
                        size="icon"
                        className="h-5 w-5 text-teal-600 hover:text-teal-700 hover:bg-teal-50"
                        title="Verknüpfte Arbeitsplätze anzeigen"
                    >
                        <Link2 className="w-3.5 h-3.5" />
                    </Button>
                </PopoverTrigger>
                <PopoverContent className="w-72 p-3" align="start" side="right">
                    <div className="space-y-3">
                        <h4 className="font-semibold text-sm text-slate-800 border-b pb-1.5 flex items-center gap-2">
                            <Link2 className="w-4 h-4 text-teal-600" />
                            Verknüpfte Arbeitsplätze
                        </h4>
                        {partners.map((partner) => {
                            const shiftsForDay = (partner.shifts || []).filter((s) => s.date === dateStr);
                            return (
                                <div key={`${partner.tenant_id}__${partner.workplace_name}`}>
                                    <div className="flex items-center gap-2 mb-1">
                                        <Badge variant="outline" className="text-[10px] font-semibold text-teal-700 border-teal-200 bg-teal-50/50">
                                            {partner.tenant_name}
                                        </Badge>
                                        <span className="text-sm font-medium text-slate-700">{partner.workplace_name}</span>
                                    </div>
                                    {shiftsForDay.length > 0 ? (
                                        <div className="flex flex-wrap gap-1.5 ml-1">
                                            {shiftsForDay.map((s, idx) => (
                                                <Badge
                                                    key={idx}
                                                    className="text-[11px] bg-white border-slate-200 text-slate-700 font-normal"
                                                    variant="outline"
                                                >
                                                    {s.doctor_name}
                                                    {s.start_time && s.end_time
                                                        ? ` (${s.start_time.slice(0, 5)}–${s.end_time.slice(0, 5)})`
                                                        : s.start_time
                                                            ? ` (${s.start_time.slice(0, 5)})`
                                                            : ''}
                                                </Badge>
                                            ))}
                                        </div>
                                    ) : (
                                        <p className="text-xs text-slate-400 italic ml-1">nicht besetzt</p>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </PopoverContent>
            </Popover>
        );
    };

    // Same popover as renderLinkedWorkplaceButton but styled for inside a cell:
    // positioned absolute top-right, visible only on row hover.
    // Used in week view (day view uses the header button instead).
    const renderLinkedWorkplaceCellButton = (rowName, dateStr) => {
        const rawPartners = linkedWorkplacesByName[rowName] || linkedWorkplacesByName[rowName.trim()];
        if (!rawPartners || rawPartners.length === 0) return null;
        const partners = activeLinkTenantId
            ? rawPartners.filter((p) => String(p.tenant_id) !== String(activeLinkTenantId))
            : rawPartners;
        if (partners.length === 0) return null;
        return (
            <Popover>
                <PopoverTrigger asChild>
                    <button
                        type="button"
                        className="absolute top-0.5 right-0.5 z-10 p-0.5 rounded bg-white/80 text-teal-500 hover:text-teal-700 hover:bg-white shadow-sm opacity-0 group-hover/cell:opacity-100 transition-opacity"
                        title="Verknüpfte Arbeitsplätze anzeigen"
                    >
                        <Link2 className="w-3 h-3" />
                    </button>
                </PopoverTrigger>
                <PopoverContent className="w-72 p-3" align="start" side="right">
                    <div className="space-y-3">
                        <h4 className="font-semibold text-sm text-slate-800 border-b pb-1.5 flex items-center gap-2">
                            <Link2 className="w-4 h-4 text-teal-600" />
                            Verknüpfte Arbeitsplätze
                        </h4>
                        {partners.map((partner) => {
                            const shiftsForDay = (partner.shifts || []).filter((s) => s.date === dateStr);
                            return (
                                <div key={`cell-${partner.tenant_id}__${partner.workplace_name}`}>
                                    <div className="flex items-center gap-2 mb-1">
                                        <Badge variant="outline" className="text-[10px] font-semibold text-teal-700 border-teal-200 bg-teal-50/50">
                                            {partner.tenant_name}
                                        </Badge>
                                        <span className="text-sm font-medium text-slate-700">{partner.workplace_name}</span>
                                    </div>
                                    {shiftsForDay.length > 0 ? (
                                        <div className="flex flex-wrap gap-1.5 ml-1">
                                            {shiftsForDay.map((s, idx) => (
                                                <Badge
                                                    key={idx}
                                                    className="text-[11px] bg-white border-slate-200 text-slate-700 font-normal"
                                                    variant="outline"
                                                >
                                                    {s.doctor_name}
                                                    {s.start_time && s.end_time
                                                        ? ` (${s.start_time.slice(0, 5)}–${s.end_time.slice(0, 5)})`
                                                        : s.start_time
                                                            ? ` (${s.start_time.slice(0, 5)})`
                                                            : ''}
                                                </Badge>
                                            ))}
                                        </div>
                                    ) : (
                                        <p className="text-xs text-slate-400 italic ml-1">nicht besetzt</p>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </PopoverContent>
            </Popover>
        );
    };

    // ================================================================
    //  Springerpool-Rotationen — Zellen-Rendering
    // ================================================================
    // Zwei Modi:
    //   Pool-Planer (canWrite=true)  → EXAKT wie normale Rotationen:
    //                                   Droppable, grüner Hintergrund,
    //                                   Chips mit getDoctorChipLabel,
    //                                   Zeit im Chip + Timeslot-Dialog
    //   Station (canWrite=false)      → Timeslot-Sub-Zeilen mit Bedarf
    // ================================================================

    const formatRotationTime = (timeStr) => {
        if (!timeStr) return null;
        const parts = String(timeStr).split(':');
        if (parts.length < 2) return null;
        const h = parseInt(parts[0], 10);
        const m = parseInt(parts[1], 10);
        return m === 0 ? `${h}` : `${h}:${String(m).padStart(2, '0')}`;
    };

    const renderRotationCell = (workplace, dateStr, extraProps = {}) => {
        const assignments = rotationAssignmentsByCell.get(`${workplace.id}|${dateStr}`) || [];
        const canWrite = !isReadOnly && (workplace.canWrite !== false);
        const hasTimeslots = workplace.timeslots_enabled && workplace.timeslots?.length > 0;
        const { isToday, isWeekend, isAlternate, baseClassName, baseStyle } = extraProps;

        const getEmpName = (a) => {
            if (a.employee_name) return a.employee_name;
            // Joker assignments use central_employee_id — resolve from doctors
            const jokerDoc = jokerDoctorById.get(String(a.employee_id))
                || doctorByCentralEmployeeId.get(String(a.employee_id));
            if (jokerDoc?.name) return jokerDoc.name;
            return `#${a.employee_id}`;
        };

        // Collect demands for this cell
        const cellDemands = [];
        for (const [key, demand] of rotationDemandsByCell) {
            const [wpId, dDate] = key.split('|');
            if (wpId === String(workplace.id) && dDate === dateStr) {
                cellDemands.push(demand);
            }
        }

        const openDemandFor = (timeslot = null) => {
            const demandKey = `${workplace.id}|${dateStr}|${timeslot?.id || ''}`;
            const existing = rotationDemandsByCell.get(demandKey);
            setRotationDemandDialog({
                open: true, workplace, date: dateStr, timeslot,
                existingDemand: existing || null,
            });
        };

        // ============================================================
        //  POOL-PLANER (canWrite) — DROPPABLECELL + DRAGGABLE CHIPS
        //  Exakt wie normale Rotationszellen: gleiche Hoehe (60px),
        //  gleiches Styling, gleiches Drag-Verhalten.
        //  Zusaetzlich: Bedarfs-Anzeige aus Stations-Mandanten.
        // ============================================================
        if (canWrite) {
            const isOccupied = assignments.length > 0;

            // Sammle offene Bedarfsanforderungen fuer diese Zelle
            const openDemands = cellDemands.filter((d) => d.status === 'open');

            return (
                <DroppableCell
                    id={`rotationCell__${workplace.id}__${dateStr}`}
                    isToday={isToday}
                    isWeekend={isWeekend}
                    isDisabled={false}
                    isReadOnly={false}
                    isAlternate={isAlternate}
                    isOccupied={isOccupied}
                    baseClassName={baseClassName}
                    baseStyle={baseStyle}
                >
                    {() => {
                        const isSingleAssignment = assignments.length === 1 && openDemands.length === 0;

                        // Return-request demands are keyed to the WARD workplace,
                        // not this pool workplace. Scan the global lookup for any
                        // that reference assignments in this cell.
                        const globalReturnBadges = [];
                        const seenReturnDemandIds = new Set();
                        for (const a of assignments) {
                            const rd = openReturnRequestByAssignmentId.get(String(a.id));
                            if (rd && !seenReturnDemandIds.has(rd.id)) {
                                seenReturnDemandIds.add(rd.id);
                                const rTsLabel = rd.timeslot_label || (rd.timeslot_id
                                    ? workplace.timeslots?.find((t) => String(t.id) === String(rd.timeslot_id))?.label
                                    : null);
                                globalReturnBadges.push(
                                    <div key={`global-return-${rd.id}`}
                                         className="inline-flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded-full bg-red-100 text-red-700 border border-red-300 font-medium"
                                         title={`Rückgabe angefordert: ${rd.note || ''}`.trim()}>
                                        <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
                                        {rTsLabel ? `Rückgabe ${rTsLabel}` : 'Rückgabe'}
                                    </div>
                                );
                            }
                        }

                        return assignments.map((assignment, idx) => {
                            const empName = getEmpName(assignment);
                            const ts = hasTimeslots && assignment.timeslot_id
                                ? workplace.timeslots.find((t) => String(t.id) === String(assignment.timeslot_id))
                                : null;
                            const timeLabel = ts
                                ? `${formatRotationTime(ts.start_time)}–${formatRotationTime(ts.end_time)}`
                                : null;
                            const doctor = doctorById.get(assignment.employee_id)
                                || jokerDoctorById.get(String(assignment.employee_id))
                                || doctorByCentralEmployeeId.get(String(assignment.employee_id));
                            const doctorLike = doctor || { id: assignment.employee_id, name: empName };
                            const chipLabel = getDoctorChipLabel(doctorLike);
                            const roleColor = doctor
                                ? getRoleColor(doctor.role)
                                : { backgroundColor: '#f3f4f6', color: '#1f2937' };
                            // If the ward has already requested this Springer back,
                            // override the chip colour to red so the pool planner
                            // can spot the return-request at a glance.
                            const returnRequest = openReturnRequestByAssignmentId.get(String(assignment.id));
                            const effectiveColor = returnRequest
                                ? { backgroundColor: '#fef2f2', color: '#991b1b' }
                                : roleColor;
                            const displayFontSize = effectiveGridFontSize;
                            const boxSize = shiftBoxSize;

                            return (
                                <Draggable
                                    key={assignment.id}
                                    draggableId={`rotation-assignment-${assignment.id}`}
                                    index={idx}
                                    isDragDisabled={false}
                                >
                                    {(provided, snapshot) => {
                                        const isDragging = snapshot.isDragging;
                                        // Beim Drag: transparenter Container, der die dnd-transform uebernimmt.
                                        // Der sichtbare Chip wird als Kind gerendert (wie DraggableShift).
                                        const containerStyle = isDragging ? {
                                            ...provided.draggableProps.style,
                                            backgroundColor: 'transparent',
                                            border: 'none',
                                            boxShadow: 'none',
                                            zIndex: 9999,
                                            width: `${boxSize}px`,
                                            height: `${boxSize}px`,
                                        } : isSingleAssignment ? {
                                            ...provided.draggableProps.style,
                                            backgroundColor: effectiveColor.backgroundColor,
                                            color: effectiveColor.color,
                                            width: '100%',
                                            height: '100%',
                                            minHeight: `${boxSize * 0.8}px`,
                                            fontSize: `${displayFontSize}px`,
                                        } : {
                                            ...provided.draggableProps.style,
                                            backgroundColor: effectiveColor.backgroundColor,
                                            color: effectiveColor.color,
                                            width: `${boxSize}px`,
                                            height: `${boxSize}px`,
                                            fontSize: `${displayFontSize}px`,
                                        };
                                        const containerClass = isDragging
                                            ? 'flex items-center justify-center'
                                            : isSingleAssignment
                                                ? 'relative flex items-center justify-start overflow-hidden rounded-md font-bold border shadow-sm transition-colors select-none'
                                                : 'relative flex items-center justify-center rounded-md font-bold border shadow-sm transition-colors select-none cursor-grab active:cursor-grabbing';
                                        return (
                                            <div
                                                ref={provided.innerRef}
                                                {...provided.draggableProps}
                                                {...(isSingleAssignment && !isDragging ? {} : provided.dragHandleProps)}
                                                onDoubleClick={(e) => {
                                                    e.stopPropagation();
                                                    setRotationAssignmentDialog({
                                                        open: true, workplace, date: dateStr,
                                                        assignment, timeslotId: assignment.timeslot_id || null,
                                                    });
                                                }}
                                                className={containerClass}
                                                style={containerStyle}
                                                title={empName}
                                            >
                                                {isDragging ? (
                                                    <div
                                                        className="relative flex items-center justify-center rounded-md font-bold border shadow-2xl ring-4 ring-indigo-400"
                                                        style={{
                                                            backgroundColor: effectiveColor.backgroundColor,
                                                            color: effectiveColor.color,
                                                            width: `${boxSize}px`,
                                                            height: `${boxSize}px`,
                                                            fontSize: `${displayFontSize}px`,
                                                        }}
                                                    >
                                                        <span className="whitespace-nowrap leading-none">{chipLabel}</span>
                                                    </div>
                                                ) : isSingleAssignment ? (
                                                    <>
                                                        <div
                                                            {...provided.dragHandleProps}
                                                            className="flex-shrink-0 font-bold flex items-center justify-center cursor-grab active:cursor-grabbing rounded-l-md h-full bg-white/50 hover:bg-black/10 transition-colors"
                                                            style={{ width: `${boxSize}px`, fontSize: `${displayFontSize}px` }}
                                                            title="Ziehen zum Verschieben"
                                                        >
                                                            {chipLabel}
                                                        </div>
                                                        <div className="relative flex flex-col items-center min-w-0 basis-0 flex-1 h-full leading-tight py-0.5">
                                                            <span
                                                                className="absolute inset-x-0 top-1/2 -translate-y-1/2 block min-w-0 px-1 text-center truncate"
                                                                style={{ fontSize: `${displayFontSize}px` }}
                                                            >
                                                                {empName}
                                                            </span>
                                                        </div>
                                                        {timeLabel && (
                                                            <div className="flex-shrink-0 flex items-center justify-end pr-1.5 opacity-70" style={{ fontSize: `${Math.max(displayFontSize * 0.65, 8)}px` }}>
                                                                {timeLabel}
                                                            </div>
                                                        )}
                                                    </>
                                                ) : (
                                                    <>
                                                        <div className="absolute inset-0 rounded-md bg-white/50 hover:bg-black/10 transition-colors z-0" />
                                                        <div className="flex flex-col items-center justify-center w-full relative z-10">
                                                            <span className="px-0.5 leading-none text-center whitespace-nowrap" style={{ fontSize: `${displayFontSize}px` }}>
                                                                {chipLabel}
                                                            </span>
                                                            {timeLabel && (
                                                                <span className="leading-none text-center whitespace-nowrap opacity-60"
                                                                      style={{ fontSize: `${Math.max(displayFontSize * 0.55, 7)}px`, marginTop: '1px' }}>
                                                                    {timeLabel}
                                                                </span>
                                                            )}
                                                        </div>
                                                    </>
                                                )}
                                            </div>
                                        );
                                    }}
                                </Draggable>
                            );
                        }).concat(openDemands.filter((d) => !d.return_requested_assignment_id && !d.offered_employee_id).map((demand) => {
                            const tsLabel = demand.timeslot_label || (demand.timeslot_id
                                ? workplace.timeslots?.find((t) => String(t.id) === String(demand.timeslot_id))?.label
                                : null);
                            return (
                                <div key={`demand-${demand.id}`}
                                     className="inline-flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded-full bg-orange-100 text-orange-700 border border-orange-200 font-medium"
                                     title={`Bedarf von Station: ${demand.note || ''}`.trim()}>
                                    <span className="w-1.5 h-1.5 rounded-full bg-orange-400" />
                                    {tsLabel ? `Bedarf ${tsLabel}` : 'Bedarf'}
                                </div>
                            );
                        })).concat(openDemands.filter((d) => d.offered_employee_id).map((demand) => {
                            const tsLabel = demand.timeslot_label || (demand.timeslot_id
                                ? workplace.timeslots?.find((t) => String(t.id) === String(demand.timeslot_id))?.label
                                : null);
                            const centralEmp = demand.offered_employee_id
                                ? centralEmployeesById.get(String(demand.offered_employee_id))
                                : null;
                            const jokerName = (centralEmp
                                ? `${centralEmp.first_name || ''} ${centralEmp.last_name || ''}`.trim()
                                : '')
                                || (demand.note || '').replace(/^Übergabe von /, '').replace(/ an den Pool gewünscht$/, '')
                                || 'Mitarbeiter';
                            const jokerLabel = tsLabel ? `Übergabe ${tsLabel}` : `Übergabe ${jokerName}`;
                            const handleAcceptJoker = () => {
                                const confirmed = window.confirm(
                                    `Möchten Sie ${jokerName} an diesem Tag in den Springerpool übernehmen?`
                                );
                                if (!confirmed) return;
                                api.updateRotationDemand(demand.id, { status: 'fulfilled' }).then(() => {
                                    queryClient.invalidateQueries({ queryKey: ['rotations', 'visible-rotations'] });
                                    queryClient.invalidateQueries({ queryKey: ['rotations', 'demands'] });
                                    toast.success(`${jokerName} wurde in den Pool übernommen und steht in Anwesenheiten bereit.`);
                                }).catch((err) => {
                                    toast.error('Fehler beim Übernehmen: ' + (err?.message || ''));
                                });
                            };
                            return (
                                <div key={`joker-${demand.id}`}
                                     onClick={handleAcceptJoker}
                                     className="inline-flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700 border border-blue-300 font-medium cursor-pointer hover:bg-blue-200"
                                     title={`Klicken um ${jokerName} zu übernehmen`}> 
                                    <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                                    {jokerLabel}
                                </div>
                            );
                        })).concat(openDemands.filter((d) => d.return_requested_assignment_id).map((demand) => {
                            const tsLabel = demand.timeslot_label || (demand.timeslot_id
                                ? workplace.timeslots?.find((t) => String(t.id) === String(demand.timeslot_id))?.label
                                : null);
                            return (
                                <div key={`return-${demand.id}`}
                                     className="inline-flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded-full bg-purple-100 text-purple-700 border border-purple-300 font-medium"
                                     title={`Rückgabe angefordert: ${demand.note || ''}`.trim()}>
                                    <span className="w-1.5 h-1.5 rounded-full bg-purple-500" />
                                    {tsLabel ? `Rückgabe ${tsLabel}` : 'Rückgabe'}
                                </div>
                            );
                        })).concat(globalReturnBadges);
                    }}
                </DroppableCell>
            );
        }

        // ============================================================
        //  STATIONS-ANSICHT (!canWrite) — Timeslot-Sub-Zeilen
        //  Jedes Timeslot-Sub-Feld ist einzeln droppable, damit ein
        //  Springer-Chip auf ein konkretes Timeslot gezogen werden kann,
        //  um die Rückgabe an den Pool anzufordern.
        // ============================================================
        if (hasTimeslots) {
            return (
                <div className="min-h-[40px] flex flex-col gap-0.5 p-0.5">
                    {workplace.timeslots.map((ts) => {
                        const tsAssignments = assignments.filter((a) =>
                            String(a.timeslot_id || '') === String(ts.id)
                        );
                        const tsDemand = cellDemands.find((d) =>
                            String(d.timeslot_id || '') === String(ts.id)
                        );
                        const isCovered = tsAssignments.length > 0;
                        const demandStatus = tsDemand?.status;
                        const hasReturnRequest = tsDemand?.status === 'open'
                            && tsDemand?.return_requested_assignment_id;
                        return (
                            <DroppableCell
                                key={ts.id}
                                id={`rotationCellTslot__${workplace.id}__${dateStr}__${ts.id}`}
                                isToday={isToday}
                                isWeekend={isWeekend}
                                isDisabled={false}
                                isReadOnly={false}
                                isAlternate={isAlternate}
                                baseClassName={baseClassName}
                                baseStyle={baseStyle}
                                isCompact
                            >
                                {() => (
                                    <div
                                        className={`flex items-center gap-1 text-[10px] rounded px-1 py-0.5 transition-colors cursor-pointer hover:bg-amber-50/40 w-full ${isCovered ? 'bg-teal-50/30' : ''}`}
                                        onClick={() => openDemandFor(ts)}
                                        title={`${ts.label}${tsDemand ? ` · ${hasReturnRequest ? 'Rückgabe angefordert' : tsDemand.status === 'open' ? 'Bedarf offen' : 'Bedarf erfüllt'}` : ''}`}
                                    >
                                        <span className="font-medium text-[9px] text-slate-500 w-12 shrink-0">{ts.label}</span>
                                        <div className="flex flex-1 flex-wrap gap-0.5">
                                            {tsAssignments.map((assignment) => {
                                                const empName = getEmpName(assignment);
                                                const isOpenReturn = tsDemand?.status === 'open'
                                                    && tsDemand?.return_requested_assignment_id
                                                    && String(tsDemand.return_requested_assignment_id) === String(assignment.id);
                                                return (
                                                    <span
                                                        key={assignment.id}
                                                        className={`inline-block px-1 py-0.5 rounded border max-w-[100px] truncate ${
                                                            isOpenReturn
                                                                ? 'bg-purple-100 border-purple-300 text-purple-800'
                                                                : 'bg-teal-100 border-teal-200 text-teal-800'
                                                        }`}
                                                        title={isOpenReturn ? `${empName} · Rückgabe angefordert` : empName}
                                                    >
                                                        {empName}
                                                    </span>
                                                );
                                            })}
                                        </div>
                                        {demandStatus === 'open' && !hasReturnRequest && (
                                            <span className="shrink-0 w-2 h-2 rounded-full bg-orange-400 inline-block" title="Bedarf offen" />
                                        )}
                                        {demandStatus === 'fulfilled' && (
                                            <span className="shrink-0 w-2 h-2 rounded-full bg-green-500 inline-block" title="Bedarf erfüllt" />
                                        )}
                                        {hasReturnRequest && (
                                            <span className="shrink-0 text-[8px] px-1 py-0.5 rounded-full bg-purple-100 text-purple-700 border border-purple-200 font-medium" title="Rückgabe angefordert">
                                                Rückgabe
                                            </span>
                                        )}
                                        {!isCovered && !tsDemand && (
                                            <span className="text-[9px] text-amber-500 shrink-0">+Bedarf</span>
                                        )}
                                    </div>
                                )}
                            </DroppableCell>
                        );
                    })}
                </div>
            );
        }

        // Einfache Zelle (ohne Timeslots) — Station
        // Droppable, damit ein Springer-Chip aus der Verfügbar-Reihe hier
        // abgelegt werden kann, um die Rückgabe an den Pool anzufordern.
        const demand = cellDemands[0];
        return (
            <DroppableCell
                id={`rotationCell__${workplace.id}__${dateStr}`}
                isToday={isToday}
                isWeekend={isWeekend}
                isDisabled={false}
                isReadOnly={false}
                isAlternate={isAlternate}
                baseClassName={baseClassName}
                baseStyle={baseStyle}
                onContextMenu={demand?.status !== 'fulfilled' ? (e) => {
                    e.preventDefault();
                    openDemandFor(null);
                } : undefined}
            >
                {() => (
                    <div
                        className={`min-h-[40px] p-1 w-full ${demand?.status !== 'fulfilled' ? 'cursor-pointer hover:bg-amber-50/40' : ''}`}
                        onClick={() => openDemandFor(null)}
                    >
                        <div className="flex flex-wrap gap-1">
                            {assignments.map((assignment) => {
                                const empName = getEmpName(assignment);
                                const isOpenReturn = cellDemands.some(
                                    (d) => d.status === 'open'
                                        && d.return_requested_assignment_id
                                        && String(d.return_requested_assignment_id) === String(assignment.id)
                                );
                                return (
                                    <span
                                        key={assignment.id}
                                        className={`inline-block text-[10px] px-1.5 py-0.5 rounded border shadow-sm max-w-[140px] truncate ${
                                            isOpenReturn
                                                ? 'bg-purple-100 border-purple-300 text-purple-800'
                                                : 'bg-teal-100 border-teal-200 text-teal-800'
                                        }`}
                                        title={isOpenReturn ? `${empName} · Rückgabe angefordert` : empName}
                                    >
                                        {empName}
                                    </span>
                                );
                            })}
                            {demand?.status === 'open' && !demand.return_requested_assignment_id && (
                                <span className="inline-flex items-center gap-1 text-[9px] px-1 py-0.5 rounded-full bg-orange-100 text-orange-700 border border-orange-200">
                                    <span className="w-1.5 h-1.5 rounded-full bg-orange-400" />
                                    Bedarf offen
                                </span>
                            )}
                            {demand?.status === 'open' && demand.return_requested_assignment_id && (
                                <span className="inline-flex items-center gap-1 text-[9px] px-1 py-0.5 rounded-full bg-purple-100 text-purple-700 border border-purple-200">
                                    <span className="w-1.5 h-1.5 rounded-full bg-purple-400" />
                                    Rückgabe angefordert
                                </span>
                            )}
                            {demand?.status === 'fulfilled' && (
                                <span className="inline-flex items-center gap-1 text-[9px] px-1 py-0.5 rounded-full bg-green-100 text-green-700 border border-green-200">
                                    <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
                                    Erfüllt
                                </span>
                            )}
                            {!demand && (
                                <span className="text-[10px] text-amber-500 inline-flex items-center gap-0.5">+Bedarf</span>
                            )}
                        </div>
                    </div>
                )}
            </DroppableCell>
        );
    };

    const renderCellShifts = useMemo(() => (date, rowName, isSectionFullWidth, timeslotId = null, allTimeslotIds = null, singleTimeslotId = null, dragIdPrefix = '', cellWidth = null) => {
    // Wait for color settings to load
    if (isLoadingColors) return null;
    if (!isValid(date)) return null;
    const dateStr = format(date, 'yyyy-MM-dd');
    
        const workplace = workplaceByName.get(rowName);
        const shifts = getShiftsForScheduleCell({
                shiftLookup: currentWeekShiftLookup,
                dateStr,
                rowName,
                timeslotId,
                allTimeslotIds,
                singleTimeslotId,
                timeslotsEnabled: Boolean(workplace?.timeslots_enabled),
        });

    const isSingleShift = shifts.length === 1;
    const isSplitModeActive = isEmbeddedSchedule || isSplitViewEnabled;
    const boxSize = shiftBoxSize;

    // Qualifikations-Status für diese Position ermitteln
    const wpRequiredQuals = workplace ? getWpRequiredQualIds(workplace.id) : [];
    const wpExcludedQuals = workplace ? getWpExcludedQualIds(workplace.id) : [];
    const hasQualRequirements = wpRequiredQuals.length > 0;

    // Bei Mehrfachbesetzung: Warnung nur wenn KEINER der Eingetragenen qualifiziert ist
    let anyoneQualified = false;
    if (hasQualRequirements && shifts.length > 1) {
        anyoneQualified = shifts.some(s => {
            const docQuals = getDoctorQualIds(s.doctor_id);
            return wpRequiredQuals.every(qId => docQuals.includes(qId));
        });
    }

    return shifts.map((shift, index) => {
        const baseDoctor = doctorById.get(shift.doctor_id)
            || springerDoctorById.get(shift.doctor_id);
        const doctor = baseDoctor && !baseDoctor._isSpringer
            ? getDoctorWithEffectiveFte(baseDoctor, shift.date)
            : baseDoctor; // springer synthetic doc — no FTE calc needed
        if (!doctor) return null;
        const compactLabel = getDoctorChipLabel(doctor);
        
        const shiftTimeLabel = getShiftTimeRangeLabel(shift, doctor, workplace, workplaceTimeslots, workTimeModelMap, centralEmployeesById);
        // Im Benutzermodus (ReadOnly) nur die Zeiten des eigenen Mitarbeiters anzeigen
        const isOwnShift = user?.doctor_id && doctor.id === user?.doctor_id;
        const effectiveTimeLabel = isReadOnly && !isOwnShift ? null : shiftTimeLabel;
        const lateRotationTooltip = lateRotationIndicatorByDoctorDay.get(`${doctor.id}__${dateStr}`) || null;
        
        // Qualifikations-Indikator
        // 'excluded' wenn Arzt eine NOT-Qualifikation hat (harter Fehler)
        // 'unqualified' wenn Pflicht-Qualifikation fehlt und kein qualifizierter Kollege da ist
        let qualificationStatus = null;
        const docQuals = getDoctorQualIds(doctor.id);
        if (wpExcludedQuals.length > 0 && wpExcludedQuals.some(qId => docQuals.includes(qId))) {
            qualificationStatus = 'excluded';
        } else if (hasQualRequirements) {
            const hasAll = wpRequiredQuals.every(qId => docQuals.includes(qId));
            if (!hasAll && (shifts.length === 1 || !anyoneQualified)) {
                qualificationStatus = 'unqualified';
            }
        }

        const roleColor = getRoleColor(doctor.role);
        const isDraggingThis = draggingShiftId === shift.id;
        const showCopyGhost = isCtrlPressed && isDraggingThis;
        const displayMode = getShiftDisplayMode({
            doctor,
            isSplitModeActive,
            isSectionFullWidth,
            isSingleShift,
            forceInitialsOnly: showInitialsOnly || isMonthView,
            cellWidth,
            gridFontSize: effectiveGridFontSize,
            boxSize
        });
        const isFullWidth = displayMode === 'full';

        return (
            <div key={shift.id} style={{ display: 'contents' }}>
                {showCopyGhost && (
                    <div 
                        className="flex items-center justify-center rounded-md font-bold border shadow-sm opacity-40 border-dashed border-slate-400 pointer-events-none"
                        style={{
                            fontSize: `${effectiveGridFontSize}px`,
                            backgroundColor: roleColor.backgroundColor,
                            color: roleColor.color,
                            width: isFullWidth ? '100%' : `${boxSize}px`,
                            height: isFullWidth ? '100%' : `${boxSize}px`,
                            minHeight: isFullWidth ? `${boxSize * 0.8}px` : undefined,
                            marginBottom: '4px'
                        }}
                    >
                        <span className={`${isMonthView ? 'whitespace-nowrap leading-none' : 'truncate'} px-1`}>
                            {isFullWidth ? doctor.name : compactLabel}
                        </span>
                    </div>
                )}
                <DraggableShift 
                    shift={shift} 
                    doctor={doctor} 
                    index={index}
                    draggableIdPrefix={dragIdPrefix}
                    style={roleColor}
                    displayMode={displayMode}
                    compactLabel={compactLabel}
                    isDragDisabled={isReadOnly}
                    fontSize={effectiveGridFontSize}
                    boxSize={boxSize}
                    currentUserDoctorId={user?.doctor_id}
                    highlightMyName={highlightMyName}
                    isBeingDragged={isDraggingThis}
                    qualificationStatus={qualificationStatus}
                    fairnessInfo={shift.isPreview && !isMonthView ? getFairnessInfo(shift) : null}
                    wishMarker={getShiftWishMarker(shift)}
                    timeslotLabel={null}
                    timeLabelOverride={effectiveTimeLabel}
                    onTimeLabelClick={!shift.isPreview && !isReadOnly && (effectiveTimeLabel || workplace?.timeslots_enabled) ? () => handleShiftTimeslotEdit(shift, doctor, workplace) : null}
                    hideTimeLabel={isReadOnly && !isOwnShift}
                    showLateStartIndicator={Boolean(lateRotationTooltip)}
                    lateStartTooltip={lateRotationTooltip}
                />
            </div>
        );
    });
    }, [currentWeekShiftLookup, doctorById, springerDoctorById, draggingShiftId, isCtrlPressed, shiftBoxSize, effectiveGridFontSize, isReadOnly, user, highlightMyName, showInitialsOnly, colorSettings, isLoadingColors, getRoleColor, workplaceByName, workplaceTimeslots, getDoctorQualIds, getWpRequiredQualIds, getWpExcludedQualIds, getFairnessInfo, getShiftWishMarker, isEmbeddedSchedule, isSplitViewEnabled, isMonthView, getDoctorChipLabel, lateRotationIndicatorByDoctorDay, currentWeekShifts, systemSettings, updateShiftMutation, workTimeModelMap]);

  // Render clone for shift drags from cells - matches sidebar behavior
  const renderShiftClone = useMemo(() => (provided, snapshot, rubric) => {
        const draggableId = normalizeDraggableId(rubric.draggableId);
        if (!draggableId.startsWith('shift-')) return null;
    
    const shiftId = draggableId.replace('shift-', '');
    const shift = currentWeekShiftLookup.byId.get(shiftId);
    if (!shift) return null;
    
    const doctor = doctorById.get(shift.doctor_id)
        || springerDoctorById.get(shift.doctor_id);
    if (!doctor) return null;
    const compactLabel = doctor._isSpringer ? doctor._springerLabel : getDoctorChipLabel(doctor);
    const lateRotationTooltip = lateRotationIndicatorByDoctorDay.get(`${doctor.id}__${shift.date}`) || null;
    
    const roleColor = doctor._isSpringer
        ? { backgroundColor: '#fef3c7', color: '#92400e' }
        : getRoleColor(doctor.role);
    const cloneSize = shiftBoxSize;
    
    return (
      <div
        ref={provided.innerRef}
        {...provided.draggableProps}
        {...provided.dragHandleProps}
        className="flex items-center justify-center"
        style={{
          ...provided.draggableProps.style,
          backgroundColor: 'transparent',
          border: 'none',
          boxShadow: 'none',
          width: `${cloneSize}px`,
          height: `${cloneSize}px`,
        }}
      >
        <div 
                    className="relative flex items-center justify-center rounded-md font-bold border shadow-2xl ring-4 ring-indigo-400"
          style={{
            backgroundColor: roleColor?.backgroundColor || '#f1f5f9',
            color: roleColor?.color || '#0f172a',
            width: `${cloneSize}px`,
            height: `${cloneSize}px`,
                        fontSize: `${effectiveGridFontSize}px`,
            zIndex: 9999,
          }}
        >
                                                                                <span>{compactLabel}</span>
                    {lateRotationTooltip && <LateAvailabilityBadge tooltip={lateRotationTooltip} compact />}
        </div>
      </div>
    );
                                }, [currentWeekShiftLookup, doctorById, springerDoctorById, getRoleColor, shiftBoxSize, effectiveGridFontSize, getDoctorChipLabel, lateRotationIndicatorByDoctorDay]);

    const renderAvailableDoctorClone = useMemo(() => (provided, snapshot, rubric) => {
        const droppableId = stripPanelPrefix(rubric.source.droppableId || '');
        const dateStr = droppableId.startsWith('available__') ? droppableId.replace('available__', '') : null;
        const doc = dateStr ? allDisplayDocsByDate.get(dateStr)?.[rubric.source.index] : null;
        if (!doc) return null;

        const isSpringer = doc._isSpringer;
        const roleStyle = isSpringer
            ? { backgroundColor: '#fef3c7', color: '#92400e' }
            : (getRoleColor(doc.role) || { backgroundColor: '#f3f4f6', color: '#1f2937' });
        const cloneSize = shiftBoxSize;
        const label = isSpringer ? doc._springerLabel : getDoctorChipLabel(doc);

        return (
            <div
                ref={provided.innerRef}
                {...provided.draggableProps}
                {...provided.dragHandleProps}
                className="flex items-center justify-center"
                style={{
                    ...provided.draggableProps.style,
                    backgroundColor: 'transparent',
                    border: 'none',
                    boxShadow: 'none',
                    width: `${cloneSize}px`,
                    height: `${cloneSize}px`,
                }}
            >
                <div
                    className="relative flex items-center justify-center rounded-md font-bold border shadow-2xl ring-4 ring-indigo-400"
                    style={{
                        backgroundColor: roleStyle?.backgroundColor || '#ffffff',
                        color: roleStyle?.color || '#000000',
                        width: `${cloneSize}px`,
                        height: `${cloneSize}px`,
                        fontSize: `${effectiveGridFontSize}px`,
                        zIndex: 9999,
                    }}
                >
                    <span>{label}</span>
                </div>
            </div>
        );
    }, [allDisplayDocsByDate, effectiveGridFontSize, getDoctorChipLabel, getRoleColor, shiftBoxSize]);

  const renderSplitMatrix = () => {
      if (!canUseSplitView || !isSplitViewEnabled || splitSections.length === 0) return null;

      return (
          <div className="w-full lg:flex-1 bg-white rounded-lg shadow-sm border border-slate-200 max-h-[calc(100vh-180px)] z-0 overflow-x-auto overflow-y-auto">
              <div className="min-w-[800px]">
                  <div className={`grid ${viewMode === 'day' ? 'grid-cols-[200px_1fr]' : 'grid-cols-[200px_repeat(7,1fr)]'} border-b border-slate-200 bg-slate-50 sticky top-0 z-30 shadow-sm`}>
                      <div className="p-3 font-semibold text-slate-700 border-r border-slate-200 flex items-center bg-slate-50">
                          Bereich / Datum
                      </div>
                      {weekDays.map(day => {
                          if (!isValid(day)) return <div key={Math.random()} className="p-2 text-center text-red-500">Invalid Date</div>;
                          const isToday = isSameDay(day, new Date());
                          const isHoliday = isPublicHoliday(day);
                          const isSchoolHol = isSchoolHoliday(day);

                          let bgClass = '';
                          if (isToday) bgClass = 'bg-yellow-50/30 border-x-2 border-t-2 border-x-yellow-400 border-t-yellow-400 border-b border-b-slate-200 text-yellow-900';
                          else if (isHoliday) bgClass = 'bg-blue-100 text-blue-900';
                          else if (isSchoolHol) bgClass = 'bg-green-100 text-green-900';
                          else if ([0, 6].includes(day.getDay())) bgClass = 'bg-orange-50/50';

                          return (
                              <div key={`split-${day.toISOString()}`} className={`group relative p-2 text-center border-r border-slate-200 last:border-r-0 ${bgClass || 'bg-white'}`}>
                                  <div className={`font-semibold ${isToday ? 'text-blue-700' : 'text-slate-800'}`}>
                                      {format(day, 'EEEE', { locale: de })}
                                  </div>
                                  <div className={`text-xs ${isToday ? 'text-blue-600' : 'text-slate-500'}`}>
                                      {format(day, 'dd.MM.', { locale: de })}
                                  </div>
                              </div>
                          );
                      })}
                  </div>

                  {movePinnedSectionToEnd(splitSections).map((section, sIdx) => {
                      const normalizedRows = section.rows.map(r =>
                          typeof r === 'string' ? { name: r, displayName: r, timeslotId: null, isTimeslotRow: false, isTimeslotGroupHeader: false } : r
                      );

                      const visibleRows = normalizedRows.filter(r => !hiddenRows.includes(r.name));
                      if (visibleRows.length === 0) return null;

                      const isCollapsed = collapsedSections.includes(section.title);
                      const customStyle = getSectionStyle(section.title);
                      const isPinnedSection = section.title === PINNED_SECTION_TITLE;

                      return (
                          <div key={`split-section-${sIdx}`} className={isPinnedSection ? STICKY_AVAILABLE_SECTION_CLASS : ''} style={isPinnedSection ? stickyAvailableSectionStyle : undefined}>
                              <div
                                  className={`px-3 py-2 text-xs font-bold uppercase tracking-wider border-b border-slate-200 flex items-center justify-between cursor-pointer select-none transition-colors ${!customStyle ? section.headerColor : ''}`}
                                  style={customStyle ? customStyle.header : {}}
                                  onClick={() => setCollapsedSections(prev => prev.includes(section.title) ? prev.filter(t => t !== section.title) : [...prev, section.title])}
                              >
                                  <div className="flex items-center gap-2">
                                      {isCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                                      {getSectionName(section.title)}
                                      {isPinnedSection && selectedQualificationIds.length > 0 && (
                                          <span
                                              data-testid="schedule-anwesenheiten-filter-indicator"
                                              className="inline-flex items-center gap-1 rounded-full bg-amber-200 px-2 py-0.5 text-[10px] font-semibold normal-case tracking-normal text-amber-900"
                                          >
                                              <Filter className="h-3 w-3" />
                                              Filter aktiv
                                          </span>
                                      )}
                                      {isPinnedSection && rowQualFilter && (
                                          <span
                                              data-testid="schedule-anwesenheiten-row-filter-indicator"
                                              className="inline-flex items-center gap-1 rounded-full bg-amber-300 px-2 py-0.5 text-[10px] font-semibold normal-case tracking-normal text-amber-900"
                                              title={`Zeilen-Filter aktiv für ${rowQualFilter.sourceName}`}
                                          >
                                              <Filter className="h-3 w-3" />
                                              Zeilen-Filter: {rowQualFilter.sourceName}
                                          </span>
                                      )}
                                  </div>
                                  <span className="text-[10px] opacity-70 bg-white/20 px-2 py-0.5 rounded-full">{visibleRows.length}</span>
                              </div>

                              {!isCollapsed && visibleRows.map((rowObj, rIdx) => {
                                  const rowName = rowObj.name;
                                  const rowDisplayName = rowObj.displayName || rowName;
                                  const rowTimeslotId = rowObj.timeslotId;
                                  const isGroupHeader = rowObj.isTimeslotGroupHeader;
                                  const rowStyle = getRowStyle(rowName, customStyle);
                                  const rowWorkplace = workplaceByName.get(rowName);
                                  const useLightweightTimeslotTarget = false;
                                  const isRowQualFilterSource = !!rowQualFilter
                                      && rowQualFilter.key === buildRowFilterKey(rowName, rowTimeslotId);
                                  const hasRowQuals = (() => {
                                      if (!rowWorkplace?.id) return false;
                                      const { requiredIds, optionalIds, excludeIds } = buildRowQualSets({
                                          workplaceId: rowWorkplace.id,
                                          getRequired: getWpRequiredQualIds,
                                          getOptional: getWpOptionalQualIds,
                                          getDiscouraged: getWpDiscouragedQualIds,
                                          getExcluded: getWpExcludedQualIds,
                                      });
                                      return requiredIds.length > 0 || optionalIds.length > 0 || discouragedIds.length > 0 || excludeIds.length > 0;
                                  })();

                                  const rawHeaderDroppableId = `rowHeader__${rowName}${rowTimeslotId ? '__' + rowTimeslotId : ''}`;
                                  const headerDroppableId = withPanelPrefix(rawHeaderDroppableId, SPLIT_PANEL_PREFIX);
                                  const rowLabelPresentation = getRowLabelPresentation(rowDisplayName, isMonthView);

                                  return (
                                      <div key={`split-${sIdx}-${rowDisplayName}-${rowTimeslotId || 'full'}`} className={`grid ${viewMode === 'day' ? 'grid-cols-[200px_1fr]' : 'grid-cols-[200px_repeat(7,1fr)]'} border-b border-slate-200 ${(draggingDoctorId || draggingShiftId) ? '' : 'hover:bg-slate-50/50'} transition-colors group ${isRowQualFilterSource ? 'ring-2 ring-amber-400 ring-inset bg-amber-50/40' : ''}`}>
                                          <Droppable droppableId={headerDroppableId} isDropDisabled={isReadOnly || rowObj.isCrossTenantRow || rowObj.isRotationRow}>
                                              {(provided, snapshot) => (
                                                  <div
                                                      ref={provided.innerRef}
                                                      {...provided.droppableProps}
                                                      data-testid={`schedule-row-header-${encodeScheduleTargetId(headerDroppableId)}`}
                                                      className={`p-2 text-sm font-medium border-r border-slate-200 flex items-center justify-between transition-colors ${!customStyle ? section.headerColor : ''} ${snapshot.isDraggingOver ? 'ring-2 ring-inset ring-indigo-400 bg-indigo-50' : ''} ${isGroupHeader ? 'cursor-pointer' : ''}`}
                                                      style={customStyle ? customStyle.header : {}}
                                                      onClick={undefined}
                                                  >
                                                      <div className="flex flex-col min-w-0">
                                                          <span className="flex min-w-0 items-center gap-1" title={rowDisplayName}>
                                                              {rowObj.isCrossTenantRow && <Globe2 className="w-3 h-3 mr-1 text-indigo-500" />}
                                                              {rowObj.isRotationRow && <Globe2 className="w-3 h-3 mr-1 text-teal-500" />}
                                                              <span
                                                                  className={rowLabelPresentation.className}
                                                                  style={rowLabelPresentation.style}
                                                              >
                                                                  {rowDisplayName}
                                                              </span>
                                                          </span>
                                                          {rowObj.isAlwaysVisibleRow && rowObj.sourceSectionTitle && (
                                                              <span className="text-[10px] font-normal text-indigo-600">
                                                                  aus {getSectionName(rowObj.sourceSectionTitle)}
                                                              </span>
                                                          )}
                                                          {rowObj.timeslotSummary && (
                                                              <TimeslotSummaryHint
                                                                  summary={rowObj.timeslotSummary}
                                                                  details={rowObj.timeslotDetails}
                                                                  count={rowObj.timeslotCount}
                                                              />
                                                          )}
                                                      </div>
                                                      <div className="flex items-center gap-0.5">
                                                          {viewMode === 'day' && renderLinkedWorkplaceButton(rowName, format(weekDays[0], 'yyyy-MM-dd'))}
                                                          {hasRowQuals && (
                                                              <Button
                                                                  variant="ghost"
                                                                  size="icon"
                                                                  data-testid={`schedule-row-filter-${encodeScheduleTargetId(headerDroppableId)}`}
                                                                  className={`h-5 w-5 hover:bg-amber-100 ${isRowQualFilterSource ? 'opacity-100 text-amber-600' : 'opacity-0 group-hover:opacity-100 text-slate-500'}`}
                                                                  onClick={() => applyRowQualificationFilter(rowName, rowTimeslotId, rowWorkplace)}
                                                                  title={isRowQualFilterSource ? `Zeilen-Filter aufheben (${rowQualFilter.sourceName})` : `Nach Qualifications dieser Zeile filtern (${rowWorkplace?.name || rowName})`}
                                                              >
                                                                  <Filter className="h-3 w-3" />
                                                              </Button>
                                                          )}
                                                          <div className="hidden">{provided.placeholder}</div>
                                                      </div>
                                                  </div>
                                              )}
                                          </Droppable>

                                          {weekDays.map((day, dIdx) => {
                                              const isWeekendDay = [0, 6].includes(day.getDay());
                                              const isToday = isSameDay(day, new Date());
                                              const dateStr = format(day, 'yyyy-MM-dd');
                                              const rawCellId = rowTimeslotId
                                                  ? `${dateStr}__${rowName}__${rowTimeslotId}`
                                                  : `${dateStr}__${rowName}`;
                                              const cellId = withPanelPrefix(rawCellId, SPLIT_PANEL_PREFIX);
                                              const cellShiftsForOcc = getShiftsForScheduleCell({ shiftLookup: currentWeekShiftLookup, dateStr, rowName, timeslotId: rowTimeslotId, allTimeslotIds: rowObj.allTimeslotIds || null, singleTimeslotId: rowObj.singleTimeslotId || null, timeslotsEnabled: Boolean(rowWorkplace?.timeslots_enabled) });
                                              const isOccupied = cellShiftsForOcc.length > 0;

                                              let isDisabled = false;
                                              let isTrainingHighlight = false;

                                              if (draggingDoctorId) {
                                                  const activeRotations = trainingRotations.filter(rot =>
                                                      rot.doctor_id === draggingDoctorId &&
                                                      rot.start_date <= dateStr &&
                                                      rot.end_date >= dateStr
                                                  );
                                                  const isTarget = activeRotations.some(rot =>
                                                      rot.modality === rowName ||
                                                      (rot.modality === 'Röntgen' && (rowName === 'DL/konv. Rö' || rowName.includes('Rö')))
                                                  );
                                                  if (isTarget) isTrainingHighlight = true;
                                              }

                                              if (rowName !== 'Verfügbar') {
                                                  const setting = workplaces.find(s => s.name === rowName);
                                                  if (setting) {
                                                      const activeDays = (setting.active_days && setting.active_days.length > 0) ? setting.active_days : [1, 2, 3, 4, 5];
                                                      // Feiertag = wie Sonntag: An Feiertagen zählt nur, ob Sonntag (0) aktiv ist
                                                      const isActive = isPublicHoliday(day)
                                                          ? activeDays.some(d => Number(d) === 0)
                                                          : activeDays.some(d => Number(d) === day.getDay());
                                                      if (!isActive) isDisabled = true;
                                                  }
                                              }

                                              return (
                                                  <div key={`split-cell-${dIdx}`} className="border-r border-slate-100 last:border-r-0">
                                                      {rowObj.isCrossTenantRow ? (
                                                          renderCrossTenantCell(rowObj.crossTenantWorkplace, dateStr)
                                                      ) : rowObj.isRotationRow ? (
                                                          renderRotationCell(rowObj.rotationWorkplace, dateStr, {
                                                              isToday, isWeekend: isWeekendDay, isAlternate: rIdx % 2 !== 0,
                                                              baseClassName: !customStyle && !rowStyle.backgroundColor ? section.rowColor : '',
                                                              baseStyle: rowStyle.backgroundColor ? { backgroundColor: rowStyle.backgroundColor, color: rowStyle.color } : {},
                                                          })
                                                      ) : rowName === 'Verfügbar' ? (
                                                          <Droppable droppableId={withPanelPrefix(`available__${dateStr}`, SPLIT_PANEL_PREFIX)} isDropDisabled={isReadOnly} renderClone={renderAvailableDoctorClone}>
                                                              {(provided, snapshot) => {
                                                                  const allDocs = allDisplayDocsByDate.get(dateStr) || [];

                                                                  return (
                                                                      <div
                                                                          ref={provided.innerRef}
                                                                          {...provided.droppableProps}
                                                                          className={`min-h-[40px] p-1 flex flex-wrap gap-1 transition-colors ${snapshot.isDraggingOver ? 'bg-green-100' : 'bg-green-50'}`}
                                                                      >
                                                                          {allDocs.map((doc, idx) => {
                                                                              const isSpringer = doc._isSpringer;
                                                                              return (
                                                                              <Draggable key={`split-available-${doc.id}-${dateStr}`} draggableId={`${SPLIT_DRAG_PREFIX}available-doc-${doc.id}-${dateStr}`} index={idx} isDragDisabled={isReadOnly}>
                                                                                  {(provided, snapshot) => {
                                                                                      if (isSpringer) {
                                                                                          const springerStyle = { backgroundColor: '#fef3c7', color: '#92400e' };
                                                                                          const tooltipText = `${doc._employeeName} — Aus Pool-Rotation zuweisbar`;
                                                                                          return (
                                                                                              <div
                                                                                                  ref={provided.innerRef}
                                                                                                  {...provided.draggableProps}
                                                                                                  {...provided.dragHandleProps}
                                                                                                  style={{ ...provided.draggableProps.style, ...springerStyle }}
                                                                                                  className={`relative ${isMonthView ? 'text-[9px] px-1 py-0.5 max-w-[44px] whitespace-nowrap' : 'text-[10px] px-1.5 py-0.5 max-w-[100px] truncate'} rounded border shadow-sm select-none ${snapshot.isDragging ? 'opacity-50 ring-2 ring-indigo-500 z-50' : ''}`}
                                                                                                  title={tooltipText}
                                                                                              >
                                                                                                  {doc._springerLabel}
                                                                                              </div>
                                                                                          );
                                                                                      }
                                                                                      const { style, wishClass, tooltipText } = getAvailableDoctorWishPresentation(doc, dateStr);
                                                                                      const splitQualIds = rowQualFilter ? getDoctorQualIds(doc.id) : [];
                                                                                      const splitHint = rowQualFilter ? getDoctorRowQualHint(rowQualFilter, splitQualIds) : null;
                                                                                      const splitHintRing = getDoctorRowQualRingClass(splitHint);
                                                                                      const splitHintTitle = splitHint === 'preferred'
                                                                                          ? 'Sollte (bevorzugt)'
                                                                                          : splitHint === 'discouraged'
                                                                                              ? 'Sollte nicht (möglich, aber ungünstig)'
                                                                                              : null;
                                                                                      return (
                                                                                          <div
                                                                                              ref={provided.innerRef}
                                                                                              {...provided.draggableProps}
                                                                                              {...provided.dragHandleProps}
                                                                                              style={{ ...provided.draggableProps.style, ...style }}
                                                                                              className={`relative ${isMonthView ? 'text-[9px] px-1 py-0.5 max-w-[44px] whitespace-nowrap' : 'text-[10px] px-1.5 py-0.5 max-w-[100px] truncate'} rounded border shadow-sm select-none ${snapshot.isDragging ? 'opacity-50 ring-2 ring-indigo-500 z-50' : ''} ${splitHintRing || ''} ${wishClass}`}
                                                                                              title={splitHintTitle ? `${splitHintTitle} — ${tooltipText}` : tooltipText}
                                                                                          >
                                                                                              {getDoctorChipLabel(doc)}
                                                                                              {lateRotationIndicatorByDoctorDay.get(`${doc.id}__${dateStr}`) && (
                                                                                                  <LateAvailabilityBadge tooltip={lateRotationIndicatorByDoctorDay.get(`${doc.id}__${dateStr}`)} compact />
                                                                                              )}
                                                                                          </div>
                                                                                      );
                                                                                  }}
                                                                              </Draggable>
                                                                              );
                                                                          })}
                                                                          {provided.placeholder}
                                                                      </div>
                                                                  );
                                                              }}
                                                          </Droppable>
                                                      ) : rowName === 'Sonstiges' ? (
                                                          isReadOnly ? (
                                                              <div className="p-2 text-base text-slate-500 h-full min-h-[40px] whitespace-pre-wrap">
                                                                  {scheduleNotes.find(n => n.date === format(day, 'yyyy-MM-dd') && n.position === rowName)?.content || ''}
                                                              </div>
                                                          ) : (
                                                              <FreeTextCell
                                                                  date={day}
                                                                  rowName={rowName}
                                                                  notes={scheduleNotes}
                                                                  onCreate={createNoteMutation}
                                                                  onUpdate={updateNoteMutation}
                                                                  onDelete={deleteNoteMutation}
                                                              />
                                                          )
                                                      ) : (
                                                          <div className="flex flex-col h-full relative group/cell">
                                                              <DroppableCell
                                                                  id={cellId}
                                                                  isToday={isToday}
                                                                  isWeekend={isWeekendDay}
                                                                  isDisabled={isDisabled}
                                                                  isReadOnly={isReadOnly}
                                                                  isAlternate={rIdx % 2 !== 0}
                                                                  isTrainingHighlight={isTrainingHighlight}
                                                                  isBlocked={!!getScheduleBlock(dateStr, rowName, rowTimeslotId)}
                                                                  blockReason={getScheduleBlock(dateStr, rowName, rowTimeslotId)?.reason}
                                                                  infoReason={getScheduleInfo(dateStr, rowName, rowTimeslotId)?.reason}
                                                                  isOccupied={isOccupied}
                                                                  onContextMenu={(e) => handleCellContextMenu(e, dateStr, rowName, rowTimeslotId)}
                                                                  baseClassName={!customStyle && !rowStyle.backgroundColor ? section.rowColor : ''}
                                                                  baseStyle={rowStyle.backgroundColor ? { backgroundColor: rowStyle.backgroundColor, color: rowStyle.color } : {}}
                                                                  renderClone={renderShiftClone}
                                                              >
                                                                  {({ cellWidth }) => useLightweightTimeslotTarget ? null : renderCellShifts(
                                                                      day,
                                                                      rowName,
                                                                      ['Dienste', 'Demonstrationen & Konsile'].includes(section.title),
                                                                      rowTimeslotId,
                                                                      rowObj.allTimeslotIds || null,
                                                                      rowObj.singleTimeslotId || null,
                                                                      SPLIT_DRAG_PREFIX,
                                                                      cellWidth
                                                                  )}
                                                              </DroppableCell>
                                                              {viewMode !== 'day' && renderLinkedWorkplaceCellButton(rowName, dateStr)}
                                                          </div>
                                                      )}
                                                  </div>
                                              );
                                          })}
                                      </div>
                                  );
                              })}
                          </div>
                      );
                  })}
              </div>
          </div>
      );
  };

  // Mobile View
  if (isMobile) {
      return (
          <MobileScheduleView
              currentDate={currentDate}
              setCurrentDate={setCurrentDate}
              shifts={currentWeekShifts}
              doctors={doctors}
              workplaces={workplaces}
              isPublicHoliday={isPublicHoliday}
              isSchoolHoliday={isSchoolHoliday}
          />
      );
  }

    return (
        <div className={`flex flex-col h-full ${isEmbeddedSchedule ? '' : 'space-y-4'}`}>

            {!isEmbeddedSchedule && (
            <div
                className="flex flex-wrap gap-2 items-center bg-white p-2 sm:p-4 rounded-lg shadow-sm border border-slate-200"
                data-testid="schedule-toolbar"
            >
        <div className="flex flex-wrap items-center gap-2">
        {/* VoiceControl removed - moved to Layout */}

        <Button 
            variant="outline" 
            size="icon"
            data-testid="schedule-undo"
            onClick={handleUndo}
            disabled={undoStack.length === 0}
            title="Rückgängig (Ctrl+Z)"
            className={`h-9 w-9 ${undoStack.length > 0 ? "text-indigo-600 border-indigo-200 hover:bg-indigo-50" : "opacity-50"}`}
        >
            <Undo className="w-4 h-4" />
        </Button>

        <Button 
            variant="outline" 
            data-testid="schedule-today"
                        onClick={() => setCurrentDate(viewMode === 'week' ? startOfWeek(new Date(), { weekStartsOn: 1 }) : viewMode === 'month' ? startOfMonth(new Date()) : new Date())}
            className="h-9"
            disabled={!!previewShifts}
            title={previewShifts ? 'Navigation im Preview-Modus gesperrt' : undefined}
        >
            Heute
        </Button>
          <div className="flex items-center bg-slate-100 rounded-md p-1">
                        <Button
                            variant="ghost"
                            size="icon"
                            data-testid="schedule-nav-prev"
                            className="h-7 w-7"
                            disabled={!!previewShifts}
                            onClick={() => setCurrentDate(d => viewMode === 'week' ? addDays(d, -7) : viewMode === 'month' ? addMonths(d, -1) : addDays(d, -1))}
                        >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span
                className="px-2 sm:px-4 font-medium w-[180px] sm:w-[280px] text-center block truncate text-sm"
                data-testid="schedule-current-period"
            >
              {viewMode === 'week' ? (
                  `${format(weekDays[0], 'd. MMM', { locale: de })} - ${format(weekDays[6], 'd. MMM', { locale: de })}`
                            ) : viewMode === 'month' ? (
                                    format(currentDate, 'MMMM yyyy', { locale: de })
              ) : (
                  format(currentDate, 'EEE, d. MMM yyyy', { locale: de })
              )}
            </span>
                        <Button
                            variant="ghost"
                            size="icon"
                            data-testid="schedule-nav-next"
                            className="h-7 w-7"
                            disabled={!!previewShifts}
                            onClick={() => setCurrentDate(d => viewMode === 'week' ? addDays(d, 7) : viewMode === 'month' ? addMonths(d, 1) : addDays(d, 1))}
                        >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
          
          <div className="flex bg-slate-100 rounded-lg p-1">
               <button 
                  data-testid="schedule-view-month"
                  data-state={viewMode === 'month' ? 'active' : 'inactive'}
                   disabled={!!previewShifts}
                   onClick={() => {
                    setViewMode('month');
                    setCurrentDate(d => startOfMonth(d));
                  }}
                  className={`flex items-center px-2 py-1 rounded-md text-sm font-medium transition-all ${previewShifts ? 'opacity-50 cursor-not-allowed' : ''} ${viewMode === 'month' ? 'bg-white shadow text-indigo-600' : 'text-slate-500 hover:text-slate-700'}`}
              >
                  <Layout className="w-4 h-4 sm:mr-1" />
                  <span className="hidden sm:inline">Monat</span>
              </button>
               <button 
                  data-testid="schedule-view-week"
                  data-state={viewMode === 'week' ? 'active' : 'inactive'}
                   disabled={!!previewShifts}
                   onClick={() => {
                    setViewMode('week');
                    setCurrentDate(d => startOfWeek(d, { weekStartsOn: 1 }));
                  }}
                  className={`flex items-center px-2 py-1 rounded-md text-sm font-medium transition-all ${previewShifts ? 'opacity-50 cursor-not-allowed' : ''} ${viewMode === 'week' ? 'bg-white shadow text-indigo-600' : 'text-slate-500 hover:text-slate-700'}`}
              >
                  <Calendar className="w-4 h-4 sm:mr-1" />
                  <span className="hidden sm:inline">Woche</span>
              </button>
               <button 
                  data-testid="schedule-view-day"
                  data-state={viewMode === 'day' ? 'active' : 'inactive'}
                   disabled={!!previewShifts}
                   onClick={() => setViewMode('day')}
                  className={`flex items-center px-2 py-1 rounded-md text-sm font-medium transition-all ${previewShifts ? 'opacity-50 cursor-not-allowed' : ''} ${viewMode === 'day' ? 'bg-white shadow text-indigo-600' : 'text-slate-500 hover:text-slate-700'}`}
              >
                  <LayoutList className="w-4 h-4 sm:mr-1" />
                  <span className="hidden sm:inline">Tag</span>
              </button>
          </div>
          {previewShifts && (
             <div className="flex items-center bg-indigo-50 text-indigo-700 px-3 py-1 rounded-md border border-indigo-200" data-testid="schedule-preview-bar">
                 <Wand2 className="w-4 h-4 mr-2" />
                 <span className="text-sm font-medium mr-3">{previewShifts.length} Vorschläge</span>
                 <Button size="sm" onClick={applyPreview} className="bg-indigo-600 hover:bg-indigo-700 text-white h-7 mr-2" data-testid="schedule-preview-apply">
                     Alle übernehmen
                 </Button>
                 <Button size="sm" variant="ghost" onClick={cancelPreview} className="h-7 hover:bg-indigo-100 hover:text-indigo-800" data-testid="schedule-preview-discard">
                     Verwerfen
                 </Button>
             </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-1">
              {!isReadOnly && !previewShifts && (
                  <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                          <Button 
                              variant="outline" 
                              size="sm" 
                              className="h-9 bg-indigo-50 border-indigo-200 text-indigo-700 hover:bg-indigo-100"
                              disabled={isGenerating}
                              data-testid="schedule-auto-fill-trigger"
                          >
                             {isGenerating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
                             <span className="hidden sm:inline ml-1">Auto-Fill</span>
                         </Button>
                     </DropdownMenuTrigger>
                     <DropdownMenuContent align="end" className="w-56">
                         <DropdownMenuLabel>Vorschläge generieren</DropdownMenuLabel>
                         <DropdownMenuSeparator />
                          <DropdownMenuItem onClick={() => handleAutoFill()} data-testid="schedule-auto-fill-all">
                              Alle Kategorien
                          </DropdownMenuItem>
                         <DropdownMenuSeparator />
                         <DropdownMenuItem onClick={() => handleAutoFill(['Rotationen'])}>
                             Nur {getSectionName('Rotationen')}
                         </DropdownMenuItem>
                         <DropdownMenuItem onClick={() => handleAutoFill(['Dienste'])}>
                             Nur {getSectionName('Dienste')}
                         </DropdownMenuItem>
                         <DropdownMenuItem onClick={() => handleAutoFill(['Demonstrationen & Konsile'])}>
                             Nur {getSectionName('Demonstrationen & Konsile')}
                         </DropdownMenuItem>
                         {getWorkplaceCategoryNames(systemSettings).map(name => (
                             <DropdownMenuItem key={name} onClick={() => handleAutoFill([name])}>
                                 Nur {name}
                             </DropdownMenuItem>
                         ))}
                         {user?.role === 'admin' && (
                           <>
                             <DropdownMenuSeparator />
                             <AutoFillSettingsDialog trigger={
                               <DropdownMenuItem onSelect={(e) => e.preventDefault()}>
                                 <Settings2 className="w-4 h-4 mr-2 text-slate-500" />
                                 Einstellungen
                               </DropdownMenuItem>
                             } />
                           </>
                         )}
                         {/* KI-Optimierung temporarily hidden
                         <DropdownMenuSeparator />
                         <DropdownMenuLabel className="flex items-center gap-1">
                             <Sparkles className="w-3 h-3 text-amber-500" />
                             KI-Optimierung
                         </DropdownMenuLabel>
                         <DropdownMenuItem onClick={handleAIAutoFill} className="text-amber-700 font-medium">
                             <Sparkles className="w-4 h-4 mr-2 text-amber-500" />
                             KI-AutoFill (alle Kategorien)
                         </DropdownMenuItem>
                         */}
                     </DropdownMenuContent>
                 </DropdownMenu>
             )}
              <Button 
                 variant="outline"
                 size="sm"
                 onClick={handleExportExcel}
                 disabled={isExporting}
                 title="Export nach Excel"
                 className="h-9"
                 data-testid="schedule-export"
              >
                {isExporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                <span className="hidden sm:inline ml-1">Export</span>
             </Button>
              {currentWeekShifts.length > 0 && !isReadOnly && (
                  <Button 
                     variant="ghost" 
                     size="sm"
                     onClick={handleClearWeek}
                     className="text-red-500 hover:text-red-700 hover:bg-red-50 h-9"
                     data-testid="schedule-clear-week"
                  >
                    <Trash2 className="w-4 h-4" />
                    <span className="hidden sm:inline ml-1">Leeren</span>
                 </Button>
             )}
             {!isReadOnly && (
                 <>
                     <WorkplaceConfigDialog />
                     <ColorSettingsDialog />
                 </>
             )}
             <SectionConfigDialog />
                <DropdownMenu>
                   <DropdownMenuTrigger asChild>
                       <Button variant="outline" size="icon" title="Ansicht anpassen">
                           <Eye className="h-4 w-4" />
                       </Button>
                   </DropdownMenuTrigger>
                   <DropdownMenuContent align="end" className="w-56">
                       <DropdownMenuLabel>Ansicht</DropdownMenuLabel>
                       <DropdownMenuCheckboxItem 
                           checked={showSidebar}
                           onCheckedChange={setShowSidebar}
                       >
                           Team Leiste anzeigen
                       </DropdownMenuCheckboxItem>
                       <DropdownMenuCheckboxItem 
                           checked={highlightMyName}
                           onCheckedChange={setHighlightMyName}
                       >
                           Eigenen Namen hervorheben
                       </DropdownMenuCheckboxItem>
                       <DropdownMenuCheckboxItem 
                           checked={showInitialsOnly}
                           onCheckedChange={setShowInitialsOnly}
                       >
                           Nur Kürzel
                       </DropdownMenuCheckboxItem>
                       <DropdownMenuCheckboxItem 
                           checked={sortDoctorsAlphabetically}
                           onCheckedChange={setSortDoctorsAlphabetically}
                       >
                           Mitarbeiter alphabetisch sortieren
                       </DropdownMenuCheckboxItem>
                       <DropdownMenuCheckboxItem 
                           checked={showSidebarTimeAccount}
                           onCheckedChange={setShowSidebarTimeAccount}
                       >
                           Seitenleiste mit Zeitkonto
                       </DropdownMenuCheckboxItem>
                       <DropdownMenuSeparator />

                       <DropdownMenuLabel className="flex justify-between items-center">
                          <span>Schriftgröße</span>
                          <span className="text-xs font-normal text-slate-500">{gridFontSize}px</span>
                       </DropdownMenuLabel>
                       <div className="px-2 py-2" onClick={(e) => e.stopPropagation()}>
                           <input 
                               type="range" 
                               min="10" 
                               max="24" 
                               step="1"
                               value={gridFontSize} 
                               onChange={(e) => setGridFontSize(Number(e.target.value))}
                               className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-indigo-600"
                           />
                       </div>
                       <DropdownMenuSeparator />
                       <DropdownMenuLabel>Zeilen verwalten</DropdownMenuLabel>
                       <ScrollArea className="h-[300px]">
                           {sections.flatMap(s => s.rows).map((row, idx) => {
                               // Rückwärtskompatibilität: Falls string, in Objekt konvertieren
                               const rowObj = typeof row === 'string' 
                                   ? { name: row, displayName: row } 
                                   : row;
                               const rowName = rowObj.name;
                               const rowDisplayName = rowObj.displayName || rowName;
                               const rowKey = rowObj.timeslotId 
                                   ? `${rowName}-${rowObj.timeslotId}` 
                                   : `${rowName}-${idx}`;
                               return (
                               <DropdownMenuCheckboxItem
                                   key={rowKey}
                                   checked={!hiddenRows.includes(rowName)}
                                   onCheckedChange={(checked) => {
                                       setHiddenRows(prev => 
                                           checked 
                                               ? prev.filter(r => r !== rowName) 
                                               : [...prev, rowName]
                                       );
                                   }}
                               >
                                   {rowDisplayName}
                               </DropdownMenuCheckboxItem>
                               );
                           })}
                       </ScrollArea>
                   </DropdownMenuContent>
                </DropdownMenu>
                </div>
                  </div>
                  )}

                            {!isEmbeddedSchedule && availableSectionTabs.length > 0 && (
                    <div className="bg-white p-2 rounded-lg shadow-sm border border-slate-200 flex items-center gap-2 overflow-x-auto">
                        <button
                            onClick={() => setActiveSectionTabId('main')}
                            className={`px-3 py-1.5 rounded-md text-sm font-medium whitespace-nowrap transition-colors ${activeSectionTabId === 'main' ? 'bg-indigo-100 text-indigo-700' : 'text-slate-600 hover:bg-slate-100'}`}
                        >
                            Hauptplan
                        </button>
                        {availableSectionTabs.map(tab => {
                            const isActive = activeSectionTabId === tab.id;
                            return (
                                <div
                                    key={tab.id}
                                    className={`flex items-center rounded-md border transition-colors ${isActive ? 'bg-indigo-50 border-indigo-200' : 'bg-white border-slate-200'}`}
                                >
                                    <button
                                        onClick={() => {
                                            if (canUseSplitView && isSplitViewEnabled) {
                                                handleOpenSectionTabInSplitView(tab.id);
                                                return;
                                            }
                                            setActiveSectionTabId(tab.id);
                                        }}
                                        className={`px-3 py-1.5 text-sm font-medium whitespace-nowrap ${isActive ? 'text-indigo-700' : 'text-slate-600 hover:bg-slate-100'}`}
                                    >
                                        {getSectionName(tab.sectionTitle)}
                                    </button>
                                    <button
                                        onClick={() => handleOpenSectionTabInNewWindow(tab.id)}
                                        className="px-2 py-1.5 text-slate-400 hover:text-indigo-600"
                                        title="In separatem Fenster öffnen"
                                    >
                                        <ExternalLink className="w-3.5 h-3.5" />
                                    </button>
                                    {canUseSplitView && (
                                        <button
                                            onClick={() => handleOpenSectionTabInSplitView(tab.id)}
                                            className="px-2 py-1.5 text-slate-400 hover:text-indigo-600"
                                            title="Im Split-View öffnen"
                                        >
                                            <Layout className="w-3.5 h-3.5" />
                                        </button>
                                    )}
                                    <button
                                        onClick={() => handleCloseSectionTab(tab.id)}
                                        className="px-2 py-1.5 text-slate-400 hover:text-red-500"
                                        title="Reiter schließen"
                                    >
                                        <X className="w-3.5 h-3.5" />
                                    </button>
                                </div>
                            );
                        })}
                        {canUseSplitView && isSplitViewEnabled && (
                            <button
                                onClick={() => setIsSplitViewEnabled(false)}
                                className="px-3 py-1.5 rounded-md text-sm font-medium whitespace-nowrap text-slate-600 hover:bg-slate-100"
                                title="Split-View schließen"
                            >
                                Split-View beenden
                            </button>
                        )}
                    </div>
                )}

                <DragDropContext 
                  onBeforeCapture={handleBeforeCapture}
                  onDragStart={handleDragStart} 
                                    onDragUpdate={handleDragUpdate}
                  onDragEnd={handleDragEnd}
                                    autoScrollerOptions={dragAutoScrollerOptions}
                >

                  <div className="flex flex-col lg:flex-row gap-6 items-start relative min-h-[500px]">

                  {/* Sidebar */}
                {showSidebar && !isEmbeddedSchedule && (
                <div className={`w-full lg:w-64 flex-shrink-0 bg-white p-4 rounded-lg shadow-sm border border-slate-200 lg:sticky lg:top-4 max-h-[calc(100vh-200px)] flex flex-col gap-3 z-50 ${draggingDoctorId ? 'overflow-hidden' : 'overflow-y-auto'}`}>
                <Popover open={scheduleFilterOpen} onOpenChange={setScheduleFilterOpen}>
                    <PopoverTrigger asChild>
                        <Button
                            variant="outline"
                            size="sm"
                            data-testid="schedule-sidebar-qualification-filter"
                            className="h-8 w-full justify-between gap-2 px-2 text-xs font-normal text-slate-600"
                        >
                            <span className="flex items-center gap-2 truncate">
                                <Filter className="h-3.5 w-3.5 shrink-0" />
                                <span className="truncate">
                                    {isQualificationDataLoading
                                        ? 'Qualifikationen laden...'
                                        : selectedQualificationIds.length === 0
                                            ? 'Qualifikationsfilter'
                                            : `${selectedQualificationIds.length} Qualifikation${selectedQualificationIds.length === 1 ? '' : 'en'} aktiv`}
                                </span>
                            </span>
                            <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 opacity-50" />
                        </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-[320px] p-0" align="start" side="right">
                        <Command>
                            <CommandInput placeholder="Qualifikation suchen..." aria-label="Qualifikation suchen" />
                            <CommandList>
                                <CommandEmpty>Keine Qualifikation gefunden.</CommandEmpty>
                                {activeQualifications.map((qualification) => {
                                    const isSelected = selectedQualificationIds.includes(qualification.id);
                                    return (
                                        <CommandItem
                                            key={qualification.id}
                                            value={`${qualification.name} ${qualification.short_label || ''}`}
                                            onSelect={() => toggleScheduleQualification(qualification.id)}
                                        >
                                            <div className={cn(
                                                "flex h-4 w-4 items-center justify-center rounded-sm border",
                                                isSelected ? 'border-indigo-600 bg-indigo-600 text-white' : 'border-slate-300 text-transparent'
                                            )}>
                                                <Check className="h-3 w-3" />
                                            </div>
                                            <Badge
                                                style={{
                                                    backgroundColor: qualification.color_bg || '#e0e7ff',
                                                    color: qualification.color_text || '#3730a3'
                                                }}
                                                className="border-0 text-[10px]"
                                            >
                                                {qualification.short_label || qualification.name.substring(0, 3).toUpperCase()}
                                            </Badge>
                                            <span className="truncate">{qualification.name}</span>
                                        </CommandItem>
                                    );
                                })}
                            </CommandList>
                        </Command>
                        {selectedQualificationIds.length > 0 && (
                            <div className="border-t p-2 space-y-2">
                                <div className="flex flex-wrap items-center gap-1">
                                    {selectedQualificationIds.flatMap((qid, idx) => {
                                        const qualification = qualificationMap[qid];
                                        if (!qualification) return [];
                                        const chip = (
                                            <button
                                                key={`chip-${qid}`}
                                                type="button"
                                                onClick={() => toggleScheduleQualification(qid)}
                                                className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] text-slate-700 transition-colors hover:bg-slate-100"
                                            >
                                                <span>{qualification.short_label || qualification.name}</span>
                                                <X className="h-2.5 w-2.5" />
                                            </button>
                                        );
                                        if (idx === 0) return [chip];
                                        return [
                                            <span key={`sep-${qid}`} className="text-[9px] font-semibold uppercase tracking-wide text-slate-400">oder</span>,
                                            chip,
                                        ];
                                    })}
                                </div>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-7 w-full text-xs text-slate-500"
                                    onClick={() => setSelectedQualificationIds([])}
                                >
                                    Filter zurücksetzen
                                </Button>
                            </div>
                        )}
                    </PopoverContent>
                </Popover>
                <div>
                <h3 className="font-semibold text-slate-700 mb-3 flex items-center">
                    <span className="bg-indigo-100 text-indigo-700 h-6 px-2 rounded-full flex items-center justify-center text-xs mr-2">
                        {selectedQualificationIds.length > 0
                            ? `${sidebarDoctors.length}/${sidebarDoctorsAll.length}`
                            : sidebarDoctors.length}
                    </span>
                    Verfügbares Personal
                </h3>
                <Droppable 
                    droppableId="sidebar" 
                    isDropDisabled={isReadOnly}
                    renderClone={(provided, snapshot, rubric) => {
                        const doctor = sidebarDoctors[rubric.source.index];
                        const roleStyle = getRoleColor(doctor?.role);
                        const cloneSize = shiftBoxSize;
                        return (
                            <div
                                ref={provided.innerRef}
                                {...provided.draggableProps}
                                {...provided.dragHandleProps}
                                className="flex items-center justify-center"
                                style={{
                                    ...provided.draggableProps.style,
                                    backgroundColor: 'transparent',
                                    border: 'none',
                                    boxShadow: 'none',
                                    width: `${cloneSize}px`,
                                    height: `${cloneSize}px`,
                                }}
                            >
                                <div 
                                    className="flex items-center justify-center rounded-md font-bold border shadow-2xl ring-4 ring-indigo-400"
                                    style={{
                                        backgroundColor: roleStyle?.backgroundColor || '#ffffff',
                                        color: roleStyle?.color || '#000000',
                                        width: `${cloneSize}px`,
                                        height: `${cloneSize}px`,
                                        fontSize: `${effectiveGridFontSize}px`,
                                        zIndex: 9999,
                                    }}
                                >
                                    <span>{getDoctorChipLabel(doctor)}</span>
                                </div>
                            </div>
                        );
                    }}
                >
                    {(provided) => (
                        <div ref={provided.innerRef} {...provided.droppableProps} className="space-y-1">
                            {sidebarDoctors.map((doctor, index) => {
                                const sidebarDoctor = getDoctorWithEffectiveFte(doctor, viewMode === 'month' ? currentDate : weekDays[0]);
                                const doctorQualIds = rowQualFilter ? getDoctorQualIds(doctor.id) : [];
                                const doctorHint = rowQualFilter ? getDoctorRowQualHint(rowQualFilter, doctorQualIds) : null;
                                const doctorHintRingClass = getDoctorRowQualRingClass(doctorHint);

                                return (
                                    <DraggableDoctor
                                        key={doctor.id}
                                        doctor={sidebarDoctor}
                                        index={index}
                                        style={getRoleColor(doctor.role)}
                                        compactLabel={getDoctorChipLabel(doctor)}
                                        isCompactMode={isMonthView}
                                        isDragDisabled={isReadOnly}
                                        isBeingDragged={draggingDoctorId === doctor.id}
                                        workTimeModel={doctor.work_time_model_id ? workTimeModelMap.get(doctor.work_time_model_id) : null}
                                        centralEmployee={doctor.central_employee_id ? centralEmployeesById.get(String(doctor.central_employee_id)) : null}
                                        plannedHours={weeklyPlannedHours.get(doctor.id) || 0}
                                        showTimeAccount={showSidebarTimeAccount}
                                        hintRingClass={doctorHintRingClass}
                                        hintKind={doctorHint}
                                    />
                                );
                            })}
                            {provided.placeholder}
                        </div>
                    )}
                </Droppable>
                {sidebarDoctors.length === 0 && selectedQualificationIds.length > 0 && (
                    <div className="mt-2 rounded-md border border-dashed border-slate-200 bg-slate-50 p-3 text-center text-[11px] text-slate-500">
                        Keine Ärzte mit den gewählten Qualifikationen.
                    </div>
                )}
            </div>
            
            {/* Trash removed - use overlay instead */}
                            </div>
                            )}

                            {/* Matrix */}
                            <div className={`w-full lg:flex-1 bg-white rounded-lg shadow-sm border border-slate-200 ${isEmbeddedSchedule ? 'max-h-[calc(100vh-120px)]' : 'max-h-[calc(100vh-180px)]'} z-0 overflow-x-auto overflow-y-auto`}>
                                                        <div style={{ minWidth: `${matrixMinWidth}px` }}>
                                                            <div className="grid border-b border-slate-200 bg-slate-50 sticky top-0 z-30 shadow-sm" style={matrixGridStyle}>
                <div className="p-3 font-semibold text-slate-700 border-r border-slate-200 flex items-center bg-slate-50">
                    Bereich / Datum
                </div>
                {weekDays.map(day => {
                    if (!isValid(day)) return <div key={Math.random()} className="p-2 text-center text-red-500">Invalid Date</div>;

                    const isToday = isSameDay(day, new Date());
                    const isHoliday = isPublicHoliday(day);
                    const isSchoolHol = isSchoolHoliday(day);

                    let bgClass = '';
                    if (isToday) bgClass = 'bg-yellow-50/30 border-x-2 border-t-2 border-x-yellow-400 border-t-yellow-400 border-b border-b-slate-200 text-yellow-900';
                    else if (isHoliday) bgClass = 'bg-blue-100 text-blue-900';
                    else if (isSchoolHol) bgClass = 'bg-green-100 text-green-900';
                    else if ([0,6].includes(day.getDay())) bgClass = 'bg-orange-50/50';

                    // Validation Logic
                    const dateStr = format(day, 'yyyy-MM-dd');
                    const hasShifts = currentWeekShiftDates.has(dateStr);
                    const unassignedDocs = availableDoctorsByDate.get(dateStr) || [];
                    
                    // Rotations are in sections[2] (if structure maintained)
                    // Better: find section by title
                    const rotationSection = sections.find(s => s.title === "Rotationen");
                    const rotationRows = rotationSection ? rotationSection.rows : [];
                    const dayShiftPositions = currentWeekShiftPositionsByDate.get(dateStr) || new Set();
                    const allRotationsFilled = rotationRows.length > 0 && rotationRows.every(r => dayShiftPositions.has(typeof r === 'string' ? r : r.name));

                    // Verfügbarkeits-Grenzwerte prüfen
                    const staffingWarnings = getAvailabilityWarnings({
                        doctors,
                        shifts: allShifts,
                        dateStr,
                        qualificationMap,
                        doctorQualByDoctor,
                        availabilityThresholds
                    });

                    const showWarning = (allRotationsFilled && unassignedDocs.length > 0 || staffingWarnings.hasWarning) && !isHoliday && ![0,6].includes(day.getDay());

                    return (
                        <div key={day.toISOString()} className={`group relative text-center border-r border-slate-200 last:border-r-0 ${isMonthView ? 'px-0.5 py-1' : 'p-2'} ${bgClass || 'bg-white'}`}>
                            {isMonthView ? (
                                <>
                                    <div className={`font-semibold leading-none ${isToday ? 'text-blue-700' : 'text-slate-800'}`}>
                                        {format(day, 'd', { locale: de })}
                                    </div>
                                    <div className={`text-[10px] uppercase leading-tight mt-1 ${isToday ? 'text-blue-600' : 'text-slate-500'}`}>
                                        {format(day, 'EEEEE', { locale: de })}
                                    </div>
                                    {isHoliday && <span className="block text-[9px] opacity-75 leading-tight mt-1">FT</span>}
                                    {isSchoolHol && !isHoliday && <span className="block text-[9px] opacity-75 leading-tight mt-1">Ferien</span>}
                                </>
                            ) : (
                                <>
                                    <div className={`font-semibold ${isToday ? 'text-blue-700' : 'text-slate-800'}`}>
                                        {format(day, 'EEEE', { locale: de })}
                                    </div>
                                    <div className={`text-xs ${isToday ? 'text-blue-600' : 'text-slate-500'}`}>
                                        {format(day, 'dd.MM.', { locale: de })}
                                        {isHoliday && <span className="block text-[10px] opacity-75 leading-tight mt-1">Feiertag</span>}
                                        {isSchoolHol && !isHoliday && <span className="block text-[10px] opacity-75 leading-tight mt-1">Ferien</span>}
                                    </div>
                                </>
                            )}

                            {showWarning && (
                                <Popover>
                                    <PopoverTrigger asChild>
                                        <button className="absolute top-1 left-1 p-1 rounded-full bg-amber-100 text-amber-600 hover:bg-amber-200 transition-colors" title="Hinweise zu diesem Tag">
                                            <AlertTriangle className="w-3 h-3" />
                                        </button>
                                    </PopoverTrigger>
                                    <PopoverContent className="w-72 p-3">
                                        <div className="space-y-3">
                                            {staffingWarnings.hasWarning && (
                                                <div>
                                                    <h4 className="font-medium text-sm text-red-800 flex items-center gap-2 border-b pb-1 mb-2">
                                                        <AlertTriangle className="w-4 h-4" />
                                                        Personalunterdeckung
                                                    </h4>
                                                    <div className="text-xs space-y-1">
                                                        {staffingWarnings.warnings.map((w, idx) => (
                                                            <div key={idx} className="text-slate-700">
                                                                <span className="font-semibold">{w.qualName}:</span> {w.present} verfügbar (Min: {w.min})
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}
                                            {allRotationsFilled && unassignedDocs.length > 0 && (
                                                <div>
                                                    <h4 className="font-medium text-sm text-amber-800 flex items-center gap-2 border-b pb-1 mb-2">
                                                        <AlertTriangle className="w-4 h-4" />
                                                        Nicht eingeteilte Mitarbeiter
                                                    </h4>
                                                    <div className="text-xs text-slate-600 mb-2">
                                                        Folgende Mitarbeiter haben heute noch keinen Eintrag:
                                                    </div>
                                                    <ScrollArea className="h-[180px] border rounded-md bg-slate-50 p-2">
                                                        <div className="space-y-1">
                                                            {unassignedDocs.map(doc => (
                                                                <div key={doc.id} className="flex items-center gap-2 text-sm text-slate-700 p-1 hover:bg-white rounded">
                                                                    <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold ${getRoleColor(doc.role).backgroundColor}`} style={{ color: getRoleColor(doc.role).color }}>
                                                                        {getDoctorChipLabel(doc)}
                                                                    </div>
                                                                    <span>{doc.name}</span>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    </ScrollArea>
                                                </div>
                                            )}
                                        </div>
                                    </PopoverContent>
                                </Popover>
                            )}
                            
                            {hasShifts && (
                                <button
                                    onClick={() => handleClearDay(day)}
                                    data-testid={`schedule-day-clear-${dateStr}`}
                                    className="absolute top-1 right-1 p-1 rounded-full bg-white/80 text-red-400 hover:text-red-600 hover:bg-white shadow-sm opacity-0 group-hover:opacity-100 transition-opacity"
                                    title="Tag leeren"
                                >
                                    <Trash2 className="w-3 h-3" />
                                </button>
                            )}
                        </div>
                    );
                })}
              </div>

              {movePinnedSectionToEnd(sections).map((section, sIdx) => {
                // rows sind jetzt Objekte mit { name, displayName, timeslotId, isTimeslotRow, isTimeslotGroupHeader }
                // Für Rückwärtskompatibilität: Falls string, in Objekt konvertieren
                const normalizedRows = section.rows.map(r => 
                    typeof r === 'string' ? { name: r, displayName: r, timeslotId: null, isTimeslotRow: false, isTimeslotGroupHeader: false } : r
                );
                
                // Filter: Versteckte Zeilen ausblenden
                const visibleRows = normalizedRows.filter(r => {
                    if (hiddenRows.includes(r.name)) return false;
                    return true;
                });
                if (visibleRows.length === 0) return null;
                
                const isCollapsed = collapsedSections.includes(section.title);
                const customStyle = getSectionStyle(section.title);
                const isPinnedSection = section.title === PINNED_SECTION_TITLE;

                return (
                <div key={sIdx} className={isPinnedSection ? STICKY_AVAILABLE_SECTION_CLASS : ''} style={isPinnedSection ? stickyAvailableSectionStyle : undefined}>
                    <div 
                        className={`px-3 py-2 text-xs font-bold uppercase tracking-wider border-b border-slate-200 flex items-center justify-between cursor-pointer select-none transition-colors ${!customStyle ? section.headerColor : ''}`}
                        style={customStyle ? customStyle.header : {}}
                        onClick={() => setCollapsedSections(prev => prev.includes(section.title) ? prev.filter(t => t !== section.title) : [...prev, section.title])}
                    >
                        <div className="flex items-center gap-2">
                            {isCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                            {getSectionName(section.title)}
                            {isPinnedSection && selectedQualificationIds.length > 0 && (
                                <span
                                    data-testid="schedule-anwesenheiten-filter-indicator"
                                    className="inline-flex items-center gap-1 rounded-full bg-amber-200 px-2 py-0.5 text-[10px] font-semibold normal-case tracking-normal text-amber-900"
                                >
                                    <Filter className="h-3 w-3" />
                                    Filter aktiv
                                </span>
                            )}
                            {isPinnedSection && rowQualFilter && (
                                <span
                                    data-testid="schedule-anwesenheiten-row-filter-indicator"
                                    className="inline-flex items-center gap-1 rounded-full bg-amber-300 px-2 py-0.5 text-[10px] font-semibold normal-case tracking-normal text-amber-900"
                                    title={`Zeilen-Filter aktiv für ${rowQualFilter.sourceName}`}
                                >
                                    <Filter className="h-3 w-3" />
                                    Zeilen-Filter: {rowQualFilter.sourceName}
                                </span>
                            )}
                        </div>
                        <div className="flex items-center gap-2">
                            {activeSectionTabId === 'main' && section.title !== 'Archiv / Unbekannt' && section.title !== PINNED_SECTION_TITLE && (
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        handleMoveSectionToTab(section.title);
                                    }}
                                    className="p-1 rounded hover:bg-white/40"
                                    title="In eigenen Reiter verschieben"
                                >
                                    <ExternalLink className="w-3.5 h-3.5" />
                                </button>
                            )}
                            <span className="text-[10px] opacity-70 bg-white/20 px-2 py-0.5 rounded-full">
                                {visibleRows.length}
                            </span>
                        </div>
                    </div>
                    
                    {!isCollapsed && visibleRows.map((rowObj, rIdx) => {
                        const rowName = rowObj.name;
                        const rowDisplayName = rowObj.displayName || rowName;
                        const rowTimeslotId = rowObj.timeslotId;
                        const isGroupHeader = rowObj.isTimeslotGroupHeader;
                        const rowStyle = getRowStyle(rowName, customStyle);
                        const rowWorkplace = workplaceByName.get(rowName);
                        const useLightweightTimeslotTarget = false;
                        const expandedRowLabel = getExpandedTimeslotRowLabel(rowObj, rowDisplayName);
                        const rowLabelPresentation = getRowLabelPresentation(expandedRowLabel, isMonthView);
                        const isRowQualFilterSource = !!rowQualFilter
                            && rowQualFilter.key === buildRowFilterKey(rowName, rowTimeslotId);
                        const hasRowQuals = (() => {
                            if (!rowWorkplace?.id) return false;
                            const { requiredIds, optionalIds, excludeIds } = buildRowQualSets({
                                workplaceId: rowWorkplace.id,
                                getRequired: getWpRequiredQualIds,
                                getOptional: getWpOptionalQualIds,
                                getDiscouraged: getWpDiscouragedQualIds,
                                getExcluded: getWpExcludedQualIds,
                            });
                            return requiredIds.length > 0 || optionalIds.length > 0 || excludeIds.length > 0;
                        })();

                        const headerDroppableId = `rowHeader__${rowName}${rowTimeslotId ? '__' + rowTimeslotId : ''}`;

                        return (
                        <div key={`${sIdx}-${rowDisplayName}-${rowTimeslotId || 'full'}`} className={`grid border-b border-slate-200 ${(draggingDoctorId || draggingShiftId) ? '' : 'hover:bg-slate-50/50'} transition-colors group ${isRowQualFilterSource ? 'ring-2 ring-amber-400 ring-inset bg-amber-50/40' : ''}`} style={matrixGridStyle}>
                            <Droppable droppableId={headerDroppableId} isDropDisabled={isReadOnly || rowObj.isCrossTenantRow || rowObj.isRotationRow}>
                                {(provided, snapshot) => (
                                    <div 
                                        ref={provided.innerRef}
                                        {...provided.droppableProps}
                                        data-testid={`schedule-row-header-${encodeScheduleTargetId(headerDroppableId)}`}
                                        className={`p-2 text-sm font-medium border-r border-slate-200 flex items-center justify-between transition-colors ${!customStyle ? section.headerColor : ''} ${snapshot.isDraggingOver ? 'ring-2 ring-inset ring-indigo-400 bg-indigo-50' : ''} ${isGroupHeader ? 'cursor-pointer' : ''}`}
                                        style={customStyle ? customStyle.header : {}}
                                        onClick={undefined}
                                    >
                                        <div className="flex flex-col min-w-0">
                                            <span className="flex min-w-0 items-center gap-1" title={expandedRowLabel}>
                                                {rowObj.isCrossTenantRow && <Globe2 className="w-3 h-3 mr-1 text-indigo-500" />}
                                                {rowObj.isRotationRow && <Globe2 className="w-3 h-3 mr-1 text-teal-500" />}
                                                <span
                                                    className={rowLabelPresentation.className}
                                                    style={rowLabelPresentation.style}
                                                >
                                                    {expandedRowLabel}
                                                </span>
                                                {isGroupHeader && rowObj.timeslotCount && (
                                                    <span className="text-[10px] text-slate-400 ml-1">({rowObj.timeslotCount})</span>
                                                )}
                                            </span>
                                            {rowObj.isAlwaysVisibleRow && rowObj.sourceSectionTitle && (
                                                <span className="text-[10px] font-normal text-indigo-600">
                                                    aus {getSectionName(rowObj.sourceSectionTitle)}
                                                </span>
                                            )}
                                            {rowObj.timeslotSummary && (
                                                <TimeslotSummaryHint
                                                    summary={rowObj.timeslotSummary}
                                                    details={rowObj.timeslotDetails}
                                                    count={rowObj.timeslotCount}
                                                />
                                            )}
                                            {!rowObj.isTimeslotRow && rowWorkplace?.time && (
                                                <span className="text-[10px] font-normal opacity-80">
                                                    {rowWorkplace.time} Uhr
                                                </span>
                                                )}
                                                </div>
                                                <div className="flex items-center gap-0.5">
                                                {viewMode === 'day' && renderLinkedWorkplaceButton(rowName, format(weekDays[0], 'yyyy-MM-dd'))}
                                                {hasRowQuals && (
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    data-testid={`schedule-row-filter-${encodeScheduleTargetId(headerDroppableId)}`}
                                                    className={`h-5 w-5 hover:bg-amber-100 ${isRowQualFilterSource ? 'opacity-100 text-amber-600' : 'opacity-0 group-hover:opacity-100 text-slate-500'}`}
                                                    onClick={() => applyRowQualificationFilter(rowName, rowTimeslotId, rowWorkplace)}
                                                    title={isRowQualFilterSource ? `Zeilen-Filter aufheben (${rowQualFilter.sourceName})` : `Nach Qualifications dieser Zeile filtern (${rowWorkplace?.name || rowName})`}
                                                >
                                                    <Filter className="h-3 w-3" />
                                                </Button>
                                                )}
                                                {!isReadOnly && rowName !== 'Verfügbar' && (
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    data-testid={`schedule-row-clear-${encodeScheduleTargetId(headerDroppableId)}`}
                                                    className="h-5 w-5 opacity-0 group-hover:opacity-100 hover:bg-red-100 hover:text-red-600"
                                                    onClick={() => handleClearRow(rowName, rowTimeslotId)}
                                                    title="Zeile leeren"
                                                >
                                                    <Trash2 className="h-3 w-3" />
                                                </Button>
                                                )}
                                                <Button 
                                                variant="ghost" 
                                                size="icon" 
                                                className="h-5 w-5 opacity-0 group-hover:opacity-100 hover:bg-black/10"
                                                onClick={() => setHiddenRows(prev => [...prev, rowName])}
                                                title="Zeile ausblenden"
                                                >
                                                <EyeOff className="h-3 w-3 opacity-50" />
                                                </Button>
                                                </div>
                                                <div className="hidden">{provided.placeholder}</div>
                                    </div>
                                )}
                            </Droppable>
                            {weekDays.map((day, dIdx) => {
                                const isWeekend = [0, 6].includes(day.getDay());
                                const isToday = isSameDay(day, new Date());
                                const dateStr = format(day, 'yyyy-MM-dd');
                                // Unique ID for droppable: date__position oder date__position__timeslotId
                                const cellId = rowTimeslotId 
                                    ? `${dateStr}__${rowName}__${rowTimeslotId}`
                                    : `${dateStr}__${rowName}`;
                                const cellShiftsForOcc = getShiftsForScheduleCell({ shiftLookup: currentWeekShiftLookup, dateStr, rowName, timeslotId: rowTimeslotId, allTimeslotIds: rowObj.allTimeslotIds || null, singleTimeslotId: rowObj.singleTimeslotId || null, timeslotsEnabled: Boolean(rowWorkplace?.timeslots_enabled) });
                                const isOccupied = cellShiftsForOcc.length > 0;
                                
                                // Check if it's a demo row and if it's allowed
                                let isDisabled = false;
                                let isTrainingHighlight = false;

                                if (draggingDoctorId) {
                                    const activeRotations = trainingRotations.filter(rot => 
                                        rot.doctor_id === draggingDoctorId &&
                                        rot.start_date <= dateStr &&
                                        rot.end_date >= dateStr
                                    );
                                    
                                    // Check match (handling mapping for Röntgen)
                                    const isTarget = activeRotations.some(rot => 
                                        rot.modality === rowName || 
                                        (rot.modality === 'Röntgen' && (rowName === 'DL/konv. Rö' || rowName.includes('Rö')))
                                    );
                                    
                                    if (isTarget) {
                                        isTrainingHighlight = true;
                                    }
                                }

                                // Check active_days for ALL sections (Rotationen, Dienste, Demos, Custom)
                                // Feiertage verhalten sich wie Sonntag
                                // Default active_days (wenn nicht gesetzt): Mo-Fr [1,2,3,4,5]
                                {
                                    if (rowName !== 'Verfügbar') {
                                        const setting = workplaceByName.get(rowName);
                                        if (setting) {
                                            const activeDays = (setting.active_days && setting.active_days.length > 0) ? setting.active_days : [1, 2, 3, 4, 5];
                                            // Feiertag = wie Sonntag: An Feiertagen zählt nur, ob Sonntag (0) aktiv ist
                                            const isActive = isPublicHoliday(day)
                                                ? activeDays.some(d => Number(d) === 0)
                                                : activeDays.some(d => Number(d) === day.getDay());
                                            if (!isActive) {
                                                isDisabled = true;
                                            }
                                        }
                                    }
                                }

                                return (
                                    <div key={dIdx} className={`border-r border-slate-100 last:border-r-0`}>
                                        {rowObj.isCrossTenantRow ? (
                                            renderCrossTenantCell(rowObj.crossTenantWorkplace, dateStr)
                                        ) : rowObj.isRotationRow ? (
                                            renderRotationCell(rowObj.rotationWorkplace, dateStr, {
                                                isToday, isWeekend, isAlternate: rIdx % 2 !== 0,
                                                baseClassName: !customStyle && !rowStyle.backgroundColor ? section.rowColor : '',
                                                baseStyle: rowStyle.backgroundColor ? { backgroundColor: rowStyle.backgroundColor, color: rowStyle.color } : {},
                                            })
                                        ) : rowName === 'Verfügbar' ? (
                                            <Droppable droppableId={`available__${dateStr}`} isDropDisabled={isReadOnly} renderClone={renderAvailableDoctorClone}>
                                                {(provided, snapshot) => {
                                                    const allDocs = allDisplayDocsByDate.get(dateStr) || [];

                                                    return (
                                                        <div
                                                            ref={provided.innerRef}
                                                            {...provided.droppableProps}
                                                            className={`${isMonthView ? 'min-h-[32px] p-0.5 gap-0.5' : 'min-h-[40px] p-1 gap-1'} flex flex-wrap transition-colors ${snapshot.isDraggingOver ? 'bg-green-100' : 'bg-green-50'}`}
                                                        >
                                                            {allDocs.map((doc, idx) => {
                                                                const isSpringer = doc._isSpringer;
                                                                return (
                                                                <Draggable
                                                                    key={`available-${doc.id}-${dateStr}`}
                                                                    draggableId={`available-doc-${doc.id}-${dateStr}`}
                                                                    index={idx}
                                                                    isDragDisabled={isReadOnly}
                                                                >
                                                                    {(provided, snapshot) => {
                                                                        if (isSpringer) {
                                                                            const springerStyle = { backgroundColor: '#fef3c7', color: '#92400e' };
                                                                            const tooltipText = `${doc._employeeName} — Aus Pool-Rotation zuweisbar`;
                                                                            return (
                                                                                <div
                                                                                    ref={provided.innerRef}
                                                                                    {...provided.draggableProps}
                                                                                    {...provided.dragHandleProps}
                                                                                    data-testid={`schedule-springer-${doc._assignmentId}-${dateStr}`}
                                                                                    style={{ ...provided.draggableProps.style, ...springerStyle }}
                                                                                    className={`
                                                                                        relative ${isMonthView ? 'text-[9px] px-1 py-0.5 max-w-[44px] whitespace-nowrap' : 'text-[10px] px-1.5 py-0.5 max-w-[100px] truncate'} rounded border shadow-sm select-none
                                                                                        ${snapshot.isDragging ? 'opacity-50 ring-2 ring-indigo-500 z-50' : ''}
                                                                                    `}
                                                                                    title={tooltipText}
                                                                                >
                                                                                    {doc._springerLabel}
                                                                                </div>
                                                                            );
                                                                        }
                                                                        // Regular doctor rendering (unchanged)
                                                                        const { style, wishClass: baseWishClass, tooltipText } = getAvailableDoctorWishPresentation(doc, dateStr);
                                                                        let wishClass = "";
                                                                        const isCurrentUser = user?.doctor_id && doc.id === user.doctor_id;
                                                                        if (isCurrentUser && highlightMyName) wishClass = "ring-2 ring-red-500 ring-offset-1 z-10";
                                                                        if (!wishClass) {
                                                                            wishClass = baseWishClass;
                                                                        }
                                                                        const availableDocQualIds = rowQualFilter ? getDoctorQualIds(doc.id) : [];
                                                                        const availableDocHint = rowQualFilter ? getDoctorRowQualHint(rowQualFilter, availableDocQualIds) : null;
                                                                        const availableDocHintRing = getDoctorRowQualRingClass(availableDocHint);
                                                                        const hintTitle = availableDocHint === 'preferred'
                                                                            ? 'Sollte (bevorzugt)'
                                                                            : availableDocHint === 'discouraged'
                                                                                ? 'Sollte nicht (möglich, aber ungünstig)'
                                                                                : null;

                                                                        return (
                                                                            <div
                                                                                ref={provided.innerRef}
                                                                                {...provided.draggableProps}
                                                                                {...provided.dragHandleProps}
                                                                                data-testid={`schedule-available-doctor-${doc.id}-${dateStr}`}
                                                                                style={{ ...provided.draggableProps.style, ...style }}
                                                                                className={`
                                                                                    relative ${isMonthView ? 'text-[9px] px-1 py-0.5 max-w-[44px] whitespace-nowrap' : 'text-[10px] px-1.5 py-0.5 max-w-[100px] truncate'} rounded border shadow-sm select-none
                                                                                    ${snapshot.isDragging ? 'opacity-50 ring-2 ring-indigo-500 z-50' : ''}
                                                                                    ${availableDocHintRing || ''}
                                                                                    ${wishClass}
                                                                                `}
                                                                                title={hintTitle ? `${hintTitle} — ${tooltipText}` : tooltipText}
                                                                            >
                                                                                {getDoctorChipLabel(doc)}
                                                                                {lateRotationIndicatorByDoctorDay.get(`${doc.id}__${dateStr}`) && (
                                                                                    <LateAvailabilityBadge tooltip={lateRotationIndicatorByDoctorDay.get(`${doc.id}__${dateStr}`)} compact />
                                                                                )}
                                                                            </div>
                                                                        );
                                                                    }}
                                                                </Draggable>
                                                                );
                                                            })}
                                                            {provided.placeholder}
                                                        </div>
                                                    );
                                                }}
                                            </Droppable>
                                        ) : rowName === 'Sonstiges' ? (
                                            isMonthView ? (() => {
                                                const note = scheduleNotesMap.get(`${dateStr}|${rowName}`);
                                                const hasNote = Boolean(note?.content?.trim());
                                                return (
                                                    <div
                                                        className={`h-full min-h-[38px] flex items-center justify-center ${hasNote ? 'bg-purple-50/40 hover:bg-purple-100/70 cursor-help' : 'bg-purple-50/10'} transition-colors`}
                                                        title={hasNote ? note.content : undefined}
                                                    >
                                                        {hasNote ? <StickyNote className="w-3.5 h-3.5 text-purple-500" /> : null}
                                                    </div>
                                                );
                                            })() : isReadOnly ? (
                                                <div className="p-2 text-base text-slate-500 h-full min-h-[40px] whitespace-pre-wrap">
                                                    {scheduleNotesMap.get(`${dateStr}|${rowName}`)?.content || ''}
                                                </div>
                                            ) : (
                                                <FreeTextCell 
                                                    date={day}
                                                    rowName={rowName}
                                                    notes={scheduleNotes}
                                                    onCreate={createNoteMutation}
                                                    onUpdate={updateNoteMutation}
                                                    onDelete={deleteNoteMutation}
                                                />
                                            )
                                        ) : (
                                            <div className="flex flex-col h-full relative group/cell">
                                                <DroppableCell 
                                                    id={cellId}
                                                    testId={`schedule-cell-${encodeScheduleTargetId(cellId)}`}
                                                    isCompact={isMonthView}
                                                    isToday={isToday}
                                                    isWeekend={isWeekend}
                                                    isDisabled={isDisabled}
                                                    isReadOnly={isReadOnly}
                                                    isAlternate={rIdx % 2 !== 0}
                                                    isTrainingHighlight={isTrainingHighlight}
                                                    isBlocked={!!getScheduleBlock(dateStr, rowName, rowTimeslotId)}
                                                    blockReason={getScheduleBlock(dateStr, rowName, rowTimeslotId)?.reason}
                                                    infoReason={getScheduleInfo(dateStr, rowName, rowTimeslotId)?.reason}
                                                    isOccupied={isOccupied}
                                                    onContextMenu={(e) => handleCellContextMenu(e, dateStr, rowName, rowTimeslotId)}
                                                    baseClassName={!customStyle && !rowStyle.backgroundColor ? section.rowColor : ''}
                                                    baseStyle={rowStyle.backgroundColor ? { backgroundColor: rowStyle.backgroundColor, color: rowStyle.color } : {}}
                                                    renderClone={renderShiftClone}
                                                >
                                                    {({ cellWidth }) => useLightweightTimeslotTarget ? null : renderCellShifts(
                                                        day, 
                                                        rowName, 
                                                        ["Dienste", "Demonstrationen & Konsile"].includes(section.title), 
                                                        rowTimeslotId,
                                                        rowObj.allTimeslotIds || null,
                                                        rowObj.singleTimeslotId || null,
                                                        '',
                                                        cellWidth
                                                    )}
                                                </DroppableCell>
                                                {viewMode !== 'day' && renderLinkedWorkplaceCellButton(rowName, dateStr)}
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                        );
                    })}
                </div>
              );
            })}
            </div>
          </div>
                    {renderSplitMatrix()}
                </div>
      </DragDropContext>
      
      {/* Override Confirm Dialog */}
      <OverrideConfirmDialog
          open={overrideDialog.open}
          onOpenChange={setOverrideDialogOpen}
          blockers={overrideDialog.blockers}
          warnings={overrideDialog.warnings}
          context={overrideDialog.context}
          onConfirm={confirmOverride}
          onCancel={cancelOverride}
      />

      <Dialog open={timeslotSelectionDialog.open} onOpenChange={handleTimeslotDialogOpenChange}>
          <DialogContent className="sm:max-w-2xl" data-testid="schedule-timeslot-selection-dialog">
              <DialogHeader>
                  <DialogTitle>Zeitfenster wählen</DialogTitle>
                  <DialogDescription>{timeslotSelectionDialog.description}</DialogDescription>
              </DialogHeader>
              {(() => {
                  return (
                      <div className="space-y-4">
                          <div className="space-y-3">
                              {timeslotSelectionDialog.options.map((timeslot) => (
                                  (() => {
                                      const customEndMinutes = timeslotSelectionDialog.customEndMinutesByOptionId?.[timeslot.id]
                                          ?? getDefaultCustomTimeslotEndMinutes(timeslot);
                                      const customStartMinutes = timeslotSelectionDialog.customStartMinutesByOptionId?.[timeslot.id]
                                          ?? timeslot.effectiveStartMinutes ?? timeslot.slotStartMinutes;
                                      const customTimeRange = Number.isFinite(customStartMinutes) && Number.isFinite(customEndMinutes)
                                          ? `${formatMinutesAsTime(customStartMinutes)}-${formatMinutesAsTime(customEndMinutes)}`
                                          : null;
                                      const slotEndHint = Number.isFinite(timeslot.slotEndMinutes)
                                          ? `${formatMinutesAsTime(timeslot.slotEndMinutes)}${timeslot.slotEndMinutes >= (24 * 60) ? ' +1' : ''}`
                                          : null;

                                      return (
                                          <div
                                              key={timeslot.id}
                                              className={cn(
                                                  'rounded-xl border p-4 transition-colors',
                                                  timeslot.leavesEarly
                                                      ? 'border-amber-200 bg-amber-50/70'
                                                      : 'border-slate-200 bg-white',
                                                  timeslotSelectionDialog.activeTimeslotId === timeslot.id
                                                      ? 'ring-2 ring-emerald-500 border-emerald-400'
                                                      : ''
                                              )}
                                          >
                                              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                                                  <div className="space-y-1">
                                                      <div className="flex items-center gap-2">
                                                          <div className="font-medium text-slate-900">{timeslot.label || 'Zeitfenster'}</div>
                                                          {timeslotSelectionDialog.activeTimeslotId === timeslot.id && (
                                                              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
                                                                  Aktuell
                                                              </span>
                                                          )}
                                                          {timeslot.leavesEarly && (
                                                              <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800">
                                                                  <AlertTriangle className="h-3.5 w-3.5" />
                                                                  Verkürzter Einsatz
                                                              </span>
                                                          )}
                                                      </div>
                                                      {timeslot.timeRange && (
                                                          <div className="text-sm text-slate-500">Slot: {timeslot.timeRange}</div>
                                                      )}
                                                      {timeslot.effectiveTimeRange && timeslot.effectiveTimeRange !== timeslot.timeRange && (
                                                          <div className="text-sm font-medium text-indigo-700">Geplanter Einsatz: {timeslot.effectiveTimeRange}</div>
                                                      )}
                                                      {timeslotSelectionDialog.allowCustomEditing && customTimeRange && (
                                                          <div className="text-sm font-medium text-slate-900">Manueller Einsatz: {customTimeRange}</div>
                                                      )}
                                                  </div>
                                                  <div className="flex shrink-0 flex-wrap gap-2">
                                                      <Button
                                                          type="button"
                                                          size="sm"
                                                          onClick={() => handleTimeslotDialogSelect(timeslot.id)}
                                                          data-testid={`schedule-timeslot-option-${timeslot.id}`}
                                                      >
                                                          Standard übernehmen
                                                      </Button>
                                                  </div>
                                              </div>

                                              {timeslotSelectionDialog.allowCustomEditing && timeslot.canCustomize && (
                                                  <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
                                                      <label className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-slate-500">
                                                          Start
                                                          <Input
                                                              type="time"
                                                              step={300}
                                                              value={Number.isFinite(customStartMinutes) ? formatMinutesAsTime(customStartMinutes) : ''}
                                                              onChange={(event) => handleTimeslotCustomStartChange(timeslot.id, timeslot, event.target.value)}
                                                              className="h-8 w-[124px]"
                                                              data-testid={`schedule-timeslot-custom-start-${timeslot.id}`}
                                                          />
                                                      </label>
                                                      <label className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-slate-500">
                                                          Ende
                                                          <Input
                                                              type="time"
                                                              step={300}
                                                              value={Number.isFinite(customEndMinutes) ? formatMinutesAsTime(customEndMinutes) : ''}
                                                              onChange={(event) => handleTimeslotCustomEndChange(timeslot.id, timeslot, event.target.value)}
                                                              className="h-8 w-[124px]"
                                                              data-testid={`schedule-timeslot-custom-end-${timeslot.id}`}
                                                          />
                                                      </label>
                                                      <Button
                                                          type="button"
                                                          size="sm"
                                                          className="h-8 px-3"
                                                          onClick={() => handleTimeslotCustomApply(timeslot)}
                                                          data-testid={`schedule-timeslot-custom-apply-${timeslot.id}`}
                                                      >
                                                          Speichern
                                                      </Button>
                                                      {customTimeRange && (
                                                          <span className="text-xs text-slate-500">
                                                              {customTimeRange}
                                                          </span>
                                                      )}
                                                      {slotEndHint && (
                                                          <span className="text-xs text-slate-400">
                                                              bis {slotEndHint}
                                                          </span>
                                                      )}
                                                  </div>
                                              )}
                                          </div>
                                      );
                                  })()
                              ))}
                          </div>
                      </div>
                  );
              })()}
              <DialogFooter>
                  <Button variant="outline" onClick={closeTimeslotSelectionDialog}>Abbrechen</Button>
              </DialogFooter>
          </DialogContent>
      </Dialog>

      {/* Schedule Block & Info Context Menu */}
      {blockContextMenu && (
        <>
          <div className="fixed inset-0 z-[9998]" onClick={() => setBlockContextMenu(null)} />
          <div
            className="fixed z-[9999] bg-white rounded-lg shadow-xl border border-slate-200 p-3 min-w-[260px]"
            style={{ left: blockContextMenu.x, top: blockContextMenu.y }}
          >
            <div className="text-xs text-slate-500 mb-2 font-medium">
              {blockContextMenu.position} — {blockContextMenu.dateStr}
            </div>

            {/* --- Block section --- */}
            {blockContextMenu.existingBlock ? (
              <>
                <div className="text-sm text-red-700 mb-1.5 flex items-center gap-1.5">
                  <Lock className="w-3.5 h-3.5" />
                  Gesperrt{blockContextMenu.existingBlock.reason ? `: ${blockContextMenu.existingBlock.reason}` : ''}
                </div>
                <button
                  onClick={handleUnblockCell}
                  className="w-full text-left px-3 py-1.5 text-sm rounded hover:bg-green-50 text-green-700 flex items-center gap-2"
                >
                  <Unlock className="w-3.5 h-3.5" />
                  Sperrung aufheben
                </button>
              </>
            ) : (
              <>
                <input
                  type="text"
                  placeholder="Begründung (z.B. Wartung)"
                  value={blockReasonInput}
                  onChange={(e) => setBlockReasonInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleBlockCell(); }}
                  className="w-full text-sm border border-slate-200 rounded px-2 py-1 mb-1.5 focus:outline-none focus:ring-1 focus:ring-red-300"
                />
                <button
                  onClick={handleBlockCell}
                  className="w-full text-left px-3 py-1.5 text-sm rounded hover:bg-red-50 text-red-700 flex items-center gap-2"
                >
                  <Lock className="w-3.5 h-3.5" />
                  Zelle sperren
                </button>
              </>
            )}

            {/* Separator */}
            <div className="border-t border-slate-100 my-2" />

            {/* --- Info section --- */}
            <div className="text-xs text-slate-400 mb-1 font-medium">Info</div>
            {blockContextMenu.existingInfo ? (
              <>
                <div className="text-sm text-blue-700 mb-1.5 flex items-center gap-1.5">
                  <span className="flex items-center justify-center w-4 h-4 rounded-full bg-blue-400 text-white text-[10px] font-bold">i</span>
                  {blockContextMenu.existingInfo.reason || 'Kein Text'}
                </div>
                <button
                  onClick={handleDeleteInfoCell}
                  className="w-full text-left px-3 py-1.5 text-sm rounded hover:bg-blue-50 text-blue-700 flex items-center gap-2"
                >
                  <span className="flex items-center justify-center w-4 h-4 rounded-full bg-blue-400 text-white text-[10px] font-bold">i</span>
                  Info entfernen
                </button>
              </>
            ) : (
              <>
                <input
                  type="text"
                  placeholder="Info-Text (z.B. Wartung ab 8:00)"
                  value={infoReasonInput}
                  onChange={(e) => setInfoReasonInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleInfoCell(); }}
                  className="w-full text-sm border border-slate-200 rounded px-2 py-1 mb-1.5 focus:outline-none focus:ring-1 focus:ring-blue-300"
                />
                <button
                  onClick={handleInfoCell}
                  className="w-full text-left px-3 py-1.5 text-sm rounded hover:bg-blue-50 text-blue-700 flex items-center gap-2"
                >
                  <span className="flex items-center justify-center w-4 h-4 rounded-full bg-blue-400 text-white text-[10px] font-bold">i</span>
                  Info hinterlegen
                </button>
              </>
            )}
          </div>
        </>
      )}

      {/* Cross-tenant (group/pool) shift editor */}
      <PoolShiftEditDialog
        open={poolEditDialog.open}
        onOpenChange={(open) => setPoolEditDialog((prev) => ({ ...prev, open }))}
        workplace={poolEditDialog.workplace}
        date={poolEditDialog.date}
        shift={poolEditDialog.shift}
        busyEmployeeIds={poolEditDialog.date ? (busyCentralIdsByDate[poolEditDialog.date] || new Set()) : new Set()}
      />

      {/* Springerpool-Rotationen — assignment editor (pool planner) */}
      <RotationAssignmentDialog
        open={rotationAssignmentDialog.open}
        onOpenChange={(open) => {
          setRotationAssignmentDialog((prev) => ({ ...prev, open, defaultEmployeeId: null }));
        }}
        workplace={rotationAssignmentDialog.workplace}
        date={rotationAssignmentDialog.date}
        assignment={rotationAssignmentDialog.assignment}
        timeslotId={rotationAssignmentDialog.timeslotId}
        defaultEmployeeId={rotationAssignmentDialog.defaultEmployeeId}
      />

      {/* Springerpool-Rotationen — demand dialog (ward staff) */}
      <RotationDemandDialog
        open={rotationDemandDialog.open}
        onOpenChange={(open) => setRotationDemandDialog((prev) => ({ ...prev, open }))}
        workplace={rotationDemandDialog.workplace}
        dateStr={rotationDemandDialog.date}
        timeslot={rotationDemandDialog.timeslot}
        existingDemand={rotationDemandDialog.existingDemand}
      />
    </div>
  );
}
