# Feature: Weiterbildungsplanung (Training)

> Die vollständige Dokumentation dieses Features ist in [VACATION.md](./VACATION.md#feature-weiterbildungsplanung-training) enthalten, da Urlaub und Weiterbildung dieselbe Kalenderkomponente teilen.

---

## Kurzreferenz

| Datei | Funktion |
|---|---|
| `src/pages/Training.jsx` | Seiten-Einstiegspunkt (~699 Zeilen) |
| `src/components/training/TrainingOverview.jsx` | Übersicht aller Mitarbeitenden × Modalitäten |
| `src/components/training/TransferToSchedulerDialog.jsx` | Übernahme in den Dienstplan |
| `src/components/vacation/DoctorYearView.jsx` | Jahresansicht (geteilt mit Vacation) |

## Besonderheiten

- Weiterbildungseinträge sind `shift_entries` mit `section = 'Rotationen'`
- Modalitäten werden dynamisch aus `workplaces` (Kategorie-Filter) geladen
- `TransferToSchedulerDialog` erstellt Batch-Einträge über `/api/atomic/batch`

## Test-Szenarien

Vollständige Szenarien: [VACATION.md – Weiterbildung](./VACATION.md#test-szenarien--weiterbildung)

### T-TRG-03: Übersicht aller Mitarbeitenden

```
Aktion: Ansicht auf "Übersicht" umschalten
Erwartet:
  - Tabelle: Mitarbeitende × Monate
  - Weiterbildungstage (CT, MRT etc.) farblich markiert
  - Summen je Mitarbeiter und je Modalität sichtbar
```

### T-TRG-04: Modalitäten dynamisch erweitern

```
Aktion: Neuen Arbeitsbereich (Kategorie 'Rotationen', Name 'PET-CT') anlegen
Erwartet:
  - Training-Page zeigt neuen Reiter/Tab 'PET-CT'
  - Einträge können für neue Modalität erstellt werden
```
