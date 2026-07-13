import { ValidationRule, type RuleContext, type RuleViolation } from './ValidationRule';
import { timeslotsOverlap, createFullDayTimeslot } from '@/utils/timeslotUtils';
import type { WorkplaceTimeslot } from '@/types';

/**
 * Checks if the doctor would have overlapping timeslots on the same day.
 * Only applies when the workplace has timeslots enabled or a timeslotId is given.
 * Migrated from ShiftValidator._checkTimeslotOverlaps.
 */
export class TimeslotOverlapRule extends ValidationRule {
    readonly id = 'timeslot_overlap';
    readonly severity = 'blocker';
    readonly label = 'Zeitkonflikt';

    applies(ctx: RuleContext): boolean {
        return !!(ctx.timeslotId || ctx.validator._workplaceHasTimeslots(ctx.position));
    }

    check(ctx: RuleContext): RuleViolation[] | null {
        const { doctorId, dateStr, position, timeslotId, excludeShiftId, validator: v } = ctx;

        // Helper to format time range
        const formatTimeRange = (slot: WorkplaceTimeslot | null | undefined): string => {
            if (!slot) return '';
            const start = slot.start_time?.substring(0, 5) || '00:00';
            const end = slot.end_time?.substring(0, 5) || '23:59';
            return `${start}-${end}`;
        };

        const doctorShifts = v.shifts.filter(s =>
            s.doctor_id === doctorId &&
            s.date === dateStr &&
            s.id !== excludeShiftId
        );

        if (doctorShifts.length === 0) {
            return null;
        }

        const newTimeslot = timeslotId
            ? v.timeslots.find(t => t.id === timeslotId)
            : null;

        const newWorkplace = v.workplaces.find(w => w.name === position);
        const newEffectiveSlot = newTimeslot ||
            (newWorkplace?.timeslots_enabled ? null : createFullDayTimeslot());

        if (!newEffectiveSlot) {
            return null;
        }

        const tolerance = newTimeslot?.overlap_tolerance_minutes ||
            newWorkplace?.default_overlap_tolerance_minutes || 0;

        for (const existingShift of doctorShifts) {
            const existingTimeslot = existingShift.timeslot_id
                ? v.timeslots.find(t => t.id === existingShift.timeslot_id)
                : null;

            const existingWorkplace = v.workplaces.find(w => w.name === existingShift.position);
            const existingEffectiveSlot = existingTimeslot ||
                (existingWorkplace?.timeslots_enabled ? null : createFullDayTimeslot());

            if (!existingEffectiveSlot) {
                continue;
            }

            if (timeslotsOverlap(newEffectiveSlot, existingEffectiveSlot, tolerance)) {
                const existingLabel = existingTimeslot?.label || existingShift.position;
                const newLabel = newTimeslot?.label || position;
                return [{
                    ruleId: this.id,
                    severity: 'blocker',
                    message: `Zeitkonflikt: "${existingLabel}" überlappt mit "${newLabel}" um ${formatTimeRange(existingEffectiveSlot as any)}.`,
                    shiftIds: [existingShift.id].filter(Boolean),
                }];
            }
        }

        return null;
    }
}
