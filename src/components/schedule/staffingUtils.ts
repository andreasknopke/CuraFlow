import type { Doctor, StaffingPlanEntry, Workplace } from '@/types';

// ── Local types for cross-tenant shifts ────────────────────────────────────

interface SharedShift {
  employee_id?: number | string | null;
  date?: string | null;
  workplace_category?: string | null;
  affects_availability?: boolean | null;
  allows_rotation_concurrently?: boolean | null;
}

// ── Module-level constants ─────────────────────────────────────────────────

const STAFFING_PLAN_UNAVAILABLE_CODES = new Set(['KO', 'EZ', 'MS', 'BV']);
const STAFFING_PLAN_ZERO_FTE_AVAILABLE_CODES = new Set(['OU']);
const STAFFING_PLAN_OCCUPIED_UNAVAILABLE_CODES = new Set(['BV']);

// ── Private helpers ────────────────────────────────────────────────────────

function parseFteValue(value: string | number | null | undefined): number | null {
    const normalized = String(value).trim().replace(',', '.');
    const parsed = parseFloat(normalized);
    return Number.isNaN(parsed) ? null : parsed;
}

function getLastNumericFteBeforeMonth(doctor: Doctor, year: number, month: number, planEntries: StaffingPlanEntry[]): number {
    for (let m = month - 1; m >= 1; m--) {
        const entry = planEntries.find(e => e.doctor_id === doctor.id && e.year === year && e.month === m);
        const entryValue = typeof entry?.value === 'string' ? entry.value.trim() : entry?.value;
        const value = entryValue !== undefined && entryValue !== null && entryValue !== ''
            ? String(entryValue).trim()
            : (doctor.fte !== undefined && doctor.fte !== null && String(doctor.fte).trim() !== ''
                ? String(doctor.fte).trim()
                : '1.0');

        if (STAFFING_PLAN_OCCUPIED_UNAVAILABLE_CODES.has(value)) {
            continue;
        }

        if (STAFFING_PLAN_UNAVAILABLE_CODES.has(value) || STAFFING_PLAN_ZERO_FTE_AVAILABLE_CODES.has(value)) {
            continue;
        }

        const parsed = parseFteValue(value);
        if (parsed !== null && parsed > 0.0001) {
            return parsed;
        }
    }

    const doctorFte = doctor.fte !== undefined && doctor.fte !== null && String(doctor.fte).trim() !== ''
        ? String(doctor.fte).trim()
        : '1.0';
    const parsed = parseFteValue(doctorFte);
    return parsed !== null && parsed > 0.0001 ? parsed : 0;
}

function getDefaultFte(doctor: Doctor): number {
    if (doctor.fte !== undefined && doctor.fte !== null && String(doctor.fte).trim() !== '') {
        const parsed = parseFteValue(doctor.fte);
        if (parsed !== null) return parsed;
    }
    return 1.0;
}

function getMonthEntry(doctor: Doctor, year: number, month: number, planEntries: StaffingPlanEntry[]): StaffingPlanEntry | undefined {
    return planEntries.find(e => e.doctor_id === doctor.id && e.year === year && e.month === month);
}

function getEntryValue(entry: StaffingPlanEntry | undefined, _doctor: Doctor): string | null {
    const entryValue = typeof entry?.value === 'string' ? entry.value.trim() : entry?.value;
    if (entryValue !== undefined && entryValue !== null && entryValue !== '') {
        return String(entryValue).trim();
    }
    return null;
}

function getEntryStatusStartDay(entry: StaffingPlanEntry | undefined): number | null {
    const day = entry?.status_start_day;
    if (day === undefined || day === null || (day as any) === '') return null;
    const parsed = parseInt(String(day), 10);
    return Number.isNaN(parsed) ? null : parsed;
}

function getEntryStatusEndDay(entry: StaffingPlanEntry | undefined): number | null {
    const day = entry?.status_end_day;
    if (day === undefined || day === null || (day as any) === '') return null;
    const parsed = parseInt(String(day), 10);
    return Number.isNaN(parsed) ? null : parsed;
}

function getDaysInMonth(year: number, month: number): number {
    return new Date(year, month, 0).getDate();
}

function isDateInStatusRange(date: Date, entry: StaffingPlanEntry | undefined): boolean {
    if (!entry) return false;
    const startDay = getEntryStatusStartDay(entry);
    const endDay = getEntryStatusEndDay(entry);
    if (startDay === null && endDay === null) return true;

    const dayOfMonth = date.getDate();
    if (startDay !== null && dayOfMonth < startDay) return false;
    if (endDay !== null && dayOfMonth > endDay) return false;
    return true;
}

// ── Exported functions ─────────────────────────────────────────────────────

export function getDoctorEffectiveFte(doctor: Doctor, date: Date, planEntries: StaffingPlanEntry[]): number {
    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    const entry = getMonthEntry(doctor, year, month, planEntries);
    const value = getEntryValue(entry, doctor);

    if (value === null) {
        return getDefaultFte(doctor);
    }

    const normalizedValue = String(value).trim();
    const defaultFte = getDefaultFte(doctor);
    const statusRatio = isDateInStatusRange(date, entry) ? 1 : 0;

    if (STAFFING_PLAN_OCCUPIED_UNAVAILABLE_CODES.has(normalizedValue)) {
        const statusFte = getLastNumericFteBeforeMonth(doctor, year, month, planEntries);
        if (statusRatio === 1) return statusFte;
        return defaultFte;
    }

    if (STAFFING_PLAN_UNAVAILABLE_CODES.has(normalizedValue)) {
        if (statusRatio === 1) return 0;
        return defaultFte;
    }

    if (STAFFING_PLAN_ZERO_FTE_AVAILABLE_CODES.has(normalizedValue)) {
        if (statusRatio === 1) return 0;
        return defaultFte;
    }

    const parsedFte = parseFteValue(normalizedValue);
    if (parsedFte === null) {
        return 0;
    }

    if (statusRatio === 0) {
        return defaultFte;
    }

    return parsedFte;
}

export function getMonthlyEffectiveFte(doctor: Doctor, year: number, month: number, planEntries: StaffingPlanEntry[]): number {
    const entry = getMonthEntry(doctor, year, month, planEntries);
    const value = getEntryValue(entry, doctor);

    if (value === null) {
        return getDefaultFte(doctor);
    }

    const normalizedValue = String(value).trim();
    const defaultFte = getDefaultFte(doctor);
    const daysInMonth = getDaysInMonth(year, month);

    const startDay = getEntryStatusStartDay(entry);
    const endDay = getEntryStatusEndDay(entry);

    if (startDay === null && endDay === null) {
        if (STAFFING_PLAN_OCCUPIED_UNAVAILABLE_CODES.has(normalizedValue)) {
            return getLastNumericFteBeforeMonth(doctor, year, month, planEntries);
        }
        if (STAFFING_PLAN_UNAVAILABLE_CODES.has(normalizedValue) || STAFFING_PLAN_ZERO_FTE_AVAILABLE_CODES.has(normalizedValue)) {
            return 0;
        }
        const parsedFte = parseFteValue(normalizedValue);
        return parsedFte === null ? 0 : parsedFte;
    }

    const effectiveStart = startDay !== null ? startDay : 1;
    const effectiveEnd = endDay !== null ? endDay : daysInMonth;
    const statusDays = Math.max(0, effectiveEnd - effectiveStart + 1);
    const nonStatusDays = daysInMonth - statusDays;

    let statusFte = 0;
    if (STAFFING_PLAN_OCCUPIED_UNAVAILABLE_CODES.has(normalizedValue)) {
        statusFte = getLastNumericFteBeforeMonth(doctor, year, month, planEntries);
    } else if (STAFFING_PLAN_UNAVAILABLE_CODES.has(normalizedValue) || STAFFING_PLAN_ZERO_FTE_AVAILABLE_CODES.has(normalizedValue)) {
        statusFte = 0;
    } else {
        const parsedFte = parseFteValue(normalizedValue);
        statusFte = parsedFte === null ? 0 : parsedFte;
    }

    return (statusFte * statusDays + defaultFte * nonStatusDays) / daysInMonth;
}

export function getStatusCodeRatioForMonth(doctor: Doctor, year: number, month: number, planEntries: StaffingPlanEntry[]): number {
    const entry = getMonthEntry(doctor, year, month, planEntries);
    const value = getEntryValue(entry, doctor);

    if (value === null) {
        return 0;
    }

    const normalizedValue = String(value).trim();
    if (!STAFFING_PLAN_UNAVAILABLE_CODES.has(normalizedValue) && !STAFFING_PLAN_ZERO_FTE_AVAILABLE_CODES.has(normalizedValue)) {
        return 0;
    }

    const startDay = getEntryStatusStartDay(entry);
    const endDay = getEntryStatusEndDay(entry);

    if (startDay === null && endDay === null) {
        return 1;
    }

    const daysInMonth = getDaysInMonth(year, month);
    const effectiveStart = startDay !== null ? startDay : 1;
    const effectiveEnd = endDay !== null ? endDay : daysInMonth;
    const statusDays = Math.max(0, effectiveEnd - effectiveStart + 1);
    return statusDays / daysInMonth;
}

function getStaffingPlanValue(doctor: Doctor, date: Date, planEntries: StaffingPlanEntry[]): string {
    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    const entry = getMonthEntry(doctor, year, month, planEntries);
    const value = getEntryValue(entry, doctor);
    if (value !== null) {
        return value;
    }

    if (doctor.fte !== undefined && doctor.fte !== null && String(doctor.fte).trim() !== '') {
        return String(doctor.fte).trim();
    }

    return '1.0';
}

export function isDoctorAvailable(doctor: Doctor, date: Date, planEntries: StaffingPlanEntry[]): boolean {
    // Check contract end
    if (doctor.contract_end_date) {
        const endDate = new Date(doctor.contract_end_date);
        endDate.setHours(0,0,0,0);
        const checkDate = new Date(date);
        checkDate.setHours(0,0,0,0);

        // If the date is strictly AFTER the end date, doctor is unavailable
        if (checkDate > endDate) return false;
    }

    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    const entry = getMonthEntry(doctor, year, month, planEntries);
    const value = getStaffingPlanValue(doctor, date, planEntries);

    if (STAFFING_PLAN_ZERO_FTE_AVAILABLE_CODES.has(value)) {
        if (isDateInStatusRange(date, entry)) return true;
        return getDoctorEffectiveFte(doctor, date, planEntries) > 0.0001;
    }

    if (STAFFING_PLAN_UNAVAILABLE_CODES.has(value)) {
        if (isDateInStatusRange(date, entry)) return false;
        return getDoctorEffectiveFte(doctor, date, planEntries) > 0.0001;
    }

    if (!isDateInStatusRange(date, entry)) {
        return getDefaultFte(doctor) > 0.0001;
    }

    return getDoctorEffectiveFte(doctor, date, planEntries) > 0.0001;
}

function blocksAvailability({ category, affectsAvailability, allowsRotationConcurrently }: {
    category?: string | null;
    affectsAvailability?: boolean | null;
    allowsRotationConcurrently?: boolean | null;
}): boolean {
    if (affectsAvailability === false) return false;
    if (allowsRotationConcurrently === true) return false;
    if (allowsRotationConcurrently === false) return true;
    if (['Dienste', 'Demonstrationen & Konsile'].includes(category || '')) return false;
    return true;
}

interface AvailabilityBlockingParams {
    localShifts?: Array<{ doctor_id?: string | null; date?: string | null; position?: string | null }>;
    sharedShifts?: SharedShift[];
    workplaces?: Workplace[];
    doctors?: Doctor[];
}

export function getAvailabilityBlockingDoctorIdsByDate(
    { localShifts = [], sharedShifts = [], workplaces = [], doctors = [] }: AvailabilityBlockingParams,
): Map<string, Set<string>> {
    const workplaceByName = new Map(workplaces.map((workplace) => [workplace.name, workplace]));
    const doctorIdsByCentralEmployeeId = new Map<string, string[]>();

    doctors.forEach((doctor) => {
        if (!doctor?.central_employee_id) return;
        const key = String(doctor.central_employee_id);
        const existingDoctorIds = doctorIdsByCentralEmployeeId.get(key) || [];
        existingDoctorIds.push(doctor.id);
        doctorIdsByCentralEmployeeId.set(key, existingDoctorIds);
    });

    const blockingDoctorIdsByDate = new Map<string, Set<string>>();

    const addDoctorId = (dateStr: string, doctorId: string) => {
        if (!dateStr || doctorId === undefined || doctorId === null) return;
        const existingDoctorIds = blockingDoctorIdsByDate.get(dateStr) || new Set();
        existingDoctorIds.add(doctorId);
        blockingDoctorIdsByDate.set(dateStr, existingDoctorIds);
    };

    localShifts.forEach((shift) => {
        const workplace = workplaceByName.get(shift?.position || '');
        if (!blocksAvailability({
            category: workplace?.category,
            affectsAvailability: workplace?.affects_availability,
            allowsRotationConcurrently: workplace?.allows_rotation_concurrently,
        })) {
            return;
        }

        addDoctorId(String(shift?.date).slice(0, 10), shift?.doctor_id || '');
    });

    sharedShifts.forEach((shift) => {
        if (!blocksAvailability({
            category: shift?.workplace_category,
            affectsAvailability: shift?.affects_availability,
            allowsRotationConcurrently: shift?.allows_rotation_concurrently,
        })) {
            return;
        }

        const mappedDoctorIds = doctorIdsByCentralEmployeeId.get(String(shift?.employee_id)) || [];
        mappedDoctorIds.forEach((doctorId) => addDoctorId(String(shift?.date).slice(0, 10), doctorId));
    });

    return blockingDoctorIdsByDate;
}

/**
 * Calculates the weekly target working hours for a doctor, adjusted for public holidays.
 * @param fte - Full-time equivalent (e.g., 1.0, 0.75)
 * @param weekStart - Monday of the week
 * @param holidays - Array of public holiday dates in 'YYYY-MM-DD' format that fall within the week
 * @param fullTimeWeeklyHours - Full-time weekly hours for 1.0 FTE (default: 40)
 * @param workDaysPerWeek - Number of working days per week (default: 5)
 * @returns Adjusted target weekly hours
 */
export function calculateWeeklyTargetHours(
    fte: number,
    weekStart: Date,
    holidays: string[] = [],
    fullTimeWeeklyHours: number = 40,
    workDaysPerWeek: number = 5,
): number {
  const baseWeeklyHours = fullTimeWeeklyHours * fte;
  const dailyHours = (fullTimeWeeklyHours / workDaysPerWeek) * fte;
  // Count holidays that fall on working days (Mon-Fri)
  const holidayCount = holidays.filter(holidayDate => {
    const holiday = new Date(holidayDate);
    const day = holiday.getDay();
    // Monday=1 ... Friday=5, Sunday=0
    return day >= 1 && day <= 5;
  }).length;
  return baseWeeklyHours - (holidayCount * dailyHours);
}
