import { ValidationRule, type RuleContext, type RuleViolation } from './ValidationRule';
import type { Workplace } from '@/types';

/**
 * Checks if the doctor meets the qualification requirements of the workplace.
 * Can produce both blockers (missing mandatory quals) and warnings (preferred/discouraged).
 * Migrated from ShiftValidator._checkQualificationRequirements.
 */
export class QualificationRule extends ValidationRule {
    readonly id = 'qualification_requirements';
    readonly severity = 'blocker'; // Default; individual violations set their own severity
    readonly label = 'Qualifikation';

    applies(ctx: RuleContext): boolean {
        const workplace = ctx.validator.workplaces.find(w => w.name === ctx.position);
        if (!workplace) return false;
        const wpQuals = ctx.validator.wpQualsByWorkplace[workplace.id] || [];
        return wpQuals.length > 0;
    }

    check(ctx: RuleContext): RuleViolation[] | null {
        const { doctorId, dateStr, position, excludeShiftId, validator: v } = ctx;

        const workplace = v.workplaces.find(w => w.name === position);
        if (!workplace) return null;

        const wpQuals = v.wpQualsByWorkplace[workplace.id] || [];
        if (wpQuals.length === 0) return null;

        const docQualIds = v.getDoctorQualIds(doctorId);
        const violations: RuleViolation[] = [];

        // Excluded qualifications: hard blocker (not override-able)
        const excludedQuals = wpQuals.filter(wq => !wq.is_mandatory && wq.is_excluded);
        if (excludedQuals.length > 0) {
            const violatedExclusions = excludedQuals.filter(wq => docQualIds.includes(wq.qualification_id));
            if (violatedExclusions.length > 0) {
                const names = violatedExclusions
                    .map(wq => v.qualificationMap[wq.qualification_id]?.name || '?')
                    .join(', ');
                violations.push({
                    ruleId: this.id,
                    severity: 'blocker',
                    message: `Ausgeschlossen: Mitarbeiter hat Ausschlusskriterium „${names}" – darf hier nicht eingeteilt werden.`,
                    shiftIds: [],
                });
                return violations; // Hard blocker — stop here
            }
        }

        // Discouraged qualifications: employees marked as "should not" have this qual
        const discouragedQuals = wpQuals.filter(wq => wq.is_mandatory && wq.is_excluded);
        const violatedDiscouraged = discouragedQuals.filter(wq => docQualIds.includes(wq.qualification_id));

        const mandatoryQuals = wpQuals.filter(wq => wq.is_mandatory && !wq.is_excluded);
        const preferredQuals = wpQuals.filter(wq => !wq.is_mandatory && !wq.is_excluded);

        // Training mode: if another qualified colleague is already assigned, skip checks
        const allowsMultiple = v._workplaceAllowsMultiple(workplace);
        if (dateStr && allowsMultiple) {
            const otherAssignments = v.shifts.filter(s =>
                s.position === position &&
                s.date === dateStr &&
                s.doctor_id !== doctorId &&
                s.id !== excludeShiftId
            );

            if (otherAssignments.length > 0) {
                // Only mandatory quals are required for the "qualified colleague" check
                const mandatoryQualIds = mandatoryQuals.map(wq => wq.qualification_id);
                const hasQualifiedColleague = otherAssignments.some(s => {
                    const colleagueQuals = v.getDoctorQualIds(s.doctor_id || '');
                    return mandatoryQualIds.every(qid => colleagueQuals.includes(qid));
                });

                if (hasQualifiedColleague) {
                    return null;
                }
            }
        }

        // Mandatory qualifications: blocker if missing
        const missingMandatory = mandatoryQuals.filter(wq => !docQualIds.includes(wq.qualification_id));
        if (missingMandatory.length > 0) {
            const names = missingMandatory
                .map(wq => v.qualificationMap[wq.qualification_id]?.name || '?')
                .join(', ');
            violations.push({
                ruleId: this.id,
                severity: 'blocker',
                message: `Fehlende Pflicht-Qualifikation: ${names}`,
                shiftIds: [],
            });
            return violations;
        }

        // Discouraged qualifications: warning
        if (violatedDiscouraged.length > 0) {
            const names = violatedDiscouraged
                .map(wq => v.qualificationMap[wq.qualification_id]?.name || '?')
                .join(', ');
            violations.push({
                ruleId: this.id,
                severity: 'warning',
                message: `Sollte nicht: Mitarbeiter hat Qualifikation „${names}" – nur zuweisen wenn kein anderer verfügbar.`,
                shiftIds: [],
            });
        }

        // Preferred qualifications: warning if doctor doesn't have them
        if (preferredQuals.length > 0) {
            const missingPreferred = preferredQuals.filter(wq => !docQualIds.includes(wq.qualification_id));
            if (missingPreferred.length > 0) {
                const names = missingPreferred
                    .map(wq => v.qualificationMap[wq.qualification_id]?.name || '?')
                    .join(', ');
                violations.push({
                    ruleId: this.id,
                    severity: 'warning',
                    message: `Fehlende Sollte-Qualifikation: ${names} – nur zuweisen wenn kein qualifizierter Arzt verfügbar.`,
                    shiftIds: [],
                });
            }
        }

        return violations.length > 0 ? violations : null;
    }
}
