import { addDays, format, parseISO } from 'date-fns';

const DEFAULT_ABSENCE_BLOCKING_RULES = {
  Urlaub: true,
  Krank: true,
  Frei: true,
  Dienstreise: false,
  'Nicht verfügbar': false,
};

function normalizeDate(dateValue) {
  return typeof dateValue === 'string' ? dateValue.slice(0, 10) : String(dateValue || '').slice(0, 10);
}

export function getSharedShiftAutoFreiDate(dateStr, holidayDates = new Set()) {
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

export function buildSharedShiftAutoFreiMarker(shiftId) {
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
  holidayDates = new Set(),
}) {
  const blockers = [];
  const warnings = [];
  const normalizedDate = normalizeDate(dateStr);
  const sameDayTenantShifts = tenantShifts.filter(
    (shift) => normalizeDate(shift.date) === normalizedDate && String(shift.doctor_id) === String(tenantDoctorId)
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
    const hasConsecutiveSharedShift = existingSharedShiftsForWorkplace.some((shift) =>
      String(shift.employee_id) === String(centralEmployeeId)
      && (normalizeDate(shift.date) === prevDate || normalizeDate(shift.date) === nextDate)
    );

    if (hasConsecutiveSharedShift) {
      blockers.push({
        rule: 'consecutive_days',
        message: `"${workplace.name}" ist nicht an aufeinanderfolgenden Tagen erlaubt.`,
      });
    }
  }

  let autoFreiDate = null;
  if (workplace?.auto_off) {
    autoFreiDate = getSharedShiftAutoFreiDate(normalizedDate, holidayDates);
    if (autoFreiDate) {
      const nextDayShift = tenantShifts.find(
        (shift) => normalizeDate(shift.date) === autoFreiDate && String(shift.doctor_id) === String(tenantDoctorId)
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
