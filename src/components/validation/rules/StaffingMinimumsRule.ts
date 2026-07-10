import { ValidationRule, type RuleContext, type RuleViolation } from './ValidationRule';

/**
 * Checks if assigning an absence would drop staffing below minimums.
 * Only applies for absence-type positions.
 * Migrated from ShiftValidator._checkStaffingMinimums.
 */
export class StaffingMinimumsRule extends ValidationRule {
    readonly id = 'staffing_minimums';
    readonly severity = 'warning';
    readonly label = 'Mindestbesetzung';

    private static readonly ABSENCE_POSITIONS = [
        "Frei", "Krank", "Urlaub", "Schichturlaub", "Dienstreise", "Nicht verfügbar"
    ];

    applies(ctx: RuleContext): boolean {
        return StaffingMinimumsRule.ABSENCE_POSITIONS.includes(ctx.position);
    }

    check(ctx: RuleContext): RuleViolation[] | null {
        const { doctorId, dateStr, excludeShiftId, validator: v } = ctx;

        const doctor = v.doctors.find(d => d.id === doctorId);
        if (!doctor) return null;
        if (!v.staffingMinimums || v.staffingMinimums.length === 0) return null;

        // Count current absences on this date (excluding this one)
        const absentOnDate = v.shifts.filter(s =>
            s.date === dateStr &&
            StaffingMinimumsRule.ABSENCE_POSITIONS.includes(s.position) &&
            s.id !== excludeShiftId
        ).map(s => s.doctor_id || '');

        // Add the new absence
        const allAbsent = new Set([...absentOnDate, doctorId]);

        const warnings: string[] = [];

        v.staffingMinimums.forEach(threshold => {
            const qId = threshold.qualificationId;
            const qualName = threshold.qualificationName || v.qualificationMap[qId]?.name || qId;
            const minCount = threshold.min;

            const docsWithQual = v.doctors.filter(d => {
                const qualIds = v.getDoctorQualIds(d.id);
                return qualIds.includes(qId);
            });

            const total = docsWithQual.length;
            const absent = docsWithQual.filter(d => allAbsent.has(d.id)).length;
            const present = total - absent;

            if (present < minCount) {
                warnings.push(`Nur ${present} ${qualName} anwesend (Min: ${minCount})`);
            }
        });

        if (warnings.length > 0) {
            return [{
                ruleId: this.id,
                severity: 'warning',
                message: `Mindestbesetzung unterschritten: ${warnings.join(', ')}`,
                shiftIds: [],
            }];
        }

        return null;
    }
}
