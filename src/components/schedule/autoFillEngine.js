/**
 * Deterministic Auto-Fill Engine for the Schedule Board.
 *
 * Priority-based per-day algorithm:
 *
 *   Phase A – Dienste (Services, highest priority):
 *       Fills all service positions FIRST, because:
 *       - Services with auto_off generate "Frei" the next day → affects availability
 *       - Shift wishes (Dienstwünsche) must be respected
 *       Rules:
 *         • Approved "Dienstwunsch" (type='service', status='approved') → priority assignment
 *         • Approved "kein Dienst" (type='no_service', status='approved') → hard NOT (excluded)
 *         • Pending "kein Dienst" (type='no_service', status='pending') → soft NOT (only if others available)
 *         • Qualification + NOT-qualification checks still apply
 *         • Auto-Frei: if service has auto_off, a "Frei" entry is generated for the next workday
 *           and that doctor is blocked for the next day immediately
 *
 *   Phase B – Verfügbarkeitsrelevante Arbeitsplätze (affects_availability=true, non-service):
 *       After services are filled and Auto-Frei is applied, we know who is truly available.
 *       Fill rotation workplaces and other availability-relevant positions.
 *       Uses qualification coverage, rotation priority, displacement tracking, round-robin.
 *
 *   Phase C – Nicht-verfügbarkeitsrelevante Arbeitsplätze (affects_availability=false):
 *       Filled last. Doctors assigned in Phase B are STILL available here.
 *       Only absence and service assignments block.
 *
 *   Phase D – Auto-Frei for remaining auto_off positions (non-service):
 *       E.g. if a rotation workplace also has auto_off.
 */

export function generateSuggestions({
    weekDays,
    doctors,
    workplaces,
    existingShifts,
    allShifts = [],
    trainingRotations,
    isPublicHoliday,
    getDoctorQualIds,
    getWpRequiredQualIds,
    getWpOptionalQualIds,
    getWpExcludedQualIds,
    categoriesToFill,
    systemSettings,
    wishes = [],
}) {
    const suggestions = [];
    const absencePositions = ['Frei', 'Krank', 'Urlaub', 'Dienstreise', 'Nicht verfügbar'];
    const DEFAULT_ACTIVE_DAYS = [1, 2, 3, 4, 5];

    // ========================================================
    //  Helper functions
    // ========================================================

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
        return excl.some(q => doc.includes(q));
    };

    /** Does this workplace have any mandatory qualification requirement? */
    const hasQualReq = (wp) => {
        const rq = getWpRequiredQualIds(wp.id);
        return rq?.length > 0;
    };

    /** Does the doctor have ALL optional qualifications for this workplace? */
    const hasOptionalQuals = (doctorId, wpId) => {
        const opt = getWpOptionalQualIds?.(wpId);
        if (!opt?.length) return true; // no optional quals = considered "has them"
        const doc = getDoctorQualIds(doctorId);
        if (!doc?.length) return false;
        return opt.every(q => doc.includes(q));
    };

    /** Does the doctor have ANY optional qualification for this workplace? */
    const hasAnyOptionalQual = (doctorId, wpId) => {
        const opt = getWpOptionalQualIds?.(wpId);
        if (!opt?.length) return true;
        const doc = getDoctorQualIds(doctorId);
        if (!doc?.length) return false;
        return opt.some(q => doc.includes(q));
    };

    /** Does this workplace have any optional qualification? */
    const hasOptionalQualReq = (wp) => {
        const oq = getWpOptionalQualIds?.(wp.id);
        return oq?.length > 0;
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

    /** optimal_staff: target headcount */
    const getOptimal = (wp) => {
        if (!allowsMultiple(wp)) return 1;
        return Math.max(wp.optimal_staff ?? 1, wp.min_staff ?? 1);
    };

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

    // ========================================================
    //  4-week service limits & fair VG/HG distribution
    // ========================================================

    // Read limit settings
    const getSetting = (key, def) => {
        const s = systemSettings?.find(x => x.key === key);
        return parseInt(s?.value || def);
    };
    const limitFG = getSetting('limit_fore_services', '4');
    const limitBG = getSetting('limit_back_services', '12');
    const limitWeekend = getSetting('limit_weekend_services', '1');

    // Identify foreground/background service positions dynamically
    const serviceWorkplaces = workplaces.filter(w => w.category === 'Dienste');
    const sortedServices = [...serviceWorkplaces].sort((a, b) => (a.order || 0) - (b.order || 0));
    const foregroundPosition = sortedServices[0]?.name;
    const backgroundPosition = sortedServices[1]?.name;

    // Compute 4-week window: 3 weeks before the first planning day through the last planning day
    const firstPlanDate = weekDays[0];
    const fourWeekStart = new Date(firstPlanDate);
    fourWeekStart.setDate(fourWeekStart.getDate() - 21); // 3 weeks back
    const fourWeekStartStr = formatDate(fourWeekStart);
    const lastPlanStr = formatDate(weekDays[weekDays.length - 1]);

    // Use allShifts (broader range) for historical counting, fallback to existingShifts
    const historyShifts = allShifts.length > 0 ? allShifts : existingShifts;

    // Count each doctor's services in the 4-week window (existing only, pre-suggestions)
    const serviceHistory = {}; // doctorId -> { fg: n, bg: n, weekend: n }
    const getServiceHist = (docId) => {
        if (!serviceHistory[docId]) serviceHistory[docId] = { fg: 0, bg: 0, weekend: 0 };
        return serviceHistory[docId];
    };

    for (const s of historyShifts) {
        if (s.date < fourWeekStartStr || s.date > lastPlanStr) continue;
        if (s.isPreview) continue;
        const h = getServiceHist(s.doctor_id);
        if (s.position === foregroundPosition) {
            h.fg++;
            const sDay = new Date(s.date + 'T00:00:00').getDay();
            if (sDay === 0 || sDay === 6) h.weekend++;
        }
        if (s.position === backgroundPosition) h.bg++;
    }

    /** Get doctor FTE (from doctor.fte field) */
    const getDoctorFte = (docId) => {
        const doc = doctors.find(d => d.id === docId);
        return doc?.fte ?? 1.0;
    };

    /** Would assigning this service to this doctor exceed the 4-week limit? */
    const wouldExceedLimit = (docId, serviceName, dateStr) => {
        const h = getServiceHist(docId);
        const fte = getDoctorFte(docId);
        const isFG = serviceName === foregroundPosition;
        const isBG = serviceName === backgroundPosition;
        const d = new Date(dateStr + 'T00:00:00');
        const isWknd = (d.getDay() === 0 || d.getDay() === 6) && isFG;

        if (isFG && (h.fg + 1) > Math.round(limitFG * fte)) return true;
        if (isBG && (h.bg + 1) > Math.round(limitBG * fte)) return true;
        if (isWknd && (h.weekend + 1) > limitWeekend) return true;
        return false;
    };

    /** Track a new service assignment in the 4-week history */
    const recordServiceAssignment = (docId, serviceName, dateStr) => {
        const h = getServiceHist(docId);
        if (serviceName === foregroundPosition) {
            h.fg++;
            const d = new Date(dateStr + 'T00:00:00').getDay();
            if (d === 0 || d === 6) h.weekend++;
        }
        if (serviceName === backgroundPosition) h.bg++;
    };

    /**
     * Fair distribution score: lower = should get the next service.
     * Considers total services in 4-week window relative to FTE.
     * Separate scoring for FG and BG to balance both independently.
     */
    const getFairnessScore = (docId, serviceName) => {
        const h = getServiceHist(docId);
        const fte = getDoctorFte(docId) || 1;
        if (serviceName === foregroundPosition) return h.fg / fte;
        if (serviceName === backgroundPosition) return h.bg / fte;
        return (h.fg + h.bg) / fte;
    };

    // ---- Rotation mapping ----
    const getActiveRotationTargets = (doctorId, dateStr) => {
        return trainingRotations
            .filter(r => r.doctor_id === doctorId && r.start_date <= dateStr && r.end_date >= dateStr)
            .map(r => {
                if (r.modality === 'Röntgen') {
                    const roeWp = workplaces.find(w => w.name === 'DL/konv. Rö' || w.name.includes('Rö'));
                    return roeWp?.name || r.modality;
                }
                return r.modality;
            });
    };

    // ---- Displacement tracking ----
    const displacementCount = {};
    const getDisplaced = (id) => displacementCount[id] || 0;
    const addDisplacement = (id) => { displacementCount[id] = (displacementCount[id] || 0) + 1; };

    // ---- Auto-Frei tracking across days ----
    // Doctors who get Auto-Frei on a specific date are blocked that day.
    const autoFreiByDate = {};
    const autoFreiSuggestions = [];

    /** Generate an Auto-Frei for a doctor on the next workday after dateStr */
    const generateAutoFrei = (doctorId, dateStr) => {
        const curDay = new Date(dateStr + 'T00:00:00');
        const nextDay = new Date(curDay);
        nextDay.setDate(nextDay.getDate() + 1);

        // Skip weekends and holidays to find the next workday
        for (let i = 0; i < 7; i++) {
            if (nextDay.getDay() !== 0 && nextDay.getDay() !== 6 && !isPublicHoliday(nextDay)) {
                break;
            }
            nextDay.setDate(nextDay.getDate() + 1);
        }

        const nextStr = formatDate(nextDay);

        // Check if something already exists that day for this doctor
        const hasExisting =
            existingShifts.some(x => x.date === nextStr && x.doctor_id === doctorId) ||
            suggestions.some(x => x.date === nextStr && x.doctor_id === doctorId) ||
            autoFreiSuggestions.some(x => x.date === nextStr && x.doctor_id === doctorId);

        if (!hasExisting) {
            autoFreiSuggestions.push({
                date: nextStr,
                position: 'Frei',
                doctor_id: doctorId,
                note: 'Autom. Freizeitausgleich',
                isPreview: true,
            });
            // Track this doctor as blocked on the Auto-Frei day
            if (!autoFreiByDate[nextStr]) autoFreiByDate[nextStr] = new Set();
            autoFreiByDate[nextStr].add(doctorId);
        }
    };

    // ========================================================
    //  Wish helpers
    // ========================================================

    /** Get service wish for a doctor on a date (approved OR pending) */
    const getServiceWish = (doctorId, dateStr) => {
        return wishes.find(w =>
            w.doctor_id === doctorId &&
            w.date === dateStr &&
            w.type === 'service' &&
            (w.status === 'approved' || w.status === 'pending')
        );
    };

    /** Is this doctor hard-blocked from ALL services on this date? (approved "kein Dienst") */
    const hasApprovedNoService = (doctorId, dateStr) => {
        return wishes.some(w =>
            w.doctor_id === doctorId &&
            w.date === dateStr &&
            w.type === 'no_service' &&
            w.status === 'approved'
        );
    };

    /** Does this doctor have a pending (unapproved) "kein Dienst" wish? (soft NOT) */
    const hasPendingNoService = (doctorId, dateStr) => {
        return wishes.some(w =>
            w.doctor_id === doctorId &&
            w.date === dateStr &&
            w.type === 'no_service' &&
            w.status === 'pending'
        );
    };

    // ========================================================
    //  Classify workplaces
    // ========================================================
    const isServiceWp = (wp) => wp.category === 'Dienste';
    const isAffectsAvailability = (wp) => wp.affects_availability !== false;

    // ========================================================
    //  Process each day
    // ========================================================
    for (const day of weekDays) {
        const dateStr = formatDate(day);

        // --- Base blocked set (absences + existing availability-relevant assignments) ---
        const baseBlocked = new Set();
        const posCount = {};

        // Include doctors blocked by auto-frei from a previous day's service
        if (autoFreiByDate[dateStr]) {
            for (const docId of autoFreiByDate[dateStr]) {
                baseBlocked.add(docId);
            }
        }

        for (const s of existingShifts) {
            if (s.date !== dateStr) continue;
            posCount[s.position] = (posCount[s.position] || 0) + 1;

            if (absencePositions.includes(s.position)) { baseBlocked.add(s.doctor_id); continue; }
            if (s.position === 'Verfügbar') continue;

            const wp = workplaces.find(w => w.name === s.position);
            if (wp?.affects_availability === false) continue;
            if (wp?.allows_rotation_concurrently) continue;
            if (wp?.category === 'Demonstrationen & Konsile') continue;
            baseBlocked.add(s.doctor_id);
        }

        // Track who is used today (starts as copy of baseBlocked)
        const usedToday = new Set(baseBlocked);

        // All workplaces active today in the categories we're filling
        const allTodayWps = workplaces
            .filter(wp => categoriesToFill.includes(wp.category) && isActiveOnDate(wp, day));

        // Track doctors assigned to a service today (even if rotation-OK)
        const serviceAssignedToday = new Set();
        for (const s of existingShifts) {
            if (s.date !== dateStr) continue;
            const wp = workplaces.find(w => w.name === s.position);
            if (wp?.category === 'Dienste') serviceAssignedToday.add(s.doctor_id);
        }

        // Record a suggestion and update tracking
        const assign = (docId, wpName) => {
            suggestions.push({ date: dateStr, position: wpName, doctor_id: docId, isPreview: true });
            // Only block the doctor if the workplace actually reduces availability
            const wp = workplaces.find(w => w.name === wpName);
            if (wp?.category === 'Dienste') serviceAssignedToday.add(docId);
            if (!wp?.allows_rotation_concurrently) {
                usedToday.add(docId);
            }
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

        // ============================================================
        //  PHASE A: DIENSTE (Services) — highest priority
        // ============================================================
        if (categoriesToFill.includes('Dienste')) {
            const serviceWps = allTodayWps.filter(wp => isServiceWp(wp));

            for (const svc of serviceWps) {
                const currentCount = posCount[svc.name] || 0;
                const targetCount = getOptimal(svc);
                const slotsNeeded = targetCount - currentCount;
                if (slotsNeeded <= 0) continue;

                // Build candidate pool for this service
                // Exclude doctors who would exceed their 4-week limit
                // Also exclude doctors already assigned to a service today
                const allCandidates = doctors.filter(d =>
                    !usedToday.has(d.id) &&
                    !serviceAssignedToday.has(d.id) &&
                    !isExcluded(d.id, svc.id) &&
                    !hasApprovedNoService(d.id, dateStr) &&
                    isQualified(d.id, svc.id) &&
                    !wouldExceedLimit(d.id, svc.name, dateStr)
                );

                // Separate candidates into priority tiers
                const withServiceWish = [];
                const withPendingNoService = [];
                const normal = [];

                for (const doc of allCandidates) {
                    const wish = getServiceWish(doc.id, dateStr);
                    if (wish && (!wish.position || wish.position === svc.name)) {
                        withServiceWish.push(doc);
                    } else if (hasPendingNoService(doc.id, dateStr)) {
                        withPendingNoService.push(doc);
                    } else {
                        normal.push(doc);
                    }
                }

                // Sort each group by fairness score (4-week history, FTE-adjusted)
                const sortByFairness = (a, b) => {
                    const fa = getFairnessScore(a.id, svc.name);
                    const fb = getFairnessScore(b.id, svc.name);
                    if (Math.abs(fa - fb) > 0.001) return fa - fb;
                    return getWeekly(a.id) - getWeekly(b.id);
                };
                withServiceWish.sort(sortByFairness);
                normal.sort(sortByFairness);
                withPendingNoService.sort(sortByFairness);

                // Priority order: wish > normal > pending-no-service (soft NOT)
                const ranked = [...withServiceWish, ...normal, ...withPendingNoService];

                // If no candidates within limits, fall back to all qualified (limit exceeded = last resort)
                if (ranked.length === 0) {
                    const fallback = doctors.filter(d =>
                        !usedToday.has(d.id) &&
                        !serviceAssignedToday.has(d.id) &&
                        !isExcluded(d.id, svc.id) &&
                        !hasApprovedNoService(d.id, dateStr) &&
                        isQualified(d.id, svc.id)
                    ).sort((a, b) => getFairnessScore(a.id, svc.name) - getFairnessScore(b.id, svc.name));
                    ranked.push(...fallback);
                }

                for (let i = 0; i < slotsNeeded && i < ranked.length; i++) {
                    const chosen = ranked[i];
                    assign(chosen.id, svc.name);
                    recordServiceAssignment(chosen.id, svc.name, dateStr);

                    // Auto-Frei: if service has auto_off, block doctor on next workday
                    if (svc.auto_off) {
                        generateAutoFrei(chosen.id, dateStr);
                    }
                }
            }
        }

        // After Phase A: doctors assigned to services + auto-frei are now in usedToday.
        // Save the service-blocked set for Phase C.
        const serviceBlocked = new Set(usedToday);

        // ============================================================
        //  PHASE B: Verfügbarkeitsrelevante Arbeitsplätze (non-service)
        // ============================================================
        const availWps = allTodayWps.filter(wp =>
            !isServiceWp(wp) && isAffectsAvailability(wp)
        );

        if (availWps.length > 0) {
            // --- B.1: Qualification coverage ---
            const qualWps = availWps
                .filter(wp => hasQualReq(wp) && getMinStaff(wp) > 0)
                .sort((a, b) => {
                    const aPool = doctors.filter(d => !usedToday.has(d.id) && !isExcluded(d.id, a.id) && isQualified(d.id, a.id)).length;
                    const bPool = doctors.filter(d => !usedToday.has(d.id) && !isExcluded(d.id, b.id) && isQualified(d.id, b.id)).length;
                    return aPool - bPool;
                });

            for (const wp of qualWps) {
                if (hasQualCoverage(wp)) continue;

                const candidates = doctors
                    .filter(d => !usedToday.has(d.id) && !isExcluded(d.id, wp.id) && isQualified(d.id, wp.id))
                    .sort((a, b) => {
                        const aRotElsewhere = getActiveRotationTargets(a.id, dateStr)
                            .some(t => t !== wp.name) ? 1 : 0;
                        const bRotElsewhere = getActiveRotationTargets(b.id, dateStr)
                            .some(t => t !== wp.name) ? 1 : 0;
                        if (aRotElsewhere !== bRotElsewhere) return aRotElsewhere - bRotElsewhere;
                        return getWeekly(a.id) - getWeekly(b.id);
                    });

                if (candidates.length > 0) {
                    assign(candidates[0].id, wp.name);
                }
            }

            // --- B.2: Fill to optimal_staff (round-robin) ---
            let changed = true;
            while (changed) {
                changed = false;

                const underFilled = availWps
                    .filter(wp => (posCount[wp.name] || 0) < getOptimal(wp))
                    .sort((a, b) => {
                        const aR = (posCount[a.name] || 0) / getOptimal(a);
                        const bR = (posCount[b.name] || 0) / getOptimal(b);
                        if (Math.abs(aR - bR) > 0.001) return aR - bR;
                        const aQ = hasQualReq(a) ? 0 : 1;
                        const bQ = hasQualReq(b) ? 0 : 1;
                        if (aQ !== bQ) return aQ - bQ;
                        return (a.order || 0) - (b.order || 0);
                    });

                if (underFilled.length === 0) break;

                const unassigned = doctors.filter(d => !usedToday.has(d.id));
                if (unassigned.length === 0) break;

                const targetWp = underFilled[0];

                const scored = unassigned.filter(doc => !isExcluded(doc.id, targetWp.id)).map(doc => {
                    const rotTargets = getActiveRotationTargets(doc.id, dateStr);
                    const hasRotHere = rotTargets.includes(targetWp.name);
                    const hasRotElsewhere = rotTargets.length > 0 && !hasRotHere;

                    let tier;
                    if (hasRotHere && getDisplaced(doc.id) > 0) tier = 0;
                    else if (hasRotHere) tier = 1;
                    else if (!hasRotElsewhere) tier = 2;
                    else tier = 3;

                    const qualified = isQualified(doc.id, targetWp.id);
                    const needsQualCoverage = hasQualReq(targetWp) && !hasQualCoverage(targetWp);
                    // Optional qualification: prefer doctors who have optional quals
                    const optQualScore = hasOptionalQuals(doc.id, targetWp.id) ? 0 :
                                         hasAnyOptionalQual(doc.id, targetWp.id) ? 1 : 2;

                    return {
                        doc, tier,
                        qualScore: needsQualCoverage && qualified ? 0 : (needsQualCoverage && !qualified ? 2 : 1),
                        optQualScore,
                        displaced: getDisplaced(doc.id),
                        weekly: getWeekly(doc.id),
                    };
                }).sort((a, b) => {
                    if (a.tier !== b.tier) return a.tier - b.tier;
                    if (a.qualScore !== b.qualScore) return a.qualScore - b.qualScore;
                    if (a.optQualScore !== b.optQualScore) return a.optQualScore - b.optQualScore;
                    if (a.displaced !== b.displaced) return b.displaced - a.displaced;
                    return a.weekly - b.weekly;
                });

                if (scored.length > 0) {
                    const chosen = scored[0].doc;
                    assign(chosen.id, targetWp.name);

                    const rotTargets = getActiveRotationTargets(chosen.id, dateStr);
                    if (rotTargets.length > 0 && !rotTargets.includes(targetWp.name)) {
                        addDisplacement(chosen.id);
                    }
                    changed = true;
                }
            }

            // --- B.3: Over-fill remaining doctors into allows_multiple ---
            let overChanged = true;
            while (overChanged) {
                overChanged = false;

                const remaining = doctors.filter(d => !usedToday.has(d.id));
                if (remaining.length === 0) break;

                const options = availWps
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

                const doc = remaining.sort((a, b) => {
                    const aRotMatch = getActiveRotationTargets(a.id, dateStr).includes(options[0].wp.name) ? 0 : 1;
                    const bRotMatch = getActiveRotationTargets(b.id, dateStr).includes(options[0].wp.name) ? 0 : 1;
                    if (aRotMatch !== bRotMatch) return aRotMatch - bRotMatch;
                    return getWeekly(a.id) - getWeekly(b.id);
                })[0];

                const bestForDoc = options
                    .filter(o => !isExcluded(doc.id, o.wp.id))
                    .map(o => {
                        const rotTargets = getActiveRotationTargets(doc.id, dateStr);
                        const isRotTarget = rotTargets.includes(o.wp.name) ? 0 : 1;
                        const isQual = isQualified(doc.id, o.wp.id) ? 0 : 1;
                        const optQual = hasOptionalQuals(doc.id, o.wp.id) ? 0 :
                                        hasAnyOptionalQual(doc.id, o.wp.id) ? 1 : 2;
                        return { ...o, isRotTarget, isQual, optQual };
                    })
                    .sort((a, b) => {
                        if (a.isRotTarget !== b.isRotTarget) return a.isRotTarget - b.isRotTarget;
                        if (a.isQual !== b.isQual) return a.isQual - b.isQual;
                        if (a.optQual !== b.optQual) return a.optQual - b.optQual;
                        if (Math.abs(a.fillRatio - b.fillRatio) > 0.001) return a.fillRatio - b.fillRatio;
                        return (a.wp.order || 0) - (b.wp.order || 0);
                    });

                if (bestForDoc.length > 0) {
                    assign(doc.id, bestForDoc[0].wp.name);
                    const rotTargets = getActiveRotationTargets(doc.id, dateStr);
                    if (rotTargets.length > 0 && !rotTargets.includes(bestForDoc[0].wp.name)) {
                        addDisplacement(doc.id);
                    }
                    overChanged = true;
                }
            }
        }

        // ============================================================
        //  PHASE C: Nicht-verfügbarkeitsrelevante Arbeitsplätze
        //  (affects_availability=false) — Ärzte aus Phase B bleiben verfügbar
        // ============================================================
        const nonAvailWps = allTodayWps.filter(wp =>
            !isServiceWp(wp) && !isAffectsAvailability(wp)
        );

        if (nonAvailWps.length > 0) {
            // For Phase C, only service-blocked and absence-blocked doctors are excluded.
            // Doctors assigned in Phase B (availability-relevant workplaces) ARE available.
            // KEY RULE: For workplaces with Pflichtqualifikation (mandatory qualifications),
            // a qualified doctor may be assigned to MULTIPLE such workplaces.
            // An unqualified doctor must NEVER be assigned alone to a Pflicht-workplace.
            const phaseC_blocked = new Set(serviceBlocked);

            const phaseCPosCount = { ...posCount };

            // Track which doctor is assigned to which Phase C workplaces (to prevent same-wp duplicates)
            const phaseCAssignments = {}; // doctor_id -> Set<wpName>

            const isAlreadyAssignedToWp = (docId, wpName) => {
                if (phaseCAssignments[docId]?.has(wpName)) return true;
                return existingShifts.some(s => s.date === dateStr && s.position === wpName && s.doctor_id === docId) ||
                       suggestions.some(s => s.date === dateStr && s.position === wpName && s.doctor_id === docId);
            };

            const assignC = (docId, wpName, wpHasQualReq) => {
                suggestions.push({ date: dateStr, position: wpName, doctor_id: docId, isPreview: true });
                phaseCPosCount[wpName] = (phaseCPosCount[wpName] || 0) + 1;
                incWeekly(docId);
                if (!phaseCAssignments[docId]) phaseCAssignments[docId] = new Set();
                phaseCAssignments[docId].add(wpName);
                // Only block for non-Pflicht workplaces; qualified doctors on Pflicht workplaces stay available
                if (!wpHasQualReq) {
                    phaseC_blocked.add(docId);
                }
            };

            // C.1: Qualification coverage — assign qualified doctors first (prefer unblocked ones)
            const qualWpsC = nonAvailWps
                .filter(wp => hasQualReq(wp) && getMinStaff(wp) > 0)
                .sort((a, b) => {
                    // Sort by smallest available qualified pool first (most constrained first)
                    const aPool = doctors.filter(d => !serviceBlocked.has(d.id) && !isExcluded(d.id, a.id) && isQualified(d.id, a.id)).length;
                    const bPool = doctors.filter(d => !serviceBlocked.has(d.id) && !isExcluded(d.id, b.id) && isQualified(d.id, b.id)).length;
                    return aPool - bPool;
                });

            for (const wp of qualWpsC) {
                const hasCov = [...existingShifts, ...suggestions].some(
                    s => s.date === dateStr && s.position === wp.name && isQualified(s.doctor_id, wp.id)
                );
                if (hasCov) continue;

                // First try unblocked qualified doctors
                let candidates = doctors
                    .filter(d => !phaseC_blocked.has(d.id) && !isExcluded(d.id, wp.id) &&
                                 isQualified(d.id, wp.id) && !isAlreadyAssignedToWp(d.id, wp.name))
                    .sort((a, b) => {
                        // Prefer doctors with optional qualifications
                        const aOpt = hasOptionalQuals(a.id, wp.id) ? 0 : 1;
                        const bOpt = hasOptionalQuals(b.id, wp.id) ? 0 : 1;
                        if (aOpt !== bOpt) return aOpt - bOpt;
                        return getWeekly(a.id) - getWeekly(b.id);
                    });

                // If none free, allow already-assigned-in-Phase-C qualified doctors (Mehrfachbesetzung!)
                if (candidates.length === 0) {
                    candidates = doctors
                        .filter(d => !serviceBlocked.has(d.id) && !isExcluded(d.id, wp.id) &&
                                     isQualified(d.id, wp.id) && !isAlreadyAssignedToWp(d.id, wp.name))
                        .sort((a, b) => {
                            const aOpt = hasOptionalQuals(a.id, wp.id) ? 0 : 1;
                            const bOpt = hasOptionalQuals(b.id, wp.id) ? 0 : 1;
                            if (aOpt !== bOpt) return aOpt - bOpt;
                            return getWeekly(a.id) - getWeekly(b.id);
                        });
                }

                if (candidates.length > 0) {
                    assignC(candidates[0].id, wp.name, true);
                }
            }

            // C.2: Fill to optimal_staff
            let changedC = true;
            while (changedC) {
                changedC = false;

                const underFilledC = nonAvailWps
                    .filter(wp => (phaseCPosCount[wp.name] || 0) < getOptimal(wp))
                    .sort((a, b) => {
                        const aR = (phaseCPosCount[a.name] || 0) / getOptimal(a);
                        const bR = (phaseCPosCount[b.name] || 0) / getOptimal(b);
                        if (Math.abs(aR - bR) > 0.001) return aR - bR;
                        return (a.order || 0) - (b.order || 0);
                    });

                if (underFilledC.length === 0) break;

                const targetWpC = underFilledC[0];
                const targetHasQualReq = hasQualReq(targetWpC);

                if (targetHasQualReq) {
                    // Pflicht-workplace: ONLY qualified doctors allowed, and they can be reused
                    // First try unblocked qualified
                    let scoredC = doctors
                        .filter(d => !serviceBlocked.has(d.id) && !phaseC_blocked.has(d.id) &&
                                     !isExcluded(d.id, targetWpC.id) && isQualified(d.id, targetWpC.id) &&
                                     !isAlreadyAssignedToWp(d.id, targetWpC.name))
                        .sort((a, b) => getWeekly(a.id) - getWeekly(b.id));

                    // If none free, allow already-assigned qualified (Mehrfachbesetzung)
                    if (scoredC.length === 0) {
                        scoredC = doctors
                            .filter(d => !serviceBlocked.has(d.id) && !isExcluded(d.id, targetWpC.id) &&
                                         isQualified(d.id, targetWpC.id) &&
                                         !isAlreadyAssignedToWp(d.id, targetWpC.name))
                            .sort((a, b) => getWeekly(a.id) - getWeekly(b.id));
                    }

                    if (scoredC.length > 0) {
                        assignC(scoredC[0].id, targetWpC.name, true);
                        changedC = true;
                    }
                } else {
                    // Non-Pflicht workplace: any unblocked doctor, prefer optional-qualified
                    const availableC = doctors.filter(d => !phaseC_blocked.has(d.id));
                    if (availableC.length === 0) break;

                    const scoredC = availableC
                        .filter(doc => !isExcluded(doc.id, targetWpC.id) &&
                                       !isAlreadyAssignedToWp(doc.id, targetWpC.name))
                        .map(doc => ({
                            doc,
                            qualified: isQualified(doc.id, targetWpC.id) ? 0 : 1,
                            optQual: hasOptionalQuals(doc.id, targetWpC.id) ? 0 :
                                      hasAnyOptionalQual(doc.id, targetWpC.id) ? 1 : 2,
                            weekly: getWeekly(doc.id),
                        }))
                        .sort((a, b) => {
                            if (a.qualified !== b.qualified) return a.qualified - b.qualified;
                            if (a.optQual !== b.optQual) return a.optQual - b.optQual;
                            return a.weekly - b.weekly;
                        });

                    if (scoredC.length > 0) {
                        assignC(scoredC[0].doc.id, targetWpC.name, false);
                        changedC = true;
                    }
                }
            }

            // C.3: Over-fill remaining into non-Pflicht workplaces
            let overChangedC = true;
            while (overChangedC) {
                overChangedC = false;

                const remainingC = doctors.filter(d => !phaseC_blocked.has(d.id));
                if (remainingC.length === 0) break;

                // Only over-fill into allows_multiple workplaces without Pflichtbesetzung
                const optionsC = nonAvailWps
                    .filter(wp => allowsMultiple(wp) && !hasQualReq(wp))
                    .map(wp => ({
                        wp,
                        fillRatio: (phaseCPosCount[wp.name] || 0) / Math.max(getOptimal(wp), 1),
                    }))
                    .sort((a, b) => {
                        if (Math.abs(a.fillRatio - b.fillRatio) > 0.001) return a.fillRatio - b.fillRatio;
                        return (a.wp.order || 0) - (b.wp.order || 0);
                    });

                if (optionsC.length === 0) break;

                const docC = remainingC.sort((a, b) => getWeekly(a.id) - getWeekly(b.id))[0];

                const bestC = optionsC
                    .filter(o => !isExcluded(docC.id, o.wp.id) &&
                                 !isAlreadyAssignedToWp(docC.id, o.wp.name))
                    .sort((a, b) => {
                        if (Math.abs(a.fillRatio - b.fillRatio) > 0.001) return a.fillRatio - b.fillRatio;
                        return (a.wp.order || 0) - (b.wp.order || 0);
                    });

                if (bestC.length > 0) {
                    assignC(docC.id, bestC[0].wp.name, false);
                    overChangedC = true;
                }
            }
        }
    }

    // ============================================================
    //  PHASE D: Auto-Frei for non-service auto_off positions
    //  (Service auto-frei was already handled in Phase A)
    // ============================================================
    for (const s of suggestions) {
        if (s.position === 'Frei') continue;
        const wp = workplaces.find(w => w.name === s.position);
        if (!wp?.auto_off) continue;
        if (wp.category === 'Dienste') continue; // Already handled in Phase A

        const alreadyGenerated = autoFreiSuggestions.some(
            af => af.doctor_id === s.doctor_id && af.date > s.date
        );
        if (!alreadyGenerated) {
            generateAutoFrei(s.doctor_id, s.date);
        }
    }

    return [...suggestions, ...autoFreiSuggestions];
}

/** Simple date formatter */
function formatDate(date) {
    const y = date.getFullYear();
    const m = (date.getMonth() + 1).toString().padStart(2, '0');
    const d = date.getDate().toString().padStart(2, '0');
    return `${y}-${m}-${d}`;
}
