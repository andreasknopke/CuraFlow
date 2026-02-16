/**
 * AI AutoFill Engine — Client module that calls the server-side LLM endpoint
 * to generate schedule suggestions using AI optimization.
 *
 * This module:
 *   1. Collects all scheduling data (same as deterministic engine)
 *   2. Runs the deterministic engine as a baseline
 *   3. Serializes qualifications into a transferable format
 *   4. Calls the server endpoint POST /api/schedule/ai-autofill
 *   5. Returns the AI-optimized suggestions
 */

import { api } from '@/api/client';
import { generateSuggestions } from './autoFillEngine';

/**
 * Generate AI-optimized schedule suggestions.
 *
 * @param {Object} params - Same parameters as generateSuggestions, plus extras
 * @param {Array} params.weekDays - Days of the week to fill
 * @param {Array} params.doctors - All doctors
 * @param {Array} params.workplaces - All workplaces
 * @param {Array} params.existingShifts - Existing (non-preview) shifts
 * @param {Array} params.allShifts - All shifts (for history)
 * @param {Array} params.trainingRotations - Active training rotations
 * @param {Function} params.isPublicHoliday - Holiday check function
 * @param {Function} params.getDoctorQualIds - Doctor qualification IDs getter
 * @param {Function} params.getWpRequiredQualIds - Workplace required qualification IDs
 * @param {Function} params.getWpOptionalQualIds - Workplace optional qualification IDs
 * @param {Function} params.getWpExcludedQualIds - Workplace excluded qualification IDs
 * @param {Function} params.getWpDiscouragedQualIds - Workplace discouraged qualification IDs
 * @param {Array} params.categoriesToFill - Categories to fill
 * @param {Array} params.systemSettings - System settings
 * @param {Array} params.wishes - Wish requests
 * @param {Array} params.allQualifications - All qualification definitions
 * @param {Array} params.allDoctorQualifications - All doctor-qualification assignments
 * @param {Array} params.allWorkplaceQualifications - All workplace-qualification assignments
 * @param {Array} params.scheduleRules - User-defined AI rules
 * @returns {Promise<{suggestions: Array, reasoning: string, provider: string, model: string, stats: Object, deterministicCount: number}>}
 */
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

  // 1. Run deterministic engine as baseline
  const deterministicBaseline = generateSuggestions({
    weekDays, doctors, workplaces,
    existingShifts, allShifts, trainingRotations,
    isPublicHoliday, getDoctorQualIds, getWpRequiredQualIds,
    getWpOptionalQualIds, getWpExcludedQualIds, getWpDiscouragedQualIds,
    categoriesToFill, systemSettings, wishes,
  });

  // 2. Format dates as strings
  const weekDayStrs = weekDays.map(d => formatDate(d));

  // 3. Identify holidays
  const holidays = weekDays
    .filter(d => isPublicHoliday(d))
    .map(d => formatDate(d));

  // 4. Build qualification data structure for server
  //    The server can't call the React hooks, so we serialize the data
  const doctorQuals = {};
  for (const doc of doctors) {
    doctorQuals[doc.id] = getDoctorQualIds(doc.id) || [];
  }

  const workplaceQuals = {};
  for (const wp of workplaces) {
    // Serialize all workplace-qualification relationships  
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

  // 5. Call the server endpoint
  const response = await api.request('/api/schedule/ai-autofill', {
    method: 'POST',
    body: JSON.stringify({
      weekDays: weekDayStrs,
      doctors: doctors.map(d => ({
        id: d.id,
        name: d.name,
        initials: d.initials,
        fte: d.fte ?? 1.0,
      })),
      workplaces: workplaces.map(w => ({
        id: w.id,
        name: w.name,
        category: w.category,
        affects_availability: w.affects_availability,
        allows_multiple: w.allows_multiple,
        allows_rotation_concurrently: w.allows_rotation_concurrently,
        min_staff: w.min_staff,
        optimal_staff: w.optimal_staff,
        auto_off: w.auto_off,
        active_days: w.active_days,
        order: w.order,
      })),
      existingShifts: existingShifts.map(s => ({
        date: s.date,
        position: s.position,
        doctor_id: s.doctor_id,
      })),
      trainingRotations: (trainingRotations || []).map(r => ({
        doctor_id: r.doctor_id,
        modality: r.modality,
        start_date: r.start_date,
        end_date: r.end_date,
      })),
      qualifications,
      wishes: (wishes || []).map(w => ({
        doctor_id: w.doctor_id,
        date: w.date,
        type: w.type,
        status: w.status,
        position: w.position,
      })),
      systemSettings: (systemSettings || []).map(s => ({
        key: s.key,
        value: s.value,
      })),
      deterministicBaseline: deterministicBaseline.map(s => ({
        date: s.date,
        position: s.position,
        doctor_id: s.doctor_id,
      })),
      holidays,
      scheduleRules: (scheduleRules || []).map(r => ({
        content: r.content,
        is_active: r.is_active,
      })),
    }),
  });

  return {
    suggestions: response.suggestions || [],
    reasoning: response.reasoning || '',
    provider: response.provider || 'Unknown',
    model: response.model || '',
    stats: response.stats || {},
    deterministicCount: deterministicBaseline.length,
  };
}

function formatDate(date) {
  const y = date.getFullYear();
  const m = (date.getMonth() + 1).toString().padStart(2, '0');
  const d = date.getDate().toString().padStart(2, '0');
  return `${y}-${m}-${d}`;
}
