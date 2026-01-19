import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { db } from '@/components/db';
import { 
    Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter 
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Settings, Plus, Trash2, Calendar, AlertTriangle, Ban } from 'lucide-react';
import { STATES } from '@/components/schedule/holidayUtils';
import { format } from 'date-fns';

export default function AppSettingsDialog() {
    const [isOpen, setIsOpen] = useState(false);
    const queryClient = useQueryClient();
    const [newHoliday, setNewHoliday] = useState({ name: '', start_date: '', end_date: '', type: 'school', action: 'add' });

    // --- Settings ---
    const { data: settings = [] } = useQuery({
        queryKey: ['systemSettings'],
        queryFn: () => db.SystemSetting.list(),
    });

    const updateSettingMutation = useMutation({
        mutationFn: async ({ key, value }) => {
            const existing = settings.find(s => s.key === key);
            if (existing) {
                return db.SystemSetting.update(existing.id, { value });
            } else {
                return db.SystemSetting.create({ key, value });
            }
        },
        onSuccess: () => queryClient.invalidateQueries(['systemSettings'])
    });

    // --- Absence Rules ---
    const defaultRules = {
        "Urlaub": true, "Krank": true, "Frei": true, "Dienstreise": false, "Nicht verfügbar": false
    };
    const rulesSetting = settings.find(s => s.key === 'absence_blocking_rules');
    const absenceRules = rulesSetting ? JSON.parse(rulesSetting.value) : defaultRules;

    const toggleAbsenceRule = (type) => {
        const newRules = { ...absenceRules, [type]: !absenceRules[type] };
        updateSettingMutation.mutate({ key: 'absence_blocking_rules', value: JSON.stringify(newRules) });
    };

    const stateCode = settings.find(s => s.key === 'federal_state')?.value || 'MV';
    const showSchoolHolidays = settings.find(s => s.key === 'show_school_holidays')?.value === 'true';
    
    const defaultVisibleTypes = ["Urlaub", "Krank", "Frei", "Dienstreise", "Nicht verfügbar"];
    const rawVisibleTypes = settings.find(s => s.key === 'overview_visible_types')?.value;
    const visibleTypes = rawVisibleTypes ? JSON.parse(rawVisibleTypes) : defaultVisibleTypes;

    const minPresentSpecialists = parseInt(settings.find(s => s.key === 'min_present_specialists')?.value || '2');
    const minPresentAssistants = parseInt(settings.find(s => s.key === 'min_present_assistants')?.value || '4');
    const monthsPerRow = settings.find(s => s.key === 'vacation_months_per_row')?.value || '3';

    const toggleVisibleType = (type) => {
        const newTypes = visibleTypes.includes(type) 
            ? visibleTypes.filter(t => t !== type)
            : [...visibleTypes, type];
        updateSettingMutation.mutate({ key: 'overview_visible_types', value: JSON.stringify(newTypes) });
    };

    // --- Custom Holidays ---
    const { data: customHolidays = [] } = useQuery({
        queryKey: ['customHolidays'],
        queryFn: () => db.CustomHoliday.list(),
    });

    const createHolidayMutation = useMutation({
        mutationFn: (data) => db.CustomHoliday.create(data),
        onSuccess: () => {
            queryClient.invalidateQueries(['customHolidays']);
            setNewHoliday({ name: '', start_date: '', end_date: '', type: 'school', action: 'add' });
        }
    });

    const deleteHolidayMutation = useMutation({
        mutationFn: (id) => db.CustomHoliday.delete(id),
        onSuccess: () => queryClient.invalidateQueries(['customHolidays'])
    });

    const handleAddHoliday = () => {
        if (!newHoliday.name || !newHoliday.start_date) return;
        createHolidayMutation.mutate(newHoliday);
    };

    return (
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <DialogTrigger asChild>
                <Button variant="outline" size="icon" title="Einstellungen">
                    <Settings className="h-4 w-4" />
                </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl">
                <DialogHeader>
                    <DialogTitle>Allgemeine Einstellungen</DialogTitle>
                </DialogHeader>
                
                <Tabs defaultValue="general">
                    <TabsList className="grid w-full grid-cols-3">
                        <TabsTrigger value="general">Allgemein</TabsTrigger>
                        <TabsTrigger value="rules">Konfliktregeln</TabsTrigger>
                        <TabsTrigger value="holidays">Ferien & Feiertage</TabsTrigger>
                    </TabsList>

                    <TabsContent value="general" className="space-y-4 py-4">
                        <div className="space-y-2">
                            <Label>Bundesland</Label>
                            <Select 
                                value={stateCode} 
                                onValueChange={(val) => updateSettingMutation.mutate({ key: 'federal_state', value: val })}
                            >
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {Object.entries(STATES).map(([code, name]) => (
                                        <SelectItem key={code} value={code}>{name}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            <p className="text-xs text-slate-500">Bestimmt die gesetzlichen Feiertage und Schulferien.</p>
                        </div>

                        <div className="flex items-center justify-between border p-3 rounded-lg bg-slate-50">
                            <div className="space-y-0.5">
                                <Label>Schulferien anzeigen</Label>
                                <p className="text-xs text-slate-500">Grünliche Markierung in Jahresübersicht und anderen Kalendern.</p>
                            </div>
                            <Switch 
                                checked={showSchoolHolidays}
                                onCheckedChange={(checked) => updateSettingMutation.mutate({ key: 'show_school_holidays', value: String(checked) })}
                            />
                        </div>

                        <div className="border p-3 rounded-lg bg-slate-50 space-y-3">
                            <div className="space-y-0.5">
                                <Label>Anzuzeigende Abwesenheitstypen (Jahresübersicht)</Label>
                                <p className="text-xs text-slate-500">Wählen Sie, welche Einträge in der Jahresübersicht sichtbar sein sollen.</p>
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                                {defaultVisibleTypes.map(type => (
                                    <div key={type} className="flex items-center space-x-2">
                                        <Switch 
                                            id={`type-${type}`}
                                            checked={visibleTypes.includes(type)}
                                            onCheckedChange={() => toggleVisibleType(type)}
                                        />
                                        <Label htmlFor={`type-${type}`} className="text-sm font-normal cursor-pointer">{type}</Label>
                                    </div>
                                ))}
                            </div>
                        </div>

                        <div className="border p-3 rounded-lg bg-slate-50 space-y-3">
                            <div className="space-y-0.5">
                                <Label>Darstellung Jahresübersicht</Label>
                                <p className="text-xs text-slate-500">Anzahl der angezeigten Monate pro Zeile.</p>
                            </div>
                            <Select 
                                value={monthsPerRow} 
                                onValueChange={(val) => updateSettingMutation.mutate({ key: 'vacation_months_per_row', value: val })}
                            >
                                <SelectTrigger className="w-full">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="1">1 Monat / Zeile</SelectItem>
                                    <SelectItem value="2">2 Monate / Zeile</SelectItem>
                                    <SelectItem value="3">3 Monate / Zeile</SelectItem>
                                    <SelectItem value="4">4 Monate / Zeile</SelectItem>
                                    <SelectItem value="6">6 Monate / Zeile</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="border p-3 rounded-lg bg-slate-50 space-y-3">
                            <div className="space-y-0.5">
                                <Label>Grenzwerte für Verfügbarkeit</Label>
                                <p className="text-xs text-slate-500">Minimale Anzahl anwesender Ärzte (Warnung bei Unterschreitung).</p>
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label className="text-xs">Min. Fachärzte (inkl. OA/CA)</Label>
                                    <Input 
                                        type="number" 
                                        min="0"
                                        value={minPresentSpecialists}
                                        onChange={(e) => updateSettingMutation.mutate({ key: 'min_present_specialists', value: e.target.value })}
                                        className="h-8"
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label className="text-xs">Min. Assistenzärzte</Label>
                                    <Input 
                                        type="number" 
                                        min="0"
                                        value={minPresentAssistants}
                                        onChange={(e) => updateSettingMutation.mutate({ key: 'min_present_assistants', value: e.target.value })}
                                        className="h-8"
                                    />
                                </div>
                            </div>
                        </div>



                    </TabsContent>

                    <TabsContent value="rules" className="space-y-4 py-4">
                        <div className="border p-4 rounded-lg bg-slate-50">
                            <div className="mb-4">
                                <h4 className="font-medium text-sm">Konfliktregeln für Abwesenheiten</h4>
                                <p className="text-xs text-slate-500">
                                    Legen Sie fest, ob eine Abwesenheit die Einteilung in andere Dienste/Rotationen strikt blockiert oder nur eine Warnung erzeugt.
                                </p>
                            </div>
                            
                            <div className="space-y-2">
                                <div className="flex items-center justify-between text-xs font-medium text-slate-500 uppercase px-2">
                                    <span>Abwesenheitsart</span>
                                    <span>Verhalten bei Konflikt</span>
                                </div>
                                {["Urlaub", "Krank", "Frei", "Dienstreise", "Nicht verfügbar"].map(type => (
                                    <div key={type} className="flex items-center justify-between p-3 bg-white rounded-lg border border-slate-200 shadow-sm">
                                        <div className="font-medium text-slate-900 text-sm">{type}</div>
                                        <div className="flex items-center gap-3">
                                            <div className={`text-xs font-medium flex items-center gap-1 w-24 justify-end ${absenceRules[type] ? 'text-red-600' : 'text-amber-600'}`}>
                                                {absenceRules[type] ? (
                                                    <>
                                                        <Ban className="w-3 h-3" />
                                                        Blockieren
                                                    </>
                                                ) : (
                                                    <>
                                                        <AlertTriangle className="w-3 h-3" />
                                                        Warnung
                                                    </>
                                                )}
                                            </div>
                                            <Switch 
                                                checked={absenceRules[type]} 
                                                onCheckedChange={() => toggleAbsenceRule(type)}
                                            />
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </TabsContent>

                    <TabsContent value="holidays" className="space-y-4 py-4">
                        <div className="grid gap-4 border p-4 rounded-lg bg-slate-50">
                            <h4 className="font-medium text-sm">Eintrag hinzufügen / entfernen</h4>
                            <div className="grid grid-cols-2 gap-2">
                                <div className="col-span-2">
                                    <Label className="text-xs">Bezeichnung</Label>
                                    <Input 
                                        value={newHoliday.name} 
                                        onChange={e => setNewHoliday({...newHoliday, name: e.target.value})} 
                                        placeholder="z.B. Brückentag" 
                                        className="h-8"
                                    />
                                </div>
                                <div>
                                    <Label className="text-xs">Start</Label>
                                    <Input 
                                        type="date" 
                                        value={newHoliday.start_date} 
                                        onChange={e => setNewHoliday({
                                            ...newHoliday, 
                                            start_date: e.target.value,
                                            // Auto-set end date to start date for convenience
                                            end_date: e.target.value 
                                        })} 
                                        className="h-8"
                                    />
                                </div>
                                <div>
                                    <Label className="text-xs">Ende (Optional)</Label>
                                    <Input 
                                        type="date" 
                                        value={newHoliday.end_date} 
                                        onChange={e => setNewHoliday({...newHoliday, end_date: e.target.value})} 
                                        className="h-8"
                                    />
                                </div>
                                <div>
                                    <Label className="text-xs">Typ</Label>
                                    <Select 
                                        value={newHoliday.type} 
                                        onValueChange={v => setNewHoliday({...newHoliday, type: v})}
                                    >
                                        <SelectTrigger className="h-8">
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="school">Schulferien</SelectItem>
                                            <SelectItem value="public">Feiertag</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div>
                                    <Label className="text-xs">Aktion</Label>
                                    <Select 
                                        value={newHoliday.action} 
                                        onValueChange={v => setNewHoliday({...newHoliday, action: v})}
                                    >
                                        <SelectTrigger className="h-8">
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="add">Hinzufügen</SelectItem>
                                            <SelectItem value="remove">Entfernen/Blockieren</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="col-span-2 pt-2">
                                    <Button onClick={handleAddHoliday} className="w-full h-8" size="sm">
                                        <Plus className="w-3 h-3 mr-2" /> Speichern
                                    </Button>
                                </div>
                            </div>
                        </div>

                        <div className="space-y-2">
                            <h4 className="font-medium text-sm">Manuelle Einträge</h4>
                            <div className="space-y-2 max-h-[200px] overflow-y-auto">
                                {customHolidays.length === 0 && <p className="text-xs text-slate-500 italic">Keine manuellen Einträge.</p>}
                                {customHolidays.map(h => (
                                    <div key={h.id} className="flex items-center justify-between text-sm border p-2 rounded bg-white">
                                        <div>
                                            <div className="font-medium flex items-center gap-2">
                                                {h.name}
                                                <span className={`text-[10px] px-1.5 py-0.5 rounded ${h.action === 'add' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                                                    {h.action === 'add' ? '+' : '-'}
                                                </span>
                                                <span className="text-[10px] bg-slate-100 px-1.5 py-0.5 rounded text-slate-600">
                                                    {h.type === 'school' ? 'Ferien' : 'Feiertag'}
                                                </span>
                                            </div>
                                            <div className="text-xs text-slate-500">
                                                {format(new Date(h.start_date), 'dd.MM.yyyy')}
                                                {h.end_date && h.end_date !== h.start_date && ` - ${format(new Date(h.end_date), 'dd.MM.yyyy')}`}
                                            </div>
                                        </div>
                                        <Button variant="ghost" size="icon" className="h-6 w-6 text-red-500" onClick={() => deleteHolidayMutation.mutate(h.id)}>
                                            <Trash2 className="w-3 h-3" />
                                        </Button>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </TabsContent>
                </Tabs>

                <DialogFooter>
                    <Button variant="ghost" onClick={() => setIsOpen(false)}>Schließen</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}