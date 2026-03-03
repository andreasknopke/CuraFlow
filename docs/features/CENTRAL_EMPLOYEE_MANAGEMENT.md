# Konzept: Zentrale Mitarbeiterverwaltung

> **Stand:** März 2026  
> **Status:** Entwurf  
> **Bezug:** [TIMETRACKING_GAP_ANALYSIS.md](TIMETRACKING_GAP_ANALYSIS.md), [TIMETRACKING.md](TIMETRACKING.md)

---

## Problemstellung

### Ist-Zustand

```
Central DB (Master)              Tenant DB (z.B. Radiologie)
┌────────────────────┐           ┌─────────────────────────┐
│ app_users          │           │ Doctor                  │
│ db_tokens          │           │ ├─ id (VARCHAR)         │
│ TeamRole           │           │ ├─ name                 │
│                    │           │ ├─ role                 │
│  ❌ Keine Employee │           │ ├─ fte                  │
│     Tabelle!       │           │ ├─ email                │
│                    │           │ ├─ exclude_from_        │
│                    │           │ │  staffing_plan        │
│                    │           │ └─ ...                  │
│                    │           │                         │
│                    │           │ ShiftEntry              │
│                    │           │ StaffingPlanEntry       │
│                    │           │ ...                     │
└────────────────────┘           └─────────────────────────┘
```

**Probleme:**
1. Jeder Mandant pflegt Mitarbeiter-Stammdaten **eigenständig** – keine zentrale Quelle
2. Ein Mitarbeiter, der in 2 Abteilungen arbeitet, existiert als **2 unverknüpfte Datensätze**
3. HR-Felder (Personalnummer, Vertragsdaten, Adresse) haben **keinen definierten Ort**
4. Das Master-Frontend aggregiert Daten **zur Laufzeit** aus allen Tenants – langsam, inkonsistent
5. Soll-Stunden, Zeitkonten und Monatsabschluss brauchen eine **zuverlässige zentrale Identität**
6. Schema-Unterschiede zwischen Tenants erzwingen `INFORMATION_SCHEMA`-Hacks

### Soll-Zustand

```
Central DB (Master)              Tenant DB (z.B. Radiologie)
┌─────────────────────────┐      ┌─────────────────────────┐
│ app_users               │      │ Doctor                  │
│ db_tokens               │      │ ├─ id (VARCHAR)         │
│ TeamRole                │      │ ├─ central_employee_id ─┼──┐
│                         │      │ ├─ name (Kopie/Cache)   │  │
│ Employee (NEU)          │◄─────┤ ├─ role (lokal)         │  │
│ ├─ id (UUID)        ────┼──────┼─┘ ├─ fte (lokal)       │  │
│ ├─ payroll_id           │      │ ├─ qualifikationen      │  │
│ ├─ last_name            │      │ ├─ order (lokal)        │  │
│ ├─ first_name           │      │ └─ ...                  │  │
│ ├─ former_name          │      │                         │  │
│ ├─ email                │      │ ShiftEntry              │  │
│ ├─ phone                │      │ StaffingPlanEntry       │  │
│ ├─ address              │      └─────────────────────────┘  │
│ ├─ contract_type        │                                    │
│ ├─ contract_start       │      Tenant DB (z.B. Chirurgie)   │
│ ├─ contract_end         │      ┌─────────────────────────┐  │
│ ├─ target_hours_per_week│      │ Doctor                  │  │
│ ├─ vacation_days_annual │      │ ├─ id (VARCHAR)         │  │
│ ├─ is_active            │      │ ├─ central_employee_id ─┼──┘
│ ├─ notes                │      │ ├─ name (Kopie/Cache)   │
│ └─ ...                  │      │ ├─ role (lokal)         │
│                         │      │ └─ ...                  │
│ TimeAccount (NEU)       │      └─────────────────────────┘
│ ├─ employee_id          │
│ ├─ year, month          │
│ ├─ target/actual/balance│
│ └─ ...                  │
└─────────────────────────┘
```

---

## Architekturentscheidungen

### 1. Was wird zentral, was bleibt lokal?

| Datenfeld | Zentral (Employee) | Lokal (Doctor) | Begründung |
|-----------|:------------------:|:--------------:|------------|
| Name | ✅ (führend) | ✅ (Cache) | Zentral gepflegt, lokal als Kopie. Async-Sync über Notification + manuellen Button |
| Personalnummer (`payroll_id`) | ✅ | – | Nur HR relevant |
| E-Mail | ✅ (primär) | ✅ (Benachrichtigungs-E-Mail) | Kann abweichen (private vs. dienstliche) |
| Telefon, Adresse | ✅ | – | Nur HR relevant |
| Geburtsdatum | ✅ | – | Nur HR relevant |
| Vertragsbeginn/-ende | ✅ | – | Zentral verwaltet |
| Vertragsart (VZ/TZ/Mini) | ✅ | – | Zentral verwaltet |
| Soll-Stunden/Woche | ✅ | – | Kommt aus Vertrag, nicht aus Abteilung |
| Jahresurlaub (Anspruch) | ✅ | – | Kommt aus Vertrag |
| `is_active` | ✅ | – | Zentral: aktiver Mitarbeiter der Organisation |
| Rolle (Chefarzt, FA, ...) | – | ✅ | Kann pro Abteilung unterschiedlich sein |
| FTE / VK-Anteil (pro Abt.) | – | ✅ | Abteilungsspezifisch |
| Qualifikationen | – | ✅ | Abteilungsspezifisch (welche Geräte etc.) |
| Reihenfolge (`order`) | – | ✅ | Abteilungsspezifisch |
| Farbe | – | ✅ | Abteilungsspezifisch |
| Kürzel (`initials`) | – | ✅ | Abteilungsspezifisch |
| Stellenplan-Ausschluss | – | ✅ | Abteilungsspezifisch |
| Schichteinträge | – | ✅ | Leben in Tenant-DB |

### 2. Verknüpfung: `central_employee_id`

Neues Feld auf der Tenant-Tabelle `Doctor`:

```sql
ALTER TABLE Doctor ADD COLUMN central_employee_id VARCHAR(36) DEFAULT NULL;
```

| Wert | Bedeutung |
|------|-----------|
| `UUID` | Verknüpft mit zentralem Mitarbeiter → **wird in Zeiterfassung berücksichtigt** |
| `NULL` | Lokaler/externer Mitarbeiter → **wird in zentraler Zeiterfassung ignoriert** |

**Regel:** `central_employee_id IS NULL` ersetzt die alte Intention von `excluded_from_statistics` für den Zeiterfassungskontext.

### 3. Datenflusrichtung

```
                   Stammdaten (Name, Vertrag, Soll-Stunden)
Master ──────────────────────────────────────────────────────▸ Tenant
(Employee)         Asynchron: Änderungs-Notification            (Doctor.name)
                   + manueller Sync-Button im Mandanten

                   Ist-Daten (Arbeitszeiten, Abwesenheiten)
Master ◂──────────────────────────────────────────────────── Tenant
(TimeAccount)      Pull / Aggregation bei Abfrage              (ShiftEntry)
```

- **Master → Tenant (asynchron):**
  1. HR ändert Stammdaten im Master-Frontend
  2. Betroffene Mandanten-Admins erhalten eine **Benachrichtigung** (In-App + optional E-Mail): _"Stammdaten von Dr. Müller wurden aktualisiert"_
  3. Mandanten-Admin klickt auf **"Stammdaten synchronisieren"** (analog zum bestehenden Stellenplan-Sync)
  4. Sync aktualisiert `Doctor.name` und andere Cache-Felder in der Tenant-DB
- **Tenant → Master:** Nur Lesen – Ist-Stunden werden aus `shift_entries` berechnet, nie kopiert

> **Warum asynchron?** Der Mandanten-Admin soll die Kontrolle behalten. Eine automatische Namensänderung im laufenden Dienstplan könnte verwirrend sein. Der Sync-Button-Ansatz ist bereits aus dem Stellenplan-Sync bekannt und etabliert.

---

## Datenmodell

### Zentrale Tabelle: `Employee`

```sql
CREATE TABLE IF NOT EXISTS Employee (
    id VARCHAR(36) PRIMARY KEY,           -- UUID
    payroll_id VARCHAR(50),               -- Personalnummer (f. Loga-Export), editierbar
    last_name VARCHAR(200) NOT NULL,      -- Nachname (aus Doctor.name übernommen)
    first_name VARCHAR(100),              -- Vorname (nachträglich durch HR pflegbar)
    former_name VARCHAR(200),             -- Früherer Name (z.B. Geburtsname bei Hochzeit)
    date_of_birth DATE,
    email VARCHAR(255),
    phone VARCHAR(50),
    address TEXT,
    
    -- Vertragsdaten
    contract_type ENUM('vollzeit', 'teilzeit', 'minijob', 'werkstudent', 'praktikant', 'honorar') DEFAULT 'vollzeit',
    contract_start DATE,
    contract_end DATE,                    -- NULL = unbefristet
    probation_end DATE,
    target_hours_per_week DECIMAL(4,1) DEFAULT 38.5,
    vacation_days_annual INT DEFAULT 30,
    
    -- Status
    is_active BOOLEAN DEFAULT TRUE,       -- Soft-Delete: false = ausgeschieden
    exit_date DATE,                       -- Austrittsdatum
    exit_reason VARCHAR(255),
    
    -- Metadaten
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME ON UPDATE CURRENT_TIMESTAMP,
    created_by VARCHAR(255),
    
    INDEX idx_payroll (payroll_id),
    INDEX idx_active (is_active),
    INDEX idx_name (last_name, first_name)
);
```

> **Zum Namensformat:** `Doctor.name` wird 1:1 als `Employee.last_name` übernommen – so wie die Abteilungen es aktuell pflegen (das Feld enthält in der Praxis den Nachnamen, oft mit Titel). `first_name` und `former_name` werden bei der Migration leer gelassen und können von HR im Master-Frontend nachgepflegt werden. Kein Namens-Parsing nötig.

### Tenant-Erweiterung: `Doctor`

```sql
-- Migration: Zentrale Verknüpfung
ALTER TABLE Doctor ADD COLUMN central_employee_id VARCHAR(36) DEFAULT NULL;
ALTER TABLE Doctor ADD INDEX idx_central_employee (central_employee_id);
```

### Zentrale Tabelle: `EmployeeTenantAssignment`

Optionale Tracking-Tabelle in der Central DB – dokumentiert, in welchen Mandanten ein Mitarbeiter eingeteilt ist:

```sql
CREATE TABLE IF NOT EXISTS EmployeeTenantAssignment (
    id VARCHAR(36) PRIMARY KEY,
    employee_id VARCHAR(36) NOT NULL,
    tenant_id VARCHAR(36) NOT NULL,       -- Referenz auf db_tokens.id
    tenant_doctor_id VARCHAR(255),        -- Doctor.id in der Tenant-DB
    assigned_since DATE,
    is_primary BOOLEAN DEFAULT FALSE,     -- Hauptabteilung (für Soll-Verteilung)
    fte_share DECIMAL(3,2) DEFAULT 1.00,  -- Anteil der Soll-Stunden für diesen Mandanten
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    
    UNIQUE KEY uk_employee_tenant (employee_id, tenant_id),
    INDEX idx_tenant (tenant_id)
);
```

**Zweck:** Wenn ein MA in 2 Abteilungen arbeitet (z.B. 60% Radiologie, 40% Nuklearmedizin), wird hier die **Verteilung der Soll-Stunden** festgelegt. Ohne diese Tabelle wüsste das System nicht, wie es das Monats-Soll auf die Mandanten aufteilt.

---

## Workflows

### A. Neuen Mitarbeiter in Abteilung einteilen (Tenant-Frontend)

```
Dienstplaner öffnet Mitarbeiterverwaltung
         │
         ▼
    ┌─────────────┐
    │ "Mitarbeiter │
    │  hinzufügen" │
    └──────┬──────┘
           │
           ▼
    ┌──────────────────────────────────────┐
    │ Mitarbeiter-Auswahl (Suchfeld)       │
    │                                      │
    │ 🔍 "Mül"                             │
    │ ┌──────────────────────────────────┐ │
    │ │ 👤 Müller, Thomas  (P-2341)     │ │ ◄── Aus Employee-Tabelle
    │ │ 👤 Müller-Schmidt, Anna (P-2587)│ │     (Central DB)
    │ │ 👤 Mülhausen, Stefan (P-1120)   │ │
    │ └──────────────────────────────────┘ │
    │                                      │
    │ ─── oder ────────────────────────── │
    │                                      │
    │ [➕ Externen Mitarbeiter manuell     │
    │     anlegen (ohne Zeiterfassung)]    │
    └──────────────────┬───────────────────┘
                       │
              ┌────────┴────────┐
              │                 │
    Zentral ausgewählt    Manuell angelegt
              │                 │
              ▼                 ▼
    Doctor erstellen:     Doctor erstellen:
    central_employee_id   central_employee_id
    = Employee.id         = NULL
    name = aus Employee   name = Freitext
              │                 │
              ▼                 ▼
    Rolle, FTE, Farbe,    Rolle, FTE, Farbe,
    Kürzel, Qualifika-    Kürzel zuweisen
    tionen zuweisen       
              │                 │
              ▼                 ▼
    ✅ In Zeiterfassung   ⚠️ Nur im Dienstplan,
       berücksichtigt        NICHT in Zeiterfassung
```

### B. Mitarbeiter zentral verwalten (Master-Frontend)

```
HR öffnet Master → Mitarbeiter
         │
         ▼
    ┌──────────────────────────────────────────┐
    │ Zentrale Mitarbeiterliste                │
    │                                          │
    │ 👤 Müller, Thomas (P-2341)               │
    │    Vollzeit · 38,5h · aktiv              │
    │    Abteilungen: Radiologie, Nuklearmed.  │
    │                                          │
    │ 👤 Schmidt, Lisa (P-1892)                │
    │    Teilzeit · 20h · aktiv                │
    │    Abteilungen: Radiologie               │
    │                                          │
    │ [➕ Neuen Mitarbeiter anlegen]            │
    └──────────────────────────────────────────┘
         │
         ▼ (Klick auf Mitarbeiter)
    ┌──────────────────────────────────────────┐
    │ Stammdaten         │ Einsätze            │
    │ ─────────────────  │ ────────            │
    │ Vorname: Thomas    │ Radiologie (60%)    │
    │ Nachname: Müller   │  └─ Facharzt, 0.6  │
    │ P-Nr: 2341         │ Nuklearmed. (40%)   │
    │ Vertrag: Vollzeit  │  └─ Oberarzt, 0.4  │
    │ Soll: 38,5h/Wo     │                     │
    │ Urlaub: 30 Tage    │ Zeitkonto           │
    │ Seit: 01.03.2019   │ ────────            │
    │                    │ Saldo: +12,5h       │
    │ [Speichern]        │ Resturlaub: 18 Tage │
    └──────────────────────────────────────────┘
```

**Bei Änderung von Name/E-Mail:** Mandanten-Admins erhalten eine Benachrichtigung. Sie synchronisieren manuell über den Sync-Button.

### C. Soll-Stunden-Verteilung bei Mehrfach-Einsatz

```
Employee: Thomas Müller
  target_hours_per_week: 38,5h

EmployeeTenantAssignment:
  ├─ Radiologie:    fte_share = 0.60, is_primary = true
  └─ Nuklearmedizin: fte_share = 0.40, is_primary = false

Monats-Soll (z.B. März, 21 Arbeitstage):
  Gesamt:       38,5h × 21/5 = 161,7h
  Radiologie:   161,7h × 0.60 = 97,0h
  Nuklearmed.:  161,7h × 0.40 = 64,7h
```

---

## API-Design

### Master-Frontend → Central DB

| Route | Methode | Beschreibung |
|-------|---------|--------------|
| `/api/master/employees` | GET | Alle zentralen Mitarbeiter (mit Filter: aktiv, Name, Mandant) |
| `/api/master/employees` | POST | Neuen Mitarbeiter anlegen |
| `/api/master/employees/:id` | GET | Mitarbeiter-Detail + Mandanten-Zuordnungen + Zeitkonto |
| `/api/master/employees/:id` | PUT | Stammdaten aktualisieren → Push an Tenants |
| `/api/master/employees/:id/assignments` | GET | In welchen Mandanten ist MA eingeteilt? |
| `/api/master/employees/:id/assignments` | PUT | Mandanten-Zuordnungen aktualisieren (fte_share etc.) |

### Tenant-Frontend → Central DB (neue Route)

| Route | Methode | Beschreibung |
|-------|---------|--------------|
| `/api/employees/search?q=` | GET | Zentrale Mitarbeiter durchsuchen (für Auswahldialog) |
| `/api/employees/:id` | GET | Zentrale Stammdaten eines Mitarbeiters lesen |

### Tenant-Frontend → Tenant DB (bestehend, erweitert)

| Route | Methode | Beschreibung |
|-------|---------|--------------|
| `POST /api/db` (create Doctor) | POST | Erweitert um `central_employee_id` |
| `POST /api/db` (update Doctor) | POST | `central_employee_id` nicht änderbar nach Erstellung |

---

## Migration bestehender Daten

### Grundannahme

> **Was aktuell auf den Mandanten angelegt ist, entspricht dem HR-Ist-Zustand.**

Die Migration läuft vollautomatisch. Es wird kein manuelles Mapping benötigt, keine CSV-Prüfung durch HR. Das Skript übernimmt die bestehenden Mandanten-Daten 1:1 in die zentrale `Employee`-Tabelle und verlinkt zurück.

### Migrationsstrategie: Automatisch in 3 Schritten

```
Schritt 1                Schritt 2                    Schritt 3
Schema anlegen           Daten migrieren              Verlinken
─────────────           ─────────────               ──────────
                                                    
Central DB:              Central DB:                  Tenant DBs:
┌──────────┐            ┌──────────────────┐         ┌─────────────────────┐
│ CREATE   │            │ INSERT Employee  │         │ UPDATE Doctor       │
│ Employee │            │ aus Tenant-      │         │ SET central_        │
│ CREATE   │            │ Doctor-Daten     │         │ employee_id = ?     │
│ Assign.  │            │                  │         │ WHERE id = ?        │
└──────────┘            │ INSERT Tenant-   │         └─────────────────────┘
                        │ Assignment       │
Tenant DBs:             └──────────────────┘
┌──────────┐
│ ALTER    │
│ Doctor   │
│ ADD col  │
└──────────┘
```

### Schritt 1: Schema vorbereiten

```sql
-- Central DB
CREATE TABLE IF NOT EXISTS Employee (
    id VARCHAR(36) PRIMARY KEY,
    payroll_id VARCHAR(50),
    last_name VARCHAR(200) NOT NULL,  -- übernommen aus Doctor.name (Bestandsformat)
    first_name VARCHAR(100),          -- wird bei Migration leer gelassen
    former_name VARCHAR(200),         -- wird bei Migration leer gelassen
    date_of_birth DATE,
    email VARCHAR(255),
    phone VARCHAR(50),
    address TEXT,
    contract_type ENUM('vollzeit','teilzeit','minijob','werkstudent','praktikant','honorar'),
    contract_start DATE,
    contract_end DATE,
    probation_end DATE,
    target_hours_per_week DECIMAL(4,1),
    vacation_days_annual INT DEFAULT 30,
    is_active BOOLEAN DEFAULT TRUE,
    exit_date DATE,
    exit_reason VARCHAR(255),
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME ON UPDATE CURRENT_TIMESTAMP,
    created_by VARCHAR(255),
    INDEX idx_payroll (payroll_id),
    INDEX idx_active (is_active),
    INDEX idx_name (last_name, first_name)
);

CREATE TABLE IF NOT EXISTS EmployeeTenantAssignment (
    id VARCHAR(36) PRIMARY KEY,
    employee_id VARCHAR(36) NOT NULL,
    tenant_id VARCHAR(36) NOT NULL,
    tenant_doctor_id VARCHAR(255),
    assigned_since DATE,
    is_primary BOOLEAN DEFAULT FALSE,
    fte_share DECIMAL(3,2) DEFAULT 1.00,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uk_employee_tenant (employee_id, tenant_id),
    INDEX idx_employee (employee_id),
    INDEX idx_tenant (tenant_id)
);

-- Alle Tenant-DBs (automatisch über alle aktiven Tenants iteriert)
ALTER TABLE Doctor ADD COLUMN IF NOT EXISTS central_employee_id VARCHAR(36) DEFAULT NULL;
ALTER TABLE Doctor ADD INDEX IF NOT EXISTS idx_central_employee (central_employee_id);
```

> **Hinweis zum Schema:** `Doctor.name` wird 1:1 als `Employee.last_name` übernommen. `first_name` und `former_name` bleiben vorerst leer – HR kann diese später im Master-Frontend nachpflegen. Kein Namens-Parsing nötig.

### Schritt 2: Daten migrieren (Pseudocode)

```javascript
async function migrateEmployees() {
    const tenants = await getAllActiveTenants();   // aus db_tokens
    const employeeMap = new Map();                 // name → employee_id (Duplikat-Erkennung)

    for (const tenant of tenants) {
        const tenantDb = getTenantDb(tenant.token);
        const doctors = await tenantDb.query('SELECT * FROM Doctor');

        for (const doctor of doctors) {
            // ── Entscheidung: Zentral oder Extern? ──
            const isExternal = doctor.exclude_from_staffing_plan === true;

            if (isExternal) {
                // Externes Personal → kein Employee, kein Link
                // central_employee_id bleibt NULL
                console.log(`SKIP (extern): ${doctor.name} in ${tenant.name}`);
                continue;
            }

            // ── Duplikat-Erkennung: gleiches Name = gleiche Person ──
            const nameKey = doctor.name.trim().toLowerCase();
            let employeeId;

            if (employeeMap.has(nameKey)) {
                // Gleicher Name in anderem Mandant → selbe Person
                employeeId = employeeMap.get(nameKey);
                console.log(`LINK (existiert): ${doctor.name} → ${employeeId}`);
            } else {
                // Neuer Mitarbeiter → Employee anlegen
                employeeId = generateUUID();
                await centralDb.query(`
                    INSERT INTO Employee (id, last_name, email, phone, is_active,
                        contract_end, created_by, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, 'migration', NOW())
                `, [
                    employeeId,
                    doctor.name,              // Doctor.name → last_name (1:1)
                    doctor.email || doctor.google_email || null,
                    null,                               // phone nicht im alten Schema
                    doctor.contract_end_date ? 
                        (new Date(doctor.contract_end_date) > new Date()) : true,
                    doctor.contract_end_date || null
                ]);
                employeeMap.set(nameKey, employeeId);
                console.log(`CREATE: ${doctor.name} → ${employeeId}`);
            }

            // ── Tenant-Assignment anlegen ──
            const isFirstTenant = !employeeMap.has(nameKey + '_assigned');
            await centralDb.query(`
                INSERT INTO EmployeeTenantAssignment 
                    (id, employee_id, tenant_id, tenant_doctor_id, 
                     is_primary, fte_share, assigned_since, created_at)
                VALUES (?, ?, ?, ?, ?, ?, CURDATE(), NOW())
            `, [
                generateUUID(),
                employeeId,
                tenant.id,
                doctor.id,
                isFirstTenant ? true : false,   // Erster Mandant = primär
                doctor.fte || 1.0,
            ]);
            employeeMap.set(nameKey + '_assigned', true);

            // ── Doctor mit Employee verlinken ──
            await tenantDb.query(`
                UPDATE Doctor SET central_employee_id = ? WHERE id = ?
            `, [employeeId, doctor.id]);
        }
    }

    return {
        totalEmployees: employeeMap.size,
        totalAssignments: /* Zähler */,
        skippedExternal: /* Zähler */,
    };
}
```

### Duplikat-Erkennung

Die automatische Migration nutzt **exakten Namensvergleich** (case-insensitive, trimmed):

| Situation | Ergebnis |
|-----------|----------|
| "Dr. Müller" in Radiologie + "Dr. Müller" in Nuklearmed. | → 1 Employee, 2 Assignments |
| "Dr. Müller" in Radiologie + "Dr. Thomas Müller" in Nuklearmed. | → 2 Employees (Namen weichen ab) |
| "Dr. Müller" nur in Radiologie | → 1 Employee, 1 Assignment |
| "Vertretung extern" mit `exclude_from_staffing_plan = true` | → Kein Employee, `central_employee_id = NULL` |

**Warum reicht das?** In der Praxis schreiben Sekretariate den gleichen Mitarbeiter in verschiedenen Abteilungen gleich. Falls doch ein Fehler auftritt (2 Employees für dieselbe Person), kann HR das im Master-Frontend **nachträglich zusammenführen** (Merge-Funktion, Phase 2).

### Schritt 3: Verifizierung

Nach der Migration läuft ein automatischer Check:

```javascript
async function verifyMigration() {
    const results = {
        centralEmployees: 0,
        linkedDoctors: 0,
        unlickedDoctors: 0,    // central_employee_id = NULL
        orphanedEmployees: 0,  // Employee ohne Assignment
        multiTenantEmployees: 0,// Employee in >1 Tenant
    };

    // 1. Alle Employees zählen
    results.centralEmployees = await centralDb.query(
        'SELECT COUNT(*) FROM Employee'
    );

    // 2. Pro Tenant: Verlinkte vs. Nicht-Verlinkte
    for (const tenant of tenants) {
        const linked = await tenantDb.query(
            'SELECT COUNT(*) FROM Doctor WHERE central_employee_id IS NOT NULL'
        );
        const unlinked = await tenantDb.query(
            'SELECT COUNT(*) FROM Doctor WHERE central_employee_id IS NULL'
        );
        results.linkedDoctors += linked;
        results.unlickedDoctors += unlinked;
    }

    // 3. Multi-Tenant-Mitarbeiter
    results.multiTenantEmployees = await centralDb.query(`
        SELECT COUNT(*) FROM (
            SELECT employee_id FROM EmployeeTenantAssignment 
            GROUP BY employee_id HAVING COUNT(*) > 1
        ) multi
    `);

    return results;
    // Beispiel-Output:
    // { centralEmployees: 47, linkedDoctors: 52, unlinkedDoctors: 3,
    //   orphanedEmployees: 0, multiTenantEmployees: 5 }
}
```

### Rollback-Sicherheit

Falls etwas schiefgeht:

```sql
-- Rollback Central DB
DROP TABLE IF EXISTS EmployeeTenantAssignment;
DROP TABLE IF EXISTS Employee;

-- Rollback alle Tenant-DBs
ALTER TABLE Doctor DROP COLUMN IF EXISTS central_employee_id;
```

Keine bestehenden Daten werden verändert oder gelöscht. `Doctor`-Datensätze bleiben unangetastet – es wird nur `central_employee_id` gesetzt (ein neues Feld). Die Migration ist **nicht-destruktiv** und beliebig wiederholbar.

### Laufzeit-Erwartung

| Mandanten | Ärzte gesamt | Geschätzte Dauer |
|-----------|-------------|-----------------|
| 5 | ~50 | < 5 Sekunden |
| 20 | ~200 | < 15 Sekunden |
| 50 | ~500 | < 30 Sekunden |

Die Migration ist ein **einmaliger Vorgang** und kann im laufenden Betrieb ausgeführt werden (kein Downtime nötig).

---

## Nach der Migration: Was ändert sich für die Nutzer?

### Mandanten-Frontend (Abteilungssekretariat)

| Vorher | Nachher |
|--------|---------|
| "Mitarbeiter hinzufügen" → Name frei eintippen | "Mitarbeiter hinzufügen" → Aus zentraler Liste auswählen ODER manuell extern anlegen |
| Name jederzeit editierbar | Name bei verlinkten MA readonly (Änderung nur über Master) |
| Alle Mitarbeiter gleich behandelt | Badge: "Zentral verwaltet" ✅ vs. "Lokal/Extern" ⚠️ |
| Stellenplan, Qualifikationen, Reihenfolge frei verwalten | **Keine Änderung** – bleibt alles lokal |
| Dienstplanung wie gewohnt | **Keine Änderung** |

### Master-Frontend (HR / Geschäftsführung)

| Vorher | Nachher |
|--------|---------|
| Mitarbeiterliste: Aggregation aus allen Tenants zur Laufzeit (langsam, inkonsistent) | Mitarbeiterliste: Direkt aus `Employee`-Tabelle (schnell, konsistent) |
| Stammdaten readonly (Anzeige aus Tenant-Daten) | Stammdaten editierbar → Push an alle Tenants |
| Kein Wissen über Mehrfach-Einsatz | Mandanten-Zuordnung sichtbar (welche Abteilungen, welcher Anteil) |
| Keine Vertragsdaten | Vertragstyp, Soll-Stunden, Urlaubsanspruch pflegbar |

### Phase 3: Frontend anpassen

1. **Mandanten-Frontend** (`Staff.jsx` / `DoctorForm.jsx`):
   - "Mitarbeiter hinzufügen" → Auswahldialog statt Freitext
   - Extern-Option für nicht-zentrale Mitarbeiter
   - Zentrale Felder (Name) als readonly wenn verknüpft

2. **Master-Frontend** (`MasterEmployeeList.jsx` / `MasterEmployeeDetail.jsx`):
   - Datenquelle: `Employee`-Tabelle statt Cross-Tenant-Aggregation
   - Stammdaten-Bearbeitung mit Push an Tenants
   - Mandanten-Zuordnungs-Tab

---

## Auswirkungen auf bestehende Features

### Dienstplan (ScheduleBoard)
- **Keine Änderung.** Arbeitet weiter mit lokalen `Doctor`-IDs und `ShiftEntry`.
- `central_employee_id` wird im Dienstplan nicht benötigt.

### Arbeitszeitberechnung (WorkingTimeReport)
- **Keine Änderung im Mandanten.** Berechnet weiter Ist-Stunden aus `shift_entries`.
- **Master-Frontend:** Nutzt `central_employee_id` um Stunden mandantenübergreifend zu aggregieren.

### Stellenplan (StaffingPlanTable)
- **Keine Änderung.** Bleibt lokal pro Tenant.

### Urlaubsverwaltung (Vacation)
- **Mandant:** Urlaubs-Einträge bleiben in Tenant-DB.
- **Master:** Urlaubsanspruch kommt aus `Employee.vacation_days_annual`, Genommen wird aus Tenants aggregiert.

### Zeitkonten (TimeAccount – noch nicht implementiert)
- **Liest Ist-Stunden** aus allen Tenants des Mitarbeiters (via `EmployeeTenantAssignment`).
- **Soll-Stunden** kommen aus `Employee.target_hours_per_week`.
- **Saldo** = Σ(Ist aus allen Tenants) − Soll.

### Statistiken
- **Mandant:** Unverändert. Mitarbeiter mit `central_employee_id = NULL` (externe) können optional ausgefiltert werden – analog zum bisherigen `excluded_from_statistics`.
- **Master:** Reports basieren auf `Employee`-Tabelle, nicht mehr auf Cross-Tenant-Aggregation.

---

## Beantwortete Fragen

| # | Frage | Entscheidung |
|---|-------|-------------|
| 1 | Namensfelder getrennt oder zusammen? | **Getrennt:** `last_name` (aus Doctor.name, Pflicht), `first_name` (optional, HR pflegt nach), `former_name` (z.B. Geburtsname bei Hochzeit). Kein Parsing – Doctor.name wird 1:1 als Nachname übernommen. |
| 2 | Personalnummern beim Kunden? | **Ja, existiert.** `payroll_id` ist editierbar im Master-Frontend. |
| 3 | Sync synchron oder asynchron? | **Asynchron.** Bei Stammdatenänderung erhält der Mandanten-Admin eine Benachrichtigung. Im Mandanten gibt es einen "Stammdaten synchronisieren"-Button (analog zum Stellenplan-Sync). |
| 4 | Mitarbeiter-Austritt? | **Soft-Delete** (`is_active = false`). Ab Austrittsdatum nicht mehr auswählbar. Konzept ist im Tenant bereits bekannt. |
| 5 | FTE-Share initial? | **1:1 reicht zunächst.** Schema hält `fte_share` vor, wird aber default 1.00 gelassen. Später: Konzept für **Springer-Pool** (flexible Pflegekräfte, die mandantenübergreifend eingesetzt werden). |

---

## Offene Punkte (Zukunft)

| # | Thema | Beschreibung |
|---|-------|--------------|
| 1 | **Springer-Pool** | Beim Kunden gibt es einen Mitarbeiterpool "Springer" – Pflegekräfte, die flexibel in verschiedenen Kliniken/Abteilungen eingesetzt werden. Benötigt eigenes Konzept: Wie werden Springer mandantenübergreifend verplant? Wie wird deren Arbeitszeit auf Mandanten aufgeteilt? Wie erfolgt die Soll-Stunden-Verteilung? |
| 2 | **Merge-Funktion** | Falls bei der Migration 2 Employees für dieselbe Person entstehen (unterschiedliche Namensschreibweise), braucht HR eine Zusammenführungsfunktion im Master-Frontend. |

---

## Umsetzungsreihenfolge

```
Schritt 1 – Employee-Tabelle + Migration (Backend)
├── Employee-Tabelle in Central DB anlegen
├── Doctor um central_employee_id erweitern (alle Tenants)
├── Migrationsskript: bestehende Doctors → Employees
└── API: /api/master/employees CRUD

Schritt 2 – Master-Frontend umbauen
├── MasterEmployeeList → liest aus Employee statt Cross-Tenant
├── MasterEmployeeDetail → Stammdaten aus Employee editierbar
├── Mandanten-Zuordnungs-Ansicht (welche Tenants, welcher FTE-Anteil)
└── Push-Logik: Namensänderung → Notification an Mandanten + Sync-Button

Schritt 3 – Tenant-Frontend anpassen
├── DoctorForm → Auswahldialog für zentrale Mitarbeiter
├── Extern-Option (central_employee_id = NULL)
├── Zentrale Felder (Name) als readonly wenn verknüpft
└── Badge: "Zentral verwaltet" vs. "Lokal / Extern"

Schritt 4 – Zeiterfassung darauf aufbauen
├── TimeAccount referenziert Employee.id
├── Soll-Stunden aus Employee.target_hours_per_week
├── Ist-Stunden aggregiert aus allen Tenants des MA
└── Monatsabschluss pro Employee
```

---

*Dieses Konzept ist die Grundlage für die zentrale Zeiterfassung. Ohne `Employee`-Tabelle kann kein mandantenübergreifendes Zeitkonto existieren.*
