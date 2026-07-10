import { ValidationRule, type RuleContext, type RuleViolation } from './ValidationRule';
import type { Doctor } from '@/types';
import { computeVacationBalance } from '@/components/vacation/vacationBalance';

/**
 * Checks if assigning an "Urlaub" shift would exceed the doctor's annual vacation entitlement.
 * Only applies when position is exactly 'Urlaub'.
 * Migrated from ShiftValidator._checkVacationOvershoot.
 */
export class VacationOvershootRule extends ValidationRule {
    readonly id = 'vacation_overshoot';
    readonly severity = 'warning';
    readonly label = 'Urlaubskontingent';

    applies(ctx: RuleContext): boolean {
        return ctx.position === 'Urlaub';
    }

    check(ctx: RuleContext): RuleViolation[] | null {
        const { doctorId, dateStr, excludeShiftId, validator: v } = ctx;

        const doctor = v.doctors.find(d => d.id === doctorId);
        if (!doctor) return null;

        const year = Number(String(dateStr).slice(0, 4));
        const holidays = v.getPublicHolidayDatesForYear(year) || null;

        const existingUrlaub = v.shifts.filter((s) =>
            s.doctor_id === doctorId
            && s.position === 'Urlaub'
            && s.id !== excludeShiftId
        );

        const balance = computeVacationBalance({
            shifts: existingUrlaub,
            year,
            annualVacationDays: (doctor as Doctor & { vacation_days?: number }).vacation_days,
            publicHolidayDates: holidays,
            candidateDate: dateStr,
        });

        if (!balance.overshoot) return null;

        const days = Math.abs(balance.remaining);
        return [{
            ruleId: this.id,
            severity: 'warning',
            message: `Urlaubskontingent überschritten: ${days} Tag${days === 1 ? '' : 'e'} über dem Jahresanspruch (${balance.total} Tage).`,
            shiftIds: [],
        }];
    }
}
