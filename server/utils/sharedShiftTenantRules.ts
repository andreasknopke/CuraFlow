import { addDays, format, parseISO } from 'date-fns';

interface SharedShiftWorkplace {
  name?: string | null;
  category?: string | null;
  allows_absence_overlap?: boolean | null;
  affects_availability?: boolean | null;
  allows_rotation_concurrently?: boolean | null;
  consecutive_days_mode?: string | null;
  auto_off?: boolean | null;
}

interface SharedShiftEntry {
  id: string;
  doctor_id: string | null;
  date: string | Date | null;
  position: string;
}

interface SharedShiftRuleBlocker {
  rule: string;
  message: string;
  rotationShiftId?: string;
  rotationPosition?: string;
}

interface SharedShiftRuleWarning {
  rule: string;
  message: string;
}

interface SharedShiftRuleResult {
  blockers: SharedShiftRuleBlocker[];
  warnings: SharedShiftRuleWarning[];
  autoFreiDate: string | null;
}

interface SharedShiftRuleOptions {
  workplace: SharedShiftWorkplace | null | undefined;
  dateStr: string | Date | null | undefined;
  centralEmployeeId: string | null | undefined;
  tenantDoctorId: string | null | undefined;
  tenantShifts?: SharedShiftEntry[];
  tenantWorkplaces?: SharedShiftWorkplace[];
  existingSharedShiftsForWorkplace?: Array<{ id?: string | null; employee_id?: string | null; date?: string | Date | null; position?: string | null }>;
  absenceBlockingRules?: Record<string, boolean | undefined>;
  holidayDates?: Set<string>;
}

const DEFAULT_ABSENCE_BLOCKING_RULES: Record<string, boolean> = {
  Urlaub: true,
  Krank: true,
  Frei: true,
  Dienstreise: false,
  'Nicht verfügbar': false,
};

function normalizeDate(dateValue: unknown): string {
  if (typeof dateValue === 'string') return dateValue.slice(0, 10);
  return String(dateValue || '').slice(0, 10);
}

export function getSharedShiftAutoFreiDate(dateStr: string, holidayDates: Set<string> = new Set()): string | null {
  const nextDay = addDays(parseISO(dateStr), 1);
  const nextDateStr = format(nextDay, 'yyyy-MM-dd');
  const dayOfWeek = nextDay.getDay();
  const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
  const isHoliday = holidayDates.has(nextDateStr);

  if (isWeekend || isHoliday) {
    return null;
  }

  return nextDateStr;
}

export function buildSharedShiftAutoFreiMarker(shiftId: string): string {
  return `cross-tenant:auto-frei:${shiftId}`;
}

export function validateSharedShiftTenantRules({
  workplace,
  dateStr,
  centralEmployeeId,
  tenantDoctorId,
  tenantShifts = [],
  tenantWorkplaces = [],
  existingSharedShiftsForWorkplace = [],
  absenceBlockingRules = DEFAULT_ABSENCE_BLOCKING_RULES,
  holidayDates = new Set<string>(),
}: SharedShiftRuleOptions): SharedShiftRuleResult {
  const blockers: SharedShiftRuleBlocker[] = [];
  const warnings: SharedShiftRuleWarning[] = [];
  const normalizedDate = normalizeDate(dateStr);
  const tenantDoctorIdString = tenantDoctorId ? String(tenantDoctorId) : '';
  const sameDayTenantShifts = tenantShifts.filter(
    (shift) => normalizeDate(shift.date) === normalizedDate && String(shift.doctor_id) === tenantDoctorIdString
  );

  if (workplace?.allows_absence_overlap !== true) {
    for (const shift of sameDayTenantShifts) {
      const isBlocking = absenceBlockingRules[shift.position];
      if (typeof isBlocking !== 'boolean') continue;
      if (isBlocking) {
        blockers.push({
          rule: 'absence_conflict',
          message: `Mitarbeiter ist bereits als "${shift.position}" eingetragen (blockiert).`,
        });
        break;
      }
      warnings.push({
        rule: 'absence_warning',
        message: `Konflikt: Mitarbeiter ist "${shift.position}".`,
      });
      break;
    }
  }

  if (workplace?.affects_availability !== false) {
    const rotationPositions = new Set(
      tenantWorkplaces
        .filter((entry) => entry.category === 'Rotationen')
        .map((entry) => entry.name)
        .filter((name): name is string => typeof name === 'string')
    );

    if (workplace?.category === 'Dienste' && workplace?.allows_rotation_concurrently === false) {
      const rotationConflict = sameDayTenantShifts.find((shift) => {
        if (!rotationPositions.has(shift.position)) return false;
        const existingWorkplace = tenantWorkplaces.find((entry) => entry.name === shift.position);
        return existingWorkplace?.affects_availability !== false;
      });

      if (rotationConflict) {
        blockers.push({
          rule: 'rotation_conflict',
          message: `Konflikt: Rotation "${rotationConflict.position}" ist nicht mit diesem Dienst kombinierbar.`,
          rotationShiftId: String(rotationConflict.id),
          rotationPosition: rotationConflict.position,
        });
      }
    }
  }

  const consecutiveMode = workplace?.consecutive_days_mode || 'allowed';
  if (workplace?.category === 'Dienste' && consecutiveMode === 'forbidden') {
    const prevDate = format(addDays(parseISO(normalizedDate), -1), 'yyyy-MM-dd');
    const nextDate = format(addDays(parseISO(normalizedDate), 1), 'yyyy-MM-dd');
    const centralEmployeeIdString = centralEmployeeId ? String(centralEmployeeId) : '';
    const hasConsecutiveSharedShift = existingSharedShiftsForWorkplace.some((shift) =>
      String(shift.employee_id) === centralEmployeeIdString
      && (normalizeDate(shift.date) === prevDate || normalizeDate(shift.date) === nextDate)
    );

    if (hasConsecutiveSharedShift) {
      blockers.push({
        rule: 'consecutive_days',
        message: `"${workplace.name}" ist nicht an aufeinanderfolgenden Tagen erlaubt.`,
      });
    }
  }

  let autoFreiDate: string | null = null;
  if (workplace?.auto_off) {
    autoFreiDate = getSharedShiftAutoFreiDate(normalizedDate, holidayDates);
    if (autoFreiDate) {
      const nextDayShift = tenantShifts.find(
        (shift) => normalizeDate(shift.date) === autoFreiDate && String(shift.doctor_id) === tenantDoctorIdString
      );
      if (nextDayShift && nextDayShift.position !== 'Frei') {
        blockers.push({
          rule: 'auto_off_conflict',
          message: `Folgetag ${autoFreiDate} ist bereits als "${nextDayShift.position}" belegt; automatisches Frei ist erforderlich.`,
        });
      }
    }
  }

  return { blockers, warnings, autoFreiDate };
}
