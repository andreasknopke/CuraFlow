import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { db } from "@/api/client";
import { 
    Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
    DialogFooter, DialogDescription
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { 
    Users, Plus, Trash2, GripVertical, Pencil, Settings2
} from 'lucide-react';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
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

// Standard-Rollen die initial angelegt werden
export const DEFAULT_TEAM_ROLES = [
    { name: "Chefarzt", priority: 0, is_specialist: true },
    { name: "Oberarzt", priority: 1, is_specialist: true },
    { name: "Facharzt", priority: 2, is_specialist: true },
    { name: "Assistenzarzt", priority: 3, is_specialist: false },
    { name: "Nicht-Radiologe", priority: 4, is_specialist: false },
];

// Hook zum Laden der Team-Rollen mit Fallback auf Defaults
export function useTeamRoles() {
    const { data: teamRoles = [], isLoading, refetch } = useQuery({
        queryKey: ['teamRoles'],
        queryFn: () => db.TeamRole.list(),
        select: (data) => {
            if (!data || data.length === 0) {
                return DEFAULT_TEAM_ROLES;
            }
            return data.sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99));
        },
    });

    // Rollen-Namen als Array für Dropdowns
    const roleNames = teamRoles.map(r => r.name);
    
    // Priority-Map für Sortierung
    const rolePriority = teamRoles.reduce((acc, role, idx) => {
        acc[role.name] = role.priority ?? idx;
        return acc;
    }, {});

    // Specialist-Rollen für Validierung
    const specialistRoles = teamRoles.filter(r => r.is_specialist).map(r => r.name);

    return { 
        teamRoles, 
        roleNames, 
        rolePriority, 
        specialistRoles,
        isLoading, 
        refetch 
    };
}

// Initialisiert Standard-Rollen in der Datenbank falls noch keine vorhanden
export async function initializeDefaultRoles() {
    try {
        const existing = await db.TeamRole.list();
        if (existing && existing.length > 0) {
            console.log('TeamRoles already initialized');
            return existing;
        }

        console.log('Initializing default team roles...');
        for (const role of DEFAULT_TEAM_ROLES) {
            await db.TeamRole.create(role);
        }
        console.log('Default team roles created');
        return DEFAULT_TEAM_ROLES;
    } catch (error) {
        console.error('Failed to initialize team roles:', error);
        return DEFAULT_TEAM_ROLES;
    }
}

function RoleEditDialog({ role, open, onOpenChange, onSave }) {
    const [formData, setFormData] = useState({
        name: role?.name || '',
        is_specialist: role?.is_specialist || false,
    });

    useEffect(() => {
        if (role) {
            setFormData({
                name: role.name || '',
                is_specialist: role.is_specialist || false,
            });
        } else {
            setFormData({ name: '', is_specialist: false });
        }
    }, [role, open]);

    const handleSubmit = (e) => {
        e.preventDefault();
        if (formData.name.trim()) {
            onSave(formData);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[400px]">
                <DialogHeader>
                    <DialogTitle>
                        {role ? "Funktion bearbeiten" : "Neue Funktion hinzufügen"}
                    </DialogTitle>
                    <DialogDescription>
                        Funktionen definieren die Hierarchie und Qualifikation im Team.
                    </DialogDescription>
                </DialogHeader>
                <form onSubmit={handleSubmit} className="grid gap-4 py-4">
                    <div className="grid gap-2">
                        <Label htmlFor="roleName">Name der Funktion</Label>
                        <Input
                            id="roleName"
                            value={formData.name}
                            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                            placeholder="z.B. Oberarzt, Facharzt, etc."
                            required
                        />
                    </div>
                    <div className="flex items-center gap-3">
                        <input
                            type="checkbox"
                            id="isSpecialist"
                            checked={formData.is_specialist}
                            onChange={(e) => setFormData({ ...formData, is_specialist: e.target.checked })}
                            className="h-4 w-4 rounded border-slate-300"
                        />
                        <Label htmlFor="isSpecialist" className="text-sm">
                            Gilt als Facharzt-Qualifikation (für Besetzungsprüfung)
                        </Label>
                    </div>
                    <DialogFooter>
                        <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                            Abbrechen
                        </Button>
                        <Button type="submit">Speichern</Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}

export default function TeamRoleSettings() {
    const queryClient = useQueryClient();
    const [isDialogOpen, setIsDialogOpen] = useState(false);
    const [editDialogOpen, setEditDialogOpen] = useState(false);
    const [editingRole, setEditingRole] = useState(null);

    const { data: teamRoles = [], isLoading } = useQuery({
        queryKey: ['teamRoles'],
        queryFn: async () => {
            const roles = await db.TeamRole.list();
            // Initialisiere Defaults falls leer
            if (!roles || roles.length === 0) {
                return initializeDefaultRoles();
            }
            return roles.sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99));
        },
    });

    const createMutation = useMutation({
        mutationFn: (data) => db.TeamRole.create({ 
            ...data, 
            priority: teamRoles.length 
        }),
        onSuccess: () => {
            queryClient.invalidateQueries(['teamRoles']);
            setEditDialogOpen(false);
            setEditingRole(null);
        },
    });

    const updateMutation = useMutation({
        mutationFn: ({ id, data }) => db.TeamRole.update(id, data),
        onSuccess: () => {
            queryClient.invalidateQueries(['teamRoles']);
            setEditDialogOpen(false);
            setEditingRole(null);
        },
    });

    const deleteMutation = useMutation({
        mutationFn: (id) => db.TeamRole.delete(id),
        onSuccess: () => queryClient.invalidateQueries(['teamRoles']),
    });

    const handleDragEnd = (result) => {
        if (!result.destination) return;
        
        const items = Array.from(teamRoles);
        const [reorderedItem] = items.splice(result.source.index, 1);
        items.splice(result.destination.index, 0, reorderedItem);

        // Update priorities
        items.forEach((role, index) => {
            if (role.priority !== index) {
                updateMutation.mutate({ id: role.id, data: { priority: index } });
            }
        });
    };

    const handleAddNew = () => {
        setEditingRole(null);
        setEditDialogOpen(true);
    };

    const handleEdit = (role) => {
        setEditingRole(role);
        setEditDialogOpen(true);
    };

    const handleSave = (formData) => {
        if (editingRole) {
            updateMutation.mutate({ id: editingRole.id, data: formData });
        } else {
            createMutation.mutate(formData);
        }
    };

    return (
        <>
            <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                <DialogTrigger asChild>
                    <Button variant="outline" size="icon" title="Funktionen verwalten">
                        <Settings2 className="h-4 w-4" />
                    </Button>
                </DialogTrigger>
                <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <Users className="h-5 w-5" />
                            Team-Funktionen verwalten
                        </DialogTitle>
                        <DialogDescription>
                            Definieren Sie die Funktionen/Rollen für Ihr Team. 
                            Die Reihenfolge bestimmt die Hierarchie in Listen.
                        </DialogDescription>
                    </DialogHeader>
                    
                    <div className="py-4">
                        <DragDropContext onDragEnd={handleDragEnd}>
                            <Droppable droppableId="roles-list">
                                {(provided) => (
                                    <div 
                                        {...provided.droppableProps} 
                                        ref={provided.innerRef}
                                        className="space-y-2"
                                    >
                                        {teamRoles.map((role, index) => (
                                            <Draggable 
                                                key={role.id || role.name} 
                                                draggableId={role.id || role.name} 
                                                index={index}
                                            >
                                                {(provided, snapshot) => (
                                                    <div
                                                        ref={provided.innerRef}
                                                        {...provided.draggableProps}
                                                        className={`${snapshot.isDragging ? "z-50" : ""}`}
                                                    >
                                                        <Card className={`${snapshot.isDragging ? "shadow-lg ring-2 ring-indigo-500" : ""}`}>
                                                            <CardContent className="p-3 flex items-center gap-3">
                                                                <div 
                                                                    {...provided.dragHandleProps} 
                                                                    className="cursor-grab active:cursor-grabbing text-slate-400 hover:text-slate-600"
                                                                >
                                                                    <GripVertical className="w-4 h-4" />
                                                                </div>
                                                                <div className="flex-1">
                                                                    <span className="font-medium">{role.name}</span>
                                                                    {role.is_specialist && (
                                                                        <Badge variant="secondary" className="ml-2 text-xs">
                                                                            Facharzt
                                                                        </Badge>
                                                                    )}
                                                                </div>
                                                                <div className="flex gap-1">
                                                                    <Button 
                                                                        variant="ghost" 
                                                                        size="icon" 
                                                                        className="h-7 w-7 text-slate-400 hover:text-indigo-600"
                                                                        onClick={() => handleEdit(role)}
                                                                    >
                                                                        <Pencil className="w-3 h-3" />
                                                                    </Button>
                                                                    <AlertDialog>
                                                                        <AlertDialogTrigger asChild>
                                                                            <Button 
                                                                                variant="ghost" 
                                                                                size="icon" 
                                                                                className="h-7 w-7 text-slate-400 hover:text-red-600"
                                                                            >
                                                                                <Trash2 className="w-3 h-3" />
                                                                            </Button>
                                                                        </AlertDialogTrigger>
                                                                        <AlertDialogContent>
                                                                            <AlertDialogHeader>
                                                                                <AlertDialogTitle>Funktion löschen?</AlertDialogTitle>
                                                                                <AlertDialogDescription>
                                                                                    Die Funktion "{role.name}" wird gelöscht. 
                                                                                    Bestehende Teammitglieder mit dieser Funktion behalten ihre Zuordnung.
                                                                                </AlertDialogDescription>
                                                                            </AlertDialogHeader>
                                                                            <AlertDialogFooter>
                                                                                <AlertDialogCancel>Abbrechen</AlertDialogCancel>
                                                                                <AlertDialogAction 
                                                                                    onClick={() => deleteMutation.mutate(role.id)}
                                                                                    className="bg-red-600 hover:bg-red-700"
                                                                                >
                                                                                    Löschen
                                                                                </AlertDialogAction>
                                                                            </AlertDialogFooter>
                                                                        </AlertDialogContent>
                                                                    </AlertDialog>
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

                        <Button 
                            onClick={handleAddNew} 
                            variant="outline" 
                            className="w-full mt-4"
                        >
                            <Plus className="w-4 h-4 mr-2" />
                            Neue Funktion hinzufügen
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>

            <RoleEditDialog
                role={editingRole}
                open={editDialogOpen}
                onOpenChange={setEditDialogOpen}
                onSave={handleSave}
            />
        </>
    );
}
