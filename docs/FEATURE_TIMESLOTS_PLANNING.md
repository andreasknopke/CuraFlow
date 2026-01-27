# Feature-Planung: Zeitfenster-Besetzung (Timeslots) für Arbeitsplätze

**Status:** Geplant  
**Erstellungsdatum:** 2026-01-27  
**Zielversion:** TBD  
**Priorität:** Mittel

---

## 1. Zusammenfassung

Dieses Feature ermöglicht die zeitliche Teilbesetzung von Arbeitsplätzen im Scheduler. Abteilungen können Arbeitsplätze (z.B. OP-Säle) mit wechselnden Teams über den Tag besetzen, ohne die Grundstruktur der Plantabelle zu verändern.

### Anwendungsfall
- OP-Säle mit Früh-/Spätteam
- Rotationsstellen mit Halbtags-Besetzung
- Dienste mit Schichtwechsel (Früh/Spät/Nacht)

### Kernprinzip
- **Opt-in pro Arbeitsplatz**: Abteilungen ohne Bedarf sehen keine Änderung
- **Strikte Rückwärtskompatibilität**: Produktivdatenbank bleibt unverändert, Testversion kann parallel laufen

---

## 2. Rückwärtskompatibilitäts-Garantien

| Aspekt | Garantie | Technische Umsetzung |
|--------|----------|----------------------|
| Bestehende ShiftEntries | Bleiben unverändert | `timeslot_id = NULL` bedeutet ganztägig |
| Bestehende Workplaces | Verhalten sich wie bisher | `timeslots_enabled = FALSE` (Default) |
| Alte Frontend-Version | Ignoriert neue Felder | DB-Proxy filtert unbekannte Spalten automatisch |
| Alte Backend-Version | Keine Fehler | Neue Tabelle wird nicht angesprochen |
| Parallelbetrieb | Prod + Test auf gleicher DB | Nur `ADD COLUMN IF NOT EXISTS`, keine `ALTER` |

---

## 3. Datenbank-Schema

### 3.1 Neue Tabelle: `WorkplaceTimeslot`

```sql
-- Migration: server/migrations/001_create_workplace_timeslot_table.sql

CREATE TABLE IF NOT EXISTS WorkplaceTimeslot (
    id VARCHAR(255) PRIMARY KEY,
    workplace_id VARCHAR(255) NOT NULL,
    label VARCHAR(100) NOT NULL,               -- z.B. "Frühdienst", "Spät"
    start_time TIME NOT NULL,                  -- z.B. "07:00:00"
    end_time TIME NOT NULL,                    -- z.B. "13:00:00"
    `order` INT DEFAULT 0,                     -- Sortierung in der UI
    overlap_tolerance_minutes INT DEFAULT 0,   -- Übergangszeit in Minuten
    spans_midnight BOOLEAN DEFAULT FALSE,      -- Automatisch berechnet bei end < start
    created_date DATETIME(3),
    updated_date DATETIME(3),
    created_by VARCHAR(255),
    
    INDEX idx_workplace (workplace_id),
    CONSTRAINT fk_timeslot_workplace 
        FOREIGN KEY (workplace_id) REFERENCES Workplace(id) ON DELETE CASCADE
);
```

### 3.2 Erweiterung: `Workplace`

```sql
-- Migration: server/migrations/002_add_workplace_timeslot_fields.sql

ALTER TABLE Workplace 
ADD COLUMN IF NOT EXISTS timeslots_enabled BOOLEAN DEFAULT FALSE;

ALTER TABLE Workplace 
ADD COLUMN IF NOT EXISTS default_overlap_tolerance_minutes INT DEFAULT 15;
```

### 3.3 Erweiterung: `ShiftEntry`

```sql
-- Migration: server/migrations/003_add_shiftentry_timeslot_field.sql

ALTER TABLE ShiftEntry 
ADD COLUMN IF NOT EXISTS timeslot_id VARCHAR(255) DEFAULT NULL;

-- Index für Performance bei Timeslot-Abfragen
CREATE INDEX IF NOT EXISTS idx_shiftentry_timeslot ON ShiftEntry(timeslot_id);
```

### 3.4 Entity-Registrierung

**Datei:** `src/api/entities.js`

```javascript
// Neue Entity hinzufügen
WorkplaceTimeslot: createEntity("WorkplaceTimeslot"),
```

**Datei:** `server/routes/dbProxy.js`

```javascript
// In boolFields-Array erweitern (Zeile ~47)
const boolFields = [
    // ... bestehende Felder
    'timeslots_enabled',
    'spans_midnight'
];

// In jsonFields-Array (falls Timeslots als JSON gespeichert würden - nicht nötig bei separater Tabelle)
```

---

## 4. Architektur

### 4.1 Datenfluss

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         WorkplaceTimeslot                                │
│   id │ workplace_id │ label  │ start  │ end    │ order │ overlap_tol   │
│  ────┼──────────────┼────────┼────────┼────────┼───────┼─────────────  │
│  ts1 │ wp-op1       │ Früh   │ 07:00  │ 13:00  │ 1     │ 15            │
│  ts2 │ wp-op1       │ Spät   │ 13:00  │ 20:00  │ 2     │ 15            │
│  ts3 │ wp-op1       │ Nacht  │ 20:00  │ 07:00  │ 3     │ 15            │
└─────────────────────────────────────────────────────────────────────────┘
         ▲                                          │
         │ 1:n (Workplace hat mehrere Timeslots)    │
         │                                          ▼
┌─────────────────────┐                 ┌──────────────────────────────────┐
│  Workplace          │                 │  ShiftEntry                       │
│  ─────────────────  │                 │  ──────────────────────────────  │
│  id: wp-op1         │                 │  id: se1                         │
│  name: "OP Saal 1"  │                 │  date: 2026-01-27                │
│  timeslots_enabled: │                 │  position: "OP Saal 1"           │
│    TRUE             │                 │  doctor_id: doc-mueller          │
│                     │                 │  timeslot_id: ts1  ──────────────┤
└─────────────────────┘                 │  (oder NULL = ganztägig)         │
                                        └──────────────────────────────────┘
```

### 4.2 UI-Darstellung im Grid

**Ohne Timeslots (Standard):**
```
┌─────────────────┬──────────┬──────────┬──────────┐
│ Position        │ Mo 27.01 │ Di 28.01 │ Mi 29.01 │
├─────────────────┼──────────┼──────────┼──────────┤
│ OP Saal 1       │ Müller   │ Schmidt  │ Weber    │
└─────────────────┴──────────┴──────────┴──────────┘
```

**Mit Timeslots aktiviert:**
```
┌─────────────────┬──────────┬──────────┬──────────┐
│ Position        │ Mo 27.01 │ Di 28.01 │ Mi 29.01 │
├─────────────────┼──────────┼──────────┼──────────┤
│ ▼ OP Saal 1     │          │          │          │
│   ├ Früh (7-13) │ Müller   │ Schmidt  │ Weber    │
│   ├ Spät (13-20)│ Schmidt  │ Weber    │ Müller   │
│   └ Nacht (20-7)│ Weber    │ Müller   │ Schmidt  │
├─────────────────┼──────────┼──────────┼──────────┤
│ CT              │ Fischer  │ Fischer  │ Fischer  │
└─────────────────┴──────────┴──────────┴──────────┘
```

### 4.3 Droppable-ID-Schema

**Aktuell:** `{date}__{position}`  
**Erweitert:** `{date}__{position}__{timeslotId}` oder `{date}__{position}__null` für ganztägig

Beispiele:
- `2026-01-27__OP Saal 1__ts1` (Frühdienst am 27.01.)
- `2026-01-27__CT__null` (ganztägig, kein Timeslot)

---

## 5. Vordefinierte Timeslot-Templates

### 5.1 Standard-Templates

| Template-Name | Label | Start | Ende | Über Mitternacht |
|---------------|-------|-------|------|------------------|
| `EARLY_LATE` | Früh / Spät | 07:00-13:00 / 13:00-20:00 | Nein |
| `THREE_SHIFT` | Früh / Spät / Nacht | 06:00-14:00 / 14:00-22:00 / 22:00-06:00 | Ja (Nacht) |
| `HALF_DAY` | Vormittag / Nachmittag | 08:00-12:00 / 12:00-17:00 | Nein |
| `MORNING_AFTERNOON_EVENING` | Morgen / Nachmittag / Abend | 07:00-12:00 / 12:00-17:00 / 17:00-22:00 | Nein |

### 5.2 Custom-Templates

Benutzer können eigene Zeitfenster definieren mit:
- Freiem Label (max. 20 Zeichen für Grid-Darstellung)
- Start- und Endzeit
- Konfigurierbare Übergangszeit (0-60 Minuten)

---

## 6. Validierungslogik

### 6.1 Überlappungsprüfung

**Datei:** `src/components/validation/ShiftValidation.jsx`

**Neue Methode:** `_checkTimeslotOverlaps()`

```javascript
/**
 * Prüft, ob ein Mitarbeiter in überlappenden Zeitfenstern 
 * verschiedener Arbeitsplätze eingeteilt ist.
 * 
 * @param {string} doctorId - Mitarbeiter-ID
 * @param {string} dateStr - Datum (YYYY-MM-DD)
 * @param {string} newPosition - Zielposition
 * @param {string} newTimeslotId - Ziel-Timeslot (oder null)
 * @param {string} excludeShiftId - Zu ignorierende ShiftEntry-ID
 * @returns {{ blocker?: string, warning?: string }}
 */
_checkTimeslotOverlaps(doctorId, dateStr, newPosition, newTimeslotId, excludeShiftId) {
    // 1. Alle ShiftEntries des Mitarbeiters am Tag laden
    const doctorShifts = this.shifts.filter(s => 
        s.doctor_id === doctorId && 
        s.date === dateStr &&
        s.id !== excludeShiftId
    );
    
    // 2. Für jeden Eintrag: Timeslot-Zeiten ermitteln
    // 3. Zeitfenster-Überlappung berechnen (unter Berücksichtigung Toleranz)
    // 4. Bei Überlappung: Blocker zurückgeben
    
    // Pseudo-Logik:
    // newTimeslot = lookup(newTimeslotId) || { start: "00:00", end: "23:59" }
    // for each existingShift:
    //   existingTimeslot = lookup(existingShift.timeslot_id)
    //   if overlaps(newTimeslot, existingTimeslot, tolerance):
    //     return { blocker: `Überlappung mit ${existingShift.position}` }
}
```

### 6.2 Über-Mitternacht-Logik

Timeslots mit `end_time < start_time` (z.B. 22:00 - 06:00) werden als über Mitternacht gehend interpretiert:

```javascript
/**
 * Prüft ob zwei Zeitfenster überlappen (inkl. Über-Mitternacht-Handling)
 */
function timeslotsOverlap(slot1, slot2, toleranceMinutes = 0) {
    const toMinutes = (time) => {
        const [h, m] = time.split(':').map(Number);
        return h * 60 + m;
    };
    
    const expandSlot = (slot) => {
        const start = toMinutes(slot.start_time);
        let end = toMinutes(slot.end_time);
        
        // Über Mitternacht: Ende auf nächsten Tag erweitern
        if (end <= start) {
            end += 24 * 60; // +1 Tag
        }
        
        return { start: start + toleranceMinutes, end: end - toleranceMinutes };
    };
    
    const s1 = expandSlot(slot1);
    const s2 = expandSlot(slot2);
    
    // Überlappung prüfen
    return s1.start < s2.end && s2.start < s1.end;
}
```

### 6.3 Integration in bestehende Validierung

```javascript
// In validate() Methode erweitern:
validate(doctorId, dateStr, position, options = {}) {
    const { excludeShiftId, timeslotId = null } = options;
    
    // ... bestehende Prüfungen ...
    
    // NEU: Timeslot-Überlappung prüfen (nur wenn Timeslot angegeben)
    if (timeslotId || this._workplaceHasTimeslots(position)) {
        const overlapResult = this._checkTimeslotOverlaps(
            doctorId, dateStr, position, timeslotId, excludeShiftId
        );
        if (overlapResult.blocker) result.blockers.push(overlapResult.blocker);
        if (overlapResult.warning) result.warnings.push(overlapResult.warning);
    }
    
    return result;
}
```

---

## 7. Admin-UI für Timeslot-Verwaltung

### 7.1 Workplace-Einstellungen erweitern

**Datei:** `src/components/admin/WorkplaceSettings.jsx`

**Neuer Bereich im Edit-Dialog:**

```jsx
{/* Timeslots-Sektion */}
<div className="space-y-4 pt-4 border-t">
    <div className="flex items-center justify-between">
        <div>
            <Label className="text-base">Zeitfenster aktivieren</Label>
            <p className="text-xs text-slate-500">
                Ermöglicht die Besetzung mit wechselnden Teams über den Tag
            </p>
        </div>
        <Switch
            checked={editForm.timeslots_enabled || false}
            onCheckedChange={(checked) => setEditForm({...editForm, timeslots_enabled: checked})}
        />
    </div>
    
    {editForm.timeslots_enabled && (
        <TimeslotEditor 
            workplaceId={editForm.id}
            defaultTolerance={editForm.default_overlap_tolerance_minutes}
        />
    )}
</div>
```

### 7.2 TimeslotEditor-Komponente (neu)

**Datei:** `src/components/admin/TimeslotEditor.jsx`

Funktionen:
- Template-Auswahl (Dropdown)
- Timeslot-Liste mit Drag & Drop Sortierung
- Inline-Bearbeitung von Label, Start, Ende
- Übergangszeit-Konfiguration
- "Hinzufügen" Button für Custom-Slots

---

## 8. ScheduleBoard-Anpassungen

### 8.1 Grid-Rendering

**Datei:** `src/components/schedule/ScheduleBoard.jsx`

**Änderungen in der Zeilen-Generierung (~Zeile 1200-1400):**

```jsx
// Statt einer Zeile pro Position:
// Bei timeslots_enabled: Expandierbare Gruppe mit Sub-Zeilen

const renderPositionRows = (position, workplace) => {
    if (!workplace.timeslots_enabled) {
        // Standard: Eine Zeile
        return <PositionRow position={position} timeslotId={null} />;
    }
    
    // Mit Timeslots: Expandierbare Gruppe
    return (
        <PositionGroup 
            position={position}
            expanded={expandedPositions.includes(position)}
            onToggle={() => toggleExpanded(position)}
        >
            {workplace.timeslots.map(slot => (
                <TimeslotRow 
                    key={slot.id}
                    position={position}
                    timeslot={slot}
                />
            ))}
        </PositionGroup>
    );
};
```

### 8.2 Drag & Drop Handler

**Änderungen in onDragEnd (~Zeile 1638-1720):**

```javascript
const onDragEnd = (result) => {
    const { destination, draggableId, source } = result;
    if (!destination) return;
    
    // Droppable-ID parsen (erweitert)
    const [dateStr, position, timeslotId] = destination.droppableId.split('__');
    const effectiveTimeslotId = timeslotId === 'null' ? null : timeslotId;
    
    // Validierung mit Timeslot
    const isBlocked = checkConflicts(
        doctorId, 
        dateStr, 
        position, 
        false, 
        excludeShiftId,
        effectiveTimeslotId  // NEU
    );
    
    if (isBlocked) return;
    
    // ShiftEntry erstellen/aktualisieren
    createShiftMutation.mutate({
        date: dateStr,
        position,
        doctor_id: doctorId,
        timeslot_id: effectiveTimeslotId,  // NEU
        order: newOrder
    });
};
```

### 8.3 Shift-Chip Darstellung

Bei Timeslots: Zeige Zeitangabe im Chip

```jsx
<ShiftChip>
    {doctor.initials}
    {shift.timeslot_id && (
        <span className="text-xs opacity-70 ml-1">
            ({formatTimeRange(timeslot)})
        </span>
    )}
</ShiftChip>
```

---

## 9. Kalender-Integration

### 9.1 Google Calendar Sync erweitern

**Datei:** `functions/syncCalendar.ts`

```typescript
// Bei Event-Erstellung: Timeslot-Zeiten berücksichtigen
const createCalendarEvent = async (shift: ShiftEntry, timeslot?: WorkplaceTimeslot) => {
    const baseDate = new Date(shift.date);
    
    let startDateTime: Date;
    let endDateTime: Date;
    
    if (timeslot) {
        // Mit Timeslot: Exakte Zeiten verwenden
        startDateTime = combineDateAndTime(baseDate, timeslot.start_time);
        endDateTime = combineDateAndTime(baseDate, timeslot.end_time);
        
        // Über Mitternacht: Ende auf nächsten Tag
        if (timeslot.spans_midnight) {
            endDateTime = addDays(endDateTime, 1);
        }
    } else {
        // Ohne Timeslot: Ganztägiges Event
        startDateTime = startOfDay(baseDate);
        endDateTime = endOfDay(baseDate);
    }
    
    return {
        summary: `${shift.position}${timeslot ? ` (${timeslot.label})` : ''}`,
        start: { dateTime: startDateTime.toISOString() },
        end: { dateTime: endDateTime.toISOString() },
        // ...
    };
};
```

### 9.2 Event-Titel Format

- Ohne Timeslot: `"OP Saal 1"`
- Mit Timeslot: `"OP Saal 1 (Früh 07:00-13:00)"`
- Über Mitternacht: `"Nachtdienst (22:00-06:00 +1)"`

---

## 10. Reporting & Arbeitszeitüberwachung

### 10.1 Arbeitsstunden-Berechnung

**Neue Utility-Funktion:** `src/utils/workingHoursCalculation.js`

```javascript
/**
 * Berechnet die Arbeitsstunden aus einem ShiftEntry
 */
export function calculateShiftHours(shift, timeslot) {
    if (!timeslot) {
        // Standard-Arbeitstag (z.B. 8 Stunden)
        return 8;
    }
    
    const startMinutes = timeToMinutes(timeslot.start_time);
    let endMinutes = timeToMinutes(timeslot.end_time);
    
    // Über Mitternacht
    if (endMinutes <= startMinutes) {
        endMinutes += 24 * 60;
    }
    
    return (endMinutes - startMinutes) / 60;
}

/**
 * Aggregiert Arbeitsstunden pro Mitarbeiter im Zeitraum
 */
export function aggregateWorkingHours(shifts, timeslots, dateRange) {
    const hoursPerDoctor = {};
    
    for (const shift of shifts) {
        if (!isInRange(shift.date, dateRange)) continue;
        
        const timeslot = timeslots.find(t => t.id === shift.timeslot_id);
        const hours = calculateShiftHours(shift, timeslot);
        
        hoursPerDoctor[shift.doctor_id] = 
            (hoursPerDoctor[shift.doctor_id] || 0) + hours;
    }
    
    return hoursPerDoctor;
}
```

### 10.2 Stellenplan-Integration

**Erweiterung:** `src/components/statistics/` (bestehende Statistik-Komponenten)

```javascript
// Vergleich: Geplante Stunden vs. Soll-Stunden laut Stellenplan
const workloadAnalysis = (doctor, shifts, timeslots, period) => {
    const actualHours = aggregateWorkingHours(
        shifts.filter(s => s.doctor_id === doctor.id),
        timeslots,
        period
    );
    
    // Soll-Stunden aus Stellenplan (work_percentage)
    const workPercentage = doctor.work_percentage || 100;
    const fullTimeHours = period.workDays * 8; // z.B. 20 Tage * 8h = 160h
    const targetHours = fullTimeHours * (workPercentage / 100);
    
    return {
        actual: actualHours,
        target: targetHours,
        difference: actualHours - targetHours,
        percentageOfTarget: (actualHours / targetHours) * 100
    };
};
```

### 10.3 Dashboard-Widgets

**Neue Widgets für Arbeitszeitübersicht:**

1. **Monats-Arbeitszeitübersicht pro Mitarbeiter**
   - Ist-Stunden vs. Soll-Stunden
   - Farbcodierung: Grün (im Rahmen), Gelb (Abweichung), Rot (kritisch)

2. **Warnungen bei Überschreitung**
   - Tägliche Maximalarbeitszeit (11h gesetzlich)
   - Wöchentliche Maximalarbeitszeit (48h)
   - Ruhezeiten zwischen Schichten (11h)

3. **Timeslot-Auslastung pro Position**
   - Wie oft ist jedes Zeitfenster besetzt?
   - Identifizierung unterbesetzter Slots

---

## 11. Implementierungsplan

### Phase 1: Datenbank-Erweiterung (Backend)
- [ ] Migrations-Dateien erstellen
- [ ] `WorkplaceTimeslot` Entity in `entities.js` registrieren
- [ ] `dbProxy.js` um neue Felder erweitern
- [ ] API-Endpunkte für Timeslot-CRUD

### Phase 2: Admin-UI
- [ ] `TimeslotEditor`-Komponente erstellen
- [ ] `WorkplaceSettings.jsx` erweitern
- [ ] Template-Auswahl implementieren

### Phase 3: Grid-Integration
- [ ] `ScheduleBoard.jsx` für Timeslot-Zeilen erweitern
- [ ] Drag & Drop mit Timeslot-Unterstützung
- [ ] Shift-Chip-Darstellung mit Zeitangabe

### Phase 4: Validierung
- [ ] `ShiftValidation.jsx` um Überlappungsprüfung erweitern
- [ ] Über-Mitternacht-Logik implementieren
- [ ] Toleranz-Handling

### Phase 5: Kalender & Export
- [ ] `syncCalendar.ts` für Timeslots erweitern
- [ ] Excel-Export mit Zeitangaben
- [ ] E-Mail-Benachrichtigungen anpassen

### Phase 6: Reporting
- [ ] Arbeitsstunden-Berechnung implementieren
- [ ] Stellenplan-Vergleich
- [ ] Dashboard-Widgets

---

## 12. Testszenarien

### 12.1 Rückwärtskompatibilität
- [ ] Alte Frontend-Version kann mit neuer DB arbeiten
- [ ] Bestehende ShiftEntries ohne Timeslot funktionieren
- [ ] Workplaces ohne Timeslots verhalten sich unverändert

### 12.2 Timeslot-Funktionalität
- [ ] Timeslot-Zuweisung per Drag & Drop
- [ ] Überlappungsprüfung blockiert Doppelbelegung
- [ ] Über-Mitternacht-Schichten werden korrekt angezeigt

### 12.3 Kalender-Sync
- [ ] Events mit korrekten Start-/Endzeiten
- [ ] Über-Mitternacht-Events auf richtigem Datum

### 12.4 Reporting
- [ ] Arbeitsstunden-Aggregation korrekt
- [ ] Stellenplan-Vergleich stimmt

---

## 13. Offene Fragen

1. **Mindestbesetzung pro Timeslot?**  
   Soll die bestehende Mindestbesetzungs-Logik auf Timeslot-Ebene erweitert werden?

2. **Rotation + Timeslot?**  
   Können Rotationen auch Timeslots haben, oder nur Dienste/Arbeitsplätze?

3. **Urlaubsanrechnung?**  
   Wie werden Timeslot-Stunden bei Teilurlaub (halber Tag) angerechnet?

4. **Historische Daten?**  
   Sollen bestehende ShiftEntries optional auf Timeslots migriert werden können?

---

## 14. Abhängigkeiten

| Komponente | Abhängigkeit |
|------------|--------------|
| `WorkplaceTimeslot` Entity | Neue DB-Tabelle |
| Timeslot-Editor UI | shadcn/ui Komponenten |
| Überlappungsprüfung | Bestehende `ShiftValidation.jsx` |
| Kalender-Sync | Bestehende `syncCalendar.ts` |
| Reporting | Bestehende Statistik-Komponenten |

---

## 15. Risiken & Mitigationen

| Risiko | Wahrscheinlichkeit | Auswirkung | Mitigation |
|--------|-------------------|------------|------------|
| Performance bei vielen Timeslots | Mittel | Mittel | Lazy Loading, Caching |
| UI-Komplexität im Grid | Hoch | Mittel | Collapsible Sections, nur bei Bedarf |
| Validierungs-Edge-Cases | Mittel | Hoch | Umfangreiche Unit-Tests |
| Kalender-Sync-Probleme | Niedrig | Niedrig | Batch-Updates, Fehlerhandling |

---

*Dokument erstellt für spätere Implementierung. Änderungen vorbehalten.*
