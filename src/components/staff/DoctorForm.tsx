import React, { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { db, api } from "@/api/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import EmployeeSelect from '@/components/staff/EmployeeSelect';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { useTeamRoles, DEFAULT_TEAM_ROLES } from "@/components/settings/TeamRoleSettings";
import DoctorQualificationEditor from "@/components/staff/DoctorQualificationEditor";
import { toast } from "sonner";
import { Mail, Loader2, Link2, Unlink, Filter } from "lucide-react";
import type { Doctor } from '@/types';

interface CentralEmployee {
  id: string;
  first_name?: string;
  last_name?: string;
  email?: string;
  target_hours_per_week?: number;
  model_hours_per_week?: number;
  work_time_model_name?: string;
  position?: string;
  cost_center?: string;
  cost_center_name?: string;
}

interface DoctorFormData {
  id?: string;
  name: string;
  initials: string;
  role?: string;
  email?: string;
  google_email?: string;
  fte: number;
  target_weekly_hours?: string | number;
  contract_end_date?: string;
  exclude_from_staffing_plan?: boolean;
  central_employee_id?: string;
  part_time_model?: string;
  vacation_days?: number;
  _qualificationIds?: string[];
}

interface DoctorFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  doctor?: (Doctor & { vacation_days?: number; part_time_model?: string }) | null;
  onSubmit: (data: DoctorFormData) => void;
}

// Fallback falls Rollen noch nicht geladen
const FALLBACK_ROLES = DEFAULT_TEAM_ROLES.map(r => r.name);
const COLORS = [
  { label: "Rot (Chef)", value: "bg-red-100 text-red-800" },
  { label: "Blau (Oberarzt)", value: "bg-blue-100 text-blue-800" },
  { label: "Grün (Fachartz)", value: "bg-green-100 text-green-800" },
  { label: "Gelb (Assistenz)", value: "bg-yellow-100 text-yellow-800" },
  { label: "Lila", value: "bg-purple-100 text-purple-800" },
  { label: "Grau", value: "bg-gray-100 text-gray-800" },
];

export function getCentralWeeklyHours(employee: CentralEmployee | undefined, fallbackValue: string | number = ''): string | number {
  if (!employee) {
    return fallbackValue;
  }

  return employee.target_hours_per_week ?? employee.model_hours_per_week ?? fallbackValue;
}

export default function DoctorForm({ open, onOpenChange, doctor, onSubmit }: DoctorFormProps) {
  // Dynamisch Rollen aus DB laden
  const { roleNames, refetch: refetchRoles, isLoading: rolesLoading } = useTeamRoles();
  const availableRoles = roleNames.length > 0 ? roleNames : FALLBACK_ROLES;
  
  // Default-Rolle (letzte in der Liste, typischerweise niedrigste Priorität)
  const defaultRole = availableRoles[availableRoles.length - 1] || "Assistenzarzt";

  // Liste aller existierenden Ärzte für Kürzel-Validierung
  const { data: allDoctors = [] } = useQuery({
    queryKey: ["doctors"],
    queryFn: () => db.Doctor.list(),
  });

  // Zentrale Mitarbeiterliste laden (für Verknüpfung)
  const { data: centralEmployees = [] } = useQuery({
    queryKey: ["central-employees-for-linking"],
    queryFn: async () => {
      try {
        const res = await api.request('/api/staff/central-employees');
        return res.employees || [];
      } catch {
        return [];
      }
    },
  });

  const { data: centralEmployeesMeta = {} } = useQuery({
    queryKey: ["central-employees-meta"],
    queryFn: async () => {
      try {
        const res = await api.request('/api/staff/central-employees');
        return { tenantCostCenters: res.tenantCostCenters || [] };
      } catch {
        return { tenantCostCenters: [] };
      }
    },
  });

  const { tenantCostCenters = [] } = centralEmployeesMeta;

  const [selectedCostCenter, setSelectedCostCenter] = React.useState<string | null>(null);
  const costCenterFilterActive = selectedCostCenter !== null;

  // Gefilterte Liste: nur Mitarbeiter der gewählten Kostenstelle
  const filteredCentralEmployees = React.useMemo(() => {
    if (!costCenterFilterActive) return centralEmployees;
    return centralEmployees.filter((e: CentralEmployee) => e.cost_center === selectedCostCenter);
  }, [centralEmployees, selectedCostCenter, costCenterFilterActive]);

  const [sendingTestMail, setSendingTestMail] = useState(false);
  const [selectedQualIds, setSelectedQualIds] = useState<string[]>([]);

  const [formData, setFormData] = useState<DoctorFormData>(
    doctor || {
      name: "",
      initials: "",
      role: defaultRole,
      google_email: "",
    }
  );

  // Formular-Reset bei Änderung von doctor/open
  useEffect(() => {
    if (doctor) {
      setFormData({
        ...doctor,
        fte: doctor.fte !== undefined ? Math.round(parseFloat(doctor.fte) * 100) / 100 : 1.0,
        target_weekly_hours: doctor.target_weekly_hours || '',
        central_employee_id: doctor.central_employee_id || '',
        part_time_model: (doctor as DoctorFormData).part_time_model || 'reduced_daily',
      });
      setSelectedQualIds([]);
    } else if (open) {
      setFormData({
        name: "",
        initials: "",
        role: defaultRole,
        google_email: "",
        fte: 1.0,
        target_weekly_hours: '',
        contract_end_date: "",
        exclude_from_staffing_plan: false,
        central_employee_id: '',
        part_time_model: 'reduced_daily',
      });
      setSelectedQualIds([]);
    }
  }, [doctor, open]);

  // Effektive Rollenliste: vorhandene + ggf. die aus dem aktuell gewählten
  // zentralen Mitarbeiter, damit der Select immer einen Value anzeigen kann.
  const effectiveRoles = React.useMemo(() => {
    const roles = [...availableRoles];
    if (formData.central_employee_id && formData.role && !roles.some(r => r.toLowerCase() === formData.role!.toLowerCase())) {
      roles.push(formData.role);
    }
    return roles;
  }, [availableRoles, formData.central_employee_id, formData.role]);

  // Wenn formData.role eine noch nicht in roleNames vorhandene Rolle ist,
  // forcieren wir einen neuen key für den Select. Radix Select erkennt
  // den value sonst nicht, wenn die Option beim ersten Mount fehlte.
  const selectRoleKey = formData.role && !roleNames.some(r => r.toLowerCase() === formData.role.toLowerCase())
    ? `role-${formData.role}`
    : 'role-default';

  // Set für bereits asynchron angelegte Rollen (Schutz vor doppelter Anlage)
  const createdRolesRef = React.useRef(new Set<string>());

  // Sobald eine zentrale Verknüpfung mit einer neuen Rolle aktiv ist, lege
  // die Rolle asynchron in der TeamRole-Tabelle an.
  React.useEffect(() => {
    if (doctor) return;
    if (!formData.central_employee_id || !formData.role) return;
    const roleName = formData.role;
    if (!roleName.trim()) return;
    if (createdRolesRef.current.has(roleName)) return;

    if (!roleNames.some(r => r.toLowerCase() === roleName.toLowerCase())) {
      createdRolesRef.current.add(roleName);
      db.TeamRole.create({
        name: roleName,
        priority: roleNames.length,
        is_specialist: false,
        can_do_foreground_duty: true,
        can_do_background_duty: false,
        excluded_from_statistics: false,
        description: `Aus zentraler Mitarbeiterverwaltung übernommen (${roleName})`,
      }).then(() => {
        refetchRoles();
        toast.success(`Funktion „${roleName}" wurde automatisch angelegt.`);
      }).catch((err) => {
        console.error('Fehler beim Anlegen der Funktion:', err);
        toast.error(`Funktion „${roleName}" konnte nicht angelegt werden.`);
      });
    }
  }, [formData.central_employee_id, formData.role]);

  const centralEmployeeOptions = React.useMemo(() => (
    [
      {
        value: '__none__',
        label: 'Nicht verknupft (lokaler Mitarbeiter)',
        triggerLabel: 'Nicht verknupft (lokaler Mitarbeiter)',
        sortLabel: '',
        keywords: ['lokal', 'keine zentrale verknupfung'],
      },
      ...filteredCentralEmployees.map((employee: CentralEmployee) => {
        const fullName = [employee.first_name, employee.last_name].filter(Boolean).join(' ') || employee.last_name;
        const descParts = [];
        if (employee.position) descParts.push(employee.position);
        if (employee.work_time_model_name) descParts.push(employee.work_time_model_name);
        if (employee.cost_center_name) descParts.push(`KST ${employee.cost_center_name}`);
        else if (employee.cost_center) descParts.push(`KST ${employee.cost_center}`);
        return {
          value: employee.id,
          label: fullName,
          triggerLabel: fullName,
          description: descParts.join(' · ') || undefined,
          searchText: [employee.first_name, employee.last_name, employee.position, employee.work_time_model_name, employee.cost_center, employee.cost_center_name].filter(Boolean).join(' '),
          sortLabel: fullName,
        };
      }),
    ]
  ), [filteredCentralEmployees]);

  const handleSendTestMail = async () => {
    const email = formData.email;
    if (!email) {
      toast.error("Bitte zuerst eine E-Mail-Adresse eingeben");
      return;
    }
    setSendingTestMail(true);
    try {
      const result = await api.request('/api/staff/send-test-email', {
        method: 'POST',
        body: JSON.stringify({ to: email }),
      });
      toast.success(result.message || `Testmail an ${email} gesendet`);
    } catch (error: any) {
      toast.error(error.message || "Testmail konnte nicht gesendet werden");
    } finally {
      setSendingTestMail(false);
    }
  };

  const handleToggleQual = (qualId: string) => {
    setSelectedQualIds(prev =>
      prev.includes(qualId) ? prev.filter(id => id !== qualId) : [...prev, qualId]
    );
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    // Kürzel-Validierung: Prüfen ob bereits vergeben
    const trimmedInitials = formData.initials?.trim();
    if (!trimmedInitials) {
      toast.error("Bitte geben Sie ein Kürzel ein");
      return;
    }
    
    // Prüfen ob Kürzel bereits existiert (außer beim aktuellen Arzt bei Bearbeitung)
    const existingDoctor = allDoctors.find(
      d => d.initials?.toLowerCase() === trimmedInitials.toLowerCase() && d.id !== doctor?.id
    );
    
    if (existingDoctor) {
      toast.error(`Das Kürzel "${trimmedInitials}" wird bereits von ${existingDoctor.name} verwendet. Bitte wählen Sie ein anderes Kürzel.`);
      return;
    }
    
    // Ensure fte is a number, rounded to 2 decimal places
    const dataToSubmit = {
        ...formData,
        initials: trimmedInitials,
        fte: Math.round((parseFloat(formData.fte as any) || 1.0) * 100) / 100,
        target_weekly_hours: formData.central_employee_id
          ? undefined  // Zentral verknüpft → nicht lokal überschreiben
          : (formData.target_weekly_hours ? parseFloat(formData.target_weekly_hours as any) : null),
        central_employee_id: formData.central_employee_id || null,
        _qualificationIds: selectedQualIds,  // für Staff.jsx
    };
    onSubmit(dataToSubmit);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex flex-col max-h-[85vh] !gap-0 p-0 sm:max-w-2xl lg:max-w-3xl" data-testid="staff-doctor-form">
        <DialogHeader className="shrink-0 px-6 pt-6 pb-0">
          <DialogTitle>{doctor ? "Teammitglied bearbeiten" : "Neues Teammitglied hinzufügen"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col flex-1 overflow-hidden">
          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">

          {/* Zentrale Verknüpfung bei Neuanlage: zuerst */}
          {!doctor && (
            <div className="border rounded-lg p-4 bg-indigo-50/50 space-y-2">
              <Label className="text-base flex items-center gap-1.5">
                <Link2 className="w-4 h-4" />
                Mit zentralem Mitarbeiter verknüpfen
              </Label>
              <p className="text-xs text-slate-500 -mt-1">
                Daten aus der zentralen Mitarbeiterverwaltung übernehmen. Bei Auswahl werden Name,
                E-Mail, Soll-Stunden und Funktion automatisch ausgefüllt.
              </p>

              {/* Kostenstellen-Filter, wenn der Mandant mit KST verknüpft ist */}
              {tenantCostCenters.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5 pt-1">
                  <Filter className="w-3.5 h-3.5 text-slate-400" />
                  <span className="text-xs text-slate-500 mr-1">Kostenstelle:</span>
                  <button
                    type="button"
                    onClick={() => setSelectedCostCenter(null)}
                    className={`text-xs px-2 py-0.5 rounded-full border transition-colors ${
                      !costCenterFilterActive
                        ? 'bg-indigo-100 text-indigo-700 border-indigo-200 font-medium'
                        : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    Alle
                  </button>
                  {tenantCostCenters.map((cc: { code: string; name: string }) => (
                    <button
                      key={cc.code}
                      type="button"
                      onClick={() => setSelectedCostCenter(cc.code)}
                      className={`text-xs px-2 py-0.5 rounded-full border transition-colors ${
                        selectedCostCenter === cc.code
                          ? 'bg-indigo-100 text-indigo-700 border-indigo-200 font-medium'
                          : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'
                      }`}
                      title={`Nur Mitarbeiter der Kostenstelle ${cc.code} anzeigen`}
                    >
                      {cc.code}{cc.name ? ` – ${cc.name}` : ''}
                    </button>
                  ))}
                  {costCenterFilterActive && (
                    <span className="text-xs text-slate-400 ml-1">
                      ({filteredCentralEmployees.length} Mitarbeiter)
                    </span>
                  )}
                </div>
              )}

              <EmployeeSelect
                value={formData.central_employee_id || '__none__'}
                onValueChange={(value) => {
                  const empId = value === '__none__' ? '' : value;

                  if (!empId) {
                    setFormData(prev => ({
                      ...prev,
                      central_employee_id: '',
                      name: '',
                      initials: '',
                      role: defaultRole,
                      email: '',
                      google_email: '',
                      target_weekly_hours: '',
                    }));
                    return;
                  }

                  const emp = filteredCentralEmployees.find((e: CentralEmployee) => e.id === empId)
                    || centralEmployees.find((e: CentralEmployee) => e.id === empId);
                  if (!emp) return;

                  const fullName = [emp.first_name, emp.last_name].filter(Boolean).join(' ') || '';
                  const roleFromPosition = emp.position?.trim() || '';

                  setFormData({
                    ...formData,
                    central_employee_id: empId,
                    name: fullName,
                    initials: '',
                    email: emp.email || '',
                    google_email: emp.email || '',
                    target_weekly_hours: emp.target_hours_per_week ?? '',
                    ...(roleFromPosition ? { role: roleFromPosition } : {}),
                  });
                }}
                options={centralEmployeeOptions}
                placeholder="Zentralen Mitarbeiter suchen..."
                searchPlaceholder="Name suchen..."
                triggerClassName="bg-white"
              />
            </div>
          )}

          <div className="grid gap-2">
            <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                data-testid="staff-form-name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                required
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label htmlFor="initials">Kürzel</Label>
              <Input
                id="initials"
                data-testid="staff-form-initials"
                value={formData.initials}
                onChange={(e) => setFormData({ ...formData, initials: e.target.value })}
                required
                maxLength={5}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="role">Funktion</Label>
              <Select
                key={selectRoleKey}
                value={formData.role}
                onValueChange={(value) => setFormData({ ...formData, role: value })}
              >
                <SelectTrigger data-testid="staff-form-role-trigger">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {effectiveRoles.map((role) => (
                    <SelectItem key={role} value={role}>
                      {role}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="email">E-Mail (für Benachrichtigungen)</Label>
            <div className="flex gap-2">
              <Input
                id="email"
                data-testid="staff-form-email"
                type="email"
                value={formData.email || ''}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                placeholder="name@klinik.de"
                className="flex-1"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleSendTestMail}
                disabled={!formData.email || sendingTestMail}
                title="Testmail senden"
              >
                {sendingTestMail ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 h-4" />}
              </Button>
            </div>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="google_email">E-Mail (für Kalender / Dienstplan)</Label>
              <Input
                id="google_email"
                data-testid="staff-form-google-email"
                type="email"
                value={formData.google_email || ''}
                onChange={(e) => setFormData({ ...formData, google_email: e.target.value })}
                placeholder="name@klinik.de"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
                <Label htmlFor="fte">Stellenanteil (1.0 = Vollzeit)</Label>
                {doctor ? (
                  <Input
                    id="fte"
                    data-testid="staff-form-fte-readonly"
                    type="number"
                    step="0.01"
                    min="0"
                    max="1"
                    value={formData.fte !== undefined ? formData.fte : 1.0}
                    disabled
                    className="bg-slate-100"
                  />
                ) : (
                  <Input
                    id="fte"
                    data-testid="staff-form-fte"
                    type="number"
                    step="0.01"
                    min="0"
                    max="1"
                    value={formData.fte !== undefined ? formData.fte : 1.0}
                    onChange={(e) => setFormData({ ...formData, fte: e.target.value as any })}
                  />
                )}
            </div>
            <div className="grid gap-2">
                <Label htmlFor="target_weekly_hours">Wochen-h (Soll)</Label>
                {formData.central_employee_id ? (
                  <div>
                    <Input
                      id="target_weekly_hours"
                      data-testid="staff-form-target-hours-readonly"
                      type="number"
                      value={(() => {
                        const emp = centralEmployees.find((e: CentralEmployee) => e.id === formData.central_employee_id);
                        return getCentralWeeklyHours(emp, formData.target_weekly_hours || '');
                      })()}
                      disabled
                      className="bg-slate-100"
                    />
                    <p className="text-[10px] text-slate-400 mt-0.5">Aus Zentrale</p>
                  </div>
                ) : (
                  <Input
                    id="target_weekly_hours"
                    data-testid="staff-form-target-hours"
                    type="number"
                    step="0.5"
                    min="0"
                    max="48"
                    placeholder="z.B. 38.5"
                    value={formData.target_weekly_hours || ''}
                    onChange={(e) => setFormData({ ...formData, target_weekly_hours: e.target.value })}
                  />
                )}
            </div>
          </div>

          <div className="grid gap-2 border rounded-lg p-3 bg-slate-50">
              <Label className="text-base">Arbeitszeitmodell (Teilzeit)</Label>
              <p className="text-xs text-slate-500 -mt-1">
                Wie sollen die reduzierten Stunden verteilt werden?
              </p>
              <div className="flex flex-col sm:flex-row gap-2">
                <label className="flex items-start gap-2 border rounded p-2 cursor-pointer hover:bg-white flex-1"
                  data-testid="staff-form-pt-model-reduced">
                  <input
                    type="radio"
                    name="part_time_model"
                    value="reduced_daily"
                    checked={(formData.part_time_model || 'reduced_daily') === 'reduced_daily'}
                    onChange={(e) => setFormData({ ...formData, part_time_model: e.target.value })}
                    className="mt-0.5"
                  />
                  <div className="text-sm">
                    <div className="font-medium">Täglich reduziert</div>
                    <div className="text-xs text-slate-500">Jeden Tag kürzer arbeiten (z.B. 0,8 → 6,4 h/Tag)</div>
                  </div>
                </label>
                <label className="flex items-start gap-2 border rounded p-2 cursor-pointer hover:bg-white flex-1"
                  data-testid="staff-form-pt-model-full-days">
                  <input
                    type="radio"
                    name="part_time_model"
                    value="full_days_off"
                    checked={formData.part_time_model === 'full_days_off'}
                    onChange={(e) => setFormData({ ...formData, part_time_model: e.target.value })}
                    className="mt-0.5"
                  />
                  <div className="text-sm">
                    <div className="font-medium">Volle Tage mit freien Tagen</div>
                    <div className="text-xs text-slate-500">An Arbeitstagen volle Schicht, ganze Tage frei (z.B. 0,8 → 4 Tage 1,0 + 1 Tag frei)</div>
                  </div>
                </label>
              </div>
            </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
                <Label htmlFor="contract_end_date">Befristet bis (Optional)</Label>
                <Input
                    id="contract_end_date"
                    data-testid="staff-form-contract-end-date"
                    type="date"
                    value={formData.contract_end_date || ''}
                    onChange={(e) => setFormData({ ...formData, contract_end_date: e.target.value })}
                />
            </div>
          </div>

          <div className="flex items-center justify-between border p-3 rounded-lg bg-slate-50">
              <div className="space-y-0.5">
                  <Label htmlFor="exclude_from_staffing_plan" className="text-base">Im Stellenplan ausblenden</Label>
                  <div className="text-xs text-slate-500">
                      Diese Person wird in der Stellenplan-Berechnung ignoriert.
                  </div>
              </div>
              <Switch
                  id="exclude_from_staffing_plan"
                  checked={formData.exclude_from_staffing_plan || false}
                  onCheckedChange={(checked) => setFormData({ ...formData, exclude_from_staffing_plan: checked })}
              />
          </div>
          
          {/* Zentrale Mitarbeiterverknüpfung (nur bei Bearbeitung) */}
          {doctor && (
          <div className="border rounded-lg p-3 bg-slate-50 space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-base flex items-center gap-1.5">
                <Link2 className="w-4 h-4" />
                Zentrale Verknüpfung
              </Label>
              {formData.central_employee_id && (
                <Button type="button" variant="ghost" size="sm" className="h-7 text-xs text-slate-500"
                  onClick={() => setFormData({ ...formData, central_employee_id: '' })}>
                  <Unlink className="w-3 h-3 mr-1" /> Trennen
                </Button>
              )}
            </div>
            <EmployeeSelect
              value={formData.central_employee_id || '__none__'}
              onValueChange={(value) => {
                const empId = value === '__none__' ? '' : value;
                setFormData(prev => {
                  const updated = { ...prev, central_employee_id: empId };
                  if (empId) {
                    const emp = centralEmployees.find((e: CentralEmployee) => e.id === empId);
                    if (emp) {
                      const fullName = [emp.first_name, emp.last_name].filter(Boolean).join(' ');
                      if (fullName && !prev.name) updated.name = fullName;
                      if (emp.email && !prev.email) updated.email = emp.email;
                      if (emp.target_hours_per_week != null) updated.target_weekly_hours = emp.target_hours_per_week;
                    }
                  }
                  return updated;
            });
          }}
          options={centralEmployeeOptions}
          placeholder="Nicht verknüpft (lokaler Mitarbeiter)"
          searchPlaceholder="Zentralen Mitarbeiter suchen..."
          triggerClassName="bg-white"
        />
        <p className="text-[11px] text-slate-400">
          Verknüpfte Mitarbeiter erben Vertragsdaten (Arbeitszeit, Urlaub) aus der Zentrale.
        </p>
      </div>
      )}

      {/* Qualifikations-Zuordnung immer anzeigen */}
          <div className="border rounded-lg p-3 bg-slate-50">
              <DoctorQualificationEditor 
                doctorId={doctor?.id} 
                selectedQualIds={selectedQualIds} 
                onToggle={handleToggleQual} 
              />
          </div>
          </div>

          <DialogFooter className="sticky bottom-0 bg-white border-t shrink-0 px-6 py-4">
            <Button type="submit" data-testid="staff-form-submit">Speichern</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
