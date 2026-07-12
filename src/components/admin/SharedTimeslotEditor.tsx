import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DragDropContext, Draggable, Droppable } from '@hello-pangea/dnd';
import { AlertCircle, Clock, GripVertical, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/api/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

function spansMidnight(startTime, endTime) {
    const [startH, startM] = String(startTime || '00:00').split(':').map(Number);
    const [endH, endM] = String(endTime || '00:00').split(':').map(Number);
    const startMinutes = startH * 60 + startM;
    const endMinutes = endH * 60 + endM;
    return endMinutes <= startMinutes;
}

function formatTimeRange(startTime, endTime) {
    const start = startTime?.substring(0, 5) || '00:00';
    const end = endTime?.substring(0, 5) || '00:00';
    return `${start}-${end}${spansMidnight(start, end) ? ' (+1)' : ''}`;
}

export default function SharedTimeslotEditor({ groupId, workplaceId, defaultTolerance = 15 }) {
    const queryClient = useQueryClient();
    const [editingId, setEditingId] = useState(null);
    const [editForm, setEditForm] = useState({
        label: '',
        start_time: '07:00',
        end_time: '15:00',
        overlap_tolerance_minutes: defaultTolerance,
    });

    const queryKey = ['sharedWorkplaceTimeslots', groupId, workplaceId];

    const { data: timeslots = [], isLoading } = useQuery({
        queryKey,
        queryFn: async () => {
            const response = await api.listSharedWorkplaceTimeslots(groupId, workplaceId);
            const rows = Array.isArray(response?.timeslots) ? response.timeslots : [];
            return rows.sort((left, right) => (left.order || 0) - (right.order || 0));
        },
        enabled: !!groupId && !!workplaceId,
    });

    const invalidate = () => queryClient.invalidateQueries({ queryKey });

    const createMutation = useMutation({
        mutationFn: (payload) => api.createSharedWorkplaceTimeslot(groupId, workplaceId, payload),
        onSuccess: () => invalidate(),
        onError: (error) => toast.error(error.message || 'Zeitfenster konnte nicht erstellt werden'),
    });

    const updateMutation = useMutation({
        mutationFn: ({ id, payload }) => api.updateSharedWorkplaceTimeslot(groupId, workplaceId, id, payload),
        onSuccess: () => invalidate(),
        onError: (error) => toast.error(error.message || 'Zeitfenster konnte nicht aktualisiert werden'),
    });

    const deleteMutation = useMutation({
        mutationFn: (id) => api.deleteSharedWorkplaceTimeslot(groupId, workplaceId, id),
        onSuccess: () => {
            invalidate();
            toast.success('Zeitfenster gelöscht');
        },
        onError: (error) => toast.error(error.message || 'Zeitfenster konnte nicht gelöscht werden'),
    });

    const handleAddNew = () => {
        createMutation.mutate({
            label: `Schicht ${timeslots.length + 1}`,
            start_time: '08:00',
            end_time: '16:00',
            order: timeslots.length,
            overlap_tolerance_minutes: defaultTolerance,
            spans_midnight: false,
        });
    };

    const handleDelete = (id) => {
        if (!window.confirm('Zeitfenster wirklich löschen?')) {
            return;
        }
        deleteMutation.mutate(id);
    };

    const startEdit = (slot) => {
        setEditingId(slot.id);
        setEditForm({
            label: slot.label,
            start_time: slot.start_time?.substring(0, 5) || '08:00',
            end_time: slot.end_time?.substring(0, 5) || '16:00',
            overlap_tolerance_minutes: slot.overlap_tolerance_minutes ?? defaultTolerance,
        });
    };

    const handleSaveEdit = () => {
        if (!editingId) {
            return;
        }
        updateMutation.mutate({
            id: editingId,
            payload: {
                ...editForm,
                spans_midnight: spansMidnight(editForm.start_time, editForm.end_time),
            },
        });
        setEditingId(null);
    };

    const handleDragEnd = (result) => {
        if (!result.destination || result.destination.index === result.source.index) {
            return;
        }
        const items = Array.from(timeslots);
        const [moved] = items.splice(result.source.index, 1);
        items.splice(result.destination.index, 0, moved);
        items.forEach((slot, index) => {
            if ((slot.order || 0) !== index) {
                updateMutation.mutate({ id: slot.id, payload: { order: index } });
            }
        });
    };

    if (isLoading) {
        return <div className="py-4 text-sm text-slate-500">Lade Zeitfenster …</div>;
    }

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-sm font-medium">
                    <Clock className="h-4 w-4 text-slate-500" />
                    Zeitfenster ({timeslots.length})
                </div>
                <Button type="button" onClick={handleAddNew} size="sm" variant="outline">
                    <Plus className="mr-1 h-4 w-4" /> Neu
                </Button>
            </div>

            {timeslots.length === 0 ? (
                <div className="rounded-lg border-2 border-dashed py-8 text-center text-sm text-slate-500">
                    Keine Zeitfenster definiert.
                </div>
            ) : (
                <DragDropContext onDragEnd={handleDragEnd}>
                    <Droppable droppableId="shared-timeslots">
                        {(provided) => (
                            <div ref={provided.innerRef} {...provided.droppableProps} className="space-y-2">
                                {timeslots.map((slot, index) => (
                                    <Draggable key={slot.id} draggableId={slot.id} index={index}>
                                        {(dragProvided) => (
                                            <div
                                                ref={dragProvided.innerRef}
                                                {...dragProvided.draggableProps}
                                                className={cn(
                                                    'rounded-lg border bg-white p-3 shadow-sm group',
                                                    editingId === slot.id ? 'ring-2 ring-indigo-500' : 'hover:border-indigo-200'
                                                )}
                                            >
                                                {editingId === slot.id ? (
                                                    <div className="space-y-3">
                                                        <div className="grid grid-cols-3 gap-3">
                                                            <div className="space-y-1">
                                                                <Label className="text-xs">Bezeichnung</Label>
                                                                <Input
                                                                    value={editForm.label}
                                                                    onChange={(event) => setEditForm((current) => ({ ...current, label: event.target.value }))}
                                                                    className="h-8"
                                                                />
                                                            </div>
                                                            <div className="space-y-1">
                                                                <Label className="text-xs">Startzeit</Label>
                                                                <Input
                                                                    type="time"
                                                                    value={editForm.start_time}
                                                                    onChange={(event) => setEditForm((current) => ({ ...current, start_time: event.target.value }))}
                                                                    className="h-8"
                                                                />
                                                            </div>
                                                            <div className="space-y-1">
                                                                <Label className="text-xs">Endzeit</Label>
                                                                <Input
                                                                    type="time"
                                                                    value={editForm.end_time}
                                                                    onChange={(event) => setEditForm((current) => ({ ...current, end_time: event.target.value }))}
                                                                    className="h-8"
                                                                />
                                                            </div>
                                                        </div>

                                                        {spansMidnight(editForm.start_time, editForm.end_time) ? (
                                                            <div className="flex items-center gap-2 rounded bg-amber-50 px-2 py-1 text-xs text-amber-600">
                                                                <AlertCircle className="h-3 w-3" /> Dieses Zeitfenster geht über Mitternacht
                                                            </div>
                                                        ) : null}

                                                        <div className="space-y-1">
                                                            <Label className="text-xs">Pause (Minuten)</Label>
                                                            <Input
                                                                type="number"
                                                                min={0}
                                                                max={60}
                                                                value={editForm.overlap_tolerance_minutes}
                                                                onChange={(event) => setEditForm((current) => ({ ...current, overlap_tolerance_minutes: Number.parseInt(event.target.value, 10) || 0 }))}
                                                                className="h-8 w-24"
                                                            />
                                                        </div>

                                                        <div className="flex justify-end gap-2">
                                                            <Button type="button" variant="ghost" size="sm" onClick={() => setEditingId(null)}>Abbrechen</Button>
                                                            <Button type="button" size="sm" onClick={handleSaveEdit}>Speichern</Button>
                                                        </div>
                                                    </div>
                                                ) : (
                                                    <div className="flex items-center gap-3">
                                                        <div {...dragProvided.dragHandleProps} className="cursor-grab text-slate-400 hover:text-slate-600">
                                                            <GripVertical className="h-4 w-4" />
                                                        </div>
                                                        <div className="flex-1">
                                                            <div className="flex items-center gap-2">
                                                                <span className="font-medium">{slot.label}</span>
                                                                <Badge variant="outline" className="font-mono text-xs">{formatTimeRange(slot.start_time, slot.end_time)}</Badge>
                                                                {slot.spans_midnight ? <Badge variant="secondary" className="bg-amber-100 text-[10px] text-amber-700">Nacht</Badge> : null}
                                                                {slot.overlap_tolerance_minutes > 0 ? <span className="text-[10px] text-slate-400">☕{slot.overlap_tolerance_minutes}min</span> : null}
                                                            </div>
                                                        </div>
                                                        <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                                                            <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={() => startEdit(slot)}>
                                                                <Clock className="h-3 w-3" />
                                                            </Button>
                                                            <Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-red-500 hover:bg-red-50" onClick={() => handleDelete(slot.id)}>
                                                                <Trash2 className="h-3 w-3" />
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
