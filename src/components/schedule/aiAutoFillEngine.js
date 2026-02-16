/**
 * AI AutoFill Engine v3 — Multi-Run Deterministic + LLM Swap Optimization
 *
 * Strategy (0 constraint violations guaranteed!):
 *   1. Run deterministic engine N times (different random shuffles → different results)
 *   2. Score each variant locally (fairness, rotation fulfillment, etc.)
 *   3. Send top 3 variants (as readable name-based plans) to server
 *   4. LLM picks the best variant and suggests targeted SWAPS to improve it
 *   5. Server validates each swap against hard constraints
 *   6. Return the optimized plan (all valid, all constraint-safe)
 *
 * Why this works:
 *   - Base plan always satisfies ALL hard constraints (deterministic engine)
 *   - LLM only does what it's good at: comparing options + strategic reasoning
 *   - Each swap is individually validated → impossible to introduce violations
 */

import { api } from '@/api/client';
import { generateSuggestions } from './autoFillEngine';

const NUM_VARIANTS = 8; // Number of deterministic runs to try

// ============================================================
//  Scoring: evaluate a plan variant on multiple dimensions
// ============================================================

function scorePlan(suggestions, doctors, workplaces, trainingRotations, weekDayStrs, qualData) {
  const absencePositions = ['Frei', 'Krank', 'Urlaub', 'Dienstreise', 'Nicht verfügbar'];
  let score = 0;

  // Build workplace lookup by name
  const wpByName = {};
  for (const wp of workplaces) wpByName[wp.name] = wp;

  // Qualification helpers
  const { getDoctorQualIds, getWpRequiredQualIds, getWpOptionalQualIds, getWpExcludedQualIds, getWpDiscouragedQualIds } = qualData || {};

  // 1. Fairness: std deviation of assignments per doctor (FTE-adjusted)
  const counts = {};
  for (const d of doctors) counts[d.id] = 0;
  for (const s of suggestions) {
    if (!absencePositions.includes(s.position) && s.position !== 'Verfügbar') {
      counts[s.doctor_id] = (counts[s.doctor_id] || 0) + 1;
    }
  }
  const fteAdjusted = doctors.map(d => (counts[d.id] || 0) / (d.fte || 1));
  const mean = fteAdjusted.reduce((a, b) => a + b, 0) / (fteAdjusted.length || 1);
  const variance = fteAdjusted.reduce((a, v) => a + (v - mean) ** 2, 0) / (fteAdjusted.length || 1);
  const fairnessScore = -Math.sqrt(variance) * 10; // Lower deviation = better
  score += fairnessScore;

  // 2. Rotation fulfillment: +2 for each rotation target met
  for (const rot of (trainingRotations || [])) {
    for (const dateStr of weekDayStrs) {
      if (rot.start_date <= dateStr && rot.end_date >= dateStr) {
        const assigned = suggestions.find(s =>
          s.date === dateStr && s.doctor_id === rot.doctor_id && s.position === rot.modality
        );
        if (assigned) score += 2;
      }
    }
  }

  // 3. Coverage: +0.1 for each filled slot
  score += suggestions.filter(s => !absencePositions.includes(s.position) && s.position !== 'Verfügbar').length * 0.1;

  // 4. QUALIFICATION QUALITY — heavy penalties for unqualified assignments
  if (getDoctorQualIds && getWpRequiredQualIds) {
    for (const s of suggestions) {
      if (absencePositions.includes(s.position) || s.position === 'Verfügbar') continue;
      const wp = wpByName[s.position];
      if (!wp) continue;

      // Excluded ("Nicht"): doctor must NOT be on this workplace → -25
      const excl = getWpExcludedQualIds?.(wp.id) || [];
      const docQuals = getDoctorQualIds(s.doctor_id) || [];
      if (excl.length > 0 && excl.some(q => docQuals.includes(q))) {
        score -= 25;
        continue;
      }

      // Discouraged ("Sollte-nicht"): doctor should avoid this workplace → -8
      const disc = getWpDiscouragedQualIds?.(wp.id) || [];
      if (disc.length > 0 && disc.some(q => docQuals.includes(q))) {
        score -= 8;
        continue;
      }

      // Missing mandatory qualification ("Pflicht"): → -15
      const req = getWpRequiredQualIds(wp.id) || [];
      if (req.length > 0 && !req.every(q => docQuals.includes(q))) {
        score -= 15;
        continue;
      }

      // Has optional qualifications ("Sollte"): → +1
      const opt = getWpOptionalQualIds?.(wp.id) || [];
      if (opt.length > 0 && opt.every(q => docQuals.includes(q))) {
        score += 1;
      }
    }
  }

  return Math.round(score * 100) / 100;
}

// ============================================================
//  Convert plan to readable name-based format for LLM
// ============================================================

function planToReadable(suggestions, doctors, weekDayStrs, qualData, workplaces) {
  const nameMap = {};
  for (const d of doctors) nameMap[d.id] = d.name;

  // Build workplace lookup by name for qualification checks
  const wpByName = {};
  for (const wp of (workplaces || [])) wpByName[wp.name] = wp;
  const { getDoctorQualIds, getWpRequiredQualIds, getWpExcludedQualIds, getWpDiscouragedQualIds } = qualData || {};

  const byDate = {};
  for (const s of suggestions) {
    if (!byDate[s.date]) byDate[s.date] = {};
    if (!byDate[s.date][s.position]) byDate[s.date][s.position] = [];

    let label = nameMap[s.doctor_id] || s.doctor_id;

    // Annotate unqualified/discouraged assignments so LLM can see quality issues
    if (getDoctorQualIds && getWpRequiredQualIds) {
      const wp = wpByName[s.position];
      if (wp) {
        const docQuals = getDoctorQualIds(s.doctor_id) || [];
        const excl = getWpExcludedQualIds?.(wp.id) || [];
        const disc = getWpDiscouragedQualIds?.(wp.id) || [];
        const req = getWpRequiredQualIds(wp.id) || [];

        if (excl.length > 0 && excl.some(q => docQuals.includes(q))) {
          label += ' (NICHT-QUALIFIZIERT!)';
        } else if (disc.length > 0 && disc.some(q => docQuals.includes(q))) {
          label += ' (sollte-nicht)';
        } else if (req.length > 0 && !req.every(q => docQuals.includes(q))) {
          label += ' (UNQUALIFIZIERT!)';
        }
      }
    }

    byDate[s.date][s.position].push(label);
  }

  // Sort dates
  const sorted = {};
  for (const d of weekDayStrs) {
    if (byDate[d]) sorted[d] = byDate[d];
  }

  return sorted;
}

// ============================================================
//  Main entry point
// ============================================================

export async function generateAISuggestions(params) {
  const {
    weekDays, doctors, workplaces, existingShifts, allShifts,
    trainingRotations, isPublicHoliday,
    getDoctorQualIds, getWpRequiredQualIds, getWpOptionalQualIds,
    getWpExcludedQualIds, getWpDiscouragedQualIds,
    categoriesToFill, systemSettings, wishes,
    allQualifications, allDoctorQualifications, allWorkplaceQualifications,
    scheduleRules,
  } = params;

  const weekDayStrs = weekDays.map(d => formatDate(d));
  const holidays = weekDays.filter(d => isPublicHoliday(d)).map(d => formatDate(d));

  const detParams = {
    weekDays, doctors, workplaces,
    existingShifts, allShifts, trainingRotations,
    isPublicHoliday, getDoctorQualIds, getWpRequiredQualIds,
    getWpOptionalQualIds, getWpExcludedQualIds, getWpDiscouragedQualIds,
    categoriesToFill, systemSettings, wishes,
  };

  // Qualification data for scoring
  const qualData = {
    getDoctorQualIds, getWpRequiredQualIds, getWpOptionalQualIds,
    getWpExcludedQualIds, getWpDiscouragedQualIds,
  };

  // 1. Run deterministic engine N times (each run shuffles doctors differently)
  console.log(`[AI AutoFill v3] Running ${NUM_VARIANTS} deterministic variants...`);
  const variants = [];
  for (let i = 0; i < NUM_VARIANTS; i++) {
    const suggestions = generateSuggestions(detParams);
    const score = scorePlan(suggestions, doctors, workplaces, trainingRotations, weekDayStrs, qualData);
    variants.push({ suggestions, score, index: i });
  }

  // 2. Sort by score (best first), pick top 3
  variants.sort((a, b) => b.score - a.score);
  const topVariants = variants.slice(0, 3);
  console.log(`[AI AutoFill v3] Variant scores: ${variants.map(v => v.score).join(', ')}`);
  console.log(`[AI AutoFill v3] Top 3: ${topVariants.map(v => `#${v.index}(${v.score})`).join(', ')}`);

  // 3. Convert to readable format for LLM
  const readableVariants = topVariants.map((v, idx) => ({
    id: idx,
    score: v.score,
    plan: planToReadable(v.suggestions, doctors, weekDayStrs, qualData, workplaces),
  }));

  // 4. Build qualification data for server validation
  const doctorQuals = {};
  for (const doc of doctors) {
    doctorQuals[doc.id] = getDoctorQualIds(doc.id) || [];
  }
  const workplaceQuals = {};
  for (const wp of workplaces) {
    const wpQuals = (allWorkplaceQualifications || []).filter(wq => wq.workplace_id === wp.id);
    workplaceQuals[wp.id] = wpQuals.map(wq => ({
      qualification_id: wq.qualification_id,
      is_mandatory: wq.is_mandatory,
      is_excluded: wq.is_excluded,
    }));
  }
  const qualifications = {
    allQuals: (allQualifications || []).map(q => ({ id: q.id, name: q.name })),
    doctorQuals,
    workplaceQuals,
  };

  // 5. Call server endpoint
  const response = await api.request('/api/schedule/ai-autofill', {
    method: 'POST',
    body: JSON.stringify({
      weekDays: weekDayStrs,
      doctors: doctors.map(d => ({
        id: d.id, name: d.name, initials: d.initials, fte: d.fte ?? 1.0,
      })),
      workplaces: workplaces.map(w => ({
        id: w.id, name: w.name, category: w.category,
        affects_availability: w.affects_availability,
        allows_multiple: w.allows_multiple,
        allows_rotation_concurrently: w.allows_rotation_concurrently,
        min_staff: w.min_staff, optimal_staff: w.optimal_staff,
        auto_off: w.auto_off, active_days: w.active_days, order: w.order,
      })),
      existingShifts: existingShifts.map(s => ({
        date: s.date, position: s.position, doctor_id: s.doctor_id,
      })),
      trainingRotations: (trainingRotations || []).map(r => ({
        doctor_id: r.doctor_id, modality: r.modality,
        start_date: r.start_date, end_date: r.end_date,
      })),
      qualifications,
      wishes: (wishes || []).map(w => ({
        doctor_id: w.doctor_id, date: w.date, type: w.type,
        status: w.status, position: w.position,
      })),
      systemSettings: (systemSettings || []).map(s => ({ key: s.key, value: s.value })),
      // NEW: send top 3 scored variants instead of single baseline
      variants: readableVariants,
      // Also send the raw best variant for fallback
      bestVariant: topVariants[0].suggestions.map(s => ({
        date: s.date, position: s.position, doctor_id: s.doctor_id,
      })),
      holidays,
      scheduleRules: (scheduleRules || []).map(r => ({
        content: r.content, is_active: r.is_active,
      })),
    }),
  });

  // 6. If server returned swap-optimized plan, use it; otherwise fall back to best deterministic
  const aiSuggestions = response.suggestions || [];

  return {
    suggestions: aiSuggestions.length > 0 ? aiSuggestions : topVariants[0].suggestions,
    reasoning: response.reasoning || '',
    provider: response.provider || 'Unknown',
    model: response.model || '',
    stats: {
      ...response.stats,
      variantsGenerated: NUM_VARIANTS,
      variantScores: variants.map(v => v.score),
    },
    deterministicCount: topVariants[0].suggestions.length,
  };
}

function formatDate(date) {
  const y = date.getFullYear();
  const m = (date.getMonth() + 1).toString().padStart(2, '0');
  const d = date.getDate().toString().padStart(2, '0');
  return `${y}-${m}-${d}`;
}
