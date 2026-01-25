import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, db, base44 } from "@/api/client";
import { useAuth } from '@/components/AuthProvider';
import { format, getYear, startOfYear, endOfYear, eachDayOfInterval, isSameDay } from 'date-fns';
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon, Eraser, Wand2 } from 'lucide-react';
import { isDoctorAvailable } from '@/components/schedule/staffingUtils';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import DoctorYearView from '@/components/vacation/DoctorYearView';
import VacationOverview from '@/components/vacation/VacationOverview';
import AppSettingsDialog from '@/components/settings/AppSettingsDialog';
import ConflictDialog, { categorizeConflict } from '@/components/vacation/ConflictDialog';

import { useHolidays } from '@/components/useHolidays';
import { DEFAULT_COLORS } from '@/components/settings/ColorSettingsDialog';
import { useTeamRoles } from '@/components/settings/TeamRoleSettings';

export default function VacationPage() {
  const { isReadOnly, user } = useAuth();
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const { isSchoolHoliday, isPublicHoliday } = useHolidays(selectedYear);
  const [selectedDoctorId, setSelectedDoctorId] = useState(null);
  const [viewMode, setViewMode] = useState('single'); // 'single' | 'overview'
  
  const queryClient = useQueryClient();

  // Dynamische Rollenprioritäten aus DB laden
  const { rolePriority } = useTeamRoles();

  // Fetch Doctors
  const { data: doctors = [] } = useQuery({
    queryKey: ['doctors'],
    queryFn: () => db.Doctor.list(),
    select: (data) => data.sort((a, b) => {
      const roleDiff = (rolePriority[a.role] ?? 99) - (rolePriority[b.role] ?? 99);
      if (roleDiff !== 0) return roleDiff;
      return (a.order || 0) - (b.order || 0);
    }),
  });

  // Select doctor: prefer user's assigned doctor, otherwise first in list
  React.useEffect(() => {
    if (doctors.length > 0 && !selectedDoctorId) {
      if (user?.doctor_id && doctors.some(d => d.id === user.doctor_id)) {
        setSelectedDoctorId(user.doctor_id);
      } else {
        setSelectedDoctorId(doctors[0].id);
      }
    }
  }, [doctors, selectedDoctorId, user]);

  const selectedDoctor = doctors.find(d => d.id === selectedDoctorId);

  // Fetch Shifts for the year (filtering by date range for better performance)
  const { data: allShifts = [] } = useQuery({
    queryKey: ['shifts', selectedYear],
    queryFn: () => db.ShiftEntry.filter({
        date: { $gte: `${selectedYear}-01-01`, $lte: `${selectedYear}-12-31` }
    }, null, 5000),
    staleTime: 30 * 1000,
    keepPreviousData: true,
  });

  const { data: systemSettings = [] } = useQuery({
    queryKey: ['systemSettings'],
    queryFn: () => db.SystemSetting.list(),
  });

  const { data: colorSettings = [] } = useQuery({
      queryKey: ['colorSettings'],
      queryFn: () => db.ColorSetting.list(),
  });

  const { data: staffingPlanEntries = [] } = useQuery({
      queryKey: ['staffingPlanEntries', selectedYear],
      queryFn: () => db.StaffingPlanEntry.filter({ year: selectedYear }),
  });

  const ABSENCE_PRIORITY = {
      "Nicht verfügbar": 100,
      "Krank": 90,
      "Frei": 80,
      "Urlaub": 70,
      "Dienstreise": 60,
      "DELETE": 0
  };

  const getPriority = (position) => ABSENCE_PRIORITY[position] || 0;

  const handleSyncAbsences = () => {
      if (!confirm(`Möchten Sie die Abwesenheiten für das gesamte Jahr ${selectedYear} basierend auf dem Stellenplan aktualisieren? (Vertragsende, 0.0 FTE, KO, EZ)\n\nDies setzt "Nicht verfügbar" für entsprechende Tage und überschreibt dabei Einträge niedrigerer Priorität (z.B. Urlaub).`)) return;

      const newShifts = [];
      const shiftsToDeleteIds = [];

      const startOfYearDate = startOfYear(new Date(selectedYear, 0, 1));
      const endOfYearDate = endOfYear(new Date(selectedYear, 0, 1));
      const days = eachDayOfInterval({ start: startOfYearDate, end: endOfYearDate });

      // Pre-calculate existing shift map
      const existingShiftsMap = new Map();
      allShifts.forEach(s => {
          if (getYear(new Date(s.date)) === selectedYear) {
              existingShiftsMap.set(`${s.doctor_id}_${s.date}`, s);
          }
      });

      doctors.forEach(doc => {
           if (doc.exclude_from_staffing_plan) return;

           days.forEach(day => {
               const dateStr = format(day, 'yyyy-MM-dd');
               const available = isDoctorAvailable(doc, day, staffingPlanEntries);
               
               if (!available) {
                   const existing = existingShiftsMap.get(`${doc.id}_${dateStr}`);
                   const newPriority = getPriority("Nicht verfügbar");
                   
                   if (existing) {
                       // Check priority
                       const existingPriority = getPriority(existing.position);
                       if (newPriority > existingPriority) {
                           // Overwrite
                           shiftsToDeleteIds.push(existing.id);
                           newShifts.push({
                               date: dateStr,
                               position: "Nicht verfügbar",
                               doctor_id: doc.id,
                               note: "Aus Stellenplan"
                           });
                       }
                   } else {
                       // Create new
                       newShifts.push({
                           date: dateStr,
                           position: "Nicht verfügbar",
                           doctor_id: doc.id,
                           note: "Aus Stellenplan"
                       });
                   }
               }
           });
      });

      if (newShifts.length > 0) {
           const msg = `${newShifts.length} "Nicht verfügbar"-Einträge werden erstellt/aktualisiert.` + 
                       (shiftsToDeleteIds.length > 0 ? ` ${shiftsToDeleteIds.length} existierende Einträge werden überschrieben.` : '');
           
           if (confirm(msg + "\nFortfahren?")) {
               if (shiftsToDeleteIds.length > 0) {
                   bulkDeleteShiftMutation.mutate(shiftsToDeleteIds, {
                       onSuccess: () => bulkCreateShiftMutation.mutate(newShifts)
                   });
               } else {
                   bulkCreateShiftMutation.mutate(newShifts);
               }
           }
      } else {
          alert("Keine Änderungen erforderlich.");
      }
  };

  // Prepare Props for Overview
  const rawVisibleTypes = systemSettings.find(s => s.key === 'overview_visible_types')?.value;
  const visibleTypes = rawVisibleTypes ? JSON.parse(rawVisibleTypes) : ["Urlaub", "Krank", "Frei", "Dienstreise", "Nicht verfügbar"];

  const minPresentSpecialists = parseInt(systemSettings.find(s => s.key === 'min_present_specialists')?.value || '2');
  const minPresentAssistants = parseInt(systemSettings.find(s => s.key === 'min_present_assistants')?.value || '4');
  const monthsPerRow = parseInt(systemSettings.find(s => s.key === 'vacation_months_per_row')?.value || '3');

  const customColors = React.useMemo(() => {
      const colors = {};
      // Fill defaults first
      Object.entries(DEFAULT_COLORS.positions).forEach(([pos, color]) => {
          colors[pos] = { backgroundColor: color.bg, color: color.text };
      });
      // Override with settings
      colorSettings.filter(s => s.category === 'position').forEach(s => {
          colors[s.name] = { backgroundColor: s.bg_color, color: s.text_color };
      });
      return colors;
  }, [colorSettings]);

  // Only show absence positions in Vacation module
  const absencePositions = ["Urlaub", "Krank", "Frei", "Dienstreise", "Nicht verfügbar"];
  
  const yearShifts = allShifts.filter(s => 
    s.doctor_id === selectedDoctorId && absencePositions.includes(s.position)
  );

  const overviewShifts = allShifts.filter(s => 
    absencePositions.includes(s.position)
  );

  const createShiftMutation = useMutation({
    mutationFn: async (data) => {
        // Use atomic checkAndCreate
        const response = await base44.functions.invoke('atomicOperations', {
            operation: 'checkAndCreate',
            entity: 'ShiftEntry',
            data: data,
            check: { uniqueKeys: ['date', 'doctor_id'] }
        });
        return response.data;
    },
    onSuccess: () => {
        queryClient.invalidateQueries(['shifts', selectedYear]);
    },
    onError: (err) => {
        alert("Konflikt: " + (err.response?.data?.message || err.message));
        queryClient.invalidateQueries(['shifts', selectedYear]);
    }
  });

  const deleteShiftMutation = useMutation({
    mutationFn: (id) => db.ShiftEntry.delete(id),
    onSuccess: () => {
        queryClient.invalidateQueries(['shifts', selectedYear]);
    },
  });

  const [activeType, setActiveType] = useState('Urlaub');
  const [rangeStart, setRangeStart] = useState(null);
  
  // Conflict Dialog State
  const [conflictDialog, setConflictDialog] = useState({
      open: false,
      conflicts: [],
      doctorName: '',
      pendingAction: null // { type: 'range' | 'single', data: {...} }
  });

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

  // Analyze conflicts for a range selection
  const analyzeConflicts = (days, targetDoctorId, newPosition) => {
      const relevantShifts = allShifts.filter(s => s.doctor_id === targetDoctorId);
      const conflicts = [];
      
      days.forEach(d => {
          const dStr = format(d, 'yyyy-MM-dd');
          const existingShift = relevantShifts.find(s => s.date === dStr);
          
          if (existingShift && existingShift.position !== newPosition) {
              const conflictType = categorizeConflict(newPosition, existingShift.position);
              conflicts.push({
                  date: dStr,
                  existingShift,
                  newPosition,
                  conflictType
              });
          }
      });
      
      return conflicts;
  };

  // Execute the actual range mutation
  const executeRangeAction = (days, targetDoctorId, deleteIds, overwriteIds, keepOptionalServices) => {
      const relevantShifts = allShifts.filter(s => s.doctor_id === targetDoctorId);
      const shiftsToDeleteIds = [...deleteIds, ...overwriteIds];
      const newShifts = [];
      
      days.forEach(d => {
          const dStr = format(d, 'yyyy-MM-dd');
          const existingShift = relevantShifts.find(s => s.date === dStr);
          
          // Skip if same type already exists
          if (existingShift && existingShift.position === activeType) return;
          
          // Skip if keeping optional and this is an optional conflict
          if (existingShift && keepOptionalServices) {
              const conflictType = categorizeConflict(activeType, existingShift.position);
              if (conflictType === 'optional') return; // Keep both - don't create new absence here either
          }
          
          // Only add if not in delete list (means we're overwriting) or no existing shift
          if (!existingShift || shiftsToDeleteIds.includes(existingShift.id)) {
              newShifts.push({
                  date: dStr,
                  position: activeType,
                  doctor_id: targetDoctorId
              });
          }
      });
      
      // Execute mutations
      if (shiftsToDeleteIds.length > 0) {
          bulkDeleteShiftMutation.mutate(shiftsToDeleteIds, {
              onSuccess: () => {
                  if (newShifts.length > 0) bulkCreateShiftMutation.mutate(newShifts);
              }
          });
      } else {
          if (newShifts.length > 0) bulkCreateShiftMutation.mutate(newShifts);
      }
  };

  const handleRangeSelection = (start, end, doctorId = null) => {
      const targetDoctorId = doctorId || selectedDoctorId;
      if (!targetDoctorId || isReadOnly) return;
      
      const startDate = start < end ? start : end;
      const endDate = start < end ? end : start;
      
      const days = eachDayOfInterval({ start: startDate, end: endDate });
      
      // Handle DELETE mode - no conflict check needed
      if (activeType === 'DELETE') {
          const relevantShifts = allShifts.filter(s => s.doctor_id === targetDoctorId);
          const shiftsToDeleteIds = days
              .map(d => relevantShifts.find(s => s.date === format(d, 'yyyy-MM-dd')))
              .filter(Boolean)
              .map(s => s.id);
          
          if (shiftsToDeleteIds.length > 0) {
              bulkDeleteShiftMutation.mutate(shiftsToDeleteIds);
          }
          return;
      }
      
      // Analyze conflicts
      const conflicts = analyzeConflicts(days, targetDoctorId, activeType);
      const doctor = doctors.find(d => d.id === targetDoctorId);
      
      // If there are conflicts, show dialog
      if (conflicts.length > 0) {
          setConflictDialog({
              open: true,
              conflicts,
              doctorName: doctor?.name || 'Unbekannt',
              pendingAction: {
                  type: 'range',
                  data: { days, targetDoctorId }
              }
          });
          return;
      }
      
      // No conflicts - execute directly
      const newShifts = days.map(d => ({
          date: format(d, 'yyyy-MM-dd'),
          position: activeType,
          doctor_id: targetDoctorId
      })).filter(s => {
          // Filter out days that already have this type
          const existing = allShifts.find(x => x.doctor_id === targetDoctorId && x.date === s.date);
          return !existing || existing.position !== activeType;
      });
      
      if (newShifts.length > 0) {
          bulkCreateShiftMutation.mutate(newShifts);
      }
  };
  
  // Handle conflict dialog confirmation
  const handleConflictConfirm = ({ proceed, keepOptionalServices, deleteIds, overwriteIds }) => {
      if (!proceed || !conflictDialog.pendingAction) return;
      
      const { type, data } = conflictDialog.pendingAction;
      
      if (type === 'range') {
          executeRangeAction(data.days, data.targetDoctorId, deleteIds, overwriteIds, keepOptionalServices);
      }
      
      setConflictDialog({ open: false, conflicts: [], doctorName: '', pendingAction: null });
  };

  const handleToggleShift = (date, currentStatus, doctorId = null, event) => {
    const targetDoctorId = doctorId || selectedDoctorId;
    if (!targetDoctorId || isReadOnly) return;
    const dateStr = format(date, 'yyyy-MM-dd');

    const relevantShifts = doctorId ? allShifts.filter(s => s.doctor_id === targetDoctorId) : yearShifts;

    // Check for CTRL key range selection (Optional now with drag)
    if (event && (event.ctrlKey || event.metaKey)) {
        if (!rangeStart) {
            setRangeStart(date);
            return; // Wait for second click
        } else {
            // Range selection complete
            handleRangeSelection(rangeStart, date, targetDoctorId);
            setRangeStart(null);
            return;
        }
    }

    // Normal toggle (no CTRL)
    setRangeStart(null); // Clear range if normal click

    if (activeType === 'DELETE') {
        // Check for any shift on this date
        const shift = relevantShifts.find(s => s.date === dateStr);
        if (shift) deleteShiftMutation.mutate(shift.id);
        return;
    }

    // Check real data state - Find ALL shifts for this day to ensure cleanup
    const existingShifts = relevantShifts.filter(s => s.date === dateStr);
    const existingShift = existingShifts[0]; // Primary one for logic

    // 1. Exact match: Toggle OFF
    if (existingShift && existingShift.position === activeType) {
        // Delete ALL shifts on this day if we are toggling off, to be clean
        const idsToDelete = existingShifts.map(s => s.id);
        bulkDeleteShiftMutation.mutate(idsToDelete);
        return;
    }

    // 2. No shift: Create
    if (!existingShift) {
        createShiftMutation.mutate({
            date: dateStr,
            position: activeType,
            doctor_id: targetDoctorId
        });
        return;
    }

    // 3. Different shift: Overwrite if it's an absence type
    const isExistingAbsence = ["Urlaub", "Frei", "Krank", "Dienstreise", "Nicht verfügbar"].includes(existingShift.position);
    
    if (isExistingAbsence) {
         // Overwrite: Update the first one, delete any others (duplicates)
         const [first, ...rest] = existingShifts;
         
         if (rest.length > 0) {
             bulkDeleteShiftMutation.mutate(rest.map(s => s.id));
         }
         
         // Optimistic Update via atomicOperations
         base44.functions.invoke('atomicOperations', {
             operation: 'checkAndUpdate',
             entity: 'ShiftEntry',
             id: first.id,
             data: { position: activeType },
             check: { updated_date: first.updated_date }
         }).then(() => {
             queryClient.invalidateQueries(['shifts']);
         }).catch(err => {
             alert("Fehler beim Aktualisieren: " + (err.response?.data?.message || err.message));
             queryClient.invalidateQueries(['shifts']);
         });
    } else {
         // Work shift exists. Priority Check? 
         // Usually Absence overwrites Work.
         if (confirm(`Mitarbeiter ist bereits eingeteilt als "${existingShift.position}". Überschreiben?`)) {
             const idsToDelete = existingShifts.map(s => s.id);
             bulkDeleteShiftMutation.mutate(idsToDelete, {
                 onSuccess: () => {
                     createShiftMutation.mutate({
                        date: dateStr,
                        position: activeType,
                        doctor_id: targetDoctorId
                    });
                 }
             });
         }
    }
  };

  const absenceTypes = [
      { id: 'Urlaub', label: 'Urlaub', color: 'bg-green-500' },
      { id: 'Frei', label: 'Frei', color: 'bg-slate-500' },
      { id: 'Krank', label: 'Krank', color: 'bg-red-500' },
      { id: 'Dienstreise', label: 'Dienstreise', color: 'bg-blue-500' },
      { id: 'Nicht verfügbar', label: 'Nicht verfügbar', color: 'bg-orange-500' },
      { id: 'DELETE', label: 'Löschen', color: 'bg-slate-100 text-slate-900 border-slate-200 hover:bg-red-50 hover:text-red-600' },
  ];

  return (
    <div className="container mx-auto max-w-7xl">
      <div className="flex flex-col md:flex-row justify-between items-center mb-8 gap-4">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Abwesenheiten</h1>
          <p className="text-slate-500 mt-1">Übersicht der Abwesenheiten und Verfügbarkeiten</p>
        </div>

        <div className="flex items-center gap-4">
            {!isReadOnly && (
                <>
                    <Button 
                        variant="outline" 
                        onClick={handleSyncAbsences}
                        title="Abwesenheiten aus Stellenplan übernehmen (KO, EZ, 0.0 FTE, Vertragsende)"
                    >
                        <Wand2 className="w-4 h-4 mr-2" />
                        Stellenplan-Sync
                    </Button>
                    <AppSettingsDialog />
                </>
            )}
            
            <div className="bg-slate-100 p-1 rounded-lg flex">
                <button 
                    onClick={() => setViewMode('single')}
                    className={`px-3 py-1 text-sm font-medium rounded-md transition-all ${viewMode === 'single' ? 'bg-white shadow text-indigo-600' : 'text-slate-500 hover:text-slate-700'}`}
                >
                    Einzelansicht
                </button>
                <button 
                    onClick={() => setViewMode('overview')}
                    className={`px-3 py-1 text-sm font-medium rounded-md transition-all ${viewMode === 'overview' ? 'bg-white shadow text-indigo-600' : 'text-slate-500 hover:text-slate-700'}`}
                >
                    Jahresübersicht
                </button>
            </div>

            <div className="flex items-center gap-4 bg-white p-2 rounded-lg shadow-sm border border-slate-200">
               <div className="flex items-center">
                <Button variant="ghost" size="icon" onClick={() => setSelectedYear(y => y - 1)}>
                    <ChevronLeft className="w-4 h-4" />
                </Button>
                <span className="mx-2 font-bold text-lg w-16 text-center">{selectedYear}</span>
                <Button variant="ghost" size="icon" onClick={() => setSelectedYear(y => y + 1)}>
                    <ChevronRight className="w-4 h-4" />
                </Button>
               </div>
               
               {viewMode === 'single' && (
               <>
                   <div className="w-px h-8 bg-slate-200 mx-2" />

                   <Select value={selectedDoctorId || ''} onValueChange={setSelectedDoctorId}>
                    <SelectTrigger className="w-[200px]">
                        <SelectValue placeholder="Person auswählen" />
                    </SelectTrigger>
                    <SelectContent>
                        {doctors.map(d => (
                            <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                        ))}
                    </SelectContent>
                   </Select>
               </>
               )}
            </div>
        </div>
      </div>
      
      <div className="flex gap-2 mb-6 overflow-x-auto pb-2">
          {absenceTypes.map(type => (
              <Button
                  key={type.id}
                  variant={activeType === type.id ? "default" : "outline"}
                  onClick={() => !isReadOnly && setActiveType(type.id)}
                  className={`gap-2 ${activeType === type.id ? type.color + ' hover:' + type.color + '/90 border-transparent' : 'hover:bg-slate-50'} ${isReadOnly ? 'cursor-default opacity-100 hover:bg-transparent' : ''}`}
                  disabled={isReadOnly && activeType !== type.id}
              >
                  {type.id === 'DELETE' ? <Eraser className="w-4 h-4" /> : <div className={`w-3 h-3 rounded-full ${type.color}`} />}
                  {type.label}
              </Button>
          ))}
      </div>

      {viewMode === 'single' ? (
        <>
          {selectedDoctor ? (
            <DoctorYearView 
                doctor={selectedDoctor} 
                year={selectedYear} 
                shifts={yearShifts}
                onToggle={(d, s, e) => handleToggleShift(d, s, selectedDoctorId, e)}
                onRangeSelect={(s, e) => handleRangeSelection(s, e, selectedDoctorId)}
                activeType={activeType}
                rangeStart={rangeStart}
                isSchoolHoliday={isSchoolHoliday}
                isPublicHoliday={isPublicHoliday}
            />
          ) : (
            <div className="text-center py-12 text-slate-500">
                Bitte wählen Sie eine Person aus.
            </div>
          )}
        </>
      ) : (
        <VacationOverview 
            year={selectedYear} 
            doctors={doctors} 
            shifts={overviewShifts} 
            isSchoolHoliday={isSchoolHoliday}
            isPublicHoliday={isPublicHoliday}
            visibleTypes={visibleTypes}
            customColors={customColors}
            onToggle={handleToggleShift}
            onRangeSelect={handleRangeSelection}
            activeType={activeType}
            isReadOnly={isReadOnly}
            monthsPerRow={monthsPerRow}
            minPresentSpecialists={minPresentSpecialists}
            minPresentAssistants={minPresentAssistants}
            />
      )}
      
      {/* Conflict Warning Dialog */}
      <ConflictDialog
          open={conflictDialog.open}
          onOpenChange={(open) => setConflictDialog(prev => ({ ...prev, open }))}
          conflicts={conflictDialog.conflicts}
          doctorName={conflictDialog.doctorName}
          onConfirm={handleConflictConfirm}
          onCancel={() => setConflictDialog({ open: false, conflicts: [], doctorName: '', pendingAction: null })}
      />
    </div>
  );
}