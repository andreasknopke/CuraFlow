# Feature: Zeiterfassung (Tisoware.zeit-Ersatz)

## Ziel

CuraFlow soll den (eingeschränkten) Funktionsumfang von **Tisoware.zeit** ersetzen. Beim Kunden erfolgt die Zeiterfassung **manuell** durch HR/Sekretariate – keine Terminals. Es existiert eine Schnittstelle zur Buchhaltungssoftware **P&I Loga**, deren Nutzbarkeit noch geprüft werden muss.

Zusätzlich wird ein **Master-Frontend** für Personalabteilung und Geschäftsführung eingerichtet, das Daten aus mehreren Mandanten-Datenbanken aggregiert.

---

## Tisoware.zeit – Funktionsumfang (Zielzustand)

| # | Funktion | Priorität | Beschreibung |
|---|---|---|---|
| 1 | **Manuelle Zeiterfassung** | hoch | Kommt-/Geht-Buchungen durch HR/Sekretariat |
| 2 | **Fehlzeitenverwaltung** | hoch | Urlaub, Krank, Sonderurlaub, Elternzeit, Mutterschutz |
| 3 | **Soll/Ist-Vergleich** | hoch | Vertragliches Stunden-Soll vs. tatsächlich geleistete Ist-Stunden |
| 4 | **Überstunden-Management** | mittel | Berechnung, Auf-/Abbau von Zeitguthaben |
| 5 | **Zeitkonten** | mittel | Gleitzeitkonto, kumuliertes Plus/Minus pro MA |
| 6 | **Monatsabschluss** | mittel | Perioden-Abschluss & Sperre für Lohnübergabe |
| 7 | **Auswertungen/Reports** | hoch | Monatliche Stundenübersichten, Fehlzeitenstatistiken |
| 8 | **Loga-Schnittstelle** | mittel | Export an P&I Loga (Format muss geprüft werden) |
| 9 | **Master-Frontend** | hoch | Mandanten-übergreifendes HR-Dashboard |

**Nicht benötigt** (da keine Terminals):
- Terminalanbindung (Stempeluhr, Transponder)
- Geo-Fencing / GPS-Zeiterfassung
- Mobile Stempeluhr

---

## Bestandsanalyse: Was CuraFlow bereits kann

### Vorhanden und nutzbar

| Funktion | CuraFlow-Feature | Details |
|---|---|---|
| Manuelle Schichtzuordnung | `shift_entries` mit `start_time`/`end_time` | Timeslot-basierte Arbeitszeit ist implementiert |
| Fehlzeitenverwaltung | Urlaub, Krank, Dienstreise, Frei, Nicht verfügbar | Als `shift_entries` mit `workplace`-Typ, inkl. Konflikt-Erkennung |
| Arbeitszeitauswertung | `WorkingTimeReport`-Komponente | Berechnet Ist-Stunden pro MA/Tag/Woche/Monat mit Überlappungs-Merge |
| Stellenplan / VK-Anteil | `staffing_plan_entries` | Monatliche VK-Anteile, Sonderstatus KO/EZ/MS |
| Schichtplanung | Kompletter Dienstplan | Timeslots, Zeitfenster, Schichtzuordnung, Drag&Drop |
| Excel-Export | `schedule.js` → Excel | Wochenplan-Export über ExcelJS |
| Multi-Tenant | DB-Token-System | Mandantenspezifische MySQL-DBs, verschlüsselte Tokens, Connection-Pool-Cache |
| Rollenberechtigungen | admin/user/readonly + Team-Rollen | Konfigurierbare Rechte pro Rolle |
| Mitarbeiterstammdaten | `doctors`-Tabelle | Qualifikationen, Farben, Notizen, Vertragsende |
| `work_time_percentage` | Prozentuale Arbeitszeitgewichtung | z.B. Rufbereitschaft = 70% |

### Vorhandene Dateien (relevant)

| Datei | Funktion |
|---|---|
| `src/components/statistics/WorkingTimeReport.jsx` | Ist-Stunden-Berechnung mit Interval-Merge |
| `src/pages/Vacation.jsx` | Urlaubsplanung mit Konflikt-Erkennung |
| `src/pages/ServiceStaffing.jsx` | Stellenplan (VK-Anteile pro Monat) |
| `src/pages/Statistics.jsx` | Statistik-Dashboard |
| `src/api/client.js` | API-Client (Multi-Tenant-fähig) |
| `server/routes/admin.js` | DB-Token-Verwaltung, Cross-Tenant-Zugriff |
| `server/index.js` | `tenantDbMiddleware`, `getTenantDb()` |

---

## Was fehlt (Gap-Analyse)

### 1. Soll-Stunden-Definition (Aufwand: gering)

**Problem:** Es gibt kein Feld für vertragliche Wochenstunden pro Mitarbeiter.

**Lösung:**
- Neues Feld `target_hours_per_week` (DECIMAL 4,1) in `doctors`-Tabelle
- Berechnung des Monats-Solls: `target_hours_per_week × Arbeitstage im Monat / 5`
- Berücksichtigung von VK-Anteil aus `staffing_plan_entries`
- UI: Feld in Mitarbeiter-Stammdaten

```sql
ALTER TABLE Doctor ADD COLUMN target_hours_per_week DECIMAL(4,1) DEFAULT 38.5;
```

### 2. Soll/Ist-Vergleich (Aufwand: mittel)

**Problem:** Ist-Stunden werden berechnet (WorkingTimeReport), aber kein Vergleich mit Soll.

**Lösung:**
- Soll-Berechnung: `target_hours_per_week` × (Arbeitstage / 5) × VK-Anteil
- Delta-Anzeige: Ist - Soll = Plus/Minus
- Ampel-System: Grün (im Rahmen), Gelb (±10%), Rot (>10% Abweichung)
- Integration in bestehende `WorkingTimeReport`-Komponente

### 3. Manuelle Buchungsmaske für HR (Aufwand: mittel)

**Problem:** Aktuell wird nur Schichtzuordnung gemacht, nicht Kommt/Geht.

**Lösung:**
- Neue UI-Komponente: Tagesansicht pro MA mit Kommt/Geht-Feldern
- Nutzt existierendes `shift_entries`-Schema (`start_time`/`end_time`)
- Schnelleingabe: MA auswählen → Datum → Kommt-Zeit → Geht-Zeit → Speichern
- Alternativ: Bulk-Eingabe für mehrere MAs an einem Tag

**Datenmodell:** Kein Schema-Change nötig – `shift_entries` hat bereits `start_time`/`end_time`.

### 4. Zeitkonten / Gleitzeitkonto (Aufwand: mittel)

**Problem:** Kein kumuliertes Stundenplus/-minus über Monate.

**Lösung:**
- Neue Tabelle `time_accounts`:

```sql
CREATE TABLE IF NOT EXISTS TimeAccount (
    id INT AUTO_INCREMENT PRIMARY KEY,
    doctor_id INT NOT NULL,
    year INT NOT NULL,
    month INT NOT NULL,           -- 1-12
    target_minutes INT DEFAULT 0, -- Soll-Minuten
    actual_minutes INT DEFAULT 0, -- Ist-Minuten
    balance_minutes INT DEFAULT 0,-- Delta (Ist - Soll)
    carry_over INT DEFAULT 0,     -- Vortrag aus Vormonat
    total_balance INT DEFAULT 0,  -- balance + carry_over
    is_closed TINYINT(1) DEFAULT 0, -- Monatsabschluss erfolgt
    closed_by VARCHAR(255),
    closed_at DATETIME,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_doctor_period (doctor_id, year, month),
    INDEX idx_period (year, month)
);
```

- Monatlicher Saldo wird bei Abschluss berechnet und eingefroren
- Vortrag wird automatisch ins Folgemonat übernommen

### 5. Monatsabschluss-Workflow (Aufwand: mittel)

**Problem:** Keine Möglichkeit, Perioden zu sperren.

**Lösung:**
- Status in `time_accounts.is_closed`
- Workflow: Offen → Vorläufig → Abgeschlossen
- Abgeschlossene Monate: Keine Änderungen an shift_entries mehr möglich
- Middleware-Check bei Schreib-Operationen auf shift_entries

### 6. Loga-Schnittstelle (Aufwand: variabel)

**Problem:** Export-Format unbekannt.

**Zu klären beim Kunden:**
- Import-Format: CSV, XML, ASCII-Fixed-Width, REST-API?
- Relevante Felder: Personalnummer, Lohnart, Stunden, Fehlzeiten-Code
- Mapping: CuraFlow-Abwesenheitstypen → Loga-Lohnarten
- Übertragungsweg: Datei-Upload, SFTP, API?

**Vorbereitende Maßnahme:**
- Neues Feld `payroll_id` (Personalnummer) in `doctors`
- Mapping-Tabelle `absence_type_codes` (CuraFlow-Typ → Loga-Code)
- Generischer CSV-Export als Ausgangspunkt

```sql
ALTER TABLE Doctor ADD COLUMN payroll_id VARCHAR(50);
```

### 7. Master-Frontend (Aufwand: hoch)

**Bereits eingerichtet:**
- `master.html` als zweiter Vite-Entry-Point
- `src/master/` mit eigenem Layout, Auth-Provider, Router
- Eigene Startseite mit Mandanten-Übersicht

**Noch umzusetzen:**
- Cross-Tenant-API-Route (`server/routes/master.js` existiert als Basis)
- Aggregierte Zeiterfassungs-Auswertung
- Mandanten-übergreifende Fehlzeiten-Übersicht
- Konsolidierte Reports für Geschäftsführung

---

## Umsetzungsphasen

```
Phase 1 – Basis-Zeiterfassung (2-3 Wochen)
├── 1.1 Soll-Stunden pro MA (DB + UI im Mitarbeiter-Dialog)
├── 1.2 Soll/Ist-Vergleich in WorkingTimeReport
├── 1.3 Manuelle Buchungsmaske (Kommt/Geht)
└── 1.4 Monatsübersicht mit Delta-Anzeige

Phase 2 – Zeitkonten & Abschluss (2-3 Wochen)
├── 2.1 TimeAccount-Tabelle + Migration
├── 2.2 Automatische Saldo-Berechnung
├── 2.3 Monatsabschluss-Workflow
├── 2.4 Vortrag ins Folgemonat
└── 2.5 Sperre für abgeschlossene Perioden

Phase 3 – Master-Frontend ausbauen (3-4 Wochen)
├── 3.1 Cross-Tenant-API-Endpunkte
├── 3.2 Aggregierte Arbeitszeitübersicht
├── 3.3 Mandanten-übergreifende Fehlzeiten
├── 3.4 HR-Dashboard mit KPIs
└── 3.5 Export-Funktionen (Excel, PDF)

Phase 4 – Loga-Schnittstelle (1-3 Wochen, nach Kundenfeedback)
├── 4.1 Loga Import-Format spezifizieren
├── 4.2 Personalnummer-Feld + Mapping-Tabelle
├── 4.3 Export-Route implementieren
├── 4.4 Fehlzeiten-Code-Mapping
└── 4.5 Testlauf mit Echtdaten
```

---

## Risikobewertung

| Risiko | Eintrittsw. | Auswirkung | Mitigation |
|---|---|---|---|
| Loga-Format unklar | hoch | Phase 4 blockiert | Frühzeitig beim Kunden anfragen |
| Datenmodell-Erweiterung bricht Mandanten | gering | Datenverlust | Idempotente Migrationen (IF NOT EXISTS) |
| Performance bei Cross-Tenant-Abfrage | mittel | Langsame Reports | Caching, asynchrone Aggregation |
| Monatsabschluss-Sperre umgehbar | gering | Falsche Daten | Server-seitige Validierung, nicht nur UI |

---

## Offene Fragen (an Kunden)

1. **Loga-Schnittstelle:** Welches Import-Format nutzt Loga? (CSV/XML/API?) Welche Felder/Lohnarten werden benötigt?
2. **Personalnummern:** Gibt es bereits eine Personalnummern-Systematik, die in CuraFlow hinterlegt werden soll?
3. **Fehlzeiten-Codes:** Welche Abwesenheitsarten müssen an Loga übergeben werden? Mapping existiert?
4. **Gleitzeitregeln:** Gibt es Kappungsgrenzen für Überstunden? Verfallsfristen?
5. **Zugriffsrechte Master-Frontend:** Wer darf mandanten-übergreifend sehen? Nur GF oder auch HR?
6. **Arbeitszeitmodelle:** Nur Gleitzeit oder auch Schichtdienst-Modelle mit Zuschlägen?

---

## Technische Notizen

- **Kein Architektur-Umbau nötig:** Alle Erweiterungen sind inkrementell auf dem bestehenden Schema.
- **`shift_entries`** bleibt die zentrale Tabelle – Kommt/Geht-Buchungen sind `start_time`/`end_time` auf bestehenden Einträgen.
- **`WorkingTimeReport.jsx`** enthält bereits die Berechnungslogik (Interval-Merge, `work_time_percentage`-Gewichtung), muss nur um Soll erweitert werden.
- **Multi-Tenant-Infrastruktur** (DB-Token, Pool-Cache, Middleware) ist produktionsreif und kann direkt für Cross-Tenant-Abfragen genutzt werden.
- **Master-Frontend** ist als zweiter Vite-Entry-Point (`master.html` / `src/master-main.jsx`) bereits eingerichtet.
