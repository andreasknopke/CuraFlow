/**
 * Deterministic Auto-Fill Engine for the Schedule Board.
 * 
 * Algorithm (per day):
 *   1. Determine available doctors (not absent, not already at a blocking position)
 *   2. Assign training rotations (highest priority)
 *   3. Fill qualified positions (positions with mandatory qualifications, prefer qualified staff)
 *   4. Fill remaining positions to min_staff
 *   5. Distribute ALL remaining unassigned doctors fairly across positions
 * Then: Generate Auto-Frei entries for auto_off positions
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
    const nonBlockingPositions = ['Verfügbar'];
    const DEFAULT_ACTIVE_DAYS = [1, 2, 3, 4, 5]; // Mo-Fr

    // ---- Helpers ----

    const getActiveDays = (wp) => {
        return (wp.active_days && wp.active_days.length > 0) ? wp.active_days : DEFAULT_ACTIVE_DAYS;
    };

    const isActiveOnDate = (wp, date) => {
        const activeDays = getActiveDays(wp);
        const dayOfWeek = date.getDay();
        if (isPublicHoliday(date) && !activeDays.some(d => Number(d) === 0)) {
            return false;
        }
        return activeDays.some(d => Number(d) === dayOfWeek);
    };

    const isQualified = (doctorId, workplaceId) => {
        const requiredQuals = getWpRequiredQualIds(workplaceId);
        if (!requiredQuals || requiredQuals.length === 0) return true;
        const docQuals = getDoctorQualIds(doctorId);
        if (!docQuals) return false;
        return requiredQuals.every(qId => docQuals.includes(qId));
    };

    const hasQualRequirement = (wp) => {
        const rq = getWpRequiredQualIds(wp.id);
        return rq && rq.length > 0;
    };

    const allowsMultiple = (wp) => {
        if (wp.allows_multiple !== undefined && wp.allows_multiple !== null) {
            return wp.allows_multiple;
        }
        if (wp.category === 'Rotationen') return true;
        if (wp.category === 'Dienste' || wp.category === 'Demonstrationen & Konsile') return false;
        const catSetting = systemSettings?.find(s => s.key === 'workplace_categories');
        if (catSetting?.value) {
            try {
                const parsed = JSON.parse(catSetting.value);
                const cats = Array.isArray(parsed) && parsed.length > 0 && typeof parsed[0] === 'string'
                    ? parsed.map(name => ({ name, allows_multiple: true }))
                    : parsed;
                const catConfig = cats?.find(c => c.name === wp.category);
                if (catConfig) return catConfig.allows_multiple ?? true;
            } catch {}
        }
        return true;
    };

    const getStaffingConfig = (wp) => ({
        minStaff: wp.min_staff ?? 1,
        optimalStaff: wp.optimal_staff ?? 1,
    });

    // ---- Weekly tracking for fair distribution ----

    const weeklyCount = {};
    // Pre-count existing non-absence assignments
    for (const s of existingShifts) {
        if (!absencePositions.includes(s.position) && !nonBlockingPositions.includes(s.position)) {
            weeklyCount[s.doctor_id] = (weeklyCount[s.doctor_id] || 0) + 1;
        }
    }
    const getWeekly = (id) => weeklyCount[id] || 0;
    const incWeekly = (id) => { weeklyCount[id] = (weeklyCount[id] || 0) + 1; };

    // Rotation parity tracking
    const rotCounts = {};
    for (const s of existingShifts) {
        const wp = workplaces.find(w => w.name === s.position);
        if (wp?.category === 'Rotationen') {
            const key = `${wp.name}__${s.doctor_id}`;
            rotCounts[key] = (rotCounts[key] || 0) + 1;
        }
    }
    const getRotCount = (mod, docId) => rotCounts[`${mod}__${docId}`] || 0;
    const incRotCount = (mod, docId) => {
        rotCounts[`${mod}__${docId}`] = (rotCounts[`${mod}__${docId}`] || 0) + 1;
    };

    // ========================================================
    // Process each day independently
    // ========================================================
    for (const day of weekDays) {
        const dateStr = formatDate(day);

        // --- Determine who is occupied today (from existing DB shifts) ---
        const usedToday = new Set();
        const posCounts = {}; // position name -> count of people there today

        for (const s of existingShifts) {
            if (s.date !== dateStr) continue;

            // Count everyone at each position
            posCounts[s.position] = (posCounts[s.position] || 0) + 1;

            // Check if this shift blocks the doctor
            if (absencePositions.includes(s.position)) {
                usedToday.add(s.doctor_id);
                continue;
            }
            if (nonBlockingPositions.includes(s.position)) continue;

            const wp = workplaces.find(w => w.name === s.position);
            if (wp?.affects_availability === false) continue;
            if (wp?.allows_rotation_concurrently) continue;
            if (wp?.category === 'Demonstrationen & Konsile') continue;
            // Dienste, Rotationen and all other real assignments → block
            usedToday.add(s.doctor_id);
        }

        // --- Target workplaces today ---
        const todayWps = workplaces
            .filter(wp => categoriesToFill.includes(wp.category))
            .filter(wp => isActiveOnDate(wp, day));

        // --- Helper to record a suggestion ---
        const getCount = (wpName) => posCounts[wpName] || 0;

        const assign = (doctorId, wpName) => {
            suggestions.push({
                date: dateStr,
                position: wpName,
                doctor_id: doctorId,
                isPreview: true,
            });
            usedToday.add(doctorId);
            posCounts[wpName] = (posCounts[wpName] || 0) + 1;
            incWeekly(doctorId);
        };

        // ===== PHASE 1: Training rotations =====
        if (categoriesToFill.includes('Rotationen')) {
            const rotWps = todayWps.filter(wp => wp.category === 'Rotationen');

            for (const wp of rotWps) {
                // Find doctors with an active training rotation matching this workplace
                const rotDocs = trainingRotations
                    .filter(rot => rot.start_date <= dateStr && rot.end_date >= dateStr)
                    .filter(rot =>
                        rot.modality === wp.name ||
                        (rot.modality === 'Röntgen' && (wp.name === 'DL/konv. Rö' || wp.name.includes('Rö')))
                    )
                    .map(rot => rot.doctor_id)
                    .filter((id, i, arr) => arr.indexOf(id) === i)
                    .filter(id => !usedToday.has(id));

                // Sort by parity (least assigned this week first)
                rotDocs.sort((a, b) => getRotCount(wp.name, a) - getRotCount(wp.name, b));

                for (const docId of rotDocs) {
                    assign(docId, wp.name);
                    incRotCount(wp.name, docId);
                }
            }
        }

        // ===== PHASE 2: Fill positions with QUALIFICATION requirements =====
        // Process most-constrained positions first (more required quals = more constrained)
        const qualWps = todayWps
            .filter(wp => hasQualRequirement(wp))
            .sort((a, b) => {
                const aq = getWpRequiredQualIds(a.id).length;
                const bq = getWpRequiredQualIds(b.id).length;
                return bq - aq; // most constrained first
            });

        for (const wp of qualWps) {
            const multi = allowsMultiple(wp);
            const { minStaff, optimalStaff } = getStaffingConfig(wp);
            const target = multi ? Math.max(minStaff, optimalStaff) : 1;
            const slotsNeeded = target - getCount(wp.name);
            if (slotsNeeded <= 0) continue;

            // Only qualified + available doctors
            const candidates = doctors
                .filter(d => !usedToday.has(d.id) && isQualified(d.id, wp.id))
                .sort((a, b) => getWeekly(a.id) - getWeekly(b.id));

            for (let i = 0; i < Math.min(slotsNeeded, candidates.length); i++) {
                assign(candidates[i].id, wp.name);
            }
        }

        // ===== PHASE 3: Fill positions WITHOUT qualification requirements to min_staff =====
        const noQualWps = todayWps
            .filter(wp => !hasQualRequirement(wp))
            .sort((a, b) => (a.order || 0) - (b.order || 0));

        for (const wp of noQualWps) {
            const multi = allowsMultiple(wp);
            const { minStaff } = getStaffingConfig(wp);
            const target = multi ? minStaff : Math.min(minStaff, 1);
            const slotsNeeded = target - getCount(wp.name);
            if (slotsNeeded <= 0) continue;

            const candidates = doctors
                .filter(d => !usedToday.has(d.id))
                .sort((a, b) => getWeekly(a.id) - getWeekly(b.id));

            for (let i = 0; i < Math.min(slotsNeeded, candidates.length); i++) {
                assign(candidates[i].id, wp.name);
            }
        }

        // ===== PHASE 4: Distribute ALL remaining unassigned doctors =====
        // Every available doctor who doesn't have a position yet gets assigned somewhere
        const unassigned = doctors
            .filter(d => !usedToday.has(d.id))
            .sort((a, b) => getWeekly(a.id) - getWeekly(b.id));

        for (const doc of unassigned) {
            // Find best workplace for this doctor
            // - Must allow more staff (allows_multiple or currently empty)
            // - Prefer positions where doctor is qualified
            // - Prefer positions with lowest fill ratio (current / optimal)
            const options = todayWps
                .filter(wp => allowsMultiple(wp) || getCount(wp.name) < 1)
                .map(wp => {
                    const qualified = !hasQualRequirement(wp) || isQualified(doc.id, wp.id);
                    const { optimalStaff } = getStaffingConfig(wp);
                    const cur = getCount(wp.name);
                    const fillRatio = cur / Math.max(optimalStaff, 1);
                    return { wp, qualified, fillRatio, cur };
                })
                .filter(o => o.qualified) // only where qualified or no requirement
                .sort((a, b) => {
                    // Under-optimal positions first (less filled relative to target)
                    if (Math.abs(a.fillRatio - b.fillRatio) > 0.01) return a.fillRatio - b.fillRatio;
                    // Then by workplace order
                    return (a.wp.order || 0) - (b.wp.order || 0);
                });

            if (options.length > 0) {
                assign(doc.id, options[0].wp.name);
            }
        }
    }

    // ===== PHASE 5: Auto-Frei for auto_off positions =====
    const autoFrei = [];
    for (const s of suggestions) {
        const wp = workplaces.find(w => w.name === s.position);
        if (!wp?.auto_off) continue;

        const curDay = new Date(s.date + 'T00:00:00');
        const nextDay = new Date(curDay);
        nextDay.setDate(nextDay.getDate() + 1);
        const nextStr = formatDate(nextDay);

        if ([0, 6].includes(nextDay.getDay()) || isPublicHoliday(nextDay)) continue;

        const hasAny =
            existingShifts.some(x => x.date === nextStr && x.doctor_id === s.doctor_id) ||
            suggestions.some(x => x.date === nextStr && x.doctor_id === s.doctor_id) ||
            autoFrei.some(x => x.date === nextStr && x.doctor_id === s.doctor_id);

        if (!hasAny) {
            autoFrei.push({
                date: nextStr,
                position: 'Frei',
                doctor_id: s.doctor_id,
                note: 'Autom. Freizeitausgleich',
                isPreview: true,
            });
        }
    }

    return [...suggestions, ...autoFrei];
}

/** Simple date formatter (avoids importing date-fns in utility) */
function formatDate(date) {
    const y = date.getFullYear();
    const m = (date.getMonth() + 1).toString().padStart(2, '0');
    const d = date.getDate().toString().padStart(2, '0');
    return `${y}-${m}-${d}`;
}
