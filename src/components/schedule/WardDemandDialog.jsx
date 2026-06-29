import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';
import { Loader2, AlertCircle, CheckCircle2, XCircle } from 'lucide-react';
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
import { invalidatePoolShiftQueries } from './poolShiftQueries';

/**
 * Dialog for ward staff to register or cancel Springerpool Bedarf (demand)
 * for a specific shared_workplace + date + timeslot.
 *
 * Three modes:
 *   'create'   — No existing demand → register new open demand
 *   'cancel'   — Existing open demand → cancel it
 *   'fulfilled' — Already fulfilled (read-only info)
 */
export default function WardDemandDialog({
    open,
    onOpenChange,
    workplace,
    dateStr,
    timeslot,
    existingDemand, // optional: existing demand for this cell
}) {
    const queryClient = useQueryClient();
    const [note, setNote] = useState(existingDemand?.note || '');
    const [error, setError] = useState(null);

    const mode = existingDemand
        ? (existingDemand.status === 'open' ? 'cancel' : 'fulfilled')
        : 'create';

    const dateFormatted = dateStr
        ? format(new Date(`${dateStr}T12:00:00`), 'EEEE, d. MMMM yyyy', { locale: de })
        : '';

    const timeslotLabel = timeslot?.label || existingDemand?.timeslot_label || null;

    // Create mutation
    const createMutation = useMutation({
        mutationFn: (data) => api.createWardDemand(data),
        onSuccess: () => {
            invalidatePoolShiftQueries(queryClient);
            queryClient.invalidateQueries({ queryKey: ['pool', 'ward-demands'] });
            onOpenChange(false);
        },
        onError: (err) => {
            const msg = err?.error || err?.message || 'Fehler beim Anlegen des Bedarfs';
            setError(msg);
        },
    });

    // Cancel mutation
    const cancelMutation = useMutation({
        mutationFn: (id) => api.updateWardDemand(id, { status: 'cancelled' }),
        onSuccess: () => {
            invalidatePoolShiftQueries(queryClient);
            queryClient.invalidateQueries({ queryKey: ['pool', 'ward-demands'] });
            onOpenChange(false);
        },
        onError: (err) => {
            const msg = err?.error || err?.message || 'Fehler beim Stornieren';
            setError(msg);
        },
    });

    const isPending = createMutation.isPending || cancelMutation.isPending;

    const handleCreate = () => {
        setError(null);
        createMutation.mutate({
            shared_workplace_id: workplace.id,
            date: dateStr,
            timeslot_id: timeslot?.id || null,
            note: note.trim() || null,
        });
    };

    const handleCancel = () => {
        setError(null);
        cancelMutation.mutate(existingDemand.id);
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                    <DialogTitle>
                        {mode === 'create' && 'Springer-Bedarf anmelden'}
                        {mode === 'cancel' && 'Bedarf stornieren'}
                        {mode === 'fulfilled' && 'Bedarf – bereits erfüllt'}
                    </DialogTitle>
                    <DialogDescription>
                        {workplace.name}
                        {timeslotLabel ? ` · ${timeslotLabel}` : ''}
                        {' · '}{dateFormatted}
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4 py-2">
                    {error && (
                        <Alert variant="destructive">
                            <AlertCircle className="h-4 w-4" />
                            <AlertDescription>{error}</AlertDescription>
                        </Alert>
                    )}

                    {mode === 'create' && (
                        <>
                            <p className="text-sm text-muted-foreground">
                                Hiermit melden Sie Bedarf für einen Springer aus dem Pool
                                für diesen Tag und diese Schicht an. Der Dienstplaner
                                des Springerpools wird benachrichtigt.
                            </p>
                            <div className="space-y-2">
                                <Label htmlFor="demand-note">Notiz (optional)</Label>
                                <Textarea
                                    id="demand-note"
                                    placeholder="z.B. 'bitte Fachkraft', 'Besonderheiten beachten'"
                                    value={note}
                                    onChange={(e) => setNote(e.target.value)}
                                    disabled={isPending}
                                    rows={3}
                                />
                            </div>
                        </>
                    )}

                    {mode === 'cancel' && (
                        <p className="text-sm text-muted-foreground">
                            Dieser Bedarf ist noch offen. Möchten Sie ihn stornieren?
                            {existingDemand?.note && (
                                <span className="block mt-2 p-2 bg-muted rounded text-xs">
                                    Notiz: {existingDemand.note}
                                </span>
                            )}
                        </p>
                    )}

                    {mode === 'fulfilled' && (
                        <div className="space-y-2">
                            <div className="flex items-center gap-2 text-sm text-green-600">
                                <CheckCircle2 className="h-4 w-4" />
                                <span>Dieser Bedarf wurde bereits erfüllt.</span>
                            </div>
                            {existingDemand?.fulfilled_employee_name && (
                                <p className="text-sm text-muted-foreground">
                                    Erfüllt durch: {existingDemand.fulfilled_employee_name}
                                </p>
                            )}
                            {existingDemand?.note && (
                                <p className="text-sm p-2 bg-muted rounded">
                                    Notiz: {existingDemand.note}
                                </p>
                            )}
                        </div>
                    )}
                </div>

                <DialogFooter>
                    <Button
                        variant="outline"
                        onClick={() => onOpenChange(false)}
                        disabled={isPending}
                    >
                        {mode === 'fulfilled' ? 'Schließen' : 'Abbrechen'}
                    </Button>

                    {mode === 'create' && (
                        <Button onClick={handleCreate} disabled={isPending}>
                            {isPending ? (
                                <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Wird angelegt...</>
                            ) : (
                                'Bedarf anmelden'
                            )}
                        </Button>
                    )}

                    {mode === 'cancel' && (
                        <Button
                            variant="destructive"
                            onClick={handleCancel}
                            disabled={isPending}
                        >
                            {isPending ? (
                                <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Wird storniert...</>
                            ) : (
                                <><XCircle className="mr-2 h-4 w-4" /> Bedarf stornieren</>
                            )}
                        </Button>
                    )}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
