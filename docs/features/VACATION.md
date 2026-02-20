# Feature: Urlaubsplanung (Vacation) & Weiterbildung (Training)

---

## Feature: Urlaubsplanung

### Funktionsumfang

- **Jahresansicht** je Mitarbeiter: alle Urlaubstage auf einen Blick
- **Übersichtsansicht** aller Mitarbeitenden im Vergleich
- **Urlaubstage eintragen/löschen** direkt im Kalender
- **Schulferien und Feiertage** integriert (Mecklenburg-Vorpommern)
- **Konflikt-Erkennung**: Warnung bei gleichzeitigem Urlaub mehrerer Mitarbeitender
- **Urlaubs-Simulation**: Auswirkungen einer Urlaubsperiode auf den Dienstplan berechnen
- **Verfügbarkeits-Check**: Berücksichtigt Stellenplan (VK-Anteil)
- **Automatische Dienstplan-Synchronisation**: Urlaube erscheinen als Abwesenheit im Dienstplan

### Relevante Dateien

| Datei | Funktion |
|---|---|
| `src/pages/Vacation.jsx` | Hauptseite (~837 Zeilen), gesamte Logik |
| `src/components/vacation/DoctorYearView.jsx` | Jahreskalender-Darstellung (shared mit Training) |
| `src/components/vacation/VacationOverview.jsx` | Übersicht aller Mitarbeitenden |
| `src/components/vacation/ConflictDialog.jsx` | Konflikt-Erkennungs-Dialog |
| `src/components/schedule/staffingUtils.jsx` | `isDoctorAvailable()` Hilfsfunktion |
| `src/components/useHolidays.jsx` | Feiertags-Hook |
| `src/components/settings/AppSettingsDialog.jsx` | Einstellungen (Farbschema etc.) |

### Datenbankentitäten

| Tabelle | Verwendung |
|---|---|
| `shift_entries` | Urlaubseinträge (workplace='Urlaub') |
| `staffing_plan_entries` | VK-Anteile je Monat |
| `system_settings` | Konfiguration (Urlaubstage-Budget) |
| `color_settings` | Farbkonfiguration |

### Urlaub-Eintrag vs. Dienstplan-Eintrag

Urlaubstage sind **normale `shift_entries`** mit `workplace = 'Urlaub'` und `section = 'Abwesenheiten'`. Die Vacation-Seite filtert `shift_entries` nach diesem Wert und zeigt die Einträge im Kalenderformat an.

```javascript
// Vacation.jsx – Urlaub eintragen
await db.ShiftEntry.create({
  doctor_id: selectedDoctorId,
  date: format(date, 'yyyy-MM-dd'),
  workplace: 'Urlaub',
  section: 'Abwesenheiten'
});
```

### Konflikt-Kategorisierung

`ConflictDialog.jsx` implementiert `categorizeConflict()`:

```javascript
export function categorizeConflict(shift, allShifts, doctors) {
  // Prüft: Zu viele Mitarbeitende gleichzeitig im Urlaub?
  // Prüft: Dienste werden nicht besetzt?
  // Gibt: { severity: 'warning'|'error', message } zurück
}
```

### Urlaub-Simulation

Bevor Urlaub eingetragen wird, berechnet die Simulation:
1. Welche Dienste müssten durch Urlaubsvertretung abgedeckt werden?
2. Welche bestehenden Dienst-Einträge des Mitarbeiters werden gelöscht?

```javascript
// Vacation.jsx
const [simulationData, setSimulationData] = useState(null);
// simulationData = { newShifts, shiftsToDelete, shiftsToDeleteIds }
```

---

## Feature: Weiterbildungsplanung (Training)

### Funktionsumfang

- **Weiterbildungsplan** je Mitarbeiter und Jahr (Jahresansicht)
- **Modalitäten**: CT, MRT, Angiographie, Sonographie, Mammographie etc.
- **Übersichts-Ansicht**: Alle Mitarbeitenden, alle Modalitäten
- **Übertragung in Dienstplan**: Weiterbildungstage können direkt in Dienstplan übertragen werden
- **Feiertags-Integration** (wie Urlaub)

### Relevante Dateien

| Datei | Funktion |
|---|---|
| `src/pages/Training.jsx` | Hauptseite |
| `src/components/training/TrainingOverview.jsx` | Übersicht aller Mitarbeitenden |
| `src/components/training/TransferToSchedulerDialog.jsx` | Dialog: → Dienstplan übertragen |
| `src/components/vacation/DoctorYearView.jsx` | Jahreskalender (geteilt mit Vacation) |

### Datenbankentitäten

Weiterbildungseinträge sind ebenfalls **`shift_entries`**:
- `section = 'Rotationen'`
- `workplace = 'CT'` / `'MRT'` / `'Angiographie'` etc.

---

## Test-Szenarien – Urlaub

### T-VAC-01: Urlaub eintragen

```
Aktion: Auf freies Datum in Jahresansicht klicken → "Urlaub"
Erwartet:
  - shift_entry erstellt (workplace='Urlaub', section='Abwesenheiten')
  - Datum im Kalender orange/rot markiert
  - Urlaubs-Zähler aktualisiert
```

### T-VAC-02: Urlaubs-Konflikt erkennen

```
Voraussetzung: 3 von 4 Mitarbeitenden haben gleichzeitig Urlaub
Aktion: 4. Mitarbeiter für gleichen Zeitraum Urlaub eintragen
Erwartet:
  - ConflictDialog zeigt Warnung: "Alle Mitarbeitenden gleichzeitig im Urlaub"
  - Benutzer kann "Trotzdem speichern" oder "Abbrechen"
```

### T-VAC-03: Übersichtsansicht

```
Aktion: Ansicht auf "Übersicht" umschalten
Erwartet:
  - Alle Mitarbeitenden in Zeilen, Monate/Tage als Spalten
  - Urlaube und Schulferien farblich differenziert
```

### T-VAC-04: Mehrere Tage per Range-Auswahl

```
Aktion: Ersten Tag klicken, letzten Tag mit Shift+Klick auswählen
Erwartet:
  - Alle Tage im Bereich als Urlaub eingetragen
  - Wochenenden übersprungen (falls konfiguriert)
```

## Test-Szenarien – Weiterbildung

### T-TRG-01: Weiterbildungstag eintragen

```
Aktion: Modalität "CT" auswählen → Datum klicken
Erwartet:
  - shift_entry erstellt (workplace='CT', section='Rotationen')
  - Tag im Kalender entsprechend markiert
```

### T-TRG-02: Übertragung in Dienstplan

```
Aktion: "In Dienstplan übernehmen" → TransferToSchedulerDialog
Erwartet:
  - Dialog zeigt Liste der zu übertragenden Einträge
  - Nach Bestätigung: Einträge im Dienstplan sichtbar
```
