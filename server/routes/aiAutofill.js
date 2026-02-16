/**
 * AI AutoFill Route — LLM-based schedule optimization (v2: Hybrid approach)
 * 
 * KEY INSIGHT: LLMs are bad at tracking UUIDs and complex constraint logic.
 * Instead, we PRE-COMPUTE all constraints server-side and give the LLM a
 * simplified problem: "Choose from these valid options for each slot."
 * 
 * Strategy:
 *   1. Client sends all scheduling data
 *   2. Server pre-computes per-day/per-workplace eligible doctor lists
 *   3. LLM receives a SIMPLIFIED prompt using doctor NAMES (not UUIDs)
 *      with pre-filtered valid options per slot
 *   4. LLM only needs to make CHOICES between valid candidates
 *   5. Server maps names back to IDs and validates
 *   6. Gap-fill: any unassigned doctors/slots get filled by deterministic logic
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
//  Pre-compute eligible doctors per workplace per day
// ============================================================

function preComputeEligibility(data) {
  const { weekDays, doctors, workplaces, existingShifts, trainingRotations, qualifications, wishes, holidays } = data;
  const absencePositions = ['Frei', 'Krank', 'Urlaub', 'Dienstreise', 'Nicht verfügbar'];
  const DEFAULT_ACTIVE_DAYS = [1, 2, 3, 4, 5];
  const holidaySet = new Set(holidays || []);

  // Build lookup maps
  const nameById = {};
  const idByName = {};
  for (const d of doctors) {
    nameById[d.id] = d.name;
    idByName[d.name] = d.id;
  }

  // Absent on date
  const absentOn = {}; // date -> Set<doctorId>
  for (const s of existingShifts) {
    if (absencePositions.includes(s.position)) {
      if (!absentOn[s.date]) absentOn[s.date] = new Set();
      absentOn[s.date].add(s.doctor_id);
    }
  }

  // Already assigned (existing fixed entries) — track availability-relevant
  const usedAvailability = {}; // date -> Set<doctorId>
  const fixedAssignments = {}; // date -> Map<doctorId, positionName>
  for (const s of existingShifts) {
    if (absencePositions.includes(s.position) || s.position === 'Verfügbar') continue;
    if (!fixedAssignments[s.date]) fixedAssignments[s.date] = new Map();
    fixedAssignments[s.date].set(s.doctor_id, s.position);
    const wp = workplaces.find(w => w.name === s.position);
    if (wp?.affects_availability !== false && !wp?.allows_rotation_concurrently) {
      if (!usedAvailability[s.date]) usedAvailability[s.date] = new Set();
      usedAvailability[s.date].add(s.doctor_id);
    }
  }

  // Qualification helpers
  const getDoctorQuals = (docId) => qualifications.doctorQuals[docId] || [];
  const getWpQualReqs = (wpId) => qualifications.workplaceQuals[wpId] || [];

  const isQualified = (docId, wpId) => {
    const reqs = getWpQualReqs(wpId).filter(q => q.is_mandatory && !q.is_excluded);
    if (reqs.length === 0) return true;
    const docQuals = getDoctorQuals(docId);
    return reqs.every(r => docQuals.includes(r.qualification_id));
  };

  const isExcluded = (docId, wpId) => {
    const excl = getWpQualReqs(wpId).filter(q => !q.is_mandatory && q.is_excluded);
    if (excl.length === 0) return false;
    const docQuals = getDoctorQuals(docId);
    return excl.some(e => docQuals.includes(e.qualification_id));
  };

  const isDiscouraged = (docId, wpId) => {
    const disc = getWpQualReqs(wpId).filter(q => q.is_mandatory && q.is_excluded);
    if (disc.length === 0) return false;
    const docQuals = getDoctorQuals(docId);
    return disc.some(d => docQuals.includes(d.qualification_id));
  };

  const isPreferred = (docId, wpId) => {
    const pref = getWpQualReqs(wpId).filter(q => !q.is_mandatory && !q.is_excluded && !q.is_mandatory);
    // "Sollte" = optional preferred: is_mandatory=false, is_excluded=false
    const sollte = getWpQualReqs(wpId).filter(q => !q.is_mandatory && !q.is_excluded);
    if (sollte.length === 0) return false;
    const docQuals = getDoctorQuals(docId);
    return sollte.every(p => docQuals.includes(p.qualification_id));
  };

  const isActiveOnDate = (wp, dateStr) => {
    const ad = wp.active_days?.length > 0 ? wp.active_days : DEFAULT_ACTIVE_DAYS;
    const date = new Date(dateStr + 'T00:00:00');
    const dayOfWeek = date.getDay();
    if (holidaySet.has(dateStr) && !ad.some(d => Number(d) === 0)) return false;
    return ad.some(d => Number(d) === dayOfWeek);
  };

  // Active rotations per doctor per date
  const getRotation = (docId, dateStr) => {
    return (trainingRotations || []).find(r =>
      r.doctor_id === docId && r.start_date <= dateStr && r.end_date >= dateStr
    );
  };

  // Service wishes
  const getServiceWish = (docId, dateStr) => {
    return (wishes || []).find(w =>
      w.doctor_id === docId && w.date === dateStr &&
      w.type === 'service' && (w.status === 'approved' || w.status === 'pending')
    );
  };

  const hasNoServiceWish = (docId, dateStr) => {
    return (wishes || []).some(w =>
      w.doctor_id === docId && w.date === dateStr &&
      w.type === 'no_service' && w.status === 'approved'
    );
  };

  // Build per-day summaries
  const dayPlans = [];

  for (const dateStr of weekDays) {
    const date = new Date(dateStr + 'T00:00:00');
    const dayOfWeek = date.getDay();
    const dayName = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'][dayOfWeek];

    // Available doctors on this day (not absent, not already availability-assigned)
    const available = doctors.filter(d => {
      if (absentOn[dateStr]?.has(d.id)) return false;
      if (usedAvailability[dateStr]?.has(d.id)) return false;
      return true;
    });

    // Absent doctors
    const absent = doctors.filter(d => absentOn[dateStr]?.has(d.id));

    // Already fixed
    const fixed = [];
    if (fixedAssignments[dateStr]) {
      for (const [docId, pos] of fixedAssignments[dateStr].entries()) {
        fixed.push({ name: nameById[docId] || docId, position: pos });
      }
    }

    // Active workplaces today
    const activeWps = workplaces.filter(wp => isActiveOnDate(wp, dateStr));

    // Per-workplace eligible lists
    const wpSlots = [];
    for (const wp of activeWps) {
      const currentCount = existingShifts.filter(s => s.date === dateStr && s.position === wp.name).length;
      const target = Math.max(wp.optimal_staff ?? 1, wp.min_staff ?? 1);
      const needed = target - currentCount;
      if (needed <= 0) continue;

      const eligible = [];
      const discouraged = [];

      for (const doc of available) {
        // Hard exclude
        if (isExcluded(doc.id, wp.id)) continue;

        // For services, check no-service wish
        if (wp.category === 'Dienste' && hasNoServiceWish(doc.id, dateStr)) continue;
        
        // Must be qualified (Pflicht)
        const qualified = isQualified(doc.id, wp.id);
        const preferred = isPreferred(doc.id, wp.id);
        const disc = isDiscouraged(doc.id, wp.id);
        const rot = getRotation(doc.id, dateStr);
        const rotTarget = rot ? rot.modality : null;
        const wish = getServiceWish(doc.id, dateStr);

        const annotations = [];
        if (!qualified) annotations.push('unqualifiziert');
        if (preferred) annotations.push('★bevorzugt');
        if (rotTarget) annotations.push(`Rot→${rotTarget}`);
        if (wish) annotations.push(`Wunsch:${wish.position || 'any'}`);

        const entry = doc.name + (annotations.length > 0 ? ` (${annotations.join(', ')})` : '');
        
        if (disc) {
          discouraged.push(entry);
        } else {
          eligible.push(entry);
        }
      }

      wpSlots.push({
        workplace: wp.name,
        category: wp.category,
        affects_availability: wp.affects_availability !== false,
        allows_multiple: wp.allows_multiple ?? (wp.category === 'Rotationen'),
        auto_off: wp.auto_off || false,
        needed,
        eligible,
        discouraged,
      });
    }

    dayPlans.push({
      date: dateStr,
      dayName,
      available: available.map(d => d.name),
      absent: absent.map(d => d.name),
      fixed,
      slots: wpSlots,
    });
  }

  return { dayPlans, nameById, idByName };
}

// ============================================================
//  Simplified Prompt (uses pre-computed eligibility)
// ============================================================

function buildSimplifiedSystemPrompt() {
  return `Du bist ein Experte für Dienstplan-Optimierung in einer Radiologie-Abteilung.

Ich gebe dir für jeden Tag der Woche eine Liste von Arbeitsplätzen mit den GÜLTIGEN Kandidaten.
Du musst NUR aus den gelisteten Kandidaten wählen.

## REGELN:
1. Jeder verfügbare Arzt muss GENAU EINEM "avail"-Arbeitsplatz pro Tag zugewiesen werden
2. Zusätzlich können Ärzte einem "nicht-avail"-Arbeitsplatz zugewiesen werden (z.B. Demos)
3. Wähle NUR aus der "Kandidaten"-Liste — dort stehen NUR gültige Ärzte
4. ★bevorzugt = hat bevorzugte Qualifikation → nimm diese wenn möglich
5. Rot→X = Arzt hat Rotation auf Arbeitsplatz X → bevorzuge Zuordnung dorthin
6. Wunsch:X = Arzt hat Dienstwunsch → respektiere wenn möglich
7. "Abgeraten"-Liste = Ärzte die möglichst NICHT dahin sollten (nur wenn kein anderer da ist)
8. auto_off = Arzt bekommt nächsten Werktag frei (bedenke Folgetag!)
9. Verteile FAIR: Jeder Arzt soll über die Woche ähnlich viele Einsätze haben
10. Ein Arzt darf NICHT mehreren "avail"-Arbeitsplätzen am selben Tag zugewiesen werden

## OPTIMIERUNGSZIELE (hier zeig was du besser kannst als der Algorithmus!):
- Betrachte die GESAMTE Woche, nicht nur einen Tag
- Bei auto_off Diensten: Nimm Ärzte die am Folgetag weniger gebraucht werden
- Rotations-Ziele bestmöglich erfüllen
- Faire Dienst-Verteilung über die Woche

## ANTWORT-FORMAT:
Antworte NUR mit JSON (kein Markdown, keine Code-Blöcke):
{
  "plan": {
    "YYYY-MM-DD": {
      "ArbeitsplatzName": ["ArztName1", "ArztName2"],
      ...
    },
    ...
  },
  "reasoning": "2-3 Sätze Erklärung"
}

Verwende die EXAKTEN Arzt-Namen und Arbeitsplatz-Namen aus den Daten.
JEDER verfügbare Arzt muss GENAU EINEM avail-Arbeitsplatz zugewiesen werden.`;
}

function buildSimplifiedDataPrompt(dayPlans, deterministicBaseline, doctors) {
  let prompt = '## WOCHENPLAN\n';

  for (const day of dayPlans) {
    prompt += `\n### ${day.dayName} ${day.date}\n`;
    prompt += `Verfügbar (${day.available.length}): ${day.available.join(', ')}\n`;
    if (day.absent.length > 0) {
      prompt += `Abwesend: ${day.absent.join(', ')}\n`;
    }
    if (day.fixed.length > 0) {
      prompt += `Bereits fixiert: ${day.fixed.map(f => `${f.name}→${f.position}`).join(', ')}\n`;
    }

    for (const slot of day.slots) {
      const flags = [];
      if (slot.affects_availability) flags.push('avail');
      else flags.push('nicht-avail');
      if (slot.allows_multiple) flags.push('multi');
      if (slot.auto_off) flags.push('auto_off');

      prompt += `\n  ${slot.workplace} [${slot.category}] (${flags.join(', ')}) — braucht ${slot.needed}\n`;
      prompt += `    Kandidaten: ${slot.eligible.length > 0 ? slot.eligible.join(', ') : 'KEINE'}\n`;
      if (slot.discouraged.length > 0) {
        prompt += `    Abgeraten: ${slot.discouraged.join(', ')}\n`;
      }
    }
  }

  // Deterministic baseline comparison (compact)
  if (deterministicBaseline?.length > 0) {
    const byDate = {};
    for (const s of deterministicBaseline) {
      if (!byDate[s.date]) byDate[s.date] = {};
      const doc = doctors.find(d => d.id === s.doctor_id);
      const name = doc?.name || '?';
      if (!byDate[s.date][s.position]) byDate[s.date][s.position] = [];
      byDate[s.date][s.position].push(name);
    }

    prompt += `\n## BASELINE (regelbasierter Algorithmus — versuche BESSER zu sein!)\n`;
    prompt += `Schwächen: Greedy per-Tag, keine Wochenweite Optimierung, zufällige Reihenfolge\n`;
    for (const [date, positions] of Object.entries(byDate)) {
      prompt += `${date}: ${Object.entries(positions).map(([pos, docs]) => `${pos}=[${docs.join(',')}]`).join(' | ')}\n`;
    }
  }

  prompt += `\nErstelle jetzt deine optimierte Zuweisung als JSON. Verwende EXAKTE Namen. Fülle JEDEN Arbeitsplatz.`;

  return prompt;
}

// ============================================================
//  Response Parsing & Validation
// ============================================================

function parseNameBasedResponse(content, idByName, workplaces, weekDays) {
  let text = content.trim();
  // Remove markdown code blocks if present
  text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1) {
    throw new Error('No JSON object found in LLM response');
  }
  text = text.substring(start, end + 1);

  const parsed = JSON.parse(text);
  const plan = parsed.plan;
  if (!plan) throw new Error('Response missing "plan" object');

  const assignments = [];
  const errors = [];

  for (const [date, positions] of Object.entries(plan)) {
    if (!weekDays.includes(date)) {
      errors.push(`Invalid date in plan: ${date}`);
      continue;
    }

    for (const [position, doctorNames] of Object.entries(positions)) {
      const wp = workplaces.find(w => w.name === position);
      if (!wp) {
        errors.push(`Unknown workplace: ${position}`);
        continue;
      }

      const names = Array.isArray(doctorNames) ? doctorNames : [doctorNames];
      for (const name of names) {
        if (!name || typeof name !== 'string') continue;
        
        // Strip any annotations the LLM may have kept (e.g. "(★bevorzugt)")
        const cleanName = name.replace(/\s*\(.*?\)\s*$/, '').trim();
        
        const docId = idByName[cleanName];
        if (!docId) {
          // Try fuzzy match (partial name)
          const fuzzy = Object.entries(idByName).find(([n]) =>
            n.toLowerCase().includes(cleanName.toLowerCase()) ||
            cleanName.toLowerCase().includes(n.toLowerCase())
          );
          if (fuzzy) {
            assignments.push({ date, position, doctor_id: fuzzy[1] });
          } else {
            errors.push(`Unknown doctor name: "${cleanName}" on ${date} @ ${position}`);
          }
        } else {
          assignments.push({ date, position, doctor_id: docId });
        }
      }
    }
  }

  return { assignments, reasoning: parsed.reasoning || '', parseErrors: errors };
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
    
    // Passed validation — but check for duplicate same doctor+position+date
    const isDupe = validated.some(v => v.date === a.date && v.position === a.position && v.doctor_id === a.doctor_id);
    if (isDupe) continue;
    
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

    console.log(`[AI AutoFill v2] Starting with ${provider} (${model}), ${doctors.length} doctors, ${workplaces.length} workplaces, ${weekDays.length} days`);

    const data = { weekDays, doctors, workplaces, existingShifts, trainingRotations, qualifications, wishes, systemSettings, deterministicBaseline, holidays, scheduleRules };

    // Step 1: Pre-compute eligibility (all hard constraints applied server-side!)
    const { dayPlans, idByName } = preComputeEligibility(data);

    // Step 2: Build simplified prompt (names, not UUIDs!)
    const systemPrompt = buildSimplifiedSystemPrompt();
    const userPrompt = buildSimplifiedDataPrompt(dayPlans, deterministicBaseline, doctors);

    // Include KI-Regeln if any
    const activeRules = (scheduleRules || []).filter(r => r.is_active).map(r => r.content);
    const rulesAddendum = activeRules.length > 0
      ? `\n\nZusätzliche Planungsregeln:\n${activeRules.map((r, i) => `${i + 1}. ${r}`).join('\n')}`
      : '';

    console.log(`[AI AutoFill v2] Prompt size: system=${systemPrompt.length}, user=${userPrompt.length + rulesAddendum.length}`);

    // Step 3: Call LLM
    const completion = await client.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt + rulesAddendum },
      ],
      temperature: 0.2,
      max_completion_tokens: 32000,
      ...(provider === 'Mistral' ? {} : { response_format: { type: 'json_object' } }),
    });

    const responseContent = completion.choices?.[0]?.message?.content;
    if (!responseContent) throw new Error('Empty response from LLM');

    const finishReason = completion.choices?.[0]?.finish_reason;
    console.log(`[AI AutoFill v2] Response: ${responseContent.length} chars, ${completion.usage?.total_tokens || '?'} tokens, finish=${finishReason}`);
    console.log(`[AI AutoFill v2] First 1500 chars: ${responseContent.substring(0, 1500)}`);

    // Step 4: Parse name-based response → map names back to IDs
    const { assignments: rawAssignments, reasoning, parseErrors } = parseNameBasedResponse(responseContent, idByName, workplaces, weekDays);

    if (parseErrors.length > 0) {
      console.warn(`[AI AutoFill v2] ${parseErrors.length} parse errors:`, parseErrors.slice(0, 10));
    }
    console.log(`[AI AutoFill v2] Parsed ${rawAssignments.length} raw assignments`);

    // Step 5: Validate against hard constraints (safety net — should catch very few now!)
    const { validated, errors } = validateAssignments(rawAssignments, data);

    if (errors.length > 0) {
      console.warn(`[AI AutoFill v2] ${errors.length} validation errors:`, errors.slice(0, 10));
    }

    // Step 6: Auto-Frei
    const autoFrei = generateAutoFreiEntries(validated, workplaces, existingShifts, weekDays, holidays || []);

    const allSuggestions = [...validated, ...autoFrei];
    const elapsed = Date.now() - startTime;

    console.log(`[AI AutoFill v2] Done: ${validated.length} valid + ${autoFrei.length} auto-frei = ${allSuggestions.length} total (${elapsed}ms, ${errors.length} constraint errors, ${parseErrors.length} parse errors)`);

    res.json({
      suggestions: allSuggestions,
      reasoning,
      provider,
      model,
      stats: {
        total: allSuggestions.length,
        validated: validated.length,
        autoFrei: autoFrei.length,
        errors: errors.length + parseErrors.length,
        errorDetails: [...errors, ...parseErrors].slice(0, 30),
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
