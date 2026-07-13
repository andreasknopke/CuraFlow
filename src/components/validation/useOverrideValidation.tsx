import { useState, useCallback } from 'react';
import type { Doctor } from '@/types';
import { db } from '@/api/client';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';

interface OverrideDialogState {
    open: boolean;
    blockers: string[];
    warnings: string[];
    context: {
        doctorId?: string;
        doctorName?: string;
        date?: string;
        position?: string;
    };
    pendingAction: (() => void | Promise<void>) | null;
    resolve: ((value: { confirmed: boolean; reason?: string }) => void) | null;
}

interface OverrideLogParams {
    doctorId?: string;
    doctorName?: string;
    date?: string | Date;
    position?: string;
    blockers: string[];
    warnings: string[];
    reason?: string;
    userName?: string;
}

interface RequestOverrideParams {
    blockers?: string[];
    warnings?: string[];
    doctorId?: string;
    doctorName?: string;
    date?: string | Date;
    position?: string;
    onConfirm?: () => void | Promise<void>;
}

interface UseOverrideValidationReturn {
    overrideDialog: OverrideDialogState;
    requestOverride: (params: RequestOverrideParams) => Promise<{ confirmed: boolean; reason?: string }>;
    confirmOverride: (reason: string) => Promise<void>;
    cancelOverride: () => void;
    setOverrideDialogOpen: (open: boolean) => void;
    logOverride: (params: OverrideLogParams) => Promise<void>;
}

/**
 * Hook für Override-Validierung mit Dialog und Logging
 * 
 * Dieser Hook verwaltet:
 * - Den Override-Dialog-State
 * - Das Logging von Overrides
 * - Die Integration mit der Shift-Validierung
 */
export function useOverrideValidation({ user, doctors = [] }: { user?: { email?: string; name?: string }; doctors?: Doctor[] } = {}): UseOverrideValidationReturn {
    const [overrideDialog, setOverrideDialog] = useState<OverrideDialogState>({
        open: false,
        blockers: [],
        warnings: [],
        context: {},
        pendingAction: null,
        resolve: null
    });

    /**
     * Loggt einen Override ins SystemLog
     */
    const logOverride = useCallback(async ({
        doctorId,
        doctorName,
        date,
        position,
        blockers,
        warnings,
        reason,
        userName
    }: OverrideLogParams) => {
        const formattedDate = typeof date === 'string' 
            ? date 
            : (date !== undefined ? format(new Date(date), 'dd.MM.yyyy', { locale: de }) : '');

        const conflicts = [
            ...blockers.map(b => `[BLOCKER] ${b}`),
            ...warnings.map(w => `[WARNUNG] ${w}`)
        ];

        try {
            await db.SystemLog.create({
                level: 'override',
                source: 'Konflikt-Override',
                message: `Override für ${doctorName} am ${formattedDate} (${position})`,
                details: JSON.stringify({
                    doctor_id: doctorId,
                    doctor_name: doctorName,
                    date: formattedDate,
                    position: position,
                    conflicts: conflicts,
                    override_reason: reason,
                    overridden_by: userName,
                    timestamp: new Date().toISOString()
                })
            });
        } catch (err) {
            console.error("Override-Log fehlgeschlagen:", err);
        }
    }, []);

    /**
     * Öffnet den Override-Dialog und wartet auf Benutzerinteraktion
     * @returns Promise<{ confirmed: boolean, reason?: string }>
     */
    const requestOverride = useCallback(({
        blockers = [],
        warnings = [],
        doctorId,
        doctorName,
        date,
        position,
        onConfirm
    }: RequestOverrideParams) => {
        return new Promise<{ confirmed: boolean; reason?: string }>((resolve) => {
            const formattedDate = typeof date === 'string' 
                ? date 
                : (date !== undefined ? format(new Date(date), 'dd.MM.yyyy', { locale: de }) : '');

            setOverrideDialog({
                open: true,
                blockers,
                warnings,
                context: {
                    doctorId,
                    doctorName: doctorName || doctors.find(d => d.id === doctorId)?.name || 'Unbekannt',
                    date: formattedDate,
                    position
                },
                pendingAction: onConfirm || null,
                resolve
            });
        });
    }, [doctors]);

    /**
     * Bestätigt den Override
     */
    const confirmOverride = useCallback(async (reason: string) => {
        const { context, blockers, warnings, pendingAction, resolve } = overrideDialog;

        // Log the override
        await logOverride({
            doctorId: context.doctorId,
            doctorName: context.doctorName,
            date: context.date,
            position: context.position,
            blockers,
            warnings,
            reason,
            userName: user?.email || user?.name || 'Unbekannt'
        });

        // Close dialog
        setOverrideDialog({
            open: false,
            blockers: [],
            warnings: [],
            context: {},
            pendingAction: null,
            resolve: null
        });

        // Execute pending action if provided
        if (pendingAction) {
            await pendingAction();
        }

        // Resolve the promise
        if (resolve) {
            resolve({ confirmed: true, reason });
        }
    }, [overrideDialog, logOverride, user]);

    /**
     * Bricht den Override ab
     */
    const cancelOverride = useCallback(() => {
        const { resolve } = overrideDialog;

        setOverrideDialog({
            open: false,
            blockers: [],
            warnings: [],
            context: {},
            pendingAction: null,
            resolve: null
        });

        if (resolve) {
            resolve({ confirmed: false });
        }
    }, [overrideDialog]);

    /**
     * Ändert den Dialog-State
     */
    const setOverrideDialogOpen = useCallback((open: boolean) => {
        if (!open) {
            cancelOverride();
        }
    }, [cancelOverride]);

    return {
        overrideDialog,
        requestOverride,
        confirmOverride,
        cancelOverride,
        setOverrideDialogOpen,
        logOverride
    };
}
