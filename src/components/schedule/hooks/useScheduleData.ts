import { useMemo } from 'react';
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { format, startOfMonth, endOfMonth, addMonths, subDays, isValid } from 'date-fns';
import { db, api } from '@/api/client';

// The db/api client is untyped JS — use explicit any to preserve original call semantics
const _db: any = db;
const _api: any = api;
import { useTeamRoles } from '@/components/settings/TeamRoleSettings';
import { SECTION_TABS_KEY } from '../utils/scheduleConstants';
import { parseSectionTabs } from '../utils/scheduleFormatters';

interface DateRange {
  start: string;
  end: string;
}

/**
 * Encapsulates all read-only data fetching for the schedule board.
 * Takes currentDate as the sole external dependency and returns all
 * query results needed by the schedule UI.
 */
export function useScheduleData(currentDate: Date | string) {
  const queryClient = useQueryClient();
  const { rolePriority } = useTeamRoles();

  // --- Date ranges ---
  const fetchRange: DateRange = useMemo(() => {
    const d = typeof currentDate === 'string' ? new Date(currentDate) : currentDate;
    if (!isValid(d)) {
      console.warn('Invalid currentDate detected, using fallback range');
      return { start: format(new Date(), 'yyyy-MM-dd'), end: format(new Date(), 'yyyy-MM-dd') };
    }
    const start = startOfMonth(addMonths(d, -1));
    const end = endOfMonth(addMonths(d, 1));
    return { start: format(start, 'yyyy-MM-dd'), end: format(end, 'yyyy-MM-dd') };
  }, [currentDate]);

  const fairnessRange: DateRange = useMemo(() => {
    const s = new Date(fetchRange.start + 'T00:00:00');
    const histStart = subDays(s, 21);
    return { start: format(histStart, 'yyyy-MM-dd'), end: fetchRange.end };
  }, [fetchRange]);

  const staffingYear = useMemo(
    () => (currentDate ? new Date(currentDate).getFullYear() : new Date().getFullYear()),
    [currentDate],
  );

  // --- Queries ---
  const { data: doctors = [] } = useQuery({
    queryKey: ['doctors'],
    queryFn: () => _db.Doctor.list(),
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    select: (data) =>
      [...data].sort((a, b) => {
        const roleDiff = (rolePriority[a.role] ?? 99) - (rolePriority[b.role] ?? 99);
        if (roleDiff !== 0) return roleDiff;
        return (a.order || 0) - (b.order || 0);
      }),
  });

  const { data: allShifts = [] } = useQuery({
    queryKey: ['shifts', fetchRange.start, fetchRange.end],
    queryFn: () =>
      _db.ShiftEntry.filter({ date: { $gte: fetchRange.start, $lte: fetchRange.end } }, null, 5000),
    placeholderData: keepPreviousData,
    staleTime: 30 * 1000,
  });

  const { data: fairnessShifts = [] } = useQuery({
    queryKey: ['shifts-history', fairnessRange.start, fairnessRange.end],
    queryFn: () =>
      _db.ShiftEntry.filter({ date: { $gte: fairnessRange.start, $lte: fairnessRange.end } }),
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const { data: wishes = [] } = useQuery({
    queryKey: ['wishes', fetchRange.start, fetchRange.end],
    queryFn: () =>
      _db.WishRequest.filter({ date: { $gte: fetchRange.start, $lte: fetchRange.end } }),
    staleTime: 2 * 60 * 1000,
    refetchOnWindowFocus: false,
    placeholderData: keepPreviousData,
  });

  const { data: workplaces = [] } = useQuery({
    queryKey: ['workplaces'],
    queryFn: () => _db.Workplace.list(null, 1000),
    staleTime: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const { data: workplaceTimeslots = [] } = useQuery({
    queryKey: ['workplaceTimeslots'],
    queryFn: () => _db.WorkplaceTimeslot.list(null, 1000),
    staleTime: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const { data: systemSettings = [], isLoading: isLoadingSystemSettings } = useQuery({
    queryKey: ['systemSettings'],
    queryFn: () => _db.SystemSetting.list(),
    staleTime: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const sectionTabs = useMemo(() => {
    const tabSetting = systemSettings.find((s: { key: string }) => s.key === SECTION_TABS_KEY);
    return parseSectionTabs(tabSetting?.value);
  }, [systemSettings]);

  const { data: staffingPlanEntries = [] } = useQuery({
    queryKey: ['staffingPlanEntries', staffingYear],
    queryFn: () => _db.StaffingPlanEntry.filter({ year: staffingYear }),
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const { data: workTimeModels = [] } = useQuery({
    queryKey: ['workTimeModels'],
    queryFn: async () => {
      const res = await _api.request('/api/staff/work-time-models');
      return res.models || [];
    },
    staleTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const workTimeModelMap = useMemo(() => {
    const map = new Map();
    for (const m of workTimeModels) {
      map.set(m.id, m);
    }
    return map;
  }, [workTimeModels]);

  const { data: trainingRotations = [] } = useQuery({
    queryKey: ['trainingRotations'],
    queryFn: () => _db.TrainingRotation.list(),
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const { data: colorSettings = [], isLoading: isLoadingColors } = useQuery({
    queryKey: ['colorSettings'],
    queryFn: () => _db.ColorSetting.list(),
    staleTime: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const { data: scheduleNotes = [] } = useQuery({
    queryKey: ['scheduleNotes'],
    queryFn: () => _db.ScheduleNote.list(),
    staleTime: 30 * 1000,
    refetchOnWindowFocus: false,
  });

  const scheduleNotesMap = useMemo(() => {
    const noteMap = new Map();
    scheduleNotes.forEach((note: { date: string; position: string }) => {
      noteMap.set(`${note.date}|${note.position}`, note);
    });
    return noteMap;
  }, [scheduleNotes]);

  const { data: scheduleBlocks = [] } = useQuery({
    queryKey: ['scheduleBlocks', fetchRange.start, fetchRange.end],
    queryFn: () =>
      _db.ScheduleBlock.filter({ date: { $gte: fetchRange.start, $lte: fetchRange.end } }),
    staleTime: 30 * 1000,
    refetchOnWindowFocus: false,
    placeholderData: keepPreviousData,
  });

  return {
    queryClient,
    fetchRange,
    fairnessRange,
    staffingYear,
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
    workTimeModels,
    workTimeModelMap,
    trainingRotations,
    colorSettings,
    isLoadingColors,
    scheduleNotes,
    scheduleNotesMap,
    scheduleBlocks,
  };
}
