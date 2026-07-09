# Default-Workplace-Timeslot

**Status:** Implementiert (2026-07-09)

## Zusammenfassung

Arbeitsplätze der Kategorien **"Rotationen" und benutzerdefinierte (Custom) Kategorien** haben immer einen sichtbaren, editierbaren Standard-Zeitraum (07:00–15:30) im Mitarbeiter-Chip des Schedulers. Per Klick auf die Zeitanzeige im Chip kann der Zeitraum individuell pro Schicht angepasst werden (wie bei Timeslot-Arbeitsplätzen).

## Invariante

Jeder Workplace mit `category IN ('Rotationen', <customCategories>)` hat immer ≥1 sichtbaren `WorkplaceTimeslot`-Eintrag. Dies wird gesichert durch:

1. **Backfill-Migration** → bestehende Workplaces ohne Timeslot erhalten einen Default-Timeslot.
2. **Post-Create-Hook** → neu angelegte Workplaces dieser Kategorien erhalten automatisch einen Default-Timeslot.
3. **Löschschutz** → der letzte Timeslot eines Workplace kann nicht gelöscht werden.

## Ausgenommene Kategorien

- `Dienste` → behalten `timeslots_enabled`-Schalter (kein autom. Default)
- `Demonstrationen & Konsile` → behalten `timeslots_enabled`-Schalter (kein autom. Default)

## Technische Umsetzung

### Datenbank

- **Keine Schema-Änderung.** Die vorhandenen `WorkplaceTimeslot`- und `Workplace`-Tabellen werden genutzt.
- `Workplace.timeslots_enabled` wird auf `TRUE` gesetzt (Spalte existiert bereits seit Migration `004`).

### Backend

| Datei | Änderung |
|-------|----------|
| `server/utils/ensureDefaultWorkplaceTimeslots.js` (neu) | Backfill-Helfer: legt Default-Timeslots für Rotation/Custom-Workplaces ohne Timeslot an + setzt `timeslots_enabled=TRUE`. Liest Custom-Kategorien aus `SystemSetting.workplace_categories`. |
| `server/utils/tenantMigrations.js` | Neuer Migrations-Block `ensure_default_workplace_timeslots`, der den Helfer aufruft. Läuft über `/api/admin/run-timeslot-migrations`. |
| `server/routes/dbProxy.js` | Post-Create-Hook `ensureDefaultTimeslotAfterWorkplaceCreate`: nach erfolgreicher Workplace-Anlage wird automatisch ein Default-Timeslot angelegt (wenn Kategorie nicht ausgeschlossen ist). |

### Frontend

| Datei | Änderung |
|-------|----------|
| `src/components/admin/TimeslotEditor.jsx` | Löschschutz: bei `timeslots.length === 1` ist der Lösch-Button deaktiviert mit Tooltip "Mindestens ein Zeitfenster ist erforderlich." |
| `src/components/settings/WorkplaceConfigDialog.jsx` | Der `timeslots_enabled`-Switch wird für Rotation/Custom ausgeblendet. Stattdessen wird direkt der `TimeslotEditor` angezeigt mit Hinweis "Standard-Zeitraum 07:00–15:30". Für Dienste/Demos bleibt der Switch erhalten. |

## Default-Timeslot-Daten

| Feld | Wert |
|------|------|
| `label` | `"Standard"` |
| `start_time` | `'07:00:00'` |
| `end_time` | `'15:30:00'` |
| `order` | `0` |
| `overlap_tolerance_minutes` | `30` (30 Min. Pause) |
| `created_by` | `'migration'` oder `'system'` |

## FTE-Skalierung

Die automatische Teilzeit-Skalierung über `getTimeslotDerivedTimeRange` in `ScheduleBoard.jsx` gilt auch für Default-Timeslots. Beispiel: Bei einem 50%-Mitarbeiter (4h/Tag) wird im Chip `07:00–11:00` angezeigt.

## Bekannte Einschränkungen

1. **Backend-FTE-Skalierung** (`server/routes/master.js` `shiftToInterval`): skaliert nur nach `Workplace.work_time_percentage`, nicht arztindividuell. Diskrepanz zwischen Frontend (FTE-skalierter Chip) und Backend (AP-skalierte Zeitkonto). Separates Refactoring empfohlen.
2. **Cross-Tenant Springerpool**: `shared_workplace_timeslot` wird nicht automatisch mit Default-Timeslots versehen. Separate Betrachtung in zukünftigem Sprint.
