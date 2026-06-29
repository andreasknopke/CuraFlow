# Springerpool-Rotationen (V2)

> Separate System für die Verwaltung von Springerpool-Rotationen, analog zu Cross-Tenant-Diensten, aber vollständig isoliert.

## Übersicht

Das Springerpool-Rotationssystem ermöglicht es einem Pool-Mandanten (Springerpool), Rotationen zu verwalten, an denen mehrere Stationen (Ward-Mandanten) teilnehmen. Jede Station sieht **nur ihre eigene Zeile** im Planungsboard und kann dort Bedarf anmelden. Der Pool-Planer erfüllt den Bedarf durch Zuweisungen.

### Konzept

```
┌─────────────────────────────────────────────────────────┐
│  Springerpool (Pool-Mandant)                            │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐                  │
│  │  Gyn 1  │  │  Gyn 2  │  │  Gyn 3  │  ← Rotationen   │
│  │ (Zeile) │  │ (Zeile) │  │ (Zeile) │     (Workplaces)│
│  └────┬────┘  └────┬────┘  └────┬────┘                  │
│       │            │            │                        │
│  Früh/Mittel/Spät  ...          ...   ← Timeslots       │
└───────┼────────────┼────────────┼───────────────────────┘
        │            │            │
   ┌────▼────┐  ┌────▼────┐  ┌────▼────┐
   │ Station │  │ Station │  │ Station │
   │  Gyn 1  │  │  Gyn 2  │  │  Gyn 3  │
   │ (Ward)  │  │ (Ward)  │  │ (Ward)  │
   └─────────┘  └─────────┘  └─────────┘
   Sieht nur    Sieht nur    Sieht nur
   ihre Zeile   ihre Zeile   ihre Zeile
```

- **Pool-Mandant**: Verwaltet Rotationsgruppen, Mitglieder, Rotationen (Workplaces), Timeslots und erfüllt Bedarf durch Zuweisungen.
- **Ward-Mandant**: Sieht nur seine eigene Zeile (seine Rotation) und kann dort Bedarf für Timeslots anmelden oder zurückziehen.

### Abgrenzung zu Cross-Tenant-Diensten

| Aspekt | Cross-Tenant-Dienste (`shared_*`) | Springerpool-Rotationen (`rotation_*`) |
|--------|-----------------------------------|----------------------------------------|
| Tabellen | `shared_workplace`, `shared_shift_entry` | `rotation_group`, `rotation_workplace`, `rotation_timeslot`, `rotation_assignment`, `rotation_demand` |
| Routen | `/api/groups`, `/api/shared-shifts` | `/api/rotations` |
| Frontend-Tab | "Mandanten-Verbünde" | "Rotationsverbünde" |
| Planungsboard-Sektion | "Verbund-Dienste" | "Pool-Rotationen" |
| Bedarfsanmeldung | Nein | Ja (Ward → Pool) |
| Auto-Erfüllung | Nein | Ja (Zuweisung erfüllt Bedarf) |

## Datenbankschema

Alle Tabellen liegen in der Master-DB. Migrationen in `server/utils/masterMigrations.js` (Phase: "Springerpool-Rotationen").

### `rotation_group`
Rotationsgruppe (z. B. "Gynäkologie Springerpool").

| Spalte | Typ | Beschreibung |
|--------|-----|--------------|
| `id` | INT AUTO_INCREMENT PK | |
| `name` | VARCHAR(100) | Gruppenname |
| `description` | TEXT NULL | Optionale Beschreibung |
| `pool_tenant_id` | VARCHAR(255) | Mandant des Pool-Planers |
| `created_at` | TIMESTAMP | |
| `updated_at` | TIMESTAMP | |

### `rotation_group_member`
Mitgliedschaft in einer Rotationsgruppe.

| Spalte | Typ | Beschreibung |
|--------|-----|--------------|
| `id` | INT AUTO_INCREMENT PK | |
| `group_id` | INT FK → `rotation_group.id` | |
| `user_id` | INT FK → `app_users.id` | |
| `role` | ENUM('pool','ward') | Rolle des Mitglieds |
| `created_at` | TIMESTAMP | |

### `rotation_workplace`
Eine Rotation (Zeile im Board), z. B. "Gyn 1".

| Spalte | Typ | Beschreibung |
|--------|-----|--------------|
| `id` | INT AUTO_INCREMENT PK | |
| `group_id` | INT FK → `rotation_group.id` | |
| `name` | VARCHAR(100) | Rotationsname |
| `ward_tenant_id` | VARCHAR(255) | Mandant der Station, die diese Zeile sieht |
| `timeslots_enabled` | TINYINT(1) DEFAULT 0 | Ob Timeslots aktiv sind |
| `sort_order` | INT DEFAULT 0 | Sortierung |
| `created_at` | TIMESTAMP | |
| `updated_at` | TIMESTAMP | |

### `rotation_timeslot`
Timeslot einer Rotation (z. B. Frühdienst 07:00–15:00).

| Spalte | Typ | Beschreibung |
|--------|-----|--------------|
| `id` | INT AUTO_INCREMENT PK | |
| `workplace_id` | INT FK → `rotation_workplace.id` | |
| `label` | VARCHAR(50) | Anzeigelabel |
| `start_time` | TIME NULL | Startzeit |
| `end_time` | TIME NULL | Endzeit |
| `sort_order` | INT DEFAULT 0 | |
| `created_at` | TIMESTAMP | |

### `rotation_assignment`
Zuweisung eines Springers zu einer Rotationszelle (Workplace + Datum + Timeslot).

| Spalte | Typ | Beschreibung |
|--------|-----|--------------|
| `id` | INT AUTO_INCREMENT PK | |
| `group_id` | INT FK → `rotation_group.id` | |
| `rotation_workplace_id` | INT FK → `rotation_workplace.id` | |
| `employee_id` | INT | Mitarbeiter-ID |
| `employee_name` | VARCHAR(255) | Name (denormalisiert für Anzeige) |
| `date` | DATE | Datum der Schicht |
| `timeslot_id` | INT NULL FK → `rotation_timeslot.id` | NULL = ganzer Tag |
| `note` | TEXT NULL | Notiz |
| `created_by` | INT NULL | User-ID des Erstellers |
| `created_at` | TIMESTAMP | |
| `updated_at` | TIMESTAMP | |

### `rotation_demand`
Bedarfsanmeldung einer Station für eine Rotationszelle.

| Spalte | Typ | Beschreibung |
|--------|-----|--------------|
| `id` | INT AUTO_INCREMENT PK | |
| `group_id` | INT FK → `rotation_group.id` | |
| `rotation_workplace_id` | INT FK → `rotation_workplace.id` | |
| `ward_tenant_id` | VARCHAR(255) | Mandant der anfordernden Station |
| `date` | DATE | Datum |
| `timeslot_id` | INT NULL | Timeslot (NULL = ganzer Tag) |
| `status` | ENUM('open','fulfilled','cancelled') DEFAULT 'open' | Status |
| `note` | TEXT NULL | Notiz der Station |
| `fulfilled_by_assignment_id` | INT NULL FK → `rotation_assignment.id` | Welche Zuweisung erfüllt hat |
| `created_by` | INT NULL | User-ID der Station |
| `created_at` | TIMESTAMP | |
| `updated_at` | TIMESTAMP | |

## API-Endpunkte

Alle Endpunkte unter `/api/rotations`, alle mit `authMiddleware`.

### Rotationsgruppen

| Methode | Pfad | Berechtigung | Beschreibung |
|---------|------|--------------|--------------|
| GET | `/` | auth | Eigene Gruppen auflisten |
| POST | `/` | admin | Gruppe erstellen |
| GET | `/:groupId` | read access | Gruppendetails |
| PATCH | `/:groupId` | write access | Gruppe aktualisieren |
| DELETE | `/:groupId` | write access | Gruppe löschen |

### Mitglieder

| Methode | Pfad | Berechtigung | Beschreibung |
|---------|------|--------------|--------------|
| GET | `/:groupId/members` | read access | Mitglieder auflisten |
| POST | `/:groupId/members` | write access | Mitglied hinzufügen (role: pool/ward) |
| DELETE | `/:groupId/members/:userId` | write access | Mitglied entfernen |

### Rotationen (Workplaces)

| Methode | Pfad | Berechtigung | Beschreibung |
|---------|------|--------------|--------------|
| GET | `/:groupId/workplaces` | read access | Rotationen auflisten |
| POST | `/:groupId/workplaces` | write access | Rotation erstellen (mit `ward_tenant_id`) |
| PATCH | `/:groupId/workplaces/:workplaceId` | write access | Rotation aktualisieren |
| DELETE | `/:groupId/workplaces/:workplaceId` | write access | Rotation löschen |

### Timeslots

| Methode | Pfad | Berechtigung | Beschreibung |
|---------|------|--------------|--------------|
| GET | `/:groupId/workplaces/:workplaceId/timeslots` | read access | Timeslots auflisten |
| POST | `/:groupId/workplaces/:workplaceId/timeslots` | write access | Timeslot erstellen |
| PATCH | `/:groupId/workplaces/:workplaceId/timeslots/:timeslotId` | write access | Timeslot aktualisieren |
| DELETE | `/:groupId/workplaces/:workplaceId/timeslots/:timeslotId` | write access | Timeslot löschen |

### Sichtbarkeit & Zuweisungen

| Methode | Pfad | Berechtigung | Beschreibung |
|---------|------|--------------|--------------|
| GET | `/visible-rotations` | auth | Pool sieht alle, Ward sieht nur eigene Zeile |
| POST | `/:groupId/assignments` | write access | Springer zuweisen (erfüllt automatisch offenen Bedarf) |
| PATCH | `/:groupId/assignments/:assignmentId` | write access | Zuweisung aktualisieren |
| DELETE | `/:groupId/assignments/:assignmentId` | write access | Zuweisung löschen (öffnet Bedarf wieder) |

### Bedarf

| Methode | Pfad | Berechtigung | Beschreibung |
|---------|------|--------------|--------------|
| GET | `/demands` | auth | Bedarf auflisten (Pool: alle, Ward: eigene) |
| POST | `/demands` | ward member | Bedarf anmelden (broadcastet an Admins via SSE) |
| PATCH | `/demands/:demandId` | ward member | Bedarf aktualisieren (z. B. stornieren) |

## Berechtigungssystem

### App-User-Spalten (idempotent migriert)

- `app_users.allowed_rotation_groups`: JSON-Array von Gruppen-IDs, die der User sehen darf.
- `app_users.rotation_admin_groups`: JSON-Array von Gruppen-IDs, für die der User Admin-Rechte hat.

### Helper (`server/utils/rotationGroups.js`)

- `parseAllowedRotationGroups(user)` → `number[]`
- `parseRotationAdminGroups(user)` → `number[]`
- `loadUserRotationContext(req)` → hängt `req.rotationGroups` und `req.rotationAdminGroups` an
- `canReadRotationGroup(req, groupId)` → `boolean`
- `canWriteRotationGroup(req, groupId)` → `boolean`
- `requireRotationGroupReadAccess` / `requireRotationGroupWriteAccess` → Middleware
- `listUserRotationGroups(req)` → sichtbare Gruppen
- `loadVisibleRotationGroupIdsForTenant(req)` → Gruppen-IDs für Mandanten-Scoping
- `resolvePoolTenantId(groupId)` → `pool_tenant_id` der Gruppe
- `getRotationAdminUserIds(groupId)` → User-IDs für SSE-Broadcast

### Bedarf-spezifisch (`server/routes/rotations.js`)

`canReadRotationGroupForDemand` ist **bewusst permisiver** als `canReadRotationGroup`: Wenn `allowed_rotation_groups` leer/null ist, reicht die **Mitgliedschaft** in der Gruppe (Rolle `ward`) für den Lesezugriff auf den eigenen Bedarf. So können Ward-User Bedarf anmelden, ohne explizit in `allowed_rotation_groups` eingetragen zu sein.

## Frontend

### Admin-UI (`src/components/admin/RotationGroupManagement.jsx`)

Separater Tab "Rotationsverbünde" in der Admin-Seite. Bietet:
- Gruppen-CRUD
- Mitgliederverwaltung mit Rollen `pool`/`ward`
- Rotationen-CRUD mit `ward_tenant_id`-Auswahl
- Inline-Timeslot-Editor pro Rotation

### Planungsboard (`src/components/schedule/ScheduleBoard.jsx`)

Neue Sektion **"Pool-Rotationen"** (teal-Farbschema):
- Pool-Mandant sieht alle Rotationen als Zeilen.
- Ward-Mandant sieht nur seine eigene Zeile (über `/visible-rotations`-Scoping).
- Jede Zelle zeigt Timeslot-Sub-Zellen mit:
  - Bedarfs-Badges (orange = offen, grün = erfüllt)
  - Zuweisungs-Chips (Mitarbeitername)
- Klick auf Zelle öffnet `RotationDemandDialog` (Ward) oder `RotationAssignmentDialog` (Pool).

### Dialoge

- **`RotationDemandDialog.jsx`**: Ward-Staff meldet Bedarf an, zieht ihn zurück oder sieht Erfüllung-Status. Null-Guard nach allen Hooks (Lesson aus V1-Crash).
- **`RotationAssignmentDialog.jsx`**: Pool-Planer weist Springer zu. Nutzt `db.Doctor.list()` für Mitarbeiterauswahl.

### Realtime (`src/components/PlanUpdateListener.jsx`)

Lauscht auf `rotation-demand`-Events und invalidiert die Rotations-Queries, sodass der Pool-Planer sofort neuen Bedarf sieht.

## Setup-Anleitung

1. **Migrationen ausführen**: Beim Start des Backends werden die Tabellen idempotent erstellt (`masterMigrations.js`).
2. **Rotationsgruppe anlegen** (Admin → "Rotationsverbünde"):
   - Name: z. B. "Gynäkologie Springerpool"
   - Pool-Mandant auswählen
3. **Mitglieder hinzufügen**:
   - Pool-Planer mit Rolle `pool`
   - Stations-Personal mit Rolle `ward`
4. **Rotationen (Workplaces) anlegen**:
   - "Gyn 1" mit `ward_tenant_id` = Mandant der Gyn-1-Station
   - "Gyn 2" mit `ward_tenant_id` = Mandant der Gyn-2-Station
   - "Gyn 3" mit `ward_tenant_id` = Mandant der Gyn-3-Station
5. **Timeslots pro Rotation aktivieren** (falls gewünscht):
   - `timeslots_enabled = true`
   - Timeslots: Früh (07:00–15:00), Mittel (09:00–17:00), Spät (15:00–23:00)
6. **Bedarf anmelden**: Station öffnet das Planungsboard, klickt auf ihre Zeile → "Springer-Bedarf anmelden".
7. **Bedarf erfüllen**: Pool-Planer sieht den Bedarf (orange Badge), klickt auf die Zelle → Springer zuweisen. Bedarf wird automatisch auf `fulfilled` gesetzt.

## Tests

| Datei | Tests | Beschreibung |
|-------|-------|--------------|
| `server/__tests__/rotationDemand.test.js` | 12 | Whitelist, assertNoOpenDemandForCell, markDemandFulfilledForCell, reopenDemandOnAssignmentDelete, SQL-Injection-Prävention |
| `server/__tests__/rotationGroups.test.js` | 15 | parseAllowedRotationGroups, parseRotationAdminGroups, canReadRotationGroup, canWriteRotationGroup |
| `src/components/schedule/__tests__/RotationDemandDialog.test.jsx` | 6 | Null-Guard, Create/Cancel/Fulfilled-Modi, Notiz-Textarea, Timeslot-Label |

## Designentscheidungen

1. **Separates System**: Rotationen nutzen eigene `rotation_*`-Tabellen, komplett isoliert von `shared_*`-Tabellen. Keine Beeinträchtigung bestehender Cross-Tenant-Dienste.
2. **Ward sieht nur eigene Zeile**: `/visible-rotations` filtert nach `ward_tenant_id` des anfragenden Mandanten. Pool sieht alle.
3. **Auto-Erfüllung**: Beim Erstellen einer Zuweisung wird offener Bedarf für dieselbe Zelle automatisch auf `fulfilled` gesetzt (`markDemandFulfilledForCell`). Beim Löschen einer Zuweisung wird der Bedarf wieder geöffnet (`reopenDemandOnAssignmentDelete`).
4. **Permissive Bedarfs-Leserechte**: Ward-Mitglieder können Bedarf für ihre Gruppe sehen/anmelden, auch ohne expliziten `allowed_rotation_groups`-Eintrag — Mitgliedschaft reicht.
