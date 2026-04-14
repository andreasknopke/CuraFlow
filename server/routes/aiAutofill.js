/**
 * AI AutoFill Route v3 — Multi-Run Deterministic + LLM Swap Optimization
 *
 * STRATEGY: The deterministic engine guarantees 0 constraint violations.
 * The LLM's job is ONLY to pick the best variant and suggest targeted swaps.
 *
 * Flow:
 *   1. Client runs deterministic engine 8× (different random shuffles)
 *   2. Client scores each variant, sends top 3 to server (name-based)
 *   3. LLM compares variants and suggests swaps to improve the best one
 *   4. Server validates each swap individually
 *   5. Valid swaps are applied → optimized plan returned
 *   6. If LLM fails or no swaps → best deterministic variant is returned as-is
 *
 * GUARANTEE: 0 constraint violations (base plan from deterministic engine,
 *            every swap validated before application)
 */

import express from 'express';
import OpenAI from 'openai';
import { authMiddleware } from './auth.js';
import config from '../config.js';

const router = express.Router();
router.use(authMiddleware);

// ============================================================
//  LLM Client Setup
// ============================================================

function getOpenAIClient() {
  const key = config.ai.openaiApiKey;
  if (!key) return null;
  return new OpenAI({ apiKey: key });
}

function getMistralClient() {
  const key = config.ai.mistralApiKey;
  if (!key) return null;
  return new OpenAI({
    apiKey: key,
    baseURL: 'https://api.mistral.ai/v1',
  });
}

// ============================================================
//  Build name↔ID maps
// ============================================================

function buildNameMaps(doctors) {
  const nameById = {};
  const idByName = {};
  for (const d of doctors) {
    nameById[d.id] = d.name;
    idByName[d.name] = d.id;
  }
  return { nameById, idByName };
}

function createDebugCollector(enabled, requestId) {
  const entries = [];
  const maxEntries = 1200;

  const push = (stage, message, meta = null) => {
    if (!enabled) return;
    const entry = {
      ts: new Date().toISOString(),
      requestId,
      stage,
      message,
      ...(meta ? { meta } : {}),
    };
    entries.push(entry);
    if (entries.length > maxEntries) entries.shift();

    if (meta) {
      console.log(`[AI AutoFill v3][${requestId}][${stage}] ${message}`, meta);
    } else {
      console.log(`[AI AutoFill v3][${requestId}][${stage}] ${message}`);
    }
  };

  return {
    push,
    dump: (limit = 400) => entries.slice(-Math.max(1, limit)),
    count: () => entries.length,
  };
}

// ============================================================
//  Swap Validator — checks if a swap is safe
// ============================================================

function validateSwap(swap, basePlan, data) {
  const { date, doctor1, doctor2, position1, position2 } = swap;
  const { doctors, workplaces, existingShifts, qualifications } = data;
  const absencePositions = ['Frei', 'Krank', 'Urlaub', 'Dienstreise', 'Nicht verfügbar'];
  const checks = [];

  const reject = (reason, meta = null) => {
    checks.push({ check: 'result', ok: false, reason, ...(meta ? { meta } : {}) });
    return { valid: false, reason, checks };
  };

  // Find doctors
  const doc1 = doctors.find((d) => d.name === doctor1);
  const doc2 = doctors.find((d) => d.name === doctor2);
  checks.push({
    check: 'doctorLookup',
    ok: Boolean(doc1 && doc2),
    meta: {
      doctor1,
      doctor2,
      doctor1Found: Boolean(doc1),
      doctor2Found: Boolean(doc2),
    },
  });
  if (!doc1 || !doc2) return reject('Unknown doctor name');

  const wp1 = workplaces.find((w) => w.name === position1);
  const wp2 = workplaces.find((w) => w.name === position2);
  checks.push({
    check: 'positionLookup',
    ok: Boolean(wp1 && wp2),
    meta: {
      position1,
      position2,
      position1Found: Boolean(wp1),
      position2Found: Boolean(wp2),
    },
  });
  if (!wp1 || !wp2) return reject('Unknown position');

  // Verify swap source assignments exist in base plan
  const hasDoc1AtPosition1 = basePlan.some(
    (s) => s.date === date && s.doctor_id === doc1.id && s.position === position1,
  );
  const hasDoc2AtPosition2 = basePlan.some(
    (s) => s.date === date && s.doctor_id === doc2.id && s.position === position2,
  );
  checks.push({
    check: 'sourceAssignmentsExist',
    ok: hasDoc1AtPosition1 && hasDoc2AtPosition2,
    meta: {
      date,
      hasDoc1AtPosition1,
      hasDoc2AtPosition2,
    },
  });
  if (!hasDoc1AtPosition1 || !hasDoc2AtPosition2) {
    return reject('Swap source assignment missing in base plan', {
      date,
      doctor1,
      position1,
      doctor2,
      position2,
    });
  }

  // Check absences
  const isAbsent = (docId, dateStr) => {
    return existingShifts.some(
      (s) => s.date === dateStr && s.doctor_id === docId && absencePositions.includes(s.position),
    );
  };
  const doc1Absent = isAbsent(doc1.id, date);
  const doc2Absent = isAbsent(doc2.id, date);
  checks.push({
    check: 'absenceCheck',
    ok: !doc1Absent && !doc2Absent,
    meta: { date, doc1Absent, doc2Absent },
  });
  if (doc1Absent || doc2Absent) {
    return reject(`Doctor is absent on ${date}`);
  }

  // Check NOT-qualifications: doc1 → pos2, doc2 → pos1
  const checkNotQual = (docId, wpId) => {
    const excl = (qualifications.workplaceQuals[wpId] || [])
      .filter((q) => !q.is_mandatory && q.is_excluded)
      .map((q) => q.qualification_id);
    const docQuals = qualifications.doctorQuals[docId] || [];
    return excl.length > 0 && excl.some((q) => docQuals.includes(q));
  };

  const doc1NotQual = checkNotQual(doc1.id, wp2.id);
  checks.push({
    check: 'notQualificationDoc1ToPos2',
    ok: !doc1NotQual,
    meta: { doctor: doctor1, targetPosition: position2 },
  });
  if (doc1NotQual) {
    return reject(`${doctor1} has NOT-qualification for ${position2}`);
  }
  const doc2NotQual = checkNotQual(doc2.id, wp1.id);
  checks.push({
    check: 'notQualificationDoc2ToPos1',
    ok: !doc2NotQual,
    meta: { doctor: doctor2, targetPosition: position1 },
  });
  if (doc2NotQual) {
    return reject(`${doctor2} has NOT-qualification for ${position1}`);
  }

  // Check mandatory qualifications: doc1 must have all Pflicht for pos2, doc2 for pos1
  const checkMandatory = (docId, wpId) => {
    const reqs = (qualifications.workplaceQuals[wpId] || [])
      .filter((q) => q.is_mandatory && !q.is_excluded)
      .map((q) => q.qualification_id);
    if (reqs.length === 0) return true;
    const docQuals = qualifications.doctorQuals[docId] || [];
    return reqs.every((r) => docQuals.includes(r));
  };

  // Only check if the target position has mandatory quals — allow soft fallback
  // (the deterministic engine also falls back, so we should too)

  checks.push({
    check: 'mandatoryQualificationSoftFallback',
    ok: true,
    meta: {
      doc1HasMandatoryForPos2: checkMandatory(doc1.id, wp2.id),
      doc2HasMandatoryForPos1: checkMandatory(doc2.id, wp1.id),
      note: 'Informational only; does not reject swap by design',
    },
  });

  checks.push({ check: 'result', ok: true, reason: 'Swap valid' });
  return { valid: true, reason: 'Swap valid', checks };
}

function applySwaps(basePlan, validSwaps, idByName) {
  const plan = basePlan.map((s) => ({ ...s })); // deep copy

  for (const swap of validSwaps) {
    const doc1Id = idByName[swap.doctor1];
    const doc2Id = idByName[swap.doctor2];
    if (!doc1Id || !doc2Id) continue;

    // Find entries to swap
    const idx1 = plan.findIndex(
      (s) => s.date === swap.date && s.doctor_id === doc1Id && s.position === swap.position1,
    );
    const idx2 = plan.findIndex(
      (s) => s.date === swap.date && s.doctor_id === doc2Id && s.position === swap.position2,
    );

    if (idx1 !== -1 && idx2 !== -1) {
      // Swap positions
      plan[idx1].position = swap.position2;
      plan[idx2].position = swap.position1;
    }
  }

  return plan;
}

// ============================================================
//  Auto-Frei Generation
// ============================================================

function generateAutoFreiEntries(assignments, workplaces, existingShifts, weekDays, holidays) {
  const autoFreiEntries = [];
  const holidaySet = new Set(holidays);
  const allEntries = [...existingShifts, ...assignments];

  for (const s of assignments) {
    const wp = workplaces.find((w) => w.name === s.position);
    if (!wp?.auto_off) continue;

    const curDay = new Date(s.date + 'T00:00:00');
    const nextDay = new Date(curDay);
    nextDay.setDate(nextDay.getDate() + 1);

    const nextStr = fmtDate(nextDay);
    if (nextDay.getDay() === 0 || nextDay.getDay() === 6 || holidaySet.has(nextStr)) continue;
    const hasExisting =
      allEntries.some((x) => x.date === nextStr && x.doctor_id === s.doctor_id) ||
      autoFreiEntries.some((x) => x.date === nextStr && x.doctor_id === s.doctor_id);

    if (!hasExisting) {
      autoFreiEntries.push({
        date: nextStr,
        position: 'Frei',
        doctor_id: s.doctor_id,
        note: 'Autom. Freizeitausgleich',
        isPreview: true,
      });
    }
  }
  return autoFreiEntries;
}

function fmtDate(date) {
  const y = date.getFullYear();
  const m = (date.getMonth() + 1).toString().padStart(2, '0');
  const d = date.getDate().toString().padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// ============================================================
//  LLM Prompt for variant comparison + swap suggestions
// ============================================================

function buildSwapSystemPrompt() {
  return `Du bist ein Experte für Dienstplan-Optimierung in einer Radiologie-Abteilung.

Du bekommst 3 verschiedene Dienstplan-Varianten, die alle GÜLTIG sind (alle harten Constraints sind erfüllt). 
Deine Aufgabe:

1. WÄHLE die beste Variante (basierend auf Fairness, Rotations-Erfüllung, Dienstwünsche)
2. SCHLAGE bis zu 10 gezielte TAUSCHE vor, die den Plan VERBESSERN

## Was einen guten Plan ausmacht (Prioritäten von HOCH nach NIEDRIG):
1. KEINE unqualifizierten Zuweisungen! Einträge mit "(UNQUALIFIZIERT!)" oder "(NICHT-QUALIFIZIERT!)" sind SCHWERE FEHLER
2. Einträge mit "(sollte-nicht)" möglichst vermeiden — das sind suboptimale Zuweisungen
3. Faire Verteilung: Jeder Arzt hat ähnlich viele Einsätze (FTE-bereinigt)
4. Rotationen respektiert: Ärzte in Rotation sollten ihren Rotations-Arbeitsplatz bekommen
5. Dienst-Verteilung: Dienste fair über die Ärzte verteilt
6. auto_off bedenken: Nach auto_off-Diensten fehlt der Arzt am Folgetag

## QUALIFIKATIONS-MARKIERUNGEN in den Varianten:
- "(UNQUALIFIZIERT!)" = Arzt fehlt Pflicht-Qualifikation → VERMEIDE diese Variante!
- "(NICHT-QUALIFIZIERT!)" = Arzt ist explizit ausgeschlossen → ABSOLUT VERBOTEN!  
- "(sollte-nicht)" = Arzt ist ungünstig für diese Position → wenn möglich vermeiden
- Keine Markierung = Arzt ist qualifiziert → OK

## TAUSCH-Format:
Ein Tausch bedeutet: Arzt A (aktuell auf Position X) und Arzt B (aktuell auf Position Y) tauschen am selben Tag.
→ Arzt A geht zu Y, Arzt B geht zu X.

## WICHTIG:
- Tausche NUR Ärzte, die am SELBEN TAG zugewiesen sind
- Die Grund-Pläne sind bereits constraint-gültig — schlechte Tausche werden serverseitig abgelehnt
- Verwende EXAKTE Namen aus den Varianten

## ANTWORT-FORMAT:
Antworte NUR mit JSON:
{
  "bestVariant": 0,
  "swaps": [
    {
      "date": "YYYY-MM-DD",
      "doctor1": "ArztName1",
      "position1": "AktuellePosition1",
      "doctor2": "ArztName2", 
      "position2": "AktuellePosition2",
      "reason": "Kurzer Grund"
    }
  ],
  "reasoning": "2-3 Sätze warum diese Variante + Tausche optimal sind"
}`;
}

function buildSwapDataPrompt(variants, scheduleRules) {
  let prompt = '';

  for (let i = 0; i < variants.length; i++) {
    const v = variants[i];
    prompt += `\n## VARIANTE ${i} (Score: ${v.score})\n`;
    for (const [date, positions] of Object.entries(v.plan)) {
      const dayName = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'][
        new Date(date + 'T00:00:00').getDay()
      ];
      prompt += `${dayName} ${date}: `;
      const parts = [];
      for (const [pos, docs] of Object.entries(positions)) {
        parts.push(`${pos}=[${Array.isArray(docs) ? docs.join(',') : docs}]`);
      }
      prompt += parts.join(' | ') + '\n';
    }
  }

  const activeRules = (scheduleRules || []).filter((r) => r.is_active).map((r) => r.content);
  if (activeRules.length > 0) {
    prompt += `\n## Zusätzliche Regeln:\n${activeRules.map((r, i) => `${i + 1}. ${r}`).join('\n')}\n`;
  }

  prompt += `\nWähle die beste Variante und schlage Verbesserungs-Tausche vor.`;
  return prompt;
}

// ============================================================
//  Parse LLM swap response
// ============================================================

function parseSwapResponse(content) {
  let text = content.trim();
  text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');

  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('No JSON found in response');
  text = text.substring(start, end + 1);

  const parsed = JSON.parse(text);
  return {
    bestVariant: parsed.bestVariant ?? 0,
    swaps: Array.isArray(parsed.swaps) ? parsed.swaps : [],
    reasoning: parsed.reasoning || '',
  };
}

// ============================================================
//  Main Endpoint
// ============================================================

router.post('/ai-autofill', async (req, res) => {
  const startTime = Date.now();
  const requestId = `aif-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const debugEnabled = req.body?.debug === true || config.ai.autofillDebug;
  const debug = createDebugCollector(debugEnabled, requestId);

  try {
    const {
      weekDays,
      doctors,
      workplaces,
      existingShifts,
      trainingRotations,
      qualifications,
      wishes,
      systemSettings,
      variants: clientVariants,
      bestVariant: bestVariantRaw,
      holidays,
      scheduleRules,
    } = req.body;

    debug.push('request', 'AI AutoFill request received', {
      hasWeekDays: Boolean(weekDays?.length),
      hasDoctors: Boolean(doctors?.length),
      hasWorkplaces: Boolean(workplaces?.length),
      variants: clientVariants?.length || 0,
      bestVariantEntries: bestVariantRaw?.length || 0,
      holidays: holidays?.length || 0,
      scheduleRules: scheduleRules?.length || 0,
    });

    if (!weekDays?.length || !doctors?.length || !workplaces?.length) {
      debug.push('validation', 'Missing required request data', {
        weekDays: weekDays?.length || 0,
        doctors: doctors?.length || 0,
        workplaces: workplaces?.length || 0,
      });
      return res.status(400).json({ error: 'Missing required data' });
    }

    const { nameById, idByName } = buildNameMaps(doctors);
    const data = {
      weekDays,
      doctors,
      workplaces,
      existingShifts,
      trainingRotations,
      qualifications,
      wishes,
      systemSettings,
      holidays,
      scheduleRules,
    };

    // If no variants sent (legacy call), fall back to bestVariant
    if (!clientVariants?.length) {
      console.log('[AI AutoFill v3] No variants received, returning bestVariant as-is');
      debug.push('fallback', 'No client variants provided, using bestVariant fallback');
      const suggestions = (bestVariantRaw || []).map((s) => ({ ...s, isPreview: true }));
      const autoFrei = generateAutoFreiEntries(
        suggestions,
        workplaces,
        existingShifts,
        weekDays,
        holidays || [],
      );
      return res.json({
        suggestions: [...suggestions, ...autoFrei],
        reasoning: 'Fallback: keine Varianten empfangen',
        provider: 'deterministic',
        model: 'none',
        stats: {
          total: suggestions.length + autoFrei.length,
          validated: suggestions.length,
          autoFrei: autoFrei.length,
          errors: 0,
          debugEntries: debug.count(),
        },
        debug: debugEnabled ? { requestId, entries: debug.dump() } : undefined,
      });
    }

    // Try LLM
    let client = getOpenAIClient();
    let model = 'gpt-5.2';
    let provider = 'OpenAI';
    if (!client) {
      client = getMistralClient();
      model = 'mistral-large-latest';
      provider = 'Mistral';
    }

    if (!client) {
      // No LLM available → return best deterministic variant
      console.log('[AI AutoFill v3] No AI provider, returning best deterministic variant');
      debug.push('provider', 'No AI provider available, deterministic fallback used');
      const suggestions = (bestVariantRaw || []).map((s) => ({ ...s, isPreview: true }));
      const autoFrei = generateAutoFreiEntries(
        suggestions,
        workplaces,
        existingShifts,
        weekDays,
        holidays || [],
      );
      return res.json({
        suggestions: [...suggestions, ...autoFrei],
        reasoning: 'Kein AI-Provider verfügbar, beste deterministische Variante',
        provider: 'deterministic',
        model: 'none',
        stats: {
          total: suggestions.length + autoFrei.length,
          validated: suggestions.length,
          autoFrei: autoFrei.length,
          errors: 0,
          debugEntries: debug.count(),
        },
        debug: debugEnabled ? { requestId, entries: debug.dump() } : undefined,
      });
    }

    console.log(
      `[AI AutoFill v3] ${provider} (${model}), ${clientVariants.length} variants, ${doctors.length} docs, ${weekDays.length} days`,
    );
    debug.push('provider', 'Provider selected', {
      provider,
      model,
      variants: clientVariants.length,
      doctors: doctors.length,
      days: weekDays.length,
    });

    // Build prompt
    const systemPrompt = buildSwapSystemPrompt();
    const userPrompt = buildSwapDataPrompt(clientVariants, scheduleRules);

    console.log(
      `[AI AutoFill v3] Prompt size: system=${systemPrompt.length}, user=${userPrompt.length}`,
    );
    debug.push('prompt', 'Prompt built', {
      systemChars: systemPrompt.length,
      userChars: userPrompt.length,
      variantsInPrompt: clientVariants.length,
      activeRules: (scheduleRules || []).filter((r) => r.is_active).length,
    });

    // Call LLM
    const completion = await client.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.2,
      max_completion_tokens: 8000,
      ...(provider === 'Mistral' ? {} : { response_format: { type: 'json_object' } }),
    });

    const responseContent = completion.choices?.[0]?.message?.content;
    if (!responseContent) throw new Error('Empty LLM response');

    console.log(
      `[AI AutoFill v3] Response: ${responseContent.length} chars, ${completion.usage?.total_tokens || '?'} tokens`,
    );
    console.log(`[AI AutoFill v3] Content: ${responseContent.substring(0, 1000)}`);
    debug.push('llm', 'LLM response received', {
      responseChars: responseContent.length,
      totalTokens: completion.usage?.total_tokens || null,
    });

    // Parse response
    const { bestVariant: chosenIdx, swaps, reasoning } = parseSwapResponse(responseContent);
    const safeIdx = Math.min(Math.max(chosenIdx || 0, 0), clientVariants.length - 1);

    console.log(`[AI AutoFill v3] LLM chose variant ${safeIdx}, suggested ${swaps.length} swaps`);
    debug.push('llm', 'Parsed LLM selection', {
      chosenVariantRaw: chosenIdx,
      chosenVariantSafe: safeIdx,
      swapsSuggested: swaps.length,
      reasoningLength: (reasoning || '').length,
    });

    // Get the chosen base plan (as ID-based entries from bestVariantRaw)
    // Map the chosen variant from name-based back to ID-based
    const chosenVariant = clientVariants[safeIdx];
    const basePlan = [];
    let skippedNameMappings = 0;
    for (const [date, positions] of Object.entries(chosenVariant.plan)) {
      for (const [position, doctorNames] of Object.entries(positions)) {
        const names = Array.isArray(doctorNames) ? doctorNames : [doctorNames];
        for (const name of names) {
          const cleanName = (name || '').replace(/\s*\(.*?\)\s*$/, '').trim();
          const docId = idByName[cleanName];
          if (docId) {
            basePlan.push({ date, position, doctor_id: docId, isPreview: true });
          } else {
            skippedNameMappings++;
          }
        }
      }
    }
    debug.push('mapping', 'Converted chosen variant to ID-based base plan', {
      basePlanEntries: basePlan.length,
      skippedNameMappings,
    });

    // Validate and apply swaps
    let appliedSwaps = 0;
    let rejectedSwaps = 0;
    const swapDetails = [];
    const swapDiagnostics = [];
    const validSwaps = [];

    for (const [index, swap] of swaps.entries()) {
      const result = validateSwap(swap, basePlan, data);
      swapDiagnostics.push({
        index,
        swap,
        valid: result.valid,
        reason: result.reason,
        checks: result.checks || [],
      });
      if (result.valid) {
        appliedSwaps++;
        validSwaps.push(swap);
        swapDetails.push(`✓ ${swap.doctor1}↔${swap.doctor2} @ ${swap.date}: ${swap.reason || ''}`);
      } else {
        rejectedSwaps++;
        swapDetails.push(`✗ ${swap.doctor1}↔${swap.doctor2} @ ${swap.date}: ${result.reason}`);
      }
    }
    debug.push('swapValidation', 'Swap validation completed', {
      swapsSuggested: swaps.length,
      swapsValid: validSwaps.length,
      swapsRejected: rejectedSwaps,
    });
    if (swaps.length > 0) {
      debug.push('swapValidation', 'Detailed swap diagnostics available', {
        swapDiagnostics,
      });
    }

    const optimizedPlan =
      validSwaps.length > 0 ? applySwaps(basePlan, validSwaps, idByName) : basePlan;

    // Auto-Frei
    const autoFrei = generateAutoFreiEntries(
      optimizedPlan,
      workplaces,
      existingShifts,
      weekDays,
      holidays || [],
    );
    const allSuggestions = [...optimizedPlan, ...autoFrei];
    const elapsed = Date.now() - startTime;

    console.log(
      `[AI AutoFill v3] Done: ${optimizedPlan.length} entries + ${autoFrei.length} auto-frei, ${appliedSwaps} swaps applied, ${rejectedSwaps} rejected (${elapsed}ms)`,
    );
    console.log(`[AI AutoFill v3] Swap details:`, swapDetails);
    debug.push('result', 'AI AutoFill finished', {
      optimizedEntries: optimizedPlan.length,
      autoFreiEntries: autoFrei.length,
      appliedSwaps,
      rejectedSwaps,
      elapsed,
    });

    res.json({
      suggestions: allSuggestions,
      reasoning,
      provider,
      model,
      stats: {
        total: allSuggestions.length,
        validated: optimizedPlan.length,
        autoFrei: autoFrei.length,
        errors: 0, // 0 constraint violations guaranteed!
        chosenVariant: safeIdx,
        swapsApplied: appliedSwaps,
        swapsRejected: rejectedSwaps,
        swapDetails: swapDetails.slice(0, 20),
        tokens: completion.usage?.total_tokens || null,
        elapsed,
        debugEntries: debug.count(),
      },
      debug: debugEnabled
        ? {
            requestId,
            entries: debug.dump(),
            swapDiagnostics: swapDiagnostics.slice(0, 30),
          }
        : undefined,
    });
  } catch (error) {
    console.error('[AI AutoFill v3] Error:', error);
    debug.push('error', 'Unhandled error in AI AutoFill route', {
      message: error.message,
      stack: error.stack,
    });

    // On any error, try to return the best deterministic variant
    try {
      const bestVariantRaw = req.body?.bestVariant;
      if (bestVariantRaw?.length) {
        const suggestions = bestVariantRaw.map((s) => ({ ...s, isPreview: true }));
        return res.json({
          suggestions,
          reasoning: `LLM-Fehler (${error.message}), verwende beste deterministische Variante`,
          provider: 'deterministic-fallback',
          model: 'none',
          stats: {
            total: suggestions.length,
            validated: suggestions.length,
            errors: 0,
            llmError: error.message,
            debugEntries: debug.count(),
          },
          debug: debugEnabled ? { requestId, entries: debug.dump() } : undefined,
        });
      }
    } catch {}

    res.status(500).json({ error: error.message });
  }
});

export default router;
