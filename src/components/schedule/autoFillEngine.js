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
 *
 * Cost Function (v2):
 *   All candidate sorting now uses a unified additive cost function (CostFunction class)
 *   inspired by the ChordMatcher pattern. Lower cost = better candidate.
 *   See costFunction.js for dimension details and tuneable weights.
 */

import { CostFunction } from './costFunction';

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
    getWpDiscouragedQualIds,
    categoriesToFill,
    systemSettings,
    wishes = [],
}) {
    // Shuffle doctors to avoid deterministic bias (e.g. same doctors always getting Monday shifts)
    const shuffled = [...doctors];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    doctors = shuffled;

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

    /** Is the doctor DISCOURAGED from this workplace via a 'Sollte nicht'-qualification? */
    const isDiscouraged = (doctorId, wpId) => {
        const disc = getWpDiscouragedQualIds?.(wpId);
        if (!disc?.length) return false;
        const doc = getDoctorQualIds(doctorId);
        if (!doc?.length) return false;
        return disc.some(q => doc.includes(q));
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

    // ========================================================
    //  Cost Function instance (shared across all phases)
    // ========================================================
    const costFn = new CostFunction({
        doctors,
        workplaces,
        existingShifts,
        suggestions,
        trainingRotations,
        getDoctorQualIds,
        getWpRequiredQualIds,
        getWpOptionalQualIds,
        getWpExcludedQualIds,
        getWpDiscouragedQualIds,
        wishes,
        serviceHistory,
        weeklyCount,
        foregroundPosition,
        backgroundPosition,
        limitFG,
        limitBG,
        limitWeekend,
        isPublicHoliday,
        autoFreiByDate,
        systemSettings,
    });

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

    /** Does this doctor have a specific service wish for a named position on this date? */
    const hasSpecificServiceWish = (doctorId, dateStr, positionName) => {
        return wishes.some(w =>
            w.doctor_id === doctorId &&
            w.date === dateStr &&
            w.type === 'service' &&
            (w.status === 'approved' || w.status === 'pending') &&
            w.position === positionName
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
        //  Pre-Phase A: Rotation qualification impact analysis
        //  Compute how critical each available doctor is for rotation
        //  workplaces that require mandatory qualifications.
        //  This prevents sending ALL qualified Fachärzte into services
        //  when they are the only ones who can fill rotation positions.
        //
        //  ALSO: For services with auto_off, consider the NEXT working
        //  day's impact. If a doctor gets Auto-Frei tomorrow, they can't
        //  fill rotation positions there either.
        // ============================================================
        const rotationImpactScore = {}; // doctorId -> number (higher = more critical for rotations)
        {
            /** Compute impact scores for a given day/date, considering who is blocked */
            const computeImpactForDay = (targetDay, blockedSet, multiplier) => {
                const critWps = workplaces.filter(wp =>
                    !isServiceWp(wp) &&
                    isAffectsAvailability(wp) &&
                    isActiveOnDate(wp, targetDay) &&
                    hasQualReq(wp) &&
                    getMinStaff(wp) > 0
                );

                for (const wp of critWps) {
                    const qualifiedPool = doctors.filter(d =>
                        !blockedSet.has(d.id) &&
                        !isExcluded(d.id, wp.id) &&
                        isQualified(d.id, wp.id)
                    );
                    const poolSize = qualifiedPool.length;
                    if (poolSize === 0) continue;
                    for (const doc of qualifiedPool) {
                        if (!rotationImpactScore[doc.id]) rotationImpactScore[doc.id] = 0;
                        if (poolSize <= 1) rotationImpactScore[doc.id] += 10 * multiplier;
                        else if (poolSize <= 2) rotationImpactScore[doc.id] += 5 * multiplier;
                        else if (poolSize <= 3) rotationImpactScore[doc.id] += 2 * multiplier;
                        else rotationImpactScore[doc.id] += 1 * multiplier;
                    }
                }
            };

            // Impact for TODAY (weight 1x)
            computeImpactForDay(day, baseBlocked, 1);

            // Impact for NEXT WORKING DAY (weight 1x) — relevant for auto_off services
            // If any active service today has auto_off, the chosen doctor will be
            // blocked tomorrow. We must account for that.
            const hasAutoOffService = allTodayWps.some(wp => isServiceWp(wp) && wp.auto_off);
            if (hasAutoOffService) {
                // Find next working day (same logic as generateAutoFrei)
                const nextDay = new Date(day);
                nextDay.setDate(nextDay.getDate() + 1);
                for (let i = 0; i < 7; i++) {
                    if (nextDay.getDay() !== 0 && nextDay.getDay() !== 6 && !isPublicHoliday(nextDay)) break;
                    nextDay.setDate(nextDay.getDate() + 1);
                }
                const nextDateStr = formatDate(nextDay);

                // Build blocked set for next day: absences + existing assignments + auto-frei
                const nextDayBlocked = new Set();
                if (autoFreiByDate[nextDateStr]) {
                    for (const docId of autoFreiByDate[nextDateStr]) nextDayBlocked.add(docId);
                }
                for (const s of existingShifts) {
                    if (s.date !== nextDateStr) continue;
                    if (absencePositions.includes(s.position)) { nextDayBlocked.add(s.doctor_id); continue; }
                    if (s.position === 'Verfügbar') continue;
                    const xwp = workplaces.find(w => w.name === s.position);
                    if (xwp?.affects_availability === false) continue;
                    if (xwp?.allows_rotation_concurrently) continue;
                    if (xwp?.category === 'Demonstrationen & Konsile') continue;
                    nextDayBlocked.add(s.doctor_id);
                }

                computeImpactForDay(nextDay, nextDayBlocked, 1);
            }
        }

        const getRotationImpact = (docId) => rotationImpactScore[docId] || 0;

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
                // EXCEPTION: Allow dual-service if doctor has a specific wish for THIS service
                // (e.g. wishes for both Spätdienst and Hintergrunddienst on the same day)
                const allCandidates = doctors.filter(d => {
                    const hasWishForThis = hasSpecificServiceWish(d.id, dateStr, svc.name);
                    return (
                        (!usedToday.has(d.id) || hasWishForThis) &&
                        (!serviceAssignedToday.has(d.id) || hasWishForThis) &&
                        !isExcluded(d.id, svc.id) &&
                        !hasApprovedNoService(d.id, dateStr) &&
                        isQualified(d.id, svc.id) &&
                        !wouldExceedLimit(d.id, svc.name, dateStr)
                    );
                });

                // Separate candidates into priority tiers
                // → NOW: Use unified cost function instead of manual tier separation
                const costContext = {
                    usedToday,
                    posCount,
                    displacementCount,
                    rotationImpactScore,
                    serviceAssignedToday,
                    phase: 'A',
                };

                // Sort ALL candidates by cost (ascending = best first)
                // The cost function handles wishes, fairness, impact, limits, etc.
                allCandidates.sort((a, b) => {
                    const costA = costFn.assignmentCost(a.id, svc, dateStr, costContext);
                    const costB = costFn.assignmentCost(b.id, svc, dateStr, costContext);
                    return costA - costB;
                });

                const ranked = allCandidates.filter(d => {
                    const cost = costFn.assignmentCost(d.id, svc, dateStr, costContext);
                    return cost < Infinity;
                });

                // If no candidates within limits, fall back to all qualified (limit exceeded = last resort)
                if (ranked.length === 0) {
                    const fallbackContext = { ...costContext };
                    const fallback = doctors.filter(d => {
                        const hasWishForThis = hasSpecificServiceWish(d.id, dateStr, svc.name);
                        return (
                            (!usedToday.has(d.id) || hasWishForThis) &&
                            (!serviceAssignedToday.has(d.id) || hasWishForThis) &&
                            !isExcluded(d.id, svc.id) &&
                            !hasApprovedNoService(d.id, dateStr) &&
                            isQualified(d.id, svc.id)
                        );
                    }).sort((a, b) => {
                        const costA = costFn.assignmentCost(a.id, svc, dateStr, fallbackContext);
                        const costB = costFn.assignmentCost(b.id, svc, dateStr, fallbackContext);
                        // Filter out Infinity costs but allow LIMIT_EXCEEDED costs
                        return costA - costB;
                    });
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

                const sortB1 = (a, b) => {
                    const aRotElsewhere = getActiveRotationTargets(a.id, dateStr)
                        .some(t => t !== wp.name) ? 1 : 0;
                    const bRotElsewhere = getActiveRotationTargets(b.id, dateStr)
                        .some(t => t !== wp.name) ? 1 : 0;
                    if (aRotElsewhere !== bRotElsewhere) return aRotElsewhere - bRotElsewhere;
                    return getWeekly(a.id) - getWeekly(b.id);
                };

                // Progressive filtering: "Sollte nicht" + "Sollte" with fallback
                let eligible = doctors
                    .filter(d => !usedToday.has(d.id) && !isExcluded(d.id, wp.id) && isQualified(d.id, wp.id));

                // "Sollte nicht": filter out discouraged doctors (fallback if none remain)
                {
                    const nonDiscouraged = eligible.filter(d => !isDiscouraged(d.id, wp.id));
                    if (nonDiscouraged.length > 0) eligible = nonDiscouraged;
                }

                // "Sollte": filter to doctors with preferred quals (fallback if none remain)
                if (hasOptionalQualReq(wp)) {
                    const withPreferred = eligible.filter(d => hasOptionalQuals(d.id, wp.id));
                    if (withPreferred.length > 0) eligible = withPreferred;
                }

                const candidates = eligible.sort(sortB1);

                if (candidates.length > 0) {
                    assign(candidates[0].id, wp.name);
                }
            }

            // --- B.2: Fill to optimal_staff (round-robin) ---
            // Priority: 1) Workplaces below min_staff first (critical)
            //           2) Then workplaces below optimal but above min_staff
            //           3) min_staff=0 workplaces are filled last
            let changed = true;
            while (changed) {
                changed = false;

                const underFilled = availWps
                    .filter(wp => (posCount[wp.name] || 0) < getOptimal(wp))
                    .sort((a, b) => {
                        const aCur = posCount[a.name] || 0;
                        const bCur = posCount[b.name] || 0;
                        const aMin = getMinStaff(a);
                        const bMin = getMinStaff(b);
                        const aOpt = getOptimal(a);
                        const bOpt = getOptimal(b);

                        // Tier 0: below min_staff (critical shortage)
                        // Tier 1: at/above min_staff but below optimal (min_staff > 0)
                        // Tier 2: min_staff=0, still below optimal (nice to fill, lowest priority)
                        const aTier = aCur < aMin ? 0 : (aMin > 0 ? 1 : 2);
                        const bTier = bCur < bMin ? 0 : (bMin > 0 ? 1 : 2);
                        if (aTier !== bTier) return aTier - bTier;

                        // Within same tier, sort by fill ratio (least filled first)
                        const aR = aCur / aOpt;
                        const bR = bCur / bOpt;
                        if (Math.abs(aR - bR) > 0.001) return aR - bR;

                        // Prefer workplaces with higher optimal (more staff needed = more important)
                        if (aOpt !== bOpt) return bOpt - aOpt;

                        const aQ = hasQualReq(a) ? 0 : 1;
                        const bQ = hasQualReq(b) ? 0 : 1;
                        if (aQ !== bQ) return aQ - bQ;
                        return (a.order || 0) - (b.order || 0);
                    });

                if (underFilled.length === 0) break;

                const unassigned = doctors.filter(d => !usedToday.has(d.id));
                if (unassigned.length === 0) break;

                const targetWp = underFilled[0];

                // Cost-based candidate sorting (replaces tier-based scoreCandidate/sortCandidates)
                const costContextB = {
                    usedToday,
                    posCount,
                    displacementCount,
                    rotationImpactScore,
                    serviceAssignedToday,
                    phase: 'B',
                };

                // Progressive filtering: "Sollte nicht" + "Sollte" with fallback
                let eligible = unassigned.filter(doc => !isExcluded(doc.id, targetWp.id));

                // "Sollte nicht": filter out discouraged doctors (fallback if none remain)
                {
                    const nonDiscouraged = eligible.filter(doc => !isDiscouraged(doc.id, targetWp.id));
                    if (nonDiscouraged.length > 0) eligible = nonDiscouraged;
                }

                // "Sollte": filter to doctors with preferred quals (fallback if none remain)
                if (hasOptionalQualReq(targetWp)) {
                    const withPreferred = eligible.filter(doc => hasOptionalQuals(doc.id, targetWp.id));
                    if (withPreferred.length > 0) eligible = withPreferred;
                }

                // Sort by cost function (ascending = best first)
                eligible.sort((a, b) => {
                    const costA = costFn.assignmentCost(a.id, targetWp, dateStr, costContextB);
                    const costB = costFn.assignmentCost(b.id, targetWp, dateStr, costContextB);
                    return costA - costB;
                });

                if (eligible.length > 0 && costFn.assignmentCost(eligible[0].id, targetWp, dateStr, costContextB) < Infinity) {
                    const chosen = eligible[0];
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

                // Cost-based: pick doctor with lowest cost for best available workplace
                const costContextB3 = {
                    usedToday,
                    posCount,
                    displacementCount,
                    rotationImpactScore,
                    serviceAssignedToday,
                    phase: 'B',
                };

                // For each remaining doctor, find their best workplace by cost
                let bestAssignment = null;
                let bestCost = Infinity;

                for (const doc of remaining) {
                    // Progressive filtering: "Sollte nicht" + "Sollte" with fallback
                    let eligibleWps = options.filter(o => !isExcluded(doc.id, o.wp.id));

                    // "Sollte nicht": filter out workplaces where doctor is discouraged (fallback)
                    {
                        const nonDiscouraged = eligibleWps.filter(o => !isDiscouraged(doc.id, o.wp.id));
                        if (nonDiscouraged.length > 0) eligibleWps = nonDiscouraged;
                    }

                    // "Sollte": prefer workplaces where doctor has preferred quals (fallback)
                    {
                        const withPreferred = eligibleWps.filter(o =>
                            !hasOptionalQualReq(o.wp) || hasOptionalQuals(doc.id, o.wp.id)
                        );
                        if (withPreferred.length > 0) eligibleWps = withPreferred;
                    }

                    for (const o of eligibleWps) {
                        const cost = costFn.assignmentCost(doc.id, o.wp, dateStr, costContextB3);
                        // Add fill ratio as a tiebreaker to spread assignments
                        const adjustedCost = cost + o.fillRatio * 2;
                        if (adjustedCost < bestCost) {
                            bestCost = adjustedCost;
                            bestAssignment = { doc, wp: o.wp };
                        }
                    }
                }

                if (bestAssignment && bestCost < Infinity) {
                    assign(bestAssignment.doc.id, bestAssignment.wp.name);
                    const rotTargets = getActiveRotationTargets(bestAssignment.doc.id, dateStr);
                    if (rotTargets.length > 0 && !rotTargets.includes(bestAssignment.wp.name)) {
                        addDisplacement(bestAssignment.doc.id);
                    }
                    overChanged = true;
                }
            }
        }

        // ============================================================
        //  Sole-occupant detection: doctors who are the only person at
        //  an availability-relevant workplace should be deprioritized
        //  for Demo assignments (only assigned if no one else available)
        // ============================================================
        const soleOccupantDoctors = new Set();
        {
            const wpStaffing = {}; // wpName -> Set of doctorIds
            for (const s of existingShifts) {
                if (s.date !== dateStr) continue;
                if (absencePositions.includes(s.position) || s.position === 'Verfügbar') continue;
                const wp = workplaces.find(w => w.name === s.position);
                if (!wp || wp.category === 'Dienste' || wp.category === 'Demonstrationen & Konsile') continue;
                if (wp.affects_availability === false) continue;
                if (!wpStaffing[wp.name]) wpStaffing[wp.name] = new Set();
                wpStaffing[wp.name].add(s.doctor_id);
            }
            for (const s of suggestions) {
                if (s.date !== dateStr) continue;
                if (s.position === 'Frei') continue;
                const wp = workplaces.find(w => w.name === s.position);
                if (!wp || wp.category === 'Dienste' || wp.category === 'Demonstrationen & Konsile') continue;
                if (wp.affects_availability === false) continue;
                if (!wpStaffing[wp.name]) wpStaffing[wp.name] = new Set();
                wpStaffing[wp.name].add(s.doctor_id);
            }
            for (const [, docIds] of Object.entries(wpStaffing)) {
                if (docIds.size === 1) {
                    for (const docId of docIds) soleOccupantDoctors.add(docId);
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

                const costContextC1 = {
                    usedToday: phaseC_blocked,
                    posCount: phaseCPosCount,
                    displacementCount,
                    rotationImpactScore,
                    serviceAssignedToday,
                    soleOccupantDoctors,
                    phase: 'C',
                };

                // Cost-based sorting for C.1 with progressive fallback stages
                // Stage 1: unblocked, not discouraged, qualified
                let candidates = doctors
                    .filter(d => !phaseC_blocked.has(d.id) && !isExcluded(d.id, wp.id) &&
                                 !isDiscouraged(d.id, wp.id) &&
                                 isQualified(d.id, wp.id) && !isAlreadyAssignedToWp(d.id, wp.name));
                if (hasOptionalQualReq(wp) && candidates.length > 0) {
                    const withPref = candidates.filter(d => hasOptionalQuals(d.id, wp.id));
                    if (withPref.length > 0) candidates = withPref;
                }

                if (candidates.length === 0) {
                    // Fallback: include discouraged doctors
                    candidates = doctors
                        .filter(d => !phaseC_blocked.has(d.id) && !isExcluded(d.id, wp.id) &&
                                     isQualified(d.id, wp.id) && !isAlreadyAssignedToWp(d.id, wp.name));
                    if (hasOptionalQualReq(wp) && candidates.length > 0) {
                        const withPref = candidates.filter(d => hasOptionalQuals(d.id, wp.id));
                        if (withPref.length > 0) candidates = withPref;
                    }
                }

                // If none free, allow already-assigned-in-Phase-C qualified doctors (Mehrfachbesetzung!)
                if (candidates.length === 0) {
                    candidates = doctors
                        .filter(d => !serviceBlocked.has(d.id) && !isExcluded(d.id, wp.id) &&
                                     !isDiscouraged(d.id, wp.id) &&
                                     isQualified(d.id, wp.id) && !isAlreadyAssignedToWp(d.id, wp.name));
                    if (hasOptionalQualReq(wp) && candidates.length > 0) {
                        const withPref = candidates.filter(d => hasOptionalQuals(d.id, wp.id));
                        if (withPref.length > 0) candidates = withPref;
                    }
                }
                if (candidates.length === 0) {
                    // Fallback: include discouraged doctors in Mehrfachbesetzung
                    candidates = doctors
                        .filter(d => !serviceBlocked.has(d.id) && !isExcluded(d.id, wp.id) &&
                                     isQualified(d.id, wp.id) && !isAlreadyAssignedToWp(d.id, wp.name));
                    if (hasOptionalQualReq(wp) && candidates.length > 0) {
                        const withPref = candidates.filter(d => hasOptionalQuals(d.id, wp.id));
                        if (withPref.length > 0) candidates = withPref;
                    }
                }

                // Sort by cost function
                candidates.sort((a, b) => {
                    const costA = costFn.assignmentCost(a.id, wp, dateStr, costContextC1);
                    const costB = costFn.assignmentCost(b.id, wp, dateStr, costContextC1);
                    return costA - costB;
                });

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

                const costContextC2 = {
                    usedToday: phaseC_blocked,
                    posCount: phaseCPosCount,
                    displacementCount,
                    rotationImpactScore,
                    serviceAssignedToday,
                    soleOccupantDoctors,
                    phase: 'C',
                };

                if (targetHasQualReq) {
                    // Pflicht-workplace: ONLY qualified doctors allowed, and they can be reused
                    // First try unblocked qualified with progressive filtering
                    let eligiblePflicht = doctors
                        .filter(d => !serviceBlocked.has(d.id) && !phaseC_blocked.has(d.id) &&
                                     !isExcluded(d.id, targetWpC.id) && isQualified(d.id, targetWpC.id) &&
                                     !isAlreadyAssignedToWp(d.id, targetWpC.name));
                    // "Sollte nicht": filter out discouraged (fallback)
                    {
                        const nonDisc = eligiblePflicht.filter(d => !isDiscouraged(d.id, targetWpC.id));
                        if (nonDisc.length > 0) eligiblePflicht = nonDisc;
                    }
                    // "Sollte": filter to doctors with preferred quals (fallback)
                    if (hasOptionalQualReq(targetWpC)) {
                        const withPref = eligiblePflicht.filter(d => hasOptionalQuals(d.id, targetWpC.id));
                        if (withPref.length > 0) eligiblePflicht = withPref;
                    }

                    // Sort by cost function
                    eligiblePflicht.sort((a, b) => {
                        const costA = costFn.assignmentCost(a.id, targetWpC, dateStr, costContextC2);
                        const costB = costFn.assignmentCost(b.id, targetWpC, dateStr, costContextC2);
                        return costA - costB;
                    });

                    // If none free, allow already-assigned qualified (Mehrfachbesetzung)
                    if (eligiblePflicht.length === 0) {
                        let eligibleMehr = doctors
                            .filter(d => !serviceBlocked.has(d.id) && !isExcluded(d.id, targetWpC.id) &&
                                         isQualified(d.id, targetWpC.id) &&
                                         !isAlreadyAssignedToWp(d.id, targetWpC.name));
                        {
                            const nonDisc = eligibleMehr.filter(d => !isDiscouraged(d.id, targetWpC.id));
                            if (nonDisc.length > 0) eligibleMehr = nonDisc;
                        }
                        if (hasOptionalQualReq(targetWpC)) {
                            const withPref = eligibleMehr.filter(d => hasOptionalQuals(d.id, targetWpC.id));
                            if (withPref.length > 0) eligibleMehr = withPref;
                        }
                        eligibleMehr.sort((a, b) => {
                            const costA = costFn.assignmentCost(a.id, targetWpC, dateStr, costContextC2);
                            const costB = costFn.assignmentCost(b.id, targetWpC, dateStr, costContextC2);
                            return costA - costB;
                        });
                        eligiblePflicht = eligibleMehr;
                    }

                    if (eligiblePflicht.length > 0) {
                        assignC(eligiblePflicht[0].id, targetWpC.name, true);
                        changedC = true;
                    }
                } else {
                    // Non-Pflicht workplace: any unblocked doctor
                    const availableC = doctors.filter(d => !phaseC_blocked.has(d.id));
                    if (availableC.length === 0) break;

                    // Progressive filtering: "Sollte nicht" + "Sollte" with fallback
                    let eligibleC = availableC.filter(doc => !isExcluded(doc.id, targetWpC.id) &&
                                                             !isAlreadyAssignedToWp(doc.id, targetWpC.name));

                    // "Sollte nicht": filter out discouraged (fallback)
                    {
                        const nonDiscouraged = eligibleC.filter(doc => !isDiscouraged(doc.id, targetWpC.id));
                        if (nonDiscouraged.length > 0) eligibleC = nonDiscouraged;
                    }

                    // "Sollte": filter to doctors with preferred quals (fallback)
                    if (hasOptionalQualReq(targetWpC)) {
                        const withPreferred = eligibleC.filter(doc => hasOptionalQuals(doc.id, targetWpC.id));
                        if (withPreferred.length > 0) eligibleC = withPreferred;
                    }

                    // Sort by cost function
                    eligibleC.sort((a, b) => {
                        const costA = costFn.assignmentCost(a.id, targetWpC, dateStr, costContextC2);
                        const costB = costFn.assignmentCost(b.id, targetWpC, dateStr, costContextC2);
                        return costA - costB;
                    });

                    if (eligibleC.length > 0 && costFn.assignmentCost(eligibleC[0].id, targetWpC, dateStr, costContextC2) < Infinity) {
                        assignC(eligibleC[0].id, targetWpC.name, false);
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

                const costContextC3 = {
                    usedToday: phaseC_blocked,
                    posCount: phaseCPosCount,
                    displacementCount,
                    rotationImpactScore,
                    serviceAssignedToday,
                    soleOccupantDoctors,
                    phase: 'C',
                };

                // Find best (doctor, workplace) pair by cost
                let bestAssignmentC = null;
                let bestCostC = Infinity;

                for (const docC of remainingC) {
                    // Progressive filtering: "Sollte nicht" + "Sollte" with fallback
                    let eligibleC3 = optionsC.filter(o => !isExcluded(docC.id, o.wp.id) &&
                                                           !isAlreadyAssignedToWp(docC.id, o.wp.name));
                    {
                        const nonDisc = eligibleC3.filter(o => !isDiscouraged(docC.id, o.wp.id));
                        if (nonDisc.length > 0) eligibleC3 = nonDisc;
                    }
                    {
                        const withPref = eligibleC3.filter(o =>
                            !hasOptionalQualReq(o.wp) || hasOptionalQuals(docC.id, o.wp.id)
                        );
                        if (withPref.length > 0) eligibleC3 = withPref;
                    }

                    for (const o of eligibleC3) {
                        const cost = costFn.assignmentCost(docC.id, o.wp, dateStr, costContextC3);
                        const adjustedCost = cost + o.fillRatio * 2;
                        if (adjustedCost < bestCostC) {
                            bestCostC = adjustedCost;
                            bestAssignmentC = { doc: docC, wp: o.wp };
                        }
                    }
                }

                if (bestAssignmentC && bestCostC < Infinity) {
                    assignC(bestAssignmentC.doc.id, bestAssignmentC.wp.name, false);
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
