import React, { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { db, api } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, Trash2, Save, Clock, AlertTriangle, Info } from 'lucide-react';
import { toast } from 'sonner';

/**
 * ShiftTimeRuleManager - Dienstmodell-Verwaltung
 * 
 * Bildet die Excel-Tabelle "Dienstmodelle MTR" ab:
 * Zeilen = Arbeitsplätze/Positionen (Rö, CT1, MR, S, N...)
 * Spalten = Arbeitszeitmodelle (VZ, 35h, 30h...)
 * Zellen = Start-/Endzeit + Pause
 */
export default function ShiftTimeRuleManager({ isReadOnly = false }) {
  const queryClient = useQueryClient();
  const [editingCell, setEditingCell] = useState(null); // { workplaceId, modelId }
  const [editForm, setEditForm] = useState({ start_time: '', end_time: '', break_minutes: 0, label: '' });
  const [newRow, setNewRow] = useState(null); // workplace_id for adding a new position row

  // Arbeitsplätze (Positionen) laden
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

  // Lookup: workplace_id + model_id → rule
  const ruleMap = useMemo(() => {
    const map = new Map();
    for (const r of rules) {
      map.set(`${r.workplace_id}__${r.work_time_model_id}`, r);
    }
    return map;
  }, [rules]);

  // Welche Workplaces haben mind. eine Rule?
  const workplacesWithRules = useMemo(() => {
    const ids = new Set(rules.map(r => r.workplace_id));
    return workplaces.filter(w => ids.has(w.id)).sort((a, b) => a.name.localeCompare(b.name));
  }, [rules, workplaces]);

  // Alle Workplaces ohne Rule (für "Hinzufügen")
  const workplacesWithoutRules = useMemo(() => {
    const ids = new Set(rules.map(r => r.workplace_id));
    return workplaces.filter(w => !ids.has(w.id)).sort((a, b) => a.name.localeCompare(b.name));
  }, [rules, workplaces]);

  // Modelle sortiert nach Stunden absteigend
  const sortedModels = useMemo(() =>
    [...workTimeModels].sort((a, b) => Number(b.hours_per_week) - Number(a.hours_per_week)),
    [workTimeModels]
  );

  const createMutation = useMutation({
    mutationFn: (data) => db.ShiftTimeRule.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries(['shiftTimeRules']);
      toast.success('Dienstmodell gespeichert');
    },
    onError: (e) => toast.error(`Fehler: ${e.message}`),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => db.ShiftTimeRule.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries(['shiftTimeRules']);
      toast.success('Dienstmodell aktualisiert');
    },
    onError: (e) => toast.error(`Fehler: ${e.message}`),
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => db.ShiftTimeRule.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries(['shiftTimeRules']);
      toast.success('Eintrag gelöscht');
    },
    onError: (e) => toast.error(`Fehler: ${e.message}`),
  });

  const handleCellClick = (workplaceId, modelId) => {
    if (isReadOnly) return;
    const key = `${workplaceId}__${modelId}`;
    const existing = ruleMap.get(key);
    setEditingCell({ workplaceId, modelId });
    setEditForm({
      start_time: existing?.start_time?.substring(0, 5) || '07:00',
      end_time: existing?.end_time?.substring(0, 5) || '15:12',
      break_minutes: existing?.break_minutes || 0,
      label: existing?.label || '',
    });
  };

  const handleSave = () => {
    if (!editingCell) return;
    const { workplaceId, modelId } = editingCell;
    const key = `${workplaceId}__${modelId}`;
    const existing = ruleMap.get(key);

    // Berechne spans_midnight
    const [sh, sm] = editForm.start_time.split(':').map(Number);
    const [eh, em] = editForm.end_time.split(':').map(Number);
    const startMins = sh * 60 + sm;
    const endMins = eh * 60 + em;
    const spansMidnight = endMins <= startMins;

    const payload = {
      start_time: editForm.start_time + ':00',
      end_time: editForm.end_time + ':00',
      break_minutes: parseInt(editForm.break_minutes) || 0,
      label: editForm.label || null,
      spans_midnight: spansMidnight,
    };

    if (existing) {
      updateMutation.mutate({ id: existing.id, data: payload });
    } else {
      createMutation.mutate({
        id: globalThis.crypto?.randomUUID?.() || `str-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        workplace_id: workplaceId,
        work_time_model_id: modelId,
        ...payload,
      });
    }
    setEditingCell(null);
  };

  const handleDelete = (workplaceId, modelId) => {
    const key = `${workplaceId}__${modelId}`;
    const existing = ruleMap.get(key);
    if (existing) {
      deleteMutation.mutate(existing.id);
    }
    if (editingCell?.workplaceId === workplaceId && editingCell?.modelId === modelId) {
      setEditingCell(null);
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

  if (workTimeModels.length === 0) {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="flex items-center gap-2 text-amber-600">
            <AlertTriangle size={16} />
            <span>Keine Arbeitszeitmodelle vorhanden. Bitte zuerst im Master-Frontend Arbeitszeitmodelle anlegen.</span>
          </div>
        </CardContent>
      </Card>
    );
  }

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
                Arbeitszeiten pro Position und Arbeitszeitmodell
              </p>
            </div>
            {!isReadOnly && workplacesWithoutRules.length > 0 && (
              <Select value="" onValueChange={(wpId) => {
                if (wpId && sortedModels.length > 0) {
                  setNewRow(null);
                  handleCellClick(wpId, sortedModels[0].id);
                }
              }}>
                <SelectTrigger className="w-56">
                  <div className="flex items-center gap-1">
                    <Plus size={14} />
                    <span>Position hinzufügen</span>
                  </div>
                </SelectTrigger>
                <SelectContent>
                  {workplacesWithoutRules.map(w => (
                    <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {/* Info-Hinweis */}
          <div className="px-4 pb-3">
            <div className="flex items-start gap-2 text-xs text-slate-500 bg-slate-50 rounded p-2">
              <Info size={13} className="mt-0.5 flex-shrink-0" />
              <span>
                Klicken Sie auf eine Zelle, um Start-/Endzeit und Pause zu definieren.
                Jede Kombination aus Position und Arbeitszeitmodell ergibt ein Dienstmodell.
              </span>
            </div>
          </div>

          {/* Tabelle */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-slate-50 border-y border-slate-200">
                  <th className="text-left py-2 px-3 font-medium text-slate-700 border-r border-slate-200 min-w-[180px] sticky left-0 bg-slate-50 z-10">
                    Position
                  </th>
                  {sortedModels.map(m => (
                    <th key={m.id} className="text-center py-2 px-2 font-medium text-slate-700 border-r border-slate-200 min-w-[130px]">
                      <div>{m.name}</div>
                      <div className="text-[10px] text-slate-400 font-normal">{m.hours_per_week}h/Wo</div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {workplacesWithRules.length === 0 && !editingCell ? (
                  <tr>
                    <td colSpan={sortedModels.length + 1} className="text-center py-8 text-slate-400">
                      Noch keine Dienstmodelle definiert. Fügen Sie eine Position hinzu.
                    </td>
                  </tr>
                ) : null}
                {/* Bestehende Positionen */}
                {workplacesWithRules.map(wp => (
                  <tr key={wp.id} className="border-b border-slate-100 hover:bg-slate-50/50">
                    <td className="py-2 px-3 font-medium text-slate-800 border-r border-slate-200 sticky left-0 bg-white z-10">
                      <div>{wp.name}</div>
                      {wp.time && <div className="text-[10px] text-slate-400">{wp.time} Uhr</div>}
                    </td>
                    {sortedModels.map(m => {
                      const key = `${wp.id}__${m.id}`;
                      const rule = ruleMap.get(key);
                      const isEditing = editingCell?.workplaceId === wp.id && editingCell?.modelId === m.id;

                      if (isEditing) {
                        return (
                          <td key={m.id} className="p-1 border-r border-slate-200 bg-indigo-50">
                            <div className="space-y-1">
                              <div className="flex gap-1">
                                <Input type="time" value={editForm.start_time}
                                  onChange={e => setEditForm({ ...editForm, start_time: e.target.value })}
                                  className="h-7 text-xs px-1" />
                                <Input type="time" value={editForm.end_time}
                                  onChange={e => setEditForm({ ...editForm, end_time: e.target.value })}
                                  className="h-7 text-xs px-1" />
                              </div>
                              <div className="flex gap-1 items-center">
                                <Input type="number" value={editForm.break_minutes} min={0} max={120}
                                  onChange={e => setEditForm({ ...editForm, break_minutes: e.target.value })}
                                  className="h-7 text-xs px-1 w-14" placeholder="P" />
                                <span className="text-[10px] text-slate-400">Min P.</span>
                                <div className="flex-1" />
                                <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-red-500"
                                  onClick={() => setEditingCell(null)}>✕</Button>
                                <Button size="sm" className="h-6 px-2 text-xs" onClick={handleSave}>
                                  <Save size={11} className="mr-0.5" />OK
                                </Button>
                              </div>
                              {rule && (
                                <Button size="sm" variant="ghost" className="h-5 w-full text-[10px] text-red-400 hover:text-red-600"
                                  onClick={() => handleDelete(wp.id, m.id)}>
                                  <Trash2 size={10} className="mr-1" />Löschen
                                </Button>
                              )}
                            </div>
                          </td>
                        );
                      }

                      return (
                        <td key={m.id}
                          className={`py-2 px-2 text-center border-r border-slate-200 ${rule ? 'cursor-pointer hover:bg-indigo-50' : 'cursor-pointer hover:bg-slate-50'}`}
                          onClick={() => handleCellClick(wp.id, m.id)}
                        >
                          {rule ? (
                            <div>
                              <div className="font-mono text-xs">
                                {formatTime(rule.start_time)}–{formatTime(rule.end_time)}
                              </div>
                              <div className="text-[10px] text-slate-400">
                                {calcHours(rule)}h
                                {rule.break_minutes > 0 && ` (${rule.break_minutes}′ P.)`}
                              </div>
                            </div>
                          ) : (
                            <span className="text-slate-300 text-xs">–</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
                {/* Neue Position (wenn gerade per Select hinzugefügt und noch nicht in workplacesWithRules) */}
                {editingCell && !workplacesWithRules.find(w => w.id === editingCell.workplaceId) && (() => {
                  const wp = workplaces.find(w => w.id === editingCell.workplaceId);
                  if (!wp) return null;
                  return (
                    <tr className="border-b border-slate-100 bg-indigo-50/30">
                      <td className="py-2 px-3 font-medium text-indigo-700 border-r border-slate-200 sticky left-0 bg-indigo-50/30 z-10">
                        {wp.name}
                      </td>
                      {sortedModels.map(m => {
                        const isEditing = editingCell.modelId === m.id;
                        if (isEditing) {
                          return (
                            <td key={m.id} className="p-1 border-r border-slate-200 bg-indigo-50">
                              <div className="space-y-1">
                                <div className="flex gap-1">
                                  <Input type="time" value={editForm.start_time}
                                    onChange={e => setEditForm({ ...editForm, start_time: e.target.value })}
                                    className="h-7 text-xs px-1" />
                                  <Input type="time" value={editForm.end_time}
                                    onChange={e => setEditForm({ ...editForm, end_time: e.target.value })}
                                    className="h-7 text-xs px-1" />
                                </div>
                                <div className="flex gap-1 items-center">
                                  <Input type="number" value={editForm.break_minutes} min={0} max={120}
                                    onChange={e => setEditForm({ ...editForm, break_minutes: e.target.value })}
                                    className="h-7 text-xs px-1 w-14" placeholder="P" />
                                  <span className="text-[10px] text-slate-400">Min P.</span>
                                  <div className="flex-1" />
                                  <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-red-500"
                                    onClick={() => setEditingCell(null)}>✕</Button>
                                  <Button size="sm" className="h-6 px-2 text-xs" onClick={handleSave}>
                                    <Save size={11} className="mr-0.5" />OK
                                  </Button>
                                </div>
                              </div>
                            </td>
                          );
                        }
                        return (
                          <td key={m.id}
                            className="py-2 px-2 text-center border-r border-slate-200 cursor-pointer hover:bg-indigo-50"
                            onClick={() => handleCellClick(wp.id, m.id)}
                          >
                            <span className="text-slate-300 text-xs">–</span>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })()}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
