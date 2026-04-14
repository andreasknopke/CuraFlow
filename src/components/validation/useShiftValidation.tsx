import { useQuery } from '@tanstack/react-query';
import { db } from '@/api/client';
import { useMemo } from 'react';
import { ShiftValidator, type ShiftValidatorOptions } from './ShiftValidation';
import { toast } from 'sonner';
import {
  useAllDoctorQualifications,
  useAllWorkplaceQualifications,
  useQualifications,
} from '@/hooks/useQualifications';

interface ShiftEntry {
  id: number;
  doctor_id: number;
  date: string;
  position: string;
  [key: string]: unknown;
}

interface CustomOptions {
  doctors?: unknown[];
  workplaces?: unknown[];
  systemSettings?: unknown[];
  staffingEntries?: unknown[];
  timeslots?: unknown[];
  [key: string]: unknown;
}

interface ValidationResult {
  canProceed: boolean;
  blockers: string[];
  warnings: string[];
}

interface ValidateOptions {
  excludeShiftId?: number | null;
  silent?: boolean;
  skipLimits?: boolean;
  useToast?: boolean;
  [key: string]: unknown;
}

/**
 * Hook für zentrale Shift-Validierung
 * Nutzt gecachte Daten aus React Query
 */
export function useShiftValidation(shifts: ShiftEntry[] = [], customOptions: CustomOptions = {}) {
  const { data: doctorsData = [] } = useQuery({
    queryKey: ['doctors'],
    queryFn: () => db.Doctor.list(),
    staleTime: 1000 * 60 * 5,
  });

  const { data: workplacesData = [] } = useQuery({
    queryKey: ['workplaces'],
    queryFn: () => (db.Workplace.list as Function)(null, 1000),
    staleTime: 1000 * 60 * 5,
  });

  const { data: settingsData = [] } = useQuery({
    queryKey: ['systemSettings'],
    queryFn: () => db.SystemSetting.list(),
    staleTime: 1000 * 60 * 5,
  });

  const { data: staffingData = [] } = useQuery({
    queryKey: ['staffingPlanEntriesAll'],
    queryFn: () => db.StaffingPlanEntry.list() as Promise<unknown[]>,
    staleTime: 1000 * 60 * 5,
  });

  // Timeslots für Zeitfenster-Validierung
  const { data: timeslotsData = [] } = useQuery({
    queryKey: ['workplaceTimeslots'],
    queryFn: () => db.WorkplaceTimeslot.list() as Promise<unknown[]>,
    staleTime: 1000 * 60 * 5,
  });

  // Qualifikationsdaten laden
  const { qualificationMap } = useQualifications();
  const { getQualificationIds: getDoctorQualIds, allDoctorQualifications } =
    useAllDoctorQualifications();
  const { byWorkplace: wpQualsByWorkplace, allWorkplaceQualifications } =
    useAllWorkplaceQualifications();

  // Merge internal data with custom options (custom options take precedence)
  const doctors = (customOptions.doctors || doctorsData) as unknown[];
  const workplaces = (customOptions.workplaces || workplacesData) as unknown[];
  const systemSettings = (customOptions.systemSettings || settingsData) as unknown[];
  const staffingEntries = (customOptions.staffingEntries || staffingData) as unknown[];
  const timeslots = (customOptions.timeslots || timeslotsData) as unknown[];

  const validator = useMemo(() => {
    return new ShiftValidator({
      doctors: doctors as ShiftValidatorOptions['doctors'],
      shifts: shifts as ShiftValidatorOptions['shifts'],
      workplaces: workplaces as ShiftValidatorOptions['workplaces'],
      systemSettings: systemSettings as ShiftValidatorOptions['systemSettings'],
      staffingEntries: staffingEntries as ShiftValidatorOptions['staffingEntries'],
      timeslots: timeslots as ShiftValidatorOptions['timeslots'],
      qualificationMap,
      getDoctorQualIds,
      wpQualsByWorkplace,
      ...customOptions,
    } as unknown as ShiftValidatorOptions);
  }, [
    doctors,
    shifts,
    workplaces,
    systemSettings,
    staffingEntries,
    timeslots,
    qualificationMap,
    getDoctorQualIds,
    wpQualsByWorkplace,
    allDoctorQualifications,
    allWorkplaceQualifications,
    customOptions,
  ]);

  /**
   * Validiert eine geplante Shift-Operation
   * @param {string} doctorId
   * @param {string} dateStr - Format: 'yyyy-MM-dd'
   * @param {string} position
   * @param {object} options - { excludeShiftId, silent, skipLimits }
   * @returns {{ canProceed: boolean, blockers: string[], warnings: string[] }}
   */
  const validate = (
    doctorId: number,
    dateStr: string,
    position: string,
    options: ValidateOptions = {},
  ): ValidationResult => {
    console.log(
      `[DEBUG-LOG] Validating: Doc=${doctorId}, Date=${dateStr}, Pos=${position}`,
      options,
    );
    return validator.validate(doctorId, dateStr, position, options);
  };

  /**
   * Validiert und zeigt UI-Feedback (Alerts/Toasts)
   * @returns {boolean} - true wenn fortgefahren werden kann
   */
  const validateWithUI = (
    doctorId: number,
    dateStr: string,
    position: string,
    options: ValidateOptions = {},
  ): boolean => {
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
  const shouldCreateAutoFrei = (
    position: string,
    dateStr: string,
    isPublicHoliday: boolean | ((date: Date) => boolean),
  ) => {
    return validator.shouldCreateAutoFrei(position, dateStr, isPublicHoliday);
  };

  /**
   * Findet Auto-Frei-Eintrag der gelöscht werden sollte
   */
  const findAutoFreiToCleanup = (doctorId: number, dateStr: string, position: string) => {
    return validator.findAutoFreiToCleanup(doctorId, dateStr, position);
  };

  /**
   * Prüft ob Position Auto-Off auslöst
   */
  const isAutoOffPosition = (position: string) => {
    return validator.isAutoOffPosition(position);
  };

  return {
    validate,
    validateWithUI,
    shouldCreateAutoFrei,
    findAutoFreiToCleanup,
    isAutoOffPosition,
    validator,
  };
}
