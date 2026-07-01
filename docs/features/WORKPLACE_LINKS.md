# Arbeitsplatz-Verknüpfungen (Workplace Links)

> **Stand:** Juli 2026
> **Status:** Implementiert
> **Bezug:** [TENANT_GROUPS.md](TENANT_GROUPS.md), [SPRINGERPOOL_ROTATION.md](SPRINGERPOOL_ROTATION.md)

## 1. Ziel

CuraFlow verwaltet ärztliche und pflegerische/MTR-Einsatzplanung typischerweise in **getrennten
Mandanten** (Tenants) — z.B. "Radiologie" (ärztlich) und "MTR" (Röntgenassistenz). Beide Seiten
planen denselben physischen Raum, aber mit unterschiedlichen Arbeitsplatz-Namen:

- Radiologie-Tenant: Arbeitsplatz **"CT"**
- MTR-Tenant: Arbeitsplätze **"CT1"** und **"CT2"**

Bislang musste die MTR-Besetzung papierbasiert kommuniziert werden ("früh ausgedruckt vorgelesen").
Mit **Workplace Links** kann ein Master-Admin diese Arbeitsplätze verknüpfen. In der **Tagesansicht**
zeigt CuraFlow dann direkt am Zeilenkopf des ärztlichen "CT" die aktuelle Besetzung von "CT1"/"CT2"
(und umgekehrt) an — **rein lesend**, ohne Mandantengrenzen aufzuweichen.

## 2. Nicht-Ziele

- **Kein** gemeinsamer Schreibzugriff — es wird nichts in eine fremde Tenant-DB geschrieben.
- **Keine** Übertragung von Benutzerrechten zwischen Tenants.
- **Keine** Anzeige in Wochen-/Monatsansicht (bewusst auf die Tagesansicht beschränkt, um die
  Übersicht nicht zu überladen — siehe Entscheidung in der Anforderungsklärung).
- **Keine** Wiederverwendung von `tenant_group`/`shared_workplace` (das ist für *gepoolte*, gemeinsam
  besetzte Dienste gedacht — hier plant jede Seite unabhängig weiter, es wird nur gegenseitig
  angezeigt).

## 3. Datenmodell (Master-DB)

```sql
CREATE TABLE workplace_link_group (
  id INT PRIMARY KEY AUTO_INCREMENT,
  name VARCHAR(255) NOT NULL,           -- z.B. "CT – ärztlich/MTR"
  description TEXT DEFAULT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
);

CREATE TABLE workplace_link_member (
  id VARCHAR(36) PRIMARY KEY,
  link_group_id INT NOT NULL,
  tenant_id VARCHAR(36) NOT NULL,       -- db_tokens.id
  workplace_name VARCHAR(255) NOT NULL, -- exact match against Workplace.name
  created_at DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uk_wlm_group_tenant_wp (link_group_id, tenant_id, workplace_name),
  FOREIGN KEY (link_group_id) REFERENCES workplace_link_group(id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id) REFERENCES db_tokens(id) ON DELETE CASCADE
);
```

Ein `workplace_link_group` kann **beliebig viele** Mitglieder aus **beliebig vielen Tenants**
enthalten (z.B. "CT" ↔ "CT1" ↔ "CT2"). Es gibt **keine** Tabelle für gemeinsame Schichten — die
Besetzung wird bei jedem Request live aus der jeweiligen Tenant-DB gelesen.

## 4. Berechtigungen

- **Verwaltung** (Verknüpfung anlegen/ändern/löschen, Mitglieder hinzufügen/entfernen): **nur
  Master-Admin** (`adminMiddleware`), analog zu `tenant_group`.
- **Lesen der Partner-Besetzung** (`GET /api/workplace-links/visible-links`): jeder authentifizierte
  Nutzer des aktiven Tenants — es gibt bewusst **keine** zusätzliche Allow-List pro Nutzer, weil die
  Sichtbarkeit bereits vollständig durch die Admin-Konfiguration (welche Arbeitsplätze verknüpft
  sind) begrenzt ist, und nur Name + Zeitraum der eingeplanten Person offengelegt werden (keine
  sonstigen Personaldaten).

## 5. Backend

- **Migration**: `server/utils/masterMigrations.js` (Abschnitt "Workplace Links")
- **Util**: `server/utils/workplaceLinks.js`
  - `listWorkplaceLinkGroups(masterDb)` — Admin-Übersicht mit Mitgliedern
  - `loadLinkedWorkplacesForTenant(masterDb, tenantId)` — Map `ownWorkplaceName -> partner[]` für
    den kompletten Tenant in einer Query (vermeidet N+1)
- **Routen**: `server/routes/workplaceLinks.js` (gemountet unter `/api/workplace-links`)
  - `GET /visible-links?from=&to=` — read-only Feed für die Tagesansicht
  - `GET|POST|PATCH|DELETE /` und `/:groupId/members` — Admin-CRUD
  - `GET /tenant-workplaces/:tenantId` — Convenience-Lookup für die Admin-UI-Dropdown

### Ablauf `GET /visible-links`

1. Aktiven Tenant aus `x-db-token` Header auflösen.
2. `loadLinkedWorkplacesForTenant` → welche eigenen Arbeitsplätze haben Partner, und in welchem
   Partner-Tenant?
3. Für jeden Partner-Tenant: kurzlebiger `mysql2`-Pool via `parseDbToken` + `createPool` (wie im
   bestehenden `withTenantDb`-Muster in `groups.js`/`master.js`), `SELECT date, position, start_time,
   end_time, Doctor.name FROM ShiftEntry ... WHERE position IN (...)`.
4. Antwort: `{ linkedWorkplaces: { "<eigener Name>": [{ tenant_name, workplace_name, shifts: [...] }] } }`.

Es werden **nur** `position`, `start_time`, `end_time`, `date` und der `Doctor.name` gelesen — keine
`doctor_id`, keine sonstigen Felder.

## 6. Frontend

- **Admin-UI**: `src/components/admin/WorkplaceLinkManagement.jsx`, eingebunden als neuer Tab
  "Arbeitsplatz-Links" in `src/pages/Admin.jsx`.
- **Tagesansicht**: `src/components/schedule/ScheduleBoard.jsx`
  - Query `['workplace-links', 'visible-links', ...]` — nur aktiv wenn `viewMode === 'day'`.
  - `renderLinkedWorkplaceHint(rowName, dateStr)` rendert unterhalb des Zeilenkopfs eine kompakte
    Zeile pro verknüpftem Partner-Arbeitsplatz mit Namen + Mitarbeiter (oder "nicht besetzt").
  - Eingebunden sowohl in der Haupt-Matrix als auch im Split-View-Zeilenkopf.
- **API-Client**: `src/api/client.ts` — `getVisibleWorkplaceLinks`, `listWorkplaceLinkGroups`,
  `createWorkplaceLinkGroup`, `updateWorkplaceLinkGroup`, `deleteWorkplaceLinkGroup`,
  `addWorkplaceLinkMember`, `removeWorkplaceLinkMember`, `getTenantWorkplaceNames`.

## 7. Sicherheitsaspekte

- Kein `x-db-token` der Gegenseite wird an den Client weitergegeben — Backend baut eigene
  kurzlebige Pools serverseitig aus dem verschlüsselten `db_tokens.token`.
- Verknüpfungen sind rein deklarativ (Name-Matching); ein Tenant kann nicht "erraten", welche
  Arbeitsplätze verknüpft sind, ohne dass ein Master-Admin dies explizit konfiguriert hat.
- Antwortdaten sind auf das Minimum reduziert (Name, Zeitraum) — siehe Abschnitt 5.
