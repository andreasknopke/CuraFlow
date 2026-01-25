import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { useTeamRoles, DEFAULT_TEAM_ROLES } from "@/components/settings/TeamRoleSettings";

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

export default function DoctorForm({ open, onOpenChange, doctor, onSubmit }) {
  // Dynamisch Rollen aus DB laden
  const { roleNames, isLoading: rolesLoading } = useTeamRoles();
  const availableRoles = roleNames.length > 0 ? roleNames : FALLBACK_ROLES;
  
  // Default-Rolle (letzte in der Liste, typischerweise niedrigste Priorität)
  const defaultRole = availableRoles[availableRoles.length - 1] || "Assistenzarzt";

  const [formData, setFormData] = useState(
    doctor || {
      name: "",
      initials: "",
      role: defaultRole,
      google_email: "",
    }
  );

  useEffect(() => {
    if (doctor) {
      setFormData(doctor);
    } else if (open) {
      // Nur zurücksetzen wenn Dialog geöffnet wird UND kein doctor
      setFormData({
        name: "",
        initials: "",
        role: defaultRole,
        google_email: "",
        fte: 1.0,
        contract_end_date: "",
        exclude_from_staffing_plan: false,
      });
    }
  }, [doctor, open]); // availableRoles entfernt - wird nur beim Öffnen benötigt

  const handleSubmit = (e) => {
    e.preventDefault();
    // Ensure fte is a number
    const dataToSubmit = {
        ...formData,
        fte: parseFloat(formData.fte) || 1.0
    };
    onSubmit(dataToSubmit);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>{doctor ? "Teammitglied bearbeiten" : "Neues Teammitglied hinzufügen"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
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
                value={formData.initials}
                onChange={(e) => setFormData({ ...formData, initials: e.target.value })}
                required
                maxLength={5}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="role">Funktion</Label>
              <Select
                value={formData.role}
                onValueChange={(value) => setFormData({ ...formData, role: value })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {availableRoles.map((role) => (
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
            <Input
              id="email"
              type="email"
              value={formData.email || ''}
              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              placeholder="name@klinik.de"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="google_email">Google Email (für Kalender-Sync)</Label>
            <Input
              id="google_email"
              type="email"
              value={formData.google_email || ''}
              onChange={(e) => setFormData({ ...formData, google_email: e.target.value })}
              placeholder="arzt@gmail.com"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
                <Label htmlFor="fte">Stellenanteil (1.0 = Vollzeit)</Label>
                <Input
                    id="fte"
                    type="number"
                    step="0.01"
                    min="0"
                    max="1"
                    value={formData.fte !== undefined ? formData.fte : 1.0}
                    onChange={(e) => setFormData({ ...formData, fte: e.target.value })}
                />
            </div>
            <div className="grid gap-2">
                <Label htmlFor="contract_end_date">Befristet bis (Optional)</Label>
                <Input
                    id="contract_end_date"
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
          



          <DialogFooter>
            <Button type="submit">Speichern</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}