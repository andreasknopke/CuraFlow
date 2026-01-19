# ElevenLabs Integration Guide for Base44 Apps

This document describes how the ElevenLabs voice integration works in this app, including:
- Real-time Conversational AI Agent (WebSocket)
- Speech-to-Text transcription
- Client-side tool callbacks

Target audience: An LLM implementing ElevenLabs in another Base44 application.

---

## Table of Contents
1. [Overview](#overview)
2. [Prerequisites](#prerequisites)
3. [Architecture](#architecture)
4. [Core Hook: useElevenLabsConversation](#core-hook-useElevenLabsConversation)
5. [Backend Functions](#backend-functions)
6. [UI Component Implementation](#ui-component-implementation)
7. [Client Tools (Callbacks)](#client-tools-callbacks)
8. [Dynamic Variables](#dynamic-variables)
9. [Complete Implementation Checklist](#complete-implementation-checklist)

---

## Overview

This integration supports three voice modes:

| Mode | Description | Uses |
|------|-------------|------|
| `agent` | Real-time bidirectional voice conversation with ElevenLabs ConvAI | WebSocket to `wss://api.elevenlabs.io/v1/convai/conversation` |
| `transcribe` | High-quality speech-to-text using ElevenLabs Scribe API | Backend function `transcribeAudio` |
| `browser` | Browser's native Web Speech API (Google) | `window.SpeechRecognition` |

---

## Prerequisites

### 1. Secret: `ELEVENLABS_API_KEY`
Set this in the Base44 dashboard under Settings → Environment Variables.

### 2. ElevenLabs Agent ID
Create a Conversational AI agent at https://elevenlabs.io/conversational-ai and copy the Agent ID.

### 3. Backend Functions Enabled
The `transcribeAudio` and `processVoiceAudio` functions must be deployed.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        FRONTEND                             │
├─────────────────────────────────────────────────────────────┤
│  GlobalVoiceControl.jsx                                     │
│  ├─ useElevenLabsConversation hook                          │
│  ├─ Microphone capture (MediaRecorder / ScriptProcessor)    │
│  ├─ Audio playback (AudioContext queue)                     │
│  └─ Client tool execution                                   │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                     ELEVENLABS API                          │
├─────────────────────────────────────────────────────────────┤
│  wss://api.elevenlabs.io/v1/convai/conversation?agent_id=X  │
│  POST https://api.elevenlabs.io/v1/speech-to-text           │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    BACKEND FUNCTIONS                        │
├─────────────────────────────────────────────────────────────┤
│  transcribeAudio.js   - ElevenLabs Scribe STT               │
│  processVoiceAudio.js - LLM command parsing                 │
└─────────────────────────────────────────────────────────────┘
```

---

## Core Hook: useElevenLabsConversation

**File:** `components/useElevenLabsConversation.js`

### Usage

```javascript
import { useElevenLabsConversation } from '@/components/useElevenLabsConversation';

const { status, isSpeaking, startConversation, stopConversation } = useElevenLabsConversation({
    agentId: "agent_xxxxxxxxx",
    clientTools: {
        my_tool: async (params) => {
            // Execute tool logic
            return JSON.stringify({ success: true });
        }
    },
    onConnect: () => console.log("Connected"),
    onDisconnect: () => console.log("Disconnected"),
    onError: (err) => console.error("Error", err),
    onMessage: (msg) => console.log("Message", msg)
});

// Start with dynamic variables
startConversation({
    dynamicVariables: {
        User_Name: "Dr. Smith",
        User_Role: "Admin"
    }
});

// Stop
stopConversation();
```

### Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `agentId` | string | ElevenLabs Conversational AI Agent ID |
| `clientTools` | object | Map of tool_name → async function |
| `onConnect` | function | Called when WebSocket opens |
| `onDisconnect` | function | Called when WebSocket closes |
| `onError` | function | Called on error |
| `onMessage` | function | Called for every WebSocket message |

### Returns

| Property | Type | Description |
|----------|------|-------------|
| `status` | string | `'disconnected'`, `'connecting'`, `'connected'` |
| `isSpeaking` | boolean | `true` when audio is being played |
| `startConversation` | function | Start the voice session |
| `stopConversation` | function | End the voice session |

### Internal Flow

1. **Connect:** Opens WebSocket to ElevenLabs ConvAI endpoint
2. **Send Init:** Sends `conversation_initiation_client_data` with dynamic variables
3. **Capture Audio:** Uses `ScriptProcessor` to capture microphone at 16kHz PCM
4. **Send Audio:** Continuously sends base64-encoded PCM chunks via `user_audio_chunk`
5. **Receive Audio:** Decodes incoming `audio` messages and queues for playback
6. **Handle Interruptions:** Clears audio queue on `interruption` message
7. **Handle Tool Calls:** Executes `client_tool_call` and sends `client_tool_result`
8. **Ping/Pong:** Responds to `ping` with `pong` to keep connection alive

---

## Backend Functions

### 1. transcribeAudio.js

**Purpose:** Converts audio blob to text using ElevenLabs Scribe API.

**Endpoint:** POST to ElevenLabs `/v1/speech-to-text`

**Input:**
```json
{
    "audioBase64": "data:audio/webm;base64,..."
}
```

**Output:**
```json
{
    "text": "Setze Müller auf CT"
}
```

**Key Code:**
```javascript
const formData = new FormData();
formData.append('file', blob, 'recording.webm');
formData.append('model_id', 'scribe_v1');
formData.append('language_code', 'de');

const response = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
    method: 'POST',
    headers: { 'xi-api-key': apiKey },
    body: formData
});
```

### 2. processVoiceAudio.js

**Purpose:** Parses transcribed text into structured commands using Base44's LLM.

**Input:**
```json
{
    "text": "Setze Müller auf CT morgen",
    "context": {
        "doctors": [{"id": "123", "name": "Müller"}],
        "workplaces": [{"name": "CT"}],
        "currentDate": "2025-01-15",
        "weekContext": "Montag: 2025-01-13\nDienstag: 2025-01-14..."
    }
}
```

**Output:**
```json
{
    "action": "assign",
    "assignments": [{
        "doctor_id": "123",
        "position": "CT",
        "date": "2025-01-16"
    }]
}
```

**Supported Actions:**
- `assign` - Assign doctor to position
- `move` - Move assignment
- `delete` - Remove assignment(s)
- `navigate` - Change view/date
- `unknown` - Could not parse

---

## UI Component Implementation

**File:** `components/GlobalVoiceControl.jsx`

### Key Features

1. **Mode Switching:** Context menu to switch between `agent`, `transcribe`, `browser`
2. **Visual Feedback:** Animated button states, transcript display
3. **Client Tools:** Provides context-aware tools to the agent
4. **Command Execution:** Processes parsed commands and updates database

### Minimal Implementation

```jsx
import { useElevenLabsConversation } from '@/components/useElevenLabsConversation';
import { Button } from '@/components/ui/button';
import { Bot } from 'lucide-react';

const AGENT_ID = "agent_xxxxxxxxx";

export default function VoiceButton() {
    const { status, startConversation, stopConversation } = useElevenLabsConversation({
        agentId: AGENT_ID,
        onConnect: () => console.log("Connected"),
        onError: (err) => alert("Error: " + err.message)
    });

    const isConnected = status === 'connected';

    return (
        <Button
            variant={isConnected ? "destructive" : "outline"}
            onClick={() => isConnected ? stopConversation() : startConversation()}
        >
            <Bot className="w-5 h-5" />
        </Button>
    );
}
```

---

## Client Tools (Callbacks)

Client tools allow the ElevenLabs agent to call functions in your app.

### Defining Tools

```javascript
const clientTools = useMemo(() => ({
    get_current_context: async (parameters) => {
        // Return current app state
        return JSON.stringify({
            page: "Dashboard",
            user: "logged_in"
        });
    },
    
    create_appointment: async (parameters) => {
        const { date, time, patient } = parameters;
        await db.Appointment.create({ date, time, patient });
        return JSON.stringify({ success: true });
    }
}), [/* dependencies */]);
```

### Tool Call Flow

1. Agent sends `client_tool_call` message:
```json
{
    "type": "client_tool_call",
    "client_tool_call": {
        "tool_call_id": "abc123",
        "tool_name": "get_current_context",
        "parameters": {}
    }
}
```

2. Hook executes the tool and sends response:
```json
{
    "type": "client_tool_result",
    "tool_call_id": "abc123",
    "result": "{\"page\": \"Dashboard\"}",
    "is_error": false
}
```

### Important Notes

- Results MUST be strings (use `JSON.stringify()`)
- Tools are defined in the ElevenLabs agent dashboard under "Client Tools"
- Use `useMemo` to prevent re-renders breaking the tool references

---

## Dynamic Variables

Pass dynamic data to the agent at conversation start.

### Defining in ElevenLabs Dashboard

In your agent's prompt, use placeholders like:
```
Hello {{User_Name}}! You are a {{User_Role}}.
```

### Passing from Frontend

```javascript
startConversation({
    dynamicVariables: {
        User_Name: "Dr. Smith",
        User_Role: "Administrator"
    }
});
```

### Common Use Cases

- Personalized greetings
- User role-based behavior
- Context about current page/data

---

## Complete Implementation Checklist

### 1. Set Secret
- [ ] Add `ELEVENLABS_API_KEY` in Base44 dashboard

### 2. Create ElevenLabs Agent
- [ ] Create agent at elevenlabs.io/conversational-ai
- [ ] Configure voice, language, prompt
- [ ] Define client tools (if needed)
- [ ] Copy Agent ID

### 3. Create Backend Functions

**functions/transcribeAudio.js:**
```javascript
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

Deno.serve(async (req) => {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { audioBase64 } = await req.json();
    const apiKey = Deno.env.get("ELEVENLABS_API_KEY");
    
    const base64Data = audioBase64.includes('base64,') 
        ? audioBase64.split('base64,')[1] 
        : audioBase64;
    
    const bytes = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0));
    const blob = new Blob([bytes], { type: 'audio/webm' });

    const formData = new FormData();
    formData.append('file', blob, 'recording.webm');
    formData.append('model_id', 'scribe_v1');
    formData.append('language_code', 'de'); // Change as needed

    const response = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
        method: 'POST',
        headers: { 'xi-api-key': apiKey },
        body: formData
    });

    const result = await response.json();
    return Response.json({ text: result.text });
});
```

### 4. Copy Hook
- [ ] Copy `components/useElevenLabsConversation.js` to your project

### 5. Create UI Component
- [ ] Create voice control component
- [ ] Implement mode switching (optional)
- [ ] Add visual feedback

### 6. Define Client Tools
- [ ] Identify what the agent should be able to do
- [ ] Implement tool functions
- [ ] Register tools in ElevenLabs dashboard

### 7. Handle Agent Messages
- [ ] Process transcripts
- [ ] Execute commands
- [ ] Update UI state

---

## Troubleshooting

### "Agent ID is missing"
Ensure `agentId` prop is passed to the hook.

### No audio playback
Check AudioContext state - call `audioContext.resume()` after user interaction.

### Microphone not working
Ensure HTTPS (required for getUserMedia). Check browser permissions.

### Tool not being called
Verify tool name matches exactly between frontend and ElevenLabs dashboard.

### Audio quality issues
The hook downsamples to 16kHz. For better quality, adjust sample rate in `getUserMedia`.

---

## API Reference Links

- [ElevenLabs Conversational AI Docs](https://elevenlabs.io/docs/conversational-ai/overview)
- [ElevenLabs WebSocket API](https://elevenlabs.io/docs/conversational-ai/websocket-api)
- [ElevenLabs Speech-to-Text](https://elevenlabs.io/docs/api-reference/speech-to-text)