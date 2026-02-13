import React, { useState, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { 
    Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
    DialogFooter, DialogDescription
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { 
    Award, Plus, Trash2, GripVertical, Pencil, Shield, ChevronDown, ChevronUp
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
import { useQualifications } from '@/hooks/useQualifications';

// Vordefinierte Farb-Optionen
const COLOR_PRESETS = [
    { label: "Grün", bg: "#dcfce7", text: "#166534" },
    { label: "Blau", bg: "#dbeafe", text: "#1e40af" },
    { label: "Orange", bg: "#fed7aa", text: "#9a3412" },
    { label: "Gelb", bg: "#fef9c3", text: "#854d0e" },
    { label: "Lila", bg: "#e9d5ff", text: "#6b21a8" },
    { label: "Rosa", bg: "#fce7f3", text: "#9d174d" },
    { label: "Rot", bg: "#fee2e2", text: "#991b1b" },
    { label: "Türkis", bg: "#ccfbf1", text: "#115e59" },
    { label: "Indigo", bg: "#e0e7ff", text: "#3730a3" },
    { label: "Grau", bg: "#e5e7eb", text: "#374151" },
];

// Kategorie-Optionen
const CATEGORY_OPTIONS = [
    "Medizinisch",
    "Dienst",
    "Zertifizierung",
    "Gerät",
    "Sonstiges",
];

function QualificationEditDialog({ qualification, open, onOpenChange, onSave }) {
    const [formData, setFormData] = useState({
        name: '',
        short_label: '',
        description: '',
        color_bg: '#e0e7ff',
        color_text: '#3730a3',
        category: 'Allgemein',
        is_active: true,
    });

    useEffect(() => {
        if (qualification) {
            setFormData({
                name: qualification.name || '',
                short_label: qualification.short_label || '',
                description: qualification.description || '',
                color_bg: qualification.color_bg || '#e0e7ff',
                color_text: qualification.color_text || '#3730a3',
                category: qualification.category || 'Allgemein',
                is_active: qualification.is_active !== false,
            });
        } else {
            setFormData({
                name: '',
                short_label: '',
                description: '',
                color_bg: '#e0e7ff',
                color_text: '#3730a3',
                category: 'Allgemein',
                is_active: true,
            });
        }
    }, [qualification, open]);

    const handleSubmit = (e) => {
        e.preventDefault();
        if (formData.name.trim()) {
            // Auto-generate short_label if empty
            const data = { ...formData };
            if (!data.short_label) {
                data.short_label = data.name.substring(0, 3).toUpperCase();
            }
            onSave(data);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[500px]">
                <DialogHeader>
                    <DialogTitle>
                        {qualification ? "Qualifikation bearbeiten" : "Neue Qualifikation anlegen"}
                    </DialogTitle>
                    <DialogDescription>
                        Qualifikationen können Mitarbeitern zugeordnet und als Voraussetzung für Arbeitsplätze definiert werden.
                    </DialogDescription>
                </DialogHeader>
                <form onSubmit={handleSubmit} className="grid gap-4 py-4">
                    <div className="grid grid-cols-3 gap-4">
                        <div className="col-span-2 grid gap-2">
                            <Label htmlFor="qualName">Name</Label>
                            <Input
                                id="qualName"
                                value={formData.name}
                                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                placeholder="z.B. CT-Befundung, Notfall-Sono, ..."
                                required
                            />
                        </div>
                        <div className="grid gap-2">
                            <Label htmlFor="qualShortLabel">Kürzel</Label>
                            <Input
                                id="qualShortLabel"
                                value={formData.short_label}
                                onChange={(e) => setFormData({ ...formData, short_label: e.target.value.substring(0, 5) })}
                                placeholder="z.B. CT"
                                maxLength={5}
                            />
                        </div>
                    </div>
                    
                    <div className="grid gap-2">
                        <Label htmlFor="qualDescription">Beschreibung (optional)</Label>
                        <Input
                            id="qualDescription"
                            value={formData.description}
                            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                            placeholder="Kurze Beschreibung der Qualifikation"
                        />
                    </div>

                    <div className="grid gap-2">
                        <Label>Kategorie</Label>
                        <div className="flex flex-wrap gap-2">
                            {CATEGORY_OPTIONS.map(cat => (
                                <button
                                    key={cat}
                                    type="button"
                                    onClick={() => setFormData({ ...formData, category: cat })}
                                    className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                                        formData.category === cat 
                                            ? 'bg-indigo-600 text-white' 
                                            : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                                    }`}
                                >
                                    {cat}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="grid gap-2">
                        <Label>Badge-Farbe</Label>
                        <div className="flex flex-wrap gap-2">
                            {COLOR_PRESETS.map(preset => (
                                <button
                                    key={preset.label}
                                    type="button"
                                    onClick={() => setFormData({ 
                                        ...formData, 
                                        color_bg: preset.bg, 
                                        color_text: preset.text 
                                    })}
                                    className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                                        formData.color_bg === preset.bg 
                                            ? 'ring-2 ring-offset-1 ring-indigo-500' 
                                            : ''
                                    }`}
                                    style={{ backgroundColor: preset.bg, color: preset.text }}
                                >
                                    {preset.label}
                                </button>
                            ))}
                        </div>
                        <div className="mt-2 flex items-center gap-3">
                            <span className="text-xs text-slate-500">Vorschau:</span>
                            <Badge 
                                style={{ backgroundColor: formData.color_bg, color: formData.color_text }}
                                className="border-0"
                            >
                                {formData.short_label || formData.name.substring(0, 3).toUpperCase()} – {formData.name || 'Name'}
                            </Badge>
                        </div>
                    </div>

                    <div className="flex items-center justify-between p-3 border rounded bg-slate-50">
                        <div className="space-y-0.5">
                            <Label className="text-sm font-medium">Aktiv</Label>
                            <div className="text-xs text-slate-500">
                                Inaktive Qualifikationen werden nicht in Dropdowns angezeigt.
                            </div>
                        </div>
                        <Switch
                            checked={formData.is_active}
                            onCheckedChange={(checked) => setFormData({ ...formData, is_active: checked })}
                        />
                    </div>

                    <DialogFooter className="mt-2">
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

export default function QualificationManagement() {
    const queryClient = useQueryClient();
    const {
        qualifications,
        qualificationsByCategory,
        categories,
        isLoading,
        createQualification,
        updateQualification,
        deleteQualification,
    } = useQualifications();

    const [isDialogOpen, setIsDialogOpen] = useState(false);
    const [editDialogOpen, setEditDialogOpen] = useState(false);
    const [editingQual, setEditingQual] = useState(null);
    const [expandedCategories, setExpandedCategories] = useState({});

    const toggleCategory = (cat) => {
        setExpandedCategories(prev => ({ ...prev, [cat]: !prev[cat] }));
    };

    const handleAddNew = () => {
        setEditingQual(null);
        setEditDialogOpen(true);
    };

    const handleEdit = (qual) => {
        setEditingQual(qual);
        setEditDialogOpen(true);
    };

    const handleSave = (formData) => {
        if (editingQual) {
            updateQualification({ id: editingQual.id, data: formData });
        } else {
            createQualification(formData);
        }
        setEditDialogOpen(false);
        setEditingQual(null);
    };

    const handleDragEnd = (result) => {
        if (!result.destination) return;
        const items = Array.from(qualifications);
        const [reorderedItem] = items.splice(result.source.index, 1);
        items.splice(result.destination.index, 0, reorderedItem);

        items.forEach((qual, index) => {
            if (qual.order !== index) {
                updateQualification({ id: qual.id, data: { order: index } });
            }
        });
    };

    return (
        <>
            <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                <DialogTrigger asChild>
                    <Button variant="outline" size="icon" title="Qualifikationen verwalten">
                        <Award className="h-4 w-4" />
                    </Button>
                </DialogTrigger>
                <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <Shield className="h-5 w-5" />
                            Qualifikationen verwalten
                        </DialogTitle>
                        <DialogDescription>
                            Definieren Sie Qualifikationen und Berechtigungen, die Mitarbeitern zugeordnet 
                            und für Arbeitsplätze als Voraussetzung definiert werden können.
                        </DialogDescription>
                    </DialogHeader>
                    
                    <div className="py-4">
                        {isLoading ? (
                            <div className="text-center text-slate-500 py-8">Wird geladen...</div>
                        ) : (
                            <>
                                {categories.map(cat => (
                                    <div key={cat} className="mb-4">
                                        <button
                                            onClick={() => toggleCategory(cat)}
                                            className="flex items-center gap-2 w-full text-left text-sm font-semibold text-slate-600 hover:text-slate-900 py-1"
                                        >
                                            {expandedCategories[cat] === false ? (
                                                <ChevronDown className="w-4 h-4" />
                                            ) : (
                                                <ChevronUp className="w-4 h-4" />
                                            )}
                                            {cat}
                                            <Badge variant="outline" className="text-[10px] ml-1">
                                                {(qualificationsByCategory[cat] || []).length}
                                            </Badge>
                                        </button>
                                        
                                        {expandedCategories[cat] !== false && (
                                            <div className="space-y-2 mt-2 ml-2">
                                                {(qualificationsByCategory[cat] || []).map(qual => (
                                                    <Card key={qual.id} className={qual.is_active === false ? 'opacity-50' : ''}>
                                                        <CardContent className="p-3 flex items-center gap-3">
                                                            <div className="flex-1">
                                                                <div className="flex items-center flex-wrap gap-1.5">
                                                                    <Badge 
                                                                        style={{ 
                                                                            backgroundColor: qual.color_bg || '#e0e7ff', 
                                                                            color: qual.color_text || '#3730a3' 
                                                                        }}
                                                                        className="border-0 text-xs"
                                                                    >
                                                                        {qual.short_label || qual.name.substring(0, 3).toUpperCase()}
                                                                    </Badge>
                                                                    <span className="font-medium text-sm">{qual.name}</span>
                                                                    {qual.is_active === false && (
                                                                        <Badge variant="outline" className="text-[10px] text-slate-400">
                                                                            inaktiv
                                                                        </Badge>
                                                                    )}
                                                                </div>
                                                                {qual.description && (
                                                                    <p className="text-xs text-slate-500 mt-0.5">{qual.description}</p>
                                                                )}
                                                            </div>
                                                            <div className="flex gap-1">
                                                                <Button 
                                                                    variant="ghost" 
                                                                    size="icon" 
                                                                    className="h-7 w-7 text-slate-400 hover:text-indigo-600"
                                                                    onClick={() => handleEdit(qual)}
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
                                                                            <AlertDialogTitle>Qualifikation löschen?</AlertDialogTitle>
                                                                            <AlertDialogDescription>
                                                                                Die Qualifikation „{qual.name}" wird gelöscht. 
                                                                                Alle Zuordnungen zu Mitarbeitern und Arbeitsplätzen werden ebenfalls entfernt.
                                                                            </AlertDialogDescription>
                                                                        </AlertDialogHeader>
                                                                        <AlertDialogFooter>
                                                                            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
                                                                            <AlertDialogAction 
                                                                                onClick={() => deleteQualification(qual.id)}
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
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                ))}

                                <Button 
                                    onClick={handleAddNew} 
                                    variant="outline" 
                                    className="w-full mt-4"
                                >
                                    <Plus className="w-4 h-4 mr-2" />
                                    Neue Qualifikation hinzufügen
                                </Button>
                            </>
                        )}
                    </div>
                </DialogContent>
            </Dialog>

            <QualificationEditDialog
                qualification={editingQual}
                open={editDialogOpen}
                onOpenChange={setEditDialogOpen}
                onSave={handleSave}
            />
        </>
    );
}
