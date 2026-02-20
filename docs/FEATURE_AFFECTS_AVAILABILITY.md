# Feature: Verfügbarkeitsrelevanz von Arbeitsplätzen

**Status:** Implementiert  
**Erstellungsdatum:** 2026-02-04  
**Version:** 1.0

---

## 1. Zusammenfassung

Dieses Feature ermöglicht es, pro Arbeitsplatz festzulegen, ob die Einteilung eines Mitarbeiters die Verfügbarkeit beeinträchtigt oder nicht.

### Problemstellung
Bestimmte Arbeitsplätze (z.B. "Demo Chirurgie") sind keine "echten" Arbeitseinsätze im Sinne der Verfügbarkeitsplanung. Mitarbeiter, die dort eingeteilt sind, sollten weiterhin als "verfügbar" für andere Tätigkeiten gelten.

### Lösung
Ein neues konfigurierbares Flag `affects_availability` pro Arbeitsplatz:
- **TRUE (Standard):** Einteilung beeinflusst Verfügbarkeit (Mitarbeiter erscheint nicht mehr unter "Verfügbar")
- **FALSE:** Mitarbeiter bleibt weiterhin unter "Verfügbar" gelistet, obwohl er eingeteilt ist

### Wichtige Unterscheidung
**Dies ist NICHT dasselbe wie das "Rotation OK" Flag für Dienste!**
- "Rotation OK" erlaubt es, dass ein Dienst parallel zu einer Tagesrotation zugewiesen werden kann
- "Verfügbarkeit beeinflussen" bestimmt, ob der Mitarbeiter noch in der "Verfügbar"-Zeile erscheint

---

## 2. Anwendungsfälle

| Arbeitsplatz | affects_availability | Verhalten |
|-------------|---------------------|-----------|
| CT (Rotation) | TRUE (Default) | Mitarbeiter verschwindet aus "Verfügbar" |
| Dienst Vordergrund | TRUE (immer) | Mitarbeiter verschwindet aus "Verfügbar" |
| Demo Chirurgie | FALSE | Mitarbeiter bleibt unter "Verfügbar" |
| Konsil Orthopädie | FALSE | Mitarbeiter bleibt unter "Verfügbar" |

---

## 3. Technische Umsetzung

### 3.1 Datenbank-Migration

Die Migration wird pro Mandanten-Datenbank ausgeführt über den Admin-Bereich.

**Adminbereich → Datenbank-Migrationen ausführen**

Die Migration ist im Endpoint `/api/admin/run-timeslot-migrations` integriert:

```sql
ALTER TABLE Workplace 
ADD COLUMN affects_availability BOOLEAN DEFAULT TRUE;
```

**Migration Status prüfen:** `/api/admin/timeslot-migration-status`

### 3.2 Backend-Anpassung

**Datei:** `server/routes/dbProxy.js`

```javascript
const boolFields = [
    // ... bestehende Felder
    'affects_availability'
];
```

### 3.3 Abwärtskompatibilität

Das Feature ist vollständig abwärtskompatibel:

- **Neues Frontend + Altes Backend:** 
  - Das Feld ist `undefined` → alle Checks mit `=== false` sind falsch
  - Bisheriges Verhalten bleibt erhalten
  - UI-Switch zeigt "aktiviert" (Default)
  - Badge wird nicht angezeigt

- **Altes Frontend + Neues Backend:**
  - Das neue Feld wird vom Frontend ignoriert
  - Bisheriges Verhalten bleibt erhalten

### 3.3 Verfügbar-Zeilen-Logik

**Datei:** `src/components/schedule/ScheduleBoard.jsx`

Die Berechnung der "verfügbaren" Mitarbeitenden berücksichtigt das neue Feld:

```javascript
const blockingShifts = currentWeekShifts.filter(s => {
    if (s.date !== dateStr) return false;
    const wp = workplaces.find(w => w.name === s.position);
    
    // Wenn Arbeitsplatz Verfügbarkeit nicht beeinflusst → nicht blockierend
    if (wp?.affects_availability === false) return false;
    
    // Weitere Logik für Rotationen/Dienste...
});
```

### 3.4 Konfliktprüfung

**Datei:** `src/components/validation/ShiftValidation.jsx`

Bei Arbeitsplätzen mit `affects_availability === false`:
- Abwesenheits-Konflikte werden weiterhin geprüft (Urlaub, Krank, etc.)
- Rotations-/Dienst-Konflikte werden übersprungen

---

## 4. UI-Konfiguration

### 4.1 Arbeitsplatz-Einstellungen

Die Option ist verfügbar für:
- **Demonstrationen & Konsile** (z.B. Demo Chirurgie)
- **Benutzerdefinierte Kategorien**

Die Option ist **NICHT** verfügbar für:
- **Dienste** (Dienste beeinflussen immer die Verfügbarkeit)
- **Rotationen** (Kernarbeitsplätze beeinflussen immer die Verfügbarkeit)

### 4.2 Darstellung im Dialog

Im WorkplaceConfigDialog erscheint ein Switch:

```
┌─────────────────────────────────────────────────────────────┐
│ ⚡ Verfügbarkeit beeinflussen                    [Toggle] │
│ Wenn deaktiviert: Mitarbeiter bleibt "Verfügbar"           │
│ trotz Einteilung. Nur Abwesenheits-Konflikte werden        │
│ geprüft.                                                   │
└─────────────────────────────────────────────────────────────┘
```

### 4.3 Badge in der Liste

Arbeitsplätze mit `affects_availability === false` erhalten ein Badge:

```
Demo Chirurgie [Nicht verfügbarkeitsrelevant]
```

---

## 5. Konfliktprüfung im Detail

### 5.1 Was wird geprüft (unabhängig von affects_availability)

- **Abwesenheits-Konflikte:** Mitarbeiter im Urlaub/Krank kann nicht eingeteilt werden

### 5.2 Was nur bei affects_availability = TRUE geprüft wird

- Rotations-/Dienst-Konflikte
- Exklusivität von Diensten
- Aufeinanderfolgende Tage-Beschränkungen

---

## 6. Beispiel-Workflow

1. Admin öffnet Arbeitsplatz-Konfiguration
2. Wählt "Demonstrationen & Konsile"
3. Bearbeitet "Demo Chirurgie"
4. Deaktiviert "Verfügbarkeit beeinflussen"
5. Speichert

**Ergebnis:**
- Mitarbeiter kann an "Demo Chirurgie" eingeteilt werden
- Mitarbeiter erscheint weiterhin in der "Verfügbar"-Zeile
- Mitarbeiter kann parallel an Rotationen eingeteilt werden
- Bei Urlaub/Krankheit wird Konflikt erkannt

---

## 7. Rückwärtskompatibilität

- Default-Wert ist `TRUE` → Bestehendes Verhalten bleibt erhalten
- Keine Migration bestehender Daten erforderlich
- Alte Frontend-Versionen ignorieren das neue Feld
