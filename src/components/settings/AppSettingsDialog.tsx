import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { db } from '@/api/client';

interface SystemSetting {
  id: number | string;
  key: string;
  value: string;
}
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Settings, AlertTriangle, Ban, Info } from 'lucide-react';

export default function AppSettingsDialog() {
  const [isOpen, setIsOpen] = useState(false);
  const queryClient = useQueryClient();

  // --- Settings ---
  const { data: settings = [] } = useQuery({
    queryKey: ['systemSettings'],
    queryFn: () => db.SystemSetting.list() as Promise<SystemSetting[]>,
  });

  const updateSettingMutation = useMutation({
    mutationFn: async ({ key, value }: { key: string; value: string }) => {
      const existing = settings.find((s) => s.key === key);
      if (existing) {
        return db.SystemSetting.update(existing.id, { value });
      } else {
        return db.SystemSetting.create({ key, value });
      }
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['systemSettings'] }),
  });

  // --- Absence Rules ---
  const defaultRules = {
    Urlaub: true,
    Krank: true,
    Frei: true,
    Dienstreise: false,
    'Nicht verfügbar': false,
  };
  const rulesSetting = settings.find((s) => s.key === 'absence_blocking_rules');
  const absenceRules = rulesSetting ? JSON.parse(rulesSetting.value) : defaultRules;

  const toggleAbsenceRule = (type: string) => {
    const newRules = { ...absenceRules, [type]: !absenceRules[type] };
    updateSettingMutation.mutate({
      key: 'absence_blocking_rules',
      value: JSON.stringify(newRules),
    });
  };

  const showSchoolHolidays =
    settings.find((s) => s.key === 'show_school_holidays')?.value !== 'false';

  const defaultVisibleTypes = ['Urlaub', 'Krank', 'Frei', 'Dienstreise', 'Nicht verfügbar'];
  const rawVisibleTypes = settings.find((s) => s.key === 'overview_visible_types')?.value;
  const visibleTypes = rawVisibleTypes ? JSON.parse(rawVisibleTypes) : defaultVisibleTypes;

  const minPresentSpecialists = parseInt(
    settings.find((s) => s.key === 'min_present_specialists')?.value || '2',
  );
  const minPresentAssistants = parseInt(
    settings.find((s) => s.key === 'min_present_assistants')?.value || '4',
  );
  const monthsPerRow = settings.find((s) => s.key === 'vacation_months_per_row')?.value || '3';

  const toggleVisibleType = (type: string) => {
    const newTypes = visibleTypes.includes(type)
      ? visibleTypes.filter((t: string) => t !== type)
      : [...visibleTypes, type];
    updateSettingMutation.mutate({
      key: 'overview_visible_types',
      value: JSON.stringify(newTypes),
    });
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
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="general">Allgemein</TabsTrigger>
            <TabsTrigger value="rules">Konfliktregeln</TabsTrigger>
          </TabsList>

          <TabsContent value="general" className="space-y-4 py-4">
            <div className="flex items-start gap-2 border p-3 rounded-lg bg-blue-50/50 border-blue-200">
              <Info className="w-4 h-4 text-blue-500 mt-0.5 shrink-0" />
              <div className="text-xs text-blue-700">
                <p className="font-medium">Feiertage & Ferien werden zentral verwaltet</p>
                <p className="mt-0.5">
                  Bundesland-Einstellung und Korrekturen befinden sich im Master-Frontend und gelten
                  für alle Mandanten.
                </p>
              </div>
            </div>

            <div className="flex items-center justify-between border p-3 rounded-lg bg-slate-50">
              <div className="space-y-0.5">
                <Label>Schulferien anzeigen</Label>
                <p className="text-xs text-slate-500">
                  Grünliche Markierung in Jahresübersicht und anderen Kalendern.
                </p>
              </div>
              <Switch
                checked={showSchoolHolidays}
                onCheckedChange={(checked) =>
                  updateSettingMutation.mutate({
                    key: 'show_school_holidays',
                    value: String(checked),
                  })
                }
              />
            </div>

            <div className="border p-3 rounded-lg bg-slate-50 space-y-3">
              <div className="space-y-0.5">
                <Label>Anzuzeigende Abwesenheitstypen (Jahresübersicht)</Label>
                <p className="text-xs text-slate-500">
                  Wählen Sie, welche Einträge in der Jahresübersicht sichtbar sein sollen.
                </p>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {defaultVisibleTypes.map((type) => (
                  <div key={type} className="flex items-center space-x-2">
                    <Switch
                      id={`type-${type}`}
                      checked={visibleTypes.includes(type)}
                      onCheckedChange={() => toggleVisibleType(type)}
                    />
                    <Label htmlFor={`type-${type}`} className="text-sm font-normal cursor-pointer">
                      {type}
                    </Label>
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
                onValueChange={(val) =>
                  updateSettingMutation.mutate({ key: 'vacation_months_per_row', value: val })
                }
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
                <p className="text-xs text-slate-500">
                  Minimale Anzahl anwesenden Personals (Warnung bei Unterschreitung).
                </p>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="text-xs">Min. Fachpersonal (inkl. OA/CA)</Label>
                  <Input
                    type="number"
                    min="0"
                    value={minPresentSpecialists}
                    onChange={(e) =>
                      updateSettingMutation.mutate({
                        key: 'min_present_specialists',
                        value: e.target.value,
                      })
                    }
                    className="h-8"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs">Min. Assistenzpersonal</Label>
                  <Input
                    type="number"
                    min="0"
                    value={minPresentAssistants}
                    onChange={(e) =>
                      updateSettingMutation.mutate({
                        key: 'min_present_assistants',
                        value: e.target.value,
                      })
                    }
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
                  Legen Sie fest, ob eine Abwesenheit die Einteilung in andere Dienste/Rotationen
                  strikt blockiert oder nur eine Warnung erzeugt.
                </p>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs font-medium text-slate-500 uppercase px-2">
                  <span>Abwesenheitsart</span>
                  <span>Verhalten bei Konflikt</span>
                </div>
                {['Urlaub', 'Krank', 'Frei', 'Dienstreise', 'Nicht verfügbar'].map((type) => (
                  <div
                    key={type}
                    className="flex items-center justify-between p-3 bg-white rounded-lg border border-slate-200 shadow-sm"
                  >
                    <div className="font-medium text-slate-900 text-sm">{type}</div>
                    <div className="flex items-center gap-3">
                      <div
                        className={`text-xs font-medium flex items-center gap-1 w-24 justify-end ${absenceRules[type] ? 'text-red-600' : 'text-amber-600'}`}
                      >
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
        </Tabs>

        <DialogFooter>
          <Button variant="ghost" onClick={() => setIsOpen(false)}>
            Schließen
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
