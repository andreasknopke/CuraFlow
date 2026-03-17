# API-Referenz

Alle API-Endpunkte des Express-Backends. Basis-URL: `http://localhost:3000` (Entwicklung) bzw. konfigurierte `VITE_API_URL`.

**Authentifizierung:** Alle Endpunkte außer Login/Register erfordern einen gültigen JWT im Header:
```
Authorization: Bearer <token>
```

**Multi-Tenant:** Mandantenspezifische Anfragen benötigen zusätzlich:
```
X-DB-Token: <encrypted-db-token>
```

---

## Authentifizierung (`/api/auth`)

| Methode | Endpunkt | Auth? | Beschreibung |
|---|---|---|---|
| POST | `/api/auth/login` | ❌ | Login mit E-Mail + Passwort |
| POST | `/api/auth/register` | ❌ | Neuen Benutzer registrieren |
| GET | `/api/auth/me` | ✅ | Aktuellen Benutzer abrufen |
| PATCH | `/api/auth/me` | ✅ | Eigene Benutzerdaten aktualisieren |
| POST | `/api/auth/change-password` | ✅ | Passwort ändern |
| POST | `/api/auth/force-change-password` | ✅ | Passwort ändern (erzwungen) |
| POST | `/api/auth/change-email` | ✅ | E-Mail-Adresse ändern |
| GET | `/api/auth/my-tenants` | ✅ | Eigene Mandanten abrufen |
| POST | `/api/auth/activate-tenant/:id` | ✅ | Mandanten-Token aktivieren |
| GET | `/api/auth/events/stream` | ✅ | SSE-Stream für Realtime-Planupdates |

### Admin-Endpunkte (Rolle: `admin`)

| Methode | Endpunkt | Beschreibung |
|---|---|---|
| GET | `/api/auth/users` | Alle Benutzer auflisten |
| PATCH | `/api/auth/users/:id` | Benutzer aktualisieren |
| DELETE | `/api/auth/users/:id` | Benutzer deaktivieren |
| POST | `/api/auth/users/:id/reset-password` | Passwort zurücksetzen |

### Login – Request/Response

```http
POST /api/auth/login
Content-Type: application/json

{
  "email": "max@example.com",
  "password": "geheim123"
}
```

### Realtime-Planupdates per SSE

```http
GET /api/auth/events/stream?access_token=<jwt>&db_token=<optional-db-token>
Accept: text/event-stream
```

Hinweise:

- `access_token` ist verpflichtend und enthält das normale JWT aus dem Login.
- `db_token` ist für Department-Frontends mit aktivem Mandantenkontext erforderlich.
- Die Verbindung bleibt offen und liefert Events vom Typ `connected` und `plan-update`.

Beispiel:

```text
event: plan-update
data: {"entity":"ShiftEntry","action":"bulkCreate","recordId":null,"recordCount":1,"changedAt":"2026-03-17T12:00:00.000Z","actor":{"id":"...","email":"admin@example.com"}}
```

```json
// Response 200
{
  "token": "eyJhbGciOiJIUzI1NiJ9...",
  "user": {
    "id": 1,
    "email": "max@example.com",
    "full_name": "Dr. Max Mustermann",
    "role": "admin",
    "doctor_id": 5
  }
}
```

---

## Generischer CRUD-Proxy (`/api/db`)

Alle Standardoperationen (CRUD) laufen über einen generischen Proxy. Unterstützte Entitäten:

`Doctor`, `Workplace`, `ShiftEntry`, `WishRequest`, `StaffingPlanEntry`, `SystemSetting`, `ColorSetting`, `TeamRole`, `WorkplaceTimeslot`, `TimeslotTemplate`, `SectionConfig`

| Methode | Endpunkt | Beschreibung |
|---|---|---|
| GET | `/api/db/:entity` | Alle Datensätze abrufen |
| GET | `/api/db/:entity/:id` | Einzelnen Datensatz abrufen |
| POST | `/api/db/:entity` | Datensatz erstellen |
| PATCH | `/api/db/:entity/:id` | Datensatz aktualisieren |
| DELETE | `/api/db/:entity/:id` | Datensatz löschen |
| POST | `/api/db/:entity/filter` | Mit Filter abrufen |

### Filter-Syntax

```http
POST /api/db/ShiftEntry/filter
Content-Type: application/json

{
  "filter": {
    "date": { "$gte": "2024-01-01", "$lte": "2024-01-31" },
    "workplace": "CT"
  },
  "orderBy": "date",
  "limit": 500
}
```

Unterstützte Operatoren: `$gte`, `$lte`, `$gt`, `$lt`, `$eq`, `$ne`, `$in`

---

## Dienstplan (`/api/schedule`)

| Methode | Endpunkt | Beschreibung |
|---|---|---|
| POST | `/api/schedule/generate` | KI-gestützte Dienstplan-Generierung |
| POST | `/api/schedule/export-excel` | Dienstplan als Excel exportieren |
| POST | `/api/schedule/send-emails` | Dienstplan per E-Mail versenden |
| POST | `/api/schedule/export-pdf` | Dienstplan als PDF exportieren |
| GET | `/api/schedule/:year/:month` | Dienstplan für Monat abrufen |

### Dienstplan generieren

```http
POST /api/schedule/generate
Authorization: Bearer <token>
Content-Type: application/json

{
  "year": 2024,
  "month": 3,
  "rules": {
    "maxShiftsPerDoctor": 8,
    "respectWishes": true,
    "respectVacations": true
  }
}
```

---

## Mitarbeiter (`/api/staff`)

| Methode | Endpunkt | Beschreibung |
|---|---|---|
| GET | `/api/staff/doctors` | Alle Mitarbeitenden abrufen |
| GET | `/api/staff/staffing-plan` | Stellenplan abrufen |
| POST | `/api/staff/staffing-plan` | Stellenplan-Eintrag speichern |
| GET | `/api/staff/availability/:doctorId/:year/:month` | Verfügbarkeit berechnen |

---

## Feiertage (`/api/holidays`)

| Methode | Endpunkt | Beschreibung |
|---|---|---|
| GET | `/api/holidays/:state/:year` | Feiertage für Bundesland |

```http
GET /api/holidays/MV/2024
```

Gibt öffentliche Feiertage u. Schulferien für Mecklenburg-Vorpommern zurück.

---

## Kalender-Sync (`/api/calendar`)

| Methode | Endpunkt | Beschreibung |
|---|---|---|
| POST | `/api/calendar/sync` | Mit externem Kalender synchronisieren |
| GET | `/api/calendar/export/:doctorId` | ICS-Datei für Mitarbeiter exportieren |

---

## Sprachsteuerung (`/api/voice`)

| Methode | Endpunkt | Beschreibung |
|---|---|---|
| POST | `/api/voice/transcribe` | Audio → Text (ElevenLabs STT) |
| POST | `/api/voice/command` | Sprachbefehl verarbeiten |

---

## Admin (`/api/admin`)

| Methode | Endpunkt | Auth (admin) | Beschreibung |
|---|---|---|---|
| GET | `/api/admin/logs` | ✅ | System-Logs abrufen |
| POST | `/api/admin/db/backup` | ✅ | Datenbank-Backup erstellen |
| POST | `/api/admin/db/migrate` | ✅ | Migrationen ausführen |
| GET | `/api/admin/tokens` | ✅ | Server-Tokens auflisten |
| POST | `/api/admin/tokens` | ✅ | Neues DB-Token erstellen |
| DELETE | `/api/admin/tokens/:id` | ✅ | DB-Token löschen |

---

## Atomare Operationen (`/api/atomic`)

Batch-Operationen für komplexe Transaktionen (z.B. mehrere Diensteinträge auf einmal).

```http
POST /api/atomic/batch
Authorization: Bearer <token>
Content-Type: application/json

{
  "operations": [
    { "type": "create", "entity": "ShiftEntry", "data": { ... } },
    { "type": "delete", "entity": "ShiftEntry", "id": 42 },
    { "type": "update", "entity": "ShiftEntry", "id": 43, "data": { ... } }
  ]
}
```

---

## Fehler-Antworten

Alle Fehler folgen dem Schema:

```json
{
  "error": "Fehlermeldung für den Client",
  "details": "Optionale technische Details"
}
```

| HTTP-Status | Bedeutung |
|---|---|
| 400 | Ungültige Eingabe / fehlende Parameter |
| 401 | Nicht authentifiziert (Token fehlt/abgelaufen) |
| 403 | Keine Berechtigung (falsche Rolle) |
| 404 | Ressource nicht gefunden |
| 409 | Konflikt (z.B. doppelter Eintrag) |
| 500 | Interner Serverfehler |

---

## Rate Limiting

- **Standard:** 100 Requests / 15 Minuten pro IP
- **Login-Endpunkt:** 10 Versuche / 15 Minuten pro IP
- Bei Überschreitung: HTTP 429 mit `Retry-After` Header
