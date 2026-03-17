# Systemarchitektur

## Überblick

CuraFlow folgt einer klassischen **Client-Server-Architektur**. Das Frontend (React SPA) kommuniziert ausschließlich über eine REST-API mit dem Backend (Express). Die gesamten Anwendungsdaten liegen in einer MySQL-Datenbank.

```
┌──────────────────────────────────────────────────────────────┐
│                        Browser (Client)                      │
│                                                              │
│   React SPA ── TanStack Query ─── REST Calls (fetch)        │
│        ├────────────── Server-Sent Events (Planupdates)     │
│        │                                                     │
│   React Router (SPA-Navigation, keine Server-Roundtrips)    │
└──────────────────────┬───────────────────────────────────────┘
                       │  HTTPS / JSON
                       ▼
┌──────────────────────────────────────────────────────────────┐
│               Express Backend (Node.js 18+)                  │
│                                                              │
│  Middleware-Stack:                                           │
│  cors → helmet → compression → express.json →               │
│  tenantDbMiddleware → authMiddleware → routeHandler          │
│                                                              │
│  Routes:                                                     │
│  /api/auth     → auth.js       (Login, Register, Users, SSE)│
│  /api/db       → dbProxy.js    (CRUD-Proxy für Entitäten)   │
│  /api/schedule → schedule.js   (Dienstplan-Spezial-Ops)     │
│  /api/staff    → staff.js      (Mitarbeiter-APIs)           │
│  /api/holidays → holidays.js   (Feiertage-API)              │
│  /api/calendar → calendar.js   (Kalender-Sync)              │
│  /api/voice    → voice.js      (Sprachsteuerung)            │
│  /api/admin    → admin.js      (Admin-Ops)                  │
│  /api/atomic   → atomic.js     (Batch-Operationen)          │
└──────────────────────┬───────────────────────────────────────┘
                       │  mysql2 (Connection Pool)
                       ▼
┌──────────────────────────────────────────────────────────────┐
│                  MySQL 8 (Primäre DB)                        │
│                                                              │
│  Haupt-Tabellen:                                             │
│  app_users, doctors, workplaces, shift_entries,              │
│  wish_requests, system_settings, team_roles,                 │
│  workplace_timeslots, server_tokens, ...                     │
└──────────────────────────────────────────────────────────────┘
```

---

## Multi-Tenant-Architektur

CuraFlow unterstützt **mehrere Mandanten** (z.B. verschiedene Abteilungen oder Krankenhäuser) über einen einzigen Backend-Server. Jeder Mandant besitzt eine eigene MySQL-Datenbank.

### Funktionsweise

1. Beim Login erhält der Browser ein **JWT-Token** (Authentifizierung) sowie ein optionales **DB-Token** (Datenbankauswahl).
2. Das DB-Token ist ein verschlüsseltes JSON-Objekt mit MySQL-Zugangsdaten für die mandantenspezifische DB.
3. Jeder API-Request sendet das DB-Token im Header `X-DB-Token`.
4. Die Middleware `tenantDbMiddleware` (`server/index.js`) entschlüsselt das Token und wählt den passenden Connection-Pool.

```javascript
// server/index.js – vereinfacht
export const tenantDbMiddleware = (req, res, next) => {
  const dbToken = req.headers['x-db-token'];
  req.db = getTenantDb(dbToken); // Korrekte DB für diesen Mandanten
  next();
};
```

### Relevante Dateien

| Datei | Funktion |
|---|---|
| `server/index.js` | `getTenantDb()`, `tenantPools` Cache, Middleware |
| `server/utils/crypto.js` | DB-Token verschlüsseln/entschlüsseln |
| `src/components/dbTokenStorage.jsx` | DB-Token im Browser speichern |
| `src/api/client.js` | DB-Token an alle Requests anhängen |
| `src/components/admin/ServerTokenManager.jsx` | Tokens verwalten (Admin-UI) |

### Realtime-Updates im Multi-Tenant-Betrieb

Offene Department-Frontends erhalten Planänderungen per Server-Sent Events.

1. Das Frontend baut nach erfolgreichem Login einen Stream zu `/api/auth/events/stream` auf.
2. Das JWT wird als `access_token` übergeben.
3. Falls ein Department-DB-Token aktiv ist, wird dieses zusätzlich als `db_token` übergeben.
4. Das Backend bildet daraus einen tenant-spezifischen Scope-Hash.
5. Schreiboperationen in `dbProxy.js` und `atomic.js` senden `plan-update`-Events an genau diesen Scope.
6. Das Frontend invalidiert daraufhin gezielt die betroffenen TanStack-Query-Keys.

Relevante Dateien:

| Datei | Funktion |
|---|---|
| `src/components/PlanUpdateListener.jsx` | Globaler SSE-Listener für das Department-Frontend |
| `src/App.jsx` | Hängt den Realtime-Listener global an die Department-App |
| `server/routes/auth.js` | Endpoint `GET /api/auth/events/stream` |
| `server/utils/realtime.js` | Client-Registry, Broadcast und Keepalive |
| `server/routes/dbProxy.js` | Broadcast bei generischen CRUD-Änderungen |
| `server/routes/atomic.js` | Broadcast bei atomaren Planänderungen |

Wichtige Details:

- Der Stream ist JWT-basiert. Ein aktives Department-Token allein genügt nicht.
- Der Stream wird erst aufgebaut, wenn der Auth-Check abgeschlossen ist und tatsächlich ein JWT vorliegt.
- Für den SSE-Endpoint ist HTTP-Kompression deaktiviert, damit Events nicht gepuffert werden.
- Nach jedem Event und Keepalive wird explizit geflusht.

---

## Frontend-Architektur

### State-Management

CuraFlow verwendet **kein globales State-Management** (kein Redux/Zustand). Stattdessen:

- **TanStack Query** für Server-State (alle Datenbankdaten): caching, invalidation, optimistic updates
- **React Context** für Auth-State (`AuthProvider`)
- **Component-local `useState`** für UI-State

### Datenbankabstraktion (`src/api/client.js`)

Der `db`-Namespace gegenüber dem Backend abstrahiert alle CRUD-Operationen:

```javascript
// Lesen
const doctors = await db.Doctor.list();
const shifts = await db.ShiftEntry.filter({ date: { $gte: '2024-01-01' } });

// Schreiben
const newShift = await db.ShiftEntry.create({ doctor_id: 1, date: '2024-01-15', ... });
await db.ShiftEntry.update(id, { workplace: 'CT' });
await db.ShiftEntry.delete(id);
```

Hinter `db.Doctor`, `db.ShiftEntry` etc. steht jeweils eine `createEntityApi(entityName)`-Factory, die HTTP-Requests an `/api/db/:entity` baut.

### Realtime-Invalidierung im Frontend

Der Realtime-Listener hält keine eigene Schattenkopie des Plans. Stattdessen invalidiert er bei eingehenden `plan-update`-Events die betroffenen Query-Keys, zum Beispiel:

- `ShiftEntry` → `['shifts']`, `['shifts-history']`
- `ScheduleNote` → `['scheduleNotes']`
- `StaffingPlanEntry` → `['staffingPlanEntries']`
- `Doctor`, `Workplace`, `WorkplaceTimeslot` → planrelevante Stammdatenqueries

### Routing

```
/              → Home.jsx         (Weiterleitung oder Startseite)
/Schedule      → Schedule.jsx     (Dienstplanansicht)
/MyDashboard   → MyDashboard.jsx  (Persönliches Dashboard)
/WishList      → WishList.jsx     (Wunschliste)
/Vacation      → Vacation.jsx     (Urlaubsplanung)
/Training      → Training.jsx     (Weiterbildungsplanung)
/Staff         → Staff.jsx        (Mitarbeiterverwaltung)
/Statistics    → Statistics.jsx   (Statistiken)
/Admin         → Admin.jsx        (Adminbereich)
/Help          → Help.jsx         (Hilfe/Manual)
/DataImport    → DataImport.jsx   (Datenimport)
/ServiceStaffing → ServiceStaffing.jsx (Stellenplan)
/AuthLogin     → AuthLogin.jsx    (Login-Seite)
```

Routing-Konfiguration: `src/pages.config.js`

---

## Backend-Architektur

### Middleware-Reihenfolge

```javascript
app.use(cors(corsConfig));         // 1. CORS
app.use(helmet(...));              // 2. Security Headers
app.use(rateLimit(...));           // 3. Rate Limiting (100 req/15min)
app.use(compression());            // 4. GZIP
app.use(express.json());           // 5. Body Parsing
app.use(tenantDbMiddleware);       // 6. Mandanten-DB auswählen
// Danach routen-spezifisch:
// authMiddleware (JWT prüfen)
// adminMiddleware (Admin-Rolle prüfen)
```

### Datenbankzugriff in Routen

```javascript
// Jeder Route-Handler erhält req.db (mandantenspezifischer Pool)
router.get('/doctors', authMiddleware, async (req, res) => {
  const [rows] = await req.db.execute('SELECT * FROM doctors ORDER BY `order`');
  res.json(rows);
});
```

### CRUD-Proxy (`server/routes/dbProxy.js`)

Für Standardoperationen existiert ein generischer CRUD-Proxy. Tabellen-Map und erlaubte Felder sind darin konfiguriert. Dadurch müssen keine separaten Routen für jede Entität geschrieben werden.

### Sentinel für ShiftEntry-Duplikate

Beim Erstellen von `ShiftEntry`-Datensätzen prüft ein Sentinel, ob ein Arbeitsplatz Mehrfachbelegung zulässt.

- Die Workplace-Metadaten werden tenant-spezifisch gecacht.
- Ältere Department-Datenbanken ohne Spalte `allows_multiple` werden unterstützt.
- Wenn die Spalte fehlt, fällt die Logik auf die Workplace-Kategorie zurück.
- Dadurch verschwinden Warnungen wie `Unknown column 'allows_multiple'` bei Legacy-Schemas.

---

## Build & Deployment

```
Frontend:    npm run build  →  dist/
             Statische Dateien werden vom Express-Server serviert
             (oder separat auf einem CDN deployed)

Backend:     node server/index.js
             Umgebungsvariablen: MYSQL_HOST, MYSQL_USER,
             MYSQL_PASSWORD, MYSQL_DATABASE, JWT_SECRET, PORT

Railway:     server/railway.json + server/nixpacks.toml
             definieren den Build-/Start-Prozess
```

Für detaillierte Deployment-Anweisungen: [RAILWAY_DEPLOYMENT.md](../RAILWAY_DEPLOYMENT.md)
