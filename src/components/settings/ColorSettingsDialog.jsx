import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, db, base44 } from "@/api/client";
import { 
    Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger 
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Palette, RefreshCcw, Save } from 'lucide-react';
import { useTeamRoles, DEFAULT_TEAM_ROLES } from './TeamRoleSettings';

// Default configurations matching current hardcoded values
export const DEFAULT_COLORS = {
    sections: {
        "Abwesenheiten": { bg: "#e2e8f0", text: "#1e293b" }, // slate-200, slate-800
        "Dienste": { bg: "#dbeafe", text: "#1e3a8a" }, // blue-100, blue-900
        "Rotationen": { bg: "#d1fae5", text: "#064e3b" }, // emerald-100, emerald-900
        "Demonstrationen & Konsile": { bg: "#fef3c7", text: "#78350f" }, // amber-100, amber-900
        "Sonstiges": { bg: "#f3e8ff", text: "#581c87" }, // purple-100, purple-900
    },
    roles: {
        "Chefarzt": { bg: "#fee2e2", text: "#991b1b" }, // red-100, red-800
        "Oberarzt": { bg: "#dbeafe", text: "#1e40af" }, // blue-100, blue-800
        "Facharzt": { bg: "#dcfce7", text: "#166534" }, // green-100, green-800
        "Assistenzarzt": { bg: "#fef9c3", text: "#854d0e" }, // yellow-100, yellow-800
        "Nicht-Radiologe": { bg: "#e5e7eb", text: "#1f2937" } // gray-200, gray-800
    },
    // Keeping positions for fallback compatibility, though not editable in UI anymore
    positions: {
        "Frei": { bg: "#64748b", text: "#ffffff" }, // slate-500
        "Krank": { bg: "#ef4444", text: "#ffffff" }, // red-500
        "Urlaub": { bg: "#22c55e", text: "#ffffff" }, // green-500
        "Dienstreise": { bg: "#3b82f6", text: "#ffffff" }, // blue-500
        "Nicht verfügbar": { bg: "#f97316", text: "#ffffff" }, // orange-500
        "Dienst Vordergrund": { bg: "#bfdbfe", text: "#1e3a8a" }, // blue-200
        "Dienst Hintergrund": { bg: "#bfdbfe", text: "#1e3a8a" },
        "Spätdienst": { bg: "#bfdbfe", text: "#1e3a8a" },
        "CT": { bg: "#a7f3d0", text: "#064e3b" }, // emerald-200
        "MRT": { bg: "#a7f3d0", text: "#064e3b" },
        "Sonographie": { bg: "#a7f3d0", text: "#064e3b" },
        "Mammographie": { bg: "#a7f3d0", text: "#064e3b" },
        "Angiographie": { bg: "#a7f3d0", text: "#064e3b" },
        "DL/konv. Rö": { bg: "#a7f3d0", text: "#064e3b" },
        "Röntgen": { bg: "#a7f3d0", text: "#064e3b" },
    }
};

export default function ColorSettingsDialog() {
    const queryClient = useQueryClient();
    const [activeTab, setActiveTab] = useState("roles");

    const { data: colorSettings = [] } = useQuery({
        queryKey: ['colorSettings'],
        queryFn: () => db.ColorSetting.list(),
    });

    const { data: workplaces = [] } = useQuery({
        queryKey: ['workplaces'],
        queryFn: () => db.Workplace.list(null, 1000),
    });

    const createOrUpdateMutation = useMutation({
        mutationFn: async (data) => {
            const existing = colorSettings.find(s => s.name === data.name && s.category === data.category);
            if (existing) {
                return db.ColorSetting.update(existing.id, data);
            } else {
                return db.ColorSetting.create(data);
            }
        },
        onSuccess: () => queryClient.invalidateQueries(['colorSettings'])
    });

    const handleColorChange = (name, category, type, value) => {
        const current = getColor(name, category);
        const newData = {
            name,
            category,
            bg_color: type === 'bg' ? value : current.bg,
            text_color: type === 'text' ? value : current.text
        };
        createOrUpdateMutation.mutate(newData);
    };

    const getColor = (name, category) => {
        const setting = colorSettings.find(s => s.name === name && s.category === category);
        if (setting) return { bg: setting.bg_color, text: setting.text_color };
        
        // Fallback to defaults
        if (category === 'section') return DEFAULT_COLORS.sections[name] || { bg: "#e2e8f0", text: "#1e293b" };
        if (category === 'role') return DEFAULT_COLORS.roles[name] || { bg: "#f3f4f6", text: "#1f2937" };
        if (category === 'position') return DEFAULT_COLORS.positions[name] || { bg: "#f1f5f9", text: "#1e293b" };
        return { bg: "#ffffff", text: "#000000" };
    };

    const resetToDefault = (name, category) => {
        const existing = colorSettings.find(s => s.name === name && s.category === category);
        if (existing) {
            db.ColorSetting.delete(existing.id).then(() => {
                queryClient.invalidateQueries(['colorSettings']);
            });
        }
    };

    const sectionsList = Object.keys(DEFAULT_COLORS.sections);
    // Dynamisch Rollen aus DB laden statt hardcoded
    const { roleNames: dynamicRoles } = useTeamRoles();
    const rolesList = dynamicRoles.length > 0 ? dynamicRoles : DEFAULT_TEAM_ROLES.map(r => r.name);
    const positionsList = workplaces.map(w => w.name).sort();

    return (
        <Dialog>
            <DialogTrigger asChild>
                <Button variant="outline" size="icon" title="Farben anpassen">
                    <Palette className="h-4 w-4" />
                </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>Farbeinstellungen</DialogTitle>
                </DialogHeader>
                
                <Tabs value={activeTab} onValueChange={setActiveTab}>
                    <TabsList className="grid w-full grid-cols-3">
                        <TabsTrigger value="roles">Funktionen</TabsTrigger>
                        <TabsTrigger value="positions">Arbeitsplätze</TabsTrigger>
                        <TabsTrigger value="sections">Bereiche</TabsTrigger>
                    </TabsList>

                    <TabsContent value="sections" className="space-y-4 mt-4">
                        {sectionsList.map(name => (
                            <ColorRow 
                                key={name} 
                                name={name} 
                                category="section" 
                                colors={getColor(name, 'section')}
                                onChange={handleColorChange}
                                onReset={resetToDefault}
                            />
                        ))}
                    </TabsContent>

                    <TabsContent value="roles" className="space-y-4 mt-4">
                        {rolesList.map(name => (
                            <ColorRow 
                                key={name} 
                                name={name} 
                                category="role" 
                                colors={getColor(name, 'role')}
                                onChange={handleColorChange}
                                onReset={resetToDefault}
                            />
                        ))}
                    </TabsContent>

                    <TabsContent value="positions" className="space-y-4 mt-4">
                        {positionsList.map(name => (
                            <ColorRow 
                                key={name} 
                                name={name} 
                                category="position" 
                                colors={getColor(name, 'position')}
                                onChange={handleColorChange}
                                onReset={resetToDefault}
                            />
                        ))}
                    </TabsContent>
                </Tabs>
            </DialogContent>
        </Dialog>
    );
}

function ColorRow({ name, category, colors, onChange, onReset }) {
    return (
        <div className="flex items-center justify-between p-3 border rounded-lg bg-slate-50/50">
            <div className="flex items-center gap-3">
                <div 
                    className="w-16 h-8 rounded border shadow-sm flex items-center justify-center text-xs font-medium"
                    style={{ backgroundColor: colors.bg, color: colors.text }}
                >
                    Test
                </div>
                <span className="font-medium text-sm">{name}</span>
            </div>
            
            <div className="flex items-center gap-3">
                <div className="flex flex-col gap-1">
                    <Label className="text-[10px] text-slate-500">Hintergrund</Label>
                    <DebouncedColorInput 
                        value={colors.bg}
                        onChange={(val) => onChange(name, category, 'bg', val)}
                    />
                </div>

                <div className="flex flex-col gap-1">
                    <Label className="text-[10px] text-slate-500">Text</Label>
                    <DebouncedColorInput 
                        value={colors.text}
                        onChange={(val) => onChange(name, category, 'text', val)}
                    />
                </div>

                <Button 
                    variant="ghost" 
                    size="icon" 
                    onClick={() => onReset(name, category)}
                    title="Zurücksetzen"
                    className="mt-4"
                >
                    <RefreshCcw className="w-4 h-4 text-slate-400" />
                </Button>
            </div>
        </div>
    );
}

function DebouncedColorInput({ value, onChange }) {
    const [localValue, setLocalValue] = useState(value);

    useEffect(() => {
        setLocalValue(value);
    }, [value]);

    useEffect(() => {
        const timer = setTimeout(() => {
            if (localValue !== value) {
                onChange(localValue);
            }
        }, 500);
        return () => clearTimeout(timer);
    }, [localValue, onChange, value]);

    return (
        <div className="flex items-center gap-2">
            <Input 
                type="color" 
                value={localValue}
                onChange={(e) => setLocalValue(e.target.value)}
                className="w-12 h-8 p-1 cursor-pointer"
            />
            <span className="text-xs font-mono text-slate-400">{localValue}</span>
        </div>
    );
}