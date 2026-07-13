import { useState, useEffect } from 'react';
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
import type { DropResult } from '@hello-pangea/dnd';
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

interface TeamRoleData {
  id?: string;
  name: string;
  priority: number;
  is_specialist: boolean;
  can_do_foreground_duty: boolean | undefined;
  can_do_background_duty: boolean | undefined;
  excluded_from_statistics: boolean | undefined;
  description?: string | null;
  [key: string]: unknown;
}

// Standard-Rollen die initial angelegt werden
export const DEFAULT_TEAM_ROLES: TeamRoleData[] = [
    { name: "Chefarzt", priority: 0, is_specialist: true, can_do_foreground_duty: false, can_do_background_duty: true, excluded_from_statistics: false, description: "Oberste Führungsebene" },
    { name: "Oberarzt", priority: 1, is_specialist: true, can_do_foreground_duty: false, can_do_background_duty: true, excluded_from_statistics: false, description: "Kann Hintergrunddienste übernehmen" },
    { name: "Facharzt", priority: 2, is_specialist: true, can_do_foreground_duty: true, can_do_background_duty: true, excluded_from_statistics: false, description: "Kann alle Dienste übernehmen" },
    { name: "Assistenzarzt", priority: 3, is_specialist: false, can_do_foreground_duty: true, can_do_background_duty: false, excluded_from_statistics: false, description: "Kann Vordergrunddienste übernehmen" },
    { name: "Nicht-Radiologe", priority: 4, is_specialist: false, can_do_foreground_duty: false, can_do_background_duty: false, excluded_from_statistics: true, description: "Wird in Statistiken nicht gezählt" },
    { name: "Pflegekraft", priority: 5, is_specialist: false, can_do_foreground_duty: false, can_do_background_duty: false, excluded_from_statistics: false, description: "Pflegerische Betreuung der Patienten" },
    { name: "MTR", priority: 6, is_specialist: false, can_do_foreground_duty: false, can_do_background_duty: false, excluded_from_statistics: false, description: "Medizinischer Technologe für Radiologie" },
    { name: "MTL", priority: 7, is_specialist: false, can_do_foreground_duty: false, can_do_background_duty: false, excluded_from_statistics: false, description: "Medizinischer Technologe für Laboratoriumsanalytik" },
    { name: "MTA", priority: 8, is_specialist: false, can_do_foreground_duty: false, can_do_background_duty: false, excluded_from_statistics: false, description: "Medizinisch-technische Assistenz" },
    { name: "Physician Assistant", priority: 9, is_specialist: false, can_do_foreground_duty: false, can_do_background_duty: false, excluded_from_statistics: false, description: "Unterstützung der ärztlichen Tätigkeit" },
    { name: "Hilfskraft", priority: 10, is_specialist: false, can_do_foreground_duty: false, can_do_background_duty: false, excluded_from_statistics: false, description: "Unterstützung im Praxisalltag" },
    { name: "Student", priority: 11, is_specialist: false, can_do_foreground_duty: false, can_do_background_duty: false, excluded_from_statistics: false, description: "Student in der Ausbildung" },
    { name: "Hospitant", priority: 12, is_specialist: false, can_do_foreground_duty: false, can_do_background_duty: false, excluded_from_statistics: false, description: "Hospitant zur Orientierung" },
    { name: "MFA", priority: 13, is_specialist: false, can_do_foreground_duty: false, can_do_background_duty: false, excluded_from_statistics: false, description: "Medizinische Fachangestellte" },
    { name: "Pflegefachkraft", priority: 14, is_specialist: false, can_do_foreground_duty: false, can_do_background_duty: false, excluded_from_statistics: false, description: "Pflegerische Betreuung der Patienten" },
    { name: "KAPH", priority: 15, is_specialist: false, can_do_foreground_duty: false, can_do_background_duty: false, excluded_from_statistics: false, description: "Krankenpflegehilfe" },
    { name: "Azubi MFA", priority: 16, is_specialist: false, can_do_foreground_duty: false, can_do_background_duty: false, excluded_from_statistics: false, description: "Auszubildende/r Medizinische Fachangestellte" },
    { name: "Azubi PFF", priority: 17, is_specialist: false, can_do_foreground_duty: false, can_do_background_duty: false, excluded_from_statistics: false, description: "Auszubildende/r Pflegefachkraft" },
    { name: "Azubi PFM", priority: 18, is_specialist: false, can_do_foreground_duty: false, can_do_background_duty: false, excluded_from_statistics: false, description: "Auszubildende/r Pflegefachmann/-frau" },
    { name: "Azubi PFFP", priority: 19, is_specialist: false, can_do_foreground_duty: false, can_do_background_duty: false, excluded_from_statistics: false, description: "Auszubildende/r Pflegefachkraft (Praktikum)" },
    { name: "Azubi ATA", priority: 20, is_specialist: false, can_do_foreground_duty: false, can_do_background_duty: false, excluded_from_statistics: false, description: "Auszubildende/r Anästhesietechnische Assistenz" },
    { name: "Azubi OTA", priority: 21, is_specialist: false, can_do_foreground_duty: false, can_do_background_duty: false, excluded_from_statistics: false, description: "Auszubildende/r Operationstechnische Assistenz" },
    { name: "Azubi MTR", priority: 22, is_specialist: false, can_do_foreground_duty: false, can_do_background_duty: false, excluded_from_statistics: false, description: "Auszubildende/r Medizinischer Technologe Radiologie" },
    { name: "Azubi MTL", priority: 23, is_specialist: false, can_do_foreground_duty: false, can_do_background_duty: false, excluded_from_statistics: false, description: "Auszubildende/r Medizinischer Technologe Labor" },
    { name: "Azubi KAPH", priority: 24, is_specialist: false, can_do_foreground_duty: false, can_do_background_duty: false, excluded_from_statistics: false, description: "Auszubildende/r Krankenpflegehilfe" },
    { name: "Studentische Hilfskraft", priority: 25, is_specialist: false, can_do_foreground_duty: false, can_do_background_duty: false, excluded_from_statistics: false, description: "Studentische Unterstützung im Praxisalltag" },
    { name: "Pflegerische Hilfskraft", priority: 26, is_specialist: false, can_do_foreground_duty: false, can_do_background_duty: false, excluded_from_statistics: false, description: "Unterstützung in der Pflege" },
];

interface TeamRolesResult {
  teamRoles: TeamRoleData[];
  roleNames: string[];
  rolePriority: Record<string, number>;
  specialistRoles: string[];
  foregroundDutyRoles: string[];
  backgroundDutyRoles: string[];
  statisticsExcludedRoles: string[];
  canDoForegroundDuty: (roleName: string) => boolean;
  canDoBackgroundDuty: (roleName: string) => boolean;
  isExcludedFromStatistics: (roleName: string) => boolean;
  isLoading: boolean;
  refetch: () => unknown;
}

// Hook zum Laden der Team-Rollen mit Fallback auf Defaults
export function useTeamRoles(): TeamRolesResult {
    const { data: teamRoles = [], isLoading, refetch } = useQuery<TeamRoleData[]>({
        queryKey: ['teamRoles'],
        queryFn: async () => {
            // Stellt sicher, dass alle Default-Rollen existieren (ergänzt nur fehlende)
            const roles = await initializeDefaultRoles();
            return roles.sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99));
        },
    });

    // Rollen-Namen als Array für Dropdowns
    const roleNames = teamRoles.map(r => r.name);
    
    // Priority-Map für Sortierung
    const rolePriority: Record<string, number> = teamRoles.reduce((acc, role, idx) => {
        acc[role.name] = role.priority ?? idx;
        return acc;
    }, {} as Record<string, number>);

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
    const canDoForegroundDuty = (roleName: string): boolean => {
        const role = teamRoles.find(r => r.name === roleName);
        return role ? role.can_do_foreground_duty !== false : true;
    };

    const canDoBackgroundDuty = (roleName: string): boolean => {
        const role = teamRoles.find(r => r.name === roleName);
        if (!role) return false;
        // Fallback auf is_specialist wenn can_do_background_duty nicht gesetzt ist
        if (role.can_do_background_duty === undefined) return role.is_specialist === true;
        return role.can_do_background_duty === true;
    };

    const isExcludedFromStatistics = (roleName: string): boolean => {
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

// Initialisiert Standard-Rollen in der Datenbank — ergänzt fehlende, löscht keine bestehenden
export async function initializeDefaultRoles(): Promise<TeamRoleData[]> {
    try {
        const existing = await db.TeamRole.list();
        const existingCasted = existing as unknown as TeamRoleData[];
        const existingNames = new Set((existingCasted || []).map((r: TeamRoleData) => r.name));
        const missingRoles = DEFAULT_TEAM_ROLES.filter(r => !existingNames.has(r.name));

        if (missingRoles.length === 0) {
            return existingCasted;
        }

        console.log(`Adding ${missingRoles.length} missing default team roles...`);
        for (const role of missingRoles) {
            await db.TeamRole.create(role as Record<string, unknown>);
        }
        console.log('Missing default team roles created');
        return [...(existingCasted || []), ...missingRoles];
    } catch (error) {
        console.error('Failed to initialize team roles:', error);
        return DEFAULT_TEAM_ROLES;
    }
}

interface RoleEditFormData {
  name: string;
  is_specialist: boolean;
  can_do_foreground_duty: boolean;
  can_do_background_duty: boolean;
  excluded_from_statistics: boolean;
  description: string;
}

interface RoleEditDialogProps {
  role: TeamRoleData | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (data: RoleEditFormData) => void;
}

function RoleEditDialog({ role, open, onOpenChange, onSave }: RoleEditDialogProps) {
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

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (formData.name.trim()) {
            onSave(formData);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="flex flex-col max-h-[85vh] !gap-0 p-0 sm:max-w-[450px]">
                <DialogHeader className="shrink-0 px-6 pt-6 pb-0">
                    <DialogTitle>
                        {role ? "Funktion bearbeiten" : "Neue Funktion hinzufügen"}
                    </DialogTitle>
                    <DialogDescription>
                        Funktionen definieren die Hierarchie und Berechtigungen im Team.
                    </DialogDescription>
                </DialogHeader>
                <form onSubmit={handleSubmit} className="flex flex-col flex-1 overflow-hidden">
                    <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
                    <div className="grid gap-2">
                        <Label htmlFor="roleName">Name der Funktion</Label>
                        <Input
                            id="roleName"
                            value={formData.name}
                            onChange={(e) => { setFormData({ ...formData, name: e.target.value }); }}
                            placeholder="z.B. Oberarzt, Facharzt, etc."
                            required
                        />
                    </div>
                    <div className="grid gap-2">
                        <Label htmlFor="roleDescription">Beschreibung (optional)</Label>
                        <Input
                            id="roleDescription"
                            value={formData.description}
                            onChange={(e) => { setFormData({ ...formData, description: e.target.value }); }}
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
                                    onChange={(e) => { setFormData({ ...formData, is_specialist: e.target.checked }); }}
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
                                    onChange={(e) => { setFormData({ ...formData, can_do_foreground_duty: e.target.checked }); }}
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
                                    onChange={(e) => { setFormData({ ...formData, can_do_background_duty: e.target.checked }); }}
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
                                    onChange={(e) => { setFormData({ ...formData, excluded_from_statistics: e.target.checked }); }}
                                    className="h-4 w-4 rounded border-slate-300"
                                />
                                <Label htmlFor="excludedFromStats" className="text-sm font-normal">
                                    Von Statistiken ausschließen
                                </Label>
                            </div>
                        </div>
                    </div>
                    
                    <DialogFooter className="sticky bottom-0 bg-white border-t shrink-0 px-6 py-4">
                        <Button type="button" variant="outline" onClick={() => { onOpenChange(false); }}>
                            Abbrechen
                        </Button>
                        <Button type="submit">Speichern</Button>
                    </DialogFooter>
                    </div>
                </form>
            </DialogContent>
        </Dialog>
    );
}

export default function TeamRoleSettings() {
    const queryClient = useQueryClient();
    const [isDialogOpen, setIsDialogOpen] = useState(false);
    const [editDialogOpen, setEditDialogOpen] = useState(false);
    const [editingRole, setEditingRole] = useState<TeamRoleData | null>(null);

    const { data: teamRoles = [] } = useQuery<TeamRoleData[]>({
        queryKey: ['teamRoles'],
        queryFn: async () => {
            // Stellt sicher, dass alle Default-Rollen existieren (ergänzt nur fehlende)
            const roles = await initializeDefaultRoles();
            return roles.sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99));
        },
    });

    const createMutation = useMutation({
        mutationFn: (data: TeamRoleData) => db.TeamRole.create({
            ...data,
            priority: teamRoles.length
        } as Record<string, unknown>),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['teamRoles'] });
            setEditDialogOpen(false);
            setEditingRole(null);
        },
    });

    const updateMutation = useMutation({
        mutationFn: ({ id, data }: { id: string; data: Partial<TeamRoleData> }) => db.TeamRole.update(id, data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['teamRoles'] });
            setEditDialogOpen(false);
            setEditingRole(null);
        },
    });

    const deleteMutation = useMutation({
        mutationFn: (id: string) => db.TeamRole.delete(id),
        onSuccess: () => queryClient.invalidateQueries({ queryKey: ['teamRoles'] }),
    });

    const handleDragEnd = (result: DropResult) => {
        if (!result.destination) return;
        
        const items = Array.from(teamRoles);
        const [reorderedItem] = items.splice(result.source.index, 1);
        items.splice(result.destination.index, 0, reorderedItem);

        // Update priorities
        items.forEach((role, index) => {
            if (role.priority !== index) {
                updateMutation.mutate({ id: role.id!, data: { priority: index } });
            }
        });
    };

    const handleAddNew = () => {
        setEditingRole(null);
        setEditDialogOpen(true);
    };

    const handleEdit = (role: TeamRoleData) => {
        setEditingRole(role);
        setEditDialogOpen(true);
    };

    const handleSave = (formData: RoleEditFormData) => {
        if (editingRole) {
            updateMutation.mutate({ id: editingRole.id!, data: formData as unknown as Partial<TeamRoleData> });
        } else {
            createMutation.mutate(formData as unknown as TeamRoleData);
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
                                                                        onClick={() => { handleEdit(role); }}
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
                                                                                    onClick={() => { deleteMutation.mutate(role.id!); }}
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
