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
    { name: "Chefarzt", priority: 0, is_specialist: true, can_do_foreground_duty: false, can_do_background_duty: true, excluded_from_statistics: false, description: "Oberste Führungsebene" },
    { name: "Oberarzt", priority: 1, is_specialist: true, can_do_foreground_duty: false, can_do_background_duty: true, excluded_from_statistics: false, description: "Kann Hintergrunddienste übernehmen" },
    { name: "Facharzt", priority: 2, is_specialist: true, can_do_foreground_duty: true, can_do_background_duty: true, excluded_from_statistics: false, description: "Kann alle Dienste übernehmen" },
    { name: "Assistenzarzt", priority: 3, is_specialist: false, can_do_foreground_duty: true, can_do_background_duty: false, excluded_from_statistics: false, description: "Kann Vordergrunddienste übernehmen" },
    { name: "Nicht-Radiologe", priority: 4, is_specialist: false, can_do_foreground_duty: false, can_do_background_duty: false, excluded_from_statistics: true, description: "Wird in Statistiken nicht gezählt" },
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
    
    // Berechtigungsbasierte Rollen-Listen mit Fallback für alte DBs ohne Migration
    // Fallback: Wenn can_do_foreground_duty undefined ist, erlauben (altes Verhalten)
    const foregroundDutyRoles = teamRoles.filter(r => r.can_do_foreground_duty !== false).map(r => r.name);
    // Fallback: Wenn can_do_background_duty undefined ist, auf is_specialist zurückfallen (altes Verhalten)
    const backgroundDutyRoles = teamRoles.filter(r => 
        r.can_do_background_duty === true || (r.can_do_background_duty === undefined && r.is_specialist)
    ).map(r => r.name);
    // Fallback: Wenn excluded_from_statistics undefined ist, prüfe auf Nicht-Radiologe (altes Verhalten)
    const statisticsExcludedRoles = teamRoles.filter(r => 
        r.excluded_from_statistics === true || (r.excluded_from_statistics === undefined && r.name === 'Nicht-Radiologe')
    ).map(r => r.name);

    // Helper-Funktion um Berechtigungen zu prüfen (mit Fallback für alte DBs)
    const canDoForegroundDuty = (roleName) => {
        const role = teamRoles.find(r => r.name === roleName);
        return role ? role.can_do_foreground_duty !== false : true;
    };

    const canDoBackgroundDuty = (roleName) => {
        const role = teamRoles.find(r => r.name === roleName);
        if (!role) return false;
        // Fallback auf is_specialist wenn can_do_background_duty nicht gesetzt ist
        if (role.can_do_background_duty === undefined) return role.is_specialist === true;
        return role.can_do_background_duty === true;
    };

    const isExcludedFromStatistics = (roleName) => {
        const role = teamRoles.find(r => r.name === roleName);
        if (!role) return false;
        // Fallback auf Nicht-Radiologe wenn excluded_from_statistics nicht gesetzt ist
        if (role.excluded_from_statistics === undefined) return role.name === 'Nicht-Radiologe';
        return role.excluded_from_statistics === true;
    };

    return { 
        teamRoles, 
        roleNames, 
        rolePriority, 
        specialistRoles,
        foregroundDutyRoles,
        backgroundDutyRoles,
        statisticsExcludedRoles,
        canDoForegroundDuty,
        canDoBackgroundDuty,
        isExcludedFromStatistics,
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
        can_do_foreground_duty: role?.can_do_foreground_duty ?? true,
        can_do_background_duty: role?.can_do_background_duty ?? false,
        excluded_from_statistics: role?.excluded_from_statistics ?? false,
        description: role?.description || '',
    });

    useEffect(() => {
        if (role) {
            setFormData({
                name: role.name || '',
                is_specialist: role.is_specialist || false,
                can_do_foreground_duty: role.can_do_foreground_duty ?? true,
                can_do_background_duty: role.can_do_background_duty ?? false,
                excluded_from_statistics: role.excluded_from_statistics ?? false,
                description: role.description || '',
            });
        } else {
            setFormData({ 
                name: '', 
                is_specialist: false,
                can_do_foreground_duty: true,
                can_do_background_duty: false,
                excluded_from_statistics: false,
                description: '',
            });
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
            <DialogContent className="sm:max-w-[450px]">
                <DialogHeader>
                    <DialogTitle>
                        {role ? "Funktion bearbeiten" : "Neue Funktion hinzufügen"}
                    </DialogTitle>
                    <DialogDescription>
                        Funktionen definieren die Hierarchie und Berechtigungen im Team.
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
                    <div className="grid gap-2">
                        <Label htmlFor="roleDescription">Beschreibung (optional)</Label>
                        <Input
                            id="roleDescription"
                            value={formData.description}
                            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                            placeholder="z.B. Kann Hintergrunddienste übernehmen"
                        />
                    </div>
                    
                    <div className="border-t pt-4 mt-2">
                        <Label className="text-sm font-semibold text-slate-700 mb-3 block">Berechtigungen</Label>
                        <div className="space-y-3">
                            <div className="flex items-center gap-3">
                                <input
                                    type="checkbox"
                                    id="isSpecialist"
                                    checked={formData.is_specialist}
                                    onChange={(e) => setFormData({ ...formData, is_specialist: e.target.checked })}
                                    className="h-4 w-4 rounded border-slate-300"
                                />
                                <Label htmlFor="isSpecialist" className="text-sm font-normal">
                                    Gilt als Facharzt-Qualifikation
                                </Label>
                            </div>
                            <div className="flex items-center gap-3">
                                <input
                                    type="checkbox"
                                    id="canDoForeground"
                                    checked={formData.can_do_foreground_duty}
                                    onChange={(e) => setFormData({ ...formData, can_do_foreground_duty: e.target.checked })}
                                    className="h-4 w-4 rounded border-slate-300"
                                />
                                <Label htmlFor="canDoForeground" className="text-sm font-normal">
                                    Kann Vordergrunddienste übernehmen
                                </Label>
                            </div>
                            <div className="flex items-center gap-3">
                                <input
                                    type="checkbox"
                                    id="canDoBackground"
                                    checked={formData.can_do_background_duty}
                                    onChange={(e) => setFormData({ ...formData, can_do_background_duty: e.target.checked })}
                                    className="h-4 w-4 rounded border-slate-300"
                                />
                                <Label htmlFor="canDoBackground" className="text-sm font-normal">
                                    Kann Hintergrunddienste übernehmen
                                </Label>
                            </div>
                            <div className="flex items-center gap-3">
                                <input
                                    type="checkbox"
                                    id="excludedFromStats"
                                    checked={formData.excluded_from_statistics}
                                    onChange={(e) => setFormData({ ...formData, excluded_from_statistics: e.target.checked })}
                                    className="h-4 w-4 rounded border-slate-300"
                                />
                                <Label htmlFor="excludedFromStats" className="text-sm font-normal">
                                    Von Statistiken ausschließen
                                </Label>
                            </div>
                        </div>
                    </div>
                    
                    <DialogFooter className="mt-4">
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
                                                                    <div className="flex items-center flex-wrap gap-1">
                                                                        <span className="font-medium">{role.name}</span>
                                                                        {role.is_specialist === true && (
                                                                            <Badge variant="secondary" className="text-xs bg-blue-100 text-blue-700">
                                                                                Facharzt
                                                                            </Badge>
                                                                        )}
                                                                        {role.can_do_foreground_duty === true && (
                                                                            <Badge variant="secondary" className="text-xs bg-green-100 text-green-700">
                                                                                VG
                                                                            </Badge>
                                                                        )}
                                                                        {role.can_do_background_duty === true && (
                                                                            <Badge variant="secondary" className="text-xs bg-orange-100 text-orange-700">
                                                                                HG
                                                                            </Badge>
                                                                        )}
                                                                        {role.excluded_from_statistics === true && (
                                                                            <Badge variant="secondary" className="text-xs bg-slate-100 text-slate-500">
                                                                                Kein Stat
                                                                            </Badge>
                                                                        )}
                                                                    </div>
                                                                    {role.description && (
                                                                        <p className="text-xs text-slate-500 mt-0.5">{role.description}</p>
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
