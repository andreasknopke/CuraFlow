/**
 * AI AutoFill Route — LLM-based schedule optimization
 * 
 * Uses Mistral (primary) or OpenAI (fallback) to generate better schedule
 * assignments than the deterministic engine. The LLM can consider the ENTIRE
 * week holistically, balance workloads more fairly, and reason about trade-offs
 * between conflicting soft constraints.
 * 
 * Strategy:
 *   1. Client sends all scheduling data (same as deterministic engine)
 *   2. We also run the deterministic engine server-side as a baseline
 *   3. We build a structured prompt with rules, data, and baseline
 *   4. LLM produces an optimized assignment plan
 *   5. We validate the LLM output against hard constraints
 *   6. Return validated suggestions
 */

import express from 'express';
import OpenAI from 'openai';
import { authMiddleware } from './auth.js';

const router = express.Router();
router.use(authMiddleware);

// ============================================================
//  LLM Client Setup
// ============================================================

function getMistralClient() {
  const key = process.env.MISTRAL_API_KEY;
  if (!key) return null;
  return new OpenAI({
    apiKey: key,
    baseURL: 'https://api.mistral.ai/v1',
  });
}

function getOpenAIClient() {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;
  return new OpenAI({ apiKey: key });
}

// ============================================================
//  Prompt Building
// ============================================================

function buildSystemPrompt() {
  return `Du bist ein Experte für die Optimierung von Dienstplänen in einer Radiologie-Abteilung.
Deine Aufgabe ist es, Ärzte den Arbeitsplätzen für eine Woche zuzuweisen. Du musst dabei HARTE Constraints einhalten und WEICHE Constraints bestmöglich optimieren.

## HARTE Constraints (DÜRFEN NIEMALS verletzt werden):
1. Ein Arzt kann pro Tag nur EINEM verfügbarkeitsrelevanten Arbeitsplatz (affects_availability=true) zugewiesen werden
2. Abwesende Ärzte (Frei/Krank/Urlaub/Dienstreise/Nicht verfügbar) dürfen NICHT zugewiesen werden
3. "Nicht"-Qualifikationen (is_excluded): Arzt mit dieser Qualifikation darf NICHT an diesem Arbeitsplatz arbeiten
4. "Pflicht"-Qualifikationen (is_mandatory, nicht excluded): Mindestens ein Arzt an diesem Arbeitsplatz MUSS diese Qualifikation besitzen
5. Dienste (Kategorie "Dienste"): Wünsche mit status="approved" müssen respektiert werden
6. "kein Dienst" Wünsche mit status="approved": Arzt darf an dem Tag KEINEN Dienst bekommen
7. Jeder verfügbare Arzt MUSS einem Arbeitsplatz zugewiesen werden (keine Leerlauf-Tage)
8. An Tagen, an denen ein Arbeitsplatz nicht aktiv ist (active_days), darf niemand zugewiesen werden
9. auto_off Dienste: Der Arzt bekommt den nächsten Werktag "Frei" (Auto-Freizeitausgleich)
10. Dienst-Limits: Max Vordergrunddienste × FTE, max Hintergrunddienste × FTE pro 4 Wochen

## WEICHE Constraints (sollten OPTIMIERT werden — hier kannst du besser sein als der Algorithmus!):
1. **Faire Verteilung**: Alle Ärzte sollen ähnlich viele Dienste und Einsätze haben (FTE-bereinigt)
2. **"Sollte"-Qualifikationen**: Bevorzuge Ärzte mit dieser Qualifikation, aber erlaube Fallback wenn nötig
3. **"Sollte nicht"-Qualifikationen**: Vermeide Ärzte mit dieser Qualifikation, aber erlaube Fallback wenn nötig
4. **Rotationen**: Ärzte in Weiterbildungsrotation sollten bevorzugt deren Ziel-Arbeitsplatz zugewiesen werden
5. **Displacement-Fairness**: Wenn ein Arzt von seiner Rotation verdrängt wird, bevorzuge ihn beim nächsten Mal
6. **Dienst-Wünsche** (pending): Berücksichtige offene Wünsche als weiche Präferenz
7. **kein Dienst** (pending): Berücksichtige als weiche Vermeidung
8. **Cross-Day-Optimierung**: Betrachte die gesamte Woche, nicht nur einzelne Tage
9. **Alleinbesetzung vermeiden**: Ärzte, die allein an einem verfügbarkeitsrelevanten Arbeitsplatz sind, sollten möglichst nicht auch noch zu Demos zugewiesen werden
10. **Rotations-Impact**: Bei Diensten mit auto_off bedenke, dass der Arzt am Folgetag fehlt — wähle Ärzte, die dort weniger kritisch sind

## PRIORITÄTEN bei Konflikten:
1. Dienste zuerst (höchste Priorität) — sie erzeugen Auto-Frei am Folgetag
2. Dann verfügbarkeitsrelevante Arbeitsplätze (Rotationen etc.)
3. Dann nicht-verfügbarkeitsrelevante Arbeitsplätze (Demos, Konsile)

## OUTPUT FORMAT:
Antworte NUR mit einem JSON-Objekt. KEIN anderer Text.
Das Format ist:
{
  "assignments": [
    { "date": "YYYY-MM-DD", "position": "ArbeitsplatzName", "doctor_id": "uuid" },
    ...
  ],
  "reasoning": "Kurze Erklärung deiner Optimierungsstrategie (2-3 Sätze)"
}

WICHTIG: Gib NUR das JSON zurück, keinen Markdown, keine Code-Blöcke, NUR das reine JSON-Objekt.`;
}

function buildDataPrompt(data) {
  const {
    weekDays, doctors, workplaces, existingShifts, trainingRotations,
    qualifications, wishes, systemSettings, deterministicBaseline,
    holidays, scheduleRules,
  } = data;

  // Compact doctor representation
  const docsSummary = doctors.map(d => ({
    id: d.id,
    name: d.name,
    initials: d.initials,
    fte: d.fte ?? 1.0,
    quals: qualifications.doctorQuals[d.id] || [],
  }));

  // Compact workplace representation
  const wpsSummary = workplaces.map(w => ({
    id: w.id,
    name: w.name,
    category: w.category,
    affects_availability: w.affects_availability !== false,
    allows_multiple: w.allows_multiple,
    allows_rotation_concurrently: w.allows_rotation_concurrently,
    min_staff: w.min_staff ?? 1,
    optimal_staff: w.optimal_staff ?? 1,
    auto_off: w.auto_off || false,
    active_days: w.active_days?.length > 0 ? w.active_days : [1, 2, 3, 4, 5],
    qualRequirements: qualifications.workplaceQuals[w.id] || [],
  }));

  // Existing shifts (already fixed assignments)
  const existingSummary = existingShifts.map(s => ({
    date: s.date,
    position: s.position,
    doctor_id: s.doctor_id,
  }));

  // Active rotations
  const rotSummary = trainingRotations.map(r => ({
    doctor_id: r.doctor_id,
    modality: r.modality,
    start_date: r.start_date,
    end_date: r.end_date,
  }));

  // Wishes
  const wishesSummary = (wishes || []).map(w => ({
    doctor_id: w.doctor_id,
    date: w.date,
    type: w.type,
    status: w.status,
    position: w.position,
  }));

  // Qualification legend
  const qualLegend = qualifications.allQuals.map(q => ({
    id: q.id,
    name: q.name,
  }));

  // Schedule Rules (KI-Regeln from user)
  const activeRules = (scheduleRules || [])
    .filter(r => r.is_active)
    .map(r => r.content);

  let prompt = `## PLANUNGSDATEN

### Zeitraum
Tage: ${weekDays.join(', ')}
Feiertage: ${holidays.length > 0 ? holidays.join(', ') : 'keine'}

### Qualifikations-Legende
${JSON.stringify(qualLegend, null, 1)}

### Ärzte (${docsSummary.length})
${JSON.stringify(docsSummary, null, 1)}

### Arbeitsplätze (${wpsSummary.length})
${JSON.stringify(wpsSummary, null, 1)}

### Bestehende Einträge (bereits fixiert — NICHT ändern!)
${JSON.stringify(existingSummary, null, 1)}

### Weiterbildungsrotationen
${JSON.stringify(rotSummary, null, 1)}

### Dienstwünsche
${JSON.stringify(wishesSummary, null, 1)}
`;

  if (activeRules.length > 0) {
    prompt += `\n### Zusätzliche KI-Regeln (vom Nutzer definiert)
${activeRules.map((r, i) => `${i + 1}. ${r}`).join('\n')}
`;
  }

  // Add deterministic baseline for comparison
  if (deterministicBaseline?.length > 0) {
    // Group by date for readability
    const byDate = {};
    for (const s of deterministicBaseline) {
      if (!byDate[s.date]) byDate[s.date] = [];
      const doc = doctors.find(d => d.id === s.doctor_id);
      byDate[s.date].push(`${doc?.name || s.doctor_id} → ${s.position}`);
    }

    prompt += `\n### BASELINE (deterministischer Algorithmus — versuche BESSER zu sein!)
Der regelbasierte Algorithmus hat folgende Zuweisungen produziert.
Bekannte Schwächen des Algorithmus:
- Greedy per-Tag: optimiert nicht über die ganze Woche
- Randomisierte Reihenfolge kann suboptimale Ergebnisse erzeugen
- Kann Fairness über die Woche nicht global balancieren
- Betrachtet nicht die Auswirkungen heutiger Entscheidungen auf morgen

${Object.entries(byDate).map(([date, assignments]) =>
      `${date}:\n${assignments.map(a => `  • ${a}`).join('\n')}`
    ).join('\n\n')}
`;
  }

  prompt += `\n### AUFGABE
Erstelle eine BESSERE Zuweisung als die Baseline. Optimiere insbesondere:
1. Globale Fairness über die gesamte Woche
2. Respektiere Rotations-Ziele bestmöglich
3. Minimiere Alleinbesetzungen bei Demos
4. Optimale Nutzung von Qualifikationen
5. Beachte die Auswirkungen von auto_off auf den Folgetag

Gib NUR Zuweisungen für OFFENE Positionen zurück (nicht für bereits bestehende Einträge).
Jeder verfügbare Arzt muss pro Tag genau einem Arbeitsplatz zugewiesen werden.`;

  return prompt;
}

// ============================================================
//  Response Parsing & Validation
// ============================================================

function parseResponse(content) {
  // Try to extract JSON from the response
  let text = content.trim();
  
  // Remove markdown code blocks if present
  text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  
  // Find JSON object boundaries
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1) {
    throw new Error('No JSON object found in LLM response');
  }
  
  text = text.substring(start, end + 1);
  
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error(`Failed to parse LLM response as JSON: ${e.message}`);
  }
}

function validateAssignments(assignments, data) {
  const { weekDays, doctors, workplaces, existingShifts } = data;
  const absencePositions = ['Frei', 'Krank', 'Urlaub', 'Dienstreise', 'Nicht verfügbar'];
  const validDates = new Set(weekDays);
  const validDoctorIds = new Set(doctors.map(d => d.id));
  const validPositions = new Set(workplaces.map(w => w.name));
  
  // Build absence map for quick lookup
  const absentOn = {}; // date -> Set<doctorId>
  for (const s of existingShifts) {
    if (absencePositions.includes(s.position)) {
      if (!absentOn[s.date]) absentOn[s.date] = new Set();
      absentOn[s.date].add(s.doctor_id);
    }
  }
  
  const errors = [];
  const validated = [];
  const usedAvailability = {}; // date -> Set<doctorId> (for affects_availability workplaces)
  
  // First pass: validate and track availability
  for (const s of existingShifts) {
    if (absencePositions.includes(s.position) || s.position === 'Verfügbar') continue;
    const wp = workplaces.find(w => w.name === s.position);
    if (wp?.affects_availability !== false && !wp?.allows_rotation_concurrently) {
      if (!usedAvailability[s.date]) usedAvailability[s.date] = new Set();
      usedAvailability[s.date].add(s.doctor_id);
    }
  }
  
  for (const a of assignments) {
    // Validate date
    if (!validDates.has(a.date)) {
      errors.push(`Invalid date: ${a.date}`);
      continue;
    }
    
    // Validate doctor
    if (!validDoctorIds.has(a.doctor_id)) {
      errors.push(`Unknown doctor_id: ${a.doctor_id}`);
      continue;
    }
    
    // Validate position
    if (!validPositions.has(a.position)) {
      errors.push(`Unknown position: ${a.position}`);
      continue;
    }
    
    // Check absence
    if (absentOn[a.date]?.has(a.doctor_id)) {
      const doc = doctors.find(d => d.id === a.doctor_id);
      errors.push(`${doc?.name} is absent on ${a.date}`);
      continue;
    }
    
    // Check NOT-qualifications (hard block)
    const wp = workplaces.find(w => w.name === a.position);
    if (wp) {
      const excl = data.qualifications.workplaceQuals[wp.id]
        ?.filter(q => !q.is_mandatory && q.is_excluded)
        ?.map(q => q.qualification_id) || [];
      const docQuals = data.qualifications.doctorQuals[a.doctor_id] || [];
      if (excl.length > 0 && excl.some(q => docQuals.includes(q))) {
        const doc = doctors.find(d => d.id === a.doctor_id);
        errors.push(`${doc?.name} has NOT-qualification for ${a.position}`);
        continue;
      }
      
      // Check availability conflict for affects_availability workplaces
      if (wp.affects_availability !== false && !wp.allows_rotation_concurrently) {
        if (usedAvailability[a.date]?.has(a.doctor_id)) {
          // Already assigned to an availability-relevant workplace
          const doc = doctors.find(d => d.id === a.doctor_id);
          errors.push(`${doc?.name} already assigned to availability-relevant workplace on ${a.date}`);
          continue;
        }
      }
    }
    
    // Passed validation
    validated.push({
      date: a.date,
      position: a.position,
      doctor_id: a.doctor_id,
      isPreview: true,
    });
    
    // Track availability usage
    if (wp?.affects_availability !== false && !wp?.allows_rotation_concurrently) {
      if (!usedAvailability[a.date]) usedAvailability[a.date] = new Set();
      usedAvailability[a.date].add(a.doctor_id);
    }
  }
  
  return { validated, errors };
}

// ============================================================
//  Auto-Frei Generation (same logic as deterministic engine)
// ============================================================

function generateAutoFreiEntries(assignments, workplaces, existingShifts, weekDays, holidays) {
  const autoFreiEntries = [];
  const absencePositions = ['Frei', 'Krank', 'Urlaub', 'Dienstreise', 'Nicht verfügbar'];
  const holidaySet = new Set(holidays);
  
  const allEntries = [...existingShifts, ...assignments];
  
  for (const s of assignments) {
    const wp = workplaces.find(w => w.name === s.position);
    if (!wp?.auto_off) continue;
    
    // Find next workday
    const curDay = new Date(s.date + 'T00:00:00');
    const nextDay = new Date(curDay);
    nextDay.setDate(nextDay.getDate() + 1);
    
    for (let i = 0; i < 7; i++) {
      if (nextDay.getDay() !== 0 && nextDay.getDay() !== 6 && !holidaySet.has(formatDate(nextDay))) {
        break;
      }
      nextDay.setDate(nextDay.getDate() + 1);
    }
    
    const nextStr = formatDate(nextDay);
    
    // Check if already has entry
    const hasExisting = allEntries.some(x => x.date === nextStr && x.doctor_id === s.doctor_id) ||
                        autoFreiEntries.some(x => x.date === nextStr && x.doctor_id === s.doctor_id);
    
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

function formatDate(date) {
  const y = date.getFullYear();
  const m = (date.getMonth() + 1).toString().padStart(2, '0');
  const d = date.getDate().toString().padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// ============================================================
//  Main Endpoint
// ============================================================

router.post('/ai-autofill', async (req, res) => {
  const startTime = Date.now();
  
  try {
    const {
      weekDays, doctors, workplaces, existingShifts, trainingRotations,
      qualifications, wishes, systemSettings, deterministicBaseline,
      holidays, scheduleRules,
    } = req.body;

    if (!weekDays?.length || !doctors?.length || !workplaces?.length) {
      return res.status(400).json({ error: 'Missing required data: weekDays, doctors, workplaces' });
    }

    // Try OpenAI first (GPT-5.2), then Mistral as fallback
    let client = getOpenAIClient();
    let model = 'gpt-5.2';
    let provider = 'OpenAI';
    
    if (!client) {
      client = getMistralClient();
      model = 'mistral-large-latest';
      provider = 'Mistral';
    }
    
    if (!client) {
      return res.status(500).json({ 
        error: 'Kein AI-Provider konfiguriert. Bitte MISTRAL_API_KEY oder OPENAI_API_KEY als Umgebungsvariable setzen.' 
      });
    }

    console.log(`[AI AutoFill] Starting with ${provider} (${model}), ${doctors.length} doctors, ${workplaces.length} workplaces, ${weekDays.length} days`);

    const data = { weekDays, doctors, workplaces, existingShifts, trainingRotations, qualifications, wishes, systemSettings, deterministicBaseline, holidays, scheduleRules };

    const systemPrompt = buildSystemPrompt();
    const userPrompt = buildDataPrompt(data);

    console.log(`[AI AutoFill] Prompt size: system=${systemPrompt.length} chars, user=${userPrompt.length} chars`);

    // Call LLM
    const completion = await client.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.3, // Low temperature for consistent, logical results
      max_tokens: 16000,
      ...(provider === 'Mistral' ? {} : { response_format: { type: 'json_object' } }),
    });

    const responseContent = completion.choices?.[0]?.message?.content;
    if (!responseContent) {
      throw new Error('Empty response from LLM');
    }

    console.log(`[AI AutoFill] Response received: ${responseContent.length} chars, ${completion.usage?.total_tokens || '?'} tokens`);

    // Parse the response
    const parsed = parseResponse(responseContent);
    
    if (!parsed.assignments || !Array.isArray(parsed.assignments)) {
      throw new Error('LLM response missing "assignments" array');
    }

    console.log(`[AI AutoFill] Parsed ${parsed.assignments.length} assignments`);

    // Validate against hard constraints
    const { validated, errors } = validateAssignments(parsed.assignments, data);

    if (errors.length > 0) {
      console.warn(`[AI AutoFill] ${errors.length} validation errors:`, errors.slice(0, 10));
    }

    // Generate Auto-Frei entries
    const autoFrei = generateAutoFreiEntries(validated, workplaces, existingShifts, weekDays, holidays || []);

    const allSuggestions = [...validated, ...autoFrei];
    const elapsed = Date.now() - startTime;

    console.log(`[AI AutoFill] Done: ${validated.length} valid + ${autoFrei.length} auto-frei = ${allSuggestions.length} total (${elapsed}ms, ${errors.length} errors)`);

    res.json({
      suggestions: allSuggestions,
      reasoning: parsed.reasoning || '',
      provider,
      model,
      stats: {
        total: allSuggestions.length,
        validated: validated.length,
        autoFrei: autoFrei.length,
        errors: errors.length,
        errorDetails: errors.slice(0, 20),
        tokens: completion.usage?.total_tokens || null,
        elapsed,
      },
    });

  } catch (error) {
    console.error('[AI AutoFill] Error:', error);
    res.status(500).json({ 
      error: error.message,
      hint: 'Check API keys and network connectivity',
    });
  }
});

export default router;
