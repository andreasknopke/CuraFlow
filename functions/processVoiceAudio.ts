import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        let body;
        try {
            body = await req.json();
        } catch (e) {
            return Response.json({ error: 'Invalid JSON' }, { status: 400 });
        }
        
        const { text, context } = body;
        
        if (!text) {
            return Response.json({ error: 'No text' }, { status: 400 });
        }

        console.log("Processing Voice Command with Base44 LLM:", text);

        const currentDate = context?.currentDate || new Date().toISOString().split('T')[0];
        const doctors = context?.doctors || [];
        const workplaces = context?.workplaces || [];
        const weekContext = context?.weekContext || "";

        // Fetch user-specific voice aliases
        const aliases = await base44.entities.VoiceAlias.filter({ created_by: user.email }, null, 1000);
        const aliasMap = aliases.map(a => `"${a.detected_text}" -> "${doctors.find(d => d.id === a.doctor_id)?.name || a.doctor_id}" (ID: ${a.doctor_id})`).join('\n');

        const prompt = `
        You are an intelligent assistant for a radiology scheduling app.
        Your task is to interpret voice commands and convert them into structured JSON actions.
        
        If you cannot interpret the command or if it is incomplete, return "action": "unknown" and provide a "reason" explaining why (in German).

        Current Date Reference: ${currentDate} (YYYY-MM-DD)

        CURRENT WEEK CONTEXT (Use this to resolve days like "Montag", "Dienstag" etc.):
        ${weekContext}
        
        Available Doctors (ID: Name):
        ${doctors.map(d => `${d.id}: ${d.name}`).join('\n')}
        
        Available Workplaces:
        ${workplaces.map(w => w.name).join('\n')}
        
        IMPORTANT:
        - When assigning a doctor, use the EXACT ID provided in the list above as "doctor_id".
        - If you cannot find an exact ID, but the name matches partially, try to find the ID corresponding to that name.
        - Only return the Name as "doctor_id" if you absolutely cannot find the ID.

        USER SPECIFIC ALIASES (High Priority):
        If the text matches one of these aliases, map it to the corresponding Doctor ID immediately:
        ${aliasMap}
        
        ACTIONS:
        1. "assign" (Setze/Packe/Einteilen): Assign a doctor to a workplace on a date.
           - "Setze Müller auf CT" -> { "action": "assign", "assignments": [{ "doctor_id": "...", "position": "CT", "date": "..." }] }
        
        2. "move" (Verschiebe): Move an assignment.
           - "Verschiebe Müller auf MRT" -> { "action": "move", "move": { "doctor_id": "...", "target_position": "MRT", "source_date": "...", "target_date": "..." } }
           - If only position changes, source_date == target_date.
           - If date changes ("Verschiebe auf morgen"), target_position might be null (keep same) or specified.
        
        3. "delete" (Lösche/Entferne): Remove assignments.
           - "Lösche Müller" -> { "action": "delete", "delete": { "doctor_id": "...", "scope": "day", "date": "..." } }
           - "Lösche Müller aus der ganzen Woche" -> scope: "week"
        
        4. "navigate" (Zeige/Gehe zu): Change view.
           - "Nächste Woche" -> { "action": "navigate", "navigation": { "date": "...", "viewMode": "week" } }
           - "Heute" -> { "action": "navigate", "navigation": { "date": "${new Date().toISOString().split('T')[0]}" } }

        RULES:
        - Map doctor names fuzzy (e.g. "Müller" -> matches ID of Müller).
        - Map workplace names fuzzy.
        - USE THE WEEK CONTEXT to resolve day names (Montag, Dienstag...) to exact YYYY-MM-DD dates.
        - "Morgen" = +1 day relative to Current Date. 
        - "Montag" = The date labeled "Montag" in the WEEK CONTEXT (unless "nächsten Montag" is specified).
        - If text is unclear, return { "action": "unknown", "reason": "Ich habe nicht verstanden, wen ich wohin setzen soll." }.
        
        USER COMMAND: "${text}"
        `;

        const result = await base44.integrations.Core.InvokeLLM({
            prompt: prompt,
            response_json_schema: {
                type: "object",
                properties: {
                    action: { type: "string", enum: ["assign", "move", "delete", "navigate", "unknown"] },
                    reason: { type: "string" },
                    assignments: {
                        type: "array",
                        items: {
                            type: "object",
                            properties: {
                                doctor_id: { type: "string" },
                                position: { type: "string" },
                                date: { type: "string" }
                            },
                            required: ["doctor_id", "position", "date"]
                        }
                    },
                    move: {
                        type: "object",
                        properties: {
                            doctor_id: { type: "string" },
                            target_position: { type: "string" },
                            source_date: { type: "string" },
                            target_date: { type: "string" }
                        },
                        required: ["doctor_id"]
                    },
                    delete: {
                        type: "object",
                        properties: {
                            doctor_id: { type: "string" },
                            scope: { type: "string", enum: ["day", "week"] },
                            date: { type: "string" }
                        },
                        required: ["doctor_id", "scope"]
                    },
                    navigation: {
                        type: "object",
                        properties: {
                            date: { type: "string" },
                            viewMode: { type: "string" }
                        }
                    }
                },
                required: ["action"]
            }
        });

        console.log("Base44 LLM Result:", result);

        // Log successful interpretation
        try {
            await base44.asServiceRole.entities.SystemLog.create({
                level: 'info',
                source: 'VoiceControl',
                message: `Voice command processed: ${result.action}`,
                details: JSON.stringify({ text, result })
            });
        } catch (e) { console.error("Log failed", e); }

        return Response.json(result);

    } catch (error) {
        console.error("Error in processVoiceAudio:", error);
        
        try {
            await base44.asServiceRole.entities.SystemLog.create({
                level: 'error',
                source: 'VoiceControl',
                message: 'Voice processing failed',
                details: JSON.stringify({ error: error.message })
            });
        } catch (e) { console.error("Log failed", e); }

        return Response.json({ error: error.message }, { status: 500 });
    }
});