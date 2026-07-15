import { useState, useMemo, useEffect, useRef, useCallback, type CSSProperties } from 'react';
import { useSearchParams } from 'react-router-dom';
import { flushSync } from 'react-dom';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import type { DragStart, BeforeCapture } from '@hello-pangea/dnd';
import { format, addDays, subDays, startOfWeek, isSameDay, startOfMonth, endOfMonth, addMonths, eachDayOfInterval, isValid } from 'date-fns';
import { de } from 'date-fns/locale';
import { ChevronLeft, ChevronRight, ChevronDown, Wand2, Loader2, Trash2, Eye, EyeOff, Layout, Calendar, LayoutList, StickyNote, AlertTriangle, Download, Undo, ExternalLink, X, Lock, Unlock, Settings2, Globe2, Filter, Check, ChevronsUpDown, ShieldCheck } from 'lucide-react';
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
import { db, api } from "@/api/client";
import type { Doctor, ShiftEntry, Workplace, WorkplaceTimeslot, WorkTimeModel, ScheduleBlock, WishRequest } from '@/types';
import type { CentralEmployee } from '@/types/master';
import { cn } from '@/lib/utils';
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { useAuth } from '@/components/AuthProvider';
import DraggableDoctor from './DraggableDoctor';
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
import ConflictPanelSheet from './ConflictPanelSheet';
import { useConflictScan } from '@/components/validation/useConflictScan';
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
import {
  withPanelPrefix,
  stripPanelPrefix,
  normalizeDraggableId,
  encodeScheduleTargetId,
  movePinnedSectionToEnd,
  parseAvailableDoctorId,
  parseSectionTabs,
  getInitialScheduleState,
  getDoctorShortLabel,
  normalizeChipSource,
  formatChipLabel,
  buildDoctorChipLabelMap,
  formatTimeslotTimeRange,
  formatMinutesAsTime,
  parseTimeToMinutes,
  mergePlannedIntervals,
  buildShiftInterval,
  getExpandedTimeslotRowLabel,
  getRowLabelPresentation,
  buildTimeslotSelectionOption,
  normalizeTimeslotSelection,
  applyTimeslotSelectionToUpdateData,
  getLateRotationIndicator,
  LateAvailabilityBadge,
  TimeslotSummaryHint,
} from './scheduleBoardHelpers';
import type { ScheduleViewMode, SectionTab } from './scheduleBoardHelpers';
import { useScheduleMutations } from './useScheduleMutations';
import { useDragHandlers } from './useDragHandlers';
import { useCellRenderers } from './useCellRenderers';
import { ScheduleBoardContext, type ScheduleBoardContextValue } from './ScheduleBoardContext';
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

const SECTION_CONFIG: Record<string, SectionStyle> = {
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

// ── Local type definitions ──────────────────────────────────────────

interface SectionStyle {
  headerColor: string;
  rowColor: string;
}

interface SectionConfigEntry extends SectionStyle {
  rows?: string[];
}

interface UndoAction {
  type: string;
  id?: string;
  ids?: string[];
  data?: unknown;
}

type UndoStackEntry = UndoAction | UndoAction[];

interface RowQualFilter {
  key: string;
  sourceName: string;
  workplaceId: string;
  requiredIds: string[];
  optionalIds: string[];
  discouragedIds: string[];
  excludeIds: string[];
}

interface RotationAssignmentDialogState {
  open: boolean;
  workplace: Workplace | null;
  date: string | null;
  assignment: { id: string; employee_id?: string; employee_name?: string; note?: string } | null;
  timeslotId: string | null;
  defaultEmployeeId: string | null;
}

interface RotationDemandDialogState {
  open: boolean;
  workplace: { id: string; name: string; group_id: number | string } | null;
  date: string | null;
  timeslot: { id: string; label: string } | null;
  existingDemand: { id: string; status: string; note?: string } | null;
}

interface PoolEditDialogState {
  open: boolean;
  workplace: { id: string; name: string; group_id: number | string } | null;
  date: string | null;
  shift: ShiftEntry | null;
}

interface TimeslotOption {
  id: string;
  label: string;
  startTime: string;
  endTime: string;
  breakMinutes: number;
  isCustom?: boolean;
}

interface TimeslotSelectionDialogState {
  open: boolean;
  workplaceName: string;
  description: string;
  options: TimeslotOption[];
  allowCustomEditing: boolean;
  customEndMinutesByOptionId: Record<string, number>;
  customStartMinutesByOptionId: Record<string, number>;
  activeTimeslotId: string | null;
}

interface BlockContextMenuState {
  x: number;
  y: number;
  dateStr: string;
  position: string;
  timeslotId?: string | null;
  existingBlock?: ScheduleBlock | null;
  existingInfo?: ScheduleBlock | null;
}

interface PoolShift {
  shared_workplace_id?: string;
  date: string;
  employee_id?: string;
  affects_availability?: boolean;
  auto_off?: boolean;
  workplace_category?: string;
}

interface VisiblePoolShiftsResponse {
  shifts: PoolShift[];
  workplaces: Workplace[];
}

interface LinkedWorkplacePartner {
  tenant_id: string;
  workplace_name: string;
  tenant_name: string;
  shifts: Array<{
    date: string;
    doctor_name: string;
    start_time: string;
    end_time: string;
  }>;
}

interface VisibleWorkplaceLinksResponse {
  linkedWorkplaces: Record<string, LinkedWorkplacePartner[]>;
  tenantId: string | null;
}

interface RotationAssignment {
  id: string;
  rotation_workplace_id: string;
  date: string;
  employee_id: string;
  employee_name?: string;
  group_id: string | number;
  timeslot_id?: string | null;
}

interface RotationDemand {
  id: string;
  rotation_workplace_id: string;
  date: string;
  timeslot_id?: string | null;
  status: string;
  return_requested_assignment_id?: string;
  offered_employee_id?: string;
  offered_employee_name?: string;
}

interface RotationWorkplace {
  id: string;
  name: string;
  group_id: number | string;
  canWrite: boolean;
  timeslots_enabled?: boolean;
  timeslots?: Array<{ id: string; label: string; start_time: string; end_time: string }>;
}

interface VisibleRotationsResponse {
  workplaces: RotationWorkplace[];
  assignments: RotationAssignment[];
  demands: RotationDemand[];
}

interface PartialBulkError extends Error {
  failedIds?: string[];
  partial?: boolean;
}

interface AugmentedDoctor extends Doctor {
  effectiveFte?: number;
  isAvailable?: boolean;
  availabilityReason?: string;
}

export default function ScheduleBoard() {
    const [searchParams] = useSearchParams();
    const initialState = useMemo(() => getInitialScheduleState(searchParams), [searchParams]);
    const isEmbeddedSchedule = useMemo(() => {
            return searchParams.get('embeddedSchedule') === '1';
    }, [searchParams]);
  // const { isReadOnly } = useAuth(); // Removed duplicate destructuring
  const isMobile = useIsMobile();
    const [currentDate, setCurrentDate] = useState(initialState.currentDate);
    const [viewMode, setViewMode] = useState<ScheduleViewMode>(initialState.viewMode);
    const isMonthView = viewMode === 'month';
  const [isGenerating, setIsGenerating] = useState(false);
  const [isCtrlPressed, setIsCtrlPressed] = useState(false);
  const [undoStack, setUndoStack] = useState<UndoStackEntry[]>([]);

  // Cell-lock to prevent race conditions during rapid drag-drops
  // Keys are "date|position" or "date|position|timeslot_id", values are timestamps
  const cellLocksRef = useRef<Set<string>>(new Set());
  const lockCell = (date: string, position: string, timeslotId?: string): boolean => {
    const key = timeslotId ? `${date}|${position}|${timeslotId}` : `${date}|${position}`;
    if (cellLocksRef.current.has(key)) return false; // Already locked
    cellLocksRef.current.add(key);
    // Auto-release after 3 seconds (safety net)
    setTimeout(() => cellLocksRef.current.delete(key), 3000);
    return true;
  };
  const unlockCell = (date: string, position: string, timeslotId?: string): void => {
    const key = timeslotId ? `${date}|${position}|${timeslotId}` : `${date}|${position}`;
    cellLocksRef.current.delete(key);
  };

  const handleUndo = async () => {
      if (undoStack.length === 0) return;
      const item = undoStack[undoStack.length - 1];
      
      // Remove from stack immediately
      setUndoStack((prev) => prev.slice(0, -1));

      const actions = Array.isArray(item) ? item : [item];

      try {
          for (const action of actions) {
              if (action.type === 'DELETE') {
                  await db.ShiftEntry.delete(action.id!);
              } else if (action.type === 'CREATE') {
                  await db.ShiftEntry.create(action.data as Record<string, unknown>);
              } else if (action.type === 'UPDATE') {
                  await db.ShiftEntry.update(action.id!, action.data as Record<string, unknown>);
              } else if (action.type === 'BULK_CREATE') {
                  await db.ShiftEntry.bulkCreate(action.data as Record<string, unknown>[]);
              } else if (action.type === 'BULK_DELETE') {
                  await Promise.all(action.ids!.map((id) => db.ShiftEntry.delete(id)));
              }
          }
          queryClient.invalidateQueries({ queryKey: ['shifts'] });
      } catch (e) {
          console.error("Undo failed", e);
          alert("Rückgängig fehlgeschlagen: " + (e instanceof Error ? e.message : String(e)));
      }
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Control') setIsCtrlPressed(true);
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
          e.preventDefault();
          handleUndo();
      }
    };
    const handleKeyUp = (e: KeyboardEvent): void => {
      if (e.key === 'Control') setIsCtrlPressed(false);
    };
    const handleBlur = () => { setIsCtrlPressed(false); };

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
  
  const [hiddenRows, setHiddenRows] = useState<string[]>(() => {
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

  const [collapsedSections, setCollapsedSections] = useState<string[]>(() => {
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

    // Admin feature: double-click a doctor in sidebar to highlight their shifts in the week plan
    const [selectedDoctorId, setSelectedDoctorId] = useState<string | null>(null);
    const isAdmin = user?.role === 'admin';
    const handleDoctorDoubleClick = useCallback((doctorId: string) => {
        setSelectedDoctorId(prev => prev === doctorId ? null : doctorId);
    }, []);

    const [selectedQualificationIds, setSelectedQualificationIds] = useState<string[]>([]);
    const [scheduleFilterOpen, setScheduleFilterOpen] = useState(false);
    // Single active row-scoped qualification filter. Replacing it on a different
    // row; clicking the same row's filter icon again clears it.
    const [rowQualFilter, setRowQualFilter] = useState<RowQualFilter | null>(null);
    // { key, sourceName, workplaceId, includeIds, excludeIds } | null

  // Sync with user profile when it loads/updates
      useEffect(() => {
      if (user?.collapsed_sections && Array.isArray(user.collapsed_sections)) {
          setCollapsedSections((prev) => {
              // Only update if significantly different to avoid overwriting local interactions during sync
              if (JSON.stringify(prev) !== JSON.stringify(user.collapsed_sections)) {
                  return user.collapsed_sections as string[];
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
          updateMe({ highlight_my_name: highlightMyName }).catch((e) => { console.error("Pref save failed", e); });
      }
  }, [highlightMyName, updateMe, user]);

  useEffect(() => {
      localStorage.setItem('radioplan_showInitialsOnly', JSON.stringify(showInitialsOnly));
      if (user && user.schedule_initials_only !== showInitialsOnly) {
          updateMe({ schedule_initials_only: showInitialsOnly }).catch((e) => { console.error("Pref save failed", e); });
      }
  }, [showInitialsOnly, updateMe, user]);

  useEffect(() => {
      localStorage.setItem('radioplan_sortDoctorsAlphabetically', JSON.stringify(sortDoctorsAlphabetically));
      if (user && user.schedule_sort_doctors_alphabetically !== sortDoctorsAlphabetically) {
          updateMe({ schedule_sort_doctors_alphabetically: sortDoctorsAlphabetically }).catch((e) => { console.error("Pref save failed", e); });
      }
  }, [sortDoctorsAlphabetically, updateMe, user]);

  useEffect(() => {
      localStorage.setItem('radioplan_showSidebarTimeAccount', JSON.stringify(showSidebarTimeAccount));
      if (user && user.schedule_show_time_account !== showSidebarTimeAccount) {
          updateMe({ schedule_show_time_account: showSidebarTimeAccount }).catch((e) => { console.error("Pref save failed", e); });
      }
  }, [showSidebarTimeAccount, updateMe, user]);

  const sortDoctorsForDisplay = (doctorList: Doctor[] = []): Doctor[] => {
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
          setHiddenRows((prev) => {
              if (JSON.stringify(prev) !== JSON.stringify(user.schedule_hidden_rows)) {
                  return user.schedule_hidden_rows as string[];
              }
              return prev;
          });
      }
  }, [user]);

  // Save settings on change
  useEffect(() => {
      localStorage.setItem('radioplan_showSidebar', JSON.stringify(showSidebar));
      if (user && user.schedule_show_sidebar !== showSidebar) {
          updateMe({ schedule_show_sidebar: showSidebar }).catch((e) => { console.error("Pref save failed", e); });
      }
  }, [showSidebar, updateMe, user]);

  useEffect(() => {
      localStorage.setItem('radioplan_hiddenRows', JSON.stringify(hiddenRows));
      if (user && JSON.stringify(user.schedule_hidden_rows) !== JSON.stringify(hiddenRows)) {
          updateMe({ schedule_hidden_rows: hiddenRows }).catch((e) => { console.error("Pref save failed", e); });
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
             updateMe({ collapsed_sections: collapsedSections }).catch((e) => { console.error("Pref save failed", e); });
          }
      }
  }, [collapsedSections, updateMe, user]);

    const dragAutoScrollerOptions = useMemo(() => ({
        startFromPercentage: 0.12,
        maxScrollAtPercentage: 0.04,
        maxPixelScroll: 30,
            ease: (value: number) => value,
    }), []);

  useEffect(() => {
      localStorage.setItem('radioplan_gridFontSize', JSON.stringify(gridFontSize));
  }, [gridFontSize]);
    const effectiveGridFontSize = isMonthView ? Math.min(gridFontSize, 11) : gridFontSize;
    const shiftBoxSize = isMonthView ? Math.max(effectiveGridFontSize * 2.8, 30) : effectiveGridFontSize * 3.5;
  const [previewShifts, setPreviewShifts] = useState<ShiftEntry[] | null>(null);
    const [, setPreviewCategories] = useState<string[] | null>(null); // welche Kategorien im Vorschau
  const [draggingDoctorId, setDraggingDoctorId] = useState<string | null>(null);
  const [draggingShiftId, setDraggingShiftId] = useState<string | null>(null);
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
    select: (data: Doctor[]) => [...data].sort((a, b) => {
      const roleDiff = (rolePriority[a.role ?? ''] ?? 99) - (rolePriority[b.role ?? ''] ?? 99);
      if (roleDiff !== 0) return roleDiff;
      return (a.order || 0) - (b.order || 0);
    }),
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

  const { data: allShifts = [] as any } = useQuery({
    queryKey: ['shifts', fetchRange.start, fetchRange.end],
    queryFn: () => db.ShiftEntry.filter({
        date: { $gte: fetchRange.start, $lte: fetchRange.end }
    }),
    placeholderData: keepPreviousData,
    staleTime: 30 * 1000, // 30 seconds cache
  });

    const { data: visiblePoolData } = useQuery<VisiblePoolShiftsResponse>({
        queryKey: ['pool', 'visible-shifts', fetchRange.start, fetchRange.end],
        queryFn: () => api.getVisiblePoolShifts({ from: fetchRange.start, to: fetchRange.end }) as Promise<VisiblePoolShiftsResponse>,
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
    const { data: visibleWorkplaceLinksData } = useQuery<VisibleWorkplaceLinksResponse>({
        queryKey: ['workplace-links', 'visible-links', fetchRange.start, fetchRange.end],
        queryFn: () => api.getVisibleWorkplaceLinks({ from: fetchRange.start, to: fetchRange.end }) as Promise<VisibleWorkplaceLinksResponse>,
        enabled: viewMode === 'day' || viewMode === 'week',
        staleTime: 30 * 1000,
        refetchOnWindowFocus: false,
        placeholderData: keepPreviousData,
    });

    const linkedWorkplacesByName = visibleWorkplaceLinksData?.linkedWorkplaces || {};
    const activeLinkTenantId = visibleWorkplaceLinksData?.tenantId || null;

    // ===== Springerpool-Rotationen (separates System) =====
    const { data: visibleRotationData } = useQuery<VisibleRotationsResponse>({
        queryKey: ['rotations', 'visible-rotations', fetchRange.start, fetchRange.end],
        queryFn: () => api.getVisibleRotations({ from: fetchRange.start, to: fetchRange.end }) as Promise<VisibleRotationsResponse>,
        staleTime: 30 * 1000,
        refetchOnWindowFocus: false,
        placeholderData: keepPreviousData,
    });

    const rotationWorkplaces = visibleRotationData?.workplaces || [];
    const rotationAssignments = visibleRotationData?.assignments || [];
    const rotationDemands = visibleRotationData?.demands || [];

    // Map assignments by `${rotation_workplace_id}|${date}` for fast cell lookup.
    const rotationAssignmentsByCell = useMemo(() => {
        const map = new Map<string, RotationAssignment[]>();
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
        const map = new Map<string, RotationDemand>();
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
    const [rotationAssignmentDialog, setRotationAssignmentDialog] = useState<RotationAssignmentDialogState>({ open: false, workplace: null, date: null, assignment: null, timeslotId: null, defaultEmployeeId: null });
    const [rotationDemandDialog, setRotationDemandDialog] = useState<RotationDemandDialogState>({
        open: false,
        workplace: null,
        date: null,
        timeslot: null,
        existingDemand: null,
    });

    // Set of Springer chip IDs the user has dragged away from the Verfügbar row.
    // These are hidden until the page is refreshed (they remain in rotation_assignments).
    const [hiddenSpringerChipIds, setHiddenSpringerChipIds] = useState<Set<string>>(new Set());

    // Set of `${doctorId}|${dateStr}` for ward employees that have been
    // offered as Joker to the pool. Hides the doctor chip from the
    // Verfügbar row until the page is refreshed.
    const [hiddenJokerDoctorIds, setHiddenJokerDoctorIds] = useState<Set<string>>(new Set());

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
    const [poolEditDialog, setPoolEditDialog] = useState<PoolEditDialogState>({ open: false, workplace: null, date: null, shift: null });
    const pendingTimeslotSelectionRef = useRef<((selection: any) => void) | null>(null);
    const [timeslotSelectionDialog, setTimeslotSelectionDialog] = useState<TimeslotSelectionDialogState>({
        open: false,
        workplaceName: '',
        description: '',
        options: [],
        allowCustomEditing: false,
        customEndMinutesByOptionId: {},
        customStartMinutesByOptionId: {},
        activeTimeslotId: null,
    });

    const openPoolEditDialog = (workplace: any, dateStr: string, shift: ShiftEntry | null = null): void => {
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

    const handleTimeslotDialogOpenChange = (open: boolean): void => {
        if (!open) {
            closeTimeslotSelectionDialog();
        }
    };

    const handleTimeslotDialogSelect = (timeslotId: string): void => {
        const callback = pendingTimeslotSelectionRef.current;
        closeTimeslotSelectionDialog();
        callback?.(timeslotId);
    };

    const handleTimeslotCustomEndChange = (timeslotId: string, option: any, value: string): void => {
        // Nur den reinen Minutenwert parsen, OHNE die start+5min-Floor-Logik.
        // Die Floor-Logik in normalizeCustomTimeslotEndMinutes würde sonst
        // während des Tippens einen Zwischenwert (z. B. Browser liefert "01:00"
        // bei Eingabe von "1") auf start+5min hochclampen und das Feld zurücksetzen.
        const parsedMinutes = parseTimeToMinutes(value);
        if (!Number.isFinite(parsedMinutes)) return;

        setTimeslotSelectionDialog((current: any) => ({
            ...current,
            customEndMinutesByOptionId: {
                ...current.customEndMinutesByOptionId,
                [timeslotId]: parsedMinutes,
            },
        }));
    };

    const handleTimeslotCustomStartChange = (timeslotId: string, option: any, value: string): void => {
        const parsedMinutes = parseTimeToMinutes(value);
        if (!Number.isFinite(parsedMinutes)) return;

        const normalizedStartMinutes = normalizeCustomTimeslotStartMinutes(option, value);

        setTimeslotSelectionDialog((current: any) => ({
            ...current,
            customStartMinutesByOptionId: {
                ...current.customStartMinutesByOptionId,
                [timeslotId]: normalizedStartMinutes,
            },
        }));
    };

    const handleTimeslotCustomApply = (option: any): void => {
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
        const map: Record<string, Set<string>> = {};
        const add = (dateStr: any, centralId: any) => {
            const key = String(dateStr).slice(0, 10);
            if (!map[key]) map[key] = new Set();
            map[key].add(String(centralId));
        };
        const nextWorkdayIso = (dateStr: any) => {
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
    placeholderData: keepPreviousData,
  });

  const { data: workplaces = [] } = useQuery<Workplace[]>({
    queryKey: ['workplaces'],
    queryFn: () => db.Workplace.list(),
    staleTime: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  // Timeslots für Zeitfenster-Feature
  const { data: workplaceTimeslots = [] } = useQuery<WorkplaceTimeslot[]>({
    queryKey: ['workplaceTimeslots'],
    queryFn: () => db.WorkplaceTimeslot.list(),
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

                workplaceTimeslots.forEach((timeslot: any) => {
                        const key = timeslot.workplace_id;
                        const list = map.get(key) || [];
                        list.push(timeslot);
                        map.set(key, list);
                });

                map.forEach((list: any, key: any) => {
                        map.set(key, [...list].sort((a: any, b: any) => (a.order || 0) - (b.order || 0)));
                });

                return map;
        }, [workplaceTimeslots]);

    const sectionTabs = useMemo(() => {
        const tabSetting = systemSettings.find((s) => s.key === SECTION_TABS_KEY);
        return parseSectionTabs(tabSetting?.value);
    }, [systemSettings]);

    const alwaysVisibleRows = useMemo(() => {
        const setting = systemSettings.find((s) => s.key === ALWAYS_VISIBLE_ROWS_KEY);
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
  const { data: workTimeModels = [] } = useQuery<WorkTimeModel[]>({
    queryKey: ['workTimeModels'],
    queryFn: async () => {
      const res = await api.request('/api/staff/work-time-models') as { models: WorkTimeModel[] };
      return res.models || [];
    },
    staleTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  // Lookup: work_time_model_id → { name, hours_per_week, hours_per_day }
  const workTimeModelMap = useMemo(() => {
    const map = new Map<string, WorkTimeModel>();
    for (const m of workTimeModels) {
      map.set(m.id, m);
    }
    return map;
  }, [workTimeModels]);

    const { data: centralEmployees = [] } = useQuery<CentralEmployee[]>({
        queryKey: ['tenant-central-employees-for-schedule'],
        queryFn: async () => {
            try {
                const res = await api.request('/api/staff/central-employees') as { employees: CentralEmployee[] };
                return res.employees || [];
            } catch {
                return [];
            }
        },
        staleTime: 10 * 60 * 1000,
        refetchOnWindowFocus: false,
    });

    const centralEmployeesById = useMemo(() => {
        const map = new Map<string, CentralEmployee>();
        for (const employee of centralEmployees) {
            map.set(String(employee.id), employee);
        }
        return map;
    }, [centralEmployees]);


    const allSections = useMemo(() => {
      // Get custom categories from settings
            const customCategories = getWorkplaceCategoriesFromSettings(systemSettings);
            const customCategoryNames = customCategories.map((category: any) => category.name);

      // Hilfsfunktion: Erstellt Zeilen für Arbeitsplätze (kompakt mit optionalen Timeslot-Metadaten)
      const createRowsForCategory = (categoryName: any) => {
          const categoryWorkplaces = workplaces
              .filter((w: any) => w.category === categoryName)
              .sort((a: any, b: any) => (a.order || 0) - (b.order || 0));
          
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
                          .map((timeslot: any) => {
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
                          allTimeslotIds: wpTimeslots.map((t: any) => t.id),
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

      const dynamicRows: Record<string, any[]> = {
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
          (dynamicRows["Dienste"] as any).push({
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
      const staticRowsToObjects = (rows: any) => rows.map((name: any) => ({ 
          name, displayName: name, timeslotId: null, isTimeslotRow: false 
      }));

      // Find Orphaned Positions - jetzt mit Namen aus dynamicRows
      const allKnownPositions = new Set([
          ...STATIC_SECTIONS["Anwesenheiten"].rows,
          ...STATIC_SECTIONS["Abwesenheiten"].rows,
          ...dynamicRows["Dienste"].map((r: any) => r.name),
          ...dynamicRows["Rotationen"].map((r: any) => r.name),
          ...dynamicRows["Demonstrationen & Konsile"].map((r: any) => r.name),
          ...(dynamicRows["Pool-Rotationen"] || []).map((r: any) => r.name),
          ...customCategoryNames.flatMap((categoryName: any) => (dynamicRows[categoryName] || []).map((r: any) => r.name)),
          ...STATIC_SECTIONS["Sonstiges"].rows
      ]);

      const currentViewShifts = previewShifts 
          ? [...allShifts, ...previewShifts]
          : allShifts;

      // We only care about shifts in the current view range roughly, but better to check all loaded shifts
      const orphanedPositions = Array.from(new Set(
          currentViewShifts
              .map((s: any) => s.position)
              .filter((p: any) => !allKnownPositions.has(p))
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
          ...customCategoryNames.map((categoryName: any) => ({
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
          .map((title: any) => defaultSections.find((s: any) => s.title === title))
          .filter(Boolean);
      
      // Add any sections that are new and not yet in the order
      for (const section of defaultSections) {
          if (!result.find((r: any) => r.title === section.title)) {
              // Insert before "Sonstiges" if possible, otherwise at end
              const sonstigesIdx = result.findIndex((r: any) => r.title === "Sonstiges");
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
        const knownTitles = new Set(allSections.map((s: any) => s.title));
        return sectionTabs.filter((tab: any) => knownTitles.has(tab.sectionTitle) && tab.sectionTitle !== PINNED_SECTION_TITLE);
    }, [sectionTabs, allSections]);

    const renderedSections = useMemo<any[]>(() => {
        return applyAlwaysVisibleRowsToSections(allSections as any, alwaysVisibleRows);
    }, [allSections, alwaysVisibleRows]);

    useEffect(() => {
        if (isLoadingSystemSettings) return;
        if (activeSectionTabId === 'main') return;
        if (!availableSectionTabs.find((t: any) => t.id === activeSectionTabId)) {
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

        if (splitSectionTabId && !availableSectionTabs.some((t: any) => t.id === splitSectionTabId)) {
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
    const effectiveSplitTabId = availableSectionTabs.some((t: any) => t.id === splitSectionTabId)
        ? splitSectionTabId
        : (availableSectionTabs[0]?.id || '');

    const splitSections = useMemo(() => {
        if (!isSplitViewEnabled || !effectiveSplitTabId) return [];
        const activeTab = availableSectionTabs.find((t: any) => t.id === effectiveSplitTabId);
        if (!activeTab) return [];
        const activeSection = renderedSections.find((section: any) => section.title === activeTab.sectionTitle);
        const pinnedSection = renderedSections.find((section: any) => section.title === PINNED_SECTION_TITLE);
        if (!activeSection) return [];
        if (!pinnedSection || activeSection.title === PINNED_SECTION_TITLE) return [activeSection];
        return [activeSection, pinnedSection];
    }, [isSplitViewEnabled, effectiveSplitTabId, availableSectionTabs, renderedSections]);

    const sections = useMemo(() => {
        if (activeSectionTabId === 'main') {
            const assigned = new Set(availableSectionTabs.map((t: any) => t.sectionTitle));
            return renderedSections.filter((section: any) => section.title === PINNED_SECTION_TITLE || !assigned.has(section.title));
        }
        const activeTab = availableSectionTabs.find((t: any) => t.id === activeSectionTabId);
        if (!activeTab) return renderedSections;
        const activeSection = renderedSections.find((section: any) => section.title === activeTab.sectionTitle);
        const pinnedSection = renderedSections.find((section: any) => section.title === PINNED_SECTION_TITLE);
        if (!activeSection) return renderedSections;
        if (!pinnedSection || activeSection.title === PINNED_SECTION_TITLE) return [activeSection];
        return [activeSection, pinnedSection];
    }, [activeSectionTabId, availableSectionTabs, renderedSections]);

    const persistSectionTabs = async (tabs: SectionTab[]): Promise<void> => {
        await (updateSystemSettingMutation.mutateAsync as any)({
            key: SECTION_TABS_KEY,
            value: JSON.stringify(tabs)
        });
    };

    const handleMoveSectionToTab = async (sectionTitle: string): Promise<void> => {
        if (sectionTitle === PINNED_SECTION_TITLE) {
            toast.info(`"${getSectionName(PINNED_SECTION_TITLE)}" bleibt immer im Hauptplan enthalten`);
            return;
        }
        const existing = availableSectionTabs.find((t: any) => t.sectionTitle === sectionTitle);
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

    const handleCloseSectionTab = async (tabId: string): Promise<void> => {
        const nextTabs = sectionTabs.filter((t: any) => t.id !== tabId);
        try {
            await persistSectionTabs(nextTabs);
            if (activeSectionTabId === tabId) {
                setActiveSectionTabId('main');
            }
        } catch {
            toast.error('Reiter konnte nicht entfernt werden');
        }
    };

    const handleOpenSectionTabInNewWindow = (tabId: string): void => {
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

    const handleOpenSectionTabInSplitView = (tabId: string): void => {
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

    const getDoctorChipLabel = useMemo(() => (doctor: Doctor | undefined): string => {
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
    placeholderData: keepPreviousData,
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

  const getScheduleBlock = (dateStr: string, position: string, timeslotId?: string): ScheduleBlock | undefined => {
    if (timeslotId) {
      return scheduleBlocksMap.get(`${dateStr}|${position}|${timeslotId}`) || scheduleBlocksMap.get(`${dateStr}|${position}`);
    }
    return scheduleBlocksMap.get(`${dateStr}|${position}`);
  };

  const getScheduleInfo = (dateStr: string, position: string, timeslotId?: string): ScheduleBlock | undefined => {
    if (timeslotId) {
      return scheduleInfoMap.get(`${dateStr}|${position}|${timeslotId}`) || scheduleInfoMap.get(`${dateStr}|${position}`);
    }
    return scheduleInfoMap.get(`${dateStr}|${position}`);
  };

        const { validate, shouldCreateAutoFrei, findAutoFreiToCleanup, isAutoOffPosition, checkCrossTenantConflicts, validator } = useShiftValidation(allShifts, {
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
        const raw = systemSettings.find((s) => s.key === 'availability_thresholds')?.value;
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

    const toggleScheduleQualification = (qid: string): void => {
        setSelectedQualificationIds((current) => (
            current.includes(qid)
                ? current.filter((id) => id !== qid)
                : [...current, qid]
        ));
    };

    const matchesScheduleQualificationFilter = useCallback((doctor: Doctor): boolean => {
        if (selectedQualificationIds.length === 0) return true;
        const ids = getDoctorQualIds(doctor.id);
        return selectedQualificationIds.some((qid) => ids.includes(qid));
    }, [selectedQualificationIds, getDoctorQualIds]);

    // Row-scoped qualification filter: Pflicht (AND), Sollte (OR), Sollte-nicht
    // (soft exclude with empty-candidate fallback), Nicht (hard AND-NOT).
    // AND-combined with the global schedule filter.
    const matchesRowQualificationFilter = useCallback((doctor: Doctor): boolean => {
        if (!rowQualFilter) return true;
        const ids = getDoctorQualIds(doctor.id);
        const doctorList = doctors.map((d) => ({
            id: d.id,
            qualification_ids: getDoctorQualIds(d.id),
        }));
        return (matchesRowQualFilter as any)(
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

    const matchesAllQualificationFilters = useCallback((doctor: Doctor): boolean => {
        return matchesScheduleQualificationFilter(doctor) && matchesRowQualificationFilter(doctor);
    }, [matchesScheduleQualificationFilter, matchesRowQualificationFilter]);

    // Build (or toggle off) the row-scoped filter for a given row.
    const applyRowQualificationFilter = useCallback((rowName: any, rowTimeslotId: any, rowWorkplace: any) => {
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
  } = useOverrideValidation({ user: user as any, doctors });

  const getRoleColor = useMemo(() => (role: any): { backgroundColor: string; color: string } => {
      const setting = colorSettings.find((s) => s.name === role && s.category === 'role');
      if (setting) return { backgroundColor: setting.bg_color ?? '#ffffff', color: setting.text_color ?? '#000000' };
      if (DEFAULT_COLORS.roles[role]) return { backgroundColor: DEFAULT_COLORS.roles[role].bg, color: DEFAULT_COLORS.roles[role].text };
      return { backgroundColor: '#f3f4f6', color: '#1f2937' }; // Default gray
  }, [colorSettings]);

  // Helper to mix tailwind default and custom style
  const getSectionStyle = useMemo(() => (sectionTitle: string): any => {
      const setting = colorSettings.find((s) => s.name === sectionTitle && s.category === 'section');
      if (setting) {
          return { 
              header: { backgroundColor: setting.bg_color, color: setting.text_color },
              row: { backgroundColor: setting.bg_color + '4D' } 
          };
      }
      return null;
  }, [colorSettings]);

  const getRowStyle = useMemo(() => (rowName: string, sectionStyle: SectionStyle): CSSProperties => {
      // Check for specific position color
      const setting = colorSettings.find((s) => s.name === rowName && s.category === 'position');
      if (setting) {
          return { 
              backgroundColor: (setting.bg_color ?? '#ffffff') + '33', // ~20% opacity
              color: setting.text_color ?? '#000000'
          };
      }
      // Fallback to section style
      if (sectionStyle) {
          return { backgroundColor: (sectionStyle as any).row.backgroundColor };
      }
      return {};
  }, [colorSettings]);

  // All mutations extracted to useScheduleMutations hook
  const mutations = useScheduleMutations({
    user,
    doctors: doctors ?? [],
    allShifts: allShifts ?? [],
    wishes: wishes ?? [],
    fetchRange,
    setUndoStack,
    unlockCell,
    systemSettings: systemSettings ?? [],
    queryClient,
  });
  const {
    updateDoctorMutation,
    updateSystemSettingMutation,
    createShiftMutation,
    bulkCreateShiftsMutation,
    updateShiftMutation,
    createAutoFreiMutation,
    updateAutoFreiMutation,
    deleteShiftMutation,
    bulkDeleteMutation,
    createNoteMutation,
    updateNoteMutation,
    deleteNoteMutation,
    createBlockMutation,
    deleteBlockMutation,
    createInfoMutation,
    deleteInfoMutation,
  } = mutations;

  // Context menu state for cell blocking / info
  const [blockContextMenu, setBlockContextMenu] = useState<BlockContextMenuState | null>(null);
  const [blockReasonInput, setBlockReasonInput] = useState('');
  const [infoReasonInput, setInfoReasonInput] = useState('');

  const handleCellContextMenu = (e: MouseEvent, dateStr: string, position: string, timeslotId: string | null = null): void => {
    if (isReadOnly) return;
    e.preventDefault();
    const block = getScheduleBlock(dateStr, position, timeslotId ?? undefined);
    const info = getScheduleInfo(dateStr, position, timeslotId ?? undefined);
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
      const shiftsToDelete = currentWeekShifts.filter((s: any) => !protectedPositions.includes(s.position));
      
      if (shiftsToDelete.length === 0) return;
      
      if (window.confirm('Möchten Sie den Wochenplan bereinigen? (Abwesenheiten bleiben erhalten)')) {
          const ids = shiftsToDelete.map((s: any) => s.id);
          bulkDeleteMutation.mutate(ids);
      }
  };

  const handleClearDay = (date: Date): void => {
      const protectedPositions = ["Frei", "Krank", "Urlaub", "Dienstreise"];
      const dateStr = format(date, 'yyyy-MM-dd');
      const shiftsToDelete = currentWeekShifts.filter((s: any) => 
          s.date === dateStr && !protectedPositions.includes(s.position)
      );
      
      if (shiftsToDelete.length === 0) return;

      if (window.confirm(`Möchten Sie die Dienste für ${format(date, 'EEEE', { locale: de })} löschen? (Abwesenheiten bleiben erhalten)`)) {
          const ids = shiftsToDelete.map((s: any) => s.id);
          bulkDeleteMutation.mutate(ids);
      }
  };

  const handleClearRow = (rowName: string, timeslotId: string | null = null): void => {
      const shiftsToDelete = currentWeekShifts.filter((s: any) => {
          if (s.position !== rowName) return false;
          if (timeslotId) return s.timeslot_id === timeslotId;
          return true;
      });
      
      if (shiftsToDelete.length === 0) return;

      const displayName = timeslotId 
          ? `${rowName} (Zeitfenster)` 
          : rowName;

      if (window.confirm(`Möchten Sie alle Einträge in der Zeile "${displayName}" für diese Woche löschen?`)) {
          const ids = shiftsToDelete.map((s: any) => s.id);
          bulkDeleteMutation.mutate(ids);
      }
  };

  const [isExporting, setIsExporting] = useState(false);
  const [isConflictSheetOpen, setIsConflictSheetOpen] = useState(false);

  const absencePositions = ["Frei", "Krank", "Urlaub", "Dienstreise", "Nicht verfügbar"];

  // Synchrone Konfliktprüfung (nur für Voice-Commands)
  const checkConflictsVoice = (doctorId: string, dateStr: string, newPosition: string, excludeShiftId: string | null = null): boolean => {
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
  const checkConflictsWithOverride = async (doctorId: string, dateStr: string, newPosition: string, excludeShiftId: string | null = null, onProceed: (() => void) | null = null): Promise<boolean> => {
      const result = validate(doctorId, dateStr, newPosition, { excludeShiftId });
      const doctor = doctors.find((d) => d.id === doctorId);

      // Prüfen, ob ein Rotationskonflikt vorliegt
      const isRotationConflict = result.blockers.some(
          (b) => typeof b === 'string' && b.includes('Rotation')
      );
      
      // Bei Blockern: Override-Dialog anzeigen
      if (result.blockers.length > 0) {
          // Bei Rotationskonflikt: onProceed so wrappen, dass die Rotation vorher entfernt wird
          const wrappedOnConfirm = isRotationConflict && onProceed
              ? () => {
                    const rotationPositions = new Set(
                        workplaces
                            .filter((w: any) => w.category === 'Rotationen')
                            .map((w: any) => w.name)
                    );
                    const rotationShift = allShifts.find(
                        (s: any) =>
                            s.date === dateStr &&
                            s.doctor_id === doctorId &&
                            rotationPositions.has(s.position)
                    );
                    if (rotationShift) {
                        deleteShiftMutation.mutate(rotationShift.id);
                    }
                    onProceed();
                }
              : onProceed;
          requestOverride({
              blockers: result.blockers,
              warnings: result.warnings,
              doctorId,
              doctorName: doctor?.name,
              date: dateStr,
              position: newPosition,
              onConfirm: wrappedOnConfirm as any
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
              const names = [...new Set(crossConflicts.map((c: any) => c.related_employee_name))].join(', ');
              requestOverride({
                  blockers: [`Dienstkonflikt (mandantenübergreifend): „${names}" hat eine Beziehung mit aktiviertem Dienstkonflikt und ist am selben Tag in einem anderen Mandanten ebenfalls für einen Dienst eingeteilt.`],
                  warnings: [],
                  doctorId,
                  doctorName: doctor?.name,
                  date: dateStr,
                  position: newPosition,
                  onConfirm: onProceed as any
              });
              return true; // Blockiert - warte auf Override-Bestätigung
          }
      }
      
      return false; // Nicht blockiert
  };

  // Legacy-Wrapper für Stellen die noch nicht umgestellt sind
  const checkConflicts = async (doctorId: string, dateStr: string, newPosition: string, isVoice: boolean = false, excludeShiftId: string | null = null): Promise<boolean> => {
      if (isVoice) {
          return checkConflictsVoice(doctorId, dateStr, newPosition, excludeShiftId);
      }
      // Für non-voice: verwende Override-Dialog ohne Callback
      return checkConflictsWithOverride(doctorId, dateStr, newPosition, excludeShiftId, null);
  };

  // Wrapper für Abwesenheits-spezifische Staffing-Prüfung
  const checkStaffing = (dateStr: string, doctorId: string): string | null => {
      const result = validate(doctorId, dateStr, 'Frei', {});
      return result.warnings.length > 0 ? result.warnings.join('\n') : null;
  };

  // Wrapper für Limit-Prüfung (jetzt nur Warnung)
  const checkLimits = (doctorId: string, dateStr: string, position: string): string | null => {
      const result = validate(doctorId, dateStr, position, {});
      const limitWarnings = result.warnings.filter((w: any) => w.includes('Dienstlimit'));
      return limitWarnings.length > 0 ? limitWarnings.join('\n') : null;
  };

  // Prüfung beim Drag in Abwesenheit: Warnung falls bestehende Einträge gelöscht werden
  // Kombiniert Dienst-Lösch-Warnung + Staffing-Check in einem Dialog
  const checkAbsenceDropConflicts = (doctorId: string, dateStr: string, position: string, onProceed: () => void, excludeShiftId: string | null = null): boolean => {
      const doctor = doctors.find((d) => d.id === doctorId);
      const shiftsToDelete = currentWeekShifts.filter((s: any) =>
          s.doctor_id === doctorId &&
          s.date === dateStr &&
          s.id !== excludeShiftId &&
          !absencePositions.includes(s.position)
      );

      // Staffing-Warnungen prüfen
      const result = validate(doctorId, dateStr, position, {});
      const staffingWarnings = result.warnings.filter((w: any) =>
          w.includes('Mindestbesetzung') || w.includes('anwesend')
      );

      if (shiftsToDelete.length === 0 && staffingWarnings.length === 0) {
          return false; // Kein Konflikt
      }

      const messages = [];
      if (shiftsToDelete.length > 0) {
          const entries = shiftsToDelete.map((s: any) => `"${s.position}"`).join(', ');
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

  const handleExportExcel = async (): Promise<void> => {
      setIsExporting(true);
      try {
          // Determine date range based on viewMode
          const startDate = weekDays[0];
          const endDate = weekDays[weekDays.length - 1];
          
          const data = await api.exportScheduleToExcel(
              format(startDate, 'yyyy-MM-dd'),
              format(endDate, 'yyyy-MM-dd'),
              hiddenRows
          ) as any;
          
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
          alert("Export fehlgeschlagen: " + (error instanceof Error ? error.message : "Unbekannter Fehler"));
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
    return Array.from({ length: 7 }).map((_: any, i: any) => addDays(start, i));
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
            doctors.filter((doc) => isDoctorAvailable(doc, checkDate, staffingPlanEntries))
        );
        }, [currentDate, doctors, sortDoctorsAlphabetically, staffingPlanEntries, viewMode, weekDays]);

    const sidebarDoctors = useMemo(() => {
        if (selectedQualificationIds.length === 0 && !rowQualFilter) return sidebarDoctorsAll;
        return sidebarDoctorsAll.filter(matchesAllQualificationFilters);
    }, [sidebarDoctorsAll, matchesAllQualificationFilters, selectedQualificationIds, rowQualFilter]);

    const getDoctorWithEffectiveFte = (doctor: Doctor, referenceDate: Date): Doctor => {
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
    
    const dbShifts = allShifts.filter((s: ShiftEntry) => {
      // Robust string comparison to avoid timezone issues
      return s.date >= startStr && s.date < endStr;
    });
    
    if (previewShifts) {
        // Add temporary IDs to preview shifts if they don't have them, to avoid key errors
        const formattedPreview = previewShifts.map((s, i: any) => ({
            ...s,
            id: s.id || `preview-${i}`,
            isPreview: true
        }));
        return [...dbShifts, ...formattedPreview];
    }
    
    return dbShifts;
  }, [allShifts, currentDate, previewShifts]);

  // ─── Conflict Scanner ────────────────────────────────────────────────
  const weekDayStrings = useMemo(() => weekDays.map((d: any) => format(d, 'yyyy-MM-dd')), [weekDays]);
  const doctorNamesMap = useMemo(() => {
      const map = new Map();
      for (const d of doctors) {
          map.set(d.id, d.name || `${(d as unknown as Record<string, unknown>).first_name || ''} ${(d as unknown as Record<string, unknown>).last_name || ''}`.trim() || d.id);
      }
      return map;
  }, [doctors]);
  const { conflicts, scan: scanConflicts, isScanning, clear: clearConflicts } = useConflictScan({
      validator,
      dateRange: weekDayStrings,
      doctorNames: doctorNamesMap,
  });

  // Build shift label map for resolve buttons
  const shiftLabelMap = useMemo(() => {
      const map = new Map();
      for (const s of currentWeekShifts) {
          if (!s.id) continue;
          const doc = doctorNamesMap.get(s.doctor_id || '') || '?';
          map.set(s.id, `${doc}: ${s.position}`);
      }
      return map;
  }, [currentWeekShifts, doctorNamesMap]);

  const handleOpenConflictSheet = useCallback((): void => {
      scanConflicts();
      setIsConflictSheetOpen(true);
  }, [scanConflicts]);

  const handleResolveShift = useCallback((shiftId: string): void => {
      if (!shiftId) return;
      deleteShiftMutation.mutate(shiftId, {
          onSuccess: () => {
              // Re-scan after deletion
              setTimeout(() => scanConflicts(), 300);
          },
      });
  }, [deleteShiftMutation, scanConflicts]);

        const currentWeekShiftLookup = useMemo(() => createScheduleShiftLookup(currentWeekShifts as Array<{ id: string; date: string; position: string; order?: number; timeslot_id?: string; doctor_id?: string }>), [currentWeekShifts]);

        const currentWeekShiftDates = useMemo(() => new Set(currentWeekShifts.map((shift: any) => shift.date)), [currentWeekShifts]);

        const currentWeekShiftPositionsByDate = useMemo(() => {
            const map = new Map();

            currentWeekShifts.forEach((shift: any) => {
                if (!shift?.date || !shift?.position) return;

                if (!map.has(shift.date)) {
                    map.set(shift.date, new Set());
                }
                map.get(shift.date).add(shift.position);
            });

            return map;
        }, [currentWeekShifts]);

        const doctorById = useMemo(() => new Map(doctors.map((doctor) => [doctor.id, doctor])), [doctors]);

        const workplaceByName = useMemo(() => new Map(workplaces.map((workplace: any) => [workplace.name, workplace])), [workplaces]);

    const getPositionTimeslotOptions = (positionName: string, doctorId: string | null = null): any[] => {
        const workplace = workplaceByName.get(positionName) as any;
        if (!workplace?.timeslots_enabled) return [];

        const baseDoctor = doctorId ? doctorById.get(doctorId) : null;
        const doctor = baseDoctor ? getDoctorWithEffectiveFte(baseDoctor, currentDate) : null;

        return ((workplaceTimeslotsByWorkplaceId as any).get((workplace).id) || []).map((timeslot: any) => ({
            ...buildTimeslotSelectionOption(timeslot, doctor as any, workplace, workTimeModelMap, centralEmployeesById),
        }));
    };

    const resolveTimeslotSelection = ({ positionName, dateStr = null, requestedTimeslotId = null, onResolved, doctorId = null, initialSelection = null, forceDialog = false, allowCustomEditing = false }: {
        positionName: string; dateStr?: string | null; requestedTimeslotId?: string | null; onResolved: (selection: any) => void; doctorId?: string | null; initialSelection?: any; forceDialog?: boolean; allowCustomEditing?: boolean;
    }): boolean => {
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

        if (options.length === 1 && !forceDialog) {
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
            customEndMinutesByOptionId: buildInitialCustomTimeslotEndMinutesByOption(options, initialSelection) as any,
            customStartMinutesByOptionId: buildInitialCustomTimeslotStartMinutesByOption(options, initialSelection) as any,
            activeTimeslotId: initialSelection?.timeslotId ?? null,
        });
        return false;
    };

    const handleShiftTimeslotEdit = (shift: ShiftEntry, doctor: Doctor, workplace: Workplace): void => {
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
            onResolved: (selection: any) => {
                const normalizedSelection = normalizeTimeslotSelection(selection);
                const nextTimeslotId = normalizedSelection.timeslotId;

                const duplicate = currentWeekShifts.some((entry: any) => {
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
                    const occupyingShift = currentWeekShifts.find((entry: any) => {
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
        doctors.forEach((doc: any) => {
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

        weekDays.forEach((day: any) => {
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
        const isWardTenant = rotationWorkplaces.length > 0 && rotationWorkplaces.every((wp: any) => wp.canWrite === false);
        if (!isWardTenant || rotationAssignments.length === 0) return map;

        // Assignments that already have an OPEN return-request must not be
        // draggable again (dragging would produce a 409 "already requested").
        const openReturnRequestAssignmentIds = new Set(
            rotationDemands
                .filter((d: any) => d.status === 'open' && d.return_requested_assignment_id)
                .map((d: any) => String(d.return_requested_assignment_id))
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
                .filter((assignment: any) => !openReturnRequestAssignmentIds.has(String(assignment.id)))
                .map((assignment: any) => {
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
        const isPoolTenant = rotationWorkplaces.length > 0 && rotationWorkplaces.some((wp: any) => wp.canWrite === true);
        if (!isPoolTenant) return map;

        for (const demand of rotationDemands) {
            if (demand.status !== 'fulfilled' || !demand.offered_employee_id) continue;
            const dateStr = demand.date;
            if (!dateStr) continue;
            // Skip if this Joker has already been assigned to a cell (the
            // rotation_assignment will block them in Verfügbar via the
            // availabilityBlockingDoctorIdsByDate mechanism).
            const alreadyAssigned = rotationAssignments.some(
                (a: any) => String(a.employee_id) === String(demand.offered_employee_id)
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
            const visibleSpringers = springerDocs.filter((d: any) =>
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

        currentWeekShifts.forEach((shift: any) => {
                if (!shift?.doctor_id || !shift?.date) return;
                const workplace = workplaces.find((entry: any) => entry.name === shift.position);
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

            const workplace = workplaces.find((wp: any) => wp.name === shift.position);
            if (workplace?.service_type === 2) continue;
            if (workplace?.affects_availability === false) continue;

            const groupKey = `${shift.doctor_id}__${shift.date}`;
            if (!shiftsByDoctorAndDate.has(groupKey)) {
                shiftsByDoctorAndDate.set(groupKey, []);
            }
            shiftsByDoctorAndDate.get(groupKey).push({ shift, workplace });
        }

        shiftsByDoctorAndDate.forEach((entries: any, groupKey: any) => {
            const [doctorId, dateStr] = groupKey.split('__');
            const baseDoctor = doctors.find((d) => d.id === doctorId);
            const doctor = baseDoctor ? getDoctorWithEffectiveFte(baseDoctor, dateStr) : null;
            const intervals = entries
                .map(({ shift, workplace }: any) => {
                    const timeslot = shift.timeslot_id
                        ? workplaceTimeslots.find((slot: any) => slot.id === shift.timeslot_id)
                        : null;
                    return buildShiftInterval(shift, doctor as any, workplace, timeslot, workTimeModelMap, centralEmployeesById);
                })
                .filter(Boolean);

            if (!intervals.length) return;

            const totalMinutes = mergePlannedIntervals(intervals);
            if (totalMinutes <= 0) return;

            map.set(doctorId, (map.get(doctorId) || 0) + (totalMinutes / 60));
        });

    return map;
    }, [currentWeekShifts, weekDays, doctors, workplaces, workplaceTimeslots, workTimeModelMap, centralEmployeesById]);

  const cleanupAutoFreiOnly = (doctorId: any, dateStr: any, position: any) => {
      const autoFreiShift = findAutoFreiToCleanup(doctorId, dateStr, position);
      if (autoFreiShift) {
          deleteShiftMutation.mutate(autoFreiShift.id);
      }
  };

  const deleteShiftWithCleanup = (shift: ShiftEntry): void => {
      // Skip if temp ID (optimistic update not yet persisted)
      if (shift.id?.startsWith('temp-')) {
          console.log(`[DEBUG-LOG] Skipping delete for temp shift ${shift.id}`);
          // Cancel optimistic update
          queryClient.setQueryData(['shifts', fetchRange.start, fetchRange.end], (old: any) => 
              (old as any[])?.filter((s: any) => s.id !== shift.id) || []
          );
          return;
      }

      console.log(`[DEBUG-LOG] deleteShiftWithCleanup triggered for Shift ${shift.id} (${shift.position})`);
      const idsToDelete = [shift.id];
      if (isAutoOffPosition(shift.position)) {
           const autoFreiShift = findAutoFreiToCleanup(shift.doctor_id!, shift.date, shift.position);
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
  const addPreviewAutoFrei = (doctorId: string, dateStr: string, positionName: string, currentPreviews: ShiftEntry[]): ShiftEntry[] => {
      const autoFreiDateStr = shouldCreateAutoFrei(positionName, dateStr, isPublicHoliday as any);
      if (!autoFreiDateStr) return currentPreviews;

      // Check if doctor already has something on that date (in preview or DB)
      const allMerged = [...(currentWeekShifts || [])];
      // Also include the current previews being modified
      const previewMerged = [...currentPreviews];
      const hasExisting = allMerged.some((s: any) => s.date === autoFreiDateStr && s.doctor_id === doctorId && !s.isPreview) ||
                          previewMerged.some((s: any) => s.date === autoFreiDateStr && s.doctor_id === doctorId);
      if (hasExisting) return currentPreviews;

      const newAutoFrei: any = {
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
  const removePreviewAutoFrei = (doctorId: string, dateStr: string, positionName: string, currentPreviews: ShiftEntry[]): ShiftEntry[] => {
      const autoFreiDateStr = shouldCreateAutoFrei(positionName, dateStr, isPublicHoliday as any);
      if (!autoFreiDateStr) return currentPreviews;

      // Remove from preview
      const filtered = currentPreviews.filter((s: any) => {
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
  const handleBeforeCapture = (before: BeforeCapture): void => {
    const { draggableId } = before;
        const normalizedDraggableId = normalizeDraggableId(draggableId);
        if (!normalizedDraggableId) return;

    let docId: string | null = null;
    let shiftId: string | null = null;
    
    if (normalizedDraggableId.startsWith('sidebar-doc-')) {
        docId = normalizedDraggableId.replace('sidebar-doc-', '');
    } else if (normalizedDraggableId.startsWith('available-doc-')) {
        docId = parseAvailableDoctorId(normalizedDraggableId);
    } else if (normalizedDraggableId.startsWith('shift-')) {
        shiftId = normalizedDraggableId.replace('shift-', '');
        const shift = currentWeekShifts.find((s: ShiftEntry) => s.id === shiftId);
        if (shift) {
            docId = shift.doctor_id ?? null;
        }
    }
    flushSync(() => {
      if (docId) setDraggingDoctorId(docId);
      if (shiftId) setDraggingShiftId(shiftId);
    });
  };

  const handleDragStart = (start: DragStart): void => {
    console.log('Drag Start:', start);
    const { draggableId } = start;
    const normalizedDraggableId = normalizeDraggableId(draggableId);
    let docId: string | null = null;

    if (normalizedDraggableId.startsWith('sidebar-doc-')) {
        docId = normalizedDraggableId.replace('sidebar-doc-', '');
    } else if (normalizedDraggableId.startsWith('available-doc-')) {
        docId = parseAvailableDoctorId(normalizedDraggableId);
    } else if (normalizedDraggableId.startsWith('shift-')) {
        const shiftId = normalizedDraggableId.replace('shift-', '');
        setDraggingShiftId(shiftId);
        const shift = currentWeekShifts.find((s: ShiftEntry) => s.id === shiftId);
        if (shift) {
            docId = shift.doctor_id ?? null;
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

  const { handleDragEnd } = useDragHandlers({
    isReadOnly,
    user,
    isDraggingFromGrid,
    isCtrlPressed,
    previewShifts,
    currentDate,
    setIsDraggingFromGrid,
    setDraggingDoctorId,
    setDraggingShiftId,
    setHiddenSpringerChipIds,
    setHiddenJokerDoctorIds,
    setPreviewShifts,
    setPreviewCategories,
    setUndoStack,
    setTimeslotSelectionDialog,
    doctors,
    allShifts,
    workplaces,
    systemSettings,
    fetchRange,
    currentWeekShifts,
    sidebarDoctors,
    doctorById,
    workplaceByName,
    springerDoctorById,
    allDisplayDocsByDate,
    workplaceTimeslotsByWorkplaceId,
    rotationWorkplaces,
    rotationAssignments,
    queryClient,
    lockCell,
    getScheduleBlock,
    checkStaffing,
    checkLimits,
    checkAbsenceDropConflicts,
    checkConflictsWithOverride,
    resolveTimeslotSelection,
    deleteShiftWithCleanup,
    cleanupAutoFreiOnly,
    shouldCreateAutoFrei,
    isAutoOffPosition,
    validate,
    addPreviewAutoFrei,
    removePreviewAutoFrei,
    requestOverride,
    isPublicHoliday,
    pendingTimeslotSelectionRef,
    mutations,
  });
  
  const applyPreview = async (): Promise<void> => {
      if (!previewShifts) return;
      // Remove isPreview flag before saving
    const shiftsToCreate = previewShifts.map(({ isPreview: _isPreview, id: _id, ...rest }) => rest);
      await db.ShiftEntry.bulkCreate(shiftsToCreate);
      queryClient.invalidateQueries({ queryKey: ['shifts'] });
      setPreviewShifts(null);
      setPreviewCategories(null);
      toast.success(`${shiftsToCreate.length} Eintr\u00e4ge \u00fcbernommen`);
  };

  const cancelPreview = () => {
      setPreviewShifts(null);
      setPreviewCategories(null);
  };

  const handleAutoFill = (categories: string[] | null = null): void => {
    setIsGenerating(true);
    try {
            const autoFillDebugEnabled = (
                systemSettings.find((s) => s.key === 'autofill_debug_enabled')?.value ||
                systemSettings.find((s) => s.key === 'ai_autofill_debug_enabled')?.value
            ) === 'true';
            const autoFillDebugEntries: any[] = [];
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
        existingShifts: currentWeekShifts.filter((s: any) => !s.isPreview),
        allShifts,
        trainingRotations,
        isPublicHoliday: isPublicHoliday as any,
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
            .filter((wp: any) => selectedCategories.includes(wp.category))
            .map((wp: any) => wp.name)
        );
        // Also include absence positions that may be generated (e.g. Auto-Frei)
        const absencePositions = ['Frei', 'Krank', 'Urlaub', 'Dienstreise', 'Nicht verfügbar', 'Verfügbar'];

        filtered = result.filter((s: any) => {
          // Always keep Auto-Frei entries (generated by auto_off services/positions)
          if (absencePositions.includes(s.position)) return true;
          // Keep if position belongs to a selected category
          return selectedPositions.has(s.position);
        });
      }

      if (filtered.length > 0) {
        // Assign stable IDs immediately so drag-drop can find them in state
        const withIds = filtered.map((s: any, i: any) => ({ ...s, id: `preview-${i}` }));
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
      toast.error('Fehler beim Generieren: ' + (error instanceof Error ? error.message : String(error)));
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

    const serviceWps = workplaces.filter((w: any) => w.category === 'Dienste');
    if (serviceWps.length === 0) return {};
    const serviceNames = new Set(serviceWps.map((w: any) => w.name));
    const sorted = [...serviceWps].sort((a: any, b: any) => (a.order || 0) - (b.order || 0));
    const fgName = sorted[0]?.name;
    const bgName = sorted[1]?.name;

    // Collect all doctor IDs that have a service in preview
    const previewServiceShifts = previewShifts.filter((s) => serviceNames.has(s.position));
    if (previewServiceShifts.length === 0) return {};

    const doctorIds = new Set(previewServiceShifts.map((s: any) => s.doctor_id));

    // 4-week window relative to planning dates (mirrors autoFillEngine logic):
    //   3 weeks before first preview date → last preview date
    const previewDates = previewServiceShifts.map((s: any) => s.date).sort();
    const firstPlanStr = previewDates[0];
    const lastPlanStr = previewDates[previewDates.length - 1];
    const fourWeekStart = new Date(firstPlanStr + 'T00:00:00');
    fourWeekStart.setDate(fourWeekStart.getDate() - 21); // 3 weeks back
    const fourWeekStartStr = format(fourWeekStart, 'yyyy-MM-dd');

    // Count services per doctor from DB shifts (fairnessShifts) + preview shifts
    const result: any = {};
    for (const docId of doctorIds) {
      // 1) Historical DB shifts (non-preview)
      const docShifts = fairnessShifts.filter((s) =>
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
      const docPreviewShifts = previewServiceShifts.filter((s: any) => s.doctor_id === docId);
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
  const getFairnessInfo = useMemo(() => (shift: ShiftEntry): any => {
    if (!shift.isPreview || !shift.doctor_id || !(previewFairnessData)[shift.doctor_id]) return null;

    const serviceWps = workplaces.filter((w: any) => w.category === 'Dienste');
    const serviceNames = new Set(serviceWps.map((w: any) => w.name));
    if (!serviceNames.has(shift.position)) return null;

    const info = { ...(previewFairnessData)[shift.doctor_id] };

    // Check wishes for this date+doctor
    const shiftWishes = wishes.filter((w) =>
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

    const getDoctorDayWishes = useMemo(() => (doctorId: string, dateStr: string): WishRequest[] => {
        return wishes.filter((w) =>
            w.doctor_id === doctorId &&
            isWishOnDate(w, dateStr) &&
            w.status !== 'rejected'
        );
    }, [wishes]);

    const buildWishTooltip = useMemo(() => (doctor: Doctor, doctorWishes: WishRequest[] = []): string => {
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

    const getAvailableDoctorWishPresentation = useMemo(() => (doctor: Doctor, dateStr: string): any => {
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

    const getShiftWishMarker = useMemo(() => (shift: ShiftEntry): any => {
        if (!shift) return null;

        const workplace = workplaces.find((w: any) => w.name === shift.position);
        if (workplace?.category !== 'Dienste') return null;

        const doctorWishes = getDoctorDayWishes(shift.doctor_id!, shift.date);
        if (!doctorWishes.length) return null;

        const matchingServiceWish = doctorWishes.find((w: any) =>
            w.type === 'service' && (!w.position || w.position === shift.position)
        );
        if (matchingServiceWish) {
            return {
                color: 'green',
                title: `Dienstwunsch erfüllt: ${matchingServiceWish.position || shift.position}`
            };
        }

        const conflictingNoServiceWish = doctorWishes.find((w: any) =>
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
  const {
    renderCrossTenantCell,
    renderLinkedWorkplaceButton,
    renderLinkedWorkplaceCellButton,
    renderRotationCell,
    renderCellShifts,
    renderShiftClone,
    renderAvailableDoctorClone,
  } = useCellRenderers({
    isReadOnly,
    user,
    isCtrlPressed,
    draggingShiftId,
    highlightMyName,
    selectedDoctorId,
    showInitialsOnly,
    isSplitViewEnabled,
    isMonthView,
    isEmbeddedSchedule,
    effectiveGridFontSize,
    shiftBoxSize,
    setRotationDemandDialog,
    setRotationAssignmentDialog,
    crossTenantShiftsByCell,
    linkedWorkplacesByName,
    activeLinkTenantId,
    rotationAssignmentsByCell,
    rotationDemandsByCell,
    openReturnRequestByAssignmentId,
    jokerDoctorById,
    doctorByCentralEmployeeId,
    centralEmployeesById,
    doctorById,
    springerDoctorById,
    workplaceByName,
    lateRotationIndicatorByDoctorDay,
    allDisplayDocsByDate,
    currentWeekShiftLookup,
    currentWeekShifts,
    workplaceTimeslots,
    workTimeModelMap,
    colorSettings,
    isLoadingColors,
    systemSettings,
    updateShiftMutation,
    queryClient,
    openPoolEditDialog,
    getDoctorChipLabel,
    getRoleColor,
    getDoctorWithEffectiveFte,
    handleShiftTimeslotEdit,
    getFairnessInfo,
    getShiftWishMarker,
    getDoctorQualIds,
    getWpRequiredQualIds,
    getWpExcludedQualIds,
  });

  const renderSplitMatrix = () => {
      if (!canUseSplitView || !isSplitViewEnabled || splitSections.length === 0) return null;

      return (
          <div className="w-full lg:flex-1 bg-white rounded-lg shadow-sm border border-slate-200 max-h-[calc(100vh-180px)] z-0 overflow-x-auto overflow-y-auto">
              <div className="min-w-[800px]">
                  <div className={`grid ${viewMode === 'day' ? 'grid-cols-[200px_1fr]' : 'grid-cols-[200px_repeat(7,1fr)]'} border-b border-slate-200 bg-slate-50 sticky top-0 z-30 shadow-sm`}>
                      <div className="p-3 font-semibold text-slate-700 border-r border-slate-200 flex items-center bg-slate-50">
                          Bereich / Datum
                      </div>
                      {weekDays.map((day: any) => {
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

                  {movePinnedSectionToEnd(splitSections).map((section: any, sIdx: any) => {
                      const normalizedRows = section.rows.map((r: any) =>
                          typeof r === 'string' ? { name: r, displayName: r, timeslotId: null, isTimeslotRow: false, isTimeslotGroupHeader: false } : r
                      );

                      const visibleRows = normalizedRows.filter((r: any) => !hiddenRows.includes(r.name));
                      if (visibleRows.length === 0) return null;

                      const isCollapsed = collapsedSections.includes(section.title);
                      const customStyle = getSectionStyle(section.title);
                      const isPinnedSection = section.title === PINNED_SECTION_TITLE;

                      return (
                          <div key={`split-section-${sIdx}`} className={isPinnedSection ? STICKY_AVAILABLE_SECTION_CLASS : ''} style={isPinnedSection ? stickyAvailableSectionStyle : undefined}>
                              <div
                                  className={`px-3 py-2 text-xs font-bold uppercase tracking-wider border-b border-slate-200 flex items-center justify-between cursor-pointer select-none transition-colors ${!customStyle ? section.headerColor : ''}`}
                                  style={customStyle ? customStyle.header : {}}
                                  onClick={() => { setCollapsedSections((prev) => prev.includes(section.title) ? prev.filter((t: any) => t !== section.title) : [...prev, section.title]); }}
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

                              {!isCollapsed && visibleRows.map((rowObj: any, rIdx: any) => {
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
                                      if (!(rowWorkplace as any)?.id) return false;
                                      const { requiredIds, optionalIds, discouragedIds, excludeIds } = buildRowQualSets({
                                          workplaceId: (rowWorkplace as any).id,
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
                                                                  onClick={() => { applyRowQualificationFilter(rowName, rowTimeslotId, rowWorkplace); }}
                                                                  title={isRowQualFilterSource ? `Zeilen-Filter aufheben (${rowQualFilter.sourceName})` : `Nach Qualifications dieser Zeile filtern (${(rowWorkplace as any)?.name || rowName})`}
                                                              >
                                                                  <Filter className="h-3 w-3" />
                                                              </Button>
                                                          )}
                                                          <div className="hidden">{provided.placeholder}</div>
                                                      </div>
                                                  </div>
                                              )}
                                          </Droppable>

                                          {weekDays.map((day: any, dIdx: any) => {
                                              const isWeekendDay = [0, 6].includes(day.getDay());
                                              const isToday = isSameDay(day, new Date());
                                              const dateStr = format(day, 'yyyy-MM-dd');
                                              const rawCellId = rowTimeslotId
                                                  ? `${dateStr}__${rowName}__${rowTimeslotId}`
                                                  : `${dateStr}__${rowName}`;
                                              const cellId = withPanelPrefix(rawCellId, SPLIT_PANEL_PREFIX);
                                              const cellShiftsForOcc = getShiftsForScheduleCell({ shiftLookup: currentWeekShiftLookup, dateStr, rowName, timeslotId: rowTimeslotId, allTimeslotIds: rowObj.allTimeslotIds || null, singleTimeslotId: rowObj.singleTimeslotId || null, timeslotsEnabled: Boolean((rowWorkplace as any)?.timeslots_enabled) });
                                              const isOccupied = cellShiftsForOcc.length > 0;

                                              let isDisabled = false;
                                              let isTrainingHighlight = false;

                                              if (draggingDoctorId) {
                                                  const activeRotations = trainingRotations.filter((rot) =>
                                                      rot.doctor_id === draggingDoctorId &&
                                                      rot.start_date <= dateStr &&
                                                      rot.end_date >= dateStr
                                                  );
                                                  const isTarget = activeRotations.some((rot: any) =>
                                                      rot.modality === rowName ||
                                                      (rot.modality === 'Röntgen' && (rowName === 'DL/konv. Rö' || rowName.includes('Rö')))
                                                  );
                                                  if (isTarget) isTrainingHighlight = true;
                                              }

                                              if (rowName !== 'Verfügbar') {
                                                  const setting = workplaces.find((s: any) => s.name === rowName);
                                                  if (setting) {
                                                      const activeDays = ((setting).active_days && (setting).active_days.length > 0) ? (setting).active_days : [1, 2, 3, 4, 5];
                                                      // Feiertag = wie Sonntag: An Feiertagen zählt nur, ob Sonntag (0) aktiv ist
                                                      const isActive = isPublicHoliday(day)
                                                          ? activeDays.some((d: any) => Number(d) === 0)
                                                          : activeDays.some((d: any) => Number(d) === day.getDay());
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
                                                                          {allDocs.map((doc: any, idx: any) => {
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
                                                                  {scheduleNotes.find((n) => n.date === format(day, 'yyyy-MM-dd') && n.position === rowName)?.content || ''}
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
                                                                  blockReason={getScheduleBlock(dateStr, rowName, rowTimeslotId)?.reason as any}
                                                                  infoReason={getScheduleInfo(dateStr, rowName, rowTimeslotId)?.reason as any}
                                                                  isOccupied={isOccupied}
                                                                  onContextMenu={(e: any) => { handleCellContextMenu(e, dateStr, rowName, rowTimeslotId); }}
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

  // ScheduleBoardContext value — populated for the desktop view so that
  // extracted cell renderers and drag handlers can consume shared
  // dependencies via context instead of closure scope. Step 1 plumbing:
  // the value is built but no consumer has been migrated yet.
  const scheduleBoardContextValue = useMemo<ScheduleBoardContextValue>(() => ({
    isReadOnly,
    doctors,
    currentWeekShifts,
    workplaces,
    workplaceTimeslots,
    systemSettings,
    doctorById,
    workplaceByName,
    centralEmployeesById,
    workTimeModelMap,
    allDisplayDocsByDate,
    effectiveGridFontSize,
    shiftBoxSize,
    getDoctorChipLabel,
    getRoleColor,
  }), [
    isReadOnly,
    doctors,
    currentWeekShifts,
    workplaces,
    workplaceTimeslots,
    systemSettings,
    doctorById,
    workplaceByName,
    centralEmployeesById,
    workTimeModelMap,
    allDisplayDocsByDate,
    effectiveGridFontSize,
    shiftBoxSize,
    getDoctorChipLabel,
    getRoleColor,
  ]);

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
        <ScheduleBoardContext.Provider value={scheduleBoardContextValue}>
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
                        onClick={() => { setCurrentDate(viewMode === 'week' ? startOfWeek(new Date(), { weekStartsOn: 1 }) : viewMode === 'month' ? startOfMonth(new Date()) : new Date()); }}
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
                            onClick={() => { setCurrentDate((d) => viewMode === 'week' ? addDays(d, -7) : viewMode === 'month' ? addMonths(d, -1) : addDays(d, -1)); }}
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
                            onClick={() => { setCurrentDate((d) => viewMode === 'week' ? addDays(d, 7) : viewMode === 'month' ? addMonths(d, 1) : addDays(d, 1)); }}
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
                    setCurrentDate((d) => startOfMonth(d));
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
                    setCurrentDate((d) => startOfWeek(d, { weekStartsOn: 1 }));
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
                   onClick={() => { setViewMode('day'); }}
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
                          <DropdownMenuItem onClick={() => { handleAutoFill(); }} data-testid="schedule-auto-fill-all">
                              Alle Kategorien
                          </DropdownMenuItem>
                         <DropdownMenuSeparator />
                         <DropdownMenuItem onClick={() => { handleAutoFill(['Rotationen']); }}>
                             Nur {getSectionName('Rotationen')}
                         </DropdownMenuItem>
                         <DropdownMenuItem onClick={() => { handleAutoFill(['Dienste']); }}>
                             Nur {getSectionName('Dienste')}
                         </DropdownMenuItem>
                         <DropdownMenuItem onClick={() => { handleAutoFill(['Demonstrationen & Konsile']); }}>
                             Nur {getSectionName('Demonstrationen & Konsile')}
                         </DropdownMenuItem>
                         {getWorkplaceCategoryNames(systemSettings).map((name: any) => (
                             <DropdownMenuItem key={name} onClick={() => { handleAutoFill([name]); }}>
                                 Nur {name}
                             </DropdownMenuItem>
                         ))}
                         {user?.role === 'admin' && (
                           <>
                             <DropdownMenuSeparator />
                             <AutoFillSettingsDialog trigger={
                               <DropdownMenuItem onSelect={(e) => { e.preventDefault(); }}>
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
                 onClick={handleOpenConflictSheet}
                 disabled={isScanning}
                 title="Regelkonformität prüfen"
                 className="h-9"
                 data-testid="schedule-conflict-check"
              >
                {isScanning ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
                <span className="hidden sm:inline ml-1">Regelprüfung</span>
                {conflicts.length > 0 && (
                    <Badge variant={conflicts.some((c) => c.severity === 'blocker') ? 'destructive' : 'secondary'} className="ml-1 h-5 px-1.5 text-xs">
                        {conflicts.length}
                    </Badge>
                )}
             </Button>
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
                       <div className="px-2 py-2" onClick={(e) => { e.stopPropagation(); }}>
                           <input 
                               type="range" 
                               min="10" 
                               max="24" 
                               step="1"
                               value={gridFontSize} 
                               onChange={(e) => { setGridFontSize(Number(e.target.value)); }}
                               className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-indigo-600"
                           />
                       </div>
                       <DropdownMenuSeparator />
                       <DropdownMenuLabel>Zeilen verwalten</DropdownMenuLabel>
                       <ScrollArea className="h-[300px]">
                           {sections.flatMap((s: any) => s.rows).map((row: any, idx: any) => {
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
                                       setHiddenRows((prev) => 
                                           checked 
                                               ? prev.filter((r: any) => r !== rowName) 
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
                            onClick={() => { setActiveSectionTabId('main'); }}
                            className={`px-3 py-1.5 rounded-md text-sm font-medium whitespace-nowrap transition-colors ${activeSectionTabId === 'main' ? 'bg-indigo-100 text-indigo-700' : 'text-slate-600 hover:bg-slate-100'}`}
                        >
                            Hauptplan
                        </button>
                        {availableSectionTabs.map((tab: any) => {
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
                                        onClick={() => { handleOpenSectionTabInNewWindow(tab.id); }}
                                        className="px-2 py-1.5 text-slate-400 hover:text-indigo-600"
                                        title="In separatem Fenster öffnen"
                                    >
                                        <ExternalLink className="w-3.5 h-3.5" />
                                    </button>
                                    {canUseSplitView && (
                                        <button
                                            onClick={() => { handleOpenSectionTabInSplitView(tab.id); }}
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
                                onClick={() => { setIsSplitViewEnabled(false); }}
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
                                {activeQualifications.map((qualification: any) => {
                                    const isSelected = selectedQualificationIds.includes(qualification.id);
                                    return (
                                        <CommandItem
                                            key={qualification.id}
                                            value={`${qualification.name} ${qualification.short_label || ''}`}
                                            onSelect={() => { toggleScheduleQualification(qualification.id); }}
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
                                    {selectedQualificationIds.flatMap((qid, idx: any) => {
                                        const qualification = qualificationMap[qid];
                                        if (!qualification) return [];
                                        const chip = (
                                            <button
                                                key={`chip-${qid}`}
                                                type="button"
                                                onClick={() => { toggleScheduleQualification(qid); }}
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
                                    onClick={() => { setSelectedQualificationIds([]); }}
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
                            {sidebarDoctors.map((doctor: any, index: any) => {
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
                                        onDoubleClick={isAdmin ? handleDoctorDoubleClick : undefined}
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
                {weekDays.map((day: any) => {
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
                    const rotationSection = sections.find((s: any) => s.title === "Rotationen");
                    const rotationRows = rotationSection ? rotationSection.rows : [];
                    const dayShiftPositions = currentWeekShiftPositionsByDate.get(dateStr) || new Set();
                    const allRotationsFilled = rotationRows.length > 0 && rotationRows.every((r: any) => dayShiftPositions.has(typeof r === 'string' ? r : r.name));

                    // Verfügbarkeits-Grenzwerte prüfen
                    const staffingWarnings = getAvailabilityWarnings({
                        doctors,
                        shifts: allShifts,
                        dateStr,
                        qualificationMap: qualificationMap,
                        doctorQualByDoctor: doctorQualByDoctor,
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
                                                        {staffingWarnings.warnings.map((w: any, idx: any) => (
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
                                                            {unassignedDocs.map((doc: any) => (
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
                                    onClick={() => { handleClearDay(day); }}
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

              {movePinnedSectionToEnd(sections).map((section: any, sIdx: any) => {
                // rows sind jetzt Objekte mit { name, displayName, timeslotId, isTimeslotRow, isTimeslotGroupHeader }
                // Für Rückwärtskompatibilität: Falls string, in Objekt konvertieren
                const normalizedRows = section.rows.map((r: any) => 
                    typeof r === 'string' ? { name: r, displayName: r, timeslotId: null, isTimeslotRow: false, isTimeslotGroupHeader: false } : r
                );
                
                // Filter: Versteckte Zeilen ausblenden
                const visibleRows = normalizedRows.filter((r: any) => {
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
                        onClick={() => { setCollapsedSections((prev) => prev.includes(section.title) ? prev.filter((t: any) => t !== section.title) : [...prev, section.title]); }}
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
                    
                    {!isCollapsed && visibleRows.map((rowObj: any, rIdx: any) => {
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
                            if (!(rowWorkplace as any)?.id) return false;
                            const { requiredIds, optionalIds, discouragedIds, excludeIds } = buildRowQualSets({
                                workplaceId: (rowWorkplace as any).id,
                                getRequired: getWpRequiredQualIds,
                                getOptional: getWpOptionalQualIds,
                                getDiscouraged: getWpDiscouragedQualIds,
                                getExcluded: getWpExcludedQualIds,
                            });
                            return requiredIds.length > 0 || optionalIds.length > 0 || discouragedIds.length > 0 || excludeIds.length > 0;
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
                                            {!rowObj.isTimeslotRow && (rowWorkplace as any)?.time && (
                                                <span className="text-[10px] font-normal opacity-80">
                                                    {(rowWorkplace as any).time} Uhr
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
                                                    onClick={() => { applyRowQualificationFilter(rowName, rowTimeslotId, rowWorkplace); }}
                                                    title={isRowQualFilterSource ? `Zeilen-Filter aufheben (${rowQualFilter.sourceName})` : `Nach Qualifications dieser Zeile filtern (${(rowWorkplace as any)?.name || rowName})`}
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
                                                    onClick={() => { handleClearRow(rowName, rowTimeslotId); }}
                                                    title="Zeile leeren"
                                                >
                                                    <Trash2 className="h-3 w-3" />
                                                </Button>
                                                )}
                                                <Button 
                                                variant="ghost" 
                                                size="icon" 
                                                className="h-5 w-5 opacity-0 group-hover:opacity-100 hover:bg-black/10"
                                                onClick={() => { setHiddenRows((prev) => [...prev, rowName]); }}
                                                title="Zeile ausblenden"
                                                >
                                                <EyeOff className="h-3 w-3 opacity-50" />
                                                </Button>
                                                </div>
                                                <div className="hidden">{provided.placeholder}</div>
                                    </div>
                                )}
                            </Droppable>
                            {weekDays.map((day: any, dIdx: any) => {
                                const isWeekend = [0, 6].includes(day.getDay());
                                const isToday = isSameDay(day, new Date());
                                const dateStr = format(day, 'yyyy-MM-dd');
                                // Unique ID for droppable: date__position oder date__position__timeslotId
                                const cellId = rowTimeslotId 
                                    ? `${dateStr}__${rowName}__${rowTimeslotId}`
                                    : `${dateStr}__${rowName}`;
                                const cellShiftsForOcc = getShiftsForScheduleCell({ shiftLookup: currentWeekShiftLookup, dateStr, rowName, timeslotId: rowTimeslotId, allTimeslotIds: rowObj.allTimeslotIds || null, singleTimeslotId: rowObj.singleTimeslotId || null, timeslotsEnabled: Boolean((rowWorkplace as any)?.timeslots_enabled) });
                                const isOccupied = cellShiftsForOcc.length > 0;
                                
                                // Check if it's a demo row and if it's allowed
                                let isDisabled = false;
                                let isTrainingHighlight = false;

                                if (draggingDoctorId) {
                                    const activeRotations = trainingRotations.filter((rot) => 
                                        rot.doctor_id === draggingDoctorId &&
                                        rot.start_date <= dateStr &&
                                        rot.end_date >= dateStr
                                    );
                                    
                                    // Check match (handling mapping for Röntgen)
                                    const isTarget = activeRotations.some((rot: any) => 
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
                                            const activeDays = ((setting as any).active_days && (setting as any).active_days.length > 0) ? (setting as any).active_days : [1, 2, 3, 4, 5];
                                            // Feiertag = wie Sonntag: An Feiertagen zählt nur, ob Sonntag (0) aktiv ist
                                            const isActive = isPublicHoliday(day)
                                                ? activeDays.some((d: any) => Number(d) === 0)
                                                : activeDays.some((d: any) => Number(d) === day.getDay());
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
                                                            {allDocs.map((doc: any, idx: any) => {
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
                                                                        const isSelectedDoctor = selectedDoctorId != null && doc.id === selectedDoctorId;
                                                                        if (isCurrentUser && highlightMyName) wishClass = "ring-2 ring-red-500 ring-offset-1 z-10";
                                                                        if (isSelectedDoctor) wishClass = "ring-2 ring-red-500 ring-offset-1 z-10";
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
                                                    blockReason={getScheduleBlock(dateStr, rowName, rowTimeslotId)?.reason as any}
                                                    infoReason={getScheduleInfo(dateStr, rowName, rowTimeslotId)?.reason as any}
                                                    isOccupied={isOccupied}
                                                    onContextMenu={(e: any) => { handleCellContextMenu(e, dateStr, rowName, rowTimeslotId); }}
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

      {/* Conflict Panel Sheet */}
      <ConflictPanelSheet
          open={isConflictSheetOpen}
          onOpenChange={(open) => {
              setIsConflictSheetOpen(open);
              if (!open) clearConflicts();
          }}
          conflicts={conflicts}
          isScanning={isScanning}
          onResolveShift={handleResolveShift}
          shiftLabels={shiftLabelMap}
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
                              {timeslotSelectionDialog.options.map((timeslot: any) => (
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
                                                          onClick={() => { handleTimeslotDialogSelect(timeslot.id); }}
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
                                                              value={Number.isFinite(customStartMinutes) ? (formatMinutesAsTime(customStartMinutes) ?? '') : ''}
                                                              onChange={(event) => { handleTimeslotCustomStartChange(timeslot.id, timeslot, event.target.value); }}
                                                              className="h-8 w-[124px]"
                                                              data-testid={`schedule-timeslot-custom-start-${timeslot.id}`}
                                                          />
                                                      </label>
                                                      <label className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-slate-500">
                                                          Ende
                                                          <Input
                                                              type="time"
                                                              step={300}
                                                              value={Number.isFinite(customEndMinutes) ? (formatMinutesAsTime(customEndMinutes) ?? '') : ''}
                                                              onChange={(event) => { handleTimeslotCustomEndChange(timeslot.id, timeslot, event.target.value); }}
                                                              className="h-8 w-[124px]"
                                                              data-testid={`schedule-timeslot-custom-end-${timeslot.id}`}
                                                          />
                                                      </label>
                                                      <Button
                                                          type="button"
                                                          size="sm"
                                                          className="h-8 px-3"
                                                          onClick={() => { handleTimeslotCustomApply(timeslot); }}
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
          <div className="fixed inset-0 z-[9998]" onClick={() => { setBlockContextMenu(null); }} />
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
                  onChange={(e) => { setBlockReasonInput(e.target.value); }}
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
                  onChange={(e) => { setInfoReasonInput(e.target.value); }}
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
        onOpenChange={(open) => { setPoolEditDialog((prev: any) => ({ ...prev, open })); }}
        workplace={poolEditDialog.workplace}
        date={poolEditDialog.date}
        shift={poolEditDialog.shift}
        busyEmployeeIds={poolEditDialog.date ? (busyCentralIdsByDate[poolEditDialog.date] || new Set()) : new Set()}
        activeTenantId={undefined}
      />

      {/* Springerpool-Rotationen — assignment editor (pool planner) */}
      <RotationAssignmentDialog
        open={rotationAssignmentDialog.open}
        onOpenChange={(open) => {
          setRotationAssignmentDialog((prev: any) => ({ ...prev, open, defaultEmployeeId: null }));
        }}
        workplace={rotationAssignmentDialog.workplace as any}
        date={rotationAssignmentDialog.date}
        assignment={rotationAssignmentDialog.assignment as any}
        timeslotId={rotationAssignmentDialog.timeslotId}
        defaultEmployeeId={rotationAssignmentDialog.defaultEmployeeId}
      />

      {/* Springerpool-Rotationen — demand dialog (ward staff) */}
      <RotationDemandDialog
        open={rotationDemandDialog.open}
        onOpenChange={(open) => { setRotationDemandDialog((prev: any) => ({ ...prev, open })); }}
        workplace={rotationDemandDialog.workplace}
        dateStr={rotationDemandDialog.date}
        timeslot={rotationDemandDialog.timeslot}
        existingDemand={rotationDemandDialog.existingDemand}
      />
    </div>
        </ScheduleBoardContext.Provider>
  );
}
