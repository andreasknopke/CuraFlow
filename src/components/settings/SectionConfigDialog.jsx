import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Settings2, GripVertical, RotateCcw } from 'lucide-react';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/components/AuthProvider';
import { toast } from 'sonner';

const DEFAULT_SECTIONS = [
    { id: 'absences', defaultName: 'Abwesenheiten', order: 0 },
    { id: 'services', defaultName: 'Dienste', order: 1 },
    { id: 'rotations', defaultName: 'Rotationen', order: 2 },
    { id: 'available', defaultName: 'Anwesenheiten', order: 3 },
    { id: 'demos', defaultName: 'Demonstrationen & Konsile', order: 4 },
    { id: 'misc', defaultName: 'Sonstiges', order: 5 }
];

export function useSectionConfig() {
    const { user } = useAuth();
    const [config, setConfig] = useState(null);

    useEffect(() => {
        if (user?.section_config) {
            try {
                setConfig(JSON.parse(user.section_config));
            } catch {
                setConfig(null);
            }
        } else {
            setConfig(null);
        }
    }, [user?.section_config]);

    const getSectionName = (defaultName) => {
        if (!config) return defaultName;
        const section = config.sections?.find(s => s.defaultName === defaultName);
        return section?.customName || defaultName;
    };

    const getSectionOrder = () => {
        if (!config || !config.sections) return DEFAULT_SECTIONS.map(s => s.defaultName);
        return config.sections
            .sort((a, b) => a.order - b.order)
            .map(s => s.defaultName);
    };

    return { config, getSectionName, getSectionOrder };
}

export default function SectionConfigDialog() {
    const { user, refreshUser } = useAuth();
    const [open, setOpen] = useState(false);
    const [sections, setSections] = useState([]);
    const [isSaving, setIsSaving] = useState(false);

    useEffect(() => {
        if (open) {
            // Load from user or defaults
            if (user?.section_config) {
                try {
                    const parsed = JSON.parse(user.section_config);
                    if (parsed.sections) {
                        setSections(parsed.sections);
                        return;
                    }
                } catch {}
            }
            // Default
            setSections(DEFAULT_SECTIONS.map(s => ({
                ...s,
                customName: ''
            })));
        }
    }, [open, user]);

    const handleDragEnd = (result) => {
        if (!result.destination) return;
        
        const items = Array.from(sections);
        const [reordered] = items.splice(result.source.index, 1);
        items.splice(result.destination.index, 0, reordered);
        
        // Update order property
        const reordered_with_order = items.map((item, idx) => ({
            ...item,
            order: idx
        }));
        
        setSections(reordered_with_order);
    };

    const handleNameChange = (id, value) => {
        setSections(prev => prev.map(s => 
            s.id === id ? { ...s, customName: value } : s
        ));
    };

    const handleReset = () => {
        setSections(DEFAULT_SECTIONS.map(s => ({
            ...s,
            customName: ''
        })));
    };

    const handleSave = async () => {
        setIsSaving(true);
        try {
            const configData = JSON.stringify({ sections });
            await base44.auth.updateMe({ section_config: configData });
            if (refreshUser) await refreshUser();
            toast.success('Konfiguration gespeichert');
            setOpen(false);
        } catch (e) {
            toast.error('Fehler beim Speichern: ' + e.message);
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <Button variant="outline" size="icon" title="Panel-Konfiguration">
                    <Settings2 className="h-4 w-4" />
                </Button>
            </DialogTrigger>
            <DialogContent className="max-w-md">
                <DialogHeader>
                    <DialogTitle>Panel-Konfiguration</DialogTitle>
                </DialogHeader>
                
                <div className="py-4 space-y-4">
                    <p className="text-sm text-slate-500">
                        Passen Sie die Bezeichnungen und Reihenfolge der Bereiche an. Ziehen Sie die Einträge, um die Reihenfolge zu ändern.
                    </p>

                    <DragDropContext onDragEnd={handleDragEnd}>
                        <Droppable droppableId="sections">
                            {(provided) => (
                                <div 
                                    ref={provided.innerRef} 
                                    {...provided.droppableProps}
                                    className="space-y-2"
                                >
                                    {sections.map((section, index) => (
                                        <Draggable key={section.id} draggableId={section.id} index={index}>
                                            {(provided, snapshot) => (
                                                <div
                                                    ref={provided.innerRef}
                                                    {...provided.draggableProps}
                                                    className={`flex items-center gap-3 p-3 bg-white border rounded-lg ${snapshot.isDragging ? 'shadow-lg ring-2 ring-indigo-300' : ''}`}
                                                >
                                                    <div 
                                                        {...provided.dragHandleProps}
                                                        className="text-slate-400 hover:text-slate-600 cursor-grab active:cursor-grabbing"
                                                    >
                                                        <GripVertical className="h-5 w-5" />
                                                    </div>
                                                    <div className="flex-1 space-y-1">
                                                        <Label className="text-xs text-slate-500">
                                                            {section.defaultName}
                                                        </Label>
                                                        <Input
                                                            placeholder={section.defaultName}
                                                            value={section.customName || ''}
                                                            onChange={(e) => handleNameChange(section.id, e.target.value)}
                                                            className="h-8"
                                                        />
                                                    </div>
                                                </div>
                                            )}
                                        </Draggable>
                                    ))}
                                    {provided.placeholder}
                                </div>
                            )}
                        </Droppable>
                    </DragDropContext>
                </div>

                <DialogFooter className="flex justify-between">
                    <Button variant="ghost" onClick={handleReset} className="text-slate-500">
                        <RotateCcw className="h-4 w-4 mr-2" />
                        Zurücksetzen
                    </Button>
                    <div className="flex gap-2">
                        <Button variant="outline" onClick={() => setOpen(false)}>
                            Abbrechen
                        </Button>
                        <Button onClick={handleSave} disabled={isSaving}>
                            {isSaving ? 'Speichern...' : 'Speichern'}
                        </Button>
                    </div>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}