import type { ShiftValidator } from './ShiftValidation';
import { RULES } from './rules';
import type { RuleViolation, RuleContext } from './rules';

// ── Types ──────────────────────────────────────────────────────────────────

/**
 * A single conflict found by the scanner, ready for UI display.
 */
export interface ConflictEntry {
    /** The shift that was being validated when the conflict was found */
    shiftId: string;
    doctorId: string;
    doctorName: string;
    dateStr: string;
    position: string;
    /** The rule that was violated */
    ruleId: string;
    severity: 'blocker' | 'warning';
    message: string;
    /** All shift IDs involved in this conflict (for "Resolve" buttons) */
    shiftIds: string[];
}

export interface ScanOptions {
    /** The date range to scan, as YYYY-MM-DD strings */
    dateRange: string[];
    /** The ShiftValidator instance with current data */
    validator: ShiftValidator;
    /** Optional map of doctorId → doctorName for display */
    doctorNames?: Map<string, string>;
}

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Build a composite key for deduplication.
 * For symmetric conflicts, we sort the pair to treat A↔B same as B↔A.
 */
function conflictKey(doctorId: string, dateStr: string, ruleId: string, shiftIds: string[]): string {
    const sortedShiftIds = [...shiftIds].sort();
    return `${doctorId}|${dateStr}|${ruleId}|${sortedShiftIds.join(',')}`;
}

// ── Scanner ────────────────────────────────────────────────────────────────

/**
 * Scans all existing shifts in the given date range for rule violations.
 *
 * For each shift in the range, it runs the full RULES pipeline via validate().
 * The result is a deduplicated list of ConflictEntry objects.
 *
 * Because validate() iterates over RULES internally, any new rule added to
 * the RULES array automatically appears in scan results — no additional code.
 *
 * @param options - Scan configuration
 * @returns Deduplicated list of conflicts
 */
export function scanForConflicts(options: ScanOptions): ConflictEntry[] {
    const { dateRange, validator, doctorNames } = options;

    if (!dateRange || dateRange.length === 0) return [];

    const dateSet = new Set(dateRange);
    const conflicts: ConflictEntry[] = [];
    const seen = new Set<string>();

    // Get all shifts in the date range
    const shiftsInRange = validator.shifts.filter(s => dateSet.has(s.date));

    for (const shift of shiftsInRange) {
        if (!shift.doctor_id || !shift.position) continue;

        const doctorId = String(shift.doctor_id);
        const doctorName = doctorNames?.get(doctorId) || doctorId;

        // Build rule context for this shift
        const ctx: RuleContext = {
            doctorId,
            dateStr: shift.date,
            position: shift.position,
            excludeShiftId: shift.id || null,
            timeslotId: shift.timeslot_id || null,
            skipLimits: false,
            validator,
        };

        // Run all rules
        for (const rule of RULES) {
            if (!rule.applies(ctx)) continue;

            const violations = rule.check(ctx);
            if (!violations || violations.length === 0) continue;

            for (const violation of violations) {
                // Collect all involved shift IDs
                const allShiftIds = new Set<string>();
                if (shift.id) allShiftIds.add(shift.id);
                for (const sid of violation.shiftIds) {
                    if (sid) allShiftIds.add(sid);
                }

                const key = conflictKey(doctorId, shift.date, rule.id, [...allShiftIds]);

                if (seen.has(key)) continue;
                seen.add(key);

                conflicts.push({
                    shiftId: shift.id || '',
                    doctorId,
                    doctorName,
                    dateStr: shift.date,
                    position: shift.position,
                    ruleId: violation.ruleId,
                    severity: violation.severity,
                    message: violation.message,
                    shiftIds: [...allShiftIds],
                });
            }
        }
    }

    // Sort: blockers first, then by date, then by doctor name
    conflicts.sort((a, b) => {
        if (a.severity !== b.severity) {
            return a.severity === 'blocker' ? -1 : 1;
        }
        if (a.dateStr !== b.dateStr) {
            return a.dateStr.localeCompare(b.dateStr);
        }
        return a.doctorName.localeCompare(b.doctorName);
    });

    return conflicts;
}
