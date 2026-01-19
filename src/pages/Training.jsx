import React, { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { db } from '@/components/db';
import { useAuth } from '@/components/AuthProvider';
import { format, getYear, eachDayOfInterval, isSameDay, startOfYear, endOfYear, addDays, subDays } from 'date-fns';
import { ChevronLeft, ChevronRight, GraduationCap, Eraser } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import DoctorYearView from '@/components/vacation/DoctorYearView';

export default function TrainingPage() {
  const { isReadOnly, user } = useAuth();
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [selectedDoctorId, setSelectedDoctorId] = useState(null);
  const [activeModality, setActiveModality] = useState('CT');
  const [rangeStart, setRangeStart] = useState(null);
  
  const queryClient = useQueryClient();

  // Fetch Doctors (only Assistenzärzte typically, but let's allow all for now or filter)
  const { data: doctors = [] } = useQuery({
    queryKey: ['doctors'],
    queryFn: () => db.Doctor.list(),
    select: (data) => data.sort((a, b) => {
        const rolePriority = { "Chefarzt": 0, "Oberarzt": 1, "Facharzt": 2, "Assistenzarzt": 3 };
        const roleDiff = (rolePriority[a.role] ?? 99) - (rolePriority[b.role] ?? 99);
        if (roleDiff !== 0) return roleDiff;
        return (a.order || 0) - (b.order || 0);
    }),
  });

  // Fetch Workplaces for dynamic modalities
  const { data: workplaces = [] } = useQuery({
    queryKey: ['workplaces'],
    queryFn: () => db.Workplace.list(null, 1000),
  });

  // Select doctor logic
  React.useEffect(() => {
    if (doctors.length > 0) {
        // If user is not admin and has a doctor_id, force select that doctor
        if (user && user.role !== 'admin' && user.doctor_id) {
            if (selectedDoctorId !== user.doctor_id) {
                setSelectedDoctorId(user.doctor_id);
            }
        } else if (!selectedDoctorId) {
            // Default selection for admins or unassigned users
            const assis = doctors.find(d => d.role === 'Assistenzarzt');
            setSelectedDoctorId(assis ? assis.id : doctors[0].id);
        }
    }
  }, [doctors, selectedDoctorId, user]);

  const selectedDoctor = doctors.find(d => d.id === selectedDoctorId);

  // Fetch Rotations
  const { data: rotations = [] } = useQuery({
    queryKey: ['trainingRotations'],
    queryFn: () => db.TrainingRotation.list(),
  });

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

  const createRotationMutation = useMutation({
    mutationFn: (data) => db.TrainingRotation.create(data),
    onSuccess: () => queryClient.invalidateQueries(['trainingRotations']),
  });

  const deleteRotationMutation = useMutation({
    mutationFn: (id) => db.TrainingRotation.delete(id),
    onSuccess: () => queryClient.invalidateQueries(['trainingRotations']),
  });

  const updateRotationMutation = useMutation({
    mutationFn: ({ id, data }) => db.TrainingRotation.update(id, data),
    onSuccess: () => queryClient.invalidateQueries(['trainingRotations']),
  });

  const handleToggle = (date, currentStatus, event) => {
      if (!selectedDoctorId || isReadOnly) return;
      
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
          handleRangeDelete(start, end);
          return;
      }

      createRotationMutation.mutate({
          doctor_id: selectedDoctorId,
          modality: activeModality,
          start_date: startStr,
          end_date: endStr
      });
  };

  const handleRangeDelete = (start, end) => {
      const rangeStartStr = format(start, 'yyyy-MM-dd');
      const rangeEndStr = format(end, 'yyyy-MM-dd');

      // Find overlapping rotations
      const overlapping = rotations.filter(r => {
          if (r.doctor_id !== selectedDoctorId) return false;
          return r.start_date <= rangeEndStr && r.end_date >= rangeStartStr;
      });

      overlapping.forEach(rot => {
          // Case 1: Fully contained -> Delete
          if (rot.start_date >= rangeStartStr && rot.end_date <= rangeEndStr) {
              deleteRotationMutation.mutate(rot.id);
          }
          // Case 2: Range overlaps end of rotation (Shorten from right)
          // Rotation: [---]
          // Delete:      [---]
          else if (rot.start_date < rangeStartStr && rot.end_date <= rangeEndStr) {
              updateRotationMutation.mutate({
                  id: rot.id,
                  data: { end_date: format(subDays(start, 1), 'yyyy-MM-dd') }
              });
          }
          // Case 3: Range overlaps start of rotation (Shorten from left)
          // Rotation:      [---]
          // Delete:   [---]
          else if (rot.start_date >= rangeStartStr && rot.end_date > rangeEndStr) {
              updateRotationMutation.mutate({
                  id: rot.id,
                  data: { start_date: format(addDays(end, 1), 'yyyy-MM-dd') }
              });
          }
          // Case 4: Range in middle of rotation (Split)
          // Rotation: [-------]
          // Delete:     [---] 
          else if (rot.start_date < rangeStartStr && rot.end_date > rangeEndStr) {
              // 1. Shorten original to end before delete range
              updateRotationMutation.mutate({
                  id: rot.id,
                  data: { end_date: format(subDays(start, 1), 'yyyy-MM-dd') }
              });
              // 2. Create new rotation starting after delete range
              createRotationMutation.mutate({
                  doctor_id: rot.doctor_id,
                  modality: rot.modality,
                  start_date: format(addDays(end, 1), 'yyyy-MM-dd'),
                  end_date: rot.end_date
              });
          }
      });
  };

  const handleRangeSelect = (start, end) => {
      if (!selectedDoctorId || isReadOnly) return;
      const startDate = start < end ? start : end;
      const endDate = start < end ? end : start;
      
      if (activeModality === 'DELETE') {
          handleRangeDelete(startDate, endDate);
          return;
      }
      
      createRotationMutation.mutate({
          doctor_id: selectedDoctorId,
          modality: activeModality,
          start_date: format(startDate, 'yyyy-MM-dd'),
          end_date: format(endDate, 'yyyy-MM-dd')
      });
  };

  const handleInteraction = (date, currentStatus, event) => {
      if (isReadOnly) return;

      // DELETE Mode Logic
      if (activeModality === 'DELETE') {
          if (currentStatus) {
              // If clicking on existing in delete mode -> Delete (Shorten/Split logic applied to single day)
              handleRangeDelete(date, date);
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
              handleRangeDelete(date, date);
              return;
          }
          
          // Different Type -> Overwrite logic
          // If we click a day in the middle of a "MRT" rotation, and active is "CT".
          // We should split the MRT rotation and insert a 1-day CT rotation?
          // That seems appropriate for "Align with Vacation Planner".
          if (currentStatus && currentStatus !== activeModality && clickedDay) {
              // 1. Delete/Split old
              handleRangeDelete(date, date);
              // 2. Create new (handled by fallthrough to createRotationMutation if we called create here)
              // But handleRangeDelete is async in effect (mutations).
              // We can just fire both mutations.
              createRotationMutation.mutate({
                  doctor_id: selectedDoctorId,
                  modality: activeModality,
                  start_date: dateStr,
                  end_date: dateStr
              });
              return;
          }
      }

      handleToggle(date, currentStatus, event);
  };

  const modalities = useMemo(() => {
      // Default colors palette
      const colorPalette = [
          'bg-blue-500', 'bg-indigo-500', 'bg-green-500', 
          'bg-pink-500', 'bg-red-500', 'bg-slate-500', 
          'bg-amber-500', 'bg-purple-500', 'bg-cyan-500', 'bg-teal-500'
      ];

      // Filter only Rotations
      const rotationWorkplaces = workplaces
          .filter(w => w.category === 'Rotationen')
          .sort((a, b) => (a.order || 0) - (b.order || 0));

      let mods = [];
      // If no dynamic workplaces defined yet, fallback to defaults
      if (rotationWorkplaces.length === 0) {
          mods = [
            { id: 'CT', label: 'CT', color: 'bg-blue-500' },
            { id: 'MRT', label: 'MRT', color: 'bg-indigo-500' },
            { id: 'Sonographie', label: 'Sonographie', color: 'bg-green-500' },
            { id: 'Mammographie', label: 'Mammographie', color: 'bg-pink-500' },
            { id: 'Angiographie', label: 'Angiographie', color: 'bg-red-500' },
            { id: 'DL/konv. Rö', label: 'DL/konv. Rö', color: 'bg-slate-500' },
          ];
      } else {
          mods = rotationWorkplaces.map((w, i) => ({
              id: w.name,
              label: w.name,
              color: colorPalette[i % colorPalette.length]
          }));
      }

      // Add Delete Option
      mods.push({ 
          id: 'DELETE', 
          label: 'Löschen', 
          color: 'bg-slate-100 text-slate-900 border-slate-200 hover:bg-red-50 hover:text-red-600' 
      });
      
      return mods;
  }, [workplaces]);

  // If active modality is not in the list (e.g. after rename or initial load), set to first
  React.useEffect(() => {
      if (modalities.length > 0 && !modalities.find(m => m.id === activeModality)) {
          setActiveModality(modalities[0].id);
      }
  }, [modalities, activeModality]);

  const customColors = useMemo(() => {
    const colors = {};
    modalities.forEach(m => {
        colors[m.id] = m.color;
    });
    return colors;
  }, [modalities]);

  return (
    <div className="container mx-auto max-w-7xl">
      <div className="flex flex-col md:flex-row justify-between items-center mb-8 gap-4">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Ausbildungskalender</h1>
          <p className="text-slate-500 mt-1">Rotationsplanung für Assistenzärzte</p>
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
           
           <div className="w-px h-8 bg-slate-200 mx-2" />

           <Select 
            value={selectedDoctorId || ''} 
            onValueChange={setSelectedDoctorId}
            disabled={user && user.role !== 'admin' && user.doctor_id}
           >
            <SelectTrigger className="w-[200px]">
                <SelectValue placeholder="Arzt auswählen" />
            </SelectTrigger>
            <SelectContent>
                {doctors.map(d => (
                    <SelectItem key={d.id} value={d.id}>
                        {d.name} {d.role === 'Assistenzarzt' ? '(Ass.)' : ''}
                    </SelectItem>
                ))}
            </SelectContent>
           </Select>
        </div>
      </div>
      
      <div className="flex gap-2 mb-6 overflow-x-auto pb-2">
          {modalities.map(type => (
              <Button
                  key={type.id}
                  variant={activeModality === type.id ? "default" : "outline"}
                  onClick={() => !isReadOnly && setActiveModality(type.id)}
                  className={`gap-2 shrink-0 ${activeModality === type.id ? type.color + ' hover:' + type.color + '/90 border-transparent' : 'hover:bg-slate-50'} ${isReadOnly ? 'cursor-default opacity-100 hover:bg-transparent' : ''}`}
                  disabled={isReadOnly && activeModality !== type.id}
              >
                  {type.id === 'DELETE' ? <Eraser className="w-4 h-4" /> : <div className={`w-3 h-3 rounded-full ${type.color}`} />}
                  {type.label}
              </Button>
          ))}
      </div>

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
            />
        </div>
      ) : (
        <div className="text-center py-12 text-slate-500">
            Bitte wählen Sie einen Arzt aus.
        </div>
      )}
    </div>
  );
}