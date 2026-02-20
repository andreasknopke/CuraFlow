# Test-Strategie & Szenarien

CuraFlow besitzt aktuell **keine automatisierten Tests**. Dieses Dokument definiert eine umfassende manuelle und automatisierbare Test-Strategie für externe Entwickler.

---

## Test-Kategorien

| Kategorie | Präfix | Beschreibung |
|---|---|---|
| Authentifizierung | T-AUTH | Login, Rollen, Token |
| Dienstplan | T-SCH | Kernfunktionen des Plans |
| Wunschliste | T-WISH | Wunsch-CRUD, Genehmigungen |
| Urlaub | T-VAC | Urlaubs-Einträge, Konflikte |
| Weiterbildung | T-TRG | Training-Einträge, Transfer |
| Statistiken | T-STAT | Reports, Diagramme, Export |
| Admin | T-ADM | Benutzerverwaltung, Einstellungen |
| Sprachsteuerung | T-VOICE | Mikrofon, Befehle, Agent |
| API | T-API | Backend-Endpunkte direkt testen |
| Performance | T-PERF | Ladezeiten, große Datenmengen |

Einzelne Szenarien je Kategorie sind in den jeweiligen Feature-Dokumenten beschrieben.

---

## Empfohlene Test-Umgebung

### Testdaten anlegen

```sql
-- Testbenutzer
INSERT INTO app_users (email, password_hash, role, full_name, is_active)
VALUES
  ('admin@test.de', '$2a$10$...', 'admin', 'Test Admin', 1),
  ('user@test.de',  '$2a$10$...', 'user',  'Test User',  1),
  ('ro@test.de',    '$2a$10$...', 'readonly', 'Test RO', 1);

-- Testmitarbeitende
INSERT INTO doctors (name, role, `order`, is_active)
VALUES
  ('Alex Müller',  'Senior',      1, 1),
  ('Sam Schmidt',  'Junior',      2, 1),
  ('Chris Weber',  'Teamleitung', 3, 1);

-- Testarbeitsbereiche
INSERT INTO workplaces (name, category, `order`, is_active)
VALUES
  ('Dienst Vordergrund', 'Dienste', 1, 1),
  ('CT',                 'Dienste', 2, 1),
  ('MRT',                'Dienste', 3, 1);
```

Das Standard-Passwort für Testbenutzer kann mit `bcryptjs` generiert werden:

```javascript
const bcrypt = require('bcryptjs');
const hash = bcrypt.hashSync('Test1234!', 10);
console.log(hash); // In INSERT verwenden
```

---

## API-Tests mit curl / HTTP-Client

### Login

```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@test.de","password":"Test1234!"}' \
  | jq .token
```

```bash
# Token in Variable speichern
TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@test.de","password":"Test1234!"}' | jq -r .token)
```

### Mitarbeitende abrufen

```bash
curl -H "Authorization: Bearer $TOKEN" \
     http://localhost:3000/api/db/Doctor | jq .
```

### Diensteintrag erstellen

```bash
curl -X POST http://localhost:3000/api/db/ShiftEntry \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "doctor_id": 1,
    "date": "2024-03-11",
    "workplace": "CT",
    "section": "Dienste"
  }'
```

### Dienste für Woche abrufen

```bash
curl -X POST http://localhost:3000/api/db/ShiftEntry/filter \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "filter": {
      "date": { "$gte": "2024-03-11", "$lte": "2024-03-17" }
    }
  }' | jq .
```

---

## Automatisiertes Testing einrichten

### Empfohlene Tools

| Tool | Verwendung |
|---|---|
| **Vitest** | Unit-Tests für React-Hooks und Hilfsfunktionen |
| **React Testing Library** | Komponenten-Tests |
| **Supertest** | Backend API-Tests (Node.js) |
| **Playwright** | End-to-End Browser-Tests |
| **MSW (Mock Service Worker)** | API-Mocking für Frontend-Tests |

### Installation

```bash
# Frontend
npm install -D vitest @testing-library/react @testing-library/jest-dom msw

# Backend
cd server
npm install -D supertest

# E2E
npm install -D @playwright/test
npx playwright install
```

### Beispiel: Unit-Test für Hilfsfunktion

```javascript
// src/components/schedule/__tests__/staffingUtils.test.js
import { isDoctorAvailable } from '../staffingUtils';
import { describe, it, expect } from 'vitest';

describe('isDoctorAvailable', () => {
  it('returns false when doctor is on vacation', () => {
    const shifts = [{ doctor_id: 1, date: '2024-03-11', workplace: 'Urlaub' }];
    expect(isDoctorAvailable(1, '2024-03-11', shifts)).toBe(false);
  });

  it('returns true when doctor has no shifts', () => {
    expect(isDoctorAvailable(1, '2024-03-11', [])).toBe(true);
  });
});
```

### Beispiel: Backend-API-Test

```javascript
// server/__tests__/auth.test.js
import request from 'supertest';
import app from '../app.js'; // app.js (ohne listen()) exportieren

describe('POST /api/auth/login', () => {
  it('returns 401 with wrong password', async () => {
    const response = await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin@test.de', password: 'wrong' });
    
    expect(response.status).toBe(401);
    expect(response.body.error).toBeDefined();
  });

  it('returns token with correct credentials', async () => {
    const response = await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin@test.de', password: 'Test1234!' });
    
    expect(response.status).toBe(200);
    expect(response.body.token).toBeDefined();
  });
});
```

### Beispiel: Playwright E2E-Test

```javascript
// e2e/login.spec.js
import { test, expect } from '@playwright/test';

test('Login-Flow', async ({ page }) => {
  await page.goto('http://localhost:5173');
  
  // Weiterleitung zur Login-Seite
  await expect(page).toHaveURL(/AuthLogin/);
  
  // Login
  await page.fill('input[type="email"]', 'admin@test.de');
  await page.fill('input[type="password"]', 'Test1234!');
  await page.click('button[type="submit"]');
  
  // Weiterleitung nach Login
  await expect(page).not.toHaveURL(/AuthLogin/);
  await expect(page.locator('text=Dienstplan')).toBeVisible();
});

test('Dienstplan laden', async ({ page }) => {
  // ... Login zuerst ...
  await page.goto('http://localhost:5173/Schedule');
  
  // Dienstplan-Tabelle sichtbar
  await expect(page.locator('[data-testid="schedule-board"]')).toBeVisible();
});
```

---

## Performance-Tests

### T-PERF-01: Dienstplan mit 200 Einträgen

```
Vorbereitung: 200 shift_entries für aktuelle Woche einfügen
Messung: Ladezeit der Schedule-Seite (Network-Tab in DevTools)
Akzeptanzgrenze: < 2 Sekunden bis Anzeige
```

### T-PERF-02: Statistiken mit 5000 Einträgen

```
Vorbereitung: 5000 shift_entries für das Jahr einfügen
Messung: Ladezeit + React-Rendering (React DevTools Profiler)
Akzeptanzgrenze: < 5 Sekunden, kein Browser-Freeze
```

### T-PERF-03: Gleichzeitige API-Requests

```bash
# Benchmark mit Apache Bench
ab -n 100 -c 10 -H "Authorization: Bearer $TOKEN" \
   http://localhost:3000/api/db/Doctor

# Erwartung: p95 < 200ms
```

---

## Checkliste vor einem Release

- [ ] Alle CRUD-Operationen für `ShiftEntry`, `Doctor`, `Workplace` funktionieren
- [ ] Login mit Admin, User und Readonly funktioniert korrekt
- [ ] Drag-and-Drop im Dienstplan funktioniert (Desktop+Mobile)
- [ ] Undo-Funktion bringt letzten Eintrag zurück
- [ ] Export (Excel) lädt ohne Fehler herunter
- [ ] Admin kann neuen Benutzer anlegen + Passwort setzen
- [ ] Wunschliste: Eintragen → Genehmigen → Status geändert
- [ ] Urlaubsplanung: Eintragen → im Dienstplan sichtbar
- [ ] Rate-Limiting aktiv (> 10 Logins → 429)
- [ ] ENV-Variablen vollständig dokumentiert
- [ ] Keine sensiblen Daten (Passwörter, JWT-Secret) in Logs
