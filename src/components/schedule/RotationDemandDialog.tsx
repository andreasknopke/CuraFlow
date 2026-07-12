import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';
import { Loader2, AlertCircle, CheckCircle2, Clock } from 'lucide-react';
import { toast } from 'sonner';
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
import { Textarea } from '@/components/ui/textarea';
import { Alert, AlertDescription } from '@/components/ui/alert';

/**
 * Dialog for ward staff to register (or cancel) demand for a Springer on a
 * rotation cell. SEPARATE from cross-tenant Dienste — uses rotation_demand.
 *
 * Three modes:
 *  - create: no existing demand → "Bedarf anmelden"
 *  - cancel: existing open demand → "Bedarf zurückziehen"
 *  - fulfilled: existing fulfilled demand → read-only info
 *
 * Props:
 *   open: boolean
 *   onOpenChange(open)
 *   workplace: { id, name, group_id, canWrite } | null
 *   dateStr: 'YYYY-MM-DD' | null
 *   timeslot: { id, label } | null
 *   existingDemand: { id, status, note, ... } | null
 */
export default function RotationDemandDialog({
    open,
    onOpenChange,
    workplace,
    dateStr,
    timeslot,
    existingDemand,
}) {
    const queryClient = useQueryClient();

    const [note, setNote] = useState('');
    const [errorMsg, setErrorMsg] = useState('');

    // Reset form whenever the dialog opens or the target changes.
    useEffect(() => {
        if (!open) return;
        setNote(existingDemand?.note || '');
        setErrorMsg('');
    }, [open, existingDemand]);

    const invalidateRotationQueries = () => {
        queryClient.invalidateQueries({ queryKey: ['rotations', 'visible-rotations'] });
        queryClient.invalidateQueries({ queryKey: ['rotations', 'demands'] });
    };

    const createMutation = useMutation({
        mutationFn: async () => {
            const payload = {
                rotation_workplace_id: workplace.id,
                date: dateStr,
                timeslot_id: timeslot?.id || null,
                note: note.trim() || null,
            };
            return api.createRotationDemand(payload);
        },
        onSuccess: () => {
            invalidateRotationQueries();
            toast.success('Bedarf angemeldet', { description: 'Der Springerpool wurde benachrichtigt.' });
            onOpenChange(false);
        },
        onError: (err) => {
            const msg = err?.message || 'Bedarf konnte nicht angemeldet werden.';
            setErrorMsg(msg);
        },
    });

    const cancelMutation = useMutation({
        mutationFn: () => api.updateRotationDemand(existingDemand.id, { status: 'cancelled' }),
        onSuccess: () => {
            invalidateRotationQueries();
            toast.success('Bedarf zurückgezogen');
            onOpenChange(false);
        },
        onError: (err) => {
            const msg = err?.message || 'Bedarf konnte nicht zurückgezogen werden.';
            setErrorMsg(msg);
        },
    });

    // CRITICAL: null guard AFTER all hooks (lesson from V1 crash).
    // When the dialog is closed, workplace may be null. We must still call all
    // hooks unconditionally to satisfy the Rules of Hooks, then bail out of
    // rendering content.
    if (!workplace || !dateStr) return null;

    const isFulfilled = existingDemand?.status === 'fulfilled';
    const isCancelled = existingDemand?.status === 'cancelled';
    const hasOpenDemand = !!existingDemand && existingDemand.status === 'open';
    const readOnly = isFulfilled || isCancelled;

    const dateLabel = format(new Date(dateStr), 'EEEE, d. MMMM yyyy', { locale: de });
    const timeslotLabel = timeslot?.label ? ` · ${timeslot.label}` : '';

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>
                        {hasOpenDemand
                            ? 'Bedarf verwalten'
                            : isFulfilled
                                ? 'Bedarf erfüllt'
                                : 'Springer-Bedarf anmelden'}
                    </DialogTitle>
                    <DialogDescription>
                        {workplace.name} · {dateLabel}{timeslotLabel}
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4 py-2">
                    {isFulfilled && (
                        <Alert className="border-green-200 bg-green-50 text-green-800">
                            <CheckCircle2 className="h-4 w-4" />
                            <AlertDescription>
                                Für diese Zelle wurde bereits ein Springer eingeteilt.
                                Der Bedarf gilt als erfüllt.
                            </AlertDescription>
                        </Alert>
                    )}

                    {hasOpenDemand && (
                        <Alert className="border-orange-200 bg-orange-50 text-orange-800">
                            <Clock className="h-4 w-4" />
                            <AlertDescription>
                                Es besteht bereits ein offener Bedarf für diese Zelle.
                                Der Springerpool-Planer wurde benachrichtigt.
                            </AlertDescription>
                        </Alert>
                    )}

                    {!readOnly && (
                        <div className="space-y-1.5">
                            <Label htmlFor="rotation-demand-note">Notiz (optional)</Label>
                            <Textarea
                                id="rotation-demand-note"
                                value={note}
                                onChange={(e) => setNote(e.target.value)}
                                placeholder="z. B. „Brauchen dringend einen Springer für die Spätschicht“"
                                rows={3}
                                disabled={hasOpenDemand}
                            />
                            {hasOpenDemand && (
                                <p className="text-[11px] text-slate-500">
                                    Notiz kann nachträglich nicht geändert werden.
                                </p>
                            )}
                        </div>
                    )}

                    {existingDemand?.note && readOnly && (
                        <div className="space-y-1">
                            <span className="text-xs font-medium text-slate-500">Notiz:</span>
                            <p className="text-sm text-slate-700 bg-slate-50 rounded p-2 border border-slate-100">
                                {existingDemand.note}
                            </p>
                        </div>
                    )}

                    {errorMsg && (
                        <Alert variant="destructive">
                            <AlertCircle className="h-4 w-4" />
                            <AlertDescription>{errorMsg}</AlertDescription>
                        </Alert>
                    )}
                </div>

                <DialogFooter className="gap-2 sm:gap-0">
                    {hasOpenDemand && (
                        <Button
                            type="button"
                            variant="outline"
                            className="text-rose-700 border-rose-200 hover:bg-rose-50 mr-auto"
                            onClick={() => cancelMutation.mutate()}
                            disabled={cancelMutation.isPending}
                        >
                            {cancelMutation.isPending && <Loader2 className="w-4 h-4 animate-spin mr-1.5" />}
                            Bedarf zurückziehen
                        </Button>
                    )}
                    <Button variant="outline" onClick={() => onOpenChange(false)}>
                        {readOnly ? 'Schließen' : 'Abbrechen'}
                    </Button>
                    {!hasOpenDemand && !readOnly && (
                        <Button
                            onClick={() => createMutation.mutate()}
                            disabled={createMutation.isPending}
                        >
                            {createMutation.isPending && <Loader2 className="w-4 h-4 animate-spin mr-1.5" />}
                            Bedarf anmelden
                        </Button>
                    )}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
