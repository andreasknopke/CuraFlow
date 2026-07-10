import { useState, useCallback, useMemo } from 'react';
import { scanForConflicts } from './scanForConflicts';
import type { ConflictEntry } from './scanForConflicts';
import type { ShiftValidator } from './ShiftValidation';

interface UseConflictScanOptions {
    /** The ShiftValidator instance (from useShiftValidation) */
    validator: ShiftValidator;
    /** The visible date range as YYYY-MM-DD strings */
    dateRange: string[];
    /** Optional map of doctorId → doctorName */
    doctorNames?: Map<string, string>;
}

interface UseConflictScanReturn {
    /** The list of conflicts (empty until scan is triggered) */
    conflicts: ConflictEntry[];
    /** Whether a scan is currently in progress */
    isScanning: boolean;
    /** Trigger a scan. Returns the conflicts. */
    scan: () => ConflictEntry[];
    /** Clear the current conflict list */
    clear: () => void;
}

/**
 * Hook for on-demand conflict scanning.
 *
 * Conflicts are computed only when `scan()` is called (not live).
 * This avoids performance issues with large date ranges (e.g., month view).
 *
 * Usage:
 *   const { conflicts, scan, isScanning, clear } = useConflictScan({
 *     validator,
 *     dateRange: weekDays.map(d => format(d, 'yyyy-MM-dd')),
 *     doctorNames,
 *   });
 */
export function useConflictScan(options: UseConflictScanOptions): UseConflictScanReturn {
    const { validator, dateRange, doctorNames } = options;

    const [conflicts, setConflicts] = useState<ConflictEntry[]>([]);
    const [isScanning, setIsScanning] = useState(false);

    const scan = useCallback((): ConflictEntry[] => {
        setIsScanning(true);
        try {
            const result = scanForConflicts({
                dateRange,
                validator,
                doctorNames,
            });
            setConflicts(result);
            return result;
        } finally {
            setIsScanning(false);
        }
    }, [dateRange, validator, doctorNames]);

    const clear = useCallback(() => {
        setConflicts([]);
    }, []);

    return useMemo(() => ({
        conflicts,
        isScanning,
        scan,
        clear,
    }), [conflicts, isScanning, scan, clear]);
}
