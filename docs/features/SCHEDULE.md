# Feature: Dienstplan (Schedule)

> Das Kernfeature von CuraFlow. Ermöglicht die visuelle Verwaltung des wöchentlichen/täglichen Dienstplans per Drag-and-Drop.

---

## Funktionsumfang

- **Wochen- und Tagesansicht** des Dienstplans
- **Drag-and-Drop**: Ärzte auf Dienste ziehen, Einträge verschieben
- **Abschnitte**: Anwesenheiten, Abwesenheiten, Dienste, Rotationen, Sonstiges
- **Arbeitsbereiche** (Zeilen im Plan): CT, MRT, Angiographie, Vordergrund, Hintergrund etc.
- **Freitext-Zellen**: Benutzerdefinierte Texte statt Arztname
- **Undo/Redo**: Bis zu 10 Schritte zurücknehmbar
- **Feiertags-Anzeige**: Feiertage und Schulferien farblich hervorgehoben
- **Besetzungsvalidierung**: Warnung bei Unter-/Überbesetzung
- **Schichtlimit-Check**: Warnung bei zu vielen Diensten je Arzt
- **Seitenleiste**: Arztliste zum Ziehen auf den Plan
- **KI-Generierung**: Automatische Planvorschläge (Wand-Icon)
- **Excel-Export**: Dienstplan als XLSX herunterladen
- **Mobile Ansicht**: Vereinfachte Darstellung für Smartphones
- **Abschnitts-Konfiguration**: Sichtbarkeit und Reihenfolge anpassbar

---

## Implementierung

### Relevante Dateien

| Datei | Funktion |
|---|---|
| `src/pages/Schedule.jsx` | Seiten-Einstiegspunkt, minimal |
| `src/components/schedule/ScheduleBoard.jsx` | **Hauptkomponente** (~3400 Zeilen), enthält gesamte Logik |
| `src/components/schedule/DraggableDoctor.jsx` | Drag-Source: Arzt in Seitenleiste |
| `src/components/schedule/DraggableShift.jsx` | Drag-Source: Bereits eingeplanter Dienst |
| `src/components/schedule/DroppableCell.jsx` | Drop-Target: Zelle im Plan |
| `src/components/schedule/FreeTextCell.jsx` | Freitext-Zellen Rendering |
| `src/components/schedule/AIRulesDialog.jsx` | KI-Regelkonfigurations-Dialog |
| `src/components/schedule/MobileScheduleView.jsx` | Mobile Ansicht |
| `src/components/schedule/stuffingUtils.jsx` | Verfügbarkeitsberechnungen |
| `src/components/schedule/holidayUtils.jsx` | Feiertagslogik (MV) |
| `src/components/validation/useShiftValidation.js` | Schicht-Validierungs-Hook |
| `src/components/validation/useOverrideValidation.js` | Override-Bestätigungs-Hook |
| `src/components/settings/WorkplaceConfigDialog.jsx` | Arbeitsbereich-Konfiguration |
| `src/components/settings/SectionConfigDialog.jsx` | Abschnitts-Konfiguration |
| `server/routes/schedule.js` | Backend: Generierung, Export, E-Mail |

### Datenbankentitäten

- **Lesen:** `shift_entries` (gefiltert nach Datum-Bereich, max. 5000 Einträge pro Abfrage)
- **Schreiben:** `shift_entries` (create, update, delete)
- **Konfiguration:** `workplaces`, `system_settings`, `color_settings`, `section_configs`

### Datenfluss beim Drag-and-Drop

```
1. Benutzer zieht Arzt → DroppableCell (onDragEnd-Callback)
2. ScheduleBoard.handleDragEnd() wertet source/destination aus
3. Validierung: useShiftValidation() prüft Konflikte
4. Falls Konflikt: OverrideConfirmDialog anzeigen
5. Falls OK: db.ShiftEntry.create() / .update()
6. queryClient.invalidateQueries(['shifts']) → automatisches Re-render
7. Undo-Stack wird aktualisiert
```

### Abschnitte und Arbeitsbereiche

Abschnitte sind teils statisch, teils dynamisch aus der `workplaces`-Tabelle geladen:

```javascript
// ScheduleBoard.jsx
const STATIC_SECTIONS = {
  "Anwesenheiten": { rows: ["Verfügbar"] },
  "Abwesenheiten": { rows: ["Frei", "Krank", "Urlaub", "Dienstreise"] },
  "Dienste":       { rows: [] },  // Dynamisch aus workplaces (category='Dienste')
  "Sonstiges":     { rows: ["Sonstiges"] }
};
```

Ärzte der Kategorie "Rotationen" werden ebenfalls dynamisch aus `workplaces` geladen.

---

## Erweiterungen entwickeln

### Neuen Abschnitt hinzufügen

1. In `STATIC_SECTIONS` in `ScheduleBoard.jsx` eintragen **oder**
2. Über `SectionConfigDialog` als dynamischen Abschnitt konfigurieren

```javascript
// Beispiel: Neuer statischer Abschnitt
const STATIC_SECTIONS = {
  // ... bestehende Abschnitte ...
  "Konsile": {
    headerColor: "bg-teal-100 text-teal-900",
    rowColor: "bg-teal-50/30",
    rows: ["Innere Konsil", "Chirurgie Konsil"]
  }
};
```

### Neue Validierungsregel hinzufügen

In `src/components/validation/useShiftValidation.js`:

```javascript
// Neue Regel: Arzt nicht an Feiertagen einplanen
if (isHoliday(date) && shift.workplace !== 'Frei') {
  return {
    hasConflict: true,
    message: `${doctorName} ist an Feiertagen nicht verfügbar`
  };
}
```

### KI-Generierung erweitern

Das Backend-Endpoint `POST /api/schedule/generate` nimmt Regeln entgegen und generiert Einträge. Die Regeln können im `AIRulesDialog.jsx` konfiguriert und an das Backend übergeben werden.

---

## Test-Szenarien

### T-SCH-01: Arzt per Drag-and-Drop einplanen

```
Voraussetzung: Min. 1 Arzt und 1 Arbeitsbereich existieren
Aktion: Arzt aus Seitenleiste auf CT-Zelle (Montag) ziehen
Erwartet: 
  - Neuer shift_entry in DB (doctor_id, date=Montag, workplace='CT')
  - Arzt erscheint in CT-Zelle
  - Toast: "Dienst eingetragen"
```

### T-SCH-02: Validierungswarnung bei Doppelbelegung

```
Voraussetzung: Arzt A bereits am Montag in CT
Aktion: Arzt A erneut auf andere Zelle (Montag) ziehen
Erwartet:
  - OverrideConfirmDialog erscheint
  - Warnung: "Arzt A hat bereits einen Eintrag an diesem Tag"
  - "Trotzdem speichern" → speichert
  - "Abbrechen" → kein Eintrag
```

### T-SCH-03: Undo-Funktionalität

```
Aktion: Dienstplan-Eintrag erstellen → Undo-Button (⟲) klicken
Erwartet: Eintrag aus DB gelöscht, verschwindet aus Plan
```

### T-SCH-04: Wochennavigation

```
Aktion: "Nächste Woche" klicken
Erwartet: 
  - Anzeige aktualisiert sich auf nächste KW
  - URL/State ändert sich
  - Shifts für neue Woche werden geladen (TanStack Query)
```

### T-SCH-05: Readonly-Modus

```
Voraussetzung: Login als Benutzer mit Rolle 'readonly'
Erwartet:
  - Drag-and-Drop deaktiviert
  - Keine Buttons zum Löschen/Bearbeiten sichtbar
  - Plan lesbar
```

### T-SCH-06: Mobile Ansicht

```
Voraussetzung: Viewport < 768px (oder DevTools Mobile)
Erwartet:
  - MobileScheduleView wird gerendert statt ScheduleBoard
  - Kompakte Listenansicht
```

### T-SCH-07: Excel-Export

```
Aktion: Export-Button klicken → "Excel herunterladen"
Erwartet:
  - XLSX-Datei wird heruntergeladen
  - Enthält aktuellen Wochenplan mit Arzt-Dienst-Zuordnungen
```

### T-SCH-08: Feiertags-Hervorhebung

```
Voraussetzung: Woche mit Feiertag in MV (z.B. 3. Oktober)
Erwartet:
  - Feiertags-Spalte ist farblich markiert (rötlich)
  - Tooltip oder Label zeigt Feiertagsname
```
