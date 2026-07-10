/**
 * Rule Registry — the single source of truth for all shift validation rules.
 *
 * To add a new rule:
 * 1. Create a new class extending ValidationRule in this directory
 * 2. Add it to the RULES array below in the desired order
 * 3. That's it — validate() and scanForConflicts() will pick it up automatically
 */
import type { ValidationRule } from './ValidationRule';
import { AbsenceConflictRule } from './AbsenceConflictRule';
import { ServiceRotationConflictRule } from './ServiceRotationConflictRule';
import { ConsecutiveDaysRule } from './ConsecutiveDaysRule';
import { ServiceLimitsRule } from './ServiceLimitsRule';
import { StaffingMinimumsRule } from './StaffingMinimumsRule';
import { VacationOvershootRule } from './VacationOvershootRule';
import { QualificationRule } from './QualificationRule';
import { TimeslotOverlapRule } from './TimeslotOverlapRule';
import { RelationshipConflictRule } from './RelationshipConflictRule';

/**
 * All validation rules in execution order.
 * validate() iterates over this array — rules are checked sequentially.
 */
export const RULES: ValidationRule[] = [
    new AbsenceConflictRule(),
    new ServiceRotationConflictRule(),
    new ConsecutiveDaysRule(),
    new ServiceLimitsRule(),
    new StaffingMinimumsRule(),
    new VacationOvershootRule(),
    new QualificationRule(),
    new TimeslotOverlapRule(),
    new RelationshipConflictRule(),
];

export { ValidationRule } from './ValidationRule';
export type { RuleViolation, RuleContext } from './ValidationRule';
