import React, { useState, useEffect, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { db } from "@/api/client";
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Plus, Trash2, GripVertical, Clock, AlertCircle, Copy, Save, Star } from 'lucide-react';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@/components/ui/tooltip";

// Vordefinierte Standard-Templates
const DEFAULT_TEMPLATES = {
    EARLY_LATE: {
        name: "Früh / Spät",
        slots: [
            { label: "Früh", start_time: "07:00", end_time: "13:00" },
            { label: "Spät", start_time: "13:00", end_time: "20:00" }
        ]
    },
    THREE_SHIFT: {
        name: "Drei-Schicht",
        slots: [
            { label: "Früh", start_time: "06:00", end_time: "14:00" },
            { label: "Spät", start_time: "14:00", end_time: "22:00" },
            { label: "Nacht", start_time: "22:00", end_time: "06:00" }
        ]
    },
    HALF_DAY: {
        name: "Halbtags",
        slots: [
            { label: "Vormittag", start_time: "08:00", end_time: "12:00" },
            { label: "Nachmittag", start_time: "12:00", end_time: "17:00" }
        ]
    },
    MORNING_AFTERNOON_EVENING: {
        name: "Morgen / Mittag / Abend",
        slots: [
            { label: "Morgen", start_time: "07:00", end_time: "12:00" },
            { label: "Nachmittag", start_time: "12:00", end_time: "17:00" },
            { label: "Abend", start_time: "17:00", end_time: "22:00" }
        ]
    }
};

/**
 * Prüft ob ein Zeitfenster über Mitternacht geht
 */
function spansMidnight(startTime, endTime) {
    const [startH, startM] = startTime.split(':').map(Number);
    const [endH, endM] = endTime.split(':').map(Number);
    const startMinutes = startH * 60 + startM;
    const endMinutes = endH * 60 + endM;
    return endMinutes <= startMinutes;
}

/**
 * Formatiert Zeitbereich für Anzeige
 */
function formatTimeRange(startTime, endTime) {
    const start = startTime?.substring(0, 5) || '00:00';
    const end = endTime?.substring(0, 5) || '00:00';
    const midnight = spansMidnight(start, end);
    return `${start}-${end}${midnight ? ' (+1)' : ''}`;
}

export default function TimeslotEditor({ workplaceId, defaultTolerance = 15 }) {
    const queryClient = useQueryClient();
    const [editingId, setEditingId] = useState(null);
    const [editForm, setEditForm] = useState({
        label: '',
        start_time: '07:00',
        end_time: '15:00',
        overlap_tolerance_minutes: defaultTolerance
    });
    const [showSaveTemplateDialog, setShowSaveTemplateDialog] = useState(false);
    const [templateName, setTemplateName] = useState('');

    // Fetch existing timeslots for this workplace
    const { data: timeslots = [], isLoading } = useQuery({
        queryKey: ['workplaceTimeslots', workplaceId],
        queryFn: async () => {
            const result = await db.WorkplaceTimeslot.filter({ workplace_id: workplaceId });
            return result.sort((a, b) => (a.order || 0) - (b.order || 0));
        },
        enabled: !!workplaceId
    });

    // Fetch custom templates from database
    const { data: customTemplates = [] } = useQuery({
        queryKey: ['timeslotTemplates'],
        queryFn: () => db.TimeslotTemplate.list()
    });

    const createMutation = useMutation({
        mutationFn: (data) => db.WorkplaceTimeslot.create(data),
        onSuccess: () => {
            queryClient.invalidateQueries(['workplaceTimeslots', workplaceId]);
        },
        onError: (err) => {
            toast.error("Fehler beim Erstellen: " + err.message);
        }
    });

    const updateMutation = useMutation({
        mutationFn: ({ id, data }) => db.WorkplaceTimeslot.update(id, data),
        onSuccess: () => {
            queryClient.invalidateQueries(['workplaceTimeslots', workplaceId]);
        }
    });

    const deleteMutation = useMutation({
        mutationFn: (id) => db.WorkplaceTimeslot.delete(id),
        onSuccess: () => {
            queryClient.invalidateQueries(['workplaceTimeslots', workplaceId]);
            toast.success("Zeitfenster gelöscht");
        }
    });

    // Handle Drag & Drop Reordering
    const handleDragEnd = (result) => {
        if (!result.destination) return;
        if (result.source.index === result.destination.index) return;

        const items = Array.from(timeslots);
        const [reorderedItem] = items.splice(result.source.index, 1);
        items.splice(result.destination.index, 0, reorderedItem);

        // Persist order changes
        items.forEach((item, index) => {
            if (item.order !== index) {
                updateMutation.mutate({ id: item.id, data: { order: index } });
            }
        });
    };

    // Apply a template (default or custom)
    const applyTemplate = async (templateKey) => {
        // Check if it's a default template or a custom one
        let template;
        if (templateKey.startsWith('custom_')) {
            const customId = templateKey.replace('custom_', '');
            const customTemplate = customTemplates.find(t => t.id === customId);
            if (!customTemplate) return;
            template = {
                name: customTemplate.name,
                slots: JSON.parse(customTemplate.slots_json || '[]')
            };
        } else {
            template = DEFAULT_TEMPLATES[templateKey];
        }
        if (!template) return;

        // Delete existing slots first (optional - could also append)
        if (timeslots.length > 0) {
            const confirmed = confirm(`Vorhandene ${timeslots.length} Zeitfenster werden ersetzt. Fortfahren?`);
            if (!confirmed) return;

            for (const slot of timeslots) {
                await deleteMutation.mutateAsync(slot.id);
            }
        }

        // Create new slots from template
        for (let i = 0; i < template.slots.length; i++) {
            const slot = template.slots[i];
            await createMutation.mutateAsync({
                workplace_id: workplaceId,
                label: slot.label,
                start_time: slot.start_time,
                end_time: slot.end_time,
                order: i,
                overlap_tolerance_minutes: slot.overlap_tolerance_minutes || defaultTolerance,
                spans_midnight: spansMidnight(slot.start_time, slot.end_time)
            });
        }

        toast.success(`Template "${template.name}" angewendet`);
    };

    // Save current timeslots as a reusable template
    const saveAsTemplateMutation = useMutation({
        mutationFn: async (name) => {
            const slotsData = timeslots.map(s => ({
                label: s.label,
                start_time: s.start_time?.substring(0, 5),
                end_time: s.end_time?.substring(0, 5),
                overlap_tolerance_minutes: s.overlap_tolerance_minutes
            }));
            return db.TimeslotTemplate.create({
                name: name,
                slots_json: JSON.stringify(slotsData)
            });
        },
        onSuccess: () => {
            queryClient.invalidateQueries(['timeslotTemplates']);
            toast.success("Template gespeichert!");
            setShowSaveTemplateDialog(false);
            setTemplateName('');
        },
        onError: (err) => {
            toast.error("Fehler beim Speichern: " + err.message);
        }
    });

    const handleSaveAsTemplate = () => {
        if (!templateName.trim()) {
            toast.error("Bitte einen Namen eingeben");
            return;
        }
        saveAsTemplateMutation.mutate(templateName.trim());
    };

    // Delete a custom template
    const deleteTemplateMutation = useMutation({
        mutationFn: (id) => db.TimeslotTemplate.delete(id),
        onSuccess: () => {
            queryClient.invalidateQueries(['timeslotTemplates']);
            toast.success("Template gelöscht");
        }
    });

    // Add new custom timeslot
    const handleAddNew = () => {
        const newOrder = timeslots.length;
        const newSlot = {
            workplace_id: workplaceId,
            label: `Schicht ${newOrder + 1}`,
            start_time: "08:00",
            end_time: "16:00",
            order: newOrder,
            overlap_tolerance_minutes: defaultTolerance,
            spans_midnight: false
        };
        createMutation.mutate(newSlot);
    };

    // Delete a timeslot
    const handleDelete = (id) => {
        if (confirm("Zeitfenster wirklich löschen?")) {
            deleteMutation.mutate(id);
        }
    };

    // Save edited timeslot
    const handleSaveEdit = () => {
        if (!editingId) return;

        const spans = spansMidnight(editForm.start_time, editForm.end_time);
        updateMutation.mutate({
            id: editingId,
            data: {
                ...editForm,
                spans_midnight: spans
            }
        });
        setEditingId(null);
        setEditForm({});
    };

    // Start editing a timeslot
    const startEdit = (slot) => {
        setEditingId(slot.id);
        setEditForm({
            label: slot.label,
            start_time: slot.start_time?.substring(0, 5) || '08:00',
            end_time: slot.end_time?.substring(0, 5) || '16:00',
            overlap_tolerance_minutes: slot.overlap_tolerance_minutes ?? defaultTolerance
        });
    };

    if (isLoading) {
        return <div className="text-sm text-slate-500 py-4">Lade Zeitfenster...</div>;
    }

    return (
        <div className="space-y-4">
            {/* Header with template selector */}
            <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                    <Clock className="w-4 h-4 text-slate-500" />
                    <span className="text-sm font-medium">Zeitfenster ({timeslots.length})</span>
                </div>
                <div className="flex items-center gap-2">
                    <Select onValueChange={applyTemplate}>
                        <SelectTrigger className="w-[160px] h-8">
                            <SelectValue placeholder="Template wählen" />
                        </SelectTrigger>
                        <SelectContent>
                            {/* Standard-Templates */}
                            <div className="px-2 py-1 text-xs text-slate-500 font-medium">Standard</div>
                            {Object.entries(DEFAULT_TEMPLATES).map(([key, template]) => (
                                <SelectItem key={key} value={key}>
                                    <div className="flex items-center gap-2">
                                        <Copy className="w-3 h-3" />
                                        {template.name}
                                    </div>
                                </SelectItem>
                            ))}
                            {/* Benutzerdefinierte Templates */}
                            {customTemplates.length > 0 && (
                                <>
                                    <div className="px-2 py-1 text-xs text-slate-500 font-medium mt-2 border-t">Eigene</div>
                                    {customTemplates.map((template) => (
                                        <SelectItem key={template.id} value={`custom_${template.id}`}>
                                            <div className="flex items-center gap-2">
                                                <Star className="w-3 h-3 text-amber-500" />
                                                {template.name}
                                            </div>
                                        </SelectItem>
                                    ))}
                                </>
                            )}
                        </SelectContent>
                    </Select>
                    {timeslots.length > 0 && (
                        <TooltipProvider>
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <Button 
                                        onClick={() => setShowSaveTemplateDialog(true)} 
                                        size="sm" 
                                        variant="outline"
                                        className="text-amber-600 hover:text-amber-700 hover:bg-amber-50"
                                    >
                                        <Save className="w-4 h-4" />
                                    </Button>
                                </TooltipTrigger>
                                <TooltipContent>
                                    <p>Aktuelle Zeitfenster als Template speichern</p>
                                </TooltipContent>
                            </Tooltip>
                        </TooltipProvider>
                    )}
                    <Button onClick={handleAddNew} size="sm" variant="outline">
                        <Plus className="w-4 h-4 mr-1" /> Neu
                    </Button>
                </div>
            </div>

            {/* Save as Template Dialog */}
            {showSaveTemplateDialog && (
                <div className="border rounded-lg p-4 bg-amber-50 border-amber-200 space-y-3">
                    <div className="flex items-center gap-2 text-amber-800">
                        <Save className="w-4 h-4" />
                        <span className="font-medium">Als Template speichern</span>
                    </div>
                    <div className="flex gap-2">
                        <Input
                            placeholder="Template-Name"
                            value={templateName}
                            onChange={(e) => setTemplateName(e.target.value)}
                            className="flex-1 h-8"
                            onKeyDown={(e) => e.key === 'Enter' && handleSaveAsTemplate()}
                        />
                        <Button 
                            size="sm" 
                            onClick={handleSaveAsTemplate}
                            disabled={saveAsTemplateMutation.isPending}
                        >
                            Speichern
                        </Button>
                        <Button 
                            size="sm" 
                            variant="ghost" 
                            onClick={() => { setShowSaveTemplateDialog(false); setTemplateName(''); }}
                        >
                            Abbrechen
                        </Button>
                    </div>
                    <p className="text-xs text-amber-700">
                        Das Template wird mit {timeslots.length} Zeitfenster(n) gespeichert und kann später wiederverwendet werden.
                    </p>
                </div>
            )}

            {/* Timeslot List with Drag & Drop */}
            {timeslots.length === 0 ? (
                <div className="text-center py-8 text-slate-500 text-sm border-2 border-dashed rounded-lg">
                    Keine Zeitfenster definiert. Wählen Sie ein Template oder fügen Sie manuell hinzu.
                </div>
            ) : (
                <DragDropContext onDragEnd={handleDragEnd}>
                    <Droppable droppableId="timeslots">
                        {(provided) => (
                            <div
                                {...provided.droppableProps}
                                ref={provided.innerRef}
                                className="space-y-2"
                            >
                                {timeslots.map((slot, index) => (
                                    <Draggable key={slot.id} draggableId={slot.id} index={index}>
                                        {(provided) => (
                                            <div
                                                ref={provided.innerRef}
                                                {...provided.draggableProps}
                                                className={cn(
                                                    "border rounded-lg bg-white p-3 shadow-sm group",
                                                    editingId === slot.id ? "ring-2 ring-indigo-500" : "hover:border-indigo-200"
                                                )}
                                            >
                                                {editingId === slot.id ? (
                                                    // Edit Mode
                                                    <div className="space-y-3">
                                                        <div className="grid grid-cols-3 gap-3">
                                                            <div className="space-y-1">
                                                                <Label className="text-xs">Bezeichnung</Label>
                                                                <Input
                                                                    value={editForm.label}
                                                                    onChange={e => setEditForm({...editForm, label: e.target.value})}
                                                                    maxLength={20}
                                                                    className="h-8"
                                                                />
                                                            </div>
                                                            <div className="space-y-1">
                                                                <Label className="text-xs">Startzeit</Label>
                                                                <Input
                                                                    type="time"
                                                                    value={editForm.start_time}
                                                                    onChange={e => setEditForm({...editForm, start_time: e.target.value})}
                                                                    className="h-8"
                                                                />
                                                            </div>
                                                            <div className="space-y-1">
                                                                <Label className="text-xs">Endzeit</Label>
                                                                <Input
                                                                    type="time"
                                                                    value={editForm.end_time}
                                                                    onChange={e => setEditForm({...editForm, end_time: e.target.value})}
                                                                    className="h-8"
                                                                />
                                                            </div>
                                                        </div>
                                                        
                                                        {spansMidnight(editForm.start_time, editForm.end_time) && (
                                                            <div className="flex items-center gap-2 text-xs text-amber-600 bg-amber-50 px-2 py-1 rounded">
                                                                <AlertCircle className="w-3 h-3" />
                                                                Dieses Zeitfenster geht über Mitternacht
                                                            </div>
                                                        )}

                                                        <div className="space-y-1">
                                                            <Label className="text-xs">Übergangstoleranz (Minuten)</Label>
                                                            <Input
                                                                type="number"
                                                                min={0}
                                                                max={60}
                                                                value={editForm.overlap_tolerance_minutes}
                                                                onChange={e => setEditForm({...editForm, overlap_tolerance_minutes: parseInt(e.target.value) || 0})}
                                                                className="h-8 w-24"
                                                            />
                                                            <p className="text-[10px] text-slate-500">
                                                                Erlaubte Überschneidung zwischen Schichten
                                                            </p>
                                                        </div>

                                                        <div className="flex justify-end gap-2">
                                                            <Button variant="ghost" size="sm" onClick={() => setEditingId(null)}>
                                                                Abbrechen
                                                            </Button>
                                                            <Button size="sm" onClick={handleSaveEdit}>
                                                                Speichern
                                                            </Button>
                                                        </div>
                                                    </div>
                                                ) : (
                                                    // View Mode
                                                    <div className="flex items-center gap-3">
                                                        <div {...provided.dragHandleProps} className="cursor-grab text-slate-400 hover:text-slate-600">
                                                            <GripVertical className="w-4 h-4" />
                                                        </div>
                                                        <div className="flex-1">
                                                            <div className="flex items-center gap-2">
                                                                <span className="font-medium">{slot.label}</span>
                                                                <Badge variant="outline" className="text-xs font-mono">
                                                                    {formatTimeRange(slot.start_time, slot.end_time)}
                                                                </Badge>
                                                                {slot.spans_midnight && (
                                                                    <TooltipProvider>
                                                                        <Tooltip>
                                                                            <TooltipTrigger>
                                                                                <Badge variant="secondary" className="text-[10px] bg-amber-100 text-amber-700">
                                                                                    Nacht
                                                                                </Badge>
                                                                            </TooltipTrigger>
                                                                            <TooltipContent>
                                                                                <p>Schicht geht über Mitternacht</p>
                                                                            </TooltipContent>
                                                                        </Tooltip>
                                                                    </TooltipProvider>
                                                                )}
                                                                {slot.overlap_tolerance_minutes > 0 && (
                                                                    <span className="text-[10px] text-slate-400">
                                                                        ±{slot.overlap_tolerance_minutes}min
                                                                    </span>
                                                                )}
                                                            </div>
                                                        </div>
                                                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                                            <Button
                                                                variant="ghost"
                                                                size="icon"
                                                                className="h-7 w-7"
                                                                onClick={() => startEdit(slot)}
                                                            >
                                                                <Clock className="w-3 h-3" />
                                                            </Button>
                                                            <Button
                                                                variant="ghost"
                                                                size="icon"
                                                                className="h-7 w-7 text-red-500 hover:bg-red-50"
                                                                onClick={() => handleDelete(slot.id)}
                                                            >
                                                                <Trash2 className="w-3 h-3" />
                                                            </Button>
                                                        </div>
                                                    </div>
                                                )}
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
        </div>
    );
}
