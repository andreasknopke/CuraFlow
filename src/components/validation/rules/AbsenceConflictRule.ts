import { ValidationRule, type RuleContext, type RuleViolation } from './ValidationRule';

/**
 * Checks if the doctor already has an absence/blocking entry on the same day.
 * Migrated from ShiftValidator._checkAbsenceConflicts.
 */
export class AbsenceConflictRule extends ValidationRule {
    readonly id = 'absence_conflict';
    readonly severity = 'blocker';
    readonly label = 'Abwesenheitskonflikt';

    applies(_ctx: RuleContext): boolean {
        // Always check — the guard for allows_absence_overlap is inside check()
        return true;
    }

    check(ctx: RuleContext): RuleViolation[] | null {
        const { doctorId, dateStr, position, excludeShiftId, validator: v } = ctx;

        const newWorkplace = v.workplaces.find(w => w.name === position);
        if (newWorkplace?.allows_absence_overlap === true) {
            return null;
        }

        const doctorShifts = v.shifts.filter(s =>
            s.doctor_id === doctorId &&
            s.date === dateStr &&
            s.id !== excludeShiftId
        );

        for (const shift of doctorShifts) {
            const isBlocking = v.absenceBlockingRules[shift.position];

            if (typeof isBlocking === 'boolean') {
                if (isBlocking) {
                    return [{
                        ruleId: this.id,
                        severity: 'blocker',
                        message: `Mitarbeiter ist bereits als "${shift.position}" eingetragen (blockiert).`,
                        shiftIds: [shift.id].filter(Boolean),
                    }];
                } else {
                    return [{
                        ruleId: this.id,
                        severity: 'warning',
                        message: `Konflikt: Mitarbeiter ist "${shift.position}".`,
                        shiftIds: [shift.id].filter(Boolean),
                    }];
                }
            }
        }

        return null;
    }
}
