import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, db, base44 } from "@/api/client";
import { useAuth } from '@/components/AuthProvider';
import { format, getYear } from 'date-fns';
import { ChevronLeft, ChevronRight, Eraser, CheckCircle2, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import WishYearView from '@/components/wishlist/WishYearView';
import WishRequestDialog from '@/components/wishlist/WishRequestDialog';
import WishMonthOverview from '@/components/wishlist/WishMonthOverview';
import { useHolidays } from '@/components/useHolidays';
import { trackDbChange } from '@/components/utils/dbTracker';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Calendar as CalendarIcon, Table2 } from 'lucide-react';
import { useTeamRoles } from '@/components/settings/TeamRoleSettings';

export default function WishListPage() {
  const { isReadOnly, isAuthenticated, user } = useAuth();
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
    wish: null
  });

  const queryClient = useQueryClient();

  // Fetch Workplaces for Tabs
  const { data: workplaces = [] } = useQuery({
      queryKey: ['workplaces'],
      queryFn: () => db.Workplace.list(null, 1000),
  });

  const serviceTypes = React.useMemo(() => {
      return workplaces
          .filter(w => w.category === 'Dienste')
          .sort((a, b) => (a.order || 0) - (b.order || 0))
          .map(w => w.name);
  }, [workplaces]);

  React.useEffect(() => {
      if (serviceTypes.length > 0 && !activeTab) {
          setActiveTab(serviceTypes[0]);
      }
  }, [serviceTypes, activeTab]);

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

  // Select first doctor by default or user's assigned doctor
  React.useEffect(() => {
    if (doctors.length > 0 && !selectedDoctorId) {
        if (user && user.role !== 'admin') {
            // Non-admins can ONLY see their assigned doctor
            if (user.doctor_id && doctors.some(d => d.id === user.doctor_id)) {
                setSelectedDoctorId(user.doctor_id);
            }
            // No doctor assigned to this non-admin user: selectedDoctorId stays null
        } else if (user) {
            // Admins: prefer user.doctor_id, otherwise use first
            if (user.doctor_id && doctors.some(d => d.id === user.doctor_id)) {
                setSelectedDoctorId(user.doctor_id);
            } else {
                setSelectedDoctorId(doctors[0].id);
            }
        } else {
            // No user yet, set first doctor
            setSelectedDoctorId(doctors[0].id);
        }
    }
  }, [doctors, selectedDoctorId, user]);

  const selectedDoctor = doctors.find(d => d.id === selectedDoctorId);

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
    onSuccess: (data, id) => {
        trackDbChange();
        queryClient.invalidateQueries(['wishes']);
        queryClient.invalidateQueries(['shifts']);
    },
  });

  const handleDateClick = (date) => {
    if (!selectedDoctorId || !canEdit) return;
    const dateStr = format(date, 'yyyy-MM-dd');
    
    // Check overlap with absence
    const existingShift = doctorShifts.find(s => s.date === dateStr);
    const absencePositions = ["Urlaub", "Frei", "Krank", "Dienstreise", "Nicht verfügbar"];
    if (existingShift && absencePositions.includes(existingShift.position)) {
        alert(`Am ${format(date, 'dd.MM.yyyy')} ist bereits eine Abwesenheit eingetragen (${existingShift.position}).`);
        return;
    }

    const existingWish = doctorWishes.find(w => w.date === dateStr);
    
    setDialogState({
        isOpen: true,
        date: date,
        wish: existingWish || null
    });
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
      queryClient.invalidateQueries(['shifts']);
  };

  const handleDialogSave = async (formData) => {
      const dateStr = format(dialogState.date, 'yyyy-MM-dd');
      const { _createShift, ...dataToSave } = formData;
      
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
          queryClient.invalidateQueries(['wishes']);
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
          queryClient.invalidateQueries(['wishes']);
          if (selectedDoctor) {
              logWishAction('Eintrag erstellt', selectedDoctor.name, dateStr, dataToSave.type);
          }
      }
  };

  const handleDialogDelete = () => {
      if (dialogState.wish) {
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
    <div className="container mx-auto max-w-7xl">
      <div className="flex flex-col md:flex-row justify-between items-center mb-8 gap-4">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Wunschkiste</h1>
          <p className="text-slate-500 mt-1">Dienstwünsche eintragen</p>
        </div>

        <div className="flex items-center gap-4">
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
               
               <div className="w-px h-8 bg-slate-200 mx-2" />

               {user?.role === 'admin' ? (
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

      {/* Tabs for Service Types */}
      <div className="mb-6 overflow-x-auto pb-2">
          <div className="flex space-x-1">
              {serviceTypes.map(type => (
                  <Button
                      key={type}
                      variant={activeTab === type ? "default" : "outline"}
                      onClick={() => setActiveTab(type)}
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
                      doctors={doctors}
                      wishes={allWishes}
                      shifts={allShifts}
                      onDateChange={setViewDate}
                      activeType={activeTab}
                      onToggle={(date, docId) => {
                          setSelectedDoctorId(docId); // Set context for dialog
                          handleDateClick(date);
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
          onClose={() => setDialogState({ ...dialogState, isOpen: false })}
          date={dialogState.date}
          wish={dialogState.wish}
          doctorName={selectedDoctor?.name}
          activePosition={activeTab}
          isReadOnly={!canEdit}
          isAdmin={isAdmin}
          onSave={handleDialogSave}
          onDelete={handleDialogDelete}
      />
    </div>
  );
}