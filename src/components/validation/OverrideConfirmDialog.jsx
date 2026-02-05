import React, { useState } from 'react';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { AlertTriangle, ShieldAlert } from 'lucide-react';

/**
 * Zweistufiger Dialog für Konflikt-Meldungen:
 * 1. Stufe: Einfache Warnung mit "OK" (abbrechen) und "Override" Button
 * 2. Stufe: Override-Bestätigung mit optionaler Begründung
 * 
 * Props:
 * - open: boolean - Ob der Dialog geöffnet ist
 * - onOpenChange: (open: boolean) => void - Callback wenn Dialog geschlossen wird
 * - blockers: string[] - Liste der Blocker-Nachrichten
 * - warnings: string[] - Liste der Warnungen
 * - context: { doctorName, date, position } - Kontext für die Anzeige
 * - onConfirm: (reason: string) => void - Callback bei Bestätigung mit Override-Grund
 * - onCancel: () => void - Callback bei Abbruch
 */
export default function OverrideConfirmDialog({
    open,
    onOpenChange,
    blockers = [],
    warnings = [],
    context = {},
    onConfirm,
    onCancel
}) {
    const [step, setStep] = useState(1); // 1 = Warnung, 2 = Override-Begründung
    const [reason, setReason] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);

    const hasBlockers = blockers.length > 0;
    const hasWarnings = warnings.length > 0;
    const allMessages = [...blockers, ...warnings];

    const handleConfirm = async () => {
        setIsSubmitting(true);
        try {
            await onConfirm(reason.trim() || 'Keine Begründung angegeben');
        } finally {
            setIsSubmitting(false);
            setReason('');
            setStep(1);
        }
    };

    const handleCancel = () => {
        setReason('');
        setStep(1);
        onCancel?.();
        onOpenChange(false);
    };

    const handleOverrideClick = () => {
        setStep(2);
    };

    const handleBackToWarning = () => {
        setStep(1);
        setReason('');
    };

    const handleOpenChange = (newOpen) => {
        if (!newOpen) {
            setReason('');
            setStep(1);
        }
        onOpenChange(newOpen);
    };

    return (
        <Dialog open={open} onOpenChange={handleOpenChange}>
            <DialogContent className="max-w-md">
                {step === 1 ? (
                    // Stufe 1: Einfache Konflikt-Warnung
                    <>
                        <DialogHeader>
                            <DialogTitle className="flex items-center gap-2 text-amber-600">
                                <AlertTriangle className="w-5 h-5" />
                                Konflikt erkannt
                            </DialogTitle>
                            <DialogDescription>
                                {context.doctorName && context.date ? (
                                    <>
                                        <strong>{context.doctorName}</strong> am <strong>{context.date}</strong>
                                        {context.position && <> ({context.position})</>}
                                    </>
                                ) : (
                                    'Bei dieser Aktion wurde ein Konflikt erkannt.'
                                )}
                            </DialogDescription>
                        </DialogHeader>
                        
                        <div className="my-4">
                            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
                                <ul className="text-sm text-amber-800 space-y-2">
                                    {allMessages.map((msg, idx) => (
                                        <li key={idx} className="flex items-start gap-2">
                                            <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                                            <span>{msg}</span>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        </div>
                        
                        <DialogFooter className="gap-2 sm:gap-2">
                            <Button 
                                variant="outline" 
                                onClick={handleCancel}
                            >
                                OK
                            </Button>
                            <Button 
                                onClick={handleOverrideClick}
                                variant="secondary"
                                className="bg-amber-100 hover:bg-amber-200 text-amber-800 border border-amber-300"
                            >
                                Override
                            </Button>
                        </DialogFooter>
                    </>
                ) : (
                    // Stufe 2: Override-Bestätigung
                    <>
                        <DialogHeader>
                            <DialogTitle className="flex items-center gap-2 text-red-600">
                                <ShieldAlert className="w-5 h-5" />
                                Override bestätigen
                            </DialogTitle>
                            <DialogDescription>
                                Sie sind dabei, den Konflikt zu überschreiben. Diese Aktion wird protokolliert.
                            </DialogDescription>
                        </DialogHeader>
                        
                        <div className="space-y-4 my-4">
                            {/* Konflikt-Zusammenfassung */}
                            <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 text-sm text-slate-600">
                                <strong>Konflikt:</strong> {allMessages[0]}
                                {allMessages.length > 1 && ` (+${allMessages.length - 1} weitere)`}
                            </div>

                            {/* Optionale Begründung */}
                            <div className="space-y-2">
                                <Label htmlFor="override-reason" className="text-sm font-medium text-slate-700">
                                    Begründung (optional)
                                </Label>
                                <Textarea
                                    id="override-reason"
                                    placeholder="Warum wird dieser Konflikt überschrieben? (optional)"
                                    value={reason}
                                    onChange={(e) => setReason(e.target.value)}
                                    className="resize-none"
                                    rows={2}
                                />
                            </div>
                        </div>
                        
                        <DialogFooter className="gap-2 sm:gap-2">
                            <Button 
                                variant="outline" 
                                onClick={handleBackToWarning}
                                disabled={isSubmitting}
                            >
                                Zurück
                            </Button>
                            <Button 
                                onClick={handleConfirm}
                                disabled={isSubmitting}
                                className="bg-red-600 hover:bg-red-700"
                            >
                                {isSubmitting ? 'Wird gespeichert...' : 'Bestätigen'}
                            </Button>
                        </DialogFooter>
                    </>
                )}
            </DialogContent>
        </Dialog>
    );
}
