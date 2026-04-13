import React, { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { db, api } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, Trash2, Save, Clock, AlertTriangle, Pencil, X } from 'lucide-react';
import { toast } from 'sonner';

export default function ShiftTimeRuleManager({ isReadOnly = false }) {
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState({ label: '', workplace_id: '', work_time_model_id: '', start_time: '07:00', end_time: '15:12', break_minutes: 0 });

  // Arbeitsplätze
  const { data: workplaces = [] } = useQuery({
    queryKey: ['workplaces'],
    queryFn: () => db.Workplace.list(null, 1000),
    staleTime: 5 * 60 * 1000,
  });

  // Arbeitszeitmodelle aus Master-DB
  const { data: workTimeModels = [] } = useQuery({
    queryKey: ['workTimeModels'],
    queryFn: async () => {
      try {
        const res = await api.request('/api/staff/work-time-models');
        return res.models || [];
      } catch { return []; }
    },
    staleTime: 30 * 60 * 1000,
  });

  // Bestehende ShiftTimeRules
  const { data: rules = [] } = useQuery({
    queryKey: ['shiftTimeRules'],
    queryFn: () => db.ShiftTimeRule.list(null, 5000),
    staleTime: 2 * 60 * 1000,
  });

  // Lookups
  const workplaceMap = useMemo(() => new Map(workplaces.map(w => [w.id, w])), [workplaces]);
  const modelMap = useMemo(() => new Map(workTimeModels.map(m => [m.id, m])), [workTimeModels]);
  const existingLabels = useMemo(() => rules.map(r => (r.label || '').trim().toLowerCase()), [rules]);

  const createMutation = useMutation({
    mutationFn: (data) => db.ShiftTimeRule.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries(['shiftTimeRules']);
      toast.success('Dienstmodell angelegt');
      resetForm();
    },
    onError: (e) => toast.error(`Fehler: ${e.message}`),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => db.ShiftTimeRule.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries(['shiftTimeRules']);
      toast.success('Dienstmodell aktualisiert');
      resetForm();
    },
    onError: (e) => toast.error(`Fehler: ${e.message}`),
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => db.ShiftTimeRule.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries(['shiftTimeRules']);
      toast.success('Dienstmodell gelöscht');
    },
    onError: (e) => toast.error(`Fehler: ${e.message}`),
  });

  const resetForm = () => {
    setAdding(false);
    setEditingId(null);
    setForm({ label: '', workplace_id: '', work_time_model_id: '', start_time: '07:00', end_time: '15:12', break_minutes: 0 });
  };

  const startEdit = (rule) => {
    setAdding(false);
    setEditingId(rule.id);
    setForm({
      label: rule.label || '',
      workplace_id: rule.workplace_id || '',
      work_time_model_id: rule.work_time_model_id || '',
      start_time: rule.start_time?.substring(0, 5) || '07:00',
      end_time: rule.end_time?.substring(0, 5) || '15:12',
      break_minutes: rule.break_minutes || 0,
    });
  };

  const startAdd = () => {
    setEditingId(null);
    setAdding(true);
    setForm({ label: '', workplace_id: '', work_time_model_id: '', start_time: '07:00', end_time: '15:12', break_minutes: 0 });
  };

  const validateAndSave = () => {
    const trimmedLabel = form.label.trim();
    if (!trimmedLabel) {
      toast.error('Bitte eine Bezeichnung eingeben.');
      return;
    }
    if (!form.workplace_id) {
      toast.error('Bitte einen Arbeitsplatz auswählen.');
      return;
    }
    if (!form.work_time_model_id) {
      toast.error('Bitte ein Arbeitszeitmodell auswählen.');
      return;
    }
    if (!form.start_time || !form.end_time) {
      toast.error('Bitte Start- und Endzeit eingeben.');
      return;
    }

    // Bezeichnung doppelt?
    const editingRule = editingId ? rules.find(r => r.id === editingId) : null;
    const isDuplicate = rules.some(r =>
      r.id !== editingId && (r.label || '').trim().toLowerCase() === trimmedLabel.toLowerCase()
    );
    if (isDuplicate) {
      toast.error(`Die Bezeichnung "${trimmedLabel}" ist bereits vergeben.`);
      return;
    }

    // spans_midnight berechnen
    const [sh, sm] = form.start_time.split(':').map(Number);
    const [eh, em] = form.end_time.split(':').map(Number);
    const spansMidnight = (eh * 60 + em) <= (sh * 60 + sm);

    const payload = {
      label: trimmedLabel,
      workplace_id: form.workplace_id,
      work_time_model_id: form.work_time_model_id,
      start_time: form.start_time + ':00',
      end_time: form.end_time + ':00',
      break_minutes: parseInt(form.break_minutes) || 0,
      spans_midnight: spansMidnight,
    };

    if (editingId) {
      updateMutation.mutate({ id: editingId, data: payload });
    } else {
      createMutation.mutate({
        id: globalThis.crypto?.randomUUID?.() || `str-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        ...payload,
      });
    }
  };

  const formatTime = (t) => t?.substring(0, 5) || '–';

  const calcHours = (rule) => {
    if (!rule?.start_time || !rule?.end_time) return null;
    const [sh, sm] = rule.start_time.split(':').map(Number);
    const [eh, em] = rule.end_time.split(':').map(Number);
    let mins = (eh * 60 + em) - (sh * 60 + sm);
    if (mins < 0) mins += 24 * 60;
    mins -= (rule.break_minutes || 0);
    return (mins / 60).toFixed(1);
  };

  const sortedRules = useMemo(() =>
    [...rules].sort((a, b) => (a.label || '').localeCompare(b.label || '')),
    [rules]
  );

  const FormRow = ({ isNew }) => (
    <tr className="bg-indigo-50/50 border-b border-slate-200">
      <td className="py-2 px-3">
        <Input
          value={form.label}
          onChange={e => setForm({ ...form, label: e.target.value })}
          placeholder="z.B. Frühdienst CT"
          className="h-8 text-sm"
          autoFocus
        />
      </td>
      <td className="py-2 px-3">
        <Select value={form.workplace_id} onValueChange={v => setForm({ ...form, workplace_id: v })}>
          <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="Wählen…" /></SelectTrigger>
          <SelectContent>
            {workplaces.map(w => (
              <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </td>
      <td className="py-2 px-3">
        <Select value={form.work_time_model_id} onValueChange={v => setForm({ ...form, work_time_model_id: v })}>
          <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="Wählen…" /></SelectTrigger>
          <SelectContent>
            {workTimeModels.map(m => (
              <SelectItem key={m.id} value={m.id}>{m.name} ({m.hours_per_week}h)</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </td>
      <td className="py-2 px-3">
        <Input type="time" value={form.start_time}
          onChange={e => setForm({ ...form, start_time: e.target.value })}
          className="h-8 text-sm w-28" />
      </td>
      <td className="py-2 px-3">
        <Input type="time" value={form.end_time}
          onChange={e => setForm({ ...form, end_time: e.target.value })}
          className="h-8 text-sm w-28" />
      </td>
      <td className="py-2 px-3">
        <Input type="number" value={form.break_minutes} min={0} max={120}
          onChange={e => setForm({ ...form, break_minutes: e.target.value })}
          className="h-8 text-sm w-20" />
      </td>
      <td className="py-2 px-3 text-center text-slate-400">–</td>
      <td className="py-2 px-3">
        <div className="flex gap-1">
          <Button size="sm" className="h-7 px-2 text-xs" onClick={validateAndSave}
            disabled={createMutation.isPending || updateMutation.isPending}>
            <Save size={12} className="mr-1" />{isNew ? 'Anlegen' : 'Speichern'}
          </Button>
          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={resetForm}>
            <X size={12} />
          </Button>
        </div>
      </td>
    </tr>
  );

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-lg flex items-center gap-2">
                <Clock size={18} />
                Dienstmodelle
              </CardTitle>
              <p className="text-sm text-slate-500 mt-1">
                Definieren Sie Arbeitszeiten pro Bezeichnung, Arbeitsplatz und Arbeitszeitmodell.
              </p>
            </div>
            {!isReadOnly && !adding && !editingId && (
              <Button size="sm" onClick={startAdd}>
                <Plus size={14} className="mr-1" />Neues Dienstmodell
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-slate-50 border-y border-slate-200">
                  <th className="text-left py-2 px-3 font-medium text-slate-700 min-w-[160px]">Bezeichnung</th>
                  <th className="text-left py-2 px-3 font-medium text-slate-700 min-w-[150px]">Arbeitsplatz</th>
                  <th className="text-left py-2 px-3 font-medium text-slate-700 min-w-[150px]">AZ-Modell</th>
                  <th className="text-left py-2 px-3 font-medium text-slate-700 w-28">Von</th>
                  <th className="text-left py-2 px-3 font-medium text-slate-700 w-28">Bis</th>
                  <th className="text-left py-2 px-3 font-medium text-slate-700 w-20">Pause</th>
                  <th className="text-center py-2 px-3 font-medium text-slate-700 w-16">Std.</th>
                  <th className="text-left py-2 px-3 font-medium text-slate-700 w-28"></th>
                </tr>
              </thead>
              <tbody>
                {/* Neues Dienstmodell (Formular oben) */}
                {adding && <FormRow isNew />}

                {sortedRules.length === 0 && !adding ? (
                  <tr>
                    <td colSpan={8} className="text-center py-8 text-slate-400">
                      Noch keine Dienstmodelle definiert.
                    </td>
                  </tr>
                ) : null}

                {sortedRules.map(rule => {
                  if (editingId === rule.id) {
                    return <FormRow key={rule.id} isNew={false} />;
                  }

                  const wp = workplaceMap.get(rule.workplace_id);
                  const model = modelMap.get(rule.work_time_model_id);

                  return (
                    <tr key={rule.id} className="border-b border-slate-100 hover:bg-slate-50/50">
                      <td className="py-2 px-3 font-medium text-slate-800">{rule.label || '–'}</td>
                      <td className="py-2 px-3 text-slate-600">{wp?.name || rule.workplace_id}</td>
                      <td className="py-2 px-3 text-slate-600">
                        {model ? `${model.name} (${model.hours_per_week}h)` : rule.work_time_model_id}
                      </td>
                      <td className="py-2 px-3 font-mono text-slate-700">{formatTime(rule.start_time)}</td>
                      <td className="py-2 px-3 font-mono text-slate-700">{formatTime(rule.end_time)}</td>
                      <td className="py-2 px-3 text-slate-600">{rule.break_minutes || 0} Min</td>
                      <td className="py-2 px-3 text-center text-slate-600">{calcHours(rule)}h</td>
                      <td className="py-2 px-3">
                        {!isReadOnly && (
                          <div className="flex gap-1">
                            <Button size="sm" variant="ghost" className="h-7 w-7 p-0"
                              onClick={() => startEdit(rule)} title="Bearbeiten">
                              <Pencil size={13} />
                            </Button>
                            <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-red-500 hover:text-red-700"
                              onClick={() => { if (confirm('Dienstmodell wirklich löschen?')) deleteMutation.mutate(rule.id); }}
                              title="Löschen">
                              <Trash2 size={13} />
                            </Button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
