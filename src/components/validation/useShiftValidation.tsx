import { useQuery } from '@tanstack/react-query';
import { db, base44, api } from "@/api/client";
import { useMemo, useCallback } from 'react';
import type { ShiftEntry, Doctor, SystemSetting, Workplace, StaffingPlanEntry, WorkplaceTimeslot } from '@/types';
import type { SharedShift } from './ShiftValidation';
import { ShiftValidator } from './ShiftValidation';
import type { ValidationResult } from './ShiftValidation';
import { toast } from 'sonner';
import { useAllDoctorQualifications, useAllWorkplaceQualifications, useQualifications } from '@/hooks/useQualifications';

/**
 * Baut eine bidirektionale Map aus Employee-Beziehungen mit shift_conflict=true.
 * Map: central_employee_id → [related_central_employee_id, ...]
 */
function buildRelationshipMap(relationships: Array<{ employee_id: string; related_employee_id: string; shift_conflict?: boolean }>): Map<string, string[]> {
    const map = new Map<string, string[]>();
    for (const rel of relationships) {
        if (!rel.shift_conflict) continue;
        // Bidirektional: A → B und B → A
        const empId = String(rel.employee_id);
        const relId = String(rel.related_employee_id);
        if (!map.has(empId)) map.set(empId, []);
        if (!map.has(relId)) map.set(relId, []);
        map.get(empId)!.push(relId);
        map.get(relId)!.push(empId);
    }
    return map;
}

interface UseShiftValidationReturn {
    validate: (doctorId: string, dateStr: string, position: string, options?: Record<string, unknown>) => ValidationResult;
    validateWithUI: (doctorId: string, dateStr: string, position: string, options?: Record<string, unknown>) => boolean;
    shouldCreateAutoFrei: (position: string, dateStr: string, isPublicHoliday: boolean) => string | null;
    findAutoFreiToCleanup: (doctorId: string, dateStr: string, position: string) => ShiftEntry | null;
    isAutoOffPosition: (position: string) => boolean;
    checkCrossTenantConflicts: (doctorId: string, dateStr: string) => Promise<unknown[]>;
    validator: ShiftValidator;
}

/**
 * Hook für zentrale Shift-Validierung
 * Nutzt gecachte Daten aus React Query
 */
export function useShiftValidation(shifts: ShiftEntry[] = [], customOptions: Record<string, unknown> = {}): UseShiftValidationReturn {
    const { data: doctorsData = [] } = useQuery({
        queryKey: ['doctors'],
        queryFn: () => db.Doctor.list(),
        staleTime: 1000 * 60 * 5
    });

    const { data: workplacesData = [] as Workplace[] } = useQuery({
        queryKey: ['workplaces'],
        queryFn: () => db.Workplace.list() as unknown as Workplace[],
        staleTime: 1000 * 60 * 5
    });

    const { data: settingsData = [] } = useQuery({
        queryKey: ['systemSettings'],
        queryFn: () => db.SystemSetting.list(),
        staleTime: 1000 * 60 * 5
    });

    const { data: staffingData = [] as StaffingPlanEntry[] } = useQuery({
        queryKey: ['staffingPlanEntriesAll'],
        queryFn: () => db.StaffingPlanEntry.list() as unknown as StaffingPlanEntry[],
        staleTime: 1000 * 60 * 5
    });

    // Timeslots für Zeitfenster-Validierung
    const { data: timeslotsData = [] as WorkplaceTimeslot[] } = useQuery({
        queryKey: ['workplaceTimeslots'],
        queryFn: () => db.WorkplaceTimeslot.list() as unknown as WorkplaceTimeslot[],
        staleTime: 1000 * 60 * 5
    });

    // Mitarbeiterbeziehungen mit Dienstkonflikt
    const { data: relationshipsData = [] } = useQuery({
        queryKey: ['employee-relationships-conflicts'],
        queryFn: async () => {
            const res = await api.getEmployeeRelationships() as { relationships?: { employee_id: string; related_employee_id: string; shift_conflict?: boolean }[] };
            return res.relationships || [];
        },
        staleTime: 1000 * 60 * 5,
    });

    // Bidirektionale Map aufbauen
    const employeeRelationships = useMemo(() => buildRelationshipMap(relationshipsData), [relationshipsData]);

    // Qualifikationsdaten laden
    const { qualificationMap } = useQualifications();
    const { getQualificationIds: getDoctorQualIds, allDoctorQualifications } = useAllDoctorQualifications();
    const { byWorkplace: wpQualsByWorkplace, allWorkplaceQualifications } = useAllWorkplaceQualifications();

    // Merge internal data with custom options (custom options take precedence)
    const doctors = (customOptions.doctors as Doctor[] | undefined) || doctorsData;
    const workplaces = (customOptions.workplaces as Workplace[] | undefined) || workplacesData;
    const systemSettings = (customOptions.systemSettings as SystemSetting[] | undefined) || settingsData;
    const staffingEntries = (customOptions.staffingEntries as StaffingPlanEntry[] | undefined) || staffingData;
    const timeslots = (customOptions.timeslots as WorkplaceTimeslot[] | undefined) || timeslotsData;
    const sharedShifts = (customOptions.sharedShifts as SharedShift[]) || [];

    // Exclude already-extracted properties to avoid overriding typed values with unknown from the spread
    const { doctors: _, workplaces: __, systemSettings: ___, staffingEntries: ____, timeslots: _____, sharedShifts: ______, ...restCustomOptions } = customOptions;

    const validator = useMemo(() => {
        return new ShiftValidator({
            ...restCustomOptions,
            doctors,
            shifts,
            workplaces,
            systemSettings,
            staffingEntries,
            timeslots,
            sharedShifts,
            qualificationMap,
            getDoctorQualIds,
            wpQualsByWorkplace,
            employeeRelationships,
        });
    }, [doctors, shifts, workplaces, systemSettings, staffingEntries, timeslots, sharedShifts, qualificationMap, getDoctorQualIds, wpQualsByWorkplace, employeeRelationships, allDoctorQualifications, allWorkplaceQualifications, customOptions]);

    /**
     * Validiert eine geplante Shift-Operation
     * @param {string} doctorId 
     * @param {string} dateStr - Format: 'yyyy-MM-dd'
     * @param {string} position 
     * @param {object} options - { excludeShiftId, silent, skipLimits }
     * @returns {{ canProceed: boolean, blockers: string[], warnings: string[] }}
     */
    const validate = (doctorId: string, dateStr: string, position: string, options: Record<string, unknown> = {}): ValidationResult => {
        console.log(`[DEBUG-LOG] Validating: Doc=${doctorId}, Date=${dateStr}, Pos=${position}`, options);
        return validator.validate(doctorId, dateStr, position, options);
    };

    /**
     * Validiert und zeigt UI-Feedback (Alerts/Toasts)
     * @returns {boolean} - true wenn fortgefahren werden kann
     */
    const validateWithUI = (doctorId: string, dateStr: string, position: string, options: Record<string, unknown> = {}): boolean => {
        const { useToast = false, ...validateOptions } = options as { useToast?: boolean; [key: string]: unknown };
        const result = validate(doctorId, dateStr, position, validateOptions);

        // Blockers verhindern die Aktion
        if (result.blockers.length > 0) {
            const msg = result.blockers.join('\n');
            if (useToast) {
                toast.error(msg);
            } else {
                alert(msg);
            }
            return false;
        }

        // Warnungen anzeigen aber erlauben
        if (result.warnings.length > 0) {
            const msg = result.warnings.join('\n');
            if (useToast) {
                toast.warning(msg);
            } else {
                // Bei mehreren Warnungen: alert
                alert(`Hinweis:\n${msg}`);
            }
        }

        return true;
    };

    /**
     * Prüft ob Auto-Frei erstellt werden soll
     */
    const shouldCreateAutoFrei = (position: string, dateStr: string, isPublicHoliday: boolean): string | null => {
        return validator.shouldCreateAutoFrei(position, dateStr, isPublicHoliday);
    };

    /**
     * Findet Auto-Frei-Eintrag der gelöscht werden sollte
     */
    const findAutoFreiToCleanup = (doctorId: string, dateStr: string, position: string): ShiftEntry | null => {
        return validator.findAutoFreiToCleanup(doctorId, dateStr, position);
    };

    /**
     * Prüft ob Position Auto-Off auslöst
     */
    const isAutoOffPosition = (position: string): boolean => {
        return validator.isAutoOffPosition(position);
    };

    /**
     * Mandantenübergreifende Dienstkonflikt-Prüfung.
     * Ruft das Backend auf, um zu prüfen, ob ein verwandter Mitarbeiter
     * (mit shift_conflict=true) in einem anderen Mandanten ebenfalls
     * einen echten Dienst am selben Datum hat.
     *
     * @param {string} doctorId - ID des zu prüfenden Arztes
     * @param {string} dateStr - Datum als YYYY-MM-DD
     * @returns {Promise<Array<{related_employee_id, related_employee_name, relationship_type}>>}
     */
    const checkCrossTenantConflicts = useCallback(async (doctorId: string, dateStr: string): Promise<unknown[]> => {
        const doctor = doctors.find((d: { id: string }) => d.id === doctorId);
        if (!doctor || !(doctor as { central_employee_id?: string | null }).central_employee_id) return [];

        try {
            const res = await api.checkRelationshipConflicts((doctor as { central_employee_id: string }).central_employee_id, dateStr);
            return res.conflicts || [];
        } catch (err) {
            console.warn('[useShiftValidation] Cross-tenant check failed:', (err as { message?: string })?.message);
            return [];
        }
    }, [doctors]);

    return {
        validate,
        validateWithUI,
        shouldCreateAutoFrei,
        findAutoFreiToCleanup,
        isAutoOffPosition,
        checkCrossTenantConflicts,
        validator
    };
}
