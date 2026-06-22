import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, db } from "@/api/client";
import { useAuth } from '@/components/AuthProvider';
import { addDays, format, parseISO } from 'date-fns';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import EmployeeSelect from '@/components/staff/EmployeeSelect';
import WishYearView from '@/components/wishlist/WishYearView';
import WishRequestDialog from '@/components/wishlist/WishRequestDialog';
import WishMonthOverview from '@/components/wishlist/WishMonthOverview';
import WishReminderStatus from '@/components/wishlist/WishReminderStatus';
import { useHolidays } from '@/components/useHolidays';
import { trackDbChange } from '@/components/utils/dbTracker';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Calendar as CalendarIcon, Table2 } from 'lucide-react';
import { useTeamRoles } from '@/components/settings/TeamRoleSettings';
import { isAlphabeticalDoctorSortingEnabled, sortDoctorsAlphabetically } from '@/utils/doctorSorting';
import { isWishOnDate } from '@/utils/wishRange';
import { clampRangeToContract, getTrainingContractInfo, isDateWithinContract } from '@/components/training/trainingContractUtils';
import { resolveWishDefaultPosition } from '@/components/wishlist/wishPreferences';
import { useAllDoctorQualifications, useAllWorkplaceQualifications } from '@/hooks/useQualifications';
import { filterQualifiedWishServiceTypes } from '@/components/wishlist/wishQualificationFilter';

const getDateRangeDays = (startDate, endDate) => {
    if (!startDate || !endDate) return [];

    const start = parseISO(startDate);
    const end = parseISO(endDate);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) {
        return [];
    }

    const dates = [];
    for (let current = start; current <= end; current = addDays(current, 1)) {
        dates.push(format(current, 'yyyy-MM-dd'));
    }
    return dates;
};

const buildDailyWishPayload = (wish) => {
    const {
        id: _id,
        date: _date,
        range_start: _rangeStart,
        range_end: _rangeEnd,
        created_date: _createdDate,
        updated_date: _updatedDate,
        ...rest
    } = wish;

    return {
        ...rest,
        range_start: null,
        range_end: null,
        range_enabled: false,
    };
};

export default function WishListPage() {
    const { isAuthenticated, user } = useAuth();
  // WishList is editable by all authenticated users, so we override isReadOnly for this page
  const canEdit = isAuthenticated;
  const isAdmin = user?.role === 'admin';
  
  const [viewDate, setViewDate] = useState(new Date());
  const selectedYear = viewDate.getFullYear();
  const setSelectedYear = (y) => {
      if (typeof y === 'function') {
          setViewDate(prev => new Date(y(prev.getFullYear()), prev.getMonth(), 1));
      } else {
          setViewDate(new Date(y, viewDate.getMonth(), 1));
      }
  };

  const [viewMode, setViewMode] = useState('year'); // 'year' | 'month'
  const { isSchoolHoliday, isPublicHoliday } = useHolidays(selectedYear);
  const [selectedDoctorId, setSelectedDoctorId] = useState(null);
  const [activeTab, setActiveTab] = useState(null);
  
  const [dialogState, setDialogState] = useState({
    isOpen: false,
    date: null,
    wish: null,
    initialDraft: null,
    rangeWishes: null
  });

  const queryClient = useQueryClient();
    const migratedLegacyWishIdsRef = useRef(new Set());
    const { getQualificationIds: getDoctorQualIds, isLoading: isDoctorQualificationsLoading } = useAllDoctorQualifications();
    const { byWorkplace: workplaceQualificationsByWorkplaceId, isLoading: isWorkplaceQualificationsLoading } = useAllWorkplaceQualifications();

  // Fetch Workplaces for Tabs
  const { data: workplaces = [] } = useQuery({
      queryKey: ['workplaces'],
      queryFn: () => db.Workplace.list(null, 1000),
  });

  // Alle Dienstarten (ungefiltert nach Qualifikation) für die Filter-Buttons
  const allServiceTypes = React.useMemo(() => {
      return workplaces
          .filter(w => w.category === 'Dienste')
          .sort((a, b) => (a.order || 0) - (b.order || 0))
          .map((workplace) => workplace.name);
  }, [workplaces]);

  // Qualifikationsgefilterte Dienstarten für die Jahresansicht (Einzel-Arzt)
  const serviceTypes = React.useMemo(() => {
      const serviceWorkplaces = workplaces
          .filter(w => w.category === 'Dienste')
          .sort((a, b) => (a.order || 0) - (b.order || 0));

      if (!selectedDoctorId || isDoctorQualificationsLoading || isWorkplaceQualificationsLoading) {
          return serviceWorkplaces.map((workplace) => workplace.name);
      }

      const doctorQualificationIds = getDoctorQualIds(selectedDoctorId);

      return filterQualifiedWishServiceTypes(
          serviceWorkplaces,
          doctorQualificationIds,
          workplaceQualificationsByWorkplaceId,
      ).map((workplace) => workplace.name);
  }, [
      workplaces,
      selectedDoctorId,
      isDoctorQualificationsLoading,
      isWorkplaceQualificationsLoading,
      getDoctorQualIds,
      workplaceQualificationsByWorkplaceId,
  ]);

  React.useEffect(() => {
      const types = viewMode === 'month' ? allServiceTypes : serviceTypes;

      if (types.length === 0) {
          if (activeTab !== null) {
              setActiveTab(null);
          }
          return;
      }

      if (activeTab && types.includes(activeTab)) {
          return;
      }

      const preferredPosition = resolveWishDefaultPosition(types, user?.wish_default_position);
      if (preferredPosition && preferredPosition !== activeTab) {
          setActiveTab(preferredPosition);
      }
  }, [allServiceTypes, serviceTypes, activeTab, viewMode, user?.wish_default_position]);

  const saveWishDefaultPosition = async (position) => {
      try {
          await api.updateMe({ data: { wish_default_position: position } });
      } catch (error) {
          console.error('Could not save default wish position', error);
      }
  };

  const handleActiveTabChange = (position) => {
      setActiveTab(position);

      if (position && position !== user?.wish_default_position) {
          saveWishDefaultPosition(position);
      }
  };

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

    const doctorsForSelection = React.useMemo(() => {
            return isAlphabeticalDoctorSortingEnabled(user) ? sortDoctorsAlphabetically(doctors) : doctors;
    }, [doctors, user]);

    const doctorSelectOptions = React.useMemo(() => {
        const options = doctorsForSelection.map((doctor) => ({
            value: doctor.id,
            label: doctor.name,
            triggerLabel: doctor.name,
            description: doctor.role || undefined,
            searchText: [doctor.role, doctor.initials].filter(Boolean).join(' '),
            sortLabel: doctor.name,
        }));

        if (user?.role === 'admin') {
            options.unshift({
                value: '',
                label: 'Alle',
                triggerLabel: 'Alle',
                description: 'Alle Mitarbeiter anzeigen',
                searchText: 'alle',
                sortLabel: '',
            });
        }

        return options;
    }, [doctorsForSelection, user?.role]);

    const { data: masterEmployees = [] } = useQuery({
        queryKey: ['master-central-employees-for-wishlist'],
        queryFn: async () => {
            try {
                const result = await api.request('/api/master/employees');
                return result.employees || [];
            } catch {
                return [];
            }
        },
        staleTime: 10 * 60 * 1000,
        refetchOnWindowFocus: false,
    });

  // Select first doctor by default or user's assigned doctor
  React.useEffect(() => {
    if (doctorsForSelection.length > 0 && selectedDoctorId === null) {
        if (user && user.role !== 'admin') {
            // Non-admins can ONLY see their assigned doctor
            if (user.doctor_id && doctorsForSelection.some(d => d.id === user.doctor_id)) {
                setSelectedDoctorId(user.doctor_id);
            }
            // No doctor assigned to this non-admin user: selectedDoctorId stays null
        } else if (user) {
            // Admins: prefer user.doctor_id, otherwise use first
            if (user.doctor_id && doctorsForSelection.some(d => d.id === user.doctor_id)) {
                setSelectedDoctorId(user.doctor_id);
            } else {
                setSelectedDoctorId(doctorsForSelection[0].id);
            }
        } else {
            // No user yet, set first doctor
            setSelectedDoctorId(doctorsForSelection[0].id);
        }
    }
  }, [doctorsForSelection, selectedDoctorId, user]);

  const selectedDoctor = doctors.find(d => d.id === selectedDoctorId);

  const contractInfoByDoctorId = useMemo(() => {
      const employeesById = new Map(masterEmployees.map((employee) => [employee.id, employee]));
      const infoByDoctorId = {};

      doctorsForSelection.forEach((doctor) => {
          const employee = doctor.central_employee_id ? employeesById.get(doctor.central_employee_id) : null;
          const contractInfo = getTrainingContractInfo(employee?.contract_start, employee?.contract_end);

          if (contractInfo) {
              infoByDoctorId[doctor.id] = contractInfo;
          }
      });

      return infoByDoctorId;
  }, [doctorsForSelection, masterEmployees]);

  const getDoctorContractInfo = (doctorId) => contractInfoByDoctorId[doctorId] || null;
  const selectedDoctorContractInfo = selectedDoctor ? getDoctorContractInfo(selectedDoctor.id) : null;

  // Fetch Wishes
  const { data: allWishes = [] } = useQuery({
    queryKey: ['wishes', selectedYear],
    queryFn: () => db.WishRequest.filter({
       date: { $gte: `${selectedYear}-01-01`, $lte: `${selectedYear}-12-31` }
    }),
  });

  // Fetch Absences (Shifts) for context
  const { data: allShifts = [] } = useQuery({
    queryKey: ['shifts', selectedYear],
    queryFn: () => db.ShiftEntry.filter({
        date: { $gte: `${selectedYear}-01-01`, $lte: `${selectedYear}-12-31` }
    }, null, 5000),
  });

  const doctorWishes = allWishes.filter(w => w.doctor_id === selectedDoctorId);
  const doctorShifts = allShifts.filter(s => s.doctor_id === selectedDoctorId);

  useEffect(() => {
      const accessibleDoctorId = user?.doctor_id || null;
      const legacyRangeWishes = allWishes.filter((wish) => {
          if (wish.type !== 'no_service' || !wish.range_start || !wish.range_end) {
              return false;
          }

          if (!isAdmin && accessibleDoctorId && wish.doctor_id !== accessibleDoctorId) {
              return false;
          }

          return !migratedLegacyWishIdsRef.current.has(wish.id);
      });

      if (legacyRangeWishes.length === 0) {
          return undefined;
      }

      let cancelled = false;

      for (const wish of legacyRangeWishes) {
          migratedLegacyWishIdsRef.current.add(wish.id);
      }

      const migrateLegacyRanges = async () => {
          try {
              let migratedCount = 0;

              for (const legacyWish of legacyRangeWishes) {
                  if (cancelled) return;

                  const rangeDates = getDateRangeDays(legacyWish.range_start, legacyWish.range_end);
                  if (rangeDates.length === 0) {
                      continue;
                  }

                  const dailyPayload = buildDailyWishPayload(legacyWish);
                  for (const rangeDate of rangeDates) {
                      const existingDailyWish = allWishes.find((wish) =>
                          wish.id !== legacyWish.id
                          && wish.doctor_id === legacyWish.doctor_id
                          && wish.type === 'no_service'
                          && wish.date === rangeDate
                      );

                      if (!existingDailyWish) {
                          await db.WishRequest.create({
                              ...dailyPayload,
                              date: rangeDate,
                          });
                      }
                  }

                  await db.WishRequest.delete(legacyWish.id);
                  migratedCount += 1;
              }

              if (migratedCount > 0) {
                  trackDbChange();
                  queryClient.invalidateQueries({ queryKey: ['wishes'] });
              }
          } catch (error) {
              legacyRangeWishes.forEach((wish) => migratedLegacyWishIdsRef.current.delete(wish.id));
              console.error('Legacy no-service wish migration failed:', error);
          }
      };

      migrateLegacyRanges();

      return () => {
          cancelled = true;
      };
  }, [allWishes, isAdmin, queryClient, user?.doctor_id]);

  const filteredDoctorWishes = React.useMemo(() => {
      if (!activeTab) return [];
      return doctorWishes.filter(w => {
          if (w.type === 'no_service') return true; // Always show 'Kein Dienst'
          return w.position === activeTab; // Only match specific position
      });
  }, [doctorWishes, activeTab]);

  // Identify days where ANY doctor has a 'service' wish (filtered by tab)
  const occupiedWishDates = new Set(
      allWishes
        .filter(w => w.type === 'service')
        .filter(w => w.position === activeTab)
        .map(w => w.date)
  );

  const logWishAction = (action, doctorName, date, type) => {
      if (!user) return;
      const typeLabel = type === 'service' ? 'Dienstwunsch' : type === 'no_service' ? 'Kein Dienst' : 'Löschung';
      db.SystemLog.create({
          level: 'wish_request',
          source: 'Wunschkiste',
          message: `${action}: ${typeLabel} für ${doctorName} am ${date}`,
          details: JSON.stringify({
              doctor: doctorName,
              date: date,
              type: type,
              user: user.email, // Assuming email is available on user object
              timestamp: new Date().toISOString()
          })
      }).catch(err => console.error("Log failed", err));
  };



  const deleteWishMutation = useMutation({
    mutationFn: async (id) => {
        // Check if wish was approved and delete corresponding shift if exists
        const wishToDelete = allWishes.find(w => w.id === id);
        if (wishToDelete && wishToDelete.status === 'approved' && wishToDelete.type === 'service') {
            const shifts = await db.ShiftEntry.filter({ 
                date: wishToDelete.date, 
                doctor_id: wishToDelete.doctor_id 
            });
            
            // Find shift that matches the wish position (or just the date if user has only one shift usually)
            // To be safe, only delete if position matches or it's marked as auto-generated
            const shift = shifts.find(s => 
                (!wishToDelete.position || s.position === wishToDelete.position) &&
                (s.note?.includes('Wunsch') || s.note?.includes('genehmigt'))
            );

            if (shift) {
                await db.ShiftEntry.delete(shift.id);
            }
        }
        return db.WishRequest.delete(id);
    },
    onSuccess: () => {
        trackDbChange();
        queryClient.invalidateQueries({ queryKey: ['wishes'] });
        queryClient.invalidateQueries({ queryKey: ['shifts'] });
    },
  });

    const handleDateClick = (date, doctorIdOverride = null, dragDateKeys = null) => {
        const targetDoctorId = doctorIdOverride || selectedDoctorId;
        if (!targetDoctorId || !canEdit) return;
        const targetContractInfo = getDoctorContractInfo(targetDoctorId);
        if (!isDateWithinContract(date, targetContractInfo?.contractStart, targetContractInfo?.contractEnd)) return;

        // Wenn keine qualifizierten Dienst-Typen vorhanden sind, keine neuen Wünsche zulassen
        // (bestehende Wünsche können weiterhin bearbeitet werden)
        const dateStr = format(date, 'yyyy-MM-dd');
        const relevantDoctorWishes = allWishes.filter(w => w.doctor_id === targetDoctorId);
        const hasExistingWish = relevantDoctorWishes.some(w => isWishOnDate(w, dateStr));
        if (!activeTab && !hasExistingWish) {
            alert('Für diese Person sind keine qualifizierten Dienste hinterlegt. Es können keine Wünsche eingetragen werden.');
            return;
        }
    
    // Check overlap with absence
        const relevantDoctorShifts = allShifts.filter(s => s.doctor_id === targetDoctorId);
        const existingShift = relevantDoctorShifts.find(s => s.date === dateStr);
    const absencePositions = ["Urlaub", "Frei", "Krank", "Dienstreise", "Nicht verfügbar"];
    if (existingShift && absencePositions.includes(existingShift.position)) {
        alert(`Am ${format(date, 'dd.MM.yyyy')} ist bereits eine Abwesenheit eingetragen (${existingShift.position}).`);
        return;
    }

        const existingWish = relevantDoctorWishes.find(w => isWishOnDate(w, dateStr));

    // Wenn ein Drag-Range mit mehreren Tagen vorliegt, initialDraft für den Dialog erstellen
    const initialDraftFromDrag = dragDateKeys && dragDateKeys.length > 1
        ? {
            range_enabled: true,
            range_start: dragDateKeys[0],
            range_end: dragDateKeys[dragDateKeys.length - 1],
          }
        : null;

    // Alle vorhandenen Wünsche im Drag-Range sammeln
    const rangeWishesFromDrag = dragDateKeys && dragDateKeys.length > 1
        ? relevantDoctorWishes.filter(w => dragDateKeys.some(key => isWishOnDate(w, key)))
        : null;
    
    setDialogState({
        isOpen: true,
        date: date,
        wish: existingWish || null,
        initialDraft: initialDraftFromDrag,
        rangeWishes: rangeWishesFromDrag?.length > 0 ? rangeWishesFromDrag : null,
    });

        if (targetDoctorId !== selectedDoctorId) {
                setSelectedDoctorId(targetDoctorId);
        }
  };

  // Helper: Create shift from approved wish
  const createShiftFromWish = async (doctorId, date, position) => {
      // Check if shift already exists
      const existing = await db.ShiftEntry.filter({ 
          date: date, 
          doctor_id: doctorId, 
          position: position 
      });
      if (existing.length > 0) return; // Already exists
      
      await db.ShiftEntry.create({
          date: date,
          doctor_id: doctorId,
          position: position,
          note: 'Aus genehmigtem Wunsch'
      });
      queryClient.invalidateQueries({ queryKey: ['shifts'] });
  };

  const handleDialogSave = async (formData) => {
      if (!selectedDoctorId) return;

      const contractInfo = getDoctorContractInfo(selectedDoctorId);
      if (!isDateWithinContract(dialogState.date, contractInfo?.contractStart, contractInfo?.contractEnd)) {
          alert('Das gewählte Datum liegt außerhalb der Vertragslaufzeit.');
          return;
      }

      const dateStr = format(dialogState.date, 'yyyy-MM-dd');
      const { _createShift, ...dataToSave } = formData;
      const isRangeMode = dataToSave.range_enabled
          && dataToSave.range_start
          && dataToSave.range_end;

      if (isRangeMode) {
          const clampedRange = clampRangeToContract(
              parseISO(dataToSave.range_start),
              parseISO(dataToSave.range_end),
              contractInfo?.contractStart,
              contractInfo?.contractEnd,
          );

          if (!clampedRange) {
              alert('Der ausgewählte Zeitraum liegt vollständig außerhalb der Vertragslaufzeit.');
              return;
          }

          const rangeDates = getDateRangeDays(
              format(clampedRange.startDate, 'yyyy-MM-dd'),
              format(clampedRange.endDate, 'yyyy-MM-dd')
          );
          const existingWishesByDate = new Map(
              doctorWishes
                  .filter(w => w.type === dataToSave.type && rangeDates.includes(w.date))
                  .map(w => [w.date, w])
          );
          const baseWishData = {
              ...dataToSave,
              doctor_id: selectedDoctorId,
              user_viewed: false,
              range_start: null,
              range_end: null,
              range_enabled: false,
          };

          for (const rangeDate of rangeDates) {
              const existingWish = existingWishesByDate.get(rangeDate)
                  || (dialogState.wish?.date === rangeDate ? dialogState.wish : null);

              if (existingWish) {
                  await db.WishRequest.update(existingWish.id, {
                      ...baseWishData,
                      date: rangeDate,
                  });
              } else {
                  await db.WishRequest.create({
                      ...baseWishData,
                      date: rangeDate,
                  });
              }
          }

          if (dialogState.wish && !rangeDates.includes(dialogState.wish.date)) {
              await db.WishRequest.delete(dialogState.wish.id);
          }

          trackDbChange();
          queryClient.invalidateQueries({ queryKey: ['wishes'] });
          if (selectedDoctor) {
              const logDate = `${rangeDates[0]} bis ${rangeDates[rangeDates.length - 1]}`;
              const actionLabel = dialogState.wish
                  ? `Eintrag aktualisiert (${rangeDates.length} Tage)`
                  : `Eintrag erstellt (${rangeDates.length} Tage)`;
              logWishAction(actionLabel, selectedDoctor.name, logDate, dataToSave.type);
          }
          return;
      }
      
      if (dialogState.wish) {
          // Update
          await db.WishRequest.update(dialogState.wish.id, {
              ...dataToSave,
              doctor_id: selectedDoctorId,
              date: dateStr,
              user_viewed: false
          });
          
          // Create shift if flagged
          if (_createShift && dataToSave.position) {
              await createShiftFromWish(selectedDoctorId, dateStr, dataToSave.position);
          }
          
          trackDbChange();
          queryClient.invalidateQueries({ queryKey: ['wishes'] });
          if (selectedDoctor) {
              logWishAction(`Eintrag aktualisiert (${dataToSave.status})`, selectedDoctor.name, dateStr, dataToSave.type);
          }
      } else {
          // Create
          const wishData = {
              doctor_id: selectedDoctorId,
              date: dateStr,
              ...dataToSave
          };
          await db.WishRequest.create(wishData);
          
          // Create shift if flagged (auto-approved)
          if (_createShift && dataToSave.position) {
              await createShiftFromWish(selectedDoctorId, dateStr, dataToSave.position);
          }
          
          trackDbChange();
          queryClient.invalidateQueries({ queryKey: ['wishes'] });
          if (selectedDoctor) {
              logWishAction('Eintrag erstellt', selectedDoctor.name, dateStr, dataToSave.type);
          }
      }
  };

  const handleDialogDelete = async () => {
      const rangeWishes = dialogState.rangeWishes;
      if (rangeWishes?.length > 1) {
          const dates = rangeWishes.map(w => w.date).sort();
          for (const w of rangeWishes) {
              await db.WishRequest.delete(w.id);
          }
          trackDbChange();
          queryClient.invalidateQueries({ queryKey: ['wishes'] });
          queryClient.invalidateQueries({ queryKey: ['shifts'] });
          if (selectedDoctor) {
              logWishAction(
                  `${rangeWishes.length} Einträge gelöscht`,
                  selectedDoctor.name,
                  `${dates[0]} bis ${dates[dates.length - 1]}`,
                  rangeWishes[0].type
              );
          }
      } else if (dialogState.wish) {
          deleteWishMutation.mutate(dialogState.wish.id, {
              onSuccess: () => {
                  if (selectedDoctor) {
                      logWishAction('Eintrag gelöscht', selectedDoctor.name, format(dialogState.date, 'yyyy-MM-dd'), dialogState.wish.type);
                  }
              }
          });
      }
  };

  return (
    <div className="container mx-auto max-w-7xl" data-testid="wishlist-page">
      <div className="flex flex-col md:flex-row justify-between items-center mb-8 gap-4">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Wunschkiste</h1>
          <p className="text-slate-500 mt-1">Dienstwünsche eintragen</p>
        </div>

        <div className="flex items-center gap-4">
            <div className="flex items-center gap-4 bg-white p-2 rounded-lg shadow-sm border border-slate-200">
               <div className="flex items-center">
                 <Button data-testid="wishlist-year-prev" variant="ghost" size="icon" onClick={() => setSelectedYear(y => y - 1)}>
                     <ChevronLeft className="w-4 h-4" />
                 </Button>
                 <span className="mx-2 font-bold text-lg w-16 text-center" data-testid="wishlist-year-current">{selectedYear}</span>
                 <Button data-testid="wishlist-year-next" variant="ghost" size="icon" onClick={() => setSelectedYear(y => y + 1)}>
                     <ChevronRight className="w-4 h-4" />
                 </Button>
               </div>
               
               <div className="w-px h-8 bg-slate-200 mx-2" />

                {user?.role === 'admin' ? (
                    <EmployeeSelect
                     value={selectedDoctorId || ''}
                     onValueChange={setSelectedDoctorId}
                     options={doctorSelectOptions}
                     placeholder="Person auswählen"
                     searchPlaceholder="Person suchen..."
                     triggerClassName="w-[200px]"
                     triggerTestId="wishlist-doctor-select-trigger"
                     optionTestIdPrefix="wishlist-doctor-option-"
                    />
                ) : (
                   <div className="px-3 font-medium text-slate-700">
                       {selectedDoctor ? selectedDoctor.name : (user?.doctor_id ? 'Person nicht gefunden' : 'Keine Person zugeordnet')}
                   </div>
               )}
            </div>
        </div>
      </div>
      
      <div className="flex gap-4 mb-6 items-center text-sm text-slate-500 bg-slate-50 p-3 rounded-lg border border-slate-100">
          <span className="font-medium text-slate-700 mr-2">Legende:</span>
          <div className="flex items-center gap-2">
              <div className="w-3 h-3 bg-green-100 border border-green-500 rounded"></div>
              <span>Dienstwunsch</span>
          </div>
          <div className="flex items-center gap-2">
              <div className="w-3 h-3 bg-red-100 border border-red-500 rounded"></div>
              <span>Kein Dienst</span>
          </div>
          <div className="w-px h-4 bg-slate-300 mx-2"></div>
          <div className="flex items-center gap-2">
              <div className="w-3 h-3 border-2 border-dotted border-slate-400 rounded"></div>
              <span>Ausstehend</span>
          </div>
          <div className="flex items-center gap-2">
              <div className="w-3 h-3 border-2 border-solid border-slate-900 rounded"></div>
              <span>Genehmigt</span>
          </div>
          <div className="flex items-center gap-2">
              <div className="w-3 h-3 bg-slate-100 relative overflow-hidden rounded">
                 <div className="absolute inset-0 bg-slate-400/20 rotate-45 transform origin-center scale-150"></div>
              </div>
              <span>Abgelehnt</span>
          </div>
          <div className="w-px h-4 bg-slate-300 mx-2"></div>
          <div className="flex items-center gap-2">
              <div className="w-3 h-3 bg-emerald-100 rounded border border-emerald-200"></div>
              <span>Abwesenheit</span>
          </div>
      </div>

      {/* Wish Reminder Status (Admin only) */}
      {isAdmin && (() => {
        // Show reminder status for the current month being viewed
        const targetMonth = `${selectedYear}-${String(viewDate.getMonth() + 1).padStart(2, '0')}`;
        return <WishReminderStatus targetMonth={targetMonth} />;
      })()}

      {/* Tabs for Service Types */}
      <div className="mb-6 overflow-x-auto pb-2">
          <div className="flex space-x-1">
              {(isAdmin && viewMode === 'month' ? allServiceTypes : serviceTypes).map(type => (
                   <Button
                       key={type}
                       data-testid={`wishlist-service-tab-${type.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`}
                       variant={activeTab === type ? "default" : "outline"}
                      onClick={() => handleActiveTabChange(type)}
                      className="whitespace-nowrap"
                      size="sm"
                  >
                      {type.replace('Dienst ', '')}
                  </Button>
              ))}
          </div>
      </div>

      {isAdmin ? (
          <Tabs value={viewMode} onValueChange={setViewMode} className="space-y-4">
              <TabsList>
                  <TabsTrigger value="year" className="flex items-center gap-2">
                      <CalendarIcon className="w-4 h-4" />
                      Jahresansicht (Einzeln)
                  </TabsTrigger>
                  <TabsTrigger value="month" className="flex items-center gap-2">
                      <Table2 className="w-4 h-4" />
                      Monatsübersicht (Alle)
                  </TabsTrigger>
              </TabsList>

              <TabsContent value="year" className="mt-0">
                  {selectedDoctor ? (
                     <WishYearView 
                        doctor={selectedDoctor} 
                        year={selectedYear} 
                        wishes={filteredDoctorWishes}
                        shifts={doctorShifts}
                        contractInfo={selectedDoctorContractInfo}
                        occupiedWishDates={occupiedWishDates}
                        onToggle={handleDateClick}
                        isSchoolHoliday={isSchoolHoliday}
                        isPublicHoliday={isPublicHoliday}
                         activeType={activeTab}
                     />
                  ) : (
                    <div className="text-center py-12 text-slate-500">
                        Bitte wählen Sie eine Person aus.
                    </div>
                  )}
              </TabsContent>

              <TabsContent value="month" className="mt-0">
                  <WishMonthOverview 
                      year={selectedYear}
                      month={viewDate.getMonth()}
                      doctors={selectedDoctorId ? doctors.filter(d => d.id === selectedDoctorId) : doctors}
                      contractInfoByDoctorId={contractInfoByDoctorId}
                      wishes={selectedDoctorId ? allWishes.filter(w => w.doctor_id === selectedDoctorId) : allWishes}
                      shifts={selectedDoctorId ? allShifts.filter(s => s.doctor_id === selectedDoctorId) : allShifts}
                      onDateChange={setViewDate}
                      activeType={activeTab}
                      onToggle={(date, docId) => {
                          handleDateClick(date, docId);
                      }}
                      isSchoolHoliday={isSchoolHoliday}
                      isPublicHoliday={isPublicHoliday}
                  />
              </TabsContent>
          </Tabs>
      ) : (
        // Non-Admin View (Always Year)
        selectedDoctor ? (
             <WishYearView 
                doctor={selectedDoctor} 
                year={selectedYear} 
                wishes={filteredDoctorWishes}
                shifts={doctorShifts}
                contractInfo={selectedDoctorContractInfo}
                occupiedWishDates={occupiedWishDates}
                onToggle={handleDateClick}
                isSchoolHoliday={isSchoolHoliday}
                isPublicHoliday={isPublicHoliday}
                 activeType={activeTab}
             />
        ) : (
            <div className="text-center py-12 text-slate-500">
                Bitte wählen Sie eine Person aus.
            </div>
        )
      )}

      <WishRequestDialog 
          isOpen={dialogState.isOpen}
          onClose={() => setDialogState({ ...dialogState, isOpen: false, rangeWishes: null })}
          date={dialogState.date}
          wish={dialogState.wish}
          initialDraft={dialogState.initialDraft}
          rangeWishes={dialogState.rangeWishes}
          doctorName={selectedDoctor?.name}
          contractInfo={selectedDoctorContractInfo}
          activePosition={activeTab}
          isReadOnly={!canEdit}
          isAdmin={isAdmin}
          onSave={handleDialogSave}
          onDelete={handleDialogDelete}
      />
    </div>
  );
}
