import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Settings2 } from 'lucide-react';
import { db } from "@/api/client";
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

export default function AutoFillSettingsDialog({ trigger }) {
    const queryClient = useQueryClient();

    const { data: settings = [] } = useQuery({
        queryKey: ['systemSettings'],
        queryFn: () => db.SystemSetting.list(),
        staleTime: 10 * 60 * 1000,
        cacheTime: 15 * 60 * 1000,
        refetchOnWindowFocus: false,
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

    const getSetting = (key, def = '') => settings.find(s => s.key === key)?.value ?? def;
    const getSettingBool = (key) => getSetting(key) === 'true';

    const limitFG = getSetting('limit_fore_services', '4');
    const limitBG = getSetting('limit_back_services', '12');
    const limitWeekend = getSetting('limit_weekend_services', '1');
    const strictRotationMode = getSettingBool('rotation_restricts_other_assignments');
    const autoFillDebugEnabled = getSettingBool('autofill_debug_enabled') || getSettingBool('ai_autofill_debug_enabled');

    return (
        <Dialog>
            <DialogTrigger asChild>
                {trigger}
            </DialogTrigger>
            <DialogContent className="max-w-lg">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Settings2 className="w-5 h-5 text-indigo-600" />
                        AutoFill-Einstellungen
                    </DialogTitle>
                </DialogHeader>

                <div className="space-y-5 py-2">
                    {/* Service limits */}
                    <div className="border p-4 rounded-lg bg-slate-50 space-y-3">
                        <Label className="text-sm font-semibold text-slate-700">Dienstlimits (4-Wochen-Fenster)</Label>
                        <p className="text-xs text-slate-500">
                            Maximale Anzahl Dienste pro Mitarbeiter innerhalb von 4 Wochen.
                        </p>
                        <div className="grid grid-cols-3 gap-3">
                            <div className="space-y-1">
                                <Label className="text-xs text-slate-500">Vordergrund</Label>
                                <Input
                                    type="number"
                                    min="1"
                                    max="30"
                                    value={limitFG}
                                    onChange={(e) => updateSettingMutation.mutate({ key: 'limit_fore_services', value: e.target.value })}
                                    className="h-8 bg-white"
                                />
                            </div>
                            <div className="space-y-1">
                                <Label className="text-xs text-slate-500">Hintergrund</Label>
                                <Input
                                    type="number"
                                    min="1"
                                    max="30"
                                    value={limitBG}
                                    onChange={(e) => updateSettingMutation.mutate({ key: 'limit_back_services', value: e.target.value })}
                                    className="h-8 bg-white"
                                />
                            </div>
                            <div className="space-y-1">
                                <Label className="text-xs text-slate-500">Wochenende</Label>
                                <Input
                                    type="number"
                                    min="1"
                                    max="10"
                                    value={limitWeekend}
                                    onChange={(e) => updateSettingMutation.mutate({ key: 'limit_weekend_services', value: e.target.value })}
                                    className="h-8 bg-white"
                                />
                            </div>
                        </div>
                    </div>

                    {/* Rotation restriction */}
                    <div className="border p-4 rounded-lg bg-slate-50 space-y-3">
                        <div className="space-y-0.5">
                            <Label htmlFor="afs-strict-rotation" className="text-sm font-semibold text-slate-700">Strikte Rotations-Einteilung</Label>
                            <p className="text-xs text-slate-500">
                                Mitarbeiter mit aktiver Rotation werden ausschließlich für ihren Rotations-Arbeitsplatz eingeplant — 
                                nicht für Dienste oder andere Positionen (es sei denn, ein expliziter Wunsch liegt vor). 
                                Empfohlen für Abteilungen mit festen Rotationszuweisungen (z.B. Anästhesie).
                            </p>
                        </div>
                        <div className="flex items-center justify-between">
                            <span className="text-sm text-slate-700">Rotanten nur für Rotations-Position</span>
                            <Switch
                                id="afs-strict-rotation"
                                checked={strictRotationMode}
                                onCheckedChange={(checked) => updateSettingMutation.mutate({
                                    key: 'rotation_restricts_other_assignments',
                                    value: checked ? 'true' : 'false'
                                })}
                            />
                        </div>
                    </div>

                    {/* Debug mode */}
                    <div className="border p-4 rounded-lg bg-slate-50 space-y-3">
                        <div className="space-y-0.5">
                            <Label htmlFor="afs-debug" className="text-sm font-semibold text-slate-700">Debug-Modus</Label>
                            <p className="text-xs text-slate-500">
                                Ausführliche Entscheidungsprotokolle in der Browser-Konsole.
                            </p>
                        </div>
                        <div className="flex items-center justify-between">
                            <span className="text-sm text-slate-700">Debug-Logs aktiv</span>
                            <Switch
                                id="afs-debug"
                                checked={autoFillDebugEnabled}
                                onCheckedChange={(checked) => updateSettingMutation.mutate({
                                    key: 'autofill_debug_enabled',
                                    value: checked ? 'true' : 'false'
                                })}
                            />
                        </div>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}
