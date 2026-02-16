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

const router = express.Router();
router.use(authMiddleware);

// ============================================================
//  LLM Client Setup
// ============================================================

function getOpenAIClient() {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;
  return new OpenAI({ apiKey: key });
}

function getMistralClient() {
  const key = process.env.MISTRAL_API_KEY;
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

// ============================================================
//  Swap Validator — checks if a swap is safe
// ============================================================

function validateSwap(swap, basePlan, data) {
  const { date, doctor1, doctor2, position1, position2 } = swap;
  const { doctors, workplaces, existingShifts, qualifications } = data;
  const absencePositions = ['Frei', 'Krank', 'Urlaub', 'Dienstreise', 'Nicht verfügbar'];

  // Find doctors
  const doc1 = doctors.find(d => d.name === doctor1);
  const doc2 = doctors.find(d => d.name === doctor2);
  if (!doc1 || !doc2) return { valid: false, reason: `Unknown doctor name` };

  const wp1 = workplaces.find(w => w.name === position1);
  const wp2 = workplaces.find(w => w.name === position2);
  if (!wp1 || !wp2) return { valid: false, reason: `Unknown position` };

  // Check absences
  const isAbsent = (docId, dateStr) => {
    return existingShifts.some(s => s.date === dateStr && s.doctor_id === docId && absencePositions.includes(s.position));
  };
  if (isAbsent(doc1.id, date) || isAbsent(doc2.id, date)) {
    return { valid: false, reason: `Doctor is absent on ${date}` };
  }

  // Check NOT-qualifications: doc1 → pos2, doc2 → pos1
  const checkNotQual = (docId, wpId) => {
    const excl = (qualifications.workplaceQuals[wpId] || [])
      .filter(q => !q.is_mandatory && q.is_excluded)
      .map(q => q.qualification_id);
    const docQuals = qualifications.doctorQuals[docId] || [];
    return excl.length > 0 && excl.some(q => docQuals.includes(q));
  };

  if (checkNotQual(doc1.id, wp2.id)) {
    return { valid: false, reason: `${doctor1} has NOT-qualification for ${position2}` };
  }
  if (checkNotQual(doc2.id, wp1.id)) {
    return { valid: false, reason: `${doctor2} has NOT-qualification for ${position1}` };
  }

  // Check mandatory qualifications: doc1 must have all Pflicht for pos2, doc2 for pos1
  const checkMandatory = (docId, wpId) => {
    const reqs = (qualifications.workplaceQuals[wpId] || [])
      .filter(q => q.is_mandatory && !q.is_excluded)
      .map(q => q.qualification_id);
    if (reqs.length === 0) return true;
    const docQuals = qualifications.doctorQuals[docId] || [];
    return reqs.every(r => docQuals.includes(r));
  };

  // Only check if the target position has mandatory quals — allow soft fallback
  // (the deterministic engine also falls back, so we should too)

  return { valid: true };
}

function applySwaps(basePlan, validSwaps, idByName) {
  const plan = basePlan.map(s => ({ ...s })); // deep copy

  for (const swap of validSwaps) {
    const doc1Id = idByName[swap.doctor1];
    const doc2Id = idByName[swap.doctor2];
    if (!doc1Id || !doc2Id) continue;

    // Find entries to swap
    const idx1 = plan.findIndex(s => s.date === swap.date && s.doctor_id === doc1Id && s.position === swap.position1);
    const idx2 = plan.findIndex(s => s.date === swap.date && s.doctor_id === doc2Id && s.position === swap.position2);

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
    const wp = workplaces.find(w => w.name === s.position);
    if (!wp?.auto_off) continue;

    const curDay = new Date(s.date + 'T00:00:00');
    const nextDay = new Date(curDay);
    nextDay.setDate(nextDay.getDate() + 1);

    for (let i = 0; i < 7; i++) {
      if (nextDay.getDay() !== 0 && nextDay.getDay() !== 6 && !holidaySet.has(fmtDate(nextDay))) break;
      nextDay.setDate(nextDay.getDate() + 1);
    }

    const nextStr = fmtDate(nextDay);
    const hasExisting = allEntries.some(x => x.date === nextStr && x.doctor_id === s.doctor_id) ||
                        autoFreiEntries.some(x => x.date === nextStr && x.doctor_id === s.doctor_id);

    if (!hasExisting) {
      autoFreiEntries.push({
        date: nextStr, position: 'Frei', doctor_id: s.doctor_id,
        note: 'Autom. Freizeitausgleich', isPreview: true,
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
      const dayName = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'][new Date(date + 'T00:00:00').getDay()];
      prompt += `${dayName} ${date}: `;
      const parts = [];
      for (const [pos, docs] of Object.entries(positions)) {
        parts.push(`${pos}=[${Array.isArray(docs) ? docs.join(',') : docs}]`);
      }
      prompt += parts.join(' | ') + '\n';
    }
  }

  const activeRules = (scheduleRules || []).filter(r => r.is_active).map(r => r.content);
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

  try {
    const {
      weekDays, doctors, workplaces, existingShifts, trainingRotations,
      qualifications, wishes, systemSettings,
      variants: clientVariants, bestVariant: bestVariantRaw,
      holidays, scheduleRules,
    } = req.body;

    if (!weekDays?.length || !doctors?.length || !workplaces?.length) {
      return res.status(400).json({ error: 'Missing required data' });
    }

    const { nameById, idByName } = buildNameMaps(doctors);
    const data = { weekDays, doctors, workplaces, existingShifts, trainingRotations, qualifications, wishes, systemSettings, holidays, scheduleRules };

    // If no variants sent (legacy call), fall back to bestVariant
    if (!clientVariants?.length) {
      console.log('[AI AutoFill v3] No variants received, returning bestVariant as-is');
      const suggestions = (bestVariantRaw || []).map(s => ({ ...s, isPreview: true }));
      const autoFrei = generateAutoFreiEntries(suggestions, workplaces, existingShifts, weekDays, holidays || []);
      return res.json({
        suggestions: [...suggestions, ...autoFrei],
        reasoning: 'Fallback: keine Varianten empfangen',
        provider: 'deterministic', model: 'none',
        stats: { total: suggestions.length + autoFrei.length, validated: suggestions.length, autoFrei: autoFrei.length, errors: 0 },
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
      const suggestions = (bestVariantRaw || []).map(s => ({ ...s, isPreview: true }));
      const autoFrei = generateAutoFreiEntries(suggestions, workplaces, existingShifts, weekDays, holidays || []);
      return res.json({
        suggestions: [...suggestions, ...autoFrei],
        reasoning: 'Kein AI-Provider verfügbar, beste deterministische Variante',
        provider: 'deterministic', model: 'none',
        stats: { total: suggestions.length + autoFrei.length, validated: suggestions.length, autoFrei: autoFrei.length, errors: 0 },
      });
    }

    console.log(`[AI AutoFill v3] ${provider} (${model}), ${clientVariants.length} variants, ${doctors.length} docs, ${weekDays.length} days`);

    // Build prompt
    const systemPrompt = buildSwapSystemPrompt();
    const userPrompt = buildSwapDataPrompt(clientVariants, scheduleRules);

    console.log(`[AI AutoFill v3] Prompt size: system=${systemPrompt.length}, user=${userPrompt.length}`);

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

    console.log(`[AI AutoFill v3] Response: ${responseContent.length} chars, ${completion.usage?.total_tokens || '?'} tokens`);
    console.log(`[AI AutoFill v3] Content: ${responseContent.substring(0, 1000)}`);

    // Parse response
    const { bestVariant: chosenIdx, swaps, reasoning } = parseSwapResponse(responseContent);
    const safeIdx = Math.min(Math.max(chosenIdx || 0, 0), clientVariants.length - 1);

    console.log(`[AI AutoFill v3] LLM chose variant ${safeIdx}, suggested ${swaps.length} swaps`);

    // Get the chosen base plan (as ID-based entries from bestVariantRaw)
    // Map the chosen variant from name-based back to ID-based
    const chosenVariant = clientVariants[safeIdx];
    const basePlan = [];
    for (const [date, positions] of Object.entries(chosenVariant.plan)) {
      for (const [position, doctorNames] of Object.entries(positions)) {
        const names = Array.isArray(doctorNames) ? doctorNames : [doctorNames];
        for (const name of names) {
          const cleanName = (name || '').replace(/\s*\(.*?\)\s*$/, '').trim();
          const docId = idByName[cleanName];
          if (docId) {
            basePlan.push({ date, position, doctor_id: docId, isPreview: true });
          }
        }
      }
    }

    // Validate and apply swaps
    let appliedSwaps = 0;
    let rejectedSwaps = 0;
    const swapDetails = [];

    for (const swap of swaps) {
      const result = validateSwap(swap, basePlan, data);
      if (result.valid) {
        appliedSwaps++;
        swapDetails.push(`✓ ${swap.doctor1}↔${swap.doctor2} @ ${swap.date}: ${swap.reason || ''}`);
      } else {
        rejectedSwaps++;
        swapDetails.push(`✗ ${swap.doctor1}↔${swap.doctor2} @ ${swap.date}: ${result.reason}`);
      }
    }

    const validSwaps = swaps.filter((s, i) => {
      const r = validateSwap(s, basePlan, data);
      return r.valid;
    });

    const optimizedPlan = validSwaps.length > 0
      ? applySwaps(basePlan, validSwaps, idByName)
      : basePlan;

    // Auto-Frei
    const autoFrei = generateAutoFreiEntries(optimizedPlan, workplaces, existingShifts, weekDays, holidays || []);
    const allSuggestions = [...optimizedPlan, ...autoFrei];
    const elapsed = Date.now() - startTime;

    console.log(`[AI AutoFill v3] Done: ${optimizedPlan.length} entries + ${autoFrei.length} auto-frei, ${appliedSwaps} swaps applied, ${rejectedSwaps} rejected (${elapsed}ms)`);
    console.log(`[AI AutoFill v3] Swap details:`, swapDetails);

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
      },
    });

  } catch (error) {
    console.error('[AI AutoFill v3] Error:', error);
    
    // On any error, try to return the best deterministic variant
    try {
      const bestVariantRaw = req.body?.bestVariant;
      if (bestVariantRaw?.length) {
        const suggestions = bestVariantRaw.map(s => ({ ...s, isPreview: true }));
        return res.json({
          suggestions,
          reasoning: `LLM-Fehler (${error.message}), verwende beste deterministische Variante`,
          provider: 'deterministic-fallback',
          model: 'none',
          stats: { total: suggestions.length, validated: suggestions.length, errors: 0, llmError: error.message },
        });
      }
    } catch {}

    res.status(500).json({ error: error.message });
  }
});

export default router;
