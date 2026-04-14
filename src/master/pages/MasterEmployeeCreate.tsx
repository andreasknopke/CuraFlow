import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import { api } from '@/api/client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/use-toast';
import type { LucideIcon } from 'lucide-react';
import {
  ArrowLeft,
  User,
  Save,
  Loader2,
  Hash,
  Mail,
  Phone,
  MapPin,
  CalendarDays,
  Clock,
  FileText,
} from 'lucide-react';

interface WorkTimeModel {
  id: string;
  name: string;
  hours_per_week: number;
  [key: string]: unknown;
}

interface EmployeeForm {
  last_name: string;
  first_name: string;
  former_name: string;
  payroll_id: string;
  date_of_birth: string;
  email: string;
  phone: string;
  address: string;
  contract_type: string;
  contract_start: string;
  target_hours_per_week: string;
  vacation_days_annual: string;
  work_time_model_id: string;
  notes: string;
}

interface CreateEmployeePayload {
  [key: string]: string | number;
}

interface CreateEmployeeResult {
  id: string;
  [key: string]: unknown;
}

export default function MasterEmployeeCreate() {
  const navigate = useNavigate();
  const { toast } = useToast();

  const [form, setForm] = useState<EmployeeForm>({
    last_name: '',
    first_name: '',
    former_name: '',
    payroll_id: '',
    date_of_birth: '',
    email: '',
    phone: '',
    address: '',
    contract_type: '',
    contract_start: '',
    target_hours_per_week: '',
    vacation_days_annual: '30',
    work_time_model_id: '',
    notes: '',
  });

  const { data: models = [] } = useQuery<WorkTimeModel[]>({
    queryKey: ['master-work-time-models'],
    queryFn: async () => {
      const res = await api.request('/api/master/work-time-models');
      return res.models || [];
    },
  });

  const createMutation = useMutation<CreateEmployeeResult, Error, CreateEmployeePayload>({
    mutationFn: (data) =>
      api.request('/api/master/employees', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    onSuccess: (result) => {
      toast({ title: 'Angelegt', description: 'Neuer Mitarbeiter wurde erstellt.' });
      navigate(`/mitarbeiter/central/${result.id}`);
    },
    onError: (err) => {
      toast({
        title: 'Fehler',
        description: err.message || 'Erstellen fehlgeschlagen.',
        variant: 'destructive',
      });
    },
  });

  const handleSave = () => {
    if (!form.last_name.trim()) {
      toast({
        title: 'Pflichtfeld',
        description: 'Nachname ist erforderlich.',
        variant: 'destructive',
      });
      return;
    }
    const payload: CreateEmployeePayload = { ...form };
    if (payload.target_hours_per_week !== '') {
      payload.target_hours_per_week = parseFloat(payload.target_hours_per_week as string);
    }
    if (payload.vacation_days_annual !== '') {
      payload.vacation_days_annual = parseInt(payload.vacation_days_annual as string, 10);
    }
    createMutation.mutate(payload);
  };

  const updateField = (key: keyof EmployeeForm, value: string) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" onClick={() => navigate('/mitarbeiter')}>
        <ArrowLeft className="w-4 h-4 mr-2" /> Mitarbeiterübersicht
      </Button>

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Neuer Mitarbeiter</h1>
          <p className="text-slate-500 mt-1">Zentralen Mitarbeitereintrag anlegen</p>
        </div>
        <Button onClick={handleSave} disabled={createMutation.isPending}>
          {createMutation.isPending ? (
            <Loader2 className="w-4 h-4 animate-spin mr-2" />
          ) : (
            <Save className="w-4 h-4 mr-2" />
          )}
          Anlegen
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Persönliche Daten</CardTitle>
          <CardDescription>Grundlegende Informationen zum Mitarbeiter</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Field
              label="Nachname *"
              icon={User}
              value={form.last_name}
              onChange={(v) => updateField('last_name', v)}
            />
            <Field
              label="Vorname"
              icon={User}
              value={form.first_name}
              onChange={(v) => updateField('first_name', v)}
            />
            <Field
              label="Geburtsname"
              icon={User}
              value={form.former_name}
              onChange={(v) => updateField('former_name', v)}
            />
          </div>
          <Separator />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field
              label="Personalnummer"
              icon={Hash}
              value={form.payroll_id}
              onChange={(v) => updateField('payroll_id', v)}
            />
            <Field
              label="Geburtsdatum"
              icon={CalendarDays}
              value={form.date_of_birth}
              type="date"
              onChange={(v) => updateField('date_of_birth', v)}
            />
          </div>
          <Separator />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field
              label="E-Mail"
              icon={Mail}
              value={form.email}
              type="email"
              onChange={(v) => updateField('email', v)}
            />
            <Field
              label="Telefon"
              icon={Phone}
              value={form.phone}
              onChange={(v) => updateField('phone', v)}
            />
          </div>
          <Field
            label="Adresse"
            icon={MapPin}
            value={form.address}
            onChange={(v) => updateField('address', v)}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Vertragsdaten</CardTitle>
          <CardDescription>Arbeitsvertrag und Arbeitszeitmodell</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label className="text-xs text-slate-500 mb-1 block">Vertragsart</Label>
              <Select
                value={form.contract_type}
                onValueChange={(v) => updateField('contract_type', v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Wählen…" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="unbefristet">Unbefristet</SelectItem>
                  <SelectItem value="befristet">Befristet</SelectItem>
                  <SelectItem value="teilzeit">Teilzeit</SelectItem>
                  <SelectItem value="minijob">Minijob</SelectItem>
                  <SelectItem value="werkstudent">Werkstudent</SelectItem>
                  <SelectItem value="praktikum">Praktikum</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs text-slate-500 mb-1 block">Arbeitszeitmodell</Label>
              <Select
                value={form.work_time_model_id}
                onValueChange={(v) => updateField('work_time_model_id', v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Modell wählen…" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">Kein Modell</SelectItem>
                  {models.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.name} ({m.hours_per_week}h/W)
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <Separator />
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Field
              label="Vertragsbeginn"
              icon={CalendarDays}
              value={form.contract_start}
              type="date"
              onChange={(v) => updateField('contract_start', v)}
            />
            <Field
              label="Wochenstunden (Soll)"
              icon={Clock}
              value={form.target_hours_per_week}
              type="number"
              onChange={(v) => updateField('target_hours_per_week', v)}
            />
            <Field
              label="Urlaubstage / Jahr"
              icon={CalendarDays}
              value={form.vacation_days_annual}
              type="number"
              onChange={(v) => updateField('vacation_days_annual', v)}
            />
          </div>
          <Separator />
          <div>
            <Label className="text-xs text-slate-500 mb-1 block">Notizen</Label>
            <Textarea
              value={form.notes}
              onChange={(e) => updateField('notes', e.target.value)}
              placeholder="Interne Notizen…"
              rows={3}
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

interface FieldProps {
  label: string;
  icon?: LucideIcon;
  value: string;
  type?: string;
  onChange?: (value: string) => void;
}

function Field({ label, icon: Icon, value, type = 'text', onChange }: FieldProps) {
  return (
    <div>
      <Label className="text-xs text-slate-500 mb-1 flex items-center gap-1.5">
        {Icon && <Icon className="w-3.5 h-3.5" />}
        {label}
      </Label>
      <Input
        type={type}
        value={value ?? ''}
        onChange={(e) => onChange?.(e.target.value)}
        className="h-9"
      />
    </div>
  );
}
