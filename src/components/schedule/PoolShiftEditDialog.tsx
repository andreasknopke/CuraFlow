import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';
import { Loader2, Trash2, AlertCircle } from 'lucide-react';
import { api } from '@/api/client';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { invalidatePoolShiftQueries } from './poolShiftQueries';
import { isWishOnDate } from '@/utils/wishRange';

/**
 * Edit (or create) a single pool shift entry.
 */

interface PoolWorkplace {
  id: string;
  name: string;
  group_id: number | string;
  canWrite?: boolean;
}

interface PoolShift {
  id?: string;
  employee_id?: string;
  billing_tenant_id?: string;
}

interface Violation {
  rule: string;
  message: string;
  rotationPosition?: string;
}

interface PoolShiftEditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workplace: PoolWorkplace | undefined | null;
  date: string | undefined | null;
  shift: PoolShift | undefined | null;
  activeTenantId: string | undefined;
  busyEmployeeIds?: Set<string> | undefined;
}

export default function PoolShiftEditDialog({
    open,
    onOpenChange,
    workplace,
    date,
    shift,
    activeTenantId,
    busyEmployeeIds,
}: PoolShiftEditDialogProps) {
    const queryClient = useQueryClient();
    const isEdit = !!shift;
    const groupId = workplace?.group_id;

    const [employeeId, setEmployeeId] = useState('');
    const [billingTenantId, setBillingTenantId] = useState('');
    const [forceOverride, setForceOverride] = useState(false);
    const [violations, setViolations] = useState<Violation[]>([]);

    // Reset form when dialog opens or target changes
    useEffect(() => {
        if (!open) return;
        setEmployeeId(shift?.employee_id || '');
        setBillingTenantId(shift?.billing_tenant_id || activeTenantId || '');
        setForceOverride(false);
        setViolations([]);
    }, [open, shift, activeTenantId]);

    const staffQuery = useQuery({
        queryKey: ['pool', 'eligible-staff', groupId, workplace?.id],
        queryFn: () => api.getWorkplaceEligibleStaff(groupId as string, workplace!.id) as any,
        enabled: !!open && !!groupId && !!workplace?.id,
        // No staleTime — always fetch fresh data when the dialog opens,
        // so that qualification assignments/changes are reflected immediately
        // without requiring a logout/login cycle.
    });

    const staff = (staffQuery.data as any)?.staff || [];
    const requiredQuals = (staffQuery.data as any)?.required || [];
    const absencesByEmployee = (staffQuery.data as any)?.absences_by_employee || {};

    // Central wishes for this date+workplace so that employees who expressed a
    // Dienstwunsch (green) or Kein-Dienst-Wunsch (red) are highlighted in the
    // staff dropdown — exactly like the tenant-internal ServiceStaffing view.
    const dateStr = date ? String(date).slice(0, 10) : '';
    const { data: centralWishesData } = useQuery({
        queryKey: ['pool', 'central-wishes', dateStr],
        queryFn: () => api.getGroupCentralWishes({ from: dateStr, to: dateStr }) as any,
        enabled: !!open && !!dateStr && !!workplace?.id,
    });
    const centralWishes = (centralWishesData as any)?.wishes || [];

    const wishByEmployeeId = useMemo(() => {
        const map = new Map();
        if (!centralWishes.length) return map;
        for (const w of centralWishes) {
            // Match wishes that apply to this workplace. A no_service wish with
            // a null/shared_workplace_id is treated as global (applies here too).
            const wpMatch = w.shared_workplace_id == null
                || String(w.shared_workplace_id) === String(workplace?.id);
            if (!wpMatch) continue;
            if (!isWishOnDate(w, dateStr)) continue;
            // Prefer service wishes over no_service when both apply.
            const empKey = String(w.employee_id);
            const existing = map.get(empKey);
            if (!existing || (existing.type === 'no_service' && w.type === 'service')) {
                map.set(empKey, w);
            }
        }
        return map;
    }, [centralWishes, workplace?.id, dateStr]);

    // Build busy employee set from the eligible-staff response (absences_by_employee)
    // and merge with the busyEmployeeIds prop (from parent's central-absences query).
    // This ensures absence data is available even before the separate central-absences
    // query completes — both sources are combined.
    const busyFromEligibleStaff = useMemo(() => {
        if (!date || !absencesByEmployee || Object.keys(absencesByEmployee).length === 0) {
            return new Set();
        }
        const busy = new Set();
        const dateStr = String(date).slice(0, 10);
        for (const [empId, absences] of Object.entries(absencesByEmployee as Record<string, any[]>)) {
            for (const a of absences) {
                if (String(a.date).slice(0, 10) === dateStr) {
                    busy.add(String(empId));
                    break;
                }
            }
        }
        return busy;
    }, [date, absencesByEmployee]);

    // Combined busy set: from the direct eligible-staff response + the parent's prop
    const combinedBusyIds = useMemo(() => {
        const combined = new Set();
        for (const id of busyFromEligibleStaff) combined.add(id);
        if (busyEmployeeIds && busyEmployeeIds.size > 0) {
            for (const id of busyEmployeeIds) combined.add(id);
        }
        return combined;
    }, [busyFromEligibleStaff, busyEmployeeIds]);

    // Hide employees that are already absent on this date (Frei, Krank, Urlaub,
    // cross-tenant pool shift, or auto-frei from a previous-day on-call). The
    // current shift's employee is always kept so the edit dialog can show them.
    const visibleStaff = useMemo(() => {
        const busyIds = combinedBusyIds;
        if (!busyIds || busyIds.size === 0) {
            if (open && staff.length > 0) {
                console.log(`[PoolShiftEditDialog] KEINE busyEmployeeIds — alle ${staff.length} Mitarbeiter sichtbar`);
            }
            return staff;
        }
        const currentEmp = shift?.employee_id ? String(shift.employee_id) : null;
        const filtered = staff.filter((s: any) => {
            const id = String(s.id);
            if (id === currentEmp) return true;
            return !busyIds.has(id);
        });
        if (open && (filtered.length < staff.length)) {
            const filteredOut = staff.length - filtered.length;
            console.log(
                `[PoolShiftEditDialog] busyIds=${JSON.stringify([...busyIds])} ` +
                `staff=${staff.length} gefiltert=${filteredOut} sichtbar=${filtered.length}`
            );
        }
        return filtered;
    }, [staff, combinedBusyIds, shift, open]);

    // Distinct list of tenant ids the chosen employee is assigned to.
    // We let the admin pick which tenant gets billed for the shift.
    const billingOptions = useMemo(() => {
        const emp = staff.find((s: any) => s.id === employeeId);
        const ids = emp?.tenant_ids || [];
        if (ids.length === 0 && activeTenantId) return [activeTenantId];
        return ids;
    }, [staff, employeeId, activeTenantId]);

    useEffect(() => {
        // Auto-pick first valid billing option when employee changes
        if (billingOptions.length === 0) return;
        if (!billingOptions.includes(billingTenantId)) {
            setBillingTenantId(billingOptions[0]);
        }
    }, [billingOptions, billingTenantId]);

    const refreshAfterShiftChange = async () => {
        await invalidatePoolShiftQueries(queryClient);
    };

    const saveMutation = useMutation({
        mutationFn: async () => {
            const payload = {
                shared_workplace_id: workplace!.id,
                date,
                employee_id: employeeId,
                billing_tenant_id: billingTenantId,
            };
            if (isEdit) {
                return api.updateGroupShift(groupId as string, shift!.id as string, payload, { force: forceOverride });
            }
            return api.createGroupShift(groupId as string, payload, { force: forceOverride });
        },
        onSuccess: async () => {
            await refreshAfterShiftChange();
            onOpenChange(false);
        },
        onError: (err: any) => {
            // The constraints validator returns { error: 'constraint_violation', details: [...] }
            const details = err?.details;
            if (details?.error === 'constraint_violation' && Array.isArray(details.details)) {
                setViolations(details.details);
            } else {
                setViolations([{ rule: 'error', message: err.message || 'Speichern fehlgeschlagen' }]);
            }
        },
    });

    const deleteMutation = useMutation({
        mutationFn: () => api.deleteGroupShift(groupId as string, shift!.id as string),
        onSuccess: async () => {
            await refreshAfterShiftChange();
            onOpenChange(false);
        },
    });

    const canSubmit = !!employeeId && !!billingTenantId && !saveMutation.isPending;

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="flex flex-col max-h-[85vh] !gap-0 p-0 sm:max-w-md">
                <DialogHeader className="shrink-0 px-6 pt-6 pb-0">
                    <DialogTitle>
                        {isEdit ? 'Pool-Dienst bearbeiten' : 'Pool-Dienst anlegen'}
                    </DialogTitle>
                    <DialogDescription>
                        {workplace?.name} ·{' '}
                        {date ? format(new Date(date), 'EEEE, d. MMMM yyyy', { locale: de }) : ''}
                    </DialogDescription>
                </DialogHeader>

                <div className="flex-1 overflow-y-auto space-y-4 px-6 py-4">
                    <div className="space-y-1.5">
                        <Label htmlFor="pool-shift-employee">Mitarbeiter</Label>
                        {staffQuery.isLoading ? (
                            <div className="flex items-center gap-2 text-sm text-slate-500">
                                <Loader2 className="w-4 h-4 animate-spin" /> Lade Pool-Mitarbeiter …
                            </div>
                        ) : staff.length === 0 ? (
                            <div className="text-sm text-slate-500">
                                {requiredQuals.length > 0
                                    ? `Kein berechtigter Mitarbeiter (Pflicht-Qualifikationen: ${requiredQuals.join(', ')}).`
                                    : 'Keine Pool-Mitarbeiter in dieser Gruppe gefunden.'}
                            </div>
                        ) : visibleStaff.length === 0 ? (
                            <div className="text-sm text-slate-500">
                                Alle berechtigten Mitarbeiter sind an diesem Tag verhindert (Frei, Urlaub, Krank oder bereits eingeteilt).
                            </div>
                        ) : (
                            <>
                            {requiredQuals.length > 0 && (
                                <div className="text-[11px] text-slate-500">
                                    Pflicht-Qualifikationen: {requiredQuals.join(', ')}
                                </div>
                            )}
                            <Select value={employeeId} onValueChange={setEmployeeId}>
                                <SelectTrigger id="pool-shift-employee">
                                    <SelectValue placeholder="Mitarbeiter wählen" />
                                </SelectTrigger>
                                <SelectContent>
                                    {visibleStaff.map((s: any) => {
                                        const wish = wishByEmployeeId.get(String(s.id));
                                        const isServiceWish = wish?.type === 'service' && wish?.status !== 'rejected';
                                        const isNoServiceWish = !isServiceWish && wish?.type === 'no_service' && wish?.status !== 'rejected';
                                        const className = isServiceWish
                                            ? 'text-green-700 font-medium bg-green-50'
                                            : isNoServiceWish
                                                ? 'text-red-700 font-medium bg-red-50'
                                                : undefined;
                                        const labelExtra = isServiceWish
                                            ? ' · Dienstwunsch'
                                            : isNoServiceWish
                                                ? ' · Kein-Dienst-Wunsch'
                                                : '';
                                        const fullLabel = [s.last_name, s.first_name].filter(Boolean).join(', ') || s.id;
                                        return (
                                            <SelectItem
                                                key={s.id}
                                                value={s.id}
                                                className={className}
                                            >
                                                {fullLabel}{labelExtra}
                                            </SelectItem>
                                        );
                                    })}
                                </SelectContent>
                            </Select>
                            </>
                        )}
                    </div>

                    {billingOptions.length > 1 && (
                        <div className="space-y-1.5">
                            <Label htmlFor="pool-shift-billing">Abrechnender Mandant</Label>
                            <Select value={billingTenantId} onValueChange={setBillingTenantId}>
                                <SelectTrigger id="pool-shift-billing">
                                    <SelectValue placeholder="Mandant wählen" />
                                </SelectTrigger>
                                <SelectContent>
                                    {billingOptions.map((tid: string) => (
                                        <SelectItem key={tid} value={tid}>
                                            {tid === activeTenantId ? `${tid} (aktiv)` : tid}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    )}

                    {violations.length > 0 && (
                        <Alert variant="destructive">
                            <AlertCircle className="h-4 w-4" />
                            <AlertDescription>
                                <div className="font-medium mb-1">Hinweis:</div>
                                <ul className="list-disc list-inside text-xs">
                                    {violations.map((v, i) => (
                                        <li key={i}>
                                            {v.rule === 'rotation_conflict'
                                                ? `Mitarbeiter ist bereits in "${v.rotationPosition || 'einer Rotation'}" eingetragen.`
                                                : v.message}
                                        </li>
                                    ))}
                                </ul>
                                <div className="mt-2">
                                    <label className="text-xs flex items-center gap-1.5 cursor-pointer">
                                        <input
                                            type="checkbox"
                                            checked={forceOverride}
                                            onChange={(e) => setForceOverride(e.target.checked)}
                                        />
                                        {violations.some((v) => v.rule === 'rotation_conflict')
                                            ? 'Rotation entfernen und Mitarbeiter trotzdem eintragen'
                                            : 'Trotzdem speichern (Override)'}
                                    </label>
                                </div>
                            </AlertDescription>
                        </Alert>
                    )}
                </div>

                <DialogFooter className="sticky bottom-0 bg-white border-t shrink-0 px-6 py-4 gap-2 sm:gap-0">
                    {isEdit && (
                        <Button
                            type="button"
                            variant="outline"
                            className="text-rose-700 border-rose-200 hover:bg-rose-50 mr-auto"
                            onClick={() => deleteMutation.mutate()}
                            disabled={deleteMutation.isPending}
                        >
                            <Trash2 className="w-4 h-4 mr-1.5" />
                            {deleteMutation.isPending ? 'Lösche …' : 'Löschen'}
                        </Button>
                    )}
                    <Button variant="outline" onClick={() => onOpenChange(false)}>
                        Abbrechen
                    </Button>
                    <Button
                        onClick={() => saveMutation.mutate()}
                        disabled={!canSubmit}
                    >
                        {saveMutation.isPending && <Loader2 className="w-4 h-4 animate-spin mr-1.5" />}
                        Speichern
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
