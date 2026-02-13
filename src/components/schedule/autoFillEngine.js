/**
 * Deterministic Auto-Fill Engine for the Schedule Board.
 * 
 * Generates shift suggestions based on:
 * 1. Active days (incl. holidays as Sunday)
 * 2. Qualifications (mandatory requirements)
 * 3. Training rotations (highest priority assignments)
 * 4. Fair distribution among available staff
 * 5. min_staff / optimal_staff per workplace
 */

/**
 * Main entry point for generating schedule suggestions.
 * 
 * @param {Object} params
 * @param {Date[]} params.weekDays - All 7 days of the week (Mon-Sun)
 * @param {Object[]} params.doctors - All doctors
 * @param {Object[]} params.workplaces - All workplaces
 * @param {Object[]} params.existingShifts - Already assigned shifts for the week
 * @param {Object[]} params.trainingRotations - Training rotation assignments
 * @param {Function} params.isPublicHoliday - (date) => truthy if public holiday
 * @param {Function} params.getDoctorQualIds - (doctorId) => [qualificationId, ...]
 * @param {Function} params.getWpRequiredQualIds - (workplaceId) => [qualificationId, ...]
 * @param {string[]} params.categoriesToFill - Which categories to generate for, e.g. ['Rotationen', 'Dienste']
 * @param {Object[]} params.systemSettings - System settings array
 * @returns {Object[]} Array of suggested shifts: { date, position, doctor_id, isPreview: true }
 */
export function generateSuggestions({
    weekDays,
    doctors,
    workplaces,
    existingShifts,
    trainingRotations,
    isPublicHoliday,
    getDoctorQualIds,
    getWpRequiredQualIds,
    categoriesToFill,
    systemSettings,
}) {
    const suggestions = [];
    const absencePositions = ['Frei', 'Krank', 'Urlaub', 'Dienstreise', 'Nicht verfügbar'];

    // Determine default active_days
    const DEFAULT_ACTIVE_DAYS = [1, 2, 3, 4, 5]; // Mo-Fr

    // Helper: get effective active days for a workplace
    const getActiveDays = (wp) => {
        return (wp.active_days && wp.active_days.length > 0) ? wp.active_days : DEFAULT_ACTIVE_DAYS;
    };

    // Helper: check if workplace is active on a date
    const isActiveOnDate = (wp, date, dateStr) => {
        const activeDays = getActiveDays(wp);
        const dayOfWeek = date.getDay();
        // Holiday = treat as Sunday
        if (isPublicHoliday(date) && !activeDays.some(d => Number(d) === 0)) {
            return false;
        }
        return activeDays.some(d => Number(d) === dayOfWeek);
    };

    // Helper: check if doctor is available on a date
    const isDoctorAvailable = (doctorId, dateStr, existingSet, suggestionsSet) => {
        // Check absences and blocking assignments in existing shifts
        const hasAbsence = existingShifts.some(s => 
            s.date === dateStr && s.doctor_id === doctorId && absencePositions.includes(s.position)
        );
        if (hasAbsence) return false;

        // Check if doctor is already fully occupied
        // A doctor assigned to a workplace that affects_availability is "occupied"
        const blockingShifts = existingShifts.filter(s => {
            if (s.date !== dateStr || s.doctor_id !== doctorId) return false;
            const wp = workplaces.find(w => w.name === s.position);
            // Absences always block
            if (absencePositions.includes(s.position)) return true;
            // If affects_availability is false -> not blocking
            if (wp?.affects_availability === false) return false;
            // If allows_rotation_concurrently -> not blocking for rotations
            if (wp?.allows_rotation_concurrently) return false;
            // Default: Dienste/Demos don't block rotations
            if (wp && ['Dienste', 'Demonstrationen & Konsile'].includes(wp.category)) return false;
            return true;
        });
        if (blockingShifts.length > 0) return false;

        // Check if already suggested for a blocking position on this day
        const hasSuggestion = suggestionsSet.some(s => {
            if (s.date !== dateStr || s.doctor_id !== doctorId) return false;
            const wp = workplaces.find(w => w.name === s.position);
            if (wp?.affects_availability === false) return false;
            if (wp?.allows_rotation_concurrently) return false;
            if (wp && ['Dienste', 'Demonstrationen & Konsile'].includes(wp.category)) return false;
            return true;
        });
        if (hasSuggestion) return false;

        return true;
    };

    // Helper: check if a doctor is already assigned to a position on a date
    const isAlreadyAssigned = (doctorId, dateStr, position, existingSet, suggestionsSet) => {
        return existingSet.some(s => s.date === dateStr && s.doctor_id === doctorId && s.position === position) ||
               suggestionsSet.some(s => s.date === dateStr && s.doctor_id === doctorId && s.position === position);
    };

    // Helper: count current assignments for a position on a date
    const countAssignments = (dateStr, position, existingSet, suggestionsSet) => {
        const existing = existingSet.filter(s => s.date === dateStr && s.position === position).length;
        const suggested = suggestionsSet.filter(s => s.date === dateStr && s.position === position).length;
        return existing + suggested;
    };

    // Helper: check if doctor has required qualifications for a workplace
    const isQualified = (doctorId, workplaceId) => {
        const requiredQuals = getWpRequiredQualIds(workplaceId);
        if (requiredQuals.length === 0) return true;
        const docQuals = getDoctorQualIds(doctorId);
        return requiredQuals.every(qId => docQuals.includes(qId));
    };

    // Helper: get allows_multiple for a workplace
    const allowsMultiple = (wp) => {
        if (wp.allows_multiple !== undefined && wp.allows_multiple !== null) {
            return wp.allows_multiple;
        }
        // Category defaults
        if (wp.category === 'Rotationen') return true;
        if (wp.category === 'Dienste' || wp.category === 'Demonstrationen & Konsile') return false;
        // Custom category default
        const catSetting = systemSettings.find(s => s.key === 'workplace_categories');
        if (catSetting?.value) {
            try {
                const parsed = JSON.parse(catSetting.value);
                const cats = Array.isArray(parsed) && parsed.length > 0 && typeof parsed[0] === 'string'
                    ? parsed.map(name => ({ name, allows_multiple: true }))
                    : parsed;
                const catConfig = cats.find(c => c.name === wp.category);
                if (catConfig) return catConfig.allows_multiple ?? true;
            } catch {}
        }
        return true;
    };

    // Helper: get staffing config
    const getStaffingConfig = (wp) => {
        const optimalStaff = wp.optimal_staff ?? 1;
        const minStaff = wp.min_staff ?? 1;
        return { optimalStaff, minStaff };
    };

    // Track weekly assignment counts per doctor per position (for fair distribution)
    const weeklyAssignmentCount = {}; // doctorId -> count of suggestions
    const getWeeklyCount = (doctorId) => weeklyAssignmentCount[doctorId] || 0;
    const incrementWeeklyCount = (doctorId) => {
        weeklyAssignmentCount[doctorId] = (weeklyAssignmentCount[doctorId] || 0) + 1;
    };

    // Track rotation assignments per modality per week for parity
    const rotationWeeklyCounts = {}; // `modality__doctorId` -> count
    const getRotationCount = (modality, doctorId) => rotationWeeklyCounts[`${modality}__${doctorId}`] || 0;
    const incrementRotationCount = (modality, doctorId) => {
        rotationWeeklyCounts[`${modality}__${doctorId}`] = (rotationWeeklyCounts[`${modality}__${doctorId}`] || 0) + 1;
    };

    // Count existing rotation assignments for parity baseline
    for (const shift of existingShifts) {
        const wp = workplaces.find(w => w.name === shift.position);
        if (wp?.category === 'Rotationen') {
            incrementRotationCount(wp.name, shift.doctor_id);
        }
    }

    // Build workplace list filtered by requested categories
    const targetWorkplaces = workplaces.filter(wp => categoriesToFill.includes(wp.category));

    // Sort workplaces by priority: 
    // 1. Single-assignment first (more constrained)
    // 2. By min_staff descending (higher demand first)
    // 3. Workplaces with qualification requirements first (more constrained)
    const sortedWorkplaces = [...targetWorkplaces].sort((a, b) => {
        const aMulti = allowsMultiple(a) ? 1 : 0;
        const bMulti = allowsMultiple(b) ? 1 : 0;
        if (aMulti !== bMulti) return aMulti - bMulti; // Single-assignment first
        
        const aQuals = getWpRequiredQualIds(a.id).length;
        const bQuals = getWpRequiredQualIds(b.id).length;
        if (aQuals !== bQuals) return bQuals - aQuals; // More constrained first
        
        return (a.order || 0) - (b.order || 0);
    });

    // ===== PHASE 1: Rotation-based assignments =====
    if (categoriesToFill.includes('Rotationen')) {
        for (const day of weekDays) {
            const dateStr = formatDate(day);
            
            // Get all rotation workplaces
            const rotationWps = sortedWorkplaces.filter(wp => wp.category === 'Rotationen');
            
            for (const wp of rotationWps) {
                if (!isActiveOnDate(wp, day, dateStr)) continue;

                const { optimalStaff, minStaff } = getStaffingConfig(wp);
                const currentCount = countAssignments(dateStr, wp.name, existingShifts, suggestions);
                const slotsNeeded = optimalStaff - currentCount;
                if (slotsNeeded <= 0) continue;

                // Find doctors with active rotation for this modality
                const rotationDocs = trainingRotations
                    .filter(rot => {
                        if (rot.start_date > dateStr || rot.end_date < dateStr) return false;
                        // Match modality to workplace name
                        return rot.modality === wp.name || 
                               (rot.modality === 'Röntgen' && (wp.name === 'DL/konv. Rö' || wp.name.includes('Rö')));
                    })
                    .map(rot => rot.doctor_id)
                    .filter((id, idx, arr) => arr.indexOf(id) === idx); // unique

                // Sort by parity (least assigned this week first)
                const sortedRotDocs = [...rotationDocs].sort((a, b) => {
                    return getRotationCount(wp.name, a) - getRotationCount(wp.name, b);
                });

                let filled = 0;
                for (const doctorId of sortedRotDocs) {
                    if (filled >= slotsNeeded) break;
                    if (!isDoctorAvailable(doctorId, dateStr, existingShifts, suggestions)) continue;
                    if (isAlreadyAssigned(doctorId, dateStr, wp.name, existingShifts, suggestions)) continue;

                    suggestions.push({
                        date: dateStr,
                        position: wp.name,
                        doctor_id: doctorId,
                        isPreview: true,
                    });
                    incrementWeeklyCount(doctorId);
                    incrementRotationCount(wp.name, doctorId);
                    filled++;
                }
            }
        }
    }

    // ===== PHASE 2: Qualification-based assignments (Dienste, Demos, Custom) =====
    // Fill positions that require specific qualifications first
    const nonRotationWps = sortedWorkplaces.filter(wp => wp.category !== 'Rotationen');
    
    for (const day of weekDays) {
        const dateStr = formatDate(day);

        for (const wp of nonRotationWps) {
            if (!isActiveOnDate(wp, day, dateStr)) continue;
            if (!categoriesToFill.includes(wp.category)) continue;

            const requiredQuals = getWpRequiredQualIds(wp.id);
            if (requiredQuals.length === 0) continue; // Handle in Phase 3

            const multi = allowsMultiple(wp);
            const { optimalStaff } = getStaffingConfig(wp);
            const targetCount = multi ? optimalStaff : 1;
            const currentCount = countAssignments(dateStr, wp.name, existingShifts, suggestions);
            const slotsNeeded = targetCount - currentCount;
            if (slotsNeeded <= 0) continue;

            // Find qualified + available doctors, sorted by least weekly assignments
            const candidates = doctors
                .filter(doc => {
                    if (!isDoctorAvailable(doc.id, dateStr, existingShifts, suggestions)) return false;
                    if (isAlreadyAssigned(doc.id, dateStr, wp.name, existingShifts, suggestions)) return false;
                    if (!isQualified(doc.id, wp.id)) return false;
                    return true;
                })
                .sort((a, b) => getWeeklyCount(a.id) - getWeeklyCount(b.id));

            let filled = 0;
            for (const doc of candidates) {
                if (filled >= slotsNeeded) break;
                suggestions.push({
                    date: dateStr,
                    position: wp.name,
                    doctor_id: doc.id,
                    isPreview: true,
                });
                incrementWeeklyCount(doc.id);
                filled++;
            }
        }
    }

    // ===== PHASE 3: Fill remaining positions (no qualification requirement) =====
    // First pass: fill to min_staff
    // Second pass: fill to optimal_staff
    for (const pass of ['min', 'optimal']) {
        for (const day of weekDays) {
            const dateStr = formatDate(day);

            // Also fill remaining rotation slots for available non-rotation doctors
            const wpsToFill = pass === 'min'
                ? sortedWorkplaces.filter(wp => categoriesToFill.includes(wp.category))
                : sortedWorkplaces.filter(wp => categoriesToFill.includes(wp.category));

            for (const wp of wpsToFill) {
                if (!isActiveOnDate(wp, day, dateStr)) continue;

                const requiredQuals = getWpRequiredQualIds(wp.id);
                // In phase 3: skip positions that have qual requirements (already handled) 
                // unless they still have unfilled slots
                const multi = allowsMultiple(wp);
                const { optimalStaff, minStaff } = getStaffingConfig(wp);
                const targetCount = pass === 'min' ? minStaff : optimalStaff;
                
                if (!multi && targetCount > 1) continue; // single-assignment, already handled if 1 slot
                
                const currentCount = countAssignments(dateStr, wp.name, existingShifts, suggestions);
                
                // For min pass: only fill up to minStaff
                // For optimal pass: fill up to optimalStaff  
                // min_staff=0 means: don't prioritize in min pass
                if (pass === 'min' && minStaff === 0) continue;
                
                const slotsNeeded = targetCount - currentCount;
                if (slotsNeeded <= 0) continue;

                // Find available doctors
                const candidates = doctors
                    .filter(doc => {
                        if (!isDoctorAvailable(doc.id, dateStr, existingShifts, suggestions)) return false;
                        if (isAlreadyAssigned(doc.id, dateStr, wp.name, existingShifts, suggestions)) return false;
                        // Check qualifications
                        if (requiredQuals.length > 0 && !isQualified(doc.id, wp.id)) return false;
                        return true;
                    })
                    .sort((a, b) => getWeeklyCount(a.id) - getWeeklyCount(b.id));

                let filled = 0;
                for (const doc of candidates) {
                    if (filled >= slotsNeeded) break;
                    suggestions.push({
                        date: dateStr,
                        position: wp.name,
                        doctor_id: doc.id,
                        isPreview: true,
                    });
                    incrementWeeklyCount(doc.id);
                    filled++;
                }
            }
        }
    }

    // ===== PHASE 4: Auto-Frei for auto_off positions =====
    const autoFreiSuggestions = [];
    for (const suggestion of suggestions) {
        const wp = workplaces.find(w => w.name === suggestion.position);
        if (!wp?.auto_off) continue;

        const currentDay = new Date(suggestion.date + 'T00:00:00');
        const nextDay = new Date(currentDay);
        nextDay.setDate(nextDay.getDate() + 1);
        const nextDayStr = formatDate(nextDay);
        const isWeekendDay = [0, 6].includes(nextDay.getDay());

        if (isWeekendDay || isPublicHoliday(nextDay)) continue;

        const hasExisting = existingShifts.some(s => s.date === nextDayStr && s.doctor_id === suggestion.doctor_id);
        const hasSuggested = suggestions.some(s => s.date === nextDayStr && s.doctor_id === suggestion.doctor_id);
        const hasAutoFrei = autoFreiSuggestions.some(s => s.date === nextDayStr && s.doctor_id === suggestion.doctor_id);

        if (!hasExisting && !hasSuggested && !hasAutoFrei) {
            autoFreiSuggestions.push({
                date: nextDayStr,
                position: 'Frei',
                doctor_id: suggestion.doctor_id,
                note: 'Autom. Freizeitausgleich',
                isPreview: true,
            });
        }
    }

    return [...suggestions, ...autoFreiSuggestions];
}

/** Simple date formatter (avoids importing date-fns in utility) */
function formatDate(date) {
    const y = date.getFullYear();
    const m = (date.getMonth() + 1).toString().padStart(2, '0');
    const d = date.getDate().toString().padStart(2, '0');
    return `${y}-${m}-${d}`;
}
