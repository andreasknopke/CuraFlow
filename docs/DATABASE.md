# Datenbankschema

CuraFlow verwendet **MySQL 8** als einzigen Datenspeicher. Alle Tabellen liegen in derselben Datenbank (oder jeweils in der mandantenspezifischen DB bei Multi-Tenant-Betrieb).

---

## Übersicht aller Tabellen

| Tabelle | Beschreibung |
|---|---|
| `app_users` | Systembenutzer (Login, Rollen, Einstellungen) |
| `doctors` | Mitarbeitende (Stammdaten) |
| `workplaces` | Arbeitsbereiche (CT, MRT, Dienste etc.) |
| `shift_entries` | Dienstplan-Einträge |
| `wish_requests` | Dienstwünsche der Mitarbeiter |
| `staffing_plan_entries` | Stellenplan-Einträge (VK-Anteile) |
| `system_settings` | Systemkonfiguration (Key-Value) |
| `color_settings` | Farbkonfiguration (Key-Value) |
| `team_roles` | Teamrollen mit Berechtigungen |
| `workplace_timeslots` | Zeitfenster-Konfiguration je Arbeitsbereich |
| `timeslot_templates` | Vorlagen für Zeitfenster |
| `server_tokens` | DB-Tokens für Multi-Tenant-Zugriff |
| `section_configs` | Konfiguration der Dienstplan-Abschnitte |

---

## Tabellen im Detail

### `app_users`

Systembenutzer für Login und Berechtigungskontrolle.

```sql
CREATE TABLE app_users (
  id                   INT AUTO_INCREMENT PRIMARY KEY,
  email                VARCHAR(255) UNIQUE NOT NULL,
  password_hash        VARCHAR(255) NOT NULL,
  full_name            VARCHAR(255),
  role                 ENUM('admin', 'user', 'readonly') DEFAULT 'user',
  is_active            TINYINT(1) DEFAULT 1,
  doctor_id            INT,                    -- Verknüpfung mit doctors.id
  must_change_password TINYINT(1) DEFAULT 0,
  email_verified       TINYINT(1) DEFAULT 0,
  email_verify_token   VARCHAR(255),
  -- Benutzereinstellungen (JSON-kodiert)
  collapsed_sections       TEXT,
  schedule_hidden_rows     TEXT,
  schedule_show_sidebar    TINYINT(1),
  highlight_my_name        TINYINT(1),
  wish_hidden_doctors      TEXT,
  wish_show_occupied       TINYINT(1),
  wish_show_absences       TINYINT(1),
  -- Timestamps
  created_at           DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at           DATETIME ON UPDATE CURRENT_TIMESTAMP
);
```

**Rollen:**
- `admin` – Vollzugriff inkl. Admin-Bereich
- `user` – Normaler Benutzer, kann eigene Wünsche bearbeiten
- `readonly` – Nur Lesen, keine Änderungen möglich

---

### `doctors`

Mitarbeitende. Zentrale Entität, auf die sich `shift_entries`, `wish_requests` etc. beziehen.

```sql
CREATE TABLE doctors (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  name            VARCHAR(255) NOT NULL,
  role            VARCHAR(100),     -- z.B. 'Teamleitung', 'Senior', 'Junior'
  color           VARCHAR(50),      -- Hex-Farbe für Dienstplan-Darstellung
  `order`         INT DEFAULT 0,    -- Anzeigereihenfolge
  is_active       TINYINT(1) DEFAULT 1,
  notes           TEXT,
  qualifications  TEXT,             -- JSON-Array
  restrictions    TEXT,             -- JSON-Array
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

---

### `workplaces`

Arbeitsbereiche, die im Dienstplan als Zeilen erscheinen (z.B. CT, MRT, Angiographie).

```sql
CREATE TABLE workplaces (
  id                      INT AUTO_INCREMENT PRIMARY KEY,
  name                    VARCHAR(255) NOT NULL,
  category                VARCHAR(100),   -- 'Dienste', 'Rotationen', etc.
  `order`                 INT DEFAULT 0,
  is_active               TINYINT(1) DEFAULT 1,
  min_staff               INT DEFAULT 1,  -- Mindestbesetzung
  max_staff               INT,            -- Maximalbesetzung
  work_time_percentage    DECIMAL(5,2),   -- Anteil an der Arbeitszeit
  affects_availability    TINYINT(1) DEFAULT 0, -- Beeinflusst Verfügbarkeit
  color                   VARCHAR(50),
  notes                   TEXT,
  created_at              DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

---

### `shift_entries`

Kernentität: Jeder Eintrag im Dienstplan ist ein `shift_entry`.

```sql
CREATE TABLE shift_entries (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  doctor_id       INT NOT NULL,       -- FK → doctors.id
  date            DATE NOT NULL,
  workplace       VARCHAR(255),       -- z.B. 'CT', 'Urlaub', 'Dienst Vordergrund'
  section         VARCHAR(255),       -- Abschnittsname (z.B. 'Dienste', 'Abwesenheiten')
  start_time      TIME,               -- Optional: Zeitfenster-Start
  end_time        TIME,               -- Optional: Zeitfenster-Ende
  timeslot_id     INT,                -- FK → workplace_timeslots.id
  note            TEXT,               -- Freitext-Notiz
  is_free_text    TINYINT(1) DEFAULT 0, -- Freitext-Zelle statt Mitarbeitername
  free_text_value VARCHAR(500),
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_date (date),
  INDEX idx_doctor_date (doctor_id, date),
  INDEX idx_workplace_date (workplace, date)
);
```

> **Performance-Hinweis:** Bei großen Datenmengen unbedingt den Index auf `date` nutzen. Alle Abfragen sollten einen Datumsbereich verwenden.

---

### `wish_requests`

Dienstwünsche von Mitarbeitenden (Wunschliste-Feature).

```sql
CREATE TABLE wish_requests (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  doctor_id   INT NOT NULL,         -- FK → doctors.id
  date        DATE NOT NULL,
  wish_type   VARCHAR(100),         -- z.B. 'Dienst', 'Frei', 'Urlaub'
  workplace   VARCHAR(255),         -- Gewünschter Arbeitsbereich
  status      ENUM('pending', 'approved', 'rejected') DEFAULT 'pending',
  note        TEXT,
  admin_note  TEXT,
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_doctor_date (doctor_id, date),
  INDEX idx_date_status (date, status)
);
```

---

### `staffing_plan_entries`

Stellenplan: VK-Anteile (Vollkraft) je Mitarbeiter und Monat.

```sql
CREATE TABLE staffing_plan_entries (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  doctor_id   INT NOT NULL,
  year        INT,
  month       INT,            -- 1-12
  vk_amount   DECIMAL(4,2),   -- z.B. 1.0, 0.5, 0.75
  reason      VARCHAR(255),   -- z.B. 'Elternzeit', 'Mutterschutz'
  notes       TEXT,
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

---

### `system_settings` / `color_settings`

Einfache Key-Value-Tabellen für globale Einstellungen.

```sql
CREATE TABLE system_settings (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  key_name    VARCHAR(255) UNIQUE NOT NULL,
  value       TEXT,
  updated_at  DATETIME ON UPDATE CURRENT_TIMESTAMP
);
```

Wichtige Keys in `system_settings`:
- `max_doctors_per_shift` – Maximale Mitarbeitende pro Dienst
- `default_shift_hours` – Standard-Schichtdauer
- `wish_reminder_days` – Tage vor Deadline für Wunsch-Erinnerung

---

### `team_roles`

Konfigurierbare Teamrollen mit Anzeigepriorität und Farben.

```sql
CREATE TABLE team_roles (
  id                  INT AUTO_INCREMENT PRIMARY KEY,
  name                VARCHAR(100) NOT NULL,
  priority            INT DEFAULT 99,  -- Sortierreihenfolge (niedrig = zuerst)
  color               VARCHAR(50),
  can_edit_schedule   TINYINT(1) DEFAULT 0,
  can_approve_wishes  TINYINT(1) DEFAULT 0,
  created_at          DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

---

### `workplace_timeslots`

Zeitfenster für Arbeitsbereiche (z.B. Früh-/Spätschicht-Slots).

```sql
CREATE TABLE workplace_timeslots (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  workplace_id  INT NOT NULL,     -- FK → workplaces.id
  name          VARCHAR(100),
  start_time    TIME,
  end_time      TIME,
  color         VARCHAR(50),
  `order`       INT DEFAULT 0,
  is_active     TINYINT(1) DEFAULT 1
);
```

---

### `server_tokens`

DB-Tokens für den Multi-Tenant-Betrieb.

```sql
CREATE TABLE server_tokens (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  name            VARCHAR(255),       -- Anzeigename
  encrypted_token TEXT NOT NULL,      -- Verschlüsselte DB-Credentials
  allowed_users   TEXT,               -- JSON-Array von user IDs (null = alle)
  created_by      INT,                -- FK → app_users.id
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

---

## Migrationsstrategie

Neue Datenbankänderungen werden als nummerierte SQL-Dateien in `server/migrations/` abgelegt (z.B. `011_add_new_column.sql`). Das Versionierungsschema ist:

```
NNN_beschreibung.sql
```

Zum Einspielen:

```bash
mysql -u curaflow -p curaflow_dev < server/migrations/011_add_new_column.sql
```

> **Wichtig:** Migrations sind idempotent zu gestalten – `IF NOT EXISTS` Klauseln verwenden, um doppeltes Ausführen zu ermöglichen.
