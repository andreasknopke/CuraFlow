import { useState, useEffect, useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Settings2, GripVertical, RotateCcw } from 'lucide-react';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import { db } from "@/api/client";
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { getWorkplaceCategoryNames } from '@/utils/workplaceCategoryUtils';
import { ALWAYS_VISIBLE_ROWS_KEY, parseAlwaysVisibleRows } from '@/components/schedule/sectionVisibility';

const DEFAULT_SECTIONS = [
    { id: 'absences', defaultName: 'Abwesenheiten', order: 0 },
    { id: 'services', defaultName: 'Dienste', order: 1 },
    { id: 'rotations', defaultName: 'Rotationen', order: 2 },
    { id: 'available', defaultName: 'Anwesenheiten', order: 3 },
    { id: 'demos', defaultName: 'Demonstrationen & Konsile', order: 4 },
    { id: 'misc', defaultName: 'Sonstiges', order: 5 }
];

const SECTION_CONFIG_KEY = 'section_config';
const STATIC_ROW_OPTIONS = [
    { rowName: 'Frei', sectionTitle: 'Abwesenheiten' },
    { rowName: 'Krank', sectionTitle: 'Abwesenheiten' },
    { rowName: 'Urlaub', sectionTitle: 'Abwesenheiten' },
    { rowName: 'Dienstreise', sectionTitle: 'Abwesenheiten' },
    { rowName: 'Nicht verfügbar', sectionTitle: 'Abwesenheiten' },
    { rowName: 'Sonstiges', sectionTitle: 'Sonstiges' },
];

const parseSectionConfig = (rawValue) => {
    if (!rawValue) return null;
    try {
        const parsed = JSON.parse(rawValue);
        if (parsed && Array.isArray(parsed.sections)) {
            return parsed;
        }
    } catch {
        return null;
    }
    return null;
};

export function useSectionConfig() {
    const { data: systemSettings = [] } = useQuery({
        queryKey: ['systemSettings'],
        queryFn: () => db.SystemSetting.list(),
        staleTime: 5 * 60 * 1000,
    });

    const config = useMemo(() => {
        const savedSetting = systemSettings.find(s => s.key === SECTION_CONFIG_KEY);
        return parseSectionConfig(savedSetting?.value);
    }, [systemSettings]);

    const getSectionName = (defaultName) => {
        if (!config) return defaultName;
        const section = config.sections?.find(s => s.defaultName === defaultName);
        return section?.customName || defaultName;
    };

    const getSectionOrder = () => {
        if (!config || !config.sections) return DEFAULT_SECTIONS.map(s => s.defaultName);
        return [...config.sections]
            .sort((a, b) => a.order - b.order)
            .map(s => s.defaultName);
    };

    return { config, getSectionName, getSectionOrder };
}

export default function SectionConfigDialog() {
    const queryClient = useQueryClient();
    const [open, setOpen] = useState(false);
    const [sections, setSections] = useState([]);
    const [alwaysVisibleRows, setAlwaysVisibleRows] = useState([]);
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

    const updateSettingMutation = useMutation({
        mutationFn: async ({ key, value }) => {
            const existing = systemSettings.find(s => s.key === key);
            if (existing) {
                return db.SystemSetting.update(existing.id, { value });
            }
            return db.SystemSetting.create({ key, value });
        },
        onSuccess: () => {
            queryClient.invalidateQueries(['systemSettings']);
        }
    });

    // Alle verfügbaren Sections berechnen (Default + Custom), leere dynamische ausblenden
    const allAvailableSections = useMemo(() => {
        const customCategoryNames = getWorkplaceCategoryNames(systemSettings);

        // Prüfe welche dynamischen Kategorien tatsächlich Workplaces haben
        const categoriesWithWorkplaces = new Set(workplaces.map(w => w.category));

        // Dynamische Kategorien (die nur angezeigt werden wenn Workplaces vorhanden)
        const dynamicCategoryNames = ['Dienste', 'Rotationen', 'Demonstrationen & Konsile', ...customCategoryNames];

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

    const savedConfig = useMemo(() => {
        const savedSetting = systemSettings.find(s => s.key === SECTION_CONFIG_KEY);
        return parseSectionConfig(savedSetting?.value);
    }, [systemSettings]);

    const savedAlwaysVisibleRows = useMemo(() => {
        const savedSetting = systemSettings.find(s => s.key === ALWAYS_VISIBLE_ROWS_KEY);
        return parseAlwaysVisibleRows(savedSetting?.value);
    }, [systemSettings]);

    const availableRowOptions = useMemo(() => {
        const rows = [
            ...STATIC_ROW_OPTIONS,
            ...workplaces.map((workplace) => ({
                rowName: workplace.name,
                sectionTitle: workplace.category,
                order: workplace.order || 0,
            })),
        ];

        const sectionNames = new Set(allAvailableSections.map((section) => section.defaultName));
        const seen = new Set();

        return rows
            .filter((row) => row.rowName && sectionNames.has(row.sectionTitle))
            .sort((a, b) => {
                const sectionDiff = (a.sectionTitle || '').localeCompare(b.sectionTitle || '', 'de');
                if (sectionDiff !== 0) return sectionDiff;
                return (a.order || 0) - (b.order || 0) || a.rowName.localeCompare(b.rowName, 'de');
            })
            .filter((row) => {
                const key = `${row.sectionTitle}__${row.rowName}`;
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
            });
    }, [allAvailableSections, workplaces]);

    useEffect(() => {
        if (open) {
            setAlwaysVisibleRows(savedAlwaysVisibleRows);

            // Load from tenant config or build from available sections
            if (savedConfig?.sections) {
                // Merge: Behalte gespeicherte Einträge, füge neue hinzu, entferne nicht mehr relevante
                const savedSections = savedConfig.sections;
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
            // Default
            setSections(allAvailableSections.map((s, idx) => ({
                ...s,
                customName: '',
                order: idx
            })));
        }
    }, [open, savedConfig, savedAlwaysVisibleRows, allAvailableSections]);

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
        setAlwaysVisibleRows([]);
    };

    const isAlwaysVisible = (rowName, targetSectionTitle) => {
        return alwaysVisibleRows.some((entry) => entry.rowName === rowName && entry.targetSectionTitle === targetSectionTitle);
    };

    const toggleAlwaysVisible = (rowName, targetSectionTitle, checked) => {
        setAlwaysVisibleRows((prev) => {
            const withoutEntry = prev.filter((entry) => !(entry.rowName === rowName && entry.targetSectionTitle === targetSectionTitle));
            if (!checked) return withoutEntry;

            return [...withoutEntry, { rowName, targetSectionTitle }]
                .sort((a, b) => a.targetSectionTitle.localeCompare(b.targetSectionTitle, 'de') || a.rowName.localeCompare(b.rowName, 'de'));
        });
    };

    const handleSave = async () => {
        setIsSaving(true);
        try {
            const configData = JSON.stringify({ sections });
            await updateSettingMutation.mutateAsync({ key: SECTION_CONFIG_KEY, value: configData });
            await updateSettingMutation.mutateAsync({ key: ALWAYS_VISIBLE_ROWS_KEY, value: JSON.stringify(alwaysVisibleRows) });
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
            <DialogContent className="flex flex-col max-h-[85vh] !gap-0 p-0 max-w-3xl">
                <DialogHeader className="shrink-0 px-6 pt-6 pb-0">
                    <DialogTitle>Panel-Konfiguration</DialogTitle>
                </DialogHeader>
                
                <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
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

                    <div className="border-t pt-4 space-y-3">
                        <div>
                            <h3 className="text-sm font-semibold text-slate-900">Zeilen immer anzeigen</h3>
                            <p className="text-xs text-slate-500 mt-1">
                                Wählen Sie Zeilen aus anderen Bereichen, die zusätzlich im jeweiligen Reiter sichtbar bleiben sollen. Beispiel: „Spätdienst“ zusätzlich im Reiter „Rotationen“ anzeigen.
                            </p>
                        </div>

                        {sections
                            .filter((targetSection) => targetSection.defaultName !== 'Anwesenheiten')
                            .map((targetSection) => {
                                const targetRows = availableRowOptions.filter((row) => row.sectionTitle !== targetSection.defaultName);
                                const selectedCount = alwaysVisibleRows.filter((entry) => entry.targetSectionTitle === targetSection.defaultName).length;

                                if (targetRows.length === 0) return null;

                                return (
                                    <details key={`always-visible-${targetSection.id}`} className="rounded-lg border bg-slate-50/60" open={selectedCount > 0}>
                                        <summary className="cursor-pointer select-none px-3 py-2 text-sm font-medium text-slate-800">
                                            In „{targetSection.customName || targetSection.defaultName}“ zusätzlich anzeigen
                                            {selectedCount > 0 && <span className="ml-2 text-xs text-indigo-700">({selectedCount})</span>}
                                        </summary>
                                        <div className="grid gap-2 px-3 pb-3 sm:grid-cols-2">
                                            {targetRows.map((row) => {
                                                const checked = isAlwaysVisible(row.rowName, targetSection.defaultName);
                                                const inputId = `always-${targetSection.id}-${row.sectionTitle}-${row.rowName}`.replace(/[^a-zA-Z0-9_-]/g, '-');

                                                return (
                                                    <label key={`${targetSection.id}-${row.sectionTitle}-${row.rowName}`} htmlFor={inputId} className="flex items-start gap-2 rounded border bg-white p-2 text-sm hover:bg-indigo-50/40">
                                                        <input
                                                            id={inputId}
                                                            type="checkbox"
                                                            checked={checked}
                                                            onChange={(event) => toggleAlwaysVisible(row.rowName, targetSection.defaultName, event.target.checked)}
                                                            className="mt-0.5 h-4 w-4"
                                                        />
                                                        <span className="min-w-0">
                                                            <span className="block font-medium text-slate-800">{row.rowName}</span>
                                                            <span className="block text-xs text-slate-500">aus {row.sectionTitle}</span>
                                                        </span>
                                                    </label>
                                                );
                                            })}
                                        </div>
                                    </details>
                                );
                            })}
                    </div>
                </div>

                <DialogFooter className="sticky bottom-0 bg-white border-t shrink-0 px-6 py-4 flex justify-between">
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