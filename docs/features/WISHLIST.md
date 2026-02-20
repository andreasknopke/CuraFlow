# Feature: Wunschliste (WishList)

---

## Funktionsumfang

- Mitarbeiter können **Dienstwünsche** für bestimmte Tage eintragen
- Wünsche können sein: bestimmter Dienst gewünscht, frei gewünscht, Urlaub gewünscht
- **Jahresübersicht** je Mitarbeiter (Kalenderansicht)
- **Monatsübersicht** aller Mitarbeitenden
- **Genehmigung/Ablehnung** durch Administratoren
- **E-Mail-Erinnerungen** vor Deadline automatisch versandt
- **Wunscherfüllungs-Statistik** (in Statistics-Feature auswertbar)
- **Feiertags- und Schulferienanzeige** im Kalender
- **Tabs je Dienst-Kategorie** (Dienste, Sonstiges etc.)
- **Per-Mitarbeiter-Filter**: Nicht-Admins sehen nur eigene Wünsche

---

## Implementierung

### Relevante Dateien

| Datei | Funktion |
|---|---|
| `src/pages/WishList.jsx` | Hauptseite: State, Datenabfragen, Layout |
| `src/components/wishlist/WishYearView.jsx` | Jahreskalender-Darstellung |
| `src/components/wishlist/WishMonthOverview.jsx` | Monatsübersicht aller Mitarbeitenden |
| `src/components/wishlist/WishRequestDialog.jsx` | Dialog zum Eintragen/Bearbeiten eines Wunsches |
| `src/components/wishlist/WishReminderStatus.jsx` | Anzeige Erinnerungs-Status |
| `src/components/useHolidays.jsx` | Feiertags-Hook (shared mit Vacation, Schedule) |
| `src/components/settings/TeamRoleSettings.jsx` | Rollen-Prioritäten (für Sortierung) |
| `server/utils/wishReminder.js` | Automatische Erinnerungs-E-Mails |
| `server/routes/schedule.js` | Wunsch-bezogene API-Endpunkte |

### Datenbankentitäten

| Tabelle | Verwendung |
|---|---|
| `wish_requests` | Alle Wünsche (doctor_id, date, wish_type, status) |
| `doctors` | Mitarbeiterliste für Auswahl und Sortierung |
| `workplaces` | Dienst-Kategorien für Tabs |
| `system_settings` | Konfiguration (z.B. Wish-Deadline) |

### Komponenten-Hierachie

```
WishList.jsx (State-Container)
├── Tabs (je Dienst-Kategorie aus workplaces)
│   ├── WishYearView  ← viewMode='year'  (default)
│   │   └── Kalender-Grid (12 Monate × 31 Tage)
│   │       └── Klick → WishRequestDialog
│   └── WishMonthOverview ← viewMode='month'
│       └── Tabelle (Mitarbeitende × Tage)
└── WishRequestDialog (Popup)
    ├── Wunsch-Typ auswählen
    ├── Dienst wählen (optional)
    ├── Notiz hinzufügen
    └── Speichern → wish_requests.create/update
```

### Wunsch-Status-Flow

```
┌─────────┐    Admin genehmigt    ┌──────────┐
│ pending │ ─────────────────────>│ approved │
└─────────┘                       └──────────┘
     │          Admin ablehnt     ┌──────────┐
     └─────────────────────────> │ rejected │
                                  └──────────┘
```

### Automatische Erinnerungs-E-Mails

`server/utils/wishReminder.js` wird regelmäßig via `setInterval` im Backend aufgerufen:

```javascript
// server/index.js
setInterval(() => checkAndSendWishReminders(), 24 * 60 * 60 * 1000); // täglich
```

Die Funktion prüft, ob Wunsch-Deadlines bald ablaufen, und versendet über Nodemailer E-Mails an Mitarbeitende ohne eingetragene Wünsche.

---

## Erweiterungen entwickeln

### Neuen Wunsch-Typ hinzufügen

In `WishRequestDialog.jsx` die `WISH_TYPES`-Liste erweitern:

```jsx
const WISH_TYPES = [
  { value: 'Dienst', label: 'Dienst gewünscht' },
  { value: 'Frei', label: 'Frei gewünscht' },
  { value: 'Urlaub', label: 'Urlaub' },
  { value: 'HomeOffice', label: 'Home Office' }, // NEU
];
```

### Wunsch-Priorisierung ergänzen

Die `wish_requests`-Tabelle um ein `priority`-Feld erweitern (Migration), dann in der UI und im Statistik-Report nutzen.

---

## Test-Szenarien

### T-WISH-01: Wunsch eintragen (Benutzer)

```
Voraussetzung: Login als normaler Benutzer mit verknüpftem Mitarbeiter
Aktion: Auf ein Datum in der Jahresansicht klicken
Erwartet:
  - WishRequestDialog öffnet sich
  - Nach Ausfüllen + Speichern: wish_request in DB (status='pending')
  - Datum im Kalender visuell markiert
```

### T-WISH-02: Wunsch genehmigen (Admin)

```
Voraussetzung: Mindestens 1 Wunsch im Status 'pending'
Aktion: Admin klickt auf Wunsch → "Genehmigen"
Erwartet:
  - Status ändert sich auf 'approved'
  - Farbe/Icon in Kalender ändert sich
```

### T-WISH-03: Nicht-Admin sieht nur eigene Wünsche

```
Voraussetzung: User A und User B haben Wünsche eingetragen
Aktion: Login als User A
Erwartet:
  - Nur Wünsche von User As verknüpftem Mitarbeiter sichtbar
  - Kein Dropdown zur Mitarbeiter-Auswahl vorhanden (oder deaktiviert)
```

### T-WISH-04: Monatsübersicht

```
Aktion: Ansicht auf "Monat" umschalten
Erwartet:
  - Tabelle zeigt alle Mitarbeitenden × Tage des Monats
  - Wünsche farblich markiert (pending=gelb, approved=grün, rejected=rot)
```

### T-WISH-05: Wunsch löschen

```
Aktion: Benutzer klickt auf bestehenden Wunsch → "Löschen"
Erwartet:
  - Bestätigungsdialog erscheint
  - Nach Bestätigung: wish_request aus DB gelöscht
  - Kalender-Markierung verschwindet
```

### T-WISH-06: Erinnerungs-E-Mail

```
Voraussetzung: SMTP konfiguriert, Mitarbeiter ohne Wünsche für Deadline-Monat
Aktion: checkAndSendWishReminders() manuell aufrufen
Erwartet:
  - E-Mail an SMTP-Server gesendet
  - Keine doppelten E-Mails
```
