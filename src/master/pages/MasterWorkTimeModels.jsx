import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import {
  Timer, Plus, Pencil, Trash2, Loader2, Clock, Users, Check,
} from 'lucide-react';

const EMPTY_MODEL = { name: '', hours_per_week: '', hours_per_day: '', is_default: false, description: '' };

export default function MasterWorkTimeModels() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingModel, setEditingModel] = useState(null);
  const [form, setForm] = useState(EMPTY_MODEL);

  const { data: models = [], isLoading } = useQuery({
    queryKey: ['master-work-time-models'],
    queryFn: () => api.request('/api/master/work-time-models'),
  });

  const saveMutation = useMutation({
    mutationFn: (data) => {
      if (editingModel) {
        return api.request(`/api/master/work-time-models/${editingModel.id}`, {
          method: 'PUT',
          body: JSON.stringify(data),
        });
      }
      return api.request('/api/master/work-time-models', {
        method: 'POST',
        body: JSON.stringify(data),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['master-work-time-models'] });
      closeDialog();
      toast({ title: 'Gespeichert', description: editingModel ? 'Modell aktualisiert.' : 'Neues Modell erstellt.' });
    },
    onError: (err) => {
      toast({ title: 'Fehler', description: err.message || 'Speichern fehlgeschlagen.', variant: 'destructive' });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => api.request(`/api/master/work-time-models/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['master-work-time-models'] });
      toast({ title: 'Gelöscht', description: 'Arbeitszeitmodell wurde entfernt.' });
    },
    onError: (err) => {
      toast({ title: 'Fehler', description: err.message || 'Löschen fehlgeschlagen. Möglicherweise wird das Modell noch verwendet.', variant: 'destructive' });
    },
  });

  const openCreate = () => {
    setEditingModel(null);
    setForm(EMPTY_MODEL);
    setDialogOpen(true);
  };

  const openEdit = (model) => {
    setEditingModel(model);
    setForm({
      name: model.name || '',
      hours_per_week: model.hours_per_week ?? '',
      hours_per_day: model.hours_per_day ?? '',
      is_default: model.is_default ?? false,
      description: model.description || '',
    });
    setDialogOpen(true);
  };

  const closeDialog = () => {
    setDialogOpen(false);
    setEditingModel(null);
    setForm(EMPTY_MODEL);
  };

  const handleSave = () => {
    if (!form.name.trim()) {
      toast({ title: 'Pflichtfeld', description: 'Bitte geben Sie einen Namen ein.', variant: 'destructive' });
      return;
    }
    saveMutation.mutate({
      ...form,
      hours_per_week: form.hours_per_week !== '' ? parseFloat(form.hours_per_week) : null,
      hours_per_day: form.hours_per_day !== '' ? parseFloat(form.hours_per_day) : null,
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Arbeitszeitmodelle</h1>
          <p className="text-slate-500 mt-1">
            Definieren Sie Arbeitszeitmodelle für Vollzeit, Teilzeit und spezielle Regelungen
          </p>
        </div>
        <Button onClick={openCreate} size="sm">
          <Plus className="w-4 h-4 mr-2" />
          Neues Modell
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Timer className="w-5 h-5" />
            Definierte Modelle
          </CardTitle>
          <CardDescription>
            Modelle können Mitarbeitern und Schichtzeit-Regeln zugewiesen werden
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-16 text-slate-400">
              <Loader2 className="w-5 h-5 animate-spin mr-2" />
              Wird geladen…
            </div>
          ) : models.length === 0 ? (
            <div className="text-center py-16 text-slate-400">
              <Timer className="w-12 h-12 mx-auto mb-3 opacity-20" />
              <p className="font-medium">Keine Arbeitszeitmodelle vorhanden</p>
              <p className="text-sm mt-1">Erstellen Sie ein erstes Modell.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead className="text-right">Stunden / Woche</TableHead>
                  <TableHead className="text-right">Stunden / Tag</TableHead>
                  <TableHead>Standard</TableHead>
                  <TableHead>Beschreibung</TableHead>
                  <TableHead className="w-24" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {models.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell className="font-medium">{m.name}</TableCell>
                    <TableCell className="text-right text-sm">
                      <div className="flex items-center justify-end gap-1.5">
                        <Clock className="w-3.5 h-3.5 text-slate-400" />
                        {m.hours_per_week ?? '–'}
                      </div>
                    </TableCell>
                    <TableCell className="text-right text-sm">{m.hours_per_day ?? '–'}</TableCell>
                    <TableCell>
                      {m.is_default ? (
                        <Badge variant="default" className="text-[10px]">
                          <Check className="w-3 h-3 mr-0.5" /> Standard
                        </Badge>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-sm text-slate-500 max-w-[200px] truncate">
                      {m.description || '–'}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(m)}>
                          <Pencil className="w-3.5 h-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-red-500 hover:text-red-700"
                          onClick={() => deleteMutation.mutate(m.id)}
                          disabled={deleteMutation.isPending}>
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Erstellen / Bearbeiten Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingModel ? 'Modell bearbeiten' : 'Neues Arbeitszeitmodell'}</DialogTitle>
            <DialogDescription>
              {editingModel ? 'Aktualisieren Sie die Modelldaten.' : 'Definieren Sie ein neues Arbeitszeitmodell.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label className="text-sm">Name *</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="z.B. Vollzeit 39h" className="mt-1" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="text-sm">Stunden / Woche</Label>
                <Input type="number" step="0.5" min="0" max="60"
                  value={form.hours_per_week}
                  onChange={(e) => setForm({ ...form, hours_per_week: e.target.value })}
                  placeholder="39" className="mt-1" />
              </div>
              <div>
                <Label className="text-sm">Stunden / Tag</Label>
                <Input type="number" step="0.25" min="0" max="12"
                  value={form.hours_per_day}
                  onChange={(e) => setForm({ ...form, hours_per_day: e.target.value })}
                  placeholder="7.8" className="mt-1" />
              </div>
            </div>
            <div>
              <Label className="text-sm">Beschreibung</Label>
              <Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="Optionale Beschreibung…" className="mt-1" />
            </div>
            <div className="flex items-center gap-3">
              <Switch checked={form.is_default} onCheckedChange={(v) => setForm({ ...form, is_default: v })} />
              <Label className="text-sm">Als Standard-Modell markieren</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeDialog}>Abbrechen</Button>
            <Button onClick={handleSave} disabled={saveMutation.isPending}>
              {saveMutation.isPending && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
              {editingModel ? 'Aktualisieren' : 'Erstellen'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
