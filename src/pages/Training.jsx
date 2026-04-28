import React, { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, db, base44 } from "@/api/client";
import { useAuth } from '@/components/AuthProvider';
import { format, getYear, eachDayOfInterval, isSameDay, startOfYear, endOfYear } from 'date-fns';
import { ChevronLeft, ChevronRight, GraduationCap, Eraser, ArrowRightToLine } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import DoctorYearView from '@/components/vacation/DoctorYearView';
import TrainingOverview from '@/components/training/TrainingOverview';
import TrainingMultiYearOverview from '@/components/training/TrainingMultiYearOverview';
import TransferToSchedulerDialog from '@/components/training/TransferToSchedulerDialog';
import { useTeamRoles } from '@/components/settings/TeamRoleSettings';
import { useHolidays } from '@/components/useHolidays';
import { useToast } from '@/components/ui/use-toast';
import { getDefaultRotationColor } from '@/components/settings/ColorSettingsDialog';
import { useSectionConfig } from '@/components/settings/SectionConfigDialog';
import { isAlphabeticalDoctorSortingEnabled, sortDoctorsAlphabetically } from '@/utils/doctorSorting';

export default function TrainingPage() {
  const { isReadOnly, user } = useAuth();
    const { toast } = useToast();
        const { getSectionName } = useSectionConfig();
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [selectedDoctorId, setSelectedDoctorId] = useState(null);
  const [activeModality, setActiveModality] = useState('CT');
  const [rangeStart, setRangeStart] = useState(null);
    const [viewMode, setViewMode] = useState('single'); // 'single' | 'overview' | 'multi-year'
  const [showTransferDialog, setShowTransferDialog] = useState(false);
    const rotationsCaption = getSectionName('Rotationen');
    const rotationsPageTitle = rotationsCaption === 'Rotationen' ? 'Rotationsplaner' : rotationsCaption;
    const rotationsSubtitle = rotationsCaption === 'Rotationen'
            ? 'Rotationsplanung für das Team'
            : `${rotationsCaption} für das Team`;
  
  const queryClient = useQueryClient();
  const { isSchoolHoliday, isPublicHoliday } = useHolidays(selectedYear);

  // Dynamische Rollenprioritäten aus DB laden
  const { rolePriority } = useTeamRoles();

  // Fetch Doctors (only Assistenzärzte typically, but let's allow all for now or filter)
  const { data: doctors = [] } = useQuery({
    queryKey: ['doctors'],
    queryFn: () => db.Doctor.list(),
    select: (data) => data.sort((a, b) => {
        const roleDiff = (rolePriority[a.role] ?? 99) - (rolePriority[b.role] ?? 99);
        if (roleDiff !== 0) return roleDiff;
        return (a.order || 0) - (b.order || 0);
    }),
  });

    const doctorsForSelection = useMemo(() => {
        return isAlphabeticalDoctorSortingEnabled(user) ? sortDoctorsAlphabetically(doctors) : doctors;
    }, [doctors, user]);

  // Fetch Workplaces for dynamic modalities
  const { data: workplaces = [] } = useQuery({
    queryKey: ['workplaces'],
    queryFn: () => db.Workplace.list(null, 1000),
  });

  // Select doctor logic - only set initial value, don't override user selection
  React.useEffect(() => {
    if (doctorsForSelection.length > 0 && !selectedDoctorId) {
        if (user && user.role !== 'admin') {
            // Non-admins: use their assigned doctor
            if (user.doctor_id && doctorsForSelection.some(d => d.id === user.doctor_id)) {
                setSelectedDoctorId(user.doctor_id);
            }
        } else if (user) {
            // Admins: prefer user.doctor_id, otherwise first Assistenzarzt
            if (user.doctor_id && doctorsForSelection.some(d => d.id === user.doctor_id)) {
                setSelectedDoctorId(user.doctor_id);
            } else {
                const assis = doctorsForSelection.find(d => d.role === 'Assistenzarzt');
                setSelectedDoctorId(assis ? assis.id : doctorsForSelection[0].id);
            }
        } else {
            // No user yet, use default Assistenzarzt
            const assis = doctorsForSelection.find(d => d.role === 'Assistenzarzt');
            setSelectedDoctorId(assis ? assis.id : doctorsForSelection[0].id);
        }
    }
  }, [doctorsForSelection, selectedDoctorId, user]);

  const selectedDoctor = doctors.find(d => d.id === selectedDoctorId);

  // Fetch Rotations
  const { data: rotations = [] } = useQuery({
    queryKey: ['trainingRotations'],
    queryFn: () => db.TrainingRotation.list(),
  });

  // Fetch all shifts for the year (needed for transfer dialog conflict detection)
  const { data: allShifts = [] } = useQuery({
    queryKey: ['shifts', selectedYear],
    queryFn: () => db.ShiftEntry.filter({
        date: { $gte: `${selectedYear}-01-01`, $lte: `${selectedYear}-12-31` }
    }, null, 5000),
    staleTime: 30 * 1000,
    keepPreviousData: true,
  });

  // Fetch staffing plan entries for availability checks
  const { data: staffingPlanEntries = [] } = useQuery({
    queryKey: ['staffingPlanEntries', selectedYear],
    queryFn: () => db.StaffingPlanEntry.filter({ year: selectedYear }),
  });

  // Fetch system settings for months per row setting
  const { data: systemSettings = [] } = useQuery({
    queryKey: ['systemSettings'],
    queryFn: () => db.SystemSetting.list(),
  });

  // Fetch color settings from DB for custom rotation colors
  const { data: colorSettings = [] } = useQuery({
      queryKey: ['colorSettings'],
      queryFn: () => db.ColorSetting.list(),
      staleTime: 10 * 60 * 1000,
      refetchOnWindowFocus: false,
  });

  const monthsPerRow = parseInt(systemSettings.find(s => s.key === 'vacation_months_per_row')?.value || '3');

  // Convert ranges to "daily shifts" format for the view
  const dailyRotations = useMemo(() => {
      const result = [];
      rotations.forEach(rot => {
          if (rot.doctor_id !== selectedDoctorId) return;
          
          // Simple check if rotation overlaps with selected year (approx)
          // For exact display we need to expand.
          const start = new Date(rot.start_date);
          const end = new Date(rot.end_date);
          
          if (getYear(start) > selectedYear && getYear(end) > selectedYear) return;
          if (getYear(start) < selectedYear && getYear(end) < selectedYear) return;

          const days = eachDayOfInterval({ start, end });
          days.forEach(day => {
              if (getYear(day) === selectedYear) {
                  result.push({
                      date: format(day, 'yyyy-MM-dd'),
                      position: rot.modality,
                      id: rot.id // keep ref to rotation id
                  });
              }
          });
      });
      return result;
  }, [rotations, selectedDoctorId, selectedYear]);

    const replaceRotationRangeMutation = useMutation({
        mutationFn: ({ doctorId, startDate, endDate, modality }) => api.atomicOperation(
            'replaceTrainingRotationRange',
            'TrainingRotation',
            {
                data: {
                    doctor_id: doctorId,
                    start_date: startDate,
                    end_date: endDate,
                    modality,
                },
            }
        ),
    onSuccess: () => queryClient.invalidateQueries(['trainingRotations']),
        onError: (error) => {
            toast({
                variant: 'destructive',
                title: 'Rotation konnte nicht gespeichert werden',
                description: error.message || 'Die Aenderung konnte nicht vollstaendig verarbeitet werden.',
            });
            queryClient.invalidateQueries(['trainingRotations']);
        },
  });

  // Bulk operations for transferring training to scheduler
  const bulkCreateShiftMutation = useMutation({
    mutationFn: (data) => db.ShiftEntry.bulkCreate(data),
    onSuccess: () => {
        queryClient.invalidateQueries(['shifts', selectedYear]);
    },
  });

  const bulkDeleteShiftMutation = useMutation({
    mutationFn: async (ids) => {
        await Promise.all(ids.map(id => db.ShiftEntry.delete(id)));
    },
    onSuccess: () => {
        queryClient.invalidateQueries(['shifts', selectedYear]);
    },
  });

  const isTransferPending = bulkCreateShiftMutation.isPending || bulkDeleteShiftMutation.isPending;

  const applyRotationRange = (start, end, doctorId, modality) => {
      if (!doctorId || isReadOnly || replaceRotationRangeMutation.isPending) return;

      const startDate = start < end ? start : end;
      const endDate = start < end ? end : start;

      replaceRotationRangeMutation.mutate({
          doctorId,
          startDate: format(startDate, 'yyyy-MM-dd'),
          endDate: format(endDate, 'yyyy-MM-dd'),
          modality: modality || null,
      });
  };

  const handleTransferToScheduler = ({ entries, overwriteExisting }) => {
      if (entries.length === 0) return;
      
      // Collect IDs to delete (overwrite entries)
      const idsToDelete = [];
      if (overwriteExisting) {
          entries.forEach(entry => {
              if (entry.existingShiftIds && entry.existingShiftIds.length > 0) {
                  idsToDelete.push(...entry.existingShiftIds);
              }
          });
      }
      
      // Prepare new shift entries
      const newShifts = entries.map(entry => ({
          date: entry.date,
          position: entry.position,
          doctor_id: entry.doctor_id
      }));
      
      if (idsToDelete.length > 0) {
          bulkDeleteShiftMutation.mutate(idsToDelete, {
              onSuccess: () => {
                  bulkCreateShiftMutation.mutate(newShifts, {
                      onSuccess: () => {
                          setShowTransferDialog(false);
                      }
                  });
              }
          });
      } else {
          bulkCreateShiftMutation.mutate(newShifts, {
              onSuccess: () => {
                  setShowTransferDialog(false);
              }
          });
      }
  };

  // Handler for overview: toggle rotation for a specific doctor
  const handleOverviewToggle = (date, currentStatus, doctorId, event) => {
      if (!doctorId || isReadOnly || replaceRotationRangeMutation.isPending) return;
      
      if (activeModality === 'DELETE') {
          if (currentStatus) {
              applyRotationRange(date, date, doctorId, null);
          }
          return;
      }
      
      // Same type → Delete
      if (currentStatus === activeModality) {
          applyRotationRange(date, date, doctorId, null);
          return;
      }
      
      // Different type → Overwrite
      if (currentStatus && currentStatus !== activeModality) {
          applyRotationRange(date, date, doctorId, activeModality);
          return;
      }

      // Empty → Create (use range start/end pattern)
      if (!rangeStart) {
          setRangeStart(date);
          setSelectedDoctorId(doctorId);
          return;
      }
      
      // Complete range only for same doctor
      if (selectedDoctorId !== doctorId) {
          setRangeStart(date);
          setSelectedDoctorId(doctorId);
          return;
      }

      const start = rangeStart < date ? rangeStart : date;
      const end = rangeStart < date ? date : rangeStart;
      setRangeStart(null);

      applyRotationRange(start, end, doctorId, activeModality);
  };

  const handleOverviewRangeSelect = (start, end, doctorId) => {
      if (!doctorId || isReadOnly || replaceRotationRangeMutation.isPending) return;
      
      if (activeModality === 'DELETE') {
          applyRotationRange(start, end, doctorId, null);
          return;
      }
      
      applyRotationRange(start, end, doctorId, activeModality);
  };

  const handleToggle = (date, currentStatus, event) => {
      if (!selectedDoctorId || isReadOnly || replaceRotationRangeMutation.isPending) return;
      
      // Only CTRL click for ranges logic or single click
      // But for Training, we probably ALWAYS want ranges.
      // Let's support the same UX as Vacation: Click to start range, click to end.
      
      if (!rangeStart) {
          setRangeStart(date);
          return;
      }

      // Range completed
      const start = rangeStart < date ? rangeStart : date;
      const end = rangeStart < date ? date : rangeStart;
      setRangeStart(null);

      const startStr = format(start, 'yyyy-MM-dd');
      const endStr = format(end, 'yyyy-MM-dd');

      // 1. Check if we overlap with existing rotations for this doctor
      // If we overlap, we should arguably trim or delete the old one, or just block.
      // For simplicity: Overlapping parts get overwritten? 
      // The entity structure is ranges. Overwriting a part of a range means splitting the old range.
      // That is complex.
      // SIMPLE APPROACH: Delete any rotation that overlaps with the new range completely or partially?
      // Or just add the new one and let the UI show the latest (last one wins in dailyRotations calc)?
      // Better: Ask user to clear first if complex overlap? 
      // Let's try to be smart: Find overlapping rotations.
      
      // Overlap logic is tricky with ranges. 
      // Let's just create the new range. The `dailyRotations` logic needs to handle duplicates if any.
      // But we should probably clean up.
      
      if (activeModality === 'DELETE') {
          applyRotationRange(start, end, selectedDoctorId, null);
          return;
      }

      applyRotationRange(start, end, selectedDoctorId, activeModality);
  };

  const handleRangeDelete = (start, end) => {
      applyRotationRange(start, end, selectedDoctorId, null);
  };

  const handleRangeSelect = (start, end) => {
      if (!selectedDoctorId || isReadOnly || replaceRotationRangeMutation.isPending) return;
      
      if (activeModality === 'DELETE') {
          applyRotationRange(start, end, selectedDoctorId, null);
          return;
      }
      
      applyRotationRange(start, end, selectedDoctorId, activeModality);
  };

  const handleInteraction = (date, currentStatus, event) => {
      if (isReadOnly || replaceRotationRangeMutation.isPending) return;

      // DELETE Mode Logic
      if (activeModality === 'DELETE') {
          if (currentStatus) {
              // If clicking on existing in delete mode -> Delete (Shorten/Split logic applied to single day)
              applyRotationRange(date, date, selectedDoctorId, null);
          }
          return;
      }

      // If SINGLE click (no range pending) AND it hits an existing rotation -> Delete it (Legacy behavior, or maybe overwrite?)
      // In Vacation planner: Clicking existing = Delete. Clicking empty = Create.
      // Here we'll stick to: Click existing -> Confirm delete (if not in Delete mode)
      // BUT, user asked to ALIGN with Vacation planner.
      // Vacation planner:
      // - If currentStatus == activeType: Delete
      // - If currentStatus != activeType: Overwrite (Update)
      // - If empty: Create
      
      if (!rangeStart) {
          const dateStr = format(date, 'yyyy-MM-dd');
          const clickedDay = dailyRotations.find(d => d.date === dateStr);
          
          // Same Type -> Toggle Off (Delete logic for this day)
          if (currentStatus === activeModality && clickedDay) {
              applyRotationRange(date, date, selectedDoctorId, null);
              return;
          }
          
          // Different Type -> Overwrite logic
          // If we click a day in the middle of a "MRT" rotation, and active is "CT".
          // We should split the MRT rotation and insert a 1-day CT rotation?
          // That seems appropriate for "Align with Vacation Planner".
          if (currentStatus && currentStatus !== activeModality && clickedDay) {
              applyRotationRange(date, date, selectedDoctorId, activeModality);
              return;
          }
      }

      handleToggle(date, currentStatus, event);
  };

  const modalities = useMemo(() => {
      // Filter only Rotations
      const rotationWorkplaces = workplaces
          .filter(w => w.category === 'Rotationen')
          .sort((a, b) => (a.order || 0) - (b.order || 0));

      let mods = [];
      // Dynamische Modalitäten aus der aktuellen Mandanten-Datenbank
      // Kein Fallback mehr auf hardcodierte Werte
      if (rotationWorkplaces.length > 0) {
          mods = rotationWorkplaces.map((w, i) => {
              // Check DB for custom color, fallback to palette
              const dbColor = colorSettings.find(s => s.name === w.name && s.category === 'rotation');
              const defaultColor = getDefaultRotationColor(i);
              const bgColor = dbColor ? dbColor.bg_color : defaultColor.bg;
              const textColor = dbColor ? dbColor.text_color : defaultColor.text;
              return {
                  id: w.name,
                  label: w.name,
                  bgColor,
                  textColor,
              };
          });
          
          // Add Delete Option only if we have modalities
          mods.push({ 
              id: 'DELETE', 
              label: 'Löschen', 
              bgColor: '#f1f5f9',
              textColor: '#0f172a',
              isDelete: true,
          });
      }
      
      return mods;
  }, [workplaces, colorSettings]);

  // If active modality is not in the list (e.g. after rename or initial load), set to first
  React.useEffect(() => {
      if (modalities.length > 0 && !modalities.find(m => m.id === activeModality)) {
          setActiveModality(modalities[0].id);
      }
  }, [modalities, activeModality]);

  const customColors = useMemo(() => {
    const colors = {};
    modalities.forEach(m => {
        if (!m.isDelete) {
            colors[m.id] = { backgroundColor: m.bgColor, color: m.textColor };
        }
    });
    return colors;
  }, [modalities]);

    const yearLabel = useMemo(() => {
        if (viewMode === 'multi-year') {
            return `${selectedYear - 1}–${selectedYear + 1}`;
        }

        return String(selectedYear);
    }, [selectedYear, viewMode]);

  return (
    <div className="container mx-auto max-w-7xl">
      <div className="flex flex-col md:flex-row justify-between items-center mb-8 gap-4">
        <div>
                    <h1 className="text-3xl font-bold text-slate-900">{rotationsPageTitle}</h1>
                    <p className="text-slate-500 mt-1">{rotationsSubtitle}</p>
        </div>

        <div className="flex items-center gap-4">
            {!isReadOnly && user?.role === 'admin' && (
                <Button 
                    variant="outline" 
                    onClick={() => setShowTransferDialog(true)}
                    className="gap-2 border-emerald-300 text-emerald-700 hover:bg-emerald-50"
                    title={viewMode === 'single' && selectedDoctor ? `${rotationsCaption} von ${selectedDoctor.name} in den Wochenplan übertragen` : `Alle ${rotationsCaption} in den Wochenplan übertragen`}
                >
                    <ArrowRightToLine className="w-4 h-4" />
                    {viewMode === 'single' && selectedDoctor ? `${selectedDoctor.name} übertragen` : 'In Wochenplan übertragen'}
                </Button>
            )}
            
            <div className="bg-slate-100 p-1 rounded-lg flex">
                <button 
                    onClick={() => setViewMode('single')}
                    className={`px-3 py-1 text-sm font-medium rounded-md transition-all ${viewMode === 'single' ? 'bg-white shadow text-emerald-600' : 'text-slate-500 hover:text-slate-700'}`}
                >
                    Einzelansicht
                </button>
                <button 
                    onClick={() => setViewMode('overview')}
                    className={`px-3 py-1 text-sm font-medium rounded-md transition-all ${viewMode === 'overview' ? 'bg-white shadow text-emerald-600' : 'text-slate-500 hover:text-slate-700'}`}
                >
                    Jahresübersicht
                </button>
                <button 
                    onClick={() => setViewMode('multi-year')}
                    className={`px-3 py-1 text-sm font-medium rounded-md transition-all ${viewMode === 'multi-year' ? 'bg-white shadow text-emerald-600' : 'text-slate-500 hover:text-slate-700'}`}
                >
                    Mehrjahresübersicht
                </button>
            </div>

            <div className="flex items-center gap-4 bg-white p-2 rounded-lg shadow-sm border border-slate-200">
               <div className="flex items-center">
                <Button variant="ghost" size="icon" onClick={() => setSelectedYear(y => y - 1)}>
                    <ChevronLeft className="w-4 h-4" />
                </Button>
                <span className={`mx-2 font-bold text-lg text-center ${viewMode === 'multi-year' ? 'w-28' : 'w-16'}`}>{yearLabel}</span>
                <Button variant="ghost" size="icon" onClick={() => setSelectedYear(y => y + 1)}>
                    <ChevronRight className="w-4 h-4" />
                </Button>
               </div>
               
               {viewMode === 'single' ? (
               <>
                   <div className="w-px h-8 bg-slate-200 mx-2" />

                   {user?.role === 'admin' ? (
                       <Select 
                        value={selectedDoctorId || ''} 
                        onValueChange={setSelectedDoctorId}
                       >
                        <SelectTrigger className="w-[200px]">
                            <SelectValue placeholder="Person auswählen" />
                        </SelectTrigger>
                        <SelectContent>
                            {doctorsForSelection.map(d => (
                                <SelectItem key={d.id} value={d.id}>
                                    {d.name} {d.role === 'Assistenzarzt' ? '(Ass.)' : ''}
                                </SelectItem>
                            ))}
                        </SelectContent>
                       </Select>
                   ) : (
                       <div className="px-3 font-medium text-slate-700">
                           {selectedDoctor ? selectedDoctor.name : (user?.doctor_id ? 'Person nicht gefunden' : 'Keine Person zugeordnet')}
                       </div>
                   )}
               </>
               ) : (
                   <div className="w-[200px]" />
               )}
            </div>
        </div>
      </div>
      
      <div className="flex gap-2 mb-6 overflow-x-auto pb-2">
          {modalities.length > 0 ? (
              modalities.map(type => (
                  <Button
                      key={type.id}
                      variant={activeModality === type.id ? "default" : "outline"}
                      onClick={() => !isReadOnly && setActiveModality(type.id)}
                      className={`gap-2 shrink-0 ${activeModality === type.id ? 'border-transparent shadow-sm' : 'hover:bg-slate-50'} ${isReadOnly ? 'cursor-default opacity-100 hover:bg-transparent' : ''}`}
                      style={activeModality === type.id ? { backgroundColor: type.bgColor, color: type.textColor, borderColor: 'transparent' } : {}}
                      disabled={isReadOnly && activeModality !== type.id}
                  >
                      {type.id === 'DELETE' ? <Eraser className="w-4 h-4" /> : <div className="w-3 h-3 rounded-full" style={{ backgroundColor: type.bgColor }} />}
                      {type.label}
                  </Button>
              ))
          ) : (
              <div className="text-slate-500 italic py-2">
                  Keine {rotationsCaption} konfiguriert. Bitte fügen Sie in den Einstellungen unter "Arbeitsplätze" Einträge in der Kategorie "{rotationsCaption}" hinzu.
              </div>
          )}
      </div>

            {viewMode === 'single' ? (
        <>
          {selectedDoctor ? (
            <div className="space-y-4">
                {rangeStart && (
                    <div className="bg-indigo-50 border border-indigo-200 text-indigo-700 px-4 py-2 rounded-md flex items-center animate-in fade-in slide-in-from-top-2">
                        <GraduationCap className="w-4 h-4 mr-2" />
                        <span>Startdatum gewählt: <strong>{format(rangeStart, 'dd.MM.yyyy')}</strong>. Wählen Sie nun das Enddatum für die <strong>{activeModality}</strong>-Rotation.</span>
                        <Button variant="ghost" size="sm" className="ml-auto hover:bg-indigo-100" onClick={() => setRangeStart(null)}>Abbrechen</Button>
                    </div>
                )}
                <DoctorYearView 
                    doctor={selectedDoctor} 
                    year={selectedYear} 
                    shifts={dailyRotations}
                    onToggle={handleInteraction}
                    onRangeSelect={handleRangeSelect}
                    activeType={activeModality}
                    rangeStart={rangeStart}
                    customColors={customColors}
                    isSchoolHoliday={isSchoolHoliday}
                    isPublicHoliday={isPublicHoliday}
                />
            </div>
          ) : (
            <div className="text-center py-12 text-slate-500">
                Bitte wählen Sie eine Person aus.
            </div>
          )}
        </>
            ) : viewMode === 'overview' ? (
        <TrainingOverview 
            year={selectedYear} 
            doctors={doctorsForSelection} 
            rotations={rotations}
            isSchoolHoliday={isSchoolHoliday}
            isPublicHoliday={isPublicHoliday}
            customColors={customColors}
            onToggle={handleOverviewToggle}
            onRangeSelect={handleOverviewRangeSelect}
            activeType={activeModality}
            isReadOnly={isReadOnly}
            monthsPerRow={monthsPerRow}
        />
            ) : (
                <TrainingMultiYearOverview
                        centerYear={selectedYear}
                    doctors={doctorsForSelection}
                        rotations={rotations}
                        customColors={customColors}
                        yearsToShow={3}
                />
      )}

      {/* Transfer to Scheduler Dialog */}
      <TransferToSchedulerDialog
          open={showTransferDialog}
          onOpenChange={setShowTransferDialog}
          rotations={viewMode === 'single' && selectedDoctorId ? rotations.filter(r => r.doctor_id === selectedDoctorId) : rotations}
          doctors={viewMode === 'single' && selectedDoctor ? [selectedDoctor] : doctors}
          allShifts={allShifts}
          staffingPlanEntries={staffingPlanEntries}
          workplaces={workplaces}
          isPublicHoliday={isPublicHoliday}
          onTransfer={handleTransferToScheduler}
          isPending={isTransferPending}
      />
    </div>
  );
}