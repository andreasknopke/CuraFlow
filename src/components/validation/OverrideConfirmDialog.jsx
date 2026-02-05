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
 * Dialog zum Bestätigen eines Override bei Konflikten/Blockern
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
    const [reason, setReason] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);

    const hasBlockers = blockers.length > 0;
    const hasWarnings = warnings.length > 0;

    const handleConfirm = async () => {
        if (!reason.trim()) {
            return;
        }
        setIsSubmitting(true);
        try {
            await onConfirm(reason.trim());
        } finally {
            setIsSubmitting(false);
            setReason('');
        }
    };

    const handleCancel = () => {
        setReason('');
        onCancel?.();
        onOpenChange(false);
    };

    const handleOpenChange = (newOpen) => {
        if (!newOpen) {
            setReason('');
        }
        onOpenChange(newOpen);
    };

    return (
        <Dialog open={open} onOpenChange={handleOpenChange}>
            <DialogContent className="max-w-lg">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2 text-red-600">
                        <ShieldAlert className="w-5 h-5" />
                        Konflikt überschreiben
                    </DialogTitle>
                    <DialogDescription>
                        {context.doctorName && context.date && context.position ? (
                            <>
                                Für <strong>{context.doctorName}</strong> am <strong>{context.date}</strong> ({context.position}) 
                                wurden folgende Konflikte erkannt:
                            </>
                        ) : (
                            'Folgende Konflikte wurden erkannt:'
                        )}
                    </DialogDescription>
                </DialogHeader>
                
                <div className="space-y-4 my-4">
                    {/* Blocker anzeigen */}
                    {hasBlockers && (
                        <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                            <div className="flex items-center gap-2 text-red-700 font-medium mb-2">
                                <AlertTriangle className="w-4 h-4" />
                                Blockierende Konflikte:
                            </div>
                            <ul className="text-sm text-red-600 space-y-1 list-disc list-inside">
                                {blockers.map((blocker, idx) => (
                                    <li key={idx}>{blocker}</li>
                                ))}
                            </ul>
                        </div>
                    )}

                    {/* Warnungen anzeigen */}
                    {hasWarnings && (
                        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                            <div className="flex items-center gap-2 text-amber-700 font-medium mb-2">
                                <AlertTriangle className="w-4 h-4" />
                                Warnungen:
                            </div>
                            <ul className="text-sm text-amber-600 space-y-1 list-disc list-inside">
                                {warnings.map((warning, idx) => (
                                    <li key={idx}>{warning}</li>
                                ))}
                            </ul>
                        </div>
                    )}

                    {/* Begründung */}
                    <div className="space-y-2">
                        <Label htmlFor="override-reason" className="text-sm font-medium">
                            Begründung für den Override <span className="text-red-500">*</span>
                        </Label>
                        <Textarea
                            id="override-reason"
                            placeholder="Bitte geben Sie eine Begründung ein, warum dieser Konflikt überschrieben werden soll..."
                            value={reason}
                            onChange={(e) => setReason(e.target.value)}
                            className="resize-none"
                            rows={3}
                        />
                        <p className="text-xs text-slate-500">
                            Der Override wird im System-Log protokolliert.
                        </p>
                    </div>
                </div>
                
                <DialogFooter className="gap-2">
                    <Button 
                        variant="outline" 
                        onClick={handleCancel}
                        disabled={isSubmitting}
                    >
                        Abbrechen
                    </Button>
                    <Button 
                        onClick={handleConfirm}
                        disabled={!reason.trim() || isSubmitting}
                        className="bg-red-600 hover:bg-red-700"
                    >
                        {isSubmitting ? 'Wird gespeichert...' : 'Override bestätigen'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
