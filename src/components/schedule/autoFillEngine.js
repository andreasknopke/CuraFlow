/**
 * Deterministic Auto-Fill Engine for the Schedule Board.
 *
 * Per-day algorithm:
 *
 *   Phase 1 – Qualification coverage:
 *       Each workplace with mandatory qualifications gets ≥1 qualified doctor.
 *       Exception: if min_staff=0 the workplace may stay empty.
 *       Prefer qualified doctors that do NOT have a rotation elsewhere,
 *       so rotation docs stay free for their training workplace.
 *
 *   Phase 2 – Fill all workplaces to optimal_staff, round-robin:
 *       Repeatedly pick the workplace with the lowest fill-ratio (current / optimal).
 *       For each slot, pick the best available doctor:
 *         a) Doctors who have this workplace in their rotation plan get priority.
 *         b) Among rotation-prioritised doctors: those who were displaced yesterday
 *            (assigned elsewhere despite having a rotation) rank even higher.
 *         c) Ties broken by weekly assignment count (fairness).
 *       No workplace exceeds optimal until ALL are at optimal.
 *
 *   Phase 3 – Over-fill remaining:
 *       All workplaces at optimal but some doctors still unassigned.
 *       Distribute to allows_multiple workplaces, lowest fill-ratio first.
 *       Prefer positions where the doctor is qualified.
 *
 *   Phase 4 – Auto-Frei:
 *       Generate a "Frei" entry the next day for auto_off positions.
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
    getWpExcludedQualIds,
    categoriesToFill,
    systemSettings,
}) {
    const suggestions = [];
    const absencePositions = ['Frei', 'Krank', 'Urlaub', 'Dienstreise', 'Nicht verfügbar'];
    const DEFAULT_ACTIVE_DAYS = [1, 2, 3, 4, 5];

    // ---- Helpers ----

    const getActiveDays = (wp) =>
        wp.active_days?.length > 0 ? wp.active_days : DEFAULT_ACTIVE_DAYS;

    const isActiveOnDate = (wp, date) => {
        const ad = getActiveDays(wp);
        if (isPublicHoliday(date) && !ad.some(d => Number(d) === 0)) return false;
        return ad.some(d => Number(d) === date.getDay());
    };

    /** Does this doctor hold ALL mandatory qualifications for a workplace? */
    const isQualified = (doctorId, wpId) => {
        const req = getWpRequiredQualIds(wpId);
        if (!req?.length) return true;
        const doc = getDoctorQualIds(doctorId);
        if (!doc) return false;
        return req.every(q => doc.includes(q));
    };

    /** Is the doctor EXCLUDED from this workplace via a NOT-qualification? */
    const isExcluded = (doctorId, wpId) => {
        const excl = getWpExcludedQualIds?.(wpId);
        if (!excl?.length) return false;
        const doc = getDoctorQualIds(doctorId);
        if (!doc?.length) return false;
        // Doctor is excluded if they have ANY of the NOT-qualifications
        return excl.some(q => doc.includes(q));
    };

    /** Does this workplace have any mandatory qualification requirement? */
    const hasQualReq = (wp) => {
        const rq = getWpRequiredQualIds(wp.id);
        return rq?.length > 0;
    };

    const allowsMultiple = (wp) => {
        if (wp.allows_multiple != null) return wp.allows_multiple;
        if (wp.category === 'Rotationen') return true;
        if (['Dienste', 'Demonstrationen & Konsile'].includes(wp.category)) return false;
        const catSetting = systemSettings?.find(s => s.key === 'workplace_categories');
        if (catSetting?.value) {
            try {
                const parsed = JSON.parse(catSetting.value);
                const cats = Array.isArray(parsed) && parsed[0] && typeof parsed[0] === 'string'
                    ? parsed.map(n => ({ name: n, allows_multiple: true }))
                    : parsed;
                const cc = cats?.find(c => c.name === wp.category);
                if (cc) return cc.allows_multiple ?? true;
            } catch {}
        }
        return true;
    };

    /** optimal_staff: target headcount. For single-assignment workplaces: 1 */
    const getOptimal = (wp) => {
        if (!allowsMultiple(wp)) return 1;
        return Math.max(wp.optimal_staff ?? 1, wp.min_staff ?? 1);
    };

    /** min_staff: minimum required before considering this workplace "covered" */
    const getMinStaff = (wp) => {
        if (!allowsMultiple(wp)) return 1;
        return wp.min_staff ?? 1;
    };

    // ---- Weekly tracking for fair distribution ----
    const weeklyCount = {};
    for (const s of existingShifts) {
        if (!absencePositions.includes(s.position) && s.position !== 'Verfügbar') {
            weeklyCount[s.doctor_id] = (weeklyCount[s.doctor_id] || 0) + 1;
        }
    }
    const getWeekly = (id) => weeklyCount[id] || 0;
    const incWeekly = (id) => { weeklyCount[id] = (weeklyCount[id] || 0) + 1; };

    // ---- Rotation mapping: doctorId → [workplace names] for this week ----
    const getActiveRotationTargets = (doctorId, dateStr) => {
        return trainingRotations
            .filter(r => r.doctor_id === doctorId && r.start_date <= dateStr && r.end_date >= dateStr)
            .map(r => {
                // Map modality to workplace name
                if (r.modality === 'Röntgen') {
                    const roeWp = workplaces.find(w => w.name === 'DL/konv. Rö' || w.name.includes('Rö'));
                    return roeWp?.name || r.modality;
                }
                return r.modality;
            });
    };

    // ---- Displacement tracking ----
    // Tracks doctors who had a rotation target but were assigned elsewhere on a given day.
    // Key: doctorId, Value: number of "displacement days" this week so far.
    const displacementCount = {}; // doctorId → count
    const getDisplaced = (id) => displacementCount[id] || 0;
    const addDisplacement = (id) => { displacementCount[id] = (displacementCount[id] || 0) + 1; };

    // ========================================================
    // Process each day independently (but days are processed in order,
    // so displacement from Mon carries over to Tue, etc.)
    // ========================================================
    for (const day of weekDays) {
        const dateStr = formatDate(day);

        // --- Who is blocked today? ---
        const blocked = new Set();
        const posCount = {}; // position name → current headcount today

        for (const s of existingShifts) {
            if (s.date !== dateStr) continue;
            posCount[s.position] = (posCount[s.position] || 0) + 1;

            if (absencePositions.includes(s.position)) { blocked.add(s.doctor_id); continue; }
            if (s.position === 'Verfügbar') continue;

            const wp = workplaces.find(w => w.name === s.position);
            if (wp?.affects_availability === false) continue;
            if (wp?.allows_rotation_concurrently) continue;
            if (wp?.category === 'Demonstrationen & Konsile') continue;
            blocked.add(s.doctor_id);
        }

        const usedToday = new Set(blocked);

        // Active workplaces today (filtered by category + active_days)
        const todayWps = workplaces
            .filter(wp => categoriesToFill.includes(wp.category) && isActiveOnDate(wp, day));

        // Helper to record a suggestion
        const assign = (docId, wpName) => {
            suggestions.push({ date: dateStr, position: wpName, doctor_id: docId, isPreview: true });
            usedToday.add(docId);
            posCount[wpName] = (posCount[wpName] || 0) + 1;
            incWeekly(docId);
        };

        /** Does this position already have ≥1 qualified person today? */
        const hasQualCoverage = (wp) => {
            for (const s of existingShifts) {
                if (s.date === dateStr && s.position === wp.name && isQualified(s.doctor_id, wp.id)) return true;
            }
            for (const s of suggestions) {
                if (s.date === dateStr && s.position === wp.name && isQualified(s.doctor_id, wp.id)) return true;
            }
            return false;
        };

        // ========== Phase 1: Qualification coverage ==========
        // For each workplace with mandatory qualifications: ensure ≥1 qualified doctor.
        // Exception: min_staff=0 → this workplace can stay empty.
        const qualWps = todayWps
            .filter(wp => hasQualReq(wp) && getMinStaff(wp) > 0)
            .sort((a, b) => {
                // More constrained first (fewer qualified doctors available)
                const aPool = doctors.filter(d => !blocked.has(d.id) && !isExcluded(d.id, a.id) && isQualified(d.id, a.id)).length;
                const bPool = doctors.filter(d => !blocked.has(d.id) && !isExcluded(d.id, b.id) && isQualified(d.id, b.id)).length;
                return aPool - bPool;
            });

        for (const wp of qualWps) {
            if (hasQualCoverage(wp)) continue;

            // Find qualified doctors. Prefer those WITHOUT a rotation elsewhere
            // (so we don't steal rotation docs if possible).
            // Exclude doctors with NOT-qualifications for this workplace.
            const candidates = doctors
                .filter(d => !usedToday.has(d.id) && !isExcluded(d.id, wp.id) && isQualified(d.id, wp.id))
                .sort((a, b) => {
                    // Does this doctor have a rotation pointing to a DIFFERENT workplace?
                    const aRotElsewhere = getActiveRotationTargets(a.id, dateStr)
                        .some(t => t !== wp.name) ? 1 : 0;
                    const bRotElsewhere = getActiveRotationTargets(b.id, dateStr)
                        .some(t => t !== wp.name) ? 1 : 0;
                    if (aRotElsewhere !== bRotElsewhere) return aRotElsewhere - bRotElsewhere;
                    // Then by weekly count (fairness)
                    return getWeekly(a.id) - getWeekly(b.id);
                });

            if (candidates.length > 0) {
                assign(candidates[0].id, wp.name);
            }
        }

        // ========== Phase 2: Fill to optimal_staff (round-robin) ==========
        // Repeatedly pick the workplace with the lowest fill-ratio.
        // For each slot, choose the best-fitting doctor with rotation priority.
        let changed = true;
        while (changed) {
            changed = false;

            // Find all workplaces still under their optimal
            const underFilled = todayWps
                .filter(wp => (posCount[wp.name] || 0) < getOptimal(wp))
                .sort((a, b) => {
                    // Lowest fill-ratio first
                    const aR = (posCount[a.name] || 0) / getOptimal(a);
                    const bR = (posCount[b.name] || 0) / getOptimal(b);
                    if (Math.abs(aR - bR) > 0.001) return aR - bR;
                    // Workplaces with qual requirements first (more constrained)
                    const aQ = hasQualReq(a) ? 0 : 1;
                    const bQ = hasQualReq(b) ? 0 : 1;
                    if (aQ !== bQ) return aQ - bQ;
                    return (a.order || 0) - (b.order || 0);
                });

            if (underFilled.length === 0) break;

            const unassigned = doctors.filter(d => !usedToday.has(d.id));
            if (unassigned.length === 0) break;

            // Target: the most under-filled workplace
            const targetWp = underFilled[0];

            // Score each candidate — exclude doctors with NOT-qualifications
            const scored = unassigned.filter(doc => !isExcluded(doc.id, targetWp.id)).map(doc => {
                const rotTargets = getActiveRotationTargets(doc.id, dateStr);
                const hasRotHere = rotTargets.includes(targetWp.name);
                const hasRotElsewhere = rotTargets.length > 0 && !hasRotHere;

                // Priority tiers (lower = better):
                // 0: Has rotation HERE + was displaced before → highest priority
                // 1: Has rotation HERE
                // 2: No rotation anywhere (free to assign anywhere)
                // 3: Has rotation ELSEWHERE (prefer not to steal)
                let tier;
                if (hasRotHere && getDisplaced(doc.id) > 0) tier = 0;
                else if (hasRotHere) tier = 1;
                else if (!hasRotElsewhere) tier = 2;
                else tier = 3;

                // Within each tier: prefer qualified, then by weekly count
                const qualified = isQualified(doc.id, targetWp.id);
                const needsQualCoverage = hasQualReq(targetWp) && !hasQualCoverage(targetWp);

                return {
                    doc,
                    tier,
                    qualScore: needsQualCoverage && qualified ? 0 : (needsQualCoverage && !qualified ? 2 : 1),
                    displaced: getDisplaced(doc.id),
                    weekly: getWeekly(doc.id),
                };
            }).sort((a, b) => {
                if (a.tier !== b.tier) return a.tier - b.tier;
                if (a.qualScore !== b.qualScore) return a.qualScore - b.qualScore;
                // Higher displacement → higher priority (within same tier)
                if (a.displaced !== b.displaced) return b.displaced - a.displaced;
                return a.weekly - b.weekly;
            });

            if (scored.length > 0) {
                const chosen = scored[0].doc;
                assign(chosen.id, targetWp.name);

                // Track displacement: if this doctor had a rotation target and wasn't assigned there
                const rotTargets = getActiveRotationTargets(chosen.id, dateStr);
                if (rotTargets.length > 0 && !rotTargets.includes(targetWp.name)) {
                    addDisplacement(chosen.id);
                }

                changed = true;
            }
        }

        // ========== Phase 3: Over-fill remaining doctors ==========
        // All workplaces at optimal, but some doctors still unassigned.
        // Distribute to allows_multiple workplaces.
        let overChanged = true;
        while (overChanged) {
            overChanged = false;

            const remaining = doctors.filter(d => !usedToday.has(d.id));
            if (remaining.length === 0) break;

            const options = todayWps
                .filter(wp => allowsMultiple(wp))
                .map(wp => ({
                    wp,
                    fillRatio: (posCount[wp.name] || 0) / Math.max(getOptimal(wp), 1),
                }))
                .sort((a, b) => {
                    if (Math.abs(a.fillRatio - b.fillRatio) > 0.001) return a.fillRatio - b.fillRatio;
                    return (a.wp.order || 0) - (b.wp.order || 0);
                });

            if (options.length === 0) break;

            // Pick doctor with least weekly assignments
            const doc = remaining.sort((a, b) => {
                // Prefer assigning to their rotation target if possible
                const aRotMatch = getActiveRotationTargets(a.id, dateStr).includes(options[0].wp.name) ? 0 : 1;
                const bRotMatch = getActiveRotationTargets(b.id, dateStr).includes(options[0].wp.name) ? 0 : 1;
                if (aRotMatch !== bRotMatch) return aRotMatch - bRotMatch;
                return getWeekly(a.id) - getWeekly(b.id);
            })[0];

            // Find the best workplace for this doctor (exclude NOT-qualified workplaces)
            const bestForDoc = options
                .filter(o => !isExcluded(doc.id, o.wp.id))
                .map(o => {
                    const rotTargets = getActiveRotationTargets(doc.id, dateStr);
                    const isRotTarget = rotTargets.includes(o.wp.name) ? 0 : 1;
                    const isQual = isQualified(doc.id, o.wp.id) ? 0 : 1;
                    return { ...o, isRotTarget, isQual };
                })
                .sort((a, b) => {
                    // Prefer rotation target
                    if (a.isRotTarget !== b.isRotTarget) return a.isRotTarget - b.isRotTarget;
                    // Prefer qualified positions
                    if (a.isQual !== b.isQual) return a.isQual - b.isQual;
                    // Prefer least filled
                    if (Math.abs(a.fillRatio - b.fillRatio) > 0.001) return a.fillRatio - b.fillRatio;
                    return (a.wp.order || 0) - (b.wp.order || 0);
                });

            if (bestForDoc.length > 0) {
                assign(doc.id, bestForDoc[0].wp.name);
                
                // Track displacement
                const rotTargets = getActiveRotationTargets(doc.id, dateStr);
                if (rotTargets.length > 0 && !rotTargets.includes(bestForDoc[0].wp.name)) {
                    addDisplacement(doc.id);
                }
                
                overChanged = true;
            }
        }
    }

    // ========== Phase 4: Auto-Frei for auto_off positions ==========
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

/** Simple date formatter */
function formatDate(date) {
    const y = date.getFullYear();
    const m = (date.getMonth() + 1).toString().padStart(2, '0');
    const d = date.getDate().toString().padStart(2, '0');
    return `${y}-${m}-${d}`;
}
