# Feature: KI-Sprachsteuerung (Voice Control)

---

## Funktionsumfang

- **Sprachgesteuerte Dienstplan-Bearbeitung**: Befehle per Mikrofon eingeben
- **Drei Modi**: Browser-Spracherkennung (Google), ElevenLabs STT, ElevenLabs ConversationalAI (Agent)
- **Natürlichsprachliche Befehle**: z.B. "Trage Dr. Müller am Montag in CT ein"
- **Navigation**: Per Sprache zwischen Seiten wechseln
- **Globale Verfügbarkeit**: Mikrofon-Button dauerhaft in der App (Layout)
- **Voice-Training-Dialog**: Eigene Phrasen für bessere Erkennung trainieren
- **Besetzungsvalidierung**: KI prüft Schichtlimits und Konflikte

---

## Implementierung

### Relevante Dateien

| Datei | Funktion |
|---|---|
| `src/components/GlobalVoiceControl.jsx` | **Hauptkomponente** (~689 Zeilen), gesamte Logik |
| `src/components/useElevenLabsConversation.jsx` | ElevenLabs ConvAI WebSocket Hook |
| `src/components/schedule/VoiceControl.jsx` | Ältere Dienstplan-spezifische Steuerung (veraltet) |
| `src/components/schedule/VoiceTrainingDialog.jsx` | Training-Dialog für Spracherkennung |
| `server/routes/voice.js` | Backend: Audio-Transkription |
| `functions/transcribeAudio.ts` | Cloud Function für Audio → Text |
| `functions/processVoiceCommand.ts` | Cloud Function für Befehls-Verarbeitung |

### Sprach-Modi

```javascript
// GlobalVoiceControl.jsx
const [mode, setMode] = useState('agent'); // Standard: ElevenLabs Agent

// 'browser'    → Web Speech API (Google), kostenlos, keine Extra-Deps
// 'transcribe' → ElevenLabs STT: Audio aufnehmen → POST /api/voice/transcribe
// 'agent'      → ElevenLabs ConversationalAI: bidirektionaler WebSocket-Agent
```

### ElevenLabs Agent-Integration

Der Agent-Modus nutzt `useElevenLabsConversation.jsx` – einen Custom Hook, der per WebSocket mit dem ElevenLabs ConversationalAI-API kommuniziert.

```javascript
const { startSession, endSession, sendText, isConnected } = useElevenLabsConversation({
  agentId: ELEVENLABS_AGENT_ID,
  onMessage: handleAgentResponse,
  onError: handleError
});
```

### Befehlsverarbeitungs-Flow

```
Benutzer spricht
      │
      ▼
Web Speech API / ElevenLabs STT
      │
      ▼ Transcript-Text
GlobalVoiceControl.handleSendText()
      │
      ▼
Befehls-Parsing (Regex + NLP-Muster)
      │
  ┌───┴────────────────────────────────┐
  │ Erkannte Absicht                   │
  ▼                                    ▼
Schedule-Befehl                  Navigation-Befehl
  │                                    │
  ▼                                    ▼
db.ShiftEntry.create()           navigate('/Schedule')
  │
  ▼
queryClient.invalidateQueries()
  │
  ▼
Agent antwortet mit Bestätigung
```

### Konfiguration

```javascript
// Agent-IDs (hardcodiert in GlobalVoiceControl.jsx)
const ELEVENLABS_AGENT_ID = "agent_1901kb1v556ke8trk5g98xjaxrp4";
const ELEVENLABS_AGENT_ID_SECONDARY = "agent_0601kb68g27kfbq90tqrq18xr80e";
```

Um eigene ElevenLabs-Agenten zu verwenden, diese IDs ersetzen und einen neuen Agenten im ElevenLabs Dashboard konfigurieren.

### Datenzugang für den Agenten

`GlobalVoiceControl` lädt alle relevanten Daten mit TanStack Query, damit der Agent auf aktuellen Daten operieren kann:

```javascript
const { data: doctors = [] } = useQuery({ queryKey: ['doctors'], ... });
const { data: workplaces = [] } = useQuery({ queryKey: ['workplaces'], ... });
const { data: shifts = [] } = useQuery({ queryKey: ['shifts', ...], ... });
```

---

## Erweiterungen entwickeln

### Neuen Sprach-Befehl hinzufügen

Im `handleAgentResponse`-Callback in `GlobalVoiceControl.jsx`:

```javascript
// Neuer Befehl: "Zeige Statistiken für [Monat]"
if (intent === 'show_statistics') {
  navigate('/Statistics');
  // Optional: Monat als Parameter übergeben
}
```

### Eigenen ElevenLabs-Agenten erstellen

1. In ElevenLabs Dashboard: "Conversational AI" → "New Agent"
2. System-Prompt konfigurieren (Kontext: Dienstplanungs-App, medizinisches Personal)
3. Tools/Functions definieren für Datenbankzugriff
4. Agent-ID in `GlobalVoiceControl.jsx` eintragen

---

## Test-Szenarien

### T-VOICE-01: Mikrofon-Aktivierung

```
Voraussetzung: Mikrofon-Berechtigung im Browser erlaubt
Aktion: Mikrofon-Button klicken
Erwartet:
  - Button wechselt Darstellung (aktiv/rot)
  - Status-Anzeige: "Zuhöre..."
  - Keine Fehler in Console
```

### T-VOICE-02: Spracheingabe verarbeiten (Browser-Modus)

```
Voraussetzung: Mode 'browser', Google Speech API verfügbar
Aktion: "Dr. Müller kommt am Montag in die CT" sprechen
Erwartet:
  - Transcript sichtbar in UI
  - shift_entry in DB erstellt (doctor=Müller, workplace=CT, date=Montag)
```

### T-VOICE-03: Fehlerbehandlung – kein Mikrofon

```
Voraussetzung: Mikrofon-Berechtigung verweigert
Aktion: Mikrofon-Button klicken
Erwartet:
  - Fehlermeldung: "Mikrofon nicht verfügbar"
  - Kein Crash der App
```

### T-VOICE-04: Readonly-Modus

```
Voraussetzung: Login als 'readonly' Benutzer
Erwartet:
  - Mikrofon-Button nicht vorhanden oder deaktiviert
  - Keine Möglichkeit, Daten per Sprache zu ändern
```

### T-VOICE-05: ElevenLabs Agent-Verbindung

```
Voraussetzung: Gültiger ELEVENLABS_AGENT_ID, Netzwerk verfügbar
Aktion: Agent-Modus aktivieren
Erwartet:
  - WebSocket-Verbindung wird aufgebaut
  - Status: "Verbunden"
  - Gesprochener Befehl → Agent antwortet audio + text
```
