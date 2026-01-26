import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import { api, db, base44 } from "@/api/client";
import { useAuth } from '@/components/AuthProvider';
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Plus, Pencil, Trash2, User, GripVertical } from "lucide-react";
import DoctorForm from "@/components/staff/DoctorForm";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import StaffingPlanTable from "@/components/staff/StaffingPlanTable";
import { trackDbChange } from '@/components/utils/dbTracker';
import TeamRoleSettings, { useTeamRoles } from '@/components/settings/TeamRoleSettings';

export default function StaffPage() {
  const { isReadOnly, user } = useAuth();

  if (!user || user.role !== 'admin') {
      return (
          <div className="flex items-center justify-center h-[50vh] text-slate-500">
              <div className="text-center">
                  <User className="w-12 h-12 mx-auto mb-4 opacity-20" />
                  <h2 className="text-lg font-semibold">Zugriff verweigert</h2>
                  <p>Diese Seite ist nur für Administratoren sichtbar.</p>
              </div>
          </div>
      );
  }
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingDoctor, setEditingDoctor] = useState(null);
  const queryClient = useQueryClient();

  // Dynamische Rollenprioritäten aus DB laden
  const { rolePriority } = useTeamRoles();

  const { data: doctors = [], isLoading } = useQuery({
    queryKey: ["doctors"],
    queryFn: () => db.Doctor.list(),
    select: (data) => data.sort((a, b) => {
      const roleDiff = (rolePriority[a.role] ?? 99) - (rolePriority[b.role] ?? 99);
      if (roleDiff !== 0) return roleDiff;
      return (a.order || 0) - (b.order || 0);
    }),
  });

  const { data: colorSettings = [] } = useQuery({
      queryKey: ['colorSettings'],
      queryFn: () => db.ColorSetting.list(),
  });

  const getRoleColor = (role) => {
      const setting = colorSettings.find(s => s.name === role && s.category === 'role');
      if (setting) return { backgroundColor: setting.bg_color, color: setting.text_color };
      
      // Defaults matching ScheduleBoard
      const defaults = {
          "Chefarzt": { bg: "#fee2e2", text: "#991b1b" },
          "Oberarzt": { bg: "#dbeafe", text: "#1e40af" },
          "Facharzt": { bg: "#dcfce7", text: "#166534" },
          "Assistenzarzt": { bg: "#fef9c3", text: "#854d0e" },
          "Nicht-Radiologe": { bg: "#e5e7eb", text: "#1f2937" }
      };
      
      if (defaults[role]) return { backgroundColor: defaults[role].bg, color: defaults[role].text };
      return { backgroundColor: "#f3f4f6", color: "#1f2937" };
  };

  const createMutation = useMutation({
    mutationFn: (data) => db.Doctor.create({...data, order: doctors.length}),
    onSuccess: () => {
      trackDbChange();
      queryClient.invalidateQueries(["doctors"]);
      setIsFormOpen(false);
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => db.Doctor.update(id, data),
    onSuccess: () => {
      trackDbChange();
      queryClient.invalidateQueries(["doctors"]);
      setIsFormOpen(false);
      setEditingDoctor(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => db.Doctor.delete(id),
    onSuccess: () => {
      trackDbChange();
      queryClient.invalidateQueries(["doctors"]);
    },
  });

  const handleSave = (data) => {
    if (editingDoctor) {
      updateMutation.mutate({ id: editingDoctor.id, data });
    } else {
      createMutation.mutate(data);
    }
  };

  const handleEdit = (doctor) => {
    setEditingDoctor(doctor);
    setIsFormOpen(true);
  };

  const handleAddNew = () => {
    setEditingDoctor(null);
    setIsFormOpen(true);
  };

  const handleDragEnd = (result) => {
    if (!result.destination) return;
    
    const items = Array.from(doctors);
    const [reorderedItem] = items.splice(result.source.index, 1);
    items.splice(result.destination.index, 0, reorderedItem);

    items.forEach((doc, index) => {
        if (doc.order !== index) {
            updateMutation.mutate({ id: doc.id, data: { order: index } });
        }
    });
  };

  return (
    <div className="container mx-auto max-w-6xl">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Team</h1>
          <p className="text-slate-500 mt-2">Verwaltung der Mitarbeiter und Funktionen</p>
        </div>
        <div className="flex gap-2">
          {!isReadOnly && <TeamRoleSettings />}
          {!isReadOnly && (
          <Button onClick={handleAddNew} className="bg-indigo-600 hover:bg-indigo-700">
            <Plus className="w-4 h-4 mr-2" />
            Teammitglied hinzufügen
          </Button>
          )}
        </div>
      </div>

      <Tabs defaultValue="list" className="space-y-6">
          <TabsList>
              <TabsTrigger value="list">Mitarbeiterliste</TabsTrigger>
              <TabsTrigger value="staffing">Stellenplan</TabsTrigger>
          </TabsList>

          <TabsContent value="list">
              {isLoading ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {Array(6).fill(0).map((_, i) => (
                        <Card key={i} className="h-32">
                          <CardContent className="p-6 flex gap-4">
                            <Skeleton className="w-12 h-12 rounded-full" />
                            <div className="space-y-2">
                              <Skeleton className="w-32 h-4" />
                              <Skeleton className="w-20 h-4" />
                            </div>
                          </CardContent>
                        </Card>
                    ))}
                </div>
              ) : (
                <DragDropContext onDragEnd={handleDragEnd}>
                    <Droppable droppableId="doctors-list" direction="vertical">
                        {(provided) => (
                            <div 
                                {...provided.droppableProps} 
                                ref={provided.innerRef}
                                className="grid grid-cols-1 gap-4"
                            >
                                {doctors.map((doctor, index) => (
                                    <Draggable key={doctor.id} draggableId={doctor.id} index={index} isDragDisabled={isReadOnly}>
                                        {(provided, snapshot) => (
                                            <div
                                                ref={provided.innerRef}
                                                {...provided.draggableProps}
                                                className={`transition-shadow ${snapshot.isDragging ? "z-50" : ""}`}
                                            >
                                                <Card className={`hover:shadow-md ${snapshot.isDragging ? "shadow-lg ring-2 ring-indigo-500" : ""}`}>
                                                    <CardContent className="p-4 flex items-center justify-between">
                                                        <div className="flex items-center gap-4 flex-1">
                                                            {!isReadOnly && (
                                                            <div {...provided.dragHandleProps} className="cursor-grab active:cursor-grabbing text-slate-400 hover:text-slate-600">
                                                                <GripVertical className="w-5 h-5" />
                                                            </div>
                                                            )}
                                                            <div 
                                                                className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold shadow-sm flex-shrink-0"
                                                                style={getRoleColor(doctor.role)}
                                                            >
                                                                {doctor.initials || <User className="w-5 h-5 opacity-50" />}
                                                            </div>
                                                            <div className="flex-1">
                                                                <h3 className="font-semibold text-slate-900">{doctor.name}</h3>
                                                                <Badge variant="secondary" className="text-xs font-normal">
                                                                    {doctor.role}
                                                                </Badge>
                                                            </div>
                                                        </div>
                                                        <div className="flex space-x-1">
                                                            {!isReadOnly && (
                                                            <>
                                                            <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-400 hover:text-indigo-600" onClick={() => handleEdit(doctor)}>
                                                                <Pencil className="w-4 h-4" />
                                                            </Button>
                                                            <AlertDialog>
                                                                <AlertDialogTrigger asChild>
                                                                    <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-400 hover:text-red-600">
                                                                        <Trash2 className="w-4 h-4" />
                                                                    </Button>
                                                                </AlertDialogTrigger>
                                                                <AlertDialogContent>
                                                                    <AlertDialogHeader>
                                                                        <AlertDialogTitle>Sind Sie sicher?</AlertDialogTitle>
                                                                        <AlertDialogDescription>
                                                                            Diese Aktion kann nicht rückgängig gemacht werden.
                                                                        </AlertDialogDescription>
                                                                    </AlertDialogHeader>
                                                                    <AlertDialogFooter>
                                                                        <AlertDialogCancel>Abbrechen</AlertDialogCancel>
                                                                        <AlertDialogAction onClick={() => deleteMutation.mutate(doctor.id)} className="bg-red-600 hover:bg-red-700">
                                                                            Löschen
                                                                        </AlertDialogAction>
                                                                    </AlertDialogFooter>
                                                                </AlertDialogContent>
                                                            </AlertDialog>
                                                            </>
                                                            )}
                                                        </div>
                                                    </CardContent>
                                                </Card>
                                            </div>
                                        )}
                                    </Draggable>
                                ))}
                                {provided.placeholder}
                            </div>
                        )}
                    </Droppable>
                </DragDropContext>
              )}
          </TabsContent>

          <TabsContent value="staffing">
              <StaffingPlanTable doctors={doctors} isReadOnly={isReadOnly} />
          </TabsContent>
      </Tabs>

      <DoctorForm
        open={isFormOpen}
        onOpenChange={setIsFormOpen}
        doctor={editingDoctor}
        onSubmit={handleSave}
      />
    </div>
  );
}