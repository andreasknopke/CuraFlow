import { ValidationRule, type RuleContext, type RuleViolation } from './ValidationRule';
import type { Doctor } from '@/types';

/**
 * Checks if assigning a doctor to a real service (Dienste category) would conflict
 * with an employee relationship that has shift_conflict=true.
 * Only applies to Dienste-category positions (not absences, rotations, etc.).
 * Migrated from ShiftValidator._checkRelationshipConflicts.
 */
export class RelationshipConflictRule extends ValidationRule {
    readonly id = 'relationship_conflict';
    readonly severity = 'warning';
    readonly label = 'Beziehungskonflikt';

    private static readonly ABSENCE_POSITIONS = [
        "Frei", "Krank", "Urlaub", "Schichturlaub", "Dienstreise", "Nicht verfügbar",
        "Fortbildung", "Kongress", "Elternzeit", "Mutterschutz", "Verfügbar"
    ];

    applies(ctx: RuleContext): boolean {
        const { position, validator: v } = ctx;

        // Skip absences
        if (RelationshipConflictRule.ABSENCE_POSITIONS.includes(position)) return false;

        // Only Dienste category
        const workplace = v.workplaces.find(w => w.name === position);
        if (workplace && workplace.category !== 'Dienste') return false;

        // Only if relationship data exists
        if (!v.employeeRelationships || v.employeeRelationships.size === 0) return false;

        return true;
    }

    check(ctx: RuleContext): RuleViolation[] | null {
        const { doctorId, dateStr, excludeShiftId, validator: v } = ctx;

        if (!v.employeeRelationships || v.employeeRelationships.size === 0) return null;

        const doctor = v.doctors.find(d => d.id === doctorId);
        if (!doctor || !doctor.central_employee_id) return null;

        const centralId = String(doctor.central_employee_id);

        const relatedEmployeeIds = v.employeeRelationships.get(centralId);
        if (!relatedEmployeeIds || relatedEmployeeIds.length === 0) return null;

        const conflictingDoctorNames: string[] = [];

        for (const relCentralId of relatedEmployeeIds) {
            const doctorsWithRelation = v.doctors.filter(
                d => String(d.central_employee_id) === relCentralId
            );

            for (const relDoctor of doctorsWithRelation) {
                const hasRealShift = v.shifts.some(s =>
                    s.doctor_id === relDoctor.id
                    && s.date === dateStr
                    && s.id !== excludeShiftId
                    && !RelationshipConflictRule.ABSENCE_POSITIONS.includes(s.position)
                );

                const hasSharedShift = v.sharedShifts.some(s =>
                    String(s.employee_id) === relCentralId
                    && String(s.date).slice(0, 10) === dateStr
                );

                if (hasRealShift || hasSharedShift) {
                    const docName = relDoctor.name || `${(relDoctor as Doctor & { first_name?: string; last_name?: string }).first_name || ''} ${(relDoctor as Doctor & { first_name?: string; last_name?: string }).last_name || ''}`.trim() || 'Unbekannt';
                    conflictingDoctorNames.push(docName);
                }
            }
        }

        if (conflictingDoctorNames.length > 0) {
            const names = [...new Set(conflictingDoctorNames)].join(', ');
            return [{
                ruleId: this.id,
                severity: 'warning',
                message: `Dienstkonflikt: „${names}" hat eine Beziehung mit aktiviertem Dienstkonflikt und ist am selben Tag ebenfalls für einen Dienst eingeteilt.`,
                shiftIds: [],
            }];
        }

        return null;
    }
}
