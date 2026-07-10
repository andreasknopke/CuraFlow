import type { ShiftValidator } from '../ShiftValidation';

// ── Types ──────────────────────────────────────────────────────────────────

/**
 * Structured violation produced by a single validation rule.
 * Carries enough context for the UI to show a "Resolve" button.
 */
export interface RuleViolation {
    /** Stable rule identifier, e.g. 'absence_conflict' */
    ruleId: string;
    /** 'blocker' prevents the action; 'warning' is advisory */
    severity: 'blocker' | 'warning';
    /** Human-readable message (German UI) */
    message: string;
    /** IDs of all shifts involved in this conflict (for "Resolve" buttons) */
    shiftIds: string[];
}

/**
 * All inputs a rule needs to decide whether it applies and to perform its check.
 * The `validator` field gives access to the full ShiftValidator data
 * (shifts, workplaces, doctors, settings, etc.).
 */
export interface RuleContext {
    doctorId: string;
    dateStr: string;
    position: string;
    excludeShiftId: string | null;
    /** Target timeslot ID (for timeslot overlap checks) */
    timeslotId: string | null;
    /** If true, skip service-limit checks */
    skipLimits: boolean;
    /** Reference to the parent validator for data access */
    validator: ShiftValidator;
}

// ── Abstract Base Class ────────────────────────────────────────────────────

/**
 * One validation rule in the registry.
 *
 * Subclass this for every rule. Register all rules in the RULES array.
 * New rules added to RULES automatically appear in the conflict scanner
 * and in the validate() pipeline — no other code changes needed.
 */
export abstract class ValidationRule {
    /** Stable identifier, e.g. 'absence_conflict'. Never change after release. */
    abstract readonly id: string;

    /** Blocker rules prevent the action; warning rules are advisory. */
    abstract readonly severity: 'blocker' | 'warning';

    /** Short label for the UI, e.g. 'Abwesenheitskonflikt' */
    abstract readonly label: string;

    /**
     * Guard: return true if this rule is relevant for the given context.
     * Example: StaffingMinimumsRule only applies when position is an absence type.
     */
    abstract applies(ctx: RuleContext): boolean;

    /**
     * Perform the actual check. Return an array of violations (empty if clean).
     * Return `null` to signal "no violations" (same as empty array, but
     * `flatMap` will skip nulls).
     */
    abstract check(ctx: RuleContext): RuleViolation[] | null;
}
