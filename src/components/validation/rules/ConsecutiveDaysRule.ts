import { format, addDays } from 'date-fns';
import { ValidationRule, type RuleContext, type RuleViolation } from './ValidationRule';
import type { Workplace } from '@/types';

/**
 * Checks if assigning the doctor to this position would create consecutive days.
 * Only applies to Dienste-category positions with consecutive_days_mode === 'forbidden'.
 * Migrated from ShiftValidator._checkConsecutiveDays.
 */
export class ConsecutiveDaysRule extends ValidationRule {
    readonly id = 'consecutive_days';
    readonly severity = 'blocker';
    readonly label = 'Aufeinanderfolgende Tage';

    applies(ctx: RuleContext): boolean {
        const workplace = ctx.validator.workplaces.find(w => w.name === ctx.position);
        if (!workplace || workplace.category !== 'Dienste') return false;

        const mode = workplace.consecutive_days_mode
            || ((workplace as Workplace & { allows_consecutive_days?: boolean }).allows_consecutive_days === false ? 'forbidden' : 'allowed');
        return mode === 'forbidden';
    }

    check(ctx: RuleContext): RuleViolation[] | null {
        const { doctorId, dateStr, position, excludeShiftId, validator: v } = ctx;

        const currentDate = new Date(dateStr);
        const prevDateStr = format(addDays(currentDate, -1), 'yyyy-MM-dd');
        const nextDateStr = format(addDays(currentDate, 1), 'yyyy-MM-dd');

        const hasConsecutive = v.shifts.some(s =>
            s.doctor_id === doctorId &&
            s.position === position &&
            s.id !== excludeShiftId &&
            (s.date === prevDateStr || s.date === nextDateStr)
        );

        if (hasConsecutive) {
            return [{
                ruleId: this.id,
                severity: 'blocker',
                message: `"${position}" ist nicht an aufeinanderfolgenden Tagen erlaubt.`,
                shiftIds: [],
            }];
        }

        return null;
    }
}
