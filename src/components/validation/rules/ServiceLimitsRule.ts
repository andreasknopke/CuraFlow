import { format, isWeekend, parseISO } from 'date-fns';
import { ValidationRule, type RuleContext, type RuleViolation } from './ValidationRule';

/**
 * Checks if the doctor exceeds their monthly service limits.
 * Warning-only; never blocks. Only applies to Dienste-category positions.
 * Migrated from ShiftValidator._checkServiceLimits.
 */
export class ServiceLimitsRule extends ValidationRule {
    readonly id = 'service_limits';
    readonly severity = 'warning';
    readonly label = 'Dienstlimit';

    applies(ctx: RuleContext): boolean {
        if (ctx.skipLimits) return false;
        const workplace = ctx.validator.workplaces.find(w => w.name === ctx.position);
        return !!(workplace && workplace.category === 'Dienste');
    }

    check(ctx: RuleContext): RuleViolation[] | null {
        const { doctorId, dateStr, position, excludeShiftId, validator: v } = ctx;

        const serviceWorkplaces = v.workplaces.filter(w => w.category === 'Dienste');
        const sortedServices = [...serviceWorkplaces].sort((a, b) => (a.order || 0) - (b.order || 0));

        const foregroundPositions = new Set(serviceWorkplaces.filter(w => w.service_type === 1).map(w => w.name));
        const backgroundPositions = new Set(serviceWorkplaces.filter(w => w.service_type === 2).map(w => w.name));

        // Legacy fallback: if no service_type set, use old convention
        if (foregroundPositions.size === 0 && backgroundPositions.size === 0 && sortedServices.length > 0) {
            foregroundPositions.add(sortedServices[0].name);
            sortedServices.slice(1).forEach(w => backgroundPositions.add(w.name));
        }

        const date = new Date(dateStr);
        const isFG = foregroundPositions.has(position);
        const isBG = backgroundPositions.has(position);
        const isWknd = isWeekend(date) && isFG;

        let countFG = 0, countBG = 0, countWknd = 0;
        const monthStr = format(date, 'yyyy-MM');

        v.shifts.forEach(s => {
            if (s.doctor_id !== doctorId) return;
            if (!s.date.startsWith(monthStr)) return;
            if (s.id === excludeShiftId) return;

            if (foregroundPositions.has(s.position)) {
                countFG++;
                const sDate = parseISO(s.date);
                if (isWeekend(sDate)) countWknd++;
            }
            if (backgroundPositions.has(s.position)) countBG++;
        });

        if (isFG) countFG++;
        if (isBG) countBG++;
        if (isWknd) countWknd++;

        const fte = v._getDoctorFte(doctorId, date);
        if (fte <= 0) return null; // Externally managed or no FTE data — skip limits

        const adjFG = Math.round(v.limits.foreground * fte);
        const adjBG = Math.round(v.limits.background * fte);

        const warnings: string[] = [];
        const fteNote = fte < 1.0 ? `, VK: ${fte}` : '';
        if (isFG && countFG > adjFG) warnings.push(`${countFG}. Bereitschaftsdienst (Limit: ${adjFG}${fteNote})`);
        if (isBG && countBG > adjBG) warnings.push(`${countBG}. Rufbereitschaftsdienst (Limit: ${adjBG}${fteNote})`);
        if (isWknd && countWknd > v.limits.weekend) warnings.push(`${countWknd}. Wochenenddienst (Limit: ${v.limits.weekend})`);

        if (warnings.length > 0) {
            return [{
                ruleId: this.id,
                severity: 'warning',
                message: `Dienstlimit überschritten: ${warnings.join(', ')}`,
                shiftIds: [],
            }];
        }

        return null;
    }
}
