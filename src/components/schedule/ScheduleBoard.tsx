// @ts-nocheck
import { useState, useMemo, useRef } from 'react';
import { DragDropContext } from '@hello-pangea/dnd';
import {
  format,
  addDays,
  startOfWeek,
  startOfMonth,
  endOfMonth,
  eachDayOfInterval,
  isValid,
} from 'date-fns';
import { Lock, Unlock } from 'lucide-react';
import { toast } from 'sonner';

import { api, db } from '@/api/client';
import { useMutation } from '@tanstack/react-query';
import { useAuth } from '@/components/AuthProvider';
import DraggableShift from './DraggableShift';
import { generateSuggestions } from './autoFillEngine';
import { DEFAULT_COLORS } from '@/components/settings/ColorSettingsDialog';
import { useShiftValidation } from '@/components/validation/useShiftValidation';
import { useOverrideValidation } from '@/components/validation/useOverrideValidation';
import {
  useAllDoctorQualifications,
  useAllWorkplaceQualifications,
} from '@/hooks/useQualifications';
import OverrideConfirmDialog from '@/components/validation/OverrideConfirmDialog';
// trackDbChange removed - MySQL mode doesn't use auto-backup
import { useHolidays } from '@/hooks/useHolidays';
import { isDoctorAvailable } from './staffingUtils';
import { useSectionConfig } from '@/components/settings/SectionConfigDialog';
import MobileScheduleView from './MobileScheduleView';
import ScheduleBoardDesktopLayout from './ScheduleBoardDesktopLayout';
import { useIsMobile } from '@/hooks/use-mobile';

import { useSchedulePreferences } from './hooks/useSchedulePreferences';
import { useScheduleBoardControls } from './hooks/useScheduleBoardControls';
import { useScheduleBoardCommands } from './hooks/useScheduleBoardCommands';
import { useScheduleBoardInteractions } from './hooks/useScheduleBoardInteractions';
import { useScheduleData } from './hooks/useScheduleData';
import { useScheduleSectionTabs } from './hooks/useScheduleSectionTabs';
import ScheduleToolbar from './ScheduleToolbar';
import {
  getWorkplaceCategoriesFromSettings,
  getWorkplaceCategoryNames,
  workplaceAllowsMultiple,
} from '@/utils/workplaceCategoryUtils';
// import VoiceControl from './VoiceControl';

import { SECTION_TABS_KEY, PINNED_SECTION_TITLE } from './utils/scheduleConstants';
import {
  normalizeDraggableId,
  getInitialScheduleState,
  getDoctorShortLabel,
  buildDoctorChipLabelMap,
  getShiftDisplayMode,
} from './utils/scheduleFormatters';
import { buildScheduleSections } from './utils/scheduleSectionBuilder';

const DEFAULT_FULLTIME_DAILY_HOURS = 7.7;

const formatTimeslotEndTime = (endTime) => {
  if (!endTime) return null;
  return endTime.substring(0, 5);
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

const formatMinutesAsTime = (totalMinutes) => {
  if (totalMinutes === null || totalMinutes === undefined) return null;
  const normalized = ((totalMinutes % (24 * 60)) + 24 * 60) % (24 * 60);
  const hours = Math.floor(normalized / 60);
  const minutes = normalized % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
};

const getDoctorTargetDailyHours = (doctor, workTimeModelMap) => {
  if (!doctor) return null;

  if (doctor.target_weekly_hours) {
    return Number(doctor.target_weekly_hours) / 5;
  }

  const model = doctor.work_time_model_id ? workTimeModelMap.get(doctor.work_time_model_id) : null;
  if (model?.hours_per_day) {
    return Number(model.hours_per_day);
  }
  if (model?.hours_per_week) {
    return Number(model.hours_per_week) / 5;
  }

  if (doctor.fte && Number(doctor.fte) > 0) {
    return Number(doctor.fte) * DEFAULT_FULLTIME_DAILY_HOURS;
  }

  return null;
};

const getShiftTimeslotBadge = (shift, doctor, workplaceTimeslots, workTimeModelMap) => {
  if (!shift?.timeslot_id) return { label: null, tone: 'default' };

  const timeslot = workplaceTimeslots.find((entry) => entry.id === shift.timeslot_id);
  if (!timeslot?.end_time) {
    return { label: null, tone: 'default' };
  }

  const defaultEndTime = formatTimeslotEndTime(timeslot.end_time);
  const startMinutes = parseTimeToMinutes(timeslot.start_time);
  const endMinutes = parseTimeToMinutes(timeslot.end_time);
  const dailyHours = getDoctorTargetDailyHours(doctor, workTimeModelMap);

  if (startMinutes === null || endMinutes === null || !dailyHours) {
    return { label: defaultEndTime, tone: 'default' };
  }

  let slotDurationMinutes = endMinutes - startMinutes;
  if (slotDurationMinutes < 0) {
    slotDurationMinutes += 24 * 60;
  }

  const allowedMinutes = Math.round(dailyHours * 60);
  if (allowedMinutes <= 0 || slotDurationMinutes <= allowedMinutes) {
    return { label: defaultEndTime, tone: 'default' };
  }

  return {
    label: formatMinutesAsTime(startMinutes + allowedMinutes),
    tone: 'warning',
  };
};

export default function ScheduleBoard() {
  const initialState = useMemo(() => getInitialScheduleState(), []);
  const isEmbeddedSchedule = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('embeddedSchedule') === '1';
  }, []);
  // const { isReadOnly } = useAuth(); // Removed duplicate destructuring
  const isMobile = useIsMobile();
  let invalidateShifts = () => {};
  const {
    currentDate,
    setCurrentDate,
    viewMode,
    setViewMode,
    isGenerating,
    setIsGenerating,
    isCtrlPressed,
    undoStack,
    setUndoStack,
    handleUndo,
  } = useScheduleBoardControls({
    initialState,
    shiftEntryClient: db.ShiftEntry,
    onUndoSuccess: () => invalidateShifts(),
    alert: (message) => alert(message),
  });
  const isMonthView = viewMode === 'month';

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

  const { isReadOnly, user, updateMe } = useAuth();

  // Load saved settings from user profile or localStorage fallback
  const {
    showSidebar,
    setShowSidebar,
    hiddenRows,
    setHiddenRows,
    collapsedSections,
    setCollapsedSections,
    highlightMyName,
    setHighlightMyName,
    showInitialsOnly,
    setShowInitialsOnly,
    sortDoctorsAlphabetically,
    setSortDoctorsAlphabetically,
    gridFontSize,
    setGridFontSize,
    collapsedTimeslotGroups,
    setCollapsedTimeslotGroups,
    toggleTimeslotGroup,
    sortDoctorsForDisplay,
  } = useSchedulePreferences(user, updateMe);

  // Use dynamic holiday calculator instead of static MV functions
  const currentYear = useMemo(() => new Date(currentDate).getFullYear(), [currentDate]);
  const { isPublicHoliday, isSchoolHoliday } = useHolidays(currentYear);

  // Tenant-specific section configuration
  const { getSectionName, getSectionOrder } = useSectionConfig();

  const effectiveGridFontSize = isMonthView ? Math.min(gridFontSize, 11) : gridFontSize;
  const shiftBoxSize = isMonthView
    ? Math.max(effectiveGridFontSize * 2.8, 30)
    : effectiveGridFontSize * 3.5;
  const [previewShifts, setPreviewShifts] = useState(null);
  const [, setPreviewCategories] = useState(null); // welche Kategorien im Vorschlag

  const {
    queryClient,
    fetchRange,
    doctors,
    allShifts,
    fairnessShifts,
    wishes,
    workplaces,
    workplaceTimeslots,
    systemSettings,
    isLoadingSystemSettings,
    sectionTabs,
    staffingPlanEntries,
    workTimeModelMap,
    trainingRotations,
    colorSettings,
    isLoadingColors,
    scheduleNotes,
    scheduleNotesMap,
    scheduleBlocks,
  } = useScheduleData(currentDate);
  invalidateShifts = () => queryClient.invalidateQueries({ queryKey: ['shifts'] });

  const updateDoctorMutation = useMutation({
    mutationFn: ({ id, data }) => db.Doctor.update(id, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['doctors'] }),
  });

  const updateSystemSettingMutation = useMutation({
    mutationFn: async ({ key, value }) => {
      const existing = systemSettings.find((s) => s.key === key);
      if (existing) {
        return db.SystemSetting.update(existing.id, { value });
      }
      return db.SystemSetting.create({ key, value });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['systemSettings'] }),
  });

  const allSections = useMemo(() => {
    return buildScheduleSections({
      workplaces,
      workplaceTimeslots,
      allShifts,
      previewShifts,
      getSectionOrder,
      systemSettings,
    });
  }, [workplaces, workplaceTimeslots, allShifts, previewShifts, getSectionOrder, systemSettings]);

  const persistSectionTabs = async (tabs) => {
    await updateSystemSettingMutation.mutateAsync({
      key: SECTION_TABS_KEY,
      value: JSON.stringify(tabs),
    });
  };

  const {
    activeSectionTabId,
    setActiveSectionTabId,
    isSplitViewEnabled,
    setIsSplitViewEnabled,
    availableSectionTabs,
    canUseSplitView,
    splitSections,
    sections,
    handleMoveSectionToTab,
    handleCloseSectionTab,
    handleOpenSectionTabInNewWindow,
    handleOpenSectionTabInSplitView,
  } = useScheduleSectionTabs({
    initialActiveSectionTabId: initialState.activeSectionTabId,
    allSections,
    sectionTabs,
    isLoadingSystemSettings,
    isMobile,
    isEmbeddedSchedule,
    viewMode,
    currentDate,
    getSectionName,
    persistSectionTabs,
    toast,
  });

  const doctorChipLabelMap = useMemo(() => buildDoctorChipLabelMap(doctors), [doctors]);

  const getDoctorChipLabel = useMemo(
    () => (doctor) => {
      if (!doctor) return '';
      if (!isMonthView) return getDoctorShortLabel(doctor);
      return (
        doctorChipLabelMap.get(doctor.id) ||
        formatChipLabel(normalizeChipSource(doctor).slice(0, 3))
      );
    },
    [doctorChipLabelMap, isMonthView],
  );

  // Map for quick lookup: "date|position" or "date|position|timeslotId" → block
  const scheduleBlocksMap = useMemo(() => {
    const map = new Map();
    for (const block of scheduleBlocks) {
      const dateStr =
        typeof block.date === 'string'
          ? block.date.substring(0, 10)
          : format(new Date(block.date), 'yyyy-MM-dd');
      const key = block.timeslot_id
        ? `${dateStr}|${block.position}|${block.timeslot_id}`
        : `${dateStr}|${block.position}`;
      map.set(key, block);
    }
    return map;
  }, [scheduleBlocks]);

  const getScheduleBlock = (dateStr, position, timeslotId) => {
    if (timeslotId) {
      return (
        scheduleBlocksMap.get(`${dateStr}|${position}|${timeslotId}`) ||
        scheduleBlocksMap.get(`${dateStr}|${position}`)
      );
    }
    return scheduleBlocksMap.get(`${dateStr}|${position}`);
  };

  const { validate, shouldCreateAutoFrei, findAutoFreiToCleanup, isAutoOffPosition } =
    useShiftValidation(allShifts, { workplaces, timeslots: workplaceTimeslots });

  // Qualifikationsdaten für visuelle Indikatoren
  const { getQualificationIds: getDoctorQualIds } = useAllDoctorQualifications();
  const {
    getRequiredQualificationIds: getWpRequiredQualIds,
    getOptionalQualificationIds: getWpOptionalQualIds,
    getExcludedQualificationIds: getWpExcludedQualIds,
    getDiscouragedQualificationIds: getWpDiscouragedQualIds,
  } = useAllWorkplaceQualifications();

  // Override-Validierung mit Dialog
  const {
    overrideDialog,
    requestOverride,
    confirmOverride,
    cancelOverride,
    setOverrideDialogOpen,
  } = useOverrideValidation({ user, doctors });

  const getRoleColor = useMemo(
    () => (role) => {
      const setting = colorSettings.find((s) => s.name === role && s.category === 'role');
      if (setting) return { backgroundColor: setting.bg_color, color: setting.text_color };
      if (DEFAULT_COLORS.roles[role])
        return {
          backgroundColor: DEFAULT_COLORS.roles[role].bg,
          color: DEFAULT_COLORS.roles[role].text,
        };
      return { backgroundColor: '#f3f4f6', color: '#1f2937' }; // Default gray
    },
    [colorSettings],
  );

  // Helper to mix tailwind default and custom style
  const getSectionStyle = useMemo(
    () => (sectionTitle) => {
      const setting = colorSettings.find(
        (s) => s.name === sectionTitle && s.category === 'section',
      );
      if (setting) {
        return {
          header: { backgroundColor: setting.bg_color, color: setting.text_color },
          row: { backgroundColor: setting.bg_color + '4D' },
        };
      }
      return null;
    },
    [colorSettings],
  );

  const getRowStyle = useMemo(
    () => (rowName, sectionStyle) => {
      // Check for specific position color
      const setting = colorSettings.find((s) => s.name === rowName && s.category === 'position');
      if (setting) {
        return {
          backgroundColor: setting.bg_color + '33', // ~20% opacity
          color: setting.text_color,
        };
      }
      // Fallback to section style
      if (sectionStyle) {
        return { backgroundColor: sectionStyle.row.backgroundColor };
      }
      return {};
    },
    [colorSettings],
  );

  const createShiftMutation = useMutation({
    mutationFn: async (data) => {
      const shift = await db.ShiftEntry.create(data);

      // Notify user if admin created it
      if (user?.role === 'admin' && data.doctor_id) {
        const doc = doctors.find((d) => d.id === data.doctor_id);
        if (doc && doc.id !== user.doctor_id) {
          db.ShiftNotification.create({
            doctor_id: data.doctor_id,
            date: data.date,
            type: 'create',
            message: `Neuer Dienst eingetragen: ${data.position}`,
            acknowledged: false,
          });
        }
      }

      // Check for matching wish and auto-approve
      const matchingWish = wishes.find(
        (w) =>
          w.doctor_id === data.doctor_id &&
          w.date === data.date &&
          w.type === 'service' &&
          w.status === 'pending' &&
          (!w.position || w.position === data.position),
      );

      if (matchingWish) {
        await db.WishRequest.update(matchingWish.id, {
          status: 'approved',
          user_viewed: false,
          admin_comment: 'Automatisch genehmigt durch Diensteinteilung',
        });
      }

      return shift;
    },
    onMutate: async (newData) => {
      await queryClient.cancelQueries(['shifts', fetchRange.start, fetchRange.end]);
      const previousShifts = queryClient.getQueryData(['shifts', fetchRange.start, fetchRange.end]);

      const tempShift = { ...newData, id: `temp-${Date.now()}` };
      if (previousShifts) {
        queryClient.setQueryData(['shifts', fetchRange.start, fetchRange.end], (old) => [
          ...old,
          tempShift,
        ]);
      }
      return { previousShifts };
    },
    onSuccess: (data, _newData, _context) => {
      // trackDbChange(); // Disabled - MySQL mode
      setUndoStack((prev) => [...prev, { type: 'DELETE', id: data.id }]);
      // Only invalidate shifts in affected range
      queryClient.invalidateQueries({ queryKey: ['shifts', fetchRange.start, fetchRange.end] });
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
        queryClient.setQueryData(
          ['shifts', fetchRange.start, fetchRange.end],
          context.previousShifts,
        );
      }
      // 409 Conflict = Server-Sentinel blocked a duplicate → silent rollback + refresh
      if (error.message?.includes('Position bereits besetzt') || error.message?.includes('409')) {
        console.warn('[Sentinel] Duplicate blocked by server, refreshing data');
        queryClient.invalidateQueries({ queryKey: ['shifts', fetchRange.start, fetchRange.end] });
        return;
      }
      alert(`Fehler beim Erstellen: ${error.message}`);
    },
  });

  const bulkCreateShiftsMutation = useMutation({
    mutationFn: async (shiftsData) => {
      const createdShifts = await db.ShiftEntry.bulkCreate(shiftsData);

      // Side Effects handling for each created shift
      // Note: bulkCreate returns the created objects
      if (Array.isArray(createdShifts)) {
        for (const shift of createdShifts) {
          // Notifications
          if (user?.role === 'admin' && shift.doctor_id) {
            const doc = doctors.find((d) => d.id === shift.doctor_id);
            if (doc && doc.id !== user.doctor_id) {
              // Fire and forget notification to avoid slowing down
              db.ShiftNotification.create({
                doctor_id: shift.doctor_id,
                date: shift.date,
                type: 'create',
                message: `Neuer Dienst eingetragen: ${shift.position}`,
                acknowledged: false,
              }).catch(console.error);
            }
          }

          // Wish Approval
          const matchingWish = wishes.find(
            (w) =>
              w.doctor_id === shift.doctor_id &&
              w.date === shift.date &&
              w.type === 'service' &&
              w.status === 'pending' &&
              (!w.position || w.position === shift.position),
          );

          if (matchingWish) {
            await db.WishRequest.update(matchingWish.id, {
              status: 'approved',
              user_viewed: false,
              admin_comment: 'Automatisch genehmigt durch Diensteinteilung',
            }).catch(console.error);
          }
        }
      }
      return createdShifts;
    },
    onMutate: async (newShifts) => {
      await queryClient.cancelQueries(['shifts', fetchRange.start, fetchRange.end]);
      const previousShifts = queryClient.getQueryData(['shifts', fetchRange.start, fetchRange.end]);

      const tempShifts = newShifts.map((s, i) => ({ ...s, id: `temp-bulk-${Date.now()}-${i}` }));

      if (previousShifts) {
        queryClient.setQueryData(['shifts', fetchRange.start, fetchRange.end], (old) => [
          ...old,
          ...tempShifts,
        ]);
      }
      return { previousShifts };
    },
    onSuccess: (data, _variables, _context) => {
      // trackDbChange(data.length); // Disabled - MySQL mode
      if (Array.isArray(data)) {
        setUndoStack((prev) => [...prev, { type: 'BULK_DELETE', ids: data.map((s) => s.id) }]);
      }
      queryClient.invalidateQueries({ queryKey: ['shifts', fetchRange.start, fetchRange.end] });
    },
    onError: (error, _variables, context) => {
      console.error('DEBUG: Bulk Create Failed', error);
      if (context?.previousShifts) {
        queryClient.setQueryData(
          ['shifts', fetchRange.start, fetchRange.end],
          context.previousShifts,
        );
      }
      // 409 Conflict = Server-Sentinel blocked duplicates → silent rollback + refresh
      if (error.message?.includes('Position bereits besetzt') || error.message?.includes('409')) {
        console.warn('[Sentinel] Bulk duplicate blocked by server, refreshing data');
        queryClient.invalidateQueries({ queryKey: ['shifts', fetchRange.start, fetchRange.end] });
        return;
      }
      alert(`Fehler beim Erstellen (Bulk): ${error.message}`);
    },
  });

  const updateShiftMutation = useMutation({
    mutationFn: async ({ id, data }) => {
      const shift = await db.ShiftEntry.update(id, data);

      // Check for matching wish and auto-approve
      // Note: data.doctor_id might not be present in update if only position changed,
      // or data.position/date might not be present. We need to merge with existing.
      const fullShift = { ...allShifts.find((s) => s.id === id), ...data };

      const matchingWish = wishes.find(
        (w) =>
          w.doctor_id === fullShift.doctor_id &&
          w.date === fullShift.date &&
          w.type === 'service' &&
          w.status === 'pending' &&
          (!w.position || w.position === fullShift.position),
      );

      if (matchingWish) {
        await db.WishRequest.update(matchingWish.id, {
          status: 'approved',
          user_viewed: false,
          admin_comment: 'Automatisch genehmigt durch Diensteinteilung',
        });
      }

      return shift;
    },
    onMutate: async ({ id, data }) => {
      // Cancel any outgoing refetches to avoid overwriting our optimistic update
      await queryClient.cancelQueries(['shifts', fetchRange.start, fetchRange.end]);

      // Snapshot the previous value for rollback
      const previousShifts = queryClient.getQueryData(['shifts', fetchRange.start, fetchRange.end]);
      const oldShift = previousShifts?.find((s) => s.id === id);

      // Optimistically update to the new value immediately
      if (previousShifts) {
        queryClient.setQueryData(['shifts', fetchRange.start, fetchRange.end], (old) =>
          old.map((s) => (s.id === id ? { ...s, ...data } : s)),
        );
      }

      return { previousShifts, oldShift, newData: data };
    },
    onSuccess: (data, { id, data: inputData }, context) => {
      // trackDbChange(); // Disabled - MySQL mode
      if (context.oldShift) {
        const {
          id: _,
          created_date: _createdDate,
          updated_date: _updatedDate,
          created_by: _createdBy,
          ...oldData
        } = context.oldShift;
        setUndoStack((prev) => [...prev, { type: 'UPDATE', id, data: oldData }]);

        // Notify user if admin updated it
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
                acknowledged: false,
              });
            }
            // Notify new doctor
            if (docId && docId !== user.doctor_id) {
              db.ShiftNotification.create({
                doctor_id: docId,
                date: newShift.date,
                type: 'create',
                message: `Neuer Dienst zugewiesen: ${newShift.position}`,
                acknowledged: false,
              });
            }
          } else if (docId && docId !== user.doctor_id) {
            // Same doctor, details changed
            const changes = [];
            if (context.oldShift.date !== newShift.date)
              changes.push(
                `Datum: ${format(new Date(context.oldShift.date), 'dd.MM')} -> ${format(new Date(newShift.date), 'dd.MM')}`,
              );
            if (context.oldShift.position !== newShift.position)
              changes.push(`Position: ${context.oldShift.position} -> ${newShift.position}`);

            if (changes.length > 0) {
              db.ShiftNotification.create({
                doctor_id: docId,
                date: newShift.date,
                type: 'update',
                message: `Dienständerung: ${changes.join(', ')}`,
                acknowledged: false,
              });
            }
          }
        }
      }
      // Debounced invalidation
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ['shifts', fetchRange.start, fetchRange.end] });
      }, 100);
    },
    onError: (error, _variables, context) => {
      console.error('DEBUG: Update Mutation Failed', error);
      // Rollback to the previous value on error
      if (context?.previousShifts) {
        queryClient.setQueryData(
          ['shifts', fetchRange.start, fetchRange.end],
          context.previousShifts,
        );
      }
      alert(`Fehler beim Aktualisieren: ${error.message}`);
    },
  });

  // Dedicated mutations for automatic background operations
  const createAutoFreiMutation = useMutation({
    mutationFn: (data) => db.ShiftEntry.create(data),
    onSuccess: (data) => {
      setUndoStack((prev) => {
        const undoAction = { type: 'DELETE', id: data.id };
        if (prev.length === 0) return [...prev, undoAction];
        const last = prev[prev.length - 1];
        const newGroup = Array.isArray(last) ? [...last, undoAction] : [last, undoAction];
        return [...prev.slice(0, -1), newGroup];
      });
      setTimeout(
        () =>
          queryClient.invalidateQueries({ queryKey: ['shifts', fetchRange.start, fetchRange.end] }),
        100,
      );
    },
    onError: (error) => console.error('Auto-Frei creation failed:', error),
  });

  const updateAutoFreiMutation = useMutation({
    mutationFn: ({ id, data }) => db.ShiftEntry.update(id, data),
    onMutate: async ({ id }) => {
      const oldShift = allShifts.find((s) => s.id === id);
      return { oldShift };
    },
    onSuccess: (data, { id }, context) => {
      if (context.oldShift) {
        const {
          id: _,
          created_date: _createdDate,
          updated_date: _updatedDate,
          created_by: _createdBy,
          ...oldData
        } = context.oldShift;
        const undoAction = { type: 'UPDATE', id, data: oldData };

        setUndoStack((prev) => {
          if (prev.length === 0) return [...prev, undoAction];
          const last = prev[prev.length - 1];
          const newGroup = Array.isArray(last) ? [...last, undoAction] : [last, undoAction];
          return [...prev.slice(0, -1), newGroup];
        });
      }
      setTimeout(
        () =>
          queryClient.invalidateQueries({ queryKey: ['shifts', fetchRange.start, fetchRange.end] }),
        100,
      );
    },
    onError: (error) => console.error('Auto-Frei update failed:', error),
  });

  const deleteShiftMutation = useMutation({
    mutationFn: async (id) => {
      // Find shift to check for related wish
      const shiftToDelete = allShifts.find((s) => s.id === id);

      if (shiftToDelete) {
        // Find matching approved wish
        const matchingWish = wishes.find(
          (w) =>
            w.doctor_id === shiftToDelete.doctor_id &&
            w.date === shiftToDelete.date &&
            w.status === 'approved' &&
            w.type === 'service' &&
            (!w.position || w.position === shiftToDelete.position),
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
        queryClient.setQueryData(['shifts', fetchRange.start, fetchRange.end], (old) =>
          old.filter((s) => s.id !== id),
        );
      }

      const shift = allShifts.find((s) => s.id === id);
      return { shift, previousShifts };
    },
    onSuccess: (_data, id, context) => {
      // trackDbChange(); // Disabled - MySQL mode
      if (context.shift) {
        const {
          id: _,
          created_date: _createdDate,
          updated_date: _updatedDate,
          created_by: _createdBy,
          ...shiftData
        } = context.shift;
        setUndoStack((prev) => [...prev, { type: 'CREATE', data: shiftData }]);

        if (
          user?.role === 'admin' &&
          context.shift.doctor_id &&
          context.shift.doctor_id !== user.doctor_id
        ) {
          db.ShiftNotification.create({
            doctor_id: context.shift.doctor_id,
            date: context.shift.date,
            type: 'delete',
            message: `Dienst gestrichen: ${context.shift.position}`,
            acknowledged: false,
          });
        }
      }
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ['shifts', fetchRange.start, fetchRange.end] });
      }, 100);
    },
    onError: (error, id, context) => {
      console.error('DEBUG: Delete Mutation Failed', { id, error });
      if (context?.previousShifts) {
        queryClient.setQueryData(
          ['shifts', fetchRange.start, fetchRange.end],
          context.previousShifts,
        );
      }
      alert(`Fehler beim Löschen: ${error.message}`);
    },
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: async (ids) => {
      await Promise.all(ids.map((id) => db.ShiftEntry.delete(id)));
    },
    onMutate: async (ids) => {
      await queryClient.cancelQueries(['shifts', fetchRange.start, fetchRange.end]);
      const previousShifts = queryClient.getQueryData(['shifts', fetchRange.start, fetchRange.end]);

      if (previousShifts) {
        queryClient.setQueryData(['shifts', fetchRange.start, fetchRange.end], (old) =>
          old.filter((s) => !ids.includes(s.id)),
        );
      }

      const shifts = allShifts.filter((s) => ids.includes(s.id));
      return { shifts, previousShifts };
    },
    onError: (err, _ids, context) => {
      if (context?.previousShifts) {
        queryClient.setQueryData(
          ['shifts', fetchRange.start, fetchRange.end],
          context.previousShifts,
        );
      }
      alert('Fehler beim Löschen: ' + err.message);
    },
    onSuccess: (_data, ids, context) => {
      // trackDbChange(ids.length); // Disabled - MySQL mode
      if (context.shifts && context.shifts.length > 0) {
        const shiftsData = context.shifts.map((s) => {
          const {
            id: _id,
            created_date: _createdDate,
            updated_date: _updatedDate,
            created_by: _createdBy,
            ...rest
          } = s;
          return rest;
        });
        setUndoStack((prev) => [...prev, { type: 'BULK_CREATE', data: shiftsData }]);
      }
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ['shifts', fetchRange.start, fetchRange.end] });
      }, 100);
    },
  });

  const createNoteMutation = useMutation({
    mutationFn: (data) => db.ScheduleNote.create(data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['scheduleNotes'] }),
  });

  const updateNoteMutation = useMutation({
    mutationFn: ({ id, data }) => db.ScheduleNote.update(id, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['scheduleNotes'] }),
  });

  const deleteNoteMutation = useMutation({
    mutationFn: (id) => db.ScheduleNote.delete(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['scheduleNotes'] }),
  });

  // ScheduleBlock mutations
  const createBlockMutation = useMutation({
    mutationFn: (data) => db.ScheduleBlock.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['scheduleBlocks'] });
      toast.success('Zelle gesperrt');
    },
  });

  const deleteBlockMutation = useMutation({
    mutationFn: (id) => db.ScheduleBlock.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['scheduleBlocks'] });
      toast.success('Sperrung aufgehoben');
    },
  });

  const absencePositions = ['Frei', 'Krank', 'Urlaub', 'Dienstreise', 'Nicht verfügbar'];

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
  const checkConflictsWithOverride = (
    doctorId,
    dateStr,
    newPosition,
    excludeShiftId = null,
    onProceed = null,
  ) => {
    const result = validate(doctorId, dateStr, newPosition, { excludeShiftId });
    const doctor = doctors.find((d) => d.id === doctorId);

    // Bei Blockern: Override-Dialog anzeigen
    if (result.blockers.length > 0) {
      requestOverride({
        blockers: result.blockers,
        warnings: result.warnings,
        doctorId,
        doctorName: doctor?.name,
        date: dateStr,
        position: newPosition,
        onConfirm: onProceed,
      });
      return true; // Blockiert - warte auf Override-Bestätigung
    }

    // Warnungen anzeigen (kein Blocker)
    if (result.warnings.length > 0) {
      toast.warning(result.warnings.join('\n'));
    }

    return false; // Nicht blockiert
  };

  // Legacy-Wrapper für Stellen die noch nicht umgestellt sind
  const checkConflicts = (
    doctorId,
    dateStr,
    newPosition,
    isVoice = false,
    excludeShiftId = null,
  ) => {
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
    const limitWarnings = result.warnings.filter((w) => w.includes('Dienstlimit'));
    return limitWarnings.length > 0 ? limitWarnings.join('\n') : null;
  };

  // Prüfung beim Drag in Abwesenheit: Warnung falls bestehende Einträge gelöscht werden
  // Kombiniert Dienst-Lösch-Warnung + Staffing-Check in einem Dialog
  const checkAbsenceDropConflicts = (
    doctorId,
    dateStr,
    position,
    onProceed,
    excludeShiftId = null,
  ) => {
    const doctor = doctors.find((d) => d.id === doctorId);
    const shiftsToDelete = currentWeekShifts.filter(
      (s) =>
        s.doctor_id === doctorId &&
        s.date === dateStr &&
        s.id !== excludeShiftId &&
        !absencePositions.includes(s.position),
    );

    // Staffing-Warnungen prüfen
    const result = validate(doctorId, dateStr, position, {});
    const staffingWarnings = result.warnings.filter(
      (w) => w.includes('Mindestbesetzung') || w.includes('anwesend'),
    );

    if (shiftsToDelete.length === 0 && staffingWarnings.length === 0) {
      return false; // Kein Konflikt
    }

    const messages = [];
    if (shiftsToDelete.length > 0) {
      const entries = shiftsToDelete.map((s) => `"${s.position}"`).join(', ');
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
      onConfirm: onProceed,
    });
    return true; // Blockiert - warte auf Override
  };

  const weekDays = useMemo(() => {
    if (!isValid(currentDate)) return [];
    if (viewMode === 'day') {
      return [currentDate];
    }
    if (viewMode === 'month') {
      return eachDayOfInterval({
        start: startOfMonth(currentDate),
        end: endOfMonth(currentDate),
      });
    }
    const start = startOfWeek(currentDate, { weekStartsOn: 1 });
    return Array.from({ length: 7 }).map((_, i) => addDays(start, i));
  }, [currentDate, viewMode]);

  const rowLabelWidth = isMonthView ? 160 : 200;
  const matrixGridStyle = useMemo(
    () => ({
      gridTemplateColumns:
        viewMode === 'day'
          ? `${rowLabelWidth}px minmax(0, 1fr)`
          : `${rowLabelWidth}px repeat(${weekDays.length}, minmax(${isMonthView ? 38 : 0}px, 1fr))`,
    }),
    [viewMode, rowLabelWidth, weekDays.length, isMonthView],
  );

  const matrixMinWidth = useMemo(() => {
    if (viewMode === 'day') return rowLabelWidth + 480;
    return rowLabelWidth + weekDays.length * (isMonthView ? 38 : 90);
  }, [viewMode, rowLabelWidth, weekDays.length, isMonthView]);

  // Sidebar-Ärzte filtern: Ausgeschiedene, KO, MS, 0.0 FTE ausblenden
  const sidebarDoctors = useMemo(() => {
    if (!weekDays.length || !doctors.length) return doctors;
    const checkDate = viewMode === 'month' ? currentDate : weekDays[0];
    return sortDoctorsForDisplay(
      doctors.filter((doc) => isDoctorAvailable(doc, checkDate, staffingPlanEntries)),
    );
  }, [currentDate, doctors, sortDoctorsAlphabetically, staffingPlanEntries, viewMode, weekDays]);

  const currentWeekShifts = useMemo(() => {
    // Use weekDays to determine range, ensuring we catch shifts for visible days
    if (weekDays.length === 0) return [];

    const start = weekDays[0];
    if (!isValid(start)) return [];

    const end = addDays(weekDays[weekDays.length - 1], 1);
    if (!isValid(end)) return [];

    const startStr = format(start, 'yyyy-MM-dd');
    const endStr = format(end, 'yyyy-MM-dd'); // end is exclusive in logic below, but for string range let's be careful

    const dbShifts = allShifts.filter((s) => {
      // Robust string comparison to avoid timezone issues
      return s.date >= startStr && s.date < endStr;
    });

    if (previewShifts) {
      // Add temporary IDs to preview shifts if they don't have them, to avoid key errors
      const formattedPreview = previewShifts.map((s, i) => ({
        ...s,
        id: s.id || `preview-${i}`,
        isPreview: true,
      }));
      return [...dbShifts, ...formattedPreview];
    }

    return dbShifts;
  }, [allShifts, currentDate, previewShifts]);

  // Pro Arzt: Geplante Stunden in der aktuellen Woche berechnen
  const weeklyPlannedHours = useMemo(() => {
    if (!weekDays.length || !currentWeekShifts.length) return new Map();
    const map = new Map();
    const weekStart = format(weekDays[0], 'yyyy-MM-dd');
    const weekEnd = format(weekDays[weekDays.length - 1], 'yyyy-MM-dd');
    for (const shift of currentWeekShifts) {
      if (shift.date < weekStart || shift.date > weekEnd) continue;
      if (!shift.doctor_id) continue;
      const pos = shift.position?.toLowerCase() || '';
      if (
        pos.includes('urlaub') ||
        pos.includes('frei') ||
        pos.includes('krank') ||
        pos === 'az' ||
        pos === 'ko' ||
        pos === 'ez' ||
        pos === 'ms'
      )
        continue;
      let hours = 0;
      if (shift.start_time && shift.end_time) {
        const [sh, sm] = shift.start_time.split(':').map(Number);
        const [eh, em] = shift.end_time.split(':').map(Number);
        let mins = eh * 60 + em - (sh * 60 + sm);
        if (mins < 0) mins += 24 * 60;
        mins -= shift.break_minutes || 0;
        hours = mins / 60;
      } else {
        // Fallback: target_weekly_hours / 5, Modell, oder FTE
        const doc = doctors.find((d) => d.id === shift.doctor_id);
        if (doc?.target_weekly_hours) {
          hours = Number(doc.target_weekly_hours) / 5;
        } else {
          const model = doc?.work_time_model_id
            ? workTimeModelMap.get(doc.work_time_model_id)
            : null;
          if (model) {
            hours = Number(model.hours_per_day);
          } else if (doc?.fte && Number(doc.fte) > 0) {
            hours = Number(doc.fte) * 7.7; // 38.5h / 5 Tage
          }
        }
      }
      map.set(shift.doctor_id, (map.get(shift.doctor_id) || 0) + hours);
    }
    return map;
  }, [currentWeekShifts, weekDays, doctors, workTimeModelMap]);

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
      queryClient.setQueryData(
        ['shifts', fetchRange.start, fetchRange.end],
        (old) => old?.filter((s) => s.id !== shift.id) || [],
      );
      return;
    }

    console.log(
      `[DEBUG-LOG] deleteShiftWithCleanup triggered for Shift ${shift.id} (${shift.position})`,
    );
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
    const hasExisting =
      allMerged.some(
        (s) => s.date === autoFreiDateStr && s.doctor_id === doctorId && !s.isPreview,
      ) || previewMerged.some((s) => s.date === autoFreiDateStr && s.doctor_id === doctorId);
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
    const filtered = currentPreviews.filter((s) => {
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
      console.log(
        '[PREVIEW] Hinweis: DB-basiertes Auto-Frei gefunden, wird beim Übernehmen bereinigt:',
        dbAutoFrei.id,
      );
    }

    return filtered;
  };

  const isWorkplaceActiveOnDate = (positionName, dateStr) => {
    const workplace = workplaces.find((entry) => entry.name === positionName);
    if (!workplace) return true;
    const activeDays =
      workplace.active_days && workplace.active_days.length > 0
        ? workplace.active_days
        : [1, 2, 3, 4, 5];
    const date = new Date(`${dateStr}T00:00:00`);
    const dayOfWeek = date.getDay();
    if (isPublicHoliday(date)) {
      return activeDays.some((day) => Number(day) === 0);
    }
    return activeDays.some((day) => Number(day) === dayOfWeek);
  };

  const findOccupyingShift = (dateStr, position, ignoreShiftId = null) => {
    const targetWorkplace = workplaces.find((entry) => entry.name === position);
    if (!targetWorkplace) return null;

    const customCategories = getWorkplaceCategoriesFromSettings(systemSettings);
    const allowsMultiple = workplaceAllowsMultiple(targetWorkplace, customCategories);
    if (allowsMultiple) return null;

    return currentWeekShifts.find(
      (shift) =>
        shift.date === dateStr && shift.position === position && shift.id !== ignoreShiftId,
    );
  };

  const cleanupOtherShifts = (doctorId, dateStr, currentShiftId = null) => {
    const shiftsToDelete = currentWeekShifts.filter(
      (shift) =>
        shift.doctor_id === doctorId && shift.date === dateStr && shift.id !== currentShiftId,
    );
    shiftsToDelete.forEach((shift) => deleteShiftMutation.mutate(shift.id));
  };

  const handlePostShiftOff = (doctorId, dateStr, positionName) => {
    const autoFreiDateStr = shouldCreateAutoFrei(positionName, dateStr, isPublicHoliday);
    if (!autoFreiDateStr) return;

    const nextDay = new Date(autoFreiDateStr);
    const warning = checkStaffing(autoFreiDateStr, doctorId);
    if (warning) {
      alert(
        `${warning}\n\n(Durch automatischen Freizeitausgleich am ${format(nextDay, 'dd.MM.')})`,
      );
    }

    const existingShift = allShifts.find(
      (shift) => shift.date === autoFreiDateStr && shift.doctor_id === doctorId,
    );
    if (!existingShift) {
      createAutoFreiMutation.mutate({
        date: autoFreiDateStr,
        position: 'Frei',
        doctor_id: doctorId,
        note: 'Autom. Freizeitausgleich',
      });
      return;
    }

    if (
      existingShift.position !== 'Frei' &&
      window.confirm(
        `Für den Folgetag (${format(nextDay, 'dd.MM.')}) existiert bereits ein Eintrag "${existingShift.position}". Soll dieser durch "Frei" ersetzt werden?`,
      )
    ) {
      updateAutoFreiMutation.mutate({
        id: existingShift.id,
        data: { position: 'Frei', note: 'Autom. Freizeitausgleich' },
      });
    }
  };

  const {
    blockContextMenu,
    setBlockContextMenu,
    blockReasonInput,
    setBlockReasonInput,
    draggingDoctorId,
    draggingShiftId,
    handleCellContextMenu,
    handleBlockCell,
    handleUnblockCell,
    handleClearWeek,
    handleClearDay,
    handleClearRow,
    handleBeforeCapture,
    handleDragStart,
    handleDragUpdate,
    handleDragEnd,
  } = useScheduleBoardInteractions({
    isReadOnly,
    currentDate,
    currentWeekShifts,
    allShifts,
    workplaces,
    workplaceTimeslots,
    sidebarDoctors,
    previewShifts,
    setPreviewShifts,
    setPreviewCategories,
    setCollapsedTimeslotGroups,
    setUndoStack,
    queryClient,
    fetchRange,
    getScheduleBlock,
    isPublicHoliday,
    isCtrlPressed,
    lockCell,
    collapsedSections,
    setCollapsedSections,
    collapsedTimeslotGroups,
    createBlockMutation,
    deleteBlockMutation,
    bulkDeleteMutation,
    bulkCreateShiftsMutation,
    createShiftMutation,
    updateShiftMutation,
    updateDoctorMutation,
    updateAutoFreiMutation,
    bulkCreateShifts: db.ShiftEntry.bulkCreate,
    shouldCreateAutoFrei,
    checkConflicts,
    checkConflictsWithOverride,
    checkAbsenceDropConflicts,
    checkStaffing,
    checkLimits,
    isWorkplaceActiveOnDate,
    findOccupyingShift,
    cleanupOtherShifts,
    handlePostShiftOff,
    deleteShiftWithCleanup,
    cleanupAutoFrei: cleanupAutoFreiOnly,
    cleanupAutoFreiOnly,
    addPreviewAutoFrei,
    removePreviewAutoFrei,
    isAutoOffPosition,
    sections,
  });

  const { isExporting, handleExportExcel, applyPreview, cancelPreview } = useScheduleBoardCommands({
    weekDays,
    hiddenRows,
    previewShifts,
    setPreviewShifts,
    setPreviewCategories,
    bulkCreateShifts: db.ShiftEntry.bulkCreate,
    exportScheduleToExcel: api.exportScheduleToExcel,
    queryClient,
    toast,
    alert: (message) => alert(message),
  });

  const handleAutoFill = (categories = null) => {
    setIsGenerating(true);
    try {
      const autoFillDebugEnabled =
        (systemSettings.find((s) => s.key === 'autofill_debug_enabled')?.value ||
          systemSettings.find((s) => s.key === 'ai_autofill_debug_enabled')?.value) === 'true';
      const autoFillDebugEntries = [];
      const autoFillRequestId = `af-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

      // Determine which categories to fill
      const allCategories = [
        'Rotationen',
        'Dienste',
        'Demonstrationen & Konsile',
        ...getWorkplaceCategoryNames(systemSettings),
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
        existingShifts: currentWeekShifts.filter((s) => !s.isPreview),
        allShifts,
        trainingRotations,
        isPublicHoliday,
        getDoctorQualIds,
        getWpRequiredQualIds,
        getWpOptionalQualIds,
        getWpExcludedQualIds,
        getWpDiscouragedQualIds,
        categoriesToFill: allCategories, // always compute ALL
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
          workplaces.filter((wp) => selectedCategories.includes(wp.category)).map((wp) => wp.name),
        );
        // Also include absence positions that may be generated (e.g. Auto-Frei)
        const absencePositions = [
          'Frei',
          'Krank',
          'Urlaub',
          'Dienstreise',
          'Nicht verfügbar',
          'Verfügbar',
        ];

        filtered = result.filter((s) => {
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
        toast.success(
          `${filtered.length} Vorschläge generiert` +
            (categories ? ` (${result.length} insgesamt berechnet)` : ''),
        );

        if (autoFillDebugEnabled && result.__debug?.entries?.length) {
          console.groupCollapsed(
            `🧭 AutoFill Debug (${result.__debug.requestId}) — ${result.__debug.entries.length} Events`,
          );
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

    const serviceWps = workplaces.filter((w) => w.category === 'Dienste');
    if (serviceWps.length === 0) return {};
    const serviceNames = new Set(serviceWps.map((w) => w.name));
    const sorted = [...serviceWps].sort((a, b) => (a.order || 0) - (b.order || 0));
    const fgName = sorted[0]?.name;
    const bgName = sorted[1]?.name;

    // Collect all doctor IDs that have a service in preview
    const previewServiceShifts = previewShifts.filter((s) => serviceNames.has(s.position));
    if (previewServiceShifts.length === 0) return {};

    const doctorIds = new Set(previewServiceShifts.map((s) => s.doctor_id));

    // 4-week window relative to planning dates (mirrors autoFillEngine logic):
    //   3 weeks before first preview date → last preview date
    const previewDates = previewServiceShifts.map((s) => s.date).sort();
    const firstPlanStr = previewDates[0];
    const lastPlanStr = previewDates[previewDates.length - 1];
    const fourWeekStart = new Date(firstPlanStr + 'T00:00:00');
    fourWeekStart.setDate(fourWeekStart.getDate() - 21); // 3 weeks back
    const fourWeekStartStr = format(fourWeekStart, 'yyyy-MM-dd');

    // Count services per doctor from DB shifts (fairnessShifts) + preview shifts
    const result = {};
    for (const docId of doctorIds) {
      // 1) Historical DB shifts (non-preview)
      const docShifts = fairnessShifts.filter(
        (s) =>
          s.doctor_id === docId &&
          s.date >= fourWeekStartStr &&
          s.date <= lastPlanStr &&
          serviceNames.has(s.position) &&
          !s.isPreview,
      );

      let fg = 0,
        bg = 0,
        weekendCount = 0;
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
      const docPreviewShifts = previewServiceShifts.filter((s) => s.doctor_id === docId);
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
  const getFairnessInfo = useMemo(
    () => (shift) => {
      if (!shift.isPreview || !previewFairnessData[shift.doctor_id]) return null;

      const serviceWps = workplaces.filter((w) => w.category === 'Dienste');
      const serviceNames = new Set(serviceWps.map((w) => w.name));
      if (!serviceNames.has(shift.position)) return null;

      const info = { ...previewFairnessData[shift.doctor_id] };

      // Check wishes for this date+doctor
      const shiftWishes = wishes.filter(
        (w) => w.doctor_id === shift.doctor_id && w.date === shift.date,
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
    },
    [previewFairnessData, workplaces, wishes],
  );

  const getDoctorDayWishes = useMemo(
    () => (doctorId, dateStr) => {
      return wishes.filter(
        (w) => w.doctor_id === doctorId && w.date === dateStr && w.status !== 'rejected',
      );
    },
    [wishes],
  );

  const buildWishTooltip = useMemo(
    () =>
      (doctor, doctorWishes = []) => {
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
      },
    [],
  );

  const getShiftWishMarker = useMemo(
    () => (shift) => {
      if (!shift) return null;

      const workplace = workplaces.find((w) => w.name === shift.position);
      if (workplace?.category !== 'Dienste') return null;

      const doctorWishes = getDoctorDayWishes(shift.doctor_id, shift.date);
      if (!doctorWishes.length) return null;

      const matchingServiceWish = doctorWishes.find(
        (w) => w.type === 'service' && (!w.position || w.position === shift.position),
      );
      if (matchingServiceWish) {
        return {
          color: 'green',
          title: `Dienstwunsch erfüllt: ${matchingServiceWish.position || shift.position}`,
        };
      }

      const conflictingNoServiceWish = doctorWishes.find(
        (w) => w.type === 'no_service' && (!w.position || w.position === shift.position),
      );
      if (conflictingNoServiceWish) {
        return {
          color: 'red',
          title: `Kein-Dienst-Wunsch verletzt: ${conflictingNoServiceWish.position || shift.position}`,
        };
      }

      return null;
    },
    [getDoctorDayWishes, workplaces],
  );

  const renderCellShifts = useMemo(
    () =>
      (
        date,
        rowName,
        isSectionFullWidth,
        timeslotId = null,
        allTimeslotIds = null,
        singleTimeslotId = null,
        dragIdPrefix = '',
        cellWidth = null,
      ) => {
        // Wait for color settings to load
        if (isLoadingColors) return null;
        if (!isValid(date)) return null;
        const dateStr = format(date, 'yyyy-MM-dd');

        // Filter shifts by position and optionally by timeslot_id
        let shifts = currentWeekShifts
          .filter((s) => {
            if (s.date !== dateStr || s.position !== rowName) return false;

            // Fall 0: Einzelner Timeslot - zeige nur Shifts dieses Timeslots + Shifts ohne Timeslot
            // Verhält sich wie normale Zeile, aber inkludiert Shifts des einzigen Timeslots
            if (singleTimeslotId) {
              return s.timeslot_id === singleTimeslotId || !s.timeslot_id;
            }

            // Fall 1: Eingeklappte Gruppe - zeige ALLE Shifts aus allen Timeslots + Shifts ohne Timeslot
            if (allTimeslotIds && allTimeslotIds.length > 0) {
              return allTimeslotIds.includes(s.timeslot_id) || !s.timeslot_id;
            }

            // Fall 2: "Nicht zugewiesen" Zeile - zeige nur Shifts ohne timeslot_id
            if (timeslotId === '__unassigned__') {
              return !s.timeslot_id;
            }

            // Fall 3: Spezifische timeslotId angegeben (Timeslot-Unterzeile)
            if (timeslotId !== null) {
              return s.timeslot_id === timeslotId;
            }

            // Fall 4: Gruppen-Header (isTimeslotGroupHeader mit timeslotId === null)
            // Zeigt nichts direkt an - Shifts werden in Unterzeilen oder "Nicht zugewiesen" angezeigt
            const workplace = workplaces.find((w) => w.name === rowName);
            if (workplace?.timeslots_enabled) {
              // Bei aktivierten Timeslots: Header-Zeile zeigt keine Shifts (werden in Unterzeilen gezeigt)
              return false;
            }

            // Arbeitsplatz hat keine Timeslots - zeige alle Shifts
            return true;
          })
          .sort((a, b) => (a.order || 0) - (b.order || 0));

        // Bei eingeklappter Gruppe: Dedupliziere Ärzte, die in mehreren Timeslots eingetragen sind
        // Zeige jeden Arzt nur EINMAL an, auch wenn er in allen Timeslots ist
        if (allTimeslotIds && allTimeslotIds.length > 0) {
          const seenDoctorIds = new Set();
          shifts = shifts.filter((shift) => {
            if (seenDoctorIds.has(shift.doctor_id)) {
              return false; // Duplikat überspringen
            }
            seenDoctorIds.add(shift.doctor_id);
            return true;
          });
        }

        const isSingleShift = shifts.length === 1;
        const isSplitModeActive = isEmbeddedSchedule || isSplitViewEnabled;
        const boxSize = shiftBoxSize;

        // Qualifikations-Status für diese Position ermitteln
        const workplace = workplaces.find((w) => w.name === rowName);
        const wpRequiredQuals = workplace ? getWpRequiredQualIds(workplace.id) : [];
        const wpExcludedQuals = workplace ? getWpExcludedQualIds(workplace.id) : [];
        const hasQualRequirements = wpRequiredQuals.length > 0;

        // Bei Mehrfachbesetzung: Warnung nur wenn KEINER der Eingetragenen qualifiziert ist
        let anyoneQualified = false;
        if (hasQualRequirements && shifts.length > 1) {
          anyoneQualified = shifts.some((s) => {
            const docQuals = getDoctorQualIds(s.doctor_id);
            return wpRequiredQuals.every((qId) => docQuals.includes(qId));
          });
        }

        return shifts.map((shift, index) => {
          const doctor = doctors.find((d) => d.id === shift.doctor_id);
          if (!doctor) return null;
          const compactLabel = getDoctorChipLabel(doctor);

          // Timeslot-Label für Badge (nur bei eingeklappter Gruppe)
          let shiftTimeslotLabel = null;
          let shiftTimeslotLabelTone = 'default';
          if (allTimeslotIds && allTimeslotIds.length > 0 && shift.timeslot_id) {
            const badgeInfo = getShiftTimeslotBadge(
              shift,
              doctor,
              workplaceTimeslots,
              workTimeModelMap,
            );
            shiftTimeslotLabel = badgeInfo.label;
            shiftTimeslotLabelTone = badgeInfo.tone;
          }

          // Qualifikations-Indikator
          // 'excluded' wenn Arzt eine NOT-Qualifikation hat (harter Fehler)
          // 'unqualified' wenn Pflicht-Qualifikation fehlt und kein qualifizierter Kollege da ist
          let qualificationStatus = null;
          const docQuals = getDoctorQualIds(doctor.id);
          if (wpExcludedQuals.length > 0 && wpExcludedQuals.some((qId) => docQuals.includes(qId))) {
            qualificationStatus = 'excluded';
          } else if (hasQualRequirements) {
            const hasAll = wpRequiredQuals.every((qId) => docQuals.includes(qId));
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
            boxSize,
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
                    marginBottom: '4px',
                  }}
                >
                  <span
                    className={`${isMonthView ? 'whitespace-nowrap leading-none' : 'truncate'} px-1`}
                  >
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
                timeslotLabel={shiftTimeslotLabel}
                timeslotLabelTone={shiftTimeslotLabelTone}
              />
            </div>
          );
        });
      },
    [
      currentWeekShifts,
      doctors,
      draggingShiftId,
      isCtrlPressed,
      shiftBoxSize,
      effectiveGridFontSize,
      isReadOnly,
      user,
      highlightMyName,
      showInitialsOnly,
      colorSettings,
      isLoadingColors,
      getRoleColor,
      workplaces,
      workplaceTimeslots,
      getDoctorQualIds,
      getWpRequiredQualIds,
      getWpExcludedQualIds,
      getFairnessInfo,
      getShiftWishMarker,
      isEmbeddedSchedule,
      isSplitViewEnabled,
      isMonthView,
      getDoctorChipLabel,
    ],
  );

  // Render clone for shift drags from cells - matches sidebar behavior
  const renderShiftClone = useMemo(
    () => (provided, snapshot, rubric) => {
      const draggableId = normalizeDraggableId(rubric.draggableId);
      if (!draggableId.startsWith('shift-')) return null;

      const shiftId = draggableId.replace('shift-', '');
      const shift = currentWeekShifts.find((s) => s.id === shiftId);
      if (!shift) return null;

      const doctor = doctors.find((d) => d.id === shift.doctor_id);
      if (!doctor) return null;
      const compactLabel = getDoctorChipLabel(doctor);

      const roleColor = getRoleColor(doctor.role);
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
              backgroundColor: roleColor?.backgroundColor || '#f1f5f9',
              color: roleColor?.color || '#0f172a',
              width: `${cloneSize}px`,
              height: `${cloneSize}px`,
              fontSize: `${effectiveGridFontSize}px`,
              zIndex: 9999,
            }}
          >
            <span>{compactLabel}</span>
          </div>
        </div>
      );
    },
    [
      currentWeekShifts,
      doctors,
      getRoleColor,
      shiftBoxSize,
      effectiveGridFontSize,
      getDoctorChipLabel,
    ],
  );

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
        <ScheduleToolbar
          viewMode={viewMode}
          setViewMode={setViewMode}
          currentDate={currentDate}
          setCurrentDate={setCurrentDate}
          weekDays={weekDays}
          undoStack={undoStack}
          onUndo={handleUndo}
          previewShifts={previewShifts}
          onApplyPreview={applyPreview}
          onCancelPreview={cancelPreview}
          isReadOnly={isReadOnly}
          isGenerating={isGenerating}
          onAutoFill={handleAutoFill}
          getSectionName={getSectionName}
          systemSettings={systemSettings}
          isExporting={isExporting}
          onExportExcel={handleExportExcel}
          currentWeekShiftsCount={currentWeekShifts.length}
          onClearWeek={handleClearWeek}
          showSidebar={showSidebar}
          setShowSidebar={setShowSidebar}
          highlightMyName={highlightMyName}
          setHighlightMyName={setHighlightMyName}
          showInitialsOnly={showInitialsOnly}
          setShowInitialsOnly={setShowInitialsOnly}
          sortDoctorsAlphabetically={sortDoctorsAlphabetically}
          setSortDoctorsAlphabetically={setSortDoctorsAlphabetically}
          gridFontSize={gridFontSize}
          setGridFontSize={setGridFontSize}
          hiddenRows={hiddenRows}
          setHiddenRows={setHiddenRows}
          sections={sections}
          availableSectionTabs={availableSectionTabs}
          activeSectionTabId={activeSectionTabId}
          setActiveSectionTabId={setActiveSectionTabId}
          canUseSplitView={canUseSplitView}
          isSplitViewEnabled={isSplitViewEnabled}
          setIsSplitViewEnabled={setIsSplitViewEnabled}
          onOpenSectionTabInSplitView={handleOpenSectionTabInSplitView}
          onOpenSectionTabInNewWindow={handleOpenSectionTabInNewWindow}
          onCloseSectionTab={handleCloseSectionTab}
        />
      )}

      <DragDropContext
        onBeforeCapture={handleBeforeCapture}
        onDragStart={handleDragStart}
        onDragUpdate={handleDragUpdate}
        onDragEnd={handleDragEnd}
        autoScrollerOptions={{ disabled: true }}
      >
        <ScheduleBoardDesktopLayout
          showSidebar={showSidebar}
          isEmbeddedSchedule={isEmbeddedSchedule}
          sidebarDoctors={sidebarDoctors}
          viewMode={viewMode}
          isMonthView={isMonthView}
          isReadOnly={isReadOnly}
          draggingDoctorId={draggingDoctorId}
          workTimeModelMap={workTimeModelMap}
          weeklyPlannedHours={weeklyPlannedHours}
          getRoleColor={getRoleColor}
          getDoctorChipLabel={getDoctorChipLabel}
          shiftBoxSize={shiftBoxSize}
          effectiveGridFontSize={effectiveGridFontSize}
          matrixMinWidth={matrixMinWidth}
          matrixGridStyle={matrixGridStyle}
          weekDays={weekDays}
          currentWeekShifts={currentWeekShifts}
          isPublicHoliday={isPublicHoliday}
          isSchoolHoliday={isSchoolHoliday}
          sortDoctorsForDisplay={sortDoctorsForDisplay}
          doctors={doctors}
          sections={sections}
          handleClearDay={handleClearDay}
          hiddenRows={hiddenRows}
          collapsedTimeslotGroups={collapsedTimeslotGroups}
          collapsedSections={collapsedSections}
          getSectionStyle={getSectionStyle}
          getRowStyle={getRowStyle}
          setCollapsedSections={setCollapsedSections}
          getSectionName={getSectionName}
          activeSectionTabId={activeSectionTabId}
          handleMoveSectionToTab={handleMoveSectionToTab}
          pinnedSectionTitle={PINNED_SECTION_TITLE}
          draggingShiftId={draggingShiftId}
          workplaces={workplaces}
          trainingRotations={trainingRotations}
          getScheduleBlock={getScheduleBlock}
          handleCellContextMenu={handleCellContextMenu}
          renderShiftClone={renderShiftClone}
          renderCellShifts={renderCellShifts}
          user={user}
          highlightMyName={highlightMyName}
          getDoctorDayWishes={getDoctorDayWishes}
          buildWishTooltip={buildWishTooltip}
          scheduleNotesMap={scheduleNotesMap}
          scheduleNotes={scheduleNotes}
          createNoteMutation={createNoteMutation}
          updateNoteMutation={updateNoteMutation}
          deleteNoteMutation={deleteNoteMutation}
          toggleTimeslotGroup={toggleTimeslotGroup}
          setHiddenRows={setHiddenRows}
          handleClearRow={handleClearRow}
          canUseSplitView={canUseSplitView}
          isSplitViewEnabled={isSplitViewEnabled}
          splitSections={splitSections}
        />
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

      {/* Schedule Block Context Menu */}
      {blockContextMenu && (
        <>
          <div className="fixed inset-0 z-[9998]" onClick={() => setBlockContextMenu(null)} />
          <div
            className="fixed z-[9999] bg-white rounded-lg shadow-xl border border-slate-200 p-3 min-w-[220px]"
            style={{ left: blockContextMenu.x, top: blockContextMenu.y }}
          >
            <div className="text-xs text-slate-500 mb-2 font-medium">
              {blockContextMenu.position} — {blockContextMenu.dateStr}
            </div>
            {blockContextMenu.existingBlock ? (
              <>
                <div className="text-sm text-red-700 mb-2 flex items-center gap-1.5">
                  <Lock className="w-3.5 h-3.5" />
                  Gesperrt
                  {blockContextMenu.existingBlock.reason
                    ? `: ${blockContextMenu.existingBlock.reason}`
                    : ''}
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
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleBlockCell();
                  }}
                  className="w-full text-sm border border-slate-200 rounded px-2 py-1 mb-2 focus:outline-none focus:ring-1 focus:ring-red-300"
                  autoFocus
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
          </div>
        </>
      )}
    </div>
  );
}
