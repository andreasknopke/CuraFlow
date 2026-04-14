import React, { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { db, api } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Plus, Trash2, Save, Clock, Pencil, X, ChevronDown, ChevronUp } from 'lucide-react';
import { toast } from 'sonner';

interface ShiftTimeRuleManagerProps {
  isReadOnly?: boolean;
}

interface Workplace {
  id: string;
  name: string;
  category?: string;
  order?: number;
}

interface WorkTimeModel {
  id: string;
  name: string;
  hours_per_week: number;
}

interface ShiftTimeRule {
  id: string;
  short_code?: string;
  label?: string;
  workplace_id: string;
  work_time_model_id: string;
  start_time?: string;
  end_time?: string;
  break_minutes?: number;
  spans_midnight?: boolean;
}

interface ModelGroup {
  code: string;
  short_code: string;
  label: string;
  workplace_id: string;
  entries: ShiftTimeRule[];
}

interface ModelFormData {
  short_code: string;
  label: string;
  workplace_id: string;
}

interface TimeFormData {
  work_time_model_id: string;
  start_time: string;
  end_time: string;
  break_minutes: number | string;
}

interface PendingModel {
  short_code: string;
  label: string;
  workplace_id: string;
}

interface ModelCardProps {
  group: ModelGroup;
  isPending: boolean;
  isExpanded: boolean;
  onToggle: () => void;
  workplaceMap: Map<string, Workplace>;
  modelMap: Map<string, WorkTimeModel>;
  workTimeModels: WorkTimeModel[];
  isReadOnly: boolean;
  editingModel: string | null;
  modelForm: ModelFormData;
  setModelForm: React.Dispatch<React.SetStateAction<ModelFormData>>;
  onEditModel: () => void;
  onSaveModel: () => void;
  onCancelEditModel: () => void;
  onDeleteModel: () => void;
  addingTimeFor: string | null;
  editingTimeId: string | null;
  timeForm: TimeFormData;
  setTimeForm: React.Dispatch<React.SetStateAction<TimeFormData>>;
  onStartAddTime: (code: string) => void;
  onStartEditTime: (rule: ShiftTimeRule) => void;
  onSaveTime: (shortCode: string) => void;
  onDeleteTime: (ruleId: string) => void;
  onResetTimeForm: () => void;
  availableModels: WorkTimeModel[];
  formatTime: (t: string | null | undefined) => string;
  calcHours: (rule: ShiftTimeRule) => string | null;
}

/**
 * ShiftTimeRuleManager – Dienstmodell-Verwaltung
 *
 * Ein Dienstmodell (z.B. "Rö6") hat:
 *   - Kürzel (short_code): z.B. "Rö6"
 *   - Beschreibung (label): z.B. "Röntgenraum 6 – Frühdienst"
 *   - Arbeitsplatz (workplace_id)
 *   - Je Arbeitszeitmodell eigene Start-/Endzeiten + Pause
 */
export default function ShiftTimeRuleManager({ isReadOnly = false }: ShiftTimeRuleManagerProps) {
  const queryClient = useQueryClient();
  const [addingModel, setAddingModel] = useState<boolean>(false);
  const [editingModel, setEditingModel] = useState<string | null>(null);
  const [modelForm, setModelForm] = useState<ModelFormData>({
    short_code: '',
    label: '',
    workplace_id: '',
  });
  const [expandedModels, setExpandedModels] = useState<Set<string>>(new Set());
  const [addingTimeFor, setAddingTimeFor] = useState<string | null>(null);
  const [editingTimeId, setEditingTimeId] = useState<string | null>(null);
  const [timeForm, setTimeForm] = useState<TimeFormData>({
    work_time_model_id: '',
    start_time: '07:00',
    end_time: '15:12',
    break_minutes: 0,
  });
  // Pending-Modell: gerade neu angelegt, noch ohne DB-Zeilen
  const [pendingModel, setPendingModel] = useState<PendingModel | null>(null);

  const { data: workplaces = [] } = useQuery<Workplace[]>({
    queryKey: ['workplaces'],
    queryFn: () =>
      (db.Workplace.list as (...args: unknown[]) => Promise<unknown>)(null, 1000) as Promise<
        Workplace[]
      >,
    staleTime: 5 * 60 * 1000,
  });

  const { data: workTimeModels = [] } = useQuery<WorkTimeModel[]>({
    queryKey: ['workTimeModels'],
    queryFn: async () => {
      try {
        const res = (await api.request('/api/staff/work-time-models')) as {
          models?: WorkTimeModel[];
        };
        return res.models || [];
      } catch {
        return [];
      }
    },
    staleTime: 30 * 60 * 1000,
  });

  const { data: rules = [] } = useQuery<ShiftTimeRule[]>({
    queryKey: ['shiftTimeRules'],
    queryFn: () =>
      (db.ShiftTimeRule.list as (...args: unknown[]) => Promise<unknown>)(null, 5000) as Promise<
        ShiftTimeRule[]
      >,
    staleTime: 2 * 60 * 1000,
  });

  const workplaceMap = useMemo(
    () => new Map(workplaces.map((w): [string, Workplace] => [w.id, w])),
    [workplaces],
  );
  const modelMap = useMemo(
    () => new Map(workTimeModels.map((m): [string, WorkTimeModel] => [m.id, m])),
    [workTimeModels],
  );

  // Gruppierung nach short_code
  const groupedModels = useMemo(() => {
    const map = new Map<
      string,
      { short_code: string; label: string; workplace_id: string; entries: ShiftTimeRule[] }
    >();
    for (const r of rules) {
      const code = r.short_code || r.label || r.id;
      if (!map.has(code)) {
        map.set(code, {
          short_code: r.short_code || '',
          label: r.label || '',
          workplace_id: r.workplace_id,
          entries: [],
        });
      }
      map.get(code)!.entries.push(r);
    }
    for (const group of map.values()) {
      group.entries.sort((a, b) => {
        const ma = modelMap.get(a.work_time_model_id);
        const mb = modelMap.get(b.work_time_model_id);
        return Number(mb?.hours_per_week || 0) - Number(ma?.hours_per_week || 0);
      });
    }
    return [...map.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([code, data]) => ({ code, ...data }));
  }, [rules, modelMap]);

  const existingCodes = useMemo(
    () => groupedModels.map((g) => g.short_code.trim().toLowerCase()),
    [groupedModels],
  );

  // ── Dienstmodell Header ──
  const resetModelForm = () => {
    setAddingModel(false);
    setEditingModel(null);
    setModelForm({ short_code: '', label: '', workplace_id: '' });
  };

  const startAddModel = () => {
    setEditingModel(null);
    setAddingModel(true);
    setModelForm({ short_code: '', label: '', workplace_id: '' });
  };

  const startEditModel = (group: ModelGroup) => {
    setAddingModel(false);
    setEditingModel(group.code);
    setModelForm({
      short_code: group.short_code,
      label: group.label,
      workplace_id: group.workplace_id,
    });
  };

  const saveModel = async () => {
    const code = modelForm.short_code.trim();
    if (!code) {
      toast.error('Bitte ein Kürzel eingeben.');
      return;
    }
    if (!modelForm.workplace_id) {
      toast.error('Bitte einen Arbeitsplatz auswählen.');
      return;
    }

    const isDuplicate = existingCodes.some(
      (c) =>
        c === code.toLowerCase() &&
        (addingModel || code.toLowerCase() !== editingModel?.toLowerCase()),
    );
    if (isDuplicate) {
      toast.error(`Das Kürzel "${code}" ist bereits vergeben.`);
      return;
    }

    if (addingModel) {
      setAddingModel(false);
      setPendingModel({
        short_code: code,
        label: modelForm.label.trim(),
        workplace_id: modelForm.workplace_id,
      });
      setExpandedModels((prev) => new Set([...prev, code]));
      setAddingTimeFor(code);
      setTimeForm({
        work_time_model_id: '',
        start_time: '07:00',
        end_time: '15:12',
        break_minutes: 0,
      });
      toast.info('Fügen Sie jetzt Zeiten für die Arbeitszeitmodelle hinzu.');
      return;
    }

    if (editingModel) {
      const group = groupedModels.find((g) => g.code === editingModel);
      if (group) {
        try {
          await Promise.all(
            group.entries.map((entry) =>
              db.ShiftTimeRule.update(entry.id, {
                short_code: code,
                label: modelForm.label.trim(),
                workplace_id: modelForm.workplace_id,
              }),
            ),
          );
          queryClient.invalidateQueries({ queryKey: ['shiftTimeRules'] });
          toast.success('Dienstmodell aktualisiert');
        } catch (e) {
          toast.error(`Fehler: ${(e as Error).message}`);
        }
      }
      resetModelForm();
    }
  };

  const deleteModel = async (group: ModelGroup) => {
    if (!confirm(`Dienstmodell "${group.short_code}" mit allen Zeiteinträgen löschen?`)) return;
    try {
      await Promise.all(group.entries.map((e) => db.ShiftTimeRule.delete(e.id)));
      queryClient.invalidateQueries({ queryKey: ['shiftTimeRules'] });
      toast.success('Dienstmodell gelöscht');
    } catch (e) {
      toast.error(`Fehler: ${(e as Error).message}`);
    }
  };

  // ── Zeiteinträge ──
  const resetTimeForm = () => {
    setAddingTimeFor(null);
    setEditingTimeId(null);
    setTimeForm({
      work_time_model_id: '',
      start_time: '07:00',
      end_time: '15:12',
      break_minutes: 0,
    });
  };

  const startAddTime = (code: string) => {
    setEditingTimeId(null);
    setAddingTimeFor(code);
    setTimeForm({
      work_time_model_id: '',
      start_time: '07:00',
      end_time: '15:12',
      break_minutes: 0,
    });
  };

  const startEditTime = (rule: ShiftTimeRule) => {
    setAddingTimeFor(null);
    setEditingTimeId(rule.id);
    setTimeForm({
      work_time_model_id: rule.work_time_model_id,
      start_time: rule.start_time?.substring(0, 5) || '07:00',
      end_time: rule.end_time?.substring(0, 5) || '15:12',
      break_minutes: rule.break_minutes || 0,
    });
  };

  const saveTime = async (shortCode: string) => {
    if (!timeForm.work_time_model_id) {
      toast.error('Bitte ein Arbeitszeitmodell auswählen.');
      return;
    }
    if (!timeForm.start_time || !timeForm.end_time) {
      toast.error('Bitte Start- und Endzeit eingeben.');
      return;
    }

    const group = groupedModels.find((g) => g.code === shortCode);
    const pm = pendingModel?.short_code === shortCode ? pendingModel : null;
    const existingEntry = group?.entries.find(
      (e) => e.work_time_model_id === timeForm.work_time_model_id,
    );
    if (existingEntry && existingEntry.id !== editingTimeId) {
      toast.error(`Dieses AZ-Modell ist für "${shortCode}" bereits definiert.`);
      return;
    }

    const [sh, sm] = timeForm.start_time.split(':').map(Number);
    const [eh, em] = timeForm.end_time.split(':').map(Number);
    const spansMidnight = eh * 60 + em <= sh * 60 + sm;

    const wpId = group?.workplace_id || pm?.workplace_id || '';
    const lbl = group?.label || pm?.label || '';

    const payload = {
      short_code: shortCode,
      label: lbl,
      workplace_id: wpId,
      work_time_model_id: timeForm.work_time_model_id,
      start_time: timeForm.start_time + ':00',
      end_time: timeForm.end_time + ':00',
      break_minutes: parseInt(timeForm.break_minutes as string) || 0,
      spans_midnight: spansMidnight,
    };

    try {
      if (editingTimeId) {
        await db.ShiftTimeRule.update(editingTimeId, payload);
        toast.success('Zeiteintrag aktualisiert');
      } else {
        await db.ShiftTimeRule.create({
          id:
            globalThis.crypto?.randomUUID?.() ||
            `str-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          ...payload,
        });
        toast.success('Zeiteintrag hinzugefügt');
        if (pm) setPendingModel(null);
      }
      queryClient.invalidateQueries({ queryKey: ['shiftTimeRules'] });
      resetTimeForm();
    } catch (e) {
      toast.error(`Fehler: ${(e as Error).message}`);
    }
  };

  const deleteTime = async (ruleId: string) => {
    try {
      await db.ShiftTimeRule.delete(ruleId);
      queryClient.invalidateQueries({ queryKey: ['shiftTimeRules'] });
      toast.success('Zeiteintrag gelöscht');
    } catch (e) {
      toast.error(`Fehler: ${(e as Error).message}`);
    }
  };

  const toggleExpand = (code: string) => {
    setExpandedModels((prev) => {
      const n = new Set(prev);
      if (n.has(code)) n.delete(code);
      else n.add(code);
      return n;
    });
  };

  const formatTime = (t: string | null | undefined): string => t?.substring(0, 5) || '–';
  const calcHours = (rule: ShiftTimeRule): string | null => {
    if (!rule?.start_time || !rule?.end_time) return null;
    const [sh, sm] = rule.start_time.split(':').map(Number);
    const [eh, em] = rule.end_time.split(':').map(Number);
    let mins = eh * 60 + em - (sh * 60 + sm);
    if (mins < 0) mins += 24 * 60;
    mins -= rule.break_minutes || 0;
    return (mins / 60).toFixed(1);
  };

  const availableModelsFor = (shortCode: string) => {
    const group = groupedModels.find((g) => g.code === shortCode);
    const usedIds = new Set(group?.entries.map((e) => e.work_time_model_id) || []);
    if (editingTimeId) {
      const r = rules.find((r) => r.id === editingTimeId);
      if (r) usedIds.delete(r.work_time_model_id);
    }
    return workTimeModels.filter((m) => !usedIds.has(m.id));
  };

  const cardProps = (group: ModelGroup, isPending: boolean): ModelCardProps => ({
    group,
    isPending,
    isExpanded: expandedModels.has(group.code) || isPending,
    onToggle: () => toggleExpand(group.code),
    workplaceMap,
    modelMap,
    workTimeModels,
    isReadOnly,
    editingModel,
    modelForm,
    setModelForm,
    onEditModel: () => startEditModel(group),
    onSaveModel: saveModel,
    onCancelEditModel: resetModelForm,
    onDeleteModel: () => deleteModel(group),
    addingTimeFor,
    editingTimeId,
    timeForm,
    setTimeForm,
    onStartAddTime: startAddTime,
    onStartEditTime: startEditTime,
    onSaveTime: saveTime,
    onDeleteTime: deleteTime,
    onResetTimeForm: resetTimeForm,
    availableModels: availableModelsFor(group.code),
    formatTime,
    calcHours,
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <Clock size={18} />
            Dienstmodelle
          </h3>
          <p className="text-sm text-slate-500 mt-0.5">
            Jedes Dienstmodell hat ein Kürzel, eine Beschreibung und pro Arbeitszeitmodell eigene
            Zeiten.
          </p>
        </div>
        {!isReadOnly && !addingModel && (
          <Button size="sm" onClick={startAddModel}>
            <Plus size={14} className="mr-1" />
            Neues Dienstmodell
          </Button>
        )}
      </div>

      {addingModel && (
        <Card className="border-indigo-200 bg-indigo-50/30">
          <CardContent className="p-4">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
              <div>
                <label className="text-xs font-medium text-slate-600 mb-1 block">Kürzel *</label>
                <Input
                  value={modelForm.short_code}
                  onChange={(e) => setModelForm({ ...modelForm, short_code: e.target.value })}
                  placeholder="z.B. Rö6"
                  className="h-9"
                  autoFocus
                  maxLength={20}
                />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-600 mb-1 block">
                  Beschreibung
                </label>
                <Input
                  value={modelForm.label}
                  onChange={(e) => setModelForm({ ...modelForm, label: e.target.value })}
                  placeholder="z.B. Röntgenraum 6 – Frühdienst"
                  className="h-9"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-600 mb-1 block">
                  Arbeitsplatz *
                </label>
                <Select
                  value={modelForm.workplace_id}
                  onValueChange={(v) => setModelForm({ ...modelForm, workplace_id: v })}
                >
                  <SelectTrigger className="h-9">
                    <SelectValue placeholder="Wählen…" />
                  </SelectTrigger>
                  <SelectContent>
                    {workplaces.map((w) => (
                      <SelectItem key={w.id} value={w.id}>
                        {w.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex gap-2">
                <Button size="sm" className="h-9" onClick={saveModel}>
                  <Plus size={14} className="mr-1" />
                  Anlegen
                </Button>
                <Button size="sm" variant="ghost" className="h-9" onClick={resetModelForm}>
                  <X size={14} />
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {groupedModels.length === 0 && !addingModel && !pendingModel && (
        <Card>
          <CardContent className="p-8 text-center text-slate-400">
            Noch keine Dienstmodelle definiert.
          </CardContent>
        </Card>
      )}

      {pendingModel && !groupedModels.find((g) => g.code === pendingModel.short_code) && (
        <ModelCard
          key="__pending"
          {...cardProps({ code: pendingModel.short_code, ...pendingModel, entries: [] }, true)}
        />
      )}

      {groupedModels.map((group) => (
        <ModelCard key={group.code} {...cardProps(group, false)} />
      ))}
    </div>
  );
}

function ModelCard({
  group,
  isExpanded,
  onToggle,
  workplaceMap,
  modelMap,
  workTimeModels,
  isReadOnly,
  editingModel,
  modelForm,
  setModelForm,
  onEditModel,
  onSaveModel,
  onCancelEditModel,
  onDeleteModel,
  addingTimeFor,
  editingTimeId,
  timeForm,
  setTimeForm,
  onStartAddTime,
  onStartEditTime,
  onSaveTime,
  onDeleteTime,
  onResetTimeForm,
  availableModels,
  formatTime,
  calcHours,
  isPending,
}: ModelCardProps) {
  const wp = workplaceMap.get(group.workplace_id);
  const isEditingHeader = editingModel === group.code;

  return (
    <Card className={isPending ? 'border-indigo-300 bg-indigo-50/20' : ''}>
      <CardHeader className="py-3 px-4">
        {isEditingHeader ? (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
            <div>
              <label className="text-xs font-medium text-slate-600 mb-1 block">Kürzel *</label>
              <Input
                value={modelForm.short_code}
                onChange={(e) => setModelForm({ ...modelForm, short_code: e.target.value })}
                className="h-9"
                maxLength={20}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-600 mb-1 block">Beschreibung</label>
              <Input
                value={modelForm.label}
                onChange={(e) => setModelForm({ ...modelForm, label: e.target.value })}
                className="h-9"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-600 mb-1 block">
                Arbeitsplatz *
              </label>
              <Select
                value={modelForm.workplace_id}
                onValueChange={(v) => setModelForm({ ...modelForm, workplace_id: v })}
              >
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="Wählen…" />
                </SelectTrigger>
                <SelectContent>
                  {[...workplaceMap.values()].map((w) => (
                    <SelectItem key={w.id} value={w.id}>
                      {w.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex gap-2">
              <Button size="sm" className="h-9" onClick={onSaveModel}>
                <Save size={14} className="mr-1" />
                Speichern
              </Button>
              <Button size="sm" variant="ghost" className="h-9" onClick={onCancelEditModel}>
                <X size={14} />
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between cursor-pointer" onClick={onToggle}>
            <div className="flex items-center gap-3">
              {isExpanded ? (
                <ChevronUp size={16} className="text-slate-400" />
              ) : (
                <ChevronDown size={16} className="text-slate-400" />
              )}
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-bold text-base">{group.short_code || '–'}</span>
                  {group.label && <span className="text-slate-500 text-sm">– {group.label}</span>}
                </div>
                <div className="text-xs text-slate-400">
                  {wp?.name || group.workplace_id} · {group.entries.length}{' '}
                  {group.entries.length === 1 ? 'Zeiteintrag' : 'Zeiteinträge'}
                </div>
              </div>
            </div>
            {!isReadOnly && (
              <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 w-7 p-0"
                  onClick={onEditModel}
                  title="Bearbeiten"
                >
                  <Pencil size={13} />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 w-7 p-0 text-red-500 hover:text-red-700"
                  onClick={onDeleteModel}
                  title="Löschen"
                >
                  <Trash2 size={13} />
                </Button>
              </div>
            )}
          </div>
        )}
      </CardHeader>

      {isExpanded && (
        <CardContent className="pt-0 px-4 pb-4">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-slate-50 border-y border-slate-200">
                <th className="text-left py-1.5 px-3 font-medium text-slate-600 w-[200px]">
                  Arbeitszeitmodell
                </th>
                <th className="text-left py-1.5 px-3 font-medium text-slate-600 w-28">Von</th>
                <th className="text-left py-1.5 px-3 font-medium text-slate-600 w-28">Bis</th>
                <th className="text-left py-1.5 px-3 font-medium text-slate-600 w-20">Pause</th>
                <th className="text-center py-1.5 px-3 font-medium text-slate-600 w-16">Std.</th>
                <th className="w-20"></th>
              </tr>
            </thead>
            <tbody>
              {group.entries.map((entry) => {
                const m = modelMap.get(entry.work_time_model_id);
                if (editingTimeId === entry.id) {
                  return (
                    <tr key={entry.id} className="border-b border-slate-200 bg-indigo-50/50">
                      <td className="py-1.5 px-3">
                        <Select
                          value={timeForm.work_time_model_id}
                          onValueChange={(v) => setTimeForm({ ...timeForm, work_time_model_id: v })}
                        >
                          <SelectTrigger className="h-8 text-sm">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {workTimeModels
                              .filter(
                                (wm) =>
                                  wm.id === entry.work_time_model_id ||
                                  availableModels.some((a) => a.id === wm.id),
                              )
                              .map((wm) => (
                                <SelectItem key={wm.id} value={wm.id}>
                                  {wm.name} ({wm.hours_per_week}h)
                                </SelectItem>
                              ))}
                          </SelectContent>
                        </Select>
                      </td>
                      <td className="py-1.5 px-3">
                        <Input
                          type="time"
                          value={timeForm.start_time}
                          onChange={(e) => setTimeForm({ ...timeForm, start_time: e.target.value })}
                          className="h-8 text-sm w-28"
                        />
                      </td>
                      <td className="py-1.5 px-3">
                        <Input
                          type="time"
                          value={timeForm.end_time}
                          onChange={(e) => setTimeForm({ ...timeForm, end_time: e.target.value })}
                          className="h-8 text-sm w-28"
                        />
                      </td>
                      <td className="py-1.5 px-3">
                        <Input
                          type="number"
                          value={timeForm.break_minutes}
                          min={0}
                          max={120}
                          onChange={(e) =>
                            setTimeForm({ ...timeForm, break_minutes: e.target.value })
                          }
                          className="h-8 text-sm w-20"
                        />
                      </td>
                      <td></td>
                      <td className="py-1.5 px-3">
                        <div className="flex gap-1">
                          <Button
                            size="sm"
                            className="h-7 px-2 text-xs"
                            onClick={() => onSaveTime(group.code)}
                          >
                            <Save size={11} className="mr-0.5" />
                            OK
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 px-1"
                            onClick={onResetTimeForm}
                          >
                            <X size={12} />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                }
                return (
                  <tr key={entry.id} className="border-b border-slate-100 hover:bg-slate-50/50">
                    <td className="py-1.5 px-3 text-slate-700">
                      {m ? `${m.name} (${m.hours_per_week}h)` : entry.work_time_model_id}
                    </td>
                    <td className="py-1.5 px-3 font-mono text-slate-700">
                      {formatTime(entry.start_time)}
                    </td>
                    <td className="py-1.5 px-3 font-mono text-slate-700">
                      {formatTime(entry.end_time)}
                    </td>
                    <td className="py-1.5 px-3 text-slate-600">{entry.break_minutes || 0} Min</td>
                    <td className="py-1.5 px-3 text-center text-slate-600">{calcHours(entry)}h</td>
                    <td className="py-1.5 px-3">
                      {!isReadOnly && (
                        <div className="flex gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-6 w-6 p-0"
                            onClick={() => onStartEditTime(entry)}
                          >
                            <Pencil size={11} />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-6 w-6 p-0 text-red-500"
                            onClick={() => {
                              if (confirm('Zeiteintrag löschen?')) onDeleteTime(entry.id);
                            }}
                          >
                            <Trash2 size={11} />
                          </Button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}

              {addingTimeFor === group.code && (
                <tr className="border-b border-slate-200 bg-indigo-50/50">
                  <td className="py-1.5 px-3">
                    <Select
                      value={timeForm.work_time_model_id}
                      onValueChange={(v) => setTimeForm({ ...timeForm, work_time_model_id: v })}
                    >
                      <SelectTrigger className="h-8 text-sm">
                        <SelectValue placeholder="AZ-Modell wählen…" />
                      </SelectTrigger>
                      <SelectContent>
                        {availableModels.map((wm) => (
                          <SelectItem key={wm.id} value={wm.id}>
                            {wm.name} ({wm.hours_per_week}h)
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </td>
                  <td className="py-1.5 px-3">
                    <Input
                      type="time"
                      value={timeForm.start_time}
                      onChange={(e) => setTimeForm({ ...timeForm, start_time: e.target.value })}
                      className="h-8 text-sm w-28"
                    />
                  </td>
                  <td className="py-1.5 px-3">
                    <Input
                      type="time"
                      value={timeForm.end_time}
                      onChange={(e) => setTimeForm({ ...timeForm, end_time: e.target.value })}
                      className="h-8 text-sm w-28"
                    />
                  </td>
                  <td className="py-1.5 px-3">
                    <Input
                      type="number"
                      value={timeForm.break_minutes}
                      min={0}
                      max={120}
                      onChange={(e) => setTimeForm({ ...timeForm, break_minutes: e.target.value })}
                      className="h-8 text-sm w-20"
                    />
                  </td>
                  <td></td>
                  <td className="py-1.5 px-3">
                    <div className="flex gap-1">
                      <Button
                        size="sm"
                        className="h-7 px-2 text-xs"
                        onClick={() => onSaveTime(group.code)}
                      >
                        <Save size={11} className="mr-0.5" />
                        OK
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-1"
                        onClick={onResetTimeForm}
                      >
                        <X size={12} />
                      </Button>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          {!isReadOnly && addingTimeFor !== group.code && availableModels.length > 0 && (
            <Button
              size="sm"
              variant="outline"
              className="mt-2 text-xs"
              onClick={() => onStartAddTime(group.code)}
            >
              <Plus size={12} className="mr-1" />
              Zeit hinzufügen
            </Button>
          )}
          {availableModels.length === 0 && group.entries.length > 0 && (
            <p className="text-xs text-slate-400 mt-2">Alle Arbeitszeitmodelle sind definiert.</p>
          )}
        </CardContent>
      )}
    </Card>
  );
}
