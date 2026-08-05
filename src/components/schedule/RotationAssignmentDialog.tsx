import { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';
import { Loader2, Trash2, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import { api, db } from '@/api/client';
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
import { Textarea } from '@/components/ui/textarea';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { isUnavailableShiftPosition } from '@/utils/shiftPositionUtils';

/**
 * Dialog for the pool planner to assign (or edit/delete) a Springer to a
 * rotation cell. SEPARATE from cross-tenant Dienste — uses rotation_assignment.
 */

interface RotationWorkplace {
  id: string;
  name: string;
  group_id: number | string;
  canWrite?: boolean;
}

interface RotationAssignment {
  id: string;
  employee_id: string;
  employee_name?: string;
  note?: string;
}

interface RotationAssignmentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workplace: RotationWorkplace | null;
  date: string | null;
  assignment: RotationAssignment | null;
  timeslotId: string | null;
  defaultEmployeeId: string | null;
}

export default function RotationAssignmentDialog({
    open,
    onOpenChange,
    workplace,
    date,
    assignment,
    timeslotId,
    defaultEmployeeId,
}: RotationAssignmentDialogProps) {
    const queryClient = useQueryClient();
    const isEdit = !!assignment;
    const groupId = workplace?.group_id;

    const [employeeId, setEmployeeId] = useState('');
    const [note, setNote] = useState('');
    const [errorMsg, setErrorMsg] = useState('');

    // Reset form when dialog opens or target changes.
    // Use defaultEmployeeId from drag-drop when no existing assignment.
    useEffect(() => {
        if (!open) return;
        setEmployeeId(assignment?.employee_id || defaultEmployeeId || '');
        setNote(assignment?.note || '');
        setErrorMsg('');
    }, [open, assignment, defaultEmployeeId]);

    // Load all employees (pool planner picks from the full list).
    // The rotation system does not have a qualification-based eligible-staff
    // endpoint; the planner is responsible for selecting a suitable Springer.
    const { data: doctors = [], isLoading: doctorsLoading } = useQuery({
        queryKey: ['doctors'],
        queryFn: () => db.Doctor.list(),
        staleTime: 5 * 60 * 1000,
        refetchOnWindowFocus: false,
        enabled: !!open,
    });

    // Sort doctors alphabetically by name for a stable dropdown order.
    const sortedDoctors = useMemo(() => {
        return [...doctors].sort((a, b) => {
            const aName = a.name || '';
            const bName = b.name || '';
            return aName.localeCompare(bName, 'de');
        });
    }, [doctors]);

    // ── 'Nicht verfügbar'-Abwesenheiten am Zieldatum ──
    // Lokale ShiftEntry-Einträge (Tenant) + zentrale Abwesenheiten (CentralAbsenceEntry).
    // Mitarbeiter, die am Zieldatum als "Nicht verfügbar" eingetragen sind, werden im
    // Dropdown gekennzeichnet; der Server blockt die Einteilung zusätzlich mit 409.
    const { data: dateShifts = [] } = useQuery({
        queryKey: ['shifts', 'rotation-dialog', date],
        queryFn: () => db.ShiftEntry.filter({ date }) as Promise<Array<{ doctor_id: string | null; date: string; position: string }>>,
        enabled: !!open && !!date,
        staleTime: 30 * 1000,
    });

    const { data: centralAbsencesData } = useQuery({
        queryKey: ['groups', 'central-absences', 'rotation-dialog', date],
        queryFn: () => api.getGroupCentralAbsences({ from: date ?? undefined, to: date ?? undefined }),
        enabled: !!open && !!date,
        staleTime: 30 * 1000,
    });

    const unavailableByEmployeeId = useMemo(() => {
        const local = new Set<string>();
        const central = new Set<string>();
        const targetDate = date ? String(date).slice(0, 10) : null;
        if (!targetDate) return { local, central };
        for (const s of dateShifts) {
            if (String(s.date).slice(0, 10) !== targetDate) continue;
            if (isUnavailableShiftPosition(s.position) && s.doctor_id) {
                local.add(String(s.doctor_id));
            }
        }
        const absences = (centralAbsencesData as { absences?: Array<{ employee_id: string; date: string; position: string }> } | undefined)?.absences ?? [];
        for (const a of absences) {
            if (String(a.date).slice(0, 10) !== targetDate) continue;
            if (isUnavailableShiftPosition(a.position)) {
                central.add(String(a.employee_id));
            }
        }
        return { local, central };
    }, [dateShifts, centralAbsencesData, date]);

    const isDoctorUnavailable = (doc: { id: string; central_employee_id?: string | null }): boolean => {
        if (unavailableByEmployeeId.local.has(doc.id)) return true;
        return !!doc.central_employee_id && unavailableByEmployeeId.central.has(String(doc.central_employee_id));
    };

    const selectedDoctorUnavailable = employeeId
        ? doctors.some((doc) => doc.id === employeeId && isDoctorUnavailable(doc))
        : false;

    const invalidateRotationQueries = () => {
        queryClient.invalidateQueries({ queryKey: ['rotations', 'visible-rotations'] });
        queryClient.invalidateQueries({ queryKey: ['rotations', 'demands'] });
    };

    const saveMutation = useMutation({
        mutationFn: async () => {
            const payload = {
                rotation_workplace_id: workplace!.id,
                date,
                employee_id: employeeId,
                timeslot_id: timeslotId || null,
                note: note.trim() || null,
            };
            if (isEdit) {
                return api.updateRotationAssignment(groupId as string, assignment.id, payload);
            }
            return api.createRotationAssignment(groupId as string, payload);
        },
        onSuccess: (data) => {
            invalidateRotationQueries();
            const fulfilled = (data as { fulfilled_demand_id?: string })?.fulfilled_demand_id;
            if (fulfilled) {
                toast.success('Springer eingeteilt', {
                    description: 'Ein offener Bedarf wurde automatisch erfüllt.',
                });
            } else {
                toast.success('Springer eingeteilt');
            }
            onOpenChange(false);
        },
        onError: (err) => {
            const msg = err?.message || 'Speichern fehlgeschlagen.';
            setErrorMsg(msg);
        },
    });

    const deleteMutation = useMutation({
        mutationFn: () => api.deleteRotationAssignment(groupId as string, assignment!.id),
        onSuccess: () => {
            invalidateRotationQueries();
            toast.success('Einteilung entfernt');
            onOpenChange(false);
        },
        onError: (err) => {
            const msg = err?.message || 'Löschen fehlgeschlagen.';
            setErrorMsg(msg);
        },
    });

    // CRITICAL: null guard AFTER all hooks (lesson from V1 crash).
    if (!workplace || !date) return null;

    const canSubmit = !!employeeId && !saveMutation.isPending;
    const dateLabel = format(new Date(date), 'EEEE, d. MMMM yyyy', { locale: de });

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>
                        {isEdit ? 'Springer-Einteilung bearbeiten' : 'Springer einteilen'}
                    </DialogTitle>
                    <DialogDescription>
                        {workplace.name} · {dateLabel}
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4 py-2">
                    <div className="space-y-1.5">
                        <Label htmlFor="rotation-assignment-employee">Mitarbeiter</Label>
                        {doctorsLoading ? (
                            <div className="flex items-center gap-2 text-sm text-slate-500">
                                <Loader2 className="w-4 h-4 animate-spin" /> Lade Mitarbeiter …
                            </div>
                        ) : sortedDoctors.length === 0 ? (
                            <div className="text-sm text-slate-500">
                                Keine Mitarbeiter gefunden.
                            </div>
                        ) : (
                            <Select value={employeeId} onValueChange={setEmployeeId}>
                                <SelectTrigger id="rotation-assignment-employee">
                                    <SelectValue placeholder="Mitarbeiter wählen" />
                                </SelectTrigger>
                                <SelectContent>
                                    {sortedDoctors.map((doc) => {
                                        const unavailable = isDoctorUnavailable(doc);
                                        return (
                                            <SelectItem key={doc.id} value={doc.id}>
                                                {doc.name}
                                                {unavailable ? ' · nicht verfügbar' : ''}
                                            </SelectItem>
                                        );
                                    })}
                                </SelectContent>
                            </Select>
                        )}
                    </div>

                    {selectedDoctorUnavailable && (
                        <Alert className="bg-amber-50 border-amber-200">
                            <AlertCircle className="h-4 w-4 text-amber-600" />
                            <AlertDescription className="text-amber-800">
                                {doctors.find((d) => d.id === employeeId)?.name} ist am {dateLabel} als
                                „Nicht verfügbar" eingetragen. Die Einteilung wird blockiert, solange die
                                Abwesenheit besteht — bitte zuerst im Abwesenheitskalender entfernen.
                            </AlertDescription>
                        </Alert>
                    )}

                    <div className="space-y-1.5">
                        <Label htmlFor="rotation-assignment-note">Notiz (optional)</Label>
                        <Textarea
                            id="rotation-assignment-note"
                            value={note}
                            onChange={(e) => { setNote(e.target.value); }}
                            placeholder="z. B. „Eingeteilt für Gyn2, Spätschicht“"
                            rows={2}
                        />
                    </div>

                    {errorMsg && (
                        <Alert variant="destructive">
                            <AlertCircle className="h-4 w-4" />
                            <AlertDescription>{errorMsg}</AlertDescription>
                        </Alert>
                    )}
                </div>

                <DialogFooter className="gap-2 sm:gap-0">
                    {isEdit && (
                        <Button
                            type="button"
                            variant="outline"
                            className="text-rose-700 border-rose-200 hover:bg-rose-50 mr-auto"
                            onClick={() => { deleteMutation.mutate(); }}
                            disabled={deleteMutation.isPending}
                        >
                            <Trash2 className="w-4 h-4 mr-1.5" />
                            {deleteMutation.isPending ? 'Lösche …' : 'Löschen'}
                        </Button>
                    )}
                    <Button variant="outline" onClick={() => { onOpenChange(false); }}>
                        Abbrechen
                    </Button>
                    <Button
                        onClick={() => { saveMutation.mutate(); }}
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
