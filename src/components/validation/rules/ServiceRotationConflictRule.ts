import { ValidationRule, type RuleContext, type RuleViolation } from './ValidationRule';
import type { Workplace } from '@/types';

/**
 * Checks if the new assignment conflicts with existing services or rotations.
 * Migrated from ShiftValidator._checkServiceRotationConflicts.
 */
export class ServiceRotationConflictRule extends ValidationRule {
    readonly id = 'service_rotation_conflict';
    readonly severity = 'blocker';
    readonly label = 'Dienst-/Rotationskonflikt';

    applies(_ctx: RuleContext): boolean {
        return true;
    }

    check(ctx: RuleContext): RuleViolation[] | null {
        const { doctorId, dateStr, position, excludeShiftId, validator: v } = ctx;

        const doctorShifts = v.shifts.filter(s =>
            s.doctor_id === doctorId &&
            s.date === dateStr &&
            s.id !== excludeShiftId
        );
        const doctorSharedShifts = v._getDoctorSharedShifts(doctorId, dateStr);

        const newWorkplace = v.workplaces.find(w => w.name === position);

        // If the NEW position doesn't affect availability, skip
        if (newWorkplace?.affects_availability === false) {
            return null;
        }

        const isAvailabilityBlockingNonService = (workplace: Workplace | undefined): boolean => (
            !!workplace
            && workplace.category !== 'Dienste'
            && workplace.affects_availability !== false
        );

        const rotationPositions = v.workplaces.filter(w => w.category === 'Rotationen').map(w => w.name);
        const exclusiveServices = v.workplaces
            .filter(w => w.category === 'Dienste' && (w as Workplace & { allows_rotation_concurrently?: boolean }).allows_rotation_concurrently === false)
            .map(w => w.name);

        const isNewRotation = rotationPositions.includes(position);
        const isNewAvailabilityBlockingNonService = isAvailabilityBlockingNonService(newWorkplace);
        const newServiceWorkplace = v.workplaces.find(w => w.name === position && w.category === 'Dienste');
        const isNewService = !!newServiceWorkplace;

        // New availability-blocking non-service + existing exclusive service
        if (isNewAvailabilityBlockingNonService) {
            const conflict = doctorShifts.find(s => exclusiveServices.includes(s.position));
            if (conflict) {
                return [{
                    ruleId: this.id,
                    severity: 'blocker',
                    message: isNewRotation
                        ? `Konflikt: "${conflict.position}" blockiert Rotation.`
                        : `Konflikt: "${conflict.position}" blockiert diesen Bereich.`,
                    shiftIds: [conflict.id].filter(Boolean),
                }];
            }

            const sharedConflict = doctorSharedShifts.find((shift) =>
                shift.workplace_category === 'Dienste'
                && shift.affects_availability !== false
                && shift.allows_rotation_concurrently === false
            );
            if (sharedConflict) {
                return [{
                    ruleId: this.id,
                    severity: 'blocker',
                    message: isNewRotation
                        ? `Konflikt: "${sharedConflict.workplace_name}" blockiert Rotation.`
                        : `Konflikt: "${sharedConflict.workplace_name}" blockiert diesen Bereich.`,
                    shiftIds: [],
                }];
            }
        }

        // New exclusive service + existing availability-blocking non-service
        if (isNewService && (newServiceWorkplace as Workplace & { allows_rotation_concurrently?: boolean }).allows_rotation_concurrently === false) {
            const conflict = doctorShifts.find(s => {
                const existingWorkplace = v.workplaces.find(w => w.name === s.position);
                return isAvailabilityBlockingNonService(existingWorkplace);
            });
            if (conflict) {
                const existingWorkplace = v.workplaces.find(w => w.name === conflict.position);
                return [{
                    ruleId: this.id,
                    severity: 'blocker',
                    message: existingWorkplace?.category === 'Rotationen'
                        ? `Mitarbeiter ist bereits in Rotation "${conflict.position}" eingetragen.`
                        : `Konflikt: Bereich "${conflict.position}" ist nicht mit diesem Dienst kombinierbar.`,
                    shiftIds: [conflict.id].filter(Boolean),
                }];
            }
        }

        return null;
    }
}
