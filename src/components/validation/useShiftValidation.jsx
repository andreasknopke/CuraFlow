import { useQuery } from '@tanstack/react-query';
import { db, base44, api } from "@/api/client";
import { useMemo } from 'react';
import { ShiftValidator } from './ShiftValidation';
import { toast } from 'sonner';
import { useAllDoctorQualifications, useAllWorkplaceQualifications, useQualifications } from '@/hooks/useQualifications';

/**
 * Baut eine bidirektionale Map aus Employee-Beziehungen mit shift_conflict=true.
 * Map: central_employee_id → [related_central_employee_id, ...]
 */
function buildRelationshipMap(relationships) {
    const map = new Map();
    for (const rel of relationships) {
        if (!rel.shift_conflict) continue;
        // Bidirektional: A → B und B → A
        const empId = String(rel.employee_id);
        const relId = String(rel.related_employee_id);
        if (!map.has(empId)) map.set(empId, []);
        if (!map.has(relId)) map.set(relId, []);
        map.get(empId).push(relId);
        map.get(relId).push(empId);
    }
    return map;
}

/**
 * Hook für zentrale Shift-Validierung
 * Nutzt gecachte Daten aus React Query
 */
export function useShiftValidation(shifts = [], customOptions = {}) {
    const { data: doctorsData = [] } = useQuery({
        queryKey: ['doctors'],
        queryFn: () => db.Doctor.list(),
        staleTime: 1000 * 60 * 5
    });

    const { data: workplacesData = [] } = useQuery({
        queryKey: ['workplaces'],
        queryFn: () => db.Workplace.list(null, 1000),
        staleTime: 1000 * 60 * 5
    });

    const { data: settingsData = [] } = useQuery({
        queryKey: ['systemSettings'],
        queryFn: () => db.SystemSetting.list(),
        staleTime: 1000 * 60 * 5
    });

    const { data: staffingData = [] } = useQuery({
        queryKey: ['staffingPlanEntriesAll'],
        queryFn: () => base44.entities.StaffingPlanEntry.list(null, 2000),
        staleTime: 1000 * 60 * 5
    });

    // Timeslots für Zeitfenster-Validierung
    const { data: timeslotsData = [] } = useQuery({
        queryKey: ['workplaceTimeslots'],
        queryFn: () => db.WorkplaceTimeslot.list(null, 1000),
        staleTime: 1000 * 60 * 5
    });

    // Mitarbeiterbeziehungen mit Dienstkonflikt
    const { data: relationshipsData = [] } = useQuery({
        queryKey: ['employee-relationships-conflicts'],
        queryFn: async () => {
            const res = await api.getEmployeeRelationships();
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
    const doctors = customOptions.doctors || doctorsData;
    const workplaces = customOptions.workplaces || workplacesData;
    const systemSettings = customOptions.systemSettings || settingsData;
    const staffingEntries = customOptions.staffingEntries || staffingData;
    const timeslots = customOptions.timeslots || timeslotsData;
    const sharedShifts = customOptions.sharedShifts || [];

    const validator = useMemo(() => {
        return new ShiftValidator({
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
            ...customOptions
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
    const validate = (doctorId, dateStr, position, options = {}) => {
        console.log(`[DEBUG-LOG] Validating: Doc=${doctorId}, Date=${dateStr}, Pos=${position}`, options);
        return validator.validate(doctorId, dateStr, position, options);
    };

    /**
     * Validiert und zeigt UI-Feedback (Alerts/Toasts)
     * @returns {boolean} - true wenn fortgefahren werden kann
     */
    const validateWithUI = (doctorId, dateStr, position, options = {}) => {
        const { useToast = false, ...validateOptions } = options;
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
    const shouldCreateAutoFrei = (position, dateStr, isPublicHoliday) => {
        return validator.shouldCreateAutoFrei(position, dateStr, isPublicHoliday);
    };

    /**
     * Findet Auto-Frei-Eintrag der gelöscht werden sollte
     */
    const findAutoFreiToCleanup = (doctorId, dateStr, position) => {
        return validator.findAutoFreiToCleanup(doctorId, dateStr, position);
    };

    /**
     * Prüft ob Position Auto-Off auslöst
     */
    const isAutoOffPosition = (position) => {
        return validator.isAutoOffPosition(position);
    };

    return {
        validate,
        validateWithUI,
        shouldCreateAutoFrei,
        findAutoFreiToCleanup,
        isAutoOffPosition,
        validator
    };
}