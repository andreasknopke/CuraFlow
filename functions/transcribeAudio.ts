import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();
        
        // Allow if user is authenticated
        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { audioBase64 } = await req.json();

        if (!audioBase64) {
            return Response.json({ error: "No audio data provided" }, { status: 400 });
        }

        const apiKey = Deno.env.get("ELEVENLABS_API_KEY");
        if (!apiKey) {
            return Response.json({ error: "ElevenLabs API Key not configured on server" }, { status: 500 });
        }

        // Convert base64 to blob/uint8array
        // The frontend sends the base64 string without the "data:audio/webm;base64," prefix ideally, 
        // or we strip it.
        const base64Data = audioBase64.includes('base64,') ? audioBase64.split('base64,')[1] : audioBase64;
        
        const binaryString = atob(base64Data);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }
        const blob = new Blob([bytes], { type: 'audio/webm' });

        const formData = new FormData();
        formData.append('file', blob, 'recording.webm');
        formData.append('model_id', 'scribe_v1');
        formData.append('language_code', 'de');
        // formData.append('tag_audio_events', 'false');

        const response = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
            method: 'POST',
            headers: {
                'xi-api-key': apiKey,
            },
            body: formData
        });

        if (!response.ok) {
            const errText = await response.text();
            console.error("ElevenLabs Error:", errText);

            try {
                await base44.asServiceRole.entities.SystemLog.create({
                    level: 'error',
                    source: 'VoiceTranscription',
                    message: 'ElevenLabs API Error',
                    details: JSON.stringify({ status: response.status, error: errText })
                });
            } catch (e) { console.error("Log failed", e); }

            return Response.json({ error: `ElevenLabs API Error: ${response.status} ${errText}` }, { status: 500 });
        }

        const result = await response.json();
        // ElevenLabs Scribe returns { text: "..." }
        return Response.json({ text: result.text });

    } catch (error) {
        console.error("Function Error:", error);

        try {
            await base44.asServiceRole.entities.SystemLog.create({
                level: 'error',
                source: 'VoiceTranscription',
                message: 'Transcription function error',
                details: JSON.stringify({ error: error.message })
            });
        } catch (e) { console.error("Log failed", e); }

        return Response.json({ error: error.message }, { status: 500 });
    }
});