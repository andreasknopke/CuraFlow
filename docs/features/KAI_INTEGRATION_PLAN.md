# KAI-Anästhesie — Integrationsplan

Umsetzungsplan für die Integration von CuraFlow in die Klinik für Anästhesie und Intensivmedizin (KAI).  
Basierend auf dem Nutzerfeedback vom April 2026.

## Phase 0: Sofort-Fixes ✅

| Ticket | Beschreibung | Status |
|--------|-------------|--------|
| 0.1 | Rate-Limit von 300 auf 800 req/min erhöht, Holiday-API serverseitig gecacht (10 min TTL) | ✅ f259ae6 |
| 0.2 | Mandantenspezifisches Setting `rotation_restricts_other_assignments` für strikte Rotations-Einteilung | ✅ f259ae6 |
| 0.3 | AutoFill-Settings-Dialog im Dropdown-Menü (admin-only) mit Dienstlimits, Rotation, Debug | ✅ f259ae6 |

---

## Phase 1: Grundlegende KAI-Anforderungen

| Ticket | Beschreibung | Dateien | Aufwand |
|--------|-------------|---------|---------|
| 1.1 | **"Nur Tagesspiegel"-AutoFill-Modus** — Neuer Eintrag im AutoFill-Dropdown: überspringt Phase A (Dienste) komplett, füllt nur Phasen B+C. Löst das Problem, dass Rotanten in OP-Säle verschoben werden, weil alle anderen schon für Dienste verplant sind. | autoFillEngine.js, ScheduleBoard.jsx | ~0.5 Tage |
| 1.2 | **Besetzungsregeln: `min_staff`/`optimal_staff`** — Hinweis in Workplace-Konfiguration, dass man statt "ITS Nacht 1/2" + "ITS Nacht 2/2" besser einen Dienst "ITS Nacht" mit `min_staff=2` nutzt. | WorkplaceConfigDialog.jsx | ~0.5 Tage |
| 1.3 | **Mitarbeiterkonstellationen verbieten** — Neue Tabelle `EmployeeConflict(doctor_a_id, doctor_b_id, conflict_type, description)`. Admin-UI in Mitarbeiterverwaltung. Cost-Function: hoher Penalty wenn beide am selben Tag/Dienst eingeteilt. | tenantMigrations.js, costFunction.js, autoFillEngine.js, neue Komponente EmployeeConflictEditor.jsx | 2–3 Tage |
| 1.4 | **MA-Qualifikationen sichtbar** — Read-only-Ansicht der eigenen Qualifikationen im Dashboard für alle Mitarbeiter. | MyDashboard.jsx | ~0.5 Tage |

---

## Phase 2: Erweiterte Funktionen

| Ticket | Beschreibung | Dateien | Aufwand |
|--------|-------------|---------|---------|
| 2.1 | **Teilzeit-Arbeitsmuster** — Neues Konzept `WorkPattern` pro Mitarbeiter mit 3 Modi: `fixed_days` (Mo/Mi/Fr), `rolling` (alle N Tage frei), `block` (4 Wochen an / 1 Woche frei). AutoFill behandelt Nicht-Arbeitstage wie Abwesenheiten. | Neue Tabelle DoctorWorkPattern, autoFillEngine.js, neue Komponente WorkPatternEditor.jsx | 4–5 Tage |
| 2.2 | **Nachtdienst-Block-Logik** — Auto-Frei nur nach dem letzten ND eines zusammenhängenden Blocks (nicht nach jedem einzelnen). Vorwärtssuche: wenn nächster Tag auch ND für selben Arzt → kein Frei. | autoFrei.js, autoFillEngine.js | 1–2 Tage |
| 2.3 | **Positions-Priorisierung** — Neue Tabelle `WorkplacePreference(workplace_id, doctor_id, priority_weight)`. Admin kann pro Position bevorzugte Ärzte festlegen (z.B. OA 1 vor OA 2 als Saal-OA). Bonus in Cost-Function. | Neue Tabelle, costFunction.js, Workplace-Config UI | 1.5–2 Tage |
| 2.4 | **Qualifikations-Filter in Team-Übersicht** — Dropdown-Filter "Zeige nur MA mit Qualifikation X" in der Mitarbeiter-/Team-Ansicht. | Staff.jsx / QualificationOverview.jsx | 0.5–1 Tag |

---

## Phase 3: Komfort & Spezialfälle

| Ticket | Beschreibung | Dateien | Aufwand |
|--------|-------------|---------|---------|
| 3.1 | **Wunschkiste qualifikationsgefiltert** — Beim Öffnen des Wunschdialogs prüfen, ob der MA die Pflicht-Qualifikation für die Position hat. Falls nicht: Warnung oder ausblenden. | WishRequestDialog.jsx, WishList.jsx | 1.5–2 Tage |
| 3.2 | **Sondertage/KAEP/TV** — Neuer Abwesenheitstyp "Freistellung" mit Option "wiederkehrend monatlich". System generiert automatisch Einträge für N Monate im Voraus. | tenantMigrations.js, dbProxy.js, neue UI für Recurring-Absences | 2–3 Tage |
| 3.3 | **Externe Mitarbeiter** — Neues Feld `employee_type` (intern/extern/abteilungsfremd) auf Doctor-Tabelle. Externe: eingeschränkter Zugang (Wunschkiste + eigener Kalender). Filterbar in Team-Übersicht. | tenantMigrations.js, auth.js, Staff.jsx | 2 Tage |
| 3.4 | **Geteilte Dienste UI** — Option "Gesamtbesetzung durch 1 Person" an Positionen mit Timeslots. AutoFill kann denselben Arzt in beide Timeslots einplanen. | autoFillEngine.js, Workplace-Config | 1 Tag |

---

## Phase 4: Langfristig (nach Go-Live)

| Ticket | Beschreibung | Aufwand |
|--------|-------------|---------|
| 4.1 | **Mandantenübergreifende Dienst-Konflikterkennung** — Wenn UCH und KAI beide CuraFlow nutzen: beim Einplanen eines Rotanten prüfen, ob dieser im anderen Mandanten am selben Tag schon eingeteilt ist. | 5–8 Tage |
| 4.2 | **Bulk-Import** für MA-Stammdaten + Qualifikationen aus Excel-Liste | 3–4 Tage |

---

## Zeitliche Übersicht

```
Tag 1:   1.1 Nur-Tagesspiegel-Modus + 1.2 min_staff-Hinweis
Tag 2–3: 1.3 Mitarbeiterkonstellationen verbieten
Tag 3:   1.4 MA-Qualifikationen sichtbar
Tag 4–5: 2.1 Teilzeit-Arbeitsmuster
Tag 6:   2.2 Nachtdienst-Block-Logik
Tag 7:   2.3 Positions-Priorisierung + 2.4 Quali-Filter
Tag 8:   3.1 Wunschkiste qualifikationsgefiltert
Tag 9:   3.2 Sondertage/KAEP/TV
Tag 10:  3.3 Externe MA + 3.4 Geteilte Dienste
---
Phase 4: nach Go-Live
```

**Gesamtumfang Phasen 1–3: ca. 10 Arbeitstage**

---

## Nicht im Scope (Antworten an Nutzer)

- **Stundenkonto:** Stunden pro Dienst werden über Timeslot-Zeitfenster (`start_time`/`end_time`) oder Default 8h berechnet. `work_time_percentage` auf Mitarbeiterebene pflegen.
- **Qualifikations-Reihenfolge sortieren:** Bereits implementiert über `order`-Feld in der Qualifikations-Tabelle.
- **Zeitfenster nicht aktiviert:** Funktioniert korrekt ohne Timeslots — Qualifikationslogik greift auf Workplace-Ebene.
- **AA-Rotationsplaner:** Reine Konfiguration — Modalitäten auf KAI-Bereiche umbenennen (OP amb., Zentral-OP, ITS, UMR).
- **Markenname "curaflow":** Zur Kenntnis genommen, kein technisches Issue.
