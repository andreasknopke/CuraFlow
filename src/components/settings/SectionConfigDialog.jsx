import React, { useState, useEffect, useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Settings2, GripVertical, RotateCcw } from 'lucide-react';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import { api, db, base44 } from "@/api/client";
import { useAuth } from '@/components/AuthProvider';
import { useQuery } from '@tanstack/react-query';
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

    // Lade Custom-Kategorien und Workplaces, um leere Sections zu filtern
    const { data: systemSettings = [] } = useQuery({
        queryKey: ['systemSettings'],
        queryFn: () => db.SystemSetting.list(),
        staleTime: 5 * 60 * 1000,
    });

    const { data: workplaces = [] } = useQuery({
        queryKey: ['workplaces'],
        queryFn: () => db.Workplace.list(),
        staleTime: 5 * 60 * 1000,
    });

    // Alle verfügbaren Sections berechnen (Default + Custom), leere dynamische ausblenden
    const allAvailableSections = useMemo(() => {
        // Custom-Kategorien aus den SystemSettings laden
        const customCategoriesSetting = systemSettings.find(s => s.key === 'workplace_categories');
        let customCategories = [];
        if (customCategoriesSetting?.value) {
            try {
                customCategories = JSON.parse(customCategoriesSetting.value);
            } catch { }
        }

        // Prüfe welche dynamischen Kategorien tatsächlich Workplaces haben
        const categoriesWithWorkplaces = new Set(workplaces.map(w => w.category));

        // Dynamische Kategorien (die nur angezeigt werden wenn Workplaces vorhanden)
        const dynamicCategoryNames = ['Dienste', 'Rotationen', 'Demonstrationen & Konsile', ...customCategories];

        // Statische Sections die immer angezeigt werden
        const staticSections = DEFAULT_SECTIONS.filter(s => 
            !['services', 'rotations', 'demos'].includes(s.id)
        );

        // Dynamische Sections nur anzeigen, wenn sie Workplaces haben
        const dynamicSections = [];
        for (const catName of dynamicCategoryNames) {
            if (categoriesWithWorkplaces.has(catName)) {
                // Prüfe ob es schon in DEFAULT_SECTIONS ist
                const existing = DEFAULT_SECTIONS.find(s => s.defaultName === catName);
                if (existing) {
                    dynamicSections.push(existing);
                } else {
                    // Custom Kategorie
                    dynamicSections.push({
                        id: `custom_${catName.toLowerCase().replace(/[^a-z0-9]/g, '_')}`,
                        defaultName: catName,
                        order: DEFAULT_SECTIONS.length + dynamicSections.length
                    });
                }
            }
        }

        return [...staticSections, ...dynamicSections];
    }, [systemSettings, workplaces]);

    useEffect(() => {
        if (open) {
            // Load from user config or build from available sections
            if (user?.section_config) {
                try {
                    const parsed = JSON.parse(user.section_config);
                    if (parsed.sections) {
                        // Merge: Behalte gespeicherte Einträge, füge neue hinzu, entferne nicht mehr relevante
                        const savedSections = parsed.sections;
                        const merged = [];
                        
                        // Zuerst: Gespeicherte Sections in ihrer Reihenfolge, die noch existieren
                        for (const saved of savedSections) {
                            const stillExists = allAvailableSections.find(a => a.defaultName === saved.defaultName);
                            if (stillExists) {
                                merged.push({ ...stillExists, ...saved, order: merged.length });
                            }
                        }
                        
                        // Dann: Neue Sections die noch nicht in der Config sind
                        for (const available of allAvailableSections) {
                            if (!merged.find(m => m.defaultName === available.defaultName)) {
                                merged.push({ ...available, customName: '', order: merged.length });
                            }
                        }
                        
                        setSections(merged);
                        return;
                    }
                } catch {}
            }
            // Default
            setSections(allAvailableSections.map((s, idx) => ({
                ...s,
                customName: '',
                order: idx
            })));
        }
    }, [open, user, allAvailableSections]);

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
        setSections(allAvailableSections.map((s, idx) => ({
            ...s,
            customName: '',
            order: idx
        })));
    };

    const handleSave = async () => {
        setIsSaving(true);
        try {
            const configData = JSON.stringify({ sections });
            await api.updateMe({ data: { section_config: configData } });
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
                                            {(provided, snapshot) => {
                                                // Fix: Dialog translate offset korrigieren für Drag-Drop
                                                const style = provided.draggableProps.style;
                                                const fixedStyle = snapshot.isDragging ? {
                                                    ...style,
                                                    left: 'auto',
                                                    top: 'auto',
                                                } : style;
                                                
                                                return (
                                                <div
                                                    ref={provided.innerRef}
                                                    {...provided.draggableProps}
                                                    style={fixedStyle}
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
                                                );
                                            }}
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